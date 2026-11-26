import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  createBlankInspection,
  createEmptyResponse,
} from '../data/checklistData';
import type {
  InspectionReport,
  ItemResponse,
  StoredPhotoRecord,
} from '../types/inspection';

const DB_NAME = 'iqaf005_store_inspection_db';
const DB_VERSION = 1;
const STORE_DRAFTS = 'drafts';
const STORE_REPORTS = 'reports';
const STORE_PHOTOS = 'photos';
const ACTIVE_DRAFT_KEY = 'active_draft';

const LEGACY_DRAFT_KEY = 'iqaf005_active_draft_v1';
const LEGACY_HISTORY_KEY = 'iqaf005_saved_history_v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

function normalizeReport(raw: InspectionReport | null | undefined): InspectionReport {
  if (!raw || !raw.meta || !raw.responses) {
    return createBlankInspection();
  }
  const normalizedResponses: Record<number, ItemResponse> = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    const existing = raw.responses[item.number];
    normalizedResponses[item.number] = existing
      ? {
          complied: existing.complied ?? '',
          deviation: existing.deviation ?? '',
          correctiveAction: existing.correctiveAction ?? '',
          photos: Array.isArray(existing.photos)
            ? existing.photos.map((ph) =>
                ph.uploadState === 'uploading'
                  ? {
                      ...ph,
                      uploadState: 'error' as const,
                      uploadError: 'Upload interrupted',
                    }
                  : ph
              )
            : [],
        }
      : createEmptyResponse();
  }
  return {
    ...raw,
    responses: normalizedResponses,
  };
}

function extractPhotoRecordsFromReport(report: InspectionReport): StoredPhotoRecord[] {
  const records: StoredPhotoRecord[] = [];
  for (const section of CHECKLIST_SECTIONS) {
    for (const item of section.items) {
      const resp = report.responses[item.number];
      if (!resp || !resp.photos.length) continue;
      for (const photo of resp.photos) {
        records.push({
          id: photo.id,
          reportId: report.id,
          storeLocation: report.meta.storeLocation || 'Untitled Store',
          inspectionDate: report.meta.dateOfInspection || '',
          itemNumber: item.number,
          sectionCode: section.code,
          sectionTitle: section.title,
          itemText: item.text,
          complied: resp.complied,
          deviation: resp.deviation,
          caption: photo.caption,
          capturedAt: photo.capturedAt,
          fileName: photo.fileName,
          dataUrl: photo.dataUrl,
        });
      }
    }
  }
  return records;
}

export async function loadActiveDraftFromDb(): Promise<InspectionReport> {
  try {
    const db = await openDatabase();
    const record = await new Promise<{ key: string; report: InspectionReport } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, 'readonly');
        const req = tx.objectStore(STORE_DRAFTS).get(ACTIVE_DRAFT_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }
    );
    if (record?.report) {
      return normalizeReport(record.report);
    }

    // Migrate legacy localStorage draft if present
    const legacyRaw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacyRaw) {
      const parsed = normalizeReport(JSON.parse(legacyRaw) as InspectionReport);
      await saveActiveDraftToDb(parsed);
      return parsed;
    }
    return createBlankInspection();
  } catch {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_DRAFT_KEY);
      if (legacyRaw) {
        return normalizeReport(JSON.parse(legacyRaw) as InspectionReport);
      }
    } catch {
      // ignore
    }
    return createBlankInspection();
  }
}

export async function saveActiveDraftToDb(report: InspectionReport): Promise<void> {
  const db = await openDatabase();
  const photos = extractPhotoRecordsFromReport(report);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_DRAFTS, STORE_PHOTOS], 'readwrite');
    tx.objectStore(STORE_DRAFTS).put({ key: ACTIVE_DRAFT_KEY, report });

    const photoStore = tx.objectStore(STORE_PHOTOS);
    for (const record of photos) {
      photoStore.put(record);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSavedReportsFromDb(): Promise<InspectionReport[]> {
  try {
    const db = await openDatabase();
    const records = await new Promise<InspectionReport[]>((resolve, reject) => {
      const tx = db.transaction(STORE_REPORTS, 'readonly');
      const req = tx.objectStore(STORE_REPORTS).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });

    if (records.length > 0) {
      return records
        .map((r) => normalizeReport(r))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }

    // Migrate legacy localStorage history if present
    const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map((r: InspectionReport) => normalizeReport(r));
        for (const r of normalized) {
          await saveReportSnapshotToDb(r);
        }
        return normalized;
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveReportSnapshotToDb(report: InspectionReport): Promise<void> {
  const db = await openDatabase();
  const photos = extractPhotoRecordsFromReport(report);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_REPORTS, STORE_PHOTOS], 'readwrite');
    tx.objectStore(STORE_REPORTS).put(report);
    const photoStore = tx.objectStore(STORE_PHOTOS);
    for (const record of photos) {
      photoStore.put(record);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSavedReportFromDb(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllStoredPhotosFromDb(): Promise<StoredPhotoRecord[]> {
  try {
    const db = await openDatabase();
    const records = await new Promise<StoredPhotoRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PHOTOS, 'readonly');
      const req = tx.objectStore(STORE_PHOTOS).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    return records.sort((a, b) =>
      (b.capturedAt || '').localeCompare(a.capturedAt || '')
    );
  } catch {
    return [];
  }
}

export async function upsertStoredPhotoInDb(
  record: StoredPhotoRecord
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteStoredPhotoFromDb(photoId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
