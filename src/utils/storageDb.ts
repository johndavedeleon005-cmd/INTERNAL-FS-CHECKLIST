import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  createBlankInspection,
  createEmptyResponse,
} from '../data/checklistData';
import type {
  InspectionReport,
  ItemResponse,
  SignOffEntry,
  SignOffRoleKey,
  StoredPhotoRecord,
} from '../types/inspection';

const DB_NAME = 'iqaf005_store_inspection_db';
const DB_VERSION = 2;
const STORE_DRAFTS = 'drafts';
const STORE_REPORTS = 'reports';
const STORE_PHOTOS = 'photos';
const STORE_SYNC_META = 'sync_meta';
const ACTIVE_DRAFT_KEY = 'active_draft';
const ACTIVE_SYNC_STATE_KEY = 'active_sync_state';

const LEGACY_DRAFT_KEY = 'iqaf005_active_draft_v1';
const LEGACY_HISTORY_KEY = 'iqaf005_saved_history_v1';

export interface ActiveDraftSyncState {
  reportId: string;
  hasUnsavedCloudChanges: boolean;
  lastSyncedAt: string | null;
  dirtyFull: boolean;
  dirtyMeta: boolean;
  dirtyItemNumbers: number[];
  dirtySignOffKeys: SignOffRoleKey[];
  dirtyPhotoIds: string[];
  updatedAt: string;
}

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
      const tx = request.transaction;

      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }

      let photoStore: IDBObjectStore | null = null;
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        photoStore = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      } else if (tx) {
        photoStore = tx.objectStore(STORE_PHOTOS);
      }
      if (photoStore && !photoStore.indexNames.contains('by_reportId')) {
        photoStore.createIndex('by_reportId', 'reportId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SYNC_META)) {
        db.createObjectStore(STORE_SYNC_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
  return dbPromise;
}

export function isLocalStorageQuotaError(err: unknown): boolean {
  if (!err) return false;
  const name =
    typeof err === 'object' && 'name' in err
      ? String((err as { name?: unknown }).name ?? '')
      : '';
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === 'QuotaExceededError' ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('storage full')
  );
}

function normalizeReport(
  raw: InspectionReport | null | undefined
): InspectionReport {
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
                      // Interrupted uploads from an earlier session resume cleanly as 'local'
                      // so BackgroundSync can automatically re-attempt without false error alerts.
                      uploadState: 'local' as const,
                      uploadError: undefined,
                      uploadErrorCode: undefined,
                    }
                  : ph
              )
            : [],
        }
      : createEmptyResponse();
  }
  const defaultDate = raw.meta.dateOfInspection || '';
  const normalizeSignOffEntry = (entry?: Partial<SignOffEntry>): SignOffEntry => ({
    printedName: entry?.printedName ?? '',
    date: entry?.date ?? defaultDate,
    signatureDataUrl: entry?.signatureDataUrl ?? null,
  });

  return {
    ...raw,
    meta: {
      ...raw.meta,
      timeOfInspectionEnded: raw.meta.timeOfInspectionEnded ?? '',
    },
    responses: normalizedResponses,
    signOffs: {
      performedBy: normalizeSignOffEntry(raw.signOffs?.performedBy),
      acknowledgedBy: normalizeSignOffEntry(raw.signOffs?.acknowledgedBy),
      notedBy: normalizeSignOffEntry(raw.signOffs?.notedBy),
      reviewedBy: normalizeSignOffEntry(raw.signOffs?.reviewedBy),
      approvedBy: normalizeSignOffEntry(raw.signOffs?.approvedBy),
    },
  };
}

