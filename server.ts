import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DeviationInput {
  itemNumber: number;
  sectionCode: string;
  sectionTitle: string;
  itemText: string;
  recordedDeviation: string;
  recordedCorrectiveAction: string;
}

interface DeviationSuggestionOutput {
  itemNumber: number;
  rootCauseHint: string;
  recommendedAction: string;
  preventiveMeasure: string;
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function validateDeviations(raw: unknown): DeviationInput[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > 67) return null;

  const validated: DeviationInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const obj = entry as Record<string, unknown>;
    const itemNumber = Number(obj.itemNumber);
    if (!Number.isInteger(itemNumber) || itemNumber < 1 || itemNumber > 67) {
      return null;
    }
    const itemText = sanitizeText(obj.itemText, 500);
    if (!itemText) return null;

    validated.push({
      itemNumber,
      sectionCode: sanitizeText(obj.sectionCode, 10),
      sectionTitle: sanitizeText(obj.sectionTitle, 160),
      itemText,
      recordedDeviation: sanitizeText(obj.recordedDeviation, 1000),
      recordedCorrectiveAction: sanitizeText(obj.recordedCorrectiveAction, 1000),
    });
  }
  return validated;
}

interface ServerCloudStore {
  reports: Record<string, Record<string, unknown>>;
  photos: Record<string, Record<string, Record<string, unknown>>>;
  shareLinks: Record<string, Record<string, unknown>>;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isValidEntityId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    VALID_ID_REGEX.test(id) &&
    !UNSAFE_KEYS.has(id)
  );
}

function sanitizePlainObject(
  input: unknown,
  depth = 0
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 5) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (UNSAFE_KEYS.has(k) || k.length > 128) continue;
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v
        .slice(0, 500)
        .filter(
          (item) =>
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean'
        );
    } else if (typeof v === 'object') {
      out[k] = sanitizePlainObject(v, depth + 1);
    }
  }
  return out;
}

const DATA_DIR = path.resolve(__dirname, '.data');
const CLOUD_DB_FILE = path.join(DATA_DIR, 'cloud-db.json');

function loadCloudStore(): ServerCloudStore {
  try {
    if (fs.existsSync(CLOUD_DB_FILE)) {
      const raw = fs.readFileSync(CLOUD_DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServerCloudStore>;
      return {
        reports:
          parsed.reports && typeof parsed.reports === 'object'
            ? parsed.reports
            : {},
        photos:
          parsed.photos && typeof parsed.photos === 'object'
            ? parsed.photos
            : {},
        shareLinks:
          parsed.shareLinks && typeof parsed.shareLinks === 'object'
            ? parsed.shareLinks
            : {},
      };
    }
  } catch (err) {
    console.warn('[CloudStore] Starting fresh store after load warning:', err);
  }
  return { reports: {}, photos: {}, shareLinks: {} };
}

const cloudStore: ServerCloudStore = loadCloudStore();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistCloudStoreSync(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${CLOUD_DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(cloudStore), 'utf8');
    fs.renameSync(tmpFile, CLOUD_DB_FILE);
  } catch (err) {
    console.error('[CloudStore] Failed to persist cloud store:', err);
  }
}

