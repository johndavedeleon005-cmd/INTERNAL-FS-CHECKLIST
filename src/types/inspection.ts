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
