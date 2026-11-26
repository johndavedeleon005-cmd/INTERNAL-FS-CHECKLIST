import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudCheck,
  HardDrive,
  ImagePlus,
  Loader2,
  Minus,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ChecklistItemDef,
  ComplianceStatus,
  ItemResponse,
  PhotoProof,
} from '../types/inspection';
import {
  compressImageFile,
  extractPhotoTakenTimestamp,
  formatTakenTimestamp,
  generatePhotoId,
  isSupportedImageFile,
} from '../utils/imageUtils';

interface InspectionItemRowProps {
  item: ChecklistItemDef;
  response: ItemResponse;
  onChange: (next: ItemResponse) => void;
  onOpenCamera: () => void;
  onAddPhotos: (photos: PhotoProof[]) => void;
  onRetryPhotoUpload: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onUpdatePhotoCaption: (photoId: string, caption: string) => void;
  onInspectPhoto: (photo: PhotoProof) => void;
}

const STATUS_OPTIONS: {
  value: Exclude<ComplianceStatus, ''>;
  label: string;
}[] = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'N/A', label: 'N/A' },
];

export function InspectionItemRow({
  item,
  response,
  onChange,
  onOpenCamera,
  onAddPhotos,
  onRetryPhotoUpload,
  onRemovePhoto,
  onUpdatePhotoCaption,
  onInspectPhoto,
}: InspectionItemRowProps) {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const isNonCompliant = response.complied === 'No';
  const hasNotes =
    response.deviation.trim().length > 0 ||
    response.correctiveAction.trim().length > 0;
  const showDetailsArea = isNonCompliant || notesExpanded || hasNotes;
  const missingRequiredDetails =
    isNonCompliant &&
    (!response.deviation.trim() || !response.correctiveAction.trim());

  const handleStatusSelect = (status: Exclude<ComplianceStatus, ''>) => {
    const nextStatus: ComplianceStatus =
      response.complied === status ? '' : status;
    onChange({
      ...response,
      complied: nextStatus,
    });
  };

  const handleGallerySelection = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingFiles(true);
    setProcessError(null);
    const added: PhotoProof[] = [];
    let failedCount = 0;

    try {
      for (const file of Array.from(files)) {
        if (!isSupportedImageFile(file)) {
          failedCount++;
          continue;
        }
        try {
          const [dataUrl, taken] = await Promise.all([
            compressImageFile(file),
            extractPhotoTakenTimestamp(file, false),
          ]);
          added.push({
            id: generatePhotoId(),
            dataUrl,
            caption: '',
            capturedAt: taken.iso,
            takenAtSource: taken.source,
            fileName: file.name || `item-${item.number}-proof.jpg`,
          });
        } catch {
          failedCount++;
        }
      }

      if (added.length > 0) {
        onAddPhotos(added);
      }
      if (failedCount > 0) {
        setProcessError(
          failedCount === 1
            ? '1 selected file could not be read as an image (try JPG, PNG, or WebP).'
            : `${failedCount} selected files could not be read as images (try JPG, PNG, or WebP).`
        );
      }
    } finally {
      setIsProcessingFiles(false);
      if (galleryInputRef.current) {
        galleryInputRef.current.value = '';
      }
    }
  };

  const sourceHint = (source?: PhotoProof['takenAtSource']) => {
    if (source === 'exif') return 'EXIF';
    if (source === 'camera') return 'Camera';
    if (source === 'file') return 'File';
    return null;
  };

  return (
    <div
      id={`item-${item.number}`}
      className={`border-b border-slate-200 last:border-b-0 px-4 sm:px-5 py-4 transition-colors ${
        isNonCompliant ? 'bg-red-50/40' : 'bg-white hover:bg-slate-50/50'
      }`}
    >
      {/* Main row: Number + Inspection Item + Complied Controls + Camera/Gallery */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums pt-0.5 w-6 shrink-0">
            {String(item.number).padStart(2, '0')}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] leading-snug text-slate-900">
              {item.text}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
              {!isNonCompliant && (
                <button
                  type="button"
                  onClick={() => setNotesExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors"
                >
                  {showDetailsArea ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Hide notes
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      Add findings / note
                    </>
                  )}
                </button>
              )}
              {missingRequiredDetails && (
                <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Record deviation and corrective action for &ldquo;No&rdquo;
                </span>
              )}
              {response.photos.length > 0 && (
                <span className="font-mono tabular-nums text-slate-600">
                  {response.photos.length}{' '}
                  {response.photos.length === 1
                    ? 'photo attached'
                    : 'photos attached'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Controls: Yes / No / N/A Segmented Control + Camera & Gallery */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 pl-9 lg:pl-0 shrink-0">
          <div
            role="radiogroup"
            aria-label={`Item ${item.number} compliance`}
            className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg"
          >
            {STATUS_OPTIONS.map((opt) => {
              const active = response.complied === opt.value;
              let activeClass = 'bg-white text-slate-900 shadow-xs';
              if (active && opt.value === 'Yes') {
                activeClass = 'bg-emerald-700 text-white shadow-xs';
              } else if (active && opt.value === 'No') {
                activeClass = 'bg-red-700 text-white shadow-xs';
              } else if (active && opt.value === 'N/A') {
                activeClass = 'bg-slate-700 text-white shadow-xs';
              }

              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleStatusSelect(opt.value)}
                  className={`inline-flex items-center justify-center gap-1 min-w-[54px] h-9 px-2.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40 ${
                    active
                      ? activeClass
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  {opt.value === 'Yes' && <Check className="w-3.5 h-3.5" />}
                  {opt.value === 'No' && <X className="w-3.5 h-3.5" />}
                  {opt.value === 'N/A' && <Minus className="w-3 h-3" />}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleGallerySelection}
            className="hidden"
          />

          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenCamera}
              className="inline-flex items-center gap-1.5 h-10 px-2.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Take a photo with camera"
            >
              <Camera className="w-3.5 h-3.5 text-slate-600" />
              <span>Camera</span>
            </button>
            <button
              type="button"
              disabled={isProcessingFiles}
              onClick={() => galleryInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 h-10 px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                response.photos.length > 0
                  ? 'border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200/80'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
              title="Import one or more photos from gallery"
            >
              {isProcessingFiles ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
              ) : (
                <ImagePlus className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>{isProcessingFiles ? 'Adding…' : 'Gallery'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Deviation / Findings & Corrective Action fields */}
      {showDetailsArea && (
        <div className="mt-3 pl-0 sm:pl-9 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
              <span>Deviation / Findings</span>
              {isNonCompliant && !response.deviation.trim() && (
                <span className="text-red-700">Required for No</span>
              )}
            </span>
            <textarea
              rows={2}
              value={response.deviation}
              onChange={(e) =>
                onChange({ ...response, deviation: e.target.value })
              }
              placeholder={
                isNonCompliant
                  ? 'Describe the non-compliance observed (e.g., Nail polish seen on 2 servers)'
                  : 'Optional inspection remark or observation'
              }
              className={`w-full px-3 py-2 text-sm bg-white border rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors resize-y ${
                isNonCompliant && !response.deviation.trim()
                  ? 'border-red-300'
                  : 'border-slate-300'
              }`}
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
              <span>Corrective Action</span>
              {isNonCompliant && !response.correctiveAction.trim() && (
                <span className="text-red-700">Required for No</span>
              )}
            </span>
            <textarea
              rows={2}
              value={response.correctiveAction}
              onChange={(e) =>
                onChange({ ...response, correctiveAction: e.target.value })
              }
              placeholder={
                isNonCompliant
                  ? 'Immediate action taken & follow-up plan (e.g., Told to remove; recheck next visit)'
                  : 'Optional follow-up action'
              }
              className={`w-full px-3 py-2 text-sm bg-white border rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors resize-y ${
                isNonCompliant && !response.correctiveAction.trim()
                  ? 'border-red-300'
                  : 'border-slate-300'
              }`}
            />
          </label>
        </div>
      )}

      {processError && (
        <p className="mt-2 pl-9 text-xs text-red-700">{processError}</p>
      )}

      {/* Photo Proof Strip */}
      {response.photos.length > 0 && (
        <div className="mt-3 pl-0 sm:pl-9">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {response.photos.map((photo, index) => {
              const hint = sourceHint(photo.takenAtSource);
              return (
                <div
                  key={photo.id}
                  className={`flex items-start gap-2.5 p-2.5 border rounded-md ${
                    photo.uploadState === 'error'
                      ? 'bg-red-50/60 border-red-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onInspectPhoto(photo)}
                    className="w-16 h-16 rounded overflow-hidden bg-slate-200 shrink-0 border border-slate-200 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                    title="Click to enlarge photo"
                  >
                    <img
                      src={photo.dataUrl}
                      alt={
                        photo.caption ||
                        `Item ${item.number} photo ${index + 1}`
                      }
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-mono font-semibold text-slate-700 tabular-nums truncate">
                        Proof {index + 1}
                        {hint ? ` · ${hint}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemovePhoto(photo.id)}
                        className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors shrink-0"
                        aria-label="Delete photo proof"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1 text-[10.5px] font-mono text-slate-500 tabular-nums mt-0.5 truncate">
                      <Clock className="w-3 h-3 shrink-0 text-slate-400" />
                      <span className="truncate">
                        {formatTakenTimestamp(photo.capturedAt)}
                      </span>
                    </div>

                    {/* Immediate Upload Status */}
                    <div className="mt-1 flex items-center gap-1.5 text-[10.5px]">
                      {photo.uploadState === 'uploading' && (
                        <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Uploading online…
                        </span>
                      )}
                      {photo.uploadState === 'synced' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CloudCheck className="w-3 h-3" />
                          Saved online
                        </span>
                      )}
                      {photo.uploadState === 'local' && (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <HardDrive className="w-3 h-3" />
                          Saved locally
                        </span>
                      )}
                      {photo.uploadState === 'error' && (
                        <div className="flex items-center gap-2 text-red-700 font-medium">
                          <span className="truncate">
                            {photo.uploadError || 'Upload failed'}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRetryPhotoUpload(photo.id)}
                            className="inline-flex items-center gap-1 underline hover:text-red-900 shrink-0"
                          >
                            <RotateCw className="w-3 h-3" />
                            Retry
                          </button>
                        </div>
                      )}
                    </div>

                    <input
                      type="text"
                      value={photo.caption}
                      onChange={(e) =>
                        onUpdatePhotoCaption(photo.id, e.target.value)
                      }
                      placeholder="Add photo caption…"
                      className="mt-1.5 w-full h-7 px-2 text-xs bg-white border border-slate-200 rounded text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-red-700"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
