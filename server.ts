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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
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
