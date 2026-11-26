export type ComplianceStatus = 'Yes' | 'No' | 'N/A' | '';

export type PhotoUploadState = 'uploading' | 'synced' | 'local' | 'error';

export interface PhotoProof {
  id: string;
  dataUrl: string;
  caption: string;
  capturedAt: string;
  fileName: string;
  takenAtSource?: 'camera' | 'exif' | 'file' | 'now';
  uploadState?: PhotoUploadState;
  uploadError?: string;
  uploadErrorCode?: string;
}

export interface PhotoUploadAttemptLog {
  attempt: number;
  timestamp: string;
  durationMs: number;
  errorCode: string;
  message: string;
}

export interface PhotoUploadDiagnostic {
  id: string;
  photoId: string;
  reportId: string;
  itemNumber: number;
  fileName: string;
  timestamp: string;
  errorCode: string;
  friendlySummary: string;
  guidance: string;
  rawMessage: string;
  operationType: string | null;
  path: string | null;
  payloadBytes: number;
  attempts: number;
  attemptLogs: PhotoUploadAttemptLog[];
  authState: {
    signedIn: boolean;
    uid: string | null;
    email: string | null;
    emailVerified: boolean | null;
  };
  online: boolean;
  retrying?: boolean;
}

export interface ItemResponse {
  complied: ComplianceStatus;
  deviation: string;
  correctiveAction: string;
  photos: PhotoProof[];
}

export interface ChecklistItemDef {
  number: number;
  sectionCode: string;
  text: string;
}

export interface ChecklistSectionDef {
  code: string;
  title: string;
  items: ChecklistItemDef[];
}

export interface InspectionMeta {
  documentationNo: string;
  revisionNo: string;
  dateOfInspection: string;
  storeLocation: string;
  timeOfInspection: string;
  inspectedBy: string;
}

export interface SignOffEntry {
  printedName: string;
  date: string;
  signatureDataUrl: string | null;
}

export interface InspectionSignOffs {
  performedBy: SignOffEntry;
  acknowledgedBy: SignOffEntry;
  notedBy: SignOffEntry;
}

export interface InspectionReport {
  id: string;
  updatedAt: string;
  meta: InspectionMeta;
  responses: Record<number, ItemResponse>;
  signOffs: InspectionSignOffs;
}

export interface StoredPhotoRecord {
  id: string;
  reportId: string;
  storeLocation: string;
  inspectionDate: string;
  itemNumber: number;
  sectionCode: string;
  sectionTitle: string;
  itemText: string;
  complied: ComplianceStatus;
  deviation: string;
  caption: string;
  capturedAt: string;
  fileName: string;
  dataUrl: string;
}

export interface PdfExportOptions {
  includeSummary: boolean;
  includePhotoAppendix: boolean;
  includeInlineThumbnails: boolean;
}
