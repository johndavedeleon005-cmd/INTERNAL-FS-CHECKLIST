import {
  Timestamp,
  arrayRemove,
  arrayUnion,
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
  writeBatch,
} from 'firebase/firestore';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  FORM_DOCUMENTATION_NO,
  FORM_REVISION_NO,
  TOTAL_ITEMS_COUNT,
  createEmptyResponse,
  normalizeReportSequence,
} from '../data/checklistData';
import { OperationType, auth, db, handleFirestoreError } from '../firebase';
import type {
  ComplianceStatus,
  InspectionReport,
  ItemResponse,
  PhotoProof,
  ReportAccessRole,
  ReportCollaborationInfo,
  ShareLinkPreview,
  ShareLinkRole,
  SignOffRoleKey,
  StoredPhotoRecord,
} from '../types/inspection';
import {
  ensureSafePhotoDataUrl,
  ensureSafeSignatureDataUrl,
  MAX_FIRESTORE_PHOTO_DATAURL_CHARS,
} from './imageUtils';

export interface CloudReportSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  accessRole: ReportAccessRole;
  documentationNo: string;
  revisionNo: string;
  dateOfInspection: string;
  storeLocation: string;
  reportSequence?: number;
  timeOfInspection: string;
  timeOfInspectionEnded?: string;
  inspectedBy: string;
  stats: {
    answered: number;
    yes: number;
    no: number;
    na: number;
    photoCount: number;
  };
  photoIds: string[];
  sharedWithEmails: string[];
  editorEmails: string[];
  activeShareLinkId: string | null;
  activeShareRole: ShareLinkRole;
  syncVersion: number;
  lastEditedByUid: string;
  lastEditedByName: string;
  updatedAtIso: string;
  createdAtIso: string;
}

export interface ReportDirtyDelta {
  full: boolean;
  meta: boolean;
  itemNumbers: number[];
  signOffKeys: SignOffRoleKey[];
  photoIds?: string[];
}

export interface LoadedCloudReport {
  report: InspectionReport;
  collaboration: ReportCollaborationInfo;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_COLLABORATORS = 25;
const MAX_PHOTO_IDS = 250;

// Per-report async queue to prevent concurrent Master Gate / stats / version race conditions
const reportWriteQueues = new Map<string, Promise<unknown>>();
// Cache of `${uid}:${reportId}` -> confirmed server ownerId for reports verified to exist online
const ensuredReportIds = new Map<string, string>();

// Session circuit-breaker when Firebase Spark free-tier daily quota is exhausted
let firestoreQuotaExhausted = false;
const serverCloudListeners = new Set<() => void>();

export function isQuotaExceededError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '').toLowerCase();
  const msg = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    code === 'resource-exhausted' ||
    code === 'storage/quota-exceeded' ||
    msg.includes('quota limit exceeded') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource-exhausted')
  );
}

function markFirestoreQuotaExhausted(): void {
  if (!firestoreQuotaExhausted) {
    firestoreQuotaExhausted = true;
    console.info(
      '[CloudSync] Firestore daily quota reached — switched online sync to server cloud database (/api/cloud).'
    );
  }
  notifyServerCloudListeners();
}

function notifyServerCloudListeners(): void {
  for (const listener of Array.from(serverCloudListeners)) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

async function serverFetchAllReports(): Promise<
  Array<{ id: string; data: Record<string, unknown> }>
> {
  try {
    const res = await fetch('/api/cloud/reports');
    if (!res.ok) return [];
    const json = (await res.json()) as {
      reports?: Array<{ id: string; data: Record<string, unknown> }>;
    };
    return Array.isArray(json.reports) ? json.reports : [];
  } catch {
    return [];
  }
}

async function serverFetchSingleReport(reportId: string): Promise<{
  exists: boolean;
  id: string;
  data: Record<string, unknown> | null;
  photos: Array<{ id: string; data: Record<string, unknown> }>;
}> {
  try {
    const res = await fetch(
      `/api/cloud/reports/${encodeURIComponent(reportId)}`
    );
    if (!res.ok) {
      return { exists: false, id: reportId, data: null, photos: [] };
    }
    const json = (await res.json()) as {
      exists?: boolean;
      id?: string;
      data?: Record<string, unknown> | null;
      photos?: Array<{ id: string; data: Record<string, unknown> }>;
    };
    return {
      exists: Boolean(json.exists && json.data),
      id: json.id || reportId,
      data: json.data ?? null,
      photos: Array.isArray(json.photos) ? json.photos : [],
    };
  } catch {
    return { exists: false, id: reportId, data: null, photos: [] };
  }
}

async function serverUpsertReport(
  reportId: string,
  payload: {
    data: Record<string, unknown>;
    merge?: boolean;
    unionPhotoIds?: string[];
    removePhotoIds?: string[];
    unionSharedWithEmails?: string[];
    removeSharedWithEmails?: string[];
    unionEditorEmails?: string[];
    removeEditorEmails?: string[];
  }
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/cloud/reports/${encodeURIComponent(reportId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (res.ok) {
      notifyServerCloudListeners();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function serverDeleteReport(reportId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/cloud/reports/${encodeURIComponent(reportId)}`,
      {
        method: 'DELETE',
      }
    );
    if (res.ok) {
      notifyServerCloudListeners();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function serverUpsertPhotos(
  reportId: string,
  photos: Array<{ id: string; data: Record<string, unknown> }>
): Promise<boolean> {
  if (photos.length === 0) return true;
  try {
    const res = await fetch(
      `/api/cloud/reports/${encodeURIComponent(reportId)}/photos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos }),
      }
    );
    if (res.ok) {
      notifyServerCloudListeners();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function serverDeletePhotos(
  reportId: string,
  photoIds: string[]
): Promise<boolean> {
  if (photoIds.length === 0) return true;
  try {
    const res = await fetch(
      `/api/cloud/reports/${encodeURIComponent(reportId)}/photos`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }),
      }
    );
    if (res.ok) {
      notifyServerCloudListeners();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function serverFetchPhotosForReports(
  reportIds: string[]
): Promise<
  Array<{ id: string; reportId: string; data: Record<string, unknown> }>
> {
  if (reportIds.length === 0) return [];
  try {
    const queryStr = reportIds.map(encodeURIComponent).join(',');
    const res = await fetch(`/api/cloud/photos?reportIds=${queryStr}`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      photos?: Array<{
        id: string;
        reportId: string;
        data: Record<string, unknown>;
      }>;
    };
    return Array.isArray(json.photos) ? json.photos : [];
  } catch {
    return [];
  }
}

async function serverGetShareLink(
  shareId: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `/api/cloud/share-links/${encodeURIComponent(shareId)}`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      exists?: boolean;
      data?: Record<string, unknown> | null;
    };
    return json.exists && json.data ? json.data : null;
  } catch {
    return null;
  }
}

async function serverUpsertShareLink(
  shareId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/cloud/share-links/${encodeURIComponent(shareId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function clearCloudReportCache(): void {
  ensuredReportIds.clear();
}

export function markReportEnsuredOnline(
  uid: string,
  reportId: string,
  ownerId?: string
): void {
  ensuredReportIds.set(`${uid}:${sanitizeId(reportId, 'insp')}`, ownerId || uid);
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '').toLowerCase();
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    code === 'permission-denied' ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  );
}

async function refreshAuthTokenSafely(): Promise<void> {
  try {
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true);
    }
  } catch {
    // Ignore transient token refresh failures
  }
}

function withFirestoreTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 25000,
  operationLabel = 'Database operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(
        `${operationLabel} timed out (deadline-exceeded). Please check your connection and retry.`
      ) as Error & { code?: string };
      err.code = 'deadline-exceeded';
      reject(err);
    }, timeoutMs);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

function clampSyncVersion(val: number): number {
  if (!Number.isFinite(val) || val < 1) return 1;
  return Math.min(1000000, Math.floor(val));
}

function parseOptionalSequence(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 1) {
    return undefined;
  }
  return Math.min(99999, Math.floor(val));
}

export function sanitizeId(raw: string, prefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  if (VALID_ID_REGEX.test(cleaned)) return cleaned;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateSecureShareId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      token += alphabet[bytes[i] % alphabet.length];
    }
  } else {
    for (let i = 0; i < 24; i++) {
      token += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return `shr-${token}`;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmailAddress(raw: string): boolean {
  const normalized = normalizeEmail(raw);
  return (
    normalized.length >= 3 &&
    normalized.length <= 254 &&
    SIMPLE_EMAIL_REGEX.test(normalized)
  );
}

function sanitizeEmailList(list: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of list) {
    const email = normalizeEmail(raw);
    if (isValidEmailAddress(email)) {
      unique.add(email);
    }
    if (unique.size >= MAX_COLLABORATORS) break;
  }
  return Array.from(unique);
}

function sanitizePhotoIdList(ids: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of ids) {
    if (typeof raw === 'string' && VALID_ID_REGEX.test(raw)) {
      unique.add(raw);
    }
    if (unique.size >= MAX_PHOTO_IDS) break;
  }
  return Array.from(unique);
}

function collectReportPhotoIds(report: InspectionReport): string[] {
  const ids: string[] = [];
  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number];
    if (!r) continue;
    for (const ph of r.photos) {
      ids.push(sanitizeId(ph.id, 'ph'));
    }
  }
  return sanitizePhotoIdList(ids);
}

function collectSyncedReportPhotoIds(report: InspectionReport): string[] {
  const ids: string[] = [];
  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number];
    if (!r) continue;
    for (const ph of r.photos) {
      if (ph.uploadState === 'synced') {
        ids.push(sanitizeId(ph.id, 'ph'));
      }
    }
  }
  return sanitizePhotoIdList(ids);
}

function sanitizeComplied(val: unknown): ComplianceStatus {
  if (val === 'Yes' || val === 'No' || val === 'N/A') return val;
  return '';
}

function sanitizeShareRole(val: unknown): ShareLinkRole {
  if (val === 'viewer' || val === 'editor') return val;
  return 'none';
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
    answered: Math.max(0, Math.min(TOTAL_ITEMS_COUNT, Math.trunc(answered))),
    yes: Math.max(0, Math.min(TOTAL_ITEMS_COUNT, Math.trunc(yes))),
    no: Math.max(0, Math.min(TOTAL_ITEMS_COUNT, Math.trunc(no))),
    na: Math.max(0, Math.min(TOTAL_ITEMS_COUNT, Math.trunc(na))),
    photoCount: Math.max(
      0,
      Math.min(500, Math.trunc(overridePhotoCount ?? photoCount))
    ),
  };
}

