import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  FORM_DOCUMENTATION_NO,
  FORM_REVISION_NO,
  createEmptyResponse,
} from '../data/checklistData';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type {
  ComplianceStatus,
  InspectionReport,
  ItemResponse,
  PhotoProof,
  StoredPhotoRecord,
} from '../types/inspection';
import { ensureSafePhotoDataUrl } from './imageUtils';

export interface CloudReportSummary {
  id: string;
  ownerId: string;
  documentationNo: string;
  revisionNo: string;
  dateOfInspection: string;
  storeLocation: string;
  timeOfInspection: string;
  inspectedBy: string;
  stats: {
    answered: number;
    yes: number;
    no: number;
    na: number;
    photoCount: number;
  };
  updatedAtIso: string;
  createdAtIso: string;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

// Per-report async queue to prevent concurrent Master Gate / photoCount race conditions
const reportWriteQueues = new Map<string, Promise<unknown>>();
// Cache of `${uid}:${reportId}` pairs confirmed to exist in Firestore
const ensuredReportIds = new Set<string>();

export function clearCloudReportCache(): void {
  ensuredReportIds.clear();
}

function enqueueReportWrite<T>(
  reportId: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = reportWriteQueues.get(reportId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => task());
  const tracked = next.finally(() => {
    if (reportWriteQueues.get(reportId) === tracked) {
      reportWriteQueues.delete(reportId);
    }
  });
  reportWriteQueues.set(reportId, tracked);
  return next;
}

function clampString(value: string | null | undefined, maxLen: number): string {
  const s = typeof value === 'string' ? value : '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function sanitizeId(raw: string, prefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  if (VALID_ID_REGEX.test(cleaned)) return cleaned;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeComplied(val: unknown): ComplianceStatus {
  if (val === 'Yes' || val === 'No' || val === 'N/A') return val;
  return '';
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function computeStats(report: InspectionReport, overridePhotoCount?: number) {
  let answered = 0;
  let yes = 0;
  let no = 0;
  let na = 0;
  let photoCount = 0;

  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number];
    if (!r) continue;
    if (r.complied) answered++;
    if (r.complied === 'Yes') yes++;
    if (r.complied === 'No') no++;
    if (r.complied === 'N/A') na++;
    photoCount += r.photos.length;
  }

  return {
    answered: Math.min(67, answered),
    yes: Math.min(67, yes),
    no: Math.min(67, no),
    na: Math.min(67, na),
    photoCount: Math.min(500, overridePhotoCount ?? photoCount),
  };
}

function buildReportResponsesPayload(report: InspectionReport) {
  const map: Record<
    string,
    { complied: ComplianceStatus; deviation: string; correctiveAction: string }
  > = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number] ?? createEmptyResponse();
    map[String(item.number)] = {
      complied: sanitizeComplied(r.complied),
      deviation: clampString(r.deviation, 2000),
      correctiveAction: clampString(r.correctiveAction, 2000),
    };
  }
  return map;
}

function buildSignOffsPayload(report: InspectionReport) {
  const sanitizeEntry = (entry: InspectionReport['signOffs']['performedBy']) => ({
    printedName: clampString(entry.printedName, 160),
    date: clampString(entry.date, 20),
    signatureDataUrl:
      entry.signatureDataUrl && entry.signatureDataUrl.length <= 150000
        ? entry.signatureDataUrl
        : null,
  });

  return {
    performedBy: sanitizeEntry(report.signOffs.performedBy),
    acknowledgedBy: sanitizeEntry(report.signOffs.acknowledgedBy),
    notedBy: sanitizeEntry(report.signOffs.notedBy),
  };
}