export function extractPhotoRecordsFromReport(
  report: InspectionReport
): StoredPhotoRecord[] {
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

function collectPhotoIdsFromReport(report: InspectionReport | undefined): Set<string> {
  const ids = new Set<string>();
  if (!report?.responses) return ids;
  for (const resp of Object.values(report.responses)) {
    if (!resp?.photos) continue;
    for (const ph of resp.photos) {
      if (ph?.id) ids.add(ph.id);
    }
  }
  return ids;
}

function arePhotoRecordsEqual(a: StoredPhotoRecord, b: StoredPhotoRecord): boolean {
  return (
    a.reportId === b.reportId &&
    a.storeLocation === b.storeLocation &&
    a.inspectionDate === b.inspectionDate &&
    a.itemNumber === b.itemNumber &&
    a.sectionCode === b.sectionCode &&
    a.complied === b.complied &&
    a.deviation === b.deviation &&
    a.caption === b.caption &&
    a.capturedAt === b.capturedAt &&
    a.fileName === b.fileName &&
    a.dataUrl.length === b.dataUrl.length &&
    a.dataUrl === b.dataUrl
  );
}

function syncReportPhotosInTransaction(
  photoStore: IDBObjectStore,
  report: InspectionReport,
  preservePhotoIds: Set<string>
): void {
  const desired = extractPhotoRecordsFromReport(report);
  const desiredById = new Map(desired.map((rec) => [rec.id, rec]));

  const handleExistingList = (existingForReport: StoredPhotoRecord[]) => {
    const existingById = new Map(existingForReport.map((r) => [r.id, r]));

    for (const [id, nextRec] of desiredById) {
      const prevRec = existingById.get(id);
      if (!prevRec || !arePhotoRecordsEqual(prevRec, nextRec)) {
        photoStore.put(nextRec);
      }
    }

    for (const oldRec of existingForReport) {
      if (!desiredById.has(oldRec.id) && !preservePhotoIds.has(oldRec.id)) {
        photoStore.delete(oldRec.id);
      }
    }
  };

  if (photoStore.indexNames.contains('by_reportId')) {
    const idxReq = photoStore
      .index('by_reportId')
      .getAll(IDBKeyRange.only(report.id));
    idxReq.onsuccess = () => {
      handleExistingList((idxReq.result ?? []) as StoredPhotoRecord[]);
    };
    idxReq.onerror = () => {
      for (const rec of desired) photoStore.put(rec);
    };
  } else {
    for (const rec of desired) photoStore.put(rec);
  }
}

export async function loadActiveDraftFromDb(): Promise<InspectionReport> {
  try {
    const db = await openDatabase();
    const record = await new Promise<
      { key: string; report: InspectionReport } | undefined
    >((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readonly');
      const req = tx.objectStore(STORE_DRAFTS).get(ACTIVE_DRAFT_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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

export async function saveActiveDraftToDb(
  report: InspectionReport
): Promise<void> {
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [STORE_DRAFTS, STORE_REPORTS, STORE_PHOTOS],
      'readwrite'
    );
    const draftStore = tx.objectStore(STORE_DRAFTS);
    const reportStore = tx.objectStore(STORE_REPORTS);
    const photoStore = tx.objectStore(STORE_PHOTOS);

    draftStore.put({ key: ACTIVE_DRAFT_KEY, report });

    // Preserve any photos still referenced by the saved snapshot of the same reportId
    const snapReq = reportStore.get(report.id);
    snapReq.onsuccess = () => {
      const savedSnap = snapReq.result as InspectionReport | undefined;
      const preserveIds = collectPhotoIdsFromReport(savedSnap);
      syncReportPhotosInTransaction(photoStore, report, preserveIds);
    };
    snapReq.onerror = () => {
      syncReportPhotosInTransaction(photoStore, report, new Set());
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDraftSyncStateFromDb(): Promise<ActiveDraftSyncState | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<
      ({ key: string } & ActiveDraftSyncState) | undefined
    >((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_META, 'readonly');
      const req = tx.objectStore(STORE_SYNC_META).get(ACTIVE_SYNC_STATE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    return {
      reportId: record.reportId,
      hasUnsavedCloudChanges: Boolean(record.hasUnsavedCloudChanges),
      lastSyncedAt: record.lastSyncedAt ?? null,
      dirtyFull: Boolean(record.dirtyFull),
      dirtyMeta: Boolean(record.dirtyMeta),
      dirtyItemNumbers: Array.isArray(record.dirtyItemNumbers)
        ? record.dirtyItemNumbers
        : [],
      dirtySignOffKeys: Array.isArray(record.dirtySignOffKeys)
        ? record.dirtySignOffKeys
        : [],
      dirtyPhotoIds: Array.isArray(record.dirtyPhotoIds)
        ? record.dirtyPhotoIds
        : [],
      updatedAt: record.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveDraftSyncStateToDb(
  state: ActiveDraftSyncState
): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_META, 'readwrite');
      tx.objectStore(STORE_SYNC_META).put({
        key: ACTIVE_SYNC_STATE_KEY,
        ...state,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal fallback
  }
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
        const normalized = parsed.map((r: InspectionReport) =>
          normalizeReport(r)
        );
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

export async function saveReportSnapshotToDb(
  report: InspectionReport
): Promise<void> {
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [STORE_DRAFTS, STORE_REPORTS, STORE_PHOTOS],
      'readwrite'
    );
    const draftStore = tx.objectStore(STORE_DRAFTS);
    const reportStore = tx.objectStore(STORE_REPORTS);
    const photoStore = tx.objectStore(STORE_PHOTOS);

    reportStore.put(report);

    const draftReq = draftStore.get(ACTIVE_DRAFT_KEY);
    draftReq.onsuccess = () => {
      const draftRecord = draftReq.result as
        | { key: string; report?: InspectionReport }
        | undefined;
      const preserveIds =
        draftRecord?.report?.id === report.id
          ? collectPhotoIdsFromReport(draftRecord.report)
          : new Set<string>();
      syncReportPhotosInTransaction(photoStore, report, preserveIds);
    };
    draftReq.onerror = () => {
      syncReportPhotosInTransaction(photoStore, report, new Set());
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSavedReportFromDb(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [STORE_DRAFTS, STORE_REPORTS, STORE_PHOTOS],
      'readwrite'
    );
    const draftStore = tx.objectStore(STORE_DRAFTS);
    const reportStore = tx.objectStore(STORE_REPORTS);
    const photoStore = tx.objectStore(STORE_PHOTOS);

    reportStore.delete(id);

    // Clean up orphaned photos belonging to the deleted snapshot unless active draft uses them
    if (photoStore.indexNames.contains('by_reportId')) {
      const draftReq = draftStore.get(ACTIVE_DRAFT_KEY);
      draftReq.onsuccess = () => {
        const draftRecord = draftReq.result as
          | { key: string; report?: InspectionReport }
          | undefined;
        const preserveIds =
          draftRecord?.report?.id === id
            ? collectPhotoIdsFromReport(draftRecord.report)
            : new Set<string>();
        const idxReq = photoStore
          .index('by_reportId')
          .getAll(IDBKeyRange.only(id));
        idxReq.onsuccess = () => {
          const list = (idxReq.result ?? []) as StoredPhotoRecord[];
          for (const rec of list) {
            if (!preserveIds.has(rec.id)) {
              photoStore.delete(rec.id);
            }
          }
        };
      };
    }

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