function buildSingleResponsePayload(r: ItemResponse) {
  return {
    complied: sanitizeComplied(r.complied),
    deviation: clampString(r.deviation, 2000),
    correctiveAction: clampString(r.correctiveAction, 2000),
  };
}

function buildReportResponsesPayload(report: InspectionReport) {
  const map: Record<
    string,
    { complied: ComplianceStatus; deviation: string; correctiveAction: string }
  > = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number] ?? createEmptyResponse();
    map[String(item.number)] = buildSingleResponsePayload(r);
  }
  return map;
}

async function buildSingleSignOffPayloadAsync(
  entry: InspectionReport['signOffs']['performedBy'] | undefined
) {
  const safeSignature = await ensureSafeSignatureDataUrl(
    entry?.signatureDataUrl ?? null
  );
  return {
    printedName: clampString(entry?.printedName ?? '', 160),
    date: clampString(entry?.date ?? '', 20),
    signatureDataUrl: safeSignature,
  };
}

async function buildSignOffsPayloadAsync(report: InspectionReport) {
  const [performedBy, acknowledgedBy, notedBy, reviewedBy, approvedBy] =
    await Promise.all([
      buildSingleSignOffPayloadAsync(report.signOffs.performedBy),
      buildSingleSignOffPayloadAsync(report.signOffs.acknowledgedBy),
      buildSingleSignOffPayloadAsync(report.signOffs.notedBy),
      buildSingleSignOffPayloadAsync(report.signOffs.reviewedBy),
      buildSingleSignOffPayloadAsync(report.signOffs.approvedBy),
    ]);
  return { performedBy, acknowledgedBy, notedBy, reviewedBy, approvedBy };
}

async function buildCommonReportFieldsAsync(
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
    reportSequence: normalizeReportSequence(report.meta.reportSequence),
    timeOfInspection: clampString(report.meta.timeOfInspection, 20),
    timeOfInspectionEnded: clampString(report.meta.timeOfInspectionEnded ?? '', 20),
    inspectedBy: clampString(report.meta.inspectedBy, 160),
    responses: buildReportResponsesPayload(report),
    signOffs: await buildSignOffsPayloadAsync(report),
    stats: computeStats(report, overridePhotoCount),
  };
}

function resolveAccessRole(
  ownerId: string,
  sharedWithEmails: string[],
  editorEmails: string[],
  uid: string,
  userEmail?: string | null
): ReportAccessRole {
  if (!ownerId || ownerId === uid) return 'owner';
  const lower = userEmail ? normalizeEmail(userEmail) : '';
  if (lower && sharedWithEmails.includes(lower) && !editorEmails.includes(lower)) {
    return 'viewer';
  }
  return 'editor';
}

function mapDocToSummary(
  id: string,
  d: Record<string, unknown>,
  uid: string,
  userEmail?: string | null
): CloudReportSummary {
  const ownerId = String(d.ownerId ?? uid);
  const sharedWithEmails = Array.isArray(d.sharedWithEmails)
    ? sanitizeEmailList(d.sharedWithEmails.map(String))
    : [];
  const editorEmails = Array.isArray(d.editorEmails)
    ? sanitizeEmailList(d.editorEmails.map(String))
    : [];
  const photoIds = Array.isArray(d.photoIds)
    ? sanitizePhotoIdList(d.photoIds.map(String))
    : [];
  const statsRaw = (d.stats ?? {}) as Record<string, unknown>;

  return {
    id,
    ownerId,
    ownerName: String(d.ownerName ?? d.inspectedBy ?? 'Inspector'),
    accessRole: resolveAccessRole(
      ownerId,
      sharedWithEmails,
      editorEmails,
      uid,
      userEmail
    ),
    documentationNo: String(d.documentationNo ?? FORM_DOCUMENTATION_NO),
    revisionNo: String(d.revisionNo ?? FORM_REVISION_NO),
    dateOfInspection: String(d.dateOfInspection ?? ''),
    storeLocation: String(d.storeLocation ?? ''),
    reportSequence: parseOptionalSequence(d.reportSequence),
    timeOfInspection: String(d.timeOfInspection ?? ''),
    timeOfInspectionEnded: String(d.timeOfInspectionEnded ?? ''),
    inspectedBy: String(d.inspectedBy ?? ''),
    stats: {
      answered: Number(statsRaw.answered ?? 0),
      yes: Number(statsRaw.yes ?? 0),
      no: Number(statsRaw.no ?? 0),
      na: Number(statsRaw.na ?? 0),
      photoCount: Number(statsRaw.photoCount ?? 0),
    },
    photoIds,
    sharedWithEmails,
    editorEmails,
    activeShareLinkId:
      typeof d.activeShareLinkId === 'string' && d.activeShareLinkId
        ? d.activeShareLinkId
        : null,
    activeShareRole: sanitizeShareRole(d.activeShareRole),
    syncVersion: clampSyncVersion(Number(d.syncVersion ?? 1)),
    lastEditedByUid: String(d.lastEditedByUid ?? ownerId),
    lastEditedByName: String(d.lastEditedByName ?? d.ownerName ?? d.inspectedBy ?? ''),
    createdAtIso: toIsoString(d.createdAt ?? d.updatedAt),
    updatedAtIso: toIsoString(d.updatedAt ?? d.createdAt),
  };
}

function mapDocToCollaboration(
  d: Record<string, unknown>,
  uid: string,
  userEmail?: string | null
): ReportCollaborationInfo {
  const ownerId = String(d.ownerId ?? uid);
  const sharedWithEmails = Array.isArray(d.sharedWithEmails)
    ? sanitizeEmailList(d.sharedWithEmails.map(String))
    : [];
  const editorEmails = Array.isArray(d.editorEmails)
    ? sanitizeEmailList(d.editorEmails.map(String))
    : [];
  const photoIds = Array.isArray(d.photoIds)
    ? sanitizePhotoIdList(d.photoIds.map(String))
    : [];
  return {
    ownerId,
    ownerName: String(d.ownerName ?? d.inspectedBy ?? 'Inspector'),
    accessRole: resolveAccessRole(
      ownerId,
      sharedWithEmails,
      editorEmails,
      uid,
      userEmail
    ),
    sharedWithEmails,
    editorEmails,
    activeShareLinkId:
      typeof d.activeShareLinkId === 'string' && d.activeShareLinkId
        ? d.activeShareLinkId
        : null,
    activeShareRole: sanitizeShareRole(d.activeShareRole),
    syncVersion: clampSyncVersion(Number(d.syncVersion ?? 1)),
    lastEditedByUid: String(d.lastEditedByUid ?? ownerId),
    lastEditedByName: String(d.lastEditedByName ?? d.ownerName ?? ''),
    photoIds,
  };
}

/**
 * Subscribe in real time to all inspection reports in the database.
 * Transparently merges and fails over to `/api/cloud/reports` if Firestore quota is exhausted.
 */