function buildCommonReportFields(
  report: InspectionReport,
  overridePhotoCount?: number
) {
  return {
    documentationNo: clampString(
      report.meta.documentationNo || FORM_DOCUMENTATION_NO,
      40
    ),
    revisionNo: clampString(report.meta.revisionNo || FORM_REVISION_NO, 20),
    dateOfInspection: clampString(report.meta.dateOfInspection, 20),
    storeLocation: clampString(report.meta.storeLocation, 200),
    timeOfInspection: clampString(report.meta.timeOfInspection, 20),
    inspectedBy: clampString(report.meta.inspectedBy, 160),
    responses: buildReportResponsesPayload(report),
    signOffs: buildSignOffsPayload(report),
    stats: computeStats(report, overridePhotoCount),
  };
}

/**
 * Subscribe in real time to all inspection reports owned by the signed-in user.
 */
export function subscribeToUserReports(
  uid: string,
  onChange: (reports: CloudReportSummary[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = 'reports';
  const q = query(collection(db, path), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CloudReportSummary[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId ?? uid),
          documentationNo: String(d.documentationNo ?? FORM_DOCUMENTATION_NO),
          revisionNo: String(d.revisionNo ?? FORM_REVISION_NO),
          dateOfInspection: String(d.dateOfInspection ?? ''),
          storeLocation: String(d.storeLocation ?? ''),
          timeOfInspection: String(d.timeOfInspection ?? ''),
          inspectedBy: String(d.inspectedBy ?? ''),
          stats: {
            answered: Number(d.stats?.answered ?? 0),
            yes: Number(d.stats?.yes ?? 0),
            no: Number(d.stats?.no ?? 0),
            na: Number(d.stats?.na ?? 0),
            photoCount: Number(d.stats?.photoCount ?? 0),
          },
          createdAtIso: toIsoString(d.createdAt),
          updatedAtIso: toIsoString(d.updatedAt),
        };
      });

      list.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
      onChange(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * Immediately uploads a single photo proof to Firestore upon capture/selection.
 * Guarantees the parent `/reports/{reportId}` document exists first (for Master Gate),
 * serializes concurrent uploads for the same report, validates/compresses the image data,
 * and updates the parent report's live photo count.
 */
export function uploadSinglePhotoImmediatelyOnline(
  uid: string,
  report: InspectionReport,
  itemNumber: number,
  photo: PhotoProof
): Promise<{
  reportId: string;
  photoId: string;
  safeDataUrl: string;
  storedRecord: StoredPhotoRecord;
}> {
  const safeReportId = sanitizeId(report.id, 'insp');
  return enqueueReportWrite(safeReportId, async () => {
    const reportPath = `reports/${safeReportId}`;
    const reportRef = doc(db, 'reports', safeReportId);

    const startMs = Date.now();
    // Ensure valid, <= 500KB JPEG dataUrl (never corrupt base64 by truncating)
    const safeDataUrl = await ensureSafePhotoDataUrl(photo.dataUrl);
    if (!safeDataUrl || safeDataUrl.length > 600000) {
      console.error('[PhotoUpload] Payload rejected before write', {
        reportId: safeReportId,
        photoId: photo.id,
        itemNumber,
        payloadChars: safeDataUrl?.length ?? 0,
      });
      throw new Error('Photo exceeds the maximum 600 KB storage limit.');
    }

    // Find section and item metadata
    let sectionCode = 'A';
    let sectionTitle = '';
    let itemText = '';
    for (const sec of CHECKLIST_SECTIONS) {
      const found = sec.items.find((it) => it.number === itemNumber);
      if (found) {
        sectionCode = sec.code;
        sectionTitle = sec.title;
        itemText = found.text;
        break;
      }
    }

    // Step 1: Ensure parent report exists in Firestore before subcollection write
    const cacheKey = `${uid}:${safeReportId}`;
    const ensureParentReport = async () => {
      let exists = false;
      try {
        const snap = await getDoc(reportRef);
        exists = snap.exists();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: string })?.code ?? '';
        if (
          code !== 'permission-denied' &&
          !msg.includes('permission-denied') &&
          !msg.includes('Missing or insufficient permissions')
        ) {
          handleFirestoreError(error, OperationType.GET, reportPath);
        }
      }

      if (!exists) {
        console.info('[PhotoUpload] Creating parent report before photo write', {
          reportPath,
          uid,
        });
        const initialFields = buildCommonReportFields(report);
        try {
          await setDoc(reportRef, {
            ownerId: uid,
            ...initialFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, reportPath);
        }
      }
      ensuredReportIds.add(cacheKey);
    };

    if (!ensuredReportIds.has(cacheKey)) {
      await ensureParentReport();
    }

    const photosColPath = `reports/${safeReportId}/photos`;
    const safePhotoId = sanitizeId(photo.id, 'ph');
    const photoPath = `${photosColPath}/${safePhotoId}`;
    const photoRef = doc(db, photosColPath, safePhotoId);
    const resp = report.responses[itemNumber] ?? createEmptyResponse();
    const storeLocation = clampString(report.meta.storeLocation, 200);
    const inspectionDate = clampString(report.meta.dateOfInspection, 20);
    const capturedAt = clampString(
      photo.capturedAt || new Date().toISOString(),
      40
    );
    const fileName = clampString(
      photo.fileName || `item-${itemNumber}.jpg`,
      200
    );
    const caption = clampString(photo.caption, 500);
    const complied = sanitizeComplied(resp.complied);
    const deviation = clampString(resp.deviation, 2000);

    const createPayload = {
      ownerId: uid,
      reportId: safeReportId,
      itemNumber,
      sectionCode: clampString(sectionCode, 4),
      sectionTitle: clampString(sectionTitle, 120),
      itemText: clampString(itemText, 400),
      complied,
      deviation,
      caption,
      fileName,
      storeLocation,
      inspectionDate,
      dataUrl: safeDataUrl,
      capturedAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const updatePayload = {
      caption,
      complied,
      deviation,
      storeLocation,
      inspectionDate,
      updatedAt: serverTimestamp(),
    };

    // Step 2: Directly write photo document without downloading all previous photos first.
    // If setDoc hits permission-denied on an existing doc (e.g., retry) or a deleted parent,
    // recover cleanly via updateDoc or re-creating the parent report.
    console.info('[PhotoUpload] Writing photo document', {
      photoPath,
      itemNumber,
      payloadChars: safeDataUrl.length,
    });
    try {
      await setDoc(photoRef, createPayload);
    } catch (firstErr) {
      const msg =
        firstErr instanceof Error ? firstErr.message : String(firstErr);
      const errCode = (firstErr as { code?: string })?.code ?? 'unknown';
      const isPermOrExists =
        errCode === 'permission-denied' ||
        errCode === 'already-exists' ||
        msg.includes('permission-denied') ||
        msg.includes('Missing or insufficient permissions') ||
        msg.includes('already-exists');

      console.warn('[PhotoUpload] Initial setDoc failed', {
        photoPath,
        errCode,
        isPermOrExists,
        msg,
      });

      if (!isPermOrExists) {
        handleFirestoreError(firstErr, OperationType.CREATE, photoPath);
      }

      // First try updating in case the photo document already exists (e.g., retry after timeout)
      try {
        await updateDoc(photoRef, updatePayload);
        console.info('[PhotoUpload] Recovered via updateDoc on existing photo', {
          photoPath,
        });
      } catch (updateErr) {
        console.warn(
          '[PhotoUpload] updateDoc recovery failed, re-ensuring parent report',
          {
            photoPath,
            updateErrCode: (updateErr as { code?: string })?.code ?? 'unknown',
          }
        );
        // Otherwise parent report may have been deleted remotely; re-ensure parent and create once
        ensuredReportIds.delete(cacheKey);
        await ensureParentReport();
        try {
          await setDoc(photoRef, createPayload);
        } catch (retryErr) {
          handleFirestoreError(retryErr, OperationType.CREATE, photoPath);
        }
      }
    }

    // Step 3: Best-effort update of parent report's photoCount stat (never fail an already-uploaded photo)
    try {
      const liveStats = computeStats(report);
      await updateDoc(reportRef, {
        stats: liveStats,
        updatedAt: serverTimestamp(),
      });
    } catch (statsErr) {
      console.warn('[PhotoUpload] Non-fatal photoCount sync warning:', statsErr);
    }

    console.info('[PhotoUpload] Completed online photo upload', {
      photoPath,
      itemNumber,
      elapsedMs: Date.now() - startMs,
    });

    const storedRecord: StoredPhotoRecord = {
      id: safePhotoId,
      reportId: safeReportId,
      storeLocation: storeLocation || 'Untitled Store',
      inspectionDate,
      itemNumber,
      sectionCode,
      sectionTitle,
      itemText,
      complied: sanitizeComplied(resp.complied),
      deviation: clampString(resp.deviation, 2000),
      caption: clampString(photo.caption, 500),
      capturedAt,
      fileName,
      dataUrl: safeDataUrl,
    };

    return {
      reportId: safeReportId,
      photoId: safePhotoId,
      safeDataUrl,
      storedRecord,
    };
  });
}

/**
 * Updates a synced photo's caption directly in Firestore.
 */
export function updatePhotoCaptionOnline(
  reportId: string,
  photoId: string,
  caption: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const safePhotoId = sanitizeId(photoId, 'ph');
  return enqueueReportWrite(safeReportId, async () => {
    const photoPath = `reports/${safeReportId}/photos/${safePhotoId}`;
    try {
      await updateDoc(doc(db, 'reports', safeReportId, 'photos', safePhotoId), {
        caption: clampString(caption, 500),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, photoPath);
    }
  });
}

/**
 * Lightweight, quota-safe online autosave for the parent `/reports/{reportId}` document.
 * Writes ONLY the report metadata, responses, sign-offs, and stats (no photo subcollection
 * reads/rewrites, since photos upload immediately when captured or selected).
 */
export function autosaveReportDocumentOnline(
  uid: string,
  report: InspectionReport
): Promise<{ reportId: string; updatedAt: string }> {
  const safeReportId = sanitizeId(report.id, 'insp');
  return enqueueReportWrite(safeReportId, async () => {
    const reportPath = `reports/${safeReportId}`;
    const reportRef = doc(db, 'reports', safeReportId);
    const commonFields = buildCommonReportFields(report);
    const cacheKey = `${uid}:${safeReportId}`;

    // Fast path: if report is already known to exist in Firestore, do a single updateDoc (0 reads, 1 write)
    if (ensuredReportIds.has(cacheKey)) {
      try {
        await updateDoc(reportRef, {
          ...commonFields,
          updatedAt: serverTimestamp(),
        });
        return {
          reportId: safeReportId,
          updatedAt: new Date().toISOString(),
        };
      } catch (err) {
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        // Only fall through to existence check + create if the doc was deleted remotely
        if (code !== 'not-found' && !msg.includes('No document to update')) {
          handleFirestoreError(err, OperationType.UPDATE, reportPath);
        }
        ensuredReportIds.delete(cacheKey);
      }
    }

    let existsOnline = false;
    try {
      const existingSnap = await getDoc(reportRef);
      existsOnline = existingSnap.exists();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string })?.code ?? '';
      if (
        code !== 'permission-denied' &&
        !msg.includes('permission-denied') &&
        !msg.includes('Missing or insufficient permissions')
      ) {
        handleFirestoreError(error, OperationType.GET, reportPath);
      }
      existsOnline = false;
    }

    if (existsOnline) {
      try {
        await updateDoc(reportRef, {
          ...commonFields,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, reportPath);
      }
    } else {
      try {
        await setDoc(reportRef, {
          ownerId: uid,
          ...commonFields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, reportPath);
      }
    }

    ensuredReportIds.add(cacheKey);
    return {
      reportId: safeReportId,
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Saves (creates or updates) an inspection report AND syncs all of its photo proofs
 * to `/reports/{reportId}/photos/{photoId}` in Firestore.
 */
export function saveReportOnline(
  uid: string,
  report: InspectionReport
): Promise<InspectionReport> {
  const safeReportId = sanitizeId(report.id, 'insp');
  return enqueueReportWrite(safeReportId, async () => {
    const reportPath = `reports/${safeReportId}`;
    const reportRef = doc(db, 'reports', safeReportId);
    const commonFields = buildCommonReportFields(report);

    let existsOnline = false;
    try {
      const existingSnap = await getDoc(reportRef);
      existsOnline = existingSnap.exists();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        !msg.includes('permission-denied') &&
        !msg.includes('Missing or insufficient permissions')
      ) {
        handleFirestoreError(error, OperationType.GET, reportPath);
      }
      existsOnline = false;
    }

    if (existsOnline) {
      try {
        await updateDoc(reportRef, {
          ...commonFields,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, reportPath);
      }
    } else {
      try {
        await setDoc(reportRef, {
          ownerId: uid,
          ...commonFields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, reportPath);
      }
    }
    ensuredReportIds.add(`${uid}:${safeReportId}`);

    // Now sync photos subcollection (parent report guaranteed to exist for Master Gate!)
    const photosColPath = `reports/${safeReportId}/photos`;
    const existingPhotoIds = new Set<string>();
    try {
      const existingPhotosSnap = await getDocs(
        query(collection(db, photosColPath), where('ownerId', '==', uid))
      );
      for (const d of existingPhotosSnap.docs) {
        existingPhotoIds.add(d.id);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, photosColPath);
    }

    const desiredPhotoIds = new Set<string>();
    const updatedResponses: Record<number, ItemResponse> = { ...report.responses };

    for (const section of CHECKLIST_SECTIONS) {
      for (const item of section.items) {
        const resp = report.responses[item.number];
        if (!resp || resp.photos.length === 0) continue;

        const safePhotos: PhotoProof[] = [];
        for (const ph of resp.photos) {
          const safePhotoId = sanitizeId(ph.id, 'ph');
          const photoPath = `${photosColPath}/${safePhotoId}`;
          const photoRef = doc(db, photosColPath, safePhotoId);

          let safeDataUrl: string;
          try {
            safeDataUrl = await ensureSafePhotoDataUrl(ph.dataUrl);
          } catch {
            safePhotos.push({
              ...ph,
              id: safePhotoId,
              uploadState: 'error',
              uploadError: 'Could not prepare image for upload',
            });
            continue;
          }

          if (!safeDataUrl || safeDataUrl.length > 600000) {
            safePhotos.push({
              ...ph,
              id: safePhotoId,
              uploadState: 'error',
              uploadError: 'Photo exceeds 600 KB storage limit',
            });
            continue;
          }

          desiredPhotoIds.add(safePhotoId);

          if (existingPhotoIds.has(safePhotoId)) {
            try {
              await updateDoc(photoRef, {
                caption: clampString(ph.caption, 500),
                complied: sanitizeComplied(resp.complied),
                deviation: clampString(resp.deviation, 2000),
                storeLocation: commonFields.storeLocation,
                inspectionDate: commonFields.dateOfInspection,
                updatedAt: serverTimestamp(),
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, photoPath);
            }
          } else {
            try {
              await setDoc(photoRef, {
                ownerId: uid,
                reportId: safeReportId,
                itemNumber: item.number,
                sectionCode: clampString(section.code, 4),
                sectionTitle: clampString(section.title, 120),
                itemText: clampString(item.text, 400),
                complied: sanitizeComplied(resp.complied),
                deviation: clampString(resp.deviation, 2000),
                caption: clampString(ph.caption, 500),
                fileName: clampString(
                  ph.fileName || `item-${item.number}.jpg`,
                  200
                ),
                storeLocation: commonFields.storeLocation,
                inspectionDate: commonFields.dateOfInspection,
                dataUrl: safeDataUrl,
                capturedAt: clampString(
                  ph.capturedAt || new Date().toISOString(),
                  40
                ),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.CREATE, photoPath);
            }
          }

          safePhotos.push({
            ...ph,
            id: safePhotoId,
            dataUrl: safeDataUrl,
            uploadState: 'synced',
            uploadError: undefined,
          });
        }

        updatedResponses[item.number] = {
          ...resp,
          photos: safePhotos,
        };
      }
    }

    // Delete photos that were removed from this report
    for (const oldId of existingPhotoIds) {
      if (!desiredPhotoIds.has(oldId)) {
        const delPath = `${photosColPath}/${oldId}`;
        try {
          await deleteDoc(doc(db, photosColPath, oldId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, delPath);
        }
      }
    }

    // Ensure parent photoCount reflects actual synced photos
    if (desiredPhotoIds.size !== commonFields.stats.photoCount) {
      try {
        await updateDoc(reportRef, {
          stats: {
            ...commonFields.stats,
            photoCount: Math.min(500, desiredPhotoIds.size),
          },
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, reportPath);
      }
    }

    return {
      ...report,
      id: safeReportId,
      updatedAt: new Date().toISOString(),
      responses: updatedResponses,
    };
  });
}

/**
 * Loads a complete InspectionReport (with all attached photos from its subcollection)
 * so the user can edit it anytime or export it to PDF.
 */
export async function loadReportWithPhotosOnline(
  uid: string,
  reportId: string
): Promise<InspectionReport | null> {
  const reportPath = `reports/${reportId}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'reports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, reportPath);
  }

  if (!snap.exists()) return null;
  const d = snap.data();

  // Fetch all photo proof documents for this report
  const photosPath = `reports/${reportId}/photos`;
  let photoDocs;
  try {
    const q = query(collection(db, photosPath), where('ownerId', '==', uid));
    photoDocs = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, photosPath);
  }

  const photosByItem = new Map<number, PhotoProof[]>();
  for (const pDoc of photoDocs.docs) {
    const pd = pDoc.data();
    const itemNum = Number(pd.itemNumber);
    if (!itemNum) continue;
    const list = photosByItem.get(itemNum) ?? [];
    list.push({
      id: pDoc.id,
      dataUrl: String(pd.dataUrl ?? ''),
      caption: String(pd.caption ?? ''),
      capturedAt: String(pd.capturedAt ?? new Date().toISOString()),
      fileName: String(pd.fileName ?? `item-${itemNum}.jpg`),
      uploadState: 'synced',
    });
    photosByItem.set(itemNum, list);
  }

  // Sort each item's photos chronologically
  for (const [, list] of photosByItem) {
    list.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  const rawResponses = (d.responses ?? {}) as Record<
    string,
    { complied?: ComplianceStatus; deviation?: string; correctiveAction?: string }
  >;
  const responses: Record<number, ItemResponse> = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    const raw = rawResponses[String(item.number)];
    responses[item.number] = {
      complied: sanitizeComplied(raw?.complied),
      deviation: String(raw?.deviation ?? ''),
      correctiveAction: String(raw?.correctiveAction ?? ''),
      photos: photosByItem.get(item.number) ?? [],
    };
  }

  return {
    id: snap.id,
    updatedAt: toIsoString(d.updatedAt),
    meta: {
      documentationNo: String(d.documentationNo ?? FORM_DOCUMENTATION_NO),
      revisionNo: String(d.revisionNo ?? FORM_REVISION_NO),
      dateOfInspection: String(d.dateOfInspection ?? ''),
      storeLocation: String(d.storeLocation ?? ''),
      timeOfInspection: String(d.timeOfInspection ?? ''),
      inspectedBy: String(d.inspectedBy ?? ''),
    },
    responses,
    signOffs: {
      performedBy: {
        printedName: String(d.signOffs?.performedBy?.printedName ?? ''),
        date: String(d.signOffs?.performedBy?.date ?? ''),
        signatureDataUrl: d.signOffs?.performedBy?.signatureDataUrl ?? null,
      },
      acknowledgedBy: {
        printedName: String(d.signOffs?.acknowledgedBy?.printedName ?? ''),
        date: String(d.signOffs?.acknowledgedBy?.date ?? ''),
        signatureDataUrl: d.signOffs?.acknowledgedBy?.signatureDataUrl ?? null,
      },
      notedBy: {
        printedName: String(d.signOffs?.notedBy?.printedName ?? ''),
        date: String(d.signOffs?.notedBy?.date ?? ''),
        signatureDataUrl: d.signOffs?.notedBy?.signatureDataUrl ?? null,
      },
    },
  };
}

/**
 * Loads all online photo proof records across the user's cloud reports for the Photo Vault.
 */
export async function loadAllUserPhotosOnline(
  uid: string,
  reportIds: string[]
): Promise<StoredPhotoRecord[]> {
  const results = await Promise.all(
    reportIds.map(async (reportId) => {
      const photosPath = `reports/${reportId}/photos`;
      try {
        const snap = await getDocs(
          query(collection(db, photosPath), where('ownerId', '==', uid))
        );
        return snap.docs.map((pDoc): StoredPhotoRecord => {
          const pd = pDoc.data();
          return {
            id: pDoc.id,
            reportId,
            storeLocation: String(pd.storeLocation ?? 'Untitled Store'),
            inspectionDate: String(pd.inspectionDate ?? ''),
            itemNumber: Number(pd.itemNumber ?? 1),
            sectionCode: String(pd.sectionCode ?? 'A'),
            sectionTitle: String(pd.sectionTitle ?? ''),
            itemText: String(pd.itemText ?? ''),
            complied: sanitizeComplied(pd.complied),
            deviation: String(pd.deviation ?? ''),
            caption: String(pd.caption ?? ''),
            capturedAt: String(pd.capturedAt ?? ''),
            fileName: String(pd.fileName ?? ''),
            dataUrl: String(pd.dataUrl ?? ''),
          };
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, photosPath);
      }
    })
  );

  return results
    .flat()
    .sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''));
}

/**
 * Deletes an online report and all of its photo subcollection documents.
 */
export function deleteReportOnline(
  uid: string,
  reportId: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  return enqueueReportWrite(safeReportId, async () => {
    const photosPath = `reports/${safeReportId}/photos`;
    try {
      const snap = await getDocs(
        query(collection(db, photosPath), where('ownerId', '==', uid))
      );
      for (const pDoc of snap.docs) {
        await deleteDoc(doc(db, photosPath, pDoc.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, photosPath);
    }

    const reportPath = `reports/${safeReportId}`;
    try {
      await deleteDoc(doc(db, 'reports', safeReportId));
      ensuredReportIds.delete(`${uid}:${safeReportId}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, reportPath);
    }
  });
}

/**
 * Deletes a single photo document from Firestore and updates the parent report's photoCount.
 */
export function deleteSinglePhotoOnline(
  uid: string,
  reportId: string,
  photoId: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const safePhotoId = sanitizeId(photoId, 'ph');
  return enqueueReportWrite(safeReportId, async () => {
    const photoPath = `reports/${safeReportId}/photos/${safePhotoId}`;
    try {
      await deleteDoc(doc(db, 'reports', safeReportId, 'photos', safePhotoId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, photoPath);
    }

    // Re-sync parent photoCount cleanly (best-effort)
    try {
      const reportSnap = await getDoc(doc(db, 'reports', safeReportId));
      if (reportSnap.exists()) {
        const photosSnap = await getDocs(
          query(
            collection(db, 'reports', safeReportId, 'photos'),
            where('ownerId', '==', uid)
          )
        );
        const currentStats = reportSnap.data().stats ?? {
          answered: 0,
          yes: 0,
          no: 0,
          na: 0,
          photoCount: 0,
        };
        await updateDoc(doc(db, 'reports', safeReportId), {
          stats: {
            answered: Number(currentStats.answered ?? 0),
            yes: Number(currentStats.yes ?? 0),
            no: Number(currentStats.no ?? 0),
            na: Number(currentStats.na ?? 0),
            photoCount: photosSnap.size,
          },
          updatedAt: serverTimestamp(),
        });
      }
    } catch (statsErr) {
      console.warn('Non-fatal delete photoCount sync warning:', statsErr);
    }
  });
}