function schedulePersistCloudStore(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistCloudStoreSync();
  }, 150);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ==========================================================================
  // Server-Side Cloud Database API (Automatic Failover & Mirror for Firestore)
  // ==========================================================================

  app.get('/api/cloud/reports', (_req, res) => {
    const list = Object.entries(cloudStore.reports).map(([id, data]) => ({
      id,
      data,
    }));
    res.json({ reports: list });
  });

  app.get('/api/cloud/reports/:reportId', (req, res) => {
    const { reportId } = req.params;
    if (!isValidEntityId(reportId)) {
      res.status(400).json({ error: 'Invalid report ID.' });
      return;
    }
    const reportData = Object.prototype.hasOwnProperty.call(
      cloudStore.reports,
      reportId
    )
      ? cloudStore.reports[reportId]
      : null;

    if (!reportData) {
      res.json({ exists: false, id: reportId, data: null, photos: [] });
      return;
    }

    const reportPhotosMap = Object.prototype.hasOwnProperty.call(
      cloudStore.photos,
      reportId
    )
      ? cloudStore.photos[reportId]
      : {};
    const photos = Object.entries(reportPhotosMap).map(([id, data]) => ({
      id,
      data,
    }));

    res.json({
      exists: true,
      id: reportId,
      data: reportData,
      photos,
    });
  });

  app.post('/api/cloud/reports/:reportId', (req, res) => {
    const { reportId } = req.params;
    if (!isValidEntityId(reportId)) {
      res.status(400).json({ error: 'Invalid report ID.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request payload.' });
      return;
    }

    const incomingData = sanitizePlainObject(body.data);
    const shouldMerge = body.merge !== false;
    const nowIso = new Date().toISOString();

    const existing =
      shouldMerge &&
      Object.prototype.hasOwnProperty.call(cloudStore.reports, reportId)
        ? cloudStore.reports[reportId]
        : null;

    const merged: Record<string, unknown> = existing
      ? { ...existing, ...incomingData }
      : { ...incomingData, createdAt: incomingData.createdAt || nowIso };

    if (existing) {
      if (
        existing.responses &&
        typeof existing.responses === 'object' &&
        incomingData.responses &&
        typeof incomingData.responses === 'object'
      ) {
        merged.responses = {
          ...(existing.responses as Record<string, unknown>),
          ...(incomingData.responses as Record<string, unknown>),
        };
      }
      if (
        existing.signOffs &&
        typeof existing.signOffs === 'object' &&
        incomingData.signOffs &&
        typeof incomingData.signOffs === 'object'
      ) {
        merged.signOffs = {
          ...(existing.signOffs as Record<string, unknown>),
          ...(incomingData.signOffs as Record<string, unknown>),
        };
      }
      if (
        existing.stats &&
        typeof existing.stats === 'object' &&
        incomingData.stats &&
        typeof incomingData.stats === 'object'
      ) {
        merged.stats = {
          ...(existing.stats as Record<string, unknown>),
          ...(incomingData.stats as Record<string, unknown>),
        };
      }
    }

    const currentPhotoIds = new Set<string>(
      Array.isArray(merged.photoIds)
        ? (merged.photoIds as unknown[]).filter(isValidEntityId)
        : Array.isArray(existing?.photoIds)
          ? (existing.photoIds as unknown[]).filter(isValidEntityId)
          : []
    );

    if (Array.isArray(body.unionPhotoIds)) {
      for (const pid of body.unionPhotoIds) {
        if (isValidEntityId(pid)) currentPhotoIds.add(pid);
      }
    }
    if (Array.isArray(body.removePhotoIds)) {
      for (const pid of body.removePhotoIds) {
        if (typeof pid === 'string') currentPhotoIds.delete(pid);
      }
    }
    if (Array.isArray(body.unionSharedWithEmails)) {
      const emails = new Set<string>(
        Array.isArray(merged.sharedWithEmails)
          ? (merged.sharedWithEmails as unknown[]).map(String)
          : []
      );
      for (const em of body.unionSharedWithEmails) {
        if (typeof em === 'string' && em.length <= 254) emails.add(em);
      }
      merged.sharedWithEmails = Array.from(emails);
    }
    if (Array.isArray(body.removeSharedWithEmails)) {
      const rem = new Set(body.removeSharedWithEmails.map(String));
      merged.sharedWithEmails = (
        Array.isArray(merged.sharedWithEmails) ? merged.sharedWithEmails : []
      ).filter((e) => !rem.has(String(e)));
    }
    if (Array.isArray(body.unionEditorEmails)) {
      const emails = new Set<string>(
        Array.isArray(merged.editorEmails)
          ? (merged.editorEmails as unknown[]).map(String)
          : []
      );
      for (const em of body.unionEditorEmails) {
        if (typeof em === 'string' && em.length <= 254) emails.add(em);
      }
      merged.editorEmails = Array.from(emails);
    }
    if (Array.isArray(body.removeEditorEmails)) {
      const rem = new Set(body.removeEditorEmails.map(String));
      merged.editorEmails = (
        Array.isArray(merged.editorEmails) ? merged.editorEmails : []
      ).filter((e) => !rem.has(String(e)));
    }

    merged.photoIds = Array.from(currentPhotoIds).slice(0, 250);
    merged.updatedAt = nowIso;

    cloudStore.reports[reportId] = merged;
    schedulePersistCloudStore();

    res.json({
      ok: true,
      id: reportId,
      updatedAt: nowIso,
      data: merged,
    });
  });

  app.delete('/api/cloud/reports/:reportId', (req, res) => {
    const { reportId } = req.params;
    if (!isValidEntityId(reportId)) {
      res.status(400).json({ error: 'Invalid report ID.' });
      return;
    }

    const existing = cloudStore.reports[reportId];
    if (
      existing &&
      typeof existing.activeShareLinkId === 'string' &&
      isValidEntityId(existing.activeShareLinkId)
    ) {
      delete cloudStore.shareLinks[existing.activeShareLinkId];
    }

    delete cloudStore.reports[reportId];
    delete cloudStore.photos[reportId];
    schedulePersistCloudStore();

    res.json({ ok: true });
  });

  app.post('/api/cloud/reports/:reportId/photos', (req, res) => {
    const { reportId } = req.params;
    if (!isValidEntityId(reportId)) {
      res.status(400).json({ error: 'Invalid report ID.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || !Array.isArray(body.photos)) {
      res.status(400).json({ error: 'Expected photos array.' });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(cloudStore.photos, reportId)) {
      cloudStore.photos[reportId] = {};
    }
    const reportPhotos = cloudStore.photos[reportId];
    const nowIso = new Date().toISOString();
    const addedPhotoIds: string[] = [];

    for (const rawEntry of body.photos.slice(0, 250)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const photoId = entry.id;
      if (!isValidEntityId(photoId)) continue;

      const incoming = sanitizePlainObject(entry.data);
      const existingPhoto = Object.prototype.hasOwnProperty.call(
        reportPhotos,
        photoId
      )
        ? reportPhotos[photoId]
        : null;

      reportPhotos[photoId] = existingPhoto
        ? { ...existingPhoto, ...incoming, updatedAt: nowIso }
        : {
            ...incoming,
            createdAt: incoming.createdAt || nowIso,
            updatedAt: nowIso,
          };
      addedPhotoIds.push(photoId);
    }

    if (
      addedPhotoIds.length > 0 &&
      Object.prototype.hasOwnProperty.call(cloudStore.reports, reportId)
    ) {
      const rep = cloudStore.reports[reportId];
      const existingIds = Array.isArray(rep.photoIds)
        ? (rep.photoIds as unknown[]).filter(isValidEntityId)
        : [];
      const nextIds = Array.from(
        new Set([...existingIds, ...addedPhotoIds])
      ).slice(0, 250);
      rep.photoIds = nextIds;
      const prevStats =
        rep.stats && typeof rep.stats === 'object'
          ? (rep.stats as Record<string, unknown>)
          : {};
      rep.stats = {
        ...prevStats,
        photoCount: Object.keys(reportPhotos).length,
      };
      rep.updatedAt = nowIso;
    }

    schedulePersistCloudStore();
    res.json({ ok: true, count: addedPhotoIds.length });
  });

  app.delete('/api/cloud/reports/:reportId/photos', (req, res) => {
    const { reportId } = req.params;
    if (!isValidEntityId(reportId)) {
      res.status(400).json({ error: 'Invalid report ID.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const rawIds = Array.isArray(body?.photoIds) ? body.photoIds : [];
    const validIds = rawIds.filter(isValidEntityId);

    const reportPhotos = Object.prototype.hasOwnProperty.call(
      cloudStore.photos,
      reportId
    )
      ? cloudStore.photos[reportId]
      : null;

    if (reportPhotos) {
      for (const pid of validIds) {
        delete reportPhotos[pid];
      }
    }

    if (Object.prototype.hasOwnProperty.call(cloudStore.reports, reportId)) {
      const rep = cloudStore.reports[reportId];
      const removedSet = new Set(validIds);
      const remainingIds = (
        Array.isArray(rep.photoIds) ? (rep.photoIds as unknown[]) : []
      )
        .filter(isValidEntityId)
        .filter((id) => !removedSet.has(id));
      rep.photoIds = remainingIds;
      const prevStats =
        rep.stats && typeof rep.stats === 'object'
          ? (rep.stats as Record<string, unknown>)
          : {};
      rep.stats = {
        ...prevStats,
        photoCount: reportPhotos
          ? Object.keys(reportPhotos).length
          : remainingIds.length,
      };
      rep.updatedAt = new Date().toISOString();
    }

    schedulePersistCloudStore();
    res.json({ ok: true });
  });

  app.get('/api/cloud/photos', (req, res) => {
    const rawIds =
      typeof req.query.reportIds === 'string'
        ? req.query.reportIds.split(',')
        : [];
    const reportIds = rawIds.map((s) => s.trim()).filter(isValidEntityId);
    const results: Array<{
      id: string;
      reportId: string;
      data: Record<string, unknown>;
    }> = [];

    for (const rid of reportIds) {
      const map = Object.prototype.hasOwnProperty.call(cloudStore.photos, rid)
        ? cloudStore.photos[rid]
        : null;
      if (!map) continue;
      for (const [pid, pdata] of Object.entries(map)) {
        results.push({ id: pid, reportId: rid, data: pdata });
      }
    }

    res.json({ photos: results });
  });

  app.get('/api/cloud/share-links/:shareId', (req, res) => {
    const { shareId } = req.params;
    if (!isValidEntityId(shareId)) {
      res.status(400).json({ error: 'Invalid share ID.' });
      return;
    }
    const data = Object.prototype.hasOwnProperty.call(
      cloudStore.shareLinks,
      shareId
    )
      ? cloudStore.shareLinks[shareId]
      : null;
    res.json({ exists: Boolean(data), id: shareId, data });
  });

  app.post('/api/cloud/share-links/:shareId', (req, res) => {
    const { shareId } = req.params;
    if (!isValidEntityId(shareId)) {
      res.status(400).json({ error: 'Invalid share ID.' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const incoming = sanitizePlainObject(body?.data);
    const nowIso = new Date().toISOString();
    const existing = Object.prototype.hasOwnProperty.call(
      cloudStore.shareLinks,
      shareId
    )
      ? cloudStore.shareLinks[shareId]
      : null;
    cloudStore.shareLinks[shareId] = existing
      ? { ...existing, ...incoming, updatedAt: nowIso }
      : { ...incoming, createdAt: nowIso, updatedAt: nowIso };
    schedulePersistCloudStore();
    res.json({ ok: true, id: shareId, data: cloudStore.shareLinks[shareId] });
  });

  app.post('/api/ai/deviation-suggestions', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        res.status(500).json({
          error:
            'GEMINI_API_KEY is not configured on the server. Add it in Secrets to generate AI deviation suggestions.',
        });
        return;
      }

      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid request payload.' });
        return;
      }

      const deviations = validateDeviations(body.deviations);
      if (deviations === null) {
        res.status(400).json({
          error:
            'Invalid deviations list. Expected an array of up to 67 valid checklist items.',
        });
        return;
      }

      const storeLocation =
        sanitizeText(body.storeLocation, 200) || 'Store Branch';
      const dateOfInspection = sanitizeText(body.dateOfInspection, 40) || 'N/A';
      const reportNo = sanitizeText(body.reportNo, 120) || 'IQAF-005';
      const complianceRateRaw = body.complianceRate;
      const complianceRate =
        typeof complianceRateRaw === 'number' &&
        Number.isFinite(complianceRateRaw) &&
        complianceRateRaw >= 0 &&
        complianceRateRaw <= 100
          ? Math.round(complianceRateRaw)
          : null;
      const totalChecked =
        typeof body.totalChecked === 'number' && Number.isFinite(body.totalChecked)
          ? Math.max(0, Math.min(67, Math.round(body.totalChecked)))
          : 0;
      const yesCount =
        typeof body.yesCount === 'number' && Number.isFinite(body.yesCount)
          ? Math.max(0, Math.min(67, Math.round(body.yesCount)))
          : 0;

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      if (deviations.length === 0) {
        const summaryPrompt = `You are a Food Safety & Restaurant Quality Assurance Specialist writing a brief executive summary for a store inspection email report based on IQAF-005.
Store: ${storeLocation}
Report No.: ${reportNo}
Inspection Date: ${dateOfInspection}
Items Checked: ${totalChecked} / 67
Complied (Yes): ${yesCount}
Compliance Score: ${complianceRate !== null ? `${complianceRate}%` : 'N/A'}
Deviations (No): 0

Write a concise, professional 2-sentence QA email note acknowledging zero recorded deviations and encouraging continued adherence to food safety and sanitation standards.`;

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: summaryPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                overallEmailNote: {
                  type: Type.STRING,
                  description:
                    'Concise 2-sentence professional QA summary for the email report.',
                },
              },
              required: ['overallEmailNote'],
            },
          },
        });

        const parsed = JSON.parse(response.text || '{}') as {
          overallEmailNote?: string;
        };

        res.json({
          overallEmailNote:
            sanitizeText(parsed.overallEmailNote, 800) ||
            'All applicable inspected items complied with IQAF-005 standards with zero deviations logged.',
          suggestions: [],
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const deviationsBlock = deviations
        .map(
          (d) =>
            `- Item #${d.itemNumber} [Section ${d.sectionCode}: ${d.sectionTitle}]
  Checklist Requirement: ${d.itemText}
  Recorded Findings: ${d.recordedDeviation || '(Not yet detailed by inspector)'}
  Recorded Corrective Action: ${d.recordedCorrectiveAction || '(None recorded yet)'}`
        )
        .join('\n\n');

      const prompt = `You are a Senior Food Safety & Restaurant Quality Assurance Auditor reviewing an IQAF-005 Store Inspection Report before it is emailed to store management and the Area Manager.

Inspection Context:
- Store Location: ${storeLocation}
- Report No.: ${reportNo}
- Inspection Date: ${dateOfInspection}
- Items Checked: ${totalChecked} / 67
- Compliance Score: ${complianceRate !== null ? `${complianceRate}%` : 'N/A'}
- Total Deviations (No): ${deviations.length}

Deviations Requiring Email-Only Recommendations:
${deviationsBlock}

Instructions:
1. Provide an "overallEmailNote": 2 to 3 crisp, actionable sentences summarizing overall compliance posture and top immediate priorities for the branch team and Area Manager.
2. Provide a "suggestions" array with EXACTLY ONE entry per listed deviation itemNumber (preserve each itemNumber exactly).
3. For each deviation, provide practical, specific restaurant food-safety/QA guidance:
   - "rootCauseHint": 1 concise sentence identifying the likely operational gap or food-safety risk.
   - "recommendedAction": 1 to 2 concrete immediate corrective steps the shift/store manager should execute (complementing any recorded corrective action without repeating it verbatim).
   - "preventiveMeasure": 1 practical recurring control, log, or coaching habit to prevent recurrence.
4. Keep every field concise, professional, and directly usable in an email report. No markdown bullets or asterisks.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallEmailNote: {
                type: Type.STRING,
                description:
                  '2-3 sentence executive QA summary for the email report.',
              },
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemNumber: {
                      type: Type.INTEGER,
                      description: 'Exact checklist item number.',
                    },
                    rootCauseHint: {
                      type: Type.STRING,
                      description: 'Concise food-safety risk or root cause.',
                    },
                    recommendedAction: {
                      type: Type.STRING,
                      description: 'Specific immediate corrective recommendation.',
                    },
                    preventiveMeasure: {
                      type: Type.STRING,
                      description: 'Ongoing preventive control to avoid recurrence.',
                    },
                  },
                  required: [
                    'itemNumber',
                    'rootCauseHint',
                    'recommendedAction',
                    'preventiveMeasure',
                  ],
                },
              },
            },
            required: ['overallEmailNote', 'suggestions'],
          },
        },
      });

      const rawText = response.text;
      if (!rawText) {
        res.status(502).json({
          error: 'AI model returned an empty response. Please try again.',
        });
        return;
      }

      const parsed = JSON.parse(rawText) as {
        overallEmailNote?: string;
        suggestions?: unknown[];
      };

      const validItemNumbers = new Set(deviations.map((d) => d.itemNumber));
      const suggestionMap = new Map<number, DeviationSuggestionOutput>();

      if (Array.isArray(parsed.suggestions)) {
        for (const entry of parsed.suggestions) {
          if (!entry || typeof entry !== 'object') continue;
          const obj = entry as Record<string, unknown>;
          const num = Number(obj.itemNumber);
          if (!validItemNumbers.has(num)) continue;
          suggestionMap.set(num, {
            itemNumber: num,
            rootCauseHint: sanitizeText(obj.rootCauseHint, 500),
            recommendedAction: sanitizeText(obj.recommendedAction, 700),
            preventiveMeasure: sanitizeText(obj.preventiveMeasure, 500),
          });
        }
      }

      const orderedSuggestions: DeviationSuggestionOutput[] = [];
      for (const dev of deviations) {
        const match = suggestionMap.get(dev.itemNumber);
        if (match) {
          orderedSuggestions.push(match);
        }
      }

      res.json({
        overallEmailNote: sanitizeText(parsed.overallEmailNote, 1000),
        suggestions: orderedSuggestions,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to generate AI deviation suggestions.';
      res.status(502).json({
        error: `AI suggestion generation failed: ${message}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