export function subscribeToUserReports(
  uid: string,
  userEmail: string | null | undefined,
  onChange: (reports: CloudReportSummary[]) => void,
  onError?: (err: Error) => void
): () => void {
  let cancelled = false;
  let firestoreDocs = new Map<string, CloudReportSummary>();
  let serverDocs = new Map<string, CloudReportSummary>();
  let unsubFirestore: (() => void) | null = null;

  const emitMerged = () => {
    if (cancelled) return;
    const combined = new Map<string, CloudReportSummary>();
    for (const [id, item] of firestoreDocs.entries()) {
      combined.set(id, item);
    }
    for (const [id, sItem] of serverDocs.entries()) {
      const existing = combined.get(id);
      if (!existing || sItem.updatedAtIso >= existing.updatedAtIso) {
        combined.set(id, sItem);
      }
    }
    const list = Array.from(combined.values());
    list.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
    onChange(list);
  };

  const refreshFromServer = async () => {
    if (cancelled) return;
    const rawList = await serverFetchAllReports();
    if (cancelled) return;
    const nextServer = new Map<string, CloudReportSummary>();
    for (const entry of rawList) {
      if (!entry || !entry.id || !entry.data) continue;
      nextServer.set(
        entry.id,
        mapDocToSummary(entry.id, entry.data, uid, userEmail)
      );
    }
    serverDocs = nextServer;
    emitMerged();
  };

  const serverListener = () => {
    void refreshFromServer();
  };
  serverCloudListeners.add(serverListener);
  void refreshFromServer();

  const pollInterval = setInterval(() => {
    if (firestoreQuotaExhausted) {
      void refreshFromServer();
    }
  }, 6000);

  if (!firestoreQuotaExhausted) {
    const path = 'reports';
    const colRef = collection(db, path);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        if (cancelled) return;
        const nextFs = new Map<string, CloudReportSummary>();
        for (const docSnap of snapshot.docs) {
          nextFs.set(
            docSnap.id,
            mapDocToSummary(
              docSnap.id,
              docSnap.data() as Record<string, unknown>,
              uid,
              userEmail
            )
          );
        }
        firestoreDocs = nextFs;
        emitMerged();
      },
      (error) => {
        if (unsubFirestore) {
          try {
            unsubFirestore();
          } catch {
            // ignore
          }
          unsubFirestore = null;
        }
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
          void refreshFromServer();
          return;
        }
        void refreshFromServer();
        console.warn('[CloudReports] Firestore listener fallback active:', error);
        if (onError && !isQuotaExceededError(error)) {
          // Do not surface quota errors since server cloud store handles sync seamlessly
        }
      }
    );
  }

  return () => {
    cancelled = true;
    clearInterval(pollInterval);
    serverCloudListeners.delete(serverListener);
    if (unsubFirestore) {
      try {
        unsubFirestore();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Subscribe in real time to all inspection reports shared WITH the signed-in user.
 */
export function subscribeToSharedReports(
  uid: string,
  userEmail: string,
  onChange: (reports: CloudReportSummary[]) => void,
  _onError?: (err: Error) => void
): () => void {
  const lowerEmail = normalizeEmail(userEmail);
  if (!isValidEmailAddress(lowerEmail)) {
    onChange([]);
    return () => {};
  }

  let cancelled = false;
  let firestoreDocs = new Map<string, CloudReportSummary>();
  let serverDocs = new Map<string, CloudReportSummary>();
  let unsubFirestore: (() => void) | null = null;

  const emitMerged = () => {
    if (cancelled) return;
    const combined = new Map<string, CloudReportSummary>();
    for (const [id, item] of firestoreDocs.entries()) {
      combined.set(id, item);
    }
    for (const [id, sItem] of serverDocs.entries()) {
      const existing = combined.get(id);
      if (!existing || sItem.updatedAtIso >= existing.updatedAtIso) {
        combined.set(id, sItem);
      }
    }
    const list = Array.from(combined.values()).filter((r) => r.ownerId !== uid);
    list.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
    onChange(list);
  };

  const refreshFromServer = async () => {
    if (cancelled) return;
    const rawList = await serverFetchAllReports();
    if (cancelled) return;
    const nextServer = new Map<string, CloudReportSummary>();
    for (const entry of rawList) {
      if (!entry || !entry.id || !entry.data) continue;
      const summary = mapDocToSummary(entry.id, entry.data, uid, lowerEmail);
      if (
        summary.ownerId !== uid &&
        summary.sharedWithEmails.includes(lowerEmail)
      ) {
        nextServer.set(entry.id, summary);
      }
    }
    serverDocs = nextServer;
    emitMerged();
  };

  const serverListener = () => {
    void refreshFromServer();
  };
  serverCloudListeners.add(serverListener);
  void refreshFromServer();

  if (!firestoreQuotaExhausted) {
    const path = 'reports';
    const q = query(
      collection(db, path),
      where('sharedWithEmails', 'array-contains', lowerEmail)
    );

    unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        if (cancelled) return;
        const nextFs = new Map<string, CloudReportSummary>();
        for (const docSnap of snapshot.docs) {
          const summary = mapDocToSummary(
            docSnap.id,
            docSnap.data() as Record<string, unknown>,
            uid,
            lowerEmail
          );
          if (summary.ownerId !== uid) {
            nextFs.set(docSnap.id, summary);
          }
        }
        firestoreDocs = nextFs;
        emitMerged();
      },
      (error) => {
        if (unsubFirestore) {
          try {
            unsubFirestore();
          } catch {
            // ignore
          }
          unsubFirestore = null;
        }
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        }
        void refreshFromServer();
      }
    );
  }

  return () => {
    cancelled = true;
    serverCloudListeners.delete(serverListener);
    if (unsubFirestore) {
      try {
        unsubFirestore();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Real-time listener on the currently open cloud report for live multi-device / collaborator sync
 * and optimistic conflict detection.
 */
export function subscribeToActiveReport(
  reportId: string,
  uid: string,
  userEmail: string | null | undefined,
  onUpdate: (payload: {
    summary: CloudReportSummary;
    collaboration: ReportCollaborationInfo;
    rawData: Record<string, unknown>;
    hasPendingWrites: boolean;
  }) => void,
  onMissing?: () => void
): () => void {
  const safeReportId = sanitizeId(reportId, 'insp');
  let cancelled = false;
  let unsubFirestore: (() => void) | null = null;

  const refreshFromServer = async () => {
    if (cancelled) return;
    const res = await serverFetchSingleReport(safeReportId);
    if (cancelled || !res.exists || !res.data) return;
    const summary = mapDocToSummary(safeReportId, res.data, uid, userEmail);
    const collaboration = mapDocToCollaboration(res.data, uid, userEmail);
    onUpdate({
      summary,
      collaboration,
      rawData: res.data,
      hasPendingWrites: false,
    });
  };

  const serverListener = () => {
    void refreshFromServer();
  };
  serverCloudListeners.add(serverListener);

  if (firestoreQuotaExhausted) {
    void refreshFromServer();
  } else {
    const reportRef = doc(db, 'reports', safeReportId);
    unsubFirestore = onSnapshot(
      reportRef,
      (snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          void serverFetchSingleReport(safeReportId).then((res) => {
            if (cancelled) return;
            if (res.exists && res.data) {
              const summary = mapDocToSummary(
                safeReportId,
                res.data,
                uid,
                userEmail
              );
              const collaboration = mapDocToCollaboration(
                res.data,
                uid,
                userEmail
              );
              onUpdate({
                summary,
                collaboration,
                rawData: res.data,
                hasPendingWrites: false,
              });
            } else {
              onMissing?.();
            }
          });
          return;
        }
        const rawData = snap.data() as Record<string, unknown>;
        const summary = mapDocToSummary(snap.id, rawData, uid, userEmail);
        const collaboration = mapDocToCollaboration(rawData, uid, userEmail);
        onUpdate({
          summary,
          collaboration,
          rawData,
          hasPendingWrites: snap.metadata.hasPendingWrites,
        });
      },
      (error) => {
        if (unsubFirestore) {
          try {
            unsubFirestore();
          } catch {
            // ignore
          }
          unsubFirestore = null;
        }
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        }
        void refreshFromServer();
      }
    );
  }

  return () => {
    cancelled = true;
    serverCloudListeners.delete(serverListener);
    if (unsubFirestore) {
      try {
        unsubFirestore();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Immediately uploads a single photo proof to Firestore (and mirrors/fails over to `/api/cloud/*`
 * if Firestore's daily quota is exhausted).
 */
export function uploadSinglePhotoImmediatelyOnline(
  uid: string,
  report: InspectionReport,
  itemNumber: number,
  photo: PhotoProof,
  options?: {
    reportOwnerId?: string;
    actorName?: string;
  }
): Promise<{
  reportId: string;
  photoId: string;
  safeDataUrl: string;
  storedRecord: StoredPhotoRecord;
}> {
  const safeReportId = sanitizeId(report.id, 'insp');
  const expectedOwnerId = options?.reportOwnerId || uid;
  const actorName = clampString(
    options?.actorName || report.meta.inspectedBy || 'Inspector',
    160
  );

  return enqueueReportWrite(safeReportId, async () => {
    const startMs = Date.now();
    const safeItemNumber = Math.min(
      TOTAL_ITEMS_COUNT,
      Math.max(1, Math.trunc(Number(itemNumber) || 1))
    );
    const safeDataUrl = await ensureSafePhotoDataUrl(photo.dataUrl, { hd: true });
    if (!safeDataUrl || safeDataUrl.length > MAX_FIRESTORE_PHOTO_DATAURL_CHARS) {
      console.error('[PhotoUpload] Payload rejected before write', {
        reportId: safeReportId,
        photoId: photo.id,
        itemNumber: safeItemNumber,
        payloadChars: safeDataUrl?.length ?? 0,
      });
      throw new Error('Photo exceeds the maximum 920 KB HD storage limit.');
    }

    let sectionCode = 'A';
    let sectionTitle = '';
    let itemText = '';
    for (const sec of CHECKLIST_SECTIONS) {
      const found = sec.items.find((it) => it.number === safeItemNumber);
      if (found) {
        sectionCode = sec.code;
        sectionTitle = sec.title;
        itemText = found.text;
        break;
      }
    }

    const activeReportId = safeReportId;
    const cacheKey = `${uid}:${activeReportId}`;
    const resolvedOwnerId = ensuredReportIds.get(cacheKey) || expectedOwnerId;
    const safePhotoId = sanitizeId(photo.id, 'ph');

    const syncedIds = sanitizePhotoIdList([
      ...collectSyncedReportPhotoIds(report),
      safePhotoId,
    ]);

    // Ensure parent report exists
    if (!ensuredReportIds.has(cacheKey)) {
      const reportPath = `reports/${activeReportId}`;
      const targetRef = doc(db, 'reports', activeReportId);
      const initialFields = await buildCommonReportFieldsAsync(
        report,
        syncedIds.length
      );
      await serverUpsertReport(activeReportId, {
        data: {
          ownerId: resolvedOwnerId,
          ownerName: actorName,
          ...initialFields,
          syncVersion: 1,
          lastEditedByUid: uid,
          lastEditedByName: actorName,
        },
        merge: true,
        unionPhotoIds: syncedIds,
      });

      if (!firestoreQuotaExhausted) {
        const buildParentMergePayload = () => ({
          ownerId: resolvedOwnerId,
          ownerName: actorName,
          ...initialFields,
          photoIds: arrayUnion(...syncedIds),
          syncVersion: 1,
          lastEditedByUid: uid,
          lastEditedByName: actorName,
          updatedAt: serverTimestamp(),
        });
        try {
          await withFirestoreTimeout(
            setDoc(targetRef, buildParentMergePayload(), { merge: true }),
            25000,
            'Parent report save'
          );
        } catch (err) {
          if (isQuotaExceededError(err)) {
            markFirestoreQuotaExhausted();
          } else if (isPermissionDeniedError(err)) {
            await refreshAuthTokenSafely();
            try {
              await withFirestoreTimeout(
                setDoc(targetRef, buildParentMergePayload(), { merge: true }),
                25000,
                'Parent report save retry'
              );
            } catch (retryErr) {
              if (isQuotaExceededError(retryErr)) {
                markFirestoreQuotaExhausted();
              } else {
                handleFirestoreError(retryErr, OperationType.WRITE, reportPath);
              }
            }
          } else {
            handleFirestoreError(err, OperationType.WRITE, reportPath);
          }
        }
      }
      ensuredReportIds.set(cacheKey, resolvedOwnerId);
    }

    const resp = report.responses[safeItemNumber] ?? createEmptyResponse();
    const storeLocation = clampString(report.meta.storeLocation, 200);
    const inspectionDate = clampString(report.meta.dateOfInspection, 20);
    const capturedAt = clampString(
      photo.capturedAt || new Date().toISOString(),
      40
    );
    const fileName = clampString(
      photo.fileName || `item-${safeItemNumber}.jpg`,
      200
    );
    const caption = clampString(photo.caption, 500);
    const complied = sanitizeComplied(resp.complied);
    const deviation = clampString(resp.deviation, 2000);

    const plainPhotoData: Record<string, unknown> = {
      ownerId: resolvedOwnerId,
      uploadedByUid: uid,
      reportId: activeReportId,
      itemNumber: safeItemNumber,
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
    };

    const serverPhotoSaved = await serverUpsertPhotos(activeReportId, [
      { id: safePhotoId, data: plainPhotoData },
    ]);

    const colPath = `reports/${activeReportId}/photos`;
    const photoPath = `${colPath}/${safePhotoId}`;
    const photoRef = doc(db, colPath, safePhotoId);

    if (!firestoreQuotaExhausted) {
      const buildPhotoPayload = () => ({
        ...plainPhotoData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      console.info('[PhotoUpload] Writing photo document', {
        photoPath,
        itemNumber: safeItemNumber,
        payloadChars: safeDataUrl.length,
      });
      try {
        await withFirestoreTimeout(
          setDoc(photoRef, buildPhotoPayload(), { merge: true }),
          25000,
          'Photo upload'
        );
      } catch (firstErr) {
        if (isQuotaExceededError(firstErr)) {
          markFirestoreQuotaExhausted();
          if (!serverPhotoSaved) {
            await serverUpsertPhotos(activeReportId, [
              { id: safePhotoId, data: plainPhotoData },
            ]);
          }
        } else {
          if (isPermissionDeniedError(firstErr)) {
            await refreshAuthTokenSafely();
          }
          try {
            await withFirestoreTimeout(
              setDoc(photoRef, buildPhotoPayload(), { merge: true }),
              25000,
              'Photo upload retry'
            );
          } catch (retryErr) {
            if (isQuotaExceededError(retryErr)) {
              markFirestoreQuotaExhausted();
            } else if (!serverPhotoSaved) {
              handleFirestoreError(retryErr, OperationType.WRITE, photoPath);
            }
          }
        }
      }
    }

    const liveStats = computeStats(report);
    await serverUpsertReport(activeReportId, {
      data: {
        stats: liveStats,
        lastEditedByUid: uid,
        lastEditedByName: actorName,
      },
      merge: true,
      unionPhotoIds: [safePhotoId],
    });

    if (!firestoreQuotaExhausted) {
      try {
        const activeReportRef = doc(db, 'reports', activeReportId);
        await withFirestoreTimeout(
          setDoc(
            activeReportRef,
            {
              stats: liveStats,
              photoIds: arrayUnion(safePhotoId),
              lastEditedByUid: uid,
              lastEditedByName: actorName,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ),
          15000,
          'Photo index update'
        );
      } catch (statsErr) {
        if (isQuotaExceededError(statsErr)) {
          markFirestoreQuotaExhausted();
        } else {
          console.warn(
            '[PhotoUpload] Non-fatal photoCount/index sync warning:',
            statsErr
          );
        }
      }
    }

    console.info('[PhotoUpload] Completed online photo upload', {
      photoPath,
      itemNumber: safeItemNumber,
      elapsedMs: Date.now() - startMs,
    });

    const storedRecord: StoredPhotoRecord = {
      id: safePhotoId,
      reportId: activeReportId,
      storeLocation: storeLocation || 'Untitled Store',
      inspectionDate,
      itemNumber: safeItemNumber,
      sectionCode,
      sectionTitle,
      itemText,
      complied,
      deviation,
      caption,
      capturedAt,
      fileName,
      dataUrl: safeDataUrl,
    };

    return {
      reportId: activeReportId,
      photoId: safePhotoId,
      safeDataUrl,
      storedRecord,
    };
  });
}

/**
 * Updates a synced photo's caption directly in Firestore and `/api/cloud/*`.
 */
export function updatePhotoCaptionOnline(
  reportId: string,
  photoId: string,
  caption: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const safePhotoId = sanitizeId(photoId, 'ph');
  return enqueueReportWrite(safeReportId, async () => {
    const cleanCaption = clampString(caption, 500);
    const serverSaved = await serverUpsertPhotos(safeReportId, [
      { id: safePhotoId, data: { caption: cleanCaption } },
    ]);
    if (firestoreQuotaExhausted) return;

    const photoPath = `reports/${safeReportId}/photos/${safePhotoId}`;
    try {
      await withFirestoreTimeout(
        setDoc(
          doc(db, 'reports', safeReportId, 'photos', safePhotoId),
          {
            caption: cleanCaption,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        15000,
        'Update photo caption'
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
        return;
      }
      if (!serverSaved) {
        handleFirestoreError(error, OperationType.UPDATE, photoPath);
      }
    }
  });
}

/**
 * Batch-updates photo captions for multiple photos within the same report.
 */
export function updatePhotosCaptionBatchOnline(
  reportId: string,
  updates: Array<{ photoId: string; caption: string }>
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  if (updates.length === 0) return Promise.resolve();
  return enqueueReportWrite(safeReportId, async () => {
    const serverSaved = await serverUpsertPhotos(
      safeReportId,
      updates.map((u) => ({
        id: sanitizeId(u.photoId, 'ph'),
        data: { caption: clampString(u.caption, 500) },
      }))
    );
    if (firestoreQuotaExhausted) return;

    const photosPath = `reports/${safeReportId}/photos`;
    const CHUNK_SIZE = 200;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const safePhotoId = sanitizeId(entry.photoId, 'ph');
        batch.set(
          doc(db, photosPath, safePhotoId),
          {
            caption: clampString(entry.caption, 500),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      try {
        await withFirestoreTimeout(batch.commit(), 20000, 'Batch update captions');
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
          return;
        }
        if (!serverSaved) {
          handleFirestoreError(error, OperationType.UPDATE, photosPath);
        }
      }
    }
  });
}

async function syncDirtyPhotoMetadataForReport(
  safeReportId: string,
  report: InspectionReport,
  dirty: ReportDirtyDelta | undefined
): Promise<void> {
  if (!dirty) return;
  const dirtyPhotoIdSet = new Set(dirty.photoIds ?? []);
  const dirtyItemSet = new Set(dirty.itemNumbers ?? []);
  const shouldSyncAllSynced = dirty.full || dirty.meta;

  const updates: Array<{
    photoId: string;
    plainData: Record<string, unknown>;
    fsData: Record<string, unknown>;
  }> = [];

  const storeLocation = clampString(report.meta.storeLocation, 200);
  const inspectionDate = clampString(report.meta.dateOfInspection, 20);

  for (const item of ALL_CHECKLIST_ITEMS) {
    const resp = report.responses[item.number];
    if (!resp || resp.photos.length === 0) continue;
    const itemDirty = shouldSyncAllSynced || dirtyItemSet.has(item.number);

    for (const ph of resp.photos) {
      if (ph.uploadState !== 'synced') continue;
      const safePhotoId = sanitizeId(ph.id, 'ph');
      if (
        !itemDirty &&
        !dirtyPhotoIdSet.has(safePhotoId) &&
        !dirtyPhotoIdSet.has(ph.id)
      ) {
        continue;
      }
      const plainData: Record<string, unknown> = {
        caption: clampString(ph.caption, 500),
        complied: sanitizeComplied(resp.complied),
        deviation: clampString(resp.deviation, 2000),
        storeLocation,
        inspectionDate,
      };
      updates.push({
        photoId: safePhotoId,
        plainData,
        fsData: {
          ...plainData,
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  if (updates.length === 0) return;

  await serverUpsertPhotos(
    safeReportId,
    updates.map((u) => ({ id: u.photoId, data: u.plainData }))
  );

  if (firestoreQuotaExhausted) return;

  const photosPath = `reports/${safeReportId}/photos`;
  const CHUNK_SIZE = 150;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const u of chunk) {
      batch.set(doc(db, photosPath, u.photoId), u.fsData, { merge: true });
    }
    try {
      await withFirestoreTimeout(batch.commit(), 20000, 'Photo metadata sync');
    } catch (err) {
      if (isQuotaExceededError(err)) {
        markFirestoreQuotaExhausted();
        return;
      }
      console.warn('[AutoSave] Non-fatal photo metadata sync notice:', err);
    }
  }
}

/**
 * Atomic, zero-pre-read online autosave for `/reports/{reportId}` using `setDoc(..., { merge: true })`
 * plus server cloud database mirroring & automatic failover when Firestore quota is exhausted.
 */
export function autosaveReportDocumentOnline(
  uid: string,
  report: InspectionReport,
  options?: {
    actorName?: string;
    isOwner?: boolean;
    nextSyncVersion?: number;
    dirty?: ReportDirtyDelta;
  }
): Promise<{ reportId: string; updatedAt: string; syncVersion: number }> {
  const safeReportId = sanitizeId(report.id, 'insp');
  const isOwner = options?.isOwner ?? true;
  const actorName = clampString(
    options?.actorName || report.meta.inspectedBy || 'Inspector',
    160
  );
  const nextSyncVersion = clampSyncVersion(options?.nextSyncVersion ?? 1);

  return enqueueReportWrite(safeReportId, async () => {
    const activeReportPath = `reports/${safeReportId}`;
    const activeReportRef = doc(db, 'reports', safeReportId);
    const cacheKey = `${uid}:${safeReportId}`;
    const isKnownOnline = ensuredReportIds.has(cacheKey);
    const syncedPhotoIds = collectSyncedReportPhotoIds(report);

    const buildPlainAndFirestorePayloads = async (): Promise<{
      plain: Record<string, unknown>;
      firestorePayload: Record<string, unknown>;
    }> => {
      const dirty = options?.dirty;
      if (!isKnownOnline || !dirty || dirty.full) {
        const common = await buildCommonReportFieldsAsync(
          report,
          syncedPhotoIds.length
        );
        const plain: Record<string, unknown> = {
          ...(isOwner || !isKnownOnline
            ? { ownerId: uid, ownerName: actorName }
            : {}),
          ...common,
          syncVersion: nextSyncVersion,
          lastEditedByUid: uid,
          lastEditedByName: actorName,
        };
        const firestorePayload: Record<string, unknown> = {
          ...plain,
          updatedAt: serverTimestamp(),
        };
        if (syncedPhotoIds.length > 0) {
          firestorePayload.photoIds = arrayUnion(...syncedPhotoIds);
        } else if (!isKnownOnline) {
          firestorePayload.photoIds = [];
          plain.photoIds = [];
        }
        if (!isKnownOnline) {
          firestorePayload.createdAt = serverTimestamp();
        }
        return { plain, firestorePayload };
      }

      const plain: Record<string, unknown> = {
        stats: computeStats(report, syncedPhotoIds.length),
        syncVersion: nextSyncVersion,
        lastEditedByUid: uid,
        lastEditedByName: actorName,
      };

      if (dirty.meta) {
        plain.documentationNo = clampString(
          report.meta.documentationNo || FORM_DOCUMENTATION_NO,
          40
        );
        plain.revisionNo = clampString(
          report.meta.revisionNo || FORM_REVISION_NO,
          20
        );
        plain.dateOfInspection = clampString(report.meta.dateOfInspection, 20);
        plain.storeLocation = clampString(report.meta.storeLocation, 200);
        plain.reportSequence = normalizeReportSequence(
          report.meta.reportSequence
        );
        plain.timeOfInspection = clampString(report.meta.timeOfInspection, 20);
        plain.timeOfInspectionEnded = clampString(
          report.meta.timeOfInspectionEnded ?? '',
          20
        );
        plain.inspectedBy = clampString(report.meta.inspectedBy, 160);
      }

      if (dirty.itemNumbers.length > 0) {
        const responsesPatch: Record<string, unknown> = {};
        for (const num of dirty.itemNumbers) {
          const r = report.responses[num] ?? createEmptyResponse();
          responsesPatch[String(num)] = buildSingleResponsePayload(r);
        }
        plain.responses = responsesPatch;
      }

      if (dirty.signOffKeys.length > 0) {
        const signOffsPatch: Record<string, unknown> = {};
        for (const roleKey of dirty.signOffKeys) {
          signOffsPatch[roleKey] = await buildSingleSignOffPayloadAsync(
            report.signOffs[roleKey]
          );
        }
        plain.signOffs = signOffsPatch;
      }

      const firestorePayload: Record<string, unknown> = {
        ...plain,
        updatedAt: serverTimestamp(),
      };
      if (syncedPhotoIds.length > 0) {
        firestorePayload.photoIds = arrayUnion(...syncedPhotoIds);
      }

      return { plain, firestorePayload };
    };

    const { plain, firestorePayload } = await buildPlainAndFirestorePayloads();

    // Always persist to the server cloud database (/api/cloud/reports/:id)
    const serverSaved = await serverUpsertReport(safeReportId, {
      data: plain,
      merge: true,
      unionPhotoIds: syncedPhotoIds,
    });

    if (!firestoreQuotaExhausted) {
      try {
        await withFirestoreTimeout(
          setDoc(activeReportRef, firestorePayload, { merge: true }),
          25000,
          'Autosave report'
        );
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        } else {
          if (isPermissionDeniedError(error)) {
            await refreshAuthTokenSafely();
          }
          try {
            const retryPayloads = await buildPlainAndFirestorePayloads();
            await withFirestoreTimeout(
              setDoc(activeReportRef, retryPayloads.firestorePayload, {
                merge: true,
              }),
              25000,
              'Autosave report retry'
            );
          } catch (retryErr) {
            if (isQuotaExceededError(retryErr)) {
              markFirestoreQuotaExhausted();
            } else if (!serverSaved) {
              handleFirestoreError(
                retryErr,
                OperationType.WRITE,
                activeReportPath
              );
            }
          }
        }
      }
    }

    ensuredReportIds.set(cacheKey, uid);
    await syncDirtyPhotoMetadataForReport(safeReportId, report, options?.dirty);

    return {
      reportId: safeReportId,
      updatedAt: new Date().toISOString(),
      syncVersion: nextSyncVersion,
    };
  });
}

/**
 * Saves (creates or updates) an inspection report AND syncs its photo proofs
 * to `/reports/{reportId}/photos/{photoId}` in Firestore and `/api/cloud/*`.
 * Only uploads full base64 image data for photos that are not yet marked `'synced'`,
 * avoiding redundant multi-megabyte re-uploads on subsequent report saves.
 */
export function saveReportOnline(
  uid: string,
  report: InspectionReport,
  options?: {
    actorName?: string;
    reportOwnerId?: string;
    nextSyncVersion?: number;
  }
): Promise<{
  report: InspectionReport;
  syncVersion: number;
  syncedPhotoCount: number;
  failedPhotoCount: number;
}> {
  const safeReportId = sanitizeId(report.id, 'insp');
  const expectedOwnerId = options?.reportOwnerId || uid;
  const actorName = clampString(
    options?.actorName || report.meta.inspectedBy || 'Inspector',
    160
  );
  const nextSyncVersion = clampSyncVersion(options?.nextSyncVersion ?? 1);

  return enqueueReportWrite(safeReportId, async () => {
    const activeReportPath = `reports/${safeReportId}`;
    const activeReportRef = doc(db, 'reports', safeReportId);
    const cacheKey = `${uid}:${safeReportId}`;
    const isKnownOnline = ensuredReportIds.has(cacheKey);
    const commonFields = await buildCommonReportFieldsAsync(report);
    const initialPhotoIds = collectReportPhotoIds(report);

    const plainParentData: Record<string, unknown> = {
      ownerId: expectedOwnerId,
      ownerName: actorName,
      ...commonFields,
      photoIds: initialPhotoIds,
      syncVersion: nextSyncVersion,
      lastEditedByUid: uid,
      lastEditedByName: actorName,
    };

    const serverParentSaved = await serverUpsertReport(safeReportId, {
      data: plainParentData,
      merge: true,
      unionPhotoIds: initialPhotoIds,
    });

    if (!firestoreQuotaExhausted) {
      const buildParentPayload = () => ({
        ...plainParentData,
        ...(!isKnownOnline ? { createdAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      });

      try {
        await withFirestoreTimeout(
          setDoc(activeReportRef, buildParentPayload(), { merge: true }),
          25000,
          'Save report'
        );
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        } else {
          if (isPermissionDeniedError(error)) {
            await refreshAuthTokenSafely();
          }
          try {
            await withFirestoreTimeout(
              setDoc(activeReportRef, buildParentPayload(), { merge: true }),
              25000,
              'Save report retry'
            );
          } catch (retryErr) {
            if (isQuotaExceededError(retryErr)) {
              markFirestoreQuotaExhausted();
            } else if (!serverParentSaved) {
              handleFirestoreError(
                retryErr,
                OperationType.WRITE,
                activeReportPath
              );
            }
          }
        }
      }
    }

    ensuredReportIds.set(cacheKey, expectedOwnerId);

    const photosColPath = `reports/${safeReportId}/photos`;
    const desiredPhotoIds = new Set<string>();
    const updatedResponses: Record<number, ItemResponse> = { ...report.responses };
    let failedPhotoCount = 0;

    interface PhotoWriteOp {
      ref: ReturnType<typeof doc>;
      photoId: string;
      needsFullUpload: boolean;
      plainFullData: Record<string, unknown>;
      plainMetaData: Record<string, unknown>;
      fullData: Record<string, unknown>;
      metaOnlyData: Record<string, unknown>;
    }

    const photoWriteOps: PhotoWriteOp[] = [];

    for (const section of CHECKLIST_SECTIONS) {
      for (const item of section.items) {
        const resp = report.responses[item.number];
        if (!resp || resp.photos.length === 0) continue;

        const safePhotos: PhotoProof[] = [];
        for (const ph of resp.photos) {
          const safePhotoId = sanitizeId(ph.id, 'ph');
          const photoRef = doc(db, photosColPath, safePhotoId);
          const alreadySynced =
            ph.uploadState === 'synced' &&
            typeof ph.dataUrl === 'string' &&
            ph.dataUrl.length > 100 &&
            ph.dataUrl.length <= MAX_FIRESTORE_PHOTO_DATAURL_CHARS;

          let safeDataUrl = ph.dataUrl;
          if (!alreadySynced) {
            try {
              safeDataUrl = await ensureSafePhotoDataUrl(ph.dataUrl, {
                hd: true,
              });
            } catch {
              failedPhotoCount += 1;
              safePhotos.push({
                ...ph,
                id: safePhotoId,
                uploadState: 'error',
                uploadError: 'Could not prepare image for upload',
                uploadErrorCode: 'client/invalid-image',
              });
              continue;
            }

            if (
              !safeDataUrl ||
              safeDataUrl.length > MAX_FIRESTORE_PHOTO_DATAURL_CHARS
            ) {
              failedPhotoCount += 1;
              safePhotos.push({
                ...ph,
                id: safePhotoId,
                uploadState: 'error',
                uploadError: 'Photo exceeds 920 KB HD storage limit',
                uploadErrorCode: 'client/payload-too-large',
              });
              continue;
            }
          }

          desiredPhotoIds.add(safePhotoId);

          const plainMetaData: Record<string, unknown> = {
            caption: clampString(ph.caption, 500),
            complied: sanitizeComplied(resp.complied),
            deviation: clampString(resp.deviation, 2000),
            storeLocation: commonFields.storeLocation,
            inspectionDate: commonFields.dateOfInspection,
          };

          const metaOnlyData: Record<string, unknown> = {
            ...plainMetaData,
            updatedAt: serverTimestamp(),
          };

          const plainFullData: Record<string, unknown> = {
            ownerId: expectedOwnerId,
            uploadedByUid: uid,
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
          };

          const fullData: Record<string, unknown> = {
            ...plainFullData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          photoWriteOps.push({
            ref: photoRef,
            photoId: safePhotoId,
            needsFullUpload: !alreadySynced,
            plainFullData,
            plainMetaData,
            fullData,
            metaOnlyData,
          });

          safePhotos.push({
            ...ph,
            id: safePhotoId,
            dataUrl: safeDataUrl,
            uploadState: 'synced',
            uploadError: undefined,
            uploadErrorCode: undefined,
          });
        }

        updatedResponses[item.number] = {
          ...resp,
          photos: safePhotos,
        };
      }
    }

    // Mirror all photos to the server cloud database in batches
    if (photoWriteOps.length > 0) {
      await serverUpsertPhotos(
        safeReportId,
        photoWriteOps.map((op) => ({
          id: op.photoId,
          data: op.plainFullData,
        }))
      );
    }

    const failedChunkPhotoIds = new Set<string>();
    let fatalBatchError: unknown = null;

    if (!firestoreQuotaExhausted) {
      // 1) Upload any unsynced photos (with full base64 dataUrl) in small chunks of 3
      const fullUploads = photoWriteOps.filter((op) => op.needsFullUpload);
      const FULL_CHUNK_SIZE = 3;
      for (let i = 0; i < fullUploads.length; i += FULL_CHUNK_SIZE) {
        if (firestoreQuotaExhausted) break;
        const chunk = fullUploads.slice(i, i + FULL_CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const op of chunk) {
          batch.set(op.ref, op.fullData, { merge: true });
        }
        try {
          await withFirestoreTimeout(
            batch.commit(),
            25000,
            'Batch photo upload'
          );
        } catch (batchErr) {
          if (isQuotaExceededError(batchErr)) {
            markFirestoreQuotaExhausted();
            break;
          }
          for (const op of chunk) {
            try {
              await withFirestoreTimeout(
                setDoc(op.ref, op.fullData, { merge: true }),
                25000,
                'Single photo upload'
              );
            } catch (singleErr) {
              if (isQuotaExceededError(singleErr)) {
                markFirestoreQuotaExhausted();
                break;
              }
              failedChunkPhotoIds.add(op.photoId);
              failedPhotoCount += 1;
              fatalBatchError = singleErr;
            }
          }
        }
      }

      // 2) Sync lightweight metadata (caption, complied, deviation) for already-synced photos
      const metaUpdates = photoWriteOps.filter((op) => !op.needsFullUpload);
      const META_CHUNK_SIZE = 100;
      for (let i = 0; i < metaUpdates.length; i += META_CHUNK_SIZE) {
        if (firestoreQuotaExhausted) break;
        const chunk = metaUpdates.slice(i, i + META_CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const op of chunk) {
          batch.set(op.ref, op.metaOnlyData, { merge: true });
        }
        try {
          await withFirestoreTimeout(
            batch.commit(),
            15000,
            'Photo metadata update'
          );
        } catch (metaErr) {
          if (isQuotaExceededError(metaErr)) {
            markFirestoreQuotaExhausted();
            break;
          }
          console.warn(
            '[SaveOnline] Non-fatal photo metadata sync notice:',
            metaErr
          );
        }
      }
    }

    if (failedChunkPhotoIds.size > 0) {
      for (const item of ALL_CHECKLIST_ITEMS) {
        const resp = updatedResponses[item.number];
        if (!resp || resp.photos.length === 0) continue;
        updatedResponses[item.number] = {
          ...resp,
          photos: resp.photos.map((ph) =>
            failedChunkPhotoIds.has(ph.id)
              ? {
                  ...ph,
                  uploadState: 'error',
                  uploadError:
                    fatalBatchError instanceof Error
                      ? fatalBatchError.message.slice(0, 120)
                      : 'Cloud upload failed',
                }
              : ph
          ),
        };
      }
    }

    const confirmedPhotoIds = sanitizePhotoIdList(
      Array.from(desiredPhotoIds).filter((id) => !failedChunkPhotoIds.has(id))
    );

    if (
      !firestoreQuotaExhausted &&
      (failedChunkPhotoIds.size > 0 ||
        confirmedPhotoIds.length !== initialPhotoIds.length)
    ) {
      try {
        await withFirestoreTimeout(
          setDoc(
            activeReportRef,
            {
              stats: {
                ...commonFields.stats,
                photoCount: Math.min(500, confirmedPhotoIds.length),
              },
              photoIds: confirmedPhotoIds,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ),
          15000,
          'Finalize photo count'
        );
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        } else {
          console.warn(
            '[SaveOnline] Non-fatal photo count finalize warning:',
            error
          );
        }
      }
    }

    const syncedSignOffs = {
      performedBy: {
        ...report.signOffs.performedBy,
        signatureDataUrl: commonFields.signOffs.performedBy.signatureDataUrl,
      },
      acknowledgedBy: {
        ...report.signOffs.acknowledgedBy,
        signatureDataUrl: commonFields.signOffs.acknowledgedBy.signatureDataUrl,
      },
      notedBy: {
        ...report.signOffs.notedBy,
        signatureDataUrl: commonFields.signOffs.notedBy.signatureDataUrl,
      },
      reviewedBy: {
        ...report.signOffs.reviewedBy,
        signatureDataUrl: commonFields.signOffs.reviewedBy.signatureDataUrl,
      },
      approvedBy: {
        ...report.signOffs.approvedBy,
        signatureDataUrl: commonFields.signOffs.approvedBy.signatureDataUrl,
      },
    };

    return {
      report: {
        ...report,
        id: safeReportId,
        updatedAt: new Date().toISOString(),
        responses: updatedResponses,
        signOffs: syncedSignOffs,
      },
      syncVersion: nextSyncVersion,
      syncedPhotoCount: confirmedPhotoIds.length,
      failedPhotoCount,
    };
  });
}

/**
 * Loads a complete InspectionReport (with all attached photos from its subcollection)
 * plus its collaboration/sharing metadata. Works for Owners, Editors, Viewers, and Public users.
 * Automatically merges and fails over to `/api/cloud/reports/:reportId` when Firestore quota is exhausted.
 */
export async function loadReportWithPhotosOnline(
  uid: string,
  reportId: string,
  userEmail?: string | null
): Promise<LoadedCloudReport | null> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const reportPath = `reports/${safeReportId}`;

  const serverRes = await serverFetchSingleReport(safeReportId);
  let fsData: Record<string, unknown> | null = null;

  if (!firestoreQuotaExhausted) {
    try {
      const snap = await withFirestoreTimeout(
        getDoc(doc(db, 'reports', safeReportId)),
        20000,
        'Load report'
      );
      if (snap.exists()) {
        fsData = snap.data() as Record<string, unknown>;
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      } else if (!serverRes.exists) {
        handleFirestoreError(error, OperationType.GET, reportPath);
      }
    }
  }

  let d: Record<string, unknown> | null = fsData;
  if (serverRes.exists && serverRes.data) {
    if (!d) {
      d = serverRes.data;
    } else {
      const fsUpdated = toIsoString(d.updatedAt);
      const srvUpdated = toIsoString(serverRes.data.updatedAt);
      if (srvUpdated >= fsUpdated) {
        d = { ...d, ...serverRes.data };
      }
    }
  }

  if (!d) return null;

  const collaboration = mapDocToCollaboration(d, uid, userEmail);
  const photosPath = `reports/${safeReportId}/photos`;

  const photosByItem = new Map<number, PhotoProof[]>();
  const ingestedPhotoIds = new Set<string>();

  const ingestPhotoDoc = (id: string, pd: Record<string, unknown>) => {
    if (ingestedPhotoIds.has(id)) return;
    const itemNum = Number(pd.itemNumber);
    if (!itemNum) return;
    ingestedPhotoIds.add(id);
    const list = photosByItem.get(itemNum) ?? [];
    list.push({
      id,
      dataUrl: String(pd.dataUrl ?? ''),
      caption: String(pd.caption ?? ''),
      capturedAt: String(pd.capturedAt ?? new Date().toISOString()),
      fileName: String(pd.fileName ?? `item-${itemNum}.jpg`),
      uploadState: 'synced',
    });
    photosByItem.set(itemNum, list);
  };

  // Ingest server photos first
  for (const sp of serverRes.photos) {
    if (sp && sp.id && sp.data) {
      ingestPhotoDoc(sp.id, sp.data);
    }
  }

  if (!firestoreQuotaExhausted) {
    try {
      const photoDocs = await withFirestoreTimeout(
        getDocs(collection(db, photosPath)),
        20000,
        'Load report photos'
      );
      for (const pDoc of photoDocs.docs) {
        ingestPhotoDoc(pDoc.id, pDoc.data() as Record<string, unknown>);
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        markFirestoreQuotaExhausted();
      } else if (collaboration.photoIds.length > 0) {
        const photoSnaps = await Promise.all(
          collaboration.photoIds.map(async (photoId) => {
            try {
              return await getDoc(doc(db, photosPath, photoId));
            } catch {
              return null;
            }
          })
        );
        for (const pSnap of photoSnaps) {
          if (pSnap && pSnap.exists()) {
            ingestPhotoDoc(pSnap.id, pSnap.data() as Record<string, unknown>);
          }
        }
      }
    }
  }

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

  const signOffsRaw = (d.signOffs ?? {}) as Record<
    string,
    { printedName?: string; date?: string; signatureDataUrl?: string | null }
  >;

  ensuredReportIds.set(`${uid}:${safeReportId}`, collaboration.ownerId);

  return {
    report: {
      id: safeReportId,
      updatedAt: toIsoString(d.updatedAt),
      meta: {
        documentationNo: String(d.documentationNo ?? FORM_DOCUMENTATION_NO),
        revisionNo: String(d.revisionNo ?? FORM_REVISION_NO),
        dateOfInspection: String(d.dateOfInspection ?? ''),
        storeLocation: String(d.storeLocation ?? ''),
        reportSequence: parseOptionalSequence(d.reportSequence),
        timeOfInspection: String(d.timeOfInspection ?? ''),
        timeOfInspectionEnded: String(d.timeOfInspectionEnded ?? ''),
        inspectedBy: String(d.inspectedBy ?? ''),
      },
      responses,
      signOffs: {
        performedBy: {
          printedName: String(signOffsRaw.performedBy?.printedName ?? ''),
          date: String(signOffsRaw.performedBy?.date ?? ''),
          signatureDataUrl: signOffsRaw.performedBy?.signatureDataUrl ?? null,
        },
        acknowledgedBy: {
          printedName: String(signOffsRaw.acknowledgedBy?.printedName ?? ''),
          date: String(signOffsRaw.acknowledgedBy?.date ?? ''),
          signatureDataUrl: signOffsRaw.acknowledgedBy?.signatureDataUrl ?? null,
        },
        notedBy: {
          printedName: String(signOffsRaw.notedBy?.printedName ?? ''),
          date: String(signOffsRaw.notedBy?.date ?? ''),
          signatureDataUrl: signOffsRaw.notedBy?.signatureDataUrl ?? null,
        },
        reviewedBy: {
          printedName: String(signOffsRaw.reviewedBy?.printedName ?? ''),
          date: String(signOffsRaw.reviewedBy?.date ?? ''),
          signatureDataUrl: signOffsRaw.reviewedBy?.signatureDataUrl ?? null,
        },
        approvedBy: {
          printedName: String(signOffsRaw.approvedBy?.printedName ?? ''),
          date: String(signOffsRaw.approvedBy?.date ?? ''),
          signatureDataUrl: signOffsRaw.approvedBy?.signatureDataUrl ?? null,
        },
      },
    },
    collaboration,
  };
}

/**
 * Loads all online photo proof records across the specified cloud reports for the Photo Vault.
 */
export async function loadAllUserPhotosOnline(
  _uid: string,
  reportIds: string[]
): Promise<StoredPhotoRecord[]> {
  const byId = new Map<string, StoredPhotoRecord>();

  const serverPhotos = await serverFetchPhotosForReports(reportIds);
  for (const sp of serverPhotos) {
    if (!sp || !sp.id || !sp.data) continue;
    const pd = sp.data;
    byId.set(sp.id, {
      id: sp.id,
      reportId: sp.reportId,
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
    });
  }

  if (!firestoreQuotaExhausted) {
    const settled = await Promise.allSettled(
      reportIds.map(async (reportId) => {
        const photosPath = `reports/${reportId}/photos`;
        const snap = await withFirestoreTimeout(
          getDocs(collection(db, photosPath)),
          20000,
          'Load report photos'
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
      })
    );

    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === 'fulfilled') {
        for (const rec of res.value) {
          if (!byId.has(rec.id)) {
            byId.set(rec.id, rec);
          }
        }
      } else if (isQuotaExceededError(res.reason)) {
        markFirestoreQuotaExhausted();
      } else {
        console.warn(
          `[PhotoVault] Could not load photos for report ${reportIds[i]}:`,
          res.reason
        );
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    (b.capturedAt || '').localeCompare(a.capturedAt || '')
  );
}

/**
 * Deletes an online report, its photo subcollection documents, and any active share link atomically.
 */
export function deleteReportOnline(
  uid: string,
  reportId: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  return enqueueReportWrite(safeReportId, async () => {
    const serverDeleted = await serverDeleteReport(safeReportId);
    ensuredReportIds.delete(`${uid}:${safeReportId}`);

    if (firestoreQuotaExhausted) return;

    const reportPath = `reports/${safeReportId}`;
    const reportRef = doc(db, 'reports', safeReportId);
    const photosPath = `reports/${safeReportId}/photos`;

    let activeShareLinkId: string | null = null;
    try {
      const rSnap = await getDoc(reportRef);
      if (rSnap.exists()) {
        const sid = rSnap.data().activeShareLinkId;
        if (typeof sid === 'string' && sid) activeShareLinkId = sid;
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        markFirestoreQuotaExhausted();
        return;
      }
    }

    let photoDocIds: string[] = [];
    try {
      const snap = await getDocs(collection(db, photosPath));
      photoDocIds = snap.docs.map((d) => d.id);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
        return;
      }
      if (!serverDeleted) {
        handleFirestoreError(error, OperationType.DELETE, photosPath);
      }
    }

    // Batch-delete photos in chunks of 400
    for (let i = 0; i < photoDocIds.length; i += 400) {
      const batch = writeBatch(db);
      for (const pid of photoDocIds.slice(i, i + 400)) {
        batch.delete(doc(db, photosPath, pid));
      }
      try {
        await batch.commit();
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
          return;
        }
        if (!serverDeleted) {
          handleFirestoreError(error, OperationType.DELETE, photosPath);
        }
      }
    }

    try {
      const finalBatch = writeBatch(db);
      finalBatch.delete(reportRef);
      if (activeShareLinkId) {
        finalBatch.delete(doc(db, 'shareLinks', activeShareLinkId));
      }
      await finalBatch.commit();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
        return;
      }
      try {
        await deleteDoc(reportRef);
      } catch (err2) {
        if (isQuotaExceededError(err2)) {
          markFirestoreQuotaExhausted();
          return;
        }
        if (!serverDeleted) {
          handleFirestoreError(err2, OperationType.DELETE, reportPath);
        }
      }
      console.warn('[DeleteReport] Non-fatal shareLink cleanup note:', error);
    }
  });
}

/**
 * Batch-deletes multiple photos from a single report in Firestore and `/api/cloud/*`.
 */
export function deletePhotosBatchOnline(
  uid: string,
  reportId: string,
  photoIds: string[]
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const safePhotoIds = Array.from(
    new Set(photoIds.map((id) => sanitizeId(id, 'ph')))
  );
  if (safePhotoIds.length === 0) return Promise.resolve();

  return enqueueReportWrite(safeReportId, async () => {
    const serverDeleted = await serverDeletePhotos(safeReportId, safePhotoIds);
    if (firestoreQuotaExhausted) return;

    const photosPath = `reports/${safeReportId}/photos`;
    const CHUNK_SIZE = 200;
    for (let i = 0; i < safePhotoIds.length; i += CHUNK_SIZE) {
      const chunk = safePhotoIds.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const pid of chunk) {
        batch.delete(doc(db, photosPath, pid));
      }
      try {
        await batch.commit();
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
          return;
        }
        if (!serverDeleted) {
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `${photosPath}/${chunk[0]}`
          );
        }
      }
    }

    const removedSet = new Set(safePhotoIds);
    try {
      const reportRef = doc(db, 'reports', safeReportId);
      const reportSnap = await getDoc(reportRef);
      if (reportSnap.exists()) {
        const d = reportSnap.data();
        const currentStats = d.stats ?? {
          answered: 0,
          yes: 0,
          no: 0,
          na: 0,
          photoCount: 0,
        };
        const hasPhotoIdArray = Array.isArray(d.photoIds);
        const remainingPhotoIds = hasPhotoIdArray
          ? (d.photoIds as string[]).filter((id) => !removedSet.has(id))
          : [];
        const nextCount = hasPhotoIdArray
          ? remainingPhotoIds.length
          : Math.max(
              0,
              Number(currentStats.photoCount ?? safePhotoIds.length) -
                safePhotoIds.length
            );

        await updateDoc(reportRef, {
          stats: {
            answered: Number(currentStats.answered ?? 0),
            yes: Number(currentStats.yes ?? 0),
            no: Number(currentStats.no ?? 0),
            na: Number(currentStats.na ?? 0),
            photoCount: nextCount,
          },
          photoIds: arrayRemove(...safePhotoIds),
          lastEditedByUid: uid,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (statsErr) {
      if (isQuotaExceededError(statsErr)) {
        markFirestoreQuotaExhausted();
      } else {
        console.warn('Non-fatal delete photoCount sync warning:', statsErr);
      }
    }
  });
}

/**
 * Deletes a single photo document from Firestore and updates the parent report's photoIds & photoCount.
 */
export function deleteSinglePhotoOnline(
  uid: string,
  reportId: string,
  photoId: string
): Promise<void> {
  return deletePhotosBatchOnline(uid, reportId, [photoId]);
}

// ============================================================================
// SHARING & COLLABORATION OPERATIONS
// ============================================================================

/**
 * Backfills `photoIds` on a legacy report so invited collaborators can fetch all existing photos.
 */
async function resolveOwnerPhotoIdsForSharing(
  _uid: string,
  reportId: string
): Promise<string[]> {
  const srv = await serverFetchSingleReport(reportId);
  const srvIds = srv.photos.map((p) => p.id);
  if (firestoreQuotaExhausted) {
    return sanitizePhotoIdList(srvIds);
  }
  const photosPath = `reports/${reportId}/photos`;
  try {
    const snap = await getDocs(collection(db, photosPath));
    return sanitizePhotoIdList([...srvIds, ...snap.docs.map((d) => d.id)]);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      markFirestoreQuotaExhausted();
    }
    return sanitizePhotoIdList(srvIds);
  }
}

/**
 * Updates the collaborator email lists (`sharedWithEmails` and `editorEmails`) on an owned report.
 * Also backfills `photoIds` so newly invited collaborators can view all existing photo proofs immediately.
 */
export function updateReportCollaboratorsOnline(
  uid: string,
  ownerEmail: string | null | undefined,
  ownerName: string,
  reportId: string,
  sharedWithEmails: string[],
  editorEmails: string[]
): Promise<{ sharedWithEmails: string[]; editorEmails: string[] }> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const ownerLower = ownerEmail ? normalizeEmail(ownerEmail) : '';

  const cleanShared = sanitizeEmailList(sharedWithEmails).filter(
    (e) => e !== ownerLower
  );
  const sharedSet = new Set(cleanShared);
  const cleanEditors = sanitizeEmailList(editorEmails).filter((e) =>
    sharedSet.has(e)
  );

  return enqueueReportWrite(safeReportId, async () => {
    const reportPath = `reports/${safeReportId}`;
    const reportRef = doc(db, 'reports', safeReportId);
    const photoIds = await resolveOwnerPhotoIdsForSharing(uid, safeReportId);

    const serverSaved = await serverUpsertReport(safeReportId, {
      data: {
        ownerName: clampString(ownerName, 160),
        sharedWithEmails: cleanShared,
        editorEmails: cleanEditors,
        photoIds,
      },
      merge: true,
    });

    if (!firestoreQuotaExhausted) {
      try {
        await updateDoc(reportRef, {
          ownerName: clampString(ownerName, 160),
          sharedWithEmails: cleanShared,
          editorEmails: cleanEditors,
          photoIds,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        } else if (!serverSaved) {
          handleFirestoreError(error, OperationType.UPDATE, reportPath);
        }
      }
    }

    return {
      sharedWithEmails: cleanShared,
      editorEmails: cleanEditors,
    };
  });
}

/**
 * Creates or updates a revocable shareable link (`/shareLinks/{shareId}`) and links it
 * atomically to `/reports/{reportId}`.
 */
export function createOrUpdateShareLinkOnline(
  uid: string,
  ownerName: string,
  summary: Pick<
    CloudReportSummary,
    | 'id'
    | 'documentationNo'
    | 'storeLocation'
    | 'dateOfInspection'
    | 'reportSequence'
    | 'activeShareLinkId'
    | 'sharedWithEmails'
    | 'editorEmails'
  >,
  role: 'viewer' | 'editor'
): Promise<{ shareId: string; role: 'viewer' | 'editor' }> {
  const safeReportId = sanitizeId(summary.id, 'insp');

  return enqueueReportWrite(safeReportId, async () => {
    const reportRef = doc(db, 'reports', safeReportId);
    const photoIds = await resolveOwnerPhotoIdsForSharing(uid, safeReportId);
    const cleanShared = sanitizeEmailList(summary.sharedWithEmails);
    const cleanEditors = sanitizeEmailList(summary.editorEmails);
    const safeOwnerName = clampString(ownerName || 'Inspector', 160);

    const existingLinkId = summary.activeShareLinkId;
    const shareId =
      existingLinkId && existingLinkId.length >= 16
        ? existingLinkId
        : generateSecureShareId();

    const plainShareData: Record<string, unknown> = {
      ownerId: uid,
      ownerName: safeOwnerName,
      reportId: safeReportId,
      documentationNo: clampString(
        summary.documentationNo || FORM_DOCUMENTATION_NO,
        40
      ),
      storeLocation: clampString(summary.storeLocation, 200),
      dateOfInspection: clampString(summary.dateOfInspection, 20),
      reportSequence: normalizeReportSequence(summary.reportSequence),
      role,
      active: true,
    };

    const serverShareSaved = await serverUpsertShareLink(
      shareId,
      plainShareData
    );
    await serverUpsertReport(safeReportId, {
      data: {
        ownerName: safeOwnerName,
        sharedWithEmails: cleanShared,
        editorEmails: cleanEditors,
        activeShareLinkId: shareId,
        activeShareRole: role,
        photoIds,
      },
      merge: true,
    });

    if (!firestoreQuotaExhausted) {
      const shareRef = doc(db, 'shareLinks', shareId);
      const sharePath = `shareLinks/${shareId}`;

      let linkExists = false;
      if (existingLinkId) {
        try {
          const snap = await getDoc(shareRef);
          linkExists = snap.exists();
        } catch (err) {
          if (isQuotaExceededError(err)) {
            markFirestoreQuotaExhausted();
          }
          linkExists = false;
        }
      }

      if (!firestoreQuotaExhausted) {
        const batch = writeBatch(db);

        if (linkExists) {
          batch.update(shareRef, {
            ...plainShareData,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(shareRef, {
            ...plainShareData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        batch.update(reportRef, {
          ownerName: safeOwnerName,
          sharedWithEmails: cleanShared,
          editorEmails: cleanEditors,
          activeShareLinkId: shareId,
          activeShareRole: role,
          photoIds,
          updatedAt: serverTimestamp(),
        });

        try {
          await batch.commit();
        } catch (error) {
          if (isQuotaExceededError(error)) {
            markFirestoreQuotaExhausted();
          } else if (!serverShareSaved) {
            handleFirestoreError(error, OperationType.WRITE, sharePath);
          }
        }
      }
    }

    return { shareId, role };
  });
}

/**
 * Revokes an active share link atomically (disables `/shareLinks/{shareId}` and clears
 * `activeShareLinkId` on `/reports/{reportId}` so nobody new can join via the link).
 */
export function revokeShareLinkOnline(
  reportId: string,
  shareLinkId: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const safeShareId = sanitizeId(shareLinkId, 'shr');

  return enqueueReportWrite(safeReportId, async () => {
    await serverUpsertReport(safeReportId, {
      data: {
        activeShareLinkId: null,
        activeShareRole: 'none',
      },
      merge: true,
    });
    await serverUpsertShareLink(safeShareId, { active: false });

    if (firestoreQuotaExhausted) return;

    const batch = writeBatch(db);
    batch.update(doc(db, 'reports', safeReportId), {
      activeShareLinkId: null,
      activeShareRole: 'none',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'shareLinks', safeShareId), {
      active: false,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
        return;
      }
      try {
        await updateDoc(doc(db, 'reports', safeReportId), {
          activeShareLinkId: null,
          activeShareRole: 'none',
          updatedAt: serverTimestamp(),
        });
      } catch (err2) {
        if (isQuotaExceededError(err2)) {
          markFirestoreQuotaExhausted();
          return;
        }
      }
      console.warn('[RevokeShareLink] Non-fatal shareLink doc note:', error);
    }
  });
}

/**
 * Fetches metadata preview for a shareable link (`/shareLinks/{shareId}`).
 */
export async function getShareLinkPreviewOnline(
  shareId: string
): Promise<ShareLinkPreview | null> {
  if (!VALID_ID_REGEX.test(shareId)) return null;
  const path = `shareLinks/${shareId}`;

  const srv = await serverGetShareLink(shareId);
  if (!firestoreQuotaExhausted) {
    try {
      const snap = await getDoc(doc(db, 'shareLinks', shareId));
      if (snap.exists()) {
        const d = snap.data();
        return {
          shareId: snap.id,
          ownerId: String(d.ownerId ?? ''),
          ownerName: String(d.ownerName ?? 'Inspector'),
          reportId: String(d.reportId ?? ''),
          documentationNo: String(d.documentationNo ?? FORM_DOCUMENTATION_NO),
          storeLocation: String(d.storeLocation ?? ''),
          dateOfInspection: String(d.dateOfInspection ?? ''),
          reportSequence: parseOptionalSequence(d.reportSequence),
          role: d.role === 'editor' ? 'editor' : 'viewer',
          active: Boolean(d.active),
        };
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      } else if (!srv) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  }

  if (srv) {
    return {
      shareId,
      ownerId: String(srv.ownerId ?? ''),
      ownerName: String(srv.ownerName ?? 'Inspector'),
      reportId: String(srv.reportId ?? ''),
      documentationNo: String(srv.documentationNo ?? FORM_DOCUMENTATION_NO),
      storeLocation: String(srv.storeLocation ?? ''),
      dateOfInspection: String(srv.dateOfInspection ?? ''),
      reportSequence: parseOptionalSequence(srv.reportSequence),
      role: srv.role === 'editor' ? 'editor' : 'viewer',
      active: Boolean(srv.active),
    };
  }
  return null;
}

/**
 * Claims an active share link for the currently signed-in verified user and returns the target reportId.
 * If the user already owns or has access to the report, skips the write cleanly.
 */
export async function claimShareLinkOnline(
  uid: string,
  userEmail: string,
  shareId: string
): Promise<{ reportId: string; role: 'viewer' | 'editor'; alreadyMember: boolean }> {
  const preview = await getShareLinkPreviewOnline(shareId);
  if (!preview || !preview.active) {
    throw new Error(
      'This share link is invalid or has been revoked by the report owner.'
    );
  }

  const lowerEmail = normalizeEmail(userEmail);
  if (!isValidEmailAddress(lowerEmail)) {
    throw new Error('A verified Google account email is required to open shared reports.');
  }

  if (preview.ownerId === uid) {
    return { reportId: preview.reportId, role: 'editor', alreadyMember: true };
  }

  const claimProof = `${shareId}_${uid}`;
  const serverSaved = await serverUpsertReport(preview.reportId, {
    data: { lastClaimedShareLinkId: claimProof },
    merge: true,
    unionSharedWithEmails: [lowerEmail],
    ...(preview.role === 'editor' ? { unionEditorEmails: [lowerEmail] } : {}),
  });

  if (!firestoreQuotaExhausted) {
    const reportPath = `reports/${preview.reportId}`;
    const reportRef = doc(db, 'reports', preview.reportId);

    try {
      const existingSnap = await getDoc(reportRef);
      if (existingSnap.exists()) {
        return {
          reportId: preview.reportId,
          role: preview.role,
          alreadyMember: true,
        };
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        markFirestoreQuotaExhausted();
      }
    }

    if (!firestoreQuotaExhausted) {
      const claimPatch: Record<string, unknown> = {
        sharedWithEmails: arrayUnion(lowerEmail),
        lastClaimedShareLinkId: claimProof,
        updatedAt: serverTimestamp(),
      };
      if (preview.role === 'editor') {
        claimPatch.editorEmails = arrayUnion(lowerEmail);
      }

      try {
        await updateDoc(reportRef, claimPatch);
      } catch (error) {
        if (isQuotaExceededError(error)) {
          markFirestoreQuotaExhausted();
        } else if (!serverSaved) {
          handleFirestoreError(error, OperationType.UPDATE, reportPath);
        }
      }
    }
  }

  return {
    reportId: preview.reportId,
    role: preview.role,
    alreadyMember: false,
  };
}

/**
 * Allows a collaborator to leave a shared report by removing only their own email.
 */
export async function leaveSharedReportOnline(
  userEmail: string,
  reportId: string
): Promise<void> {
  const safeReportId = sanitizeId(reportId, 'insp');
  const lowerEmail = normalizeEmail(userEmail);
  const reportPath = `reports/${safeReportId}`;

  const serverSaved = await serverUpsertReport(safeReportId, {
    data: {},
    merge: true,
    removeSharedWithEmails: [lowerEmail],
    removeEditorEmails: [lowerEmail],
  });

  if (firestoreQuotaExhausted) return;

  try {
    await updateDoc(doc(db, 'reports', safeReportId), {
      sharedWithEmails: arrayRemove(lowerEmail),
      editorEmails: arrayRemove(lowerEmail),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExhausted();
    } else if (!serverSaved) {
      handleFirestoreError(error, OperationType.UPDATE, reportPath);
    }
  }
}

/**
 * Duplicates a report (owned or shared) into a brand-new independent report owned by `uid`,
 * including fresh copies of all attached photos.
 */
export async function duplicateReportOnline(
  uid: string,
  actorName: string,
  source: InspectionReport,
  options?: { nextReportSequence?: number }
): Promise<InspectionReport> {
  const newReportId = `insp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const clonedResponses: Record<number, ItemResponse> = {};

  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = source.responses[item.number] ?? createEmptyResponse();
    clonedResponses[item.number] = {
      complied: r.complied,
      deviation: r.deviation,
      correctiveAction: r.correctiveAction,
      photos: r.photos.map((ph, idx) => ({
        ...ph,
        id: sanitizeId(`ph-${Date.now()}-${item.number}-${idx}-${Math.random().toString(36).slice(2, 6)}`, 'ph'),
        uploadState: 'local',
        uploadError: undefined,
        uploadErrorCode: undefined,
      })),
    };
  }

  const nextSequence = normalizeReportSequence(
    options?.nextReportSequence ??
      normalizeReportSequence(source.meta.reportSequence) + 1
  );

  const draftCopy: InspectionReport = {
    id: newReportId,
    updatedAt: new Date().toISOString(),
    meta: {
      ...source.meta,
      reportSequence: nextSequence,
    },
    responses: clonedResponses,
    signOffs: {
      performedBy: { ...source.signOffs.performedBy },
      acknowledgedBy: { ...source.signOffs.acknowledgedBy },
      notedBy: { ...source.signOffs.notedBy },
      reviewedBy: { ...source.signOffs.reviewedBy },
      approvedBy: { ...source.signOffs.approvedBy },
    },
  };

  const { report: saved } = await saveReportOnline(uid, draftCopy, {
    actorName,
    reportOwnerId: uid,
    nextSyncVersion: 1,
  });
  return saved;
}

/**
 * Builds the canonical shareable URL for a share link token or direct report link.
 */
export function buildShareUrl(params: { shareId?: string; reportId?: string }): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  url.searchParams.delete('report');
  if (params.shareId) {
    url.searchParams.set('share', params.shareId);
  } else if (params.reportId) {
    url.searchParams.set('report', params.reportId);
  }
  return url.toString();
}
