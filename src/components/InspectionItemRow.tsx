import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Minus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ChecklistItemDef,
  ComplianceStatus,
  ItemResponse,
  PhotoProof,
} from '../types/inspection';
import { compressImageFile } from '../utils/imageUtils';

interface InspectionItemRowProps {
  item: ChecklistItemDef;
  response: ItemResponse;
  onChange: (next: ItemResponse) => void;
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
  onInspectPhoto,
}: InspectionItemRowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  const handleFileSelection = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const added: PhotoProof[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await compressImageFile(file);
        added.push({
          id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl,
          caption: '',
          capturedAt: new Date().toISOString(),
          fileName: file.name || `item-${item.number}-proof.jpg`,
        });
      }
      if (added.length > 0) {
        onChange({
          ...response,
          photos: [...response.photos, ...added],
        });
      }
    } catch {
      setUploadError('Could not process one or more photos. Please try another image.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemovePhoto = (photoId: string) => {
    onChange({
      ...response,
      photos: response.photos.filter((p) => p.id !== photoId),
    });
  };

  const handleUpdateCaption = (photoId: string, caption: string) => {
    onChange({
      ...response,
      photos: response.photos.map((p) =>
        p.id === photoId ? { ...p, caption } : p
      ),
    });
  };

  return (
    <div
      id={`item-${item.number}`}
      className={`border-b border-slate-200 last:border-b-0 px-4 sm:px-5 py-4 transition-colors ${
        isNonCompliant ? 'bg-red-50/40' : 'bg-white hover:bg-slate-50/50'
      }`}
    >
      {/* Main row: Number + Inspection Item + Complied Controls + Photo Button */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
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
                  {response.photos.length === 1 ? 'photo attached' : 'photos attached'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Controls: Yes / No / N/A Segmented Control + Add Photo */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 pl-9 lg:pl-0 shrink-0">
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
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelection}
            className="hidden"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex items-center gap-1.5 h-10 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              response.photos.length > 0
                ? 'border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200/80'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
            title="Attach photo proof from camera or gallery"
          >
            {response.photos.length > 0 ? (
              <ImagePlus className="w-4 h-4 text-slate-700" />
            ) : (
              <Camera className="w-4 h-4 text-slate-500" />
            )}
            <span>{isUploading ? 'Adding…' : 'Photo'}</span>
          </button>
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

      {uploadError && (
        <p className="mt-2 pl-9 text-xs text-red-700">{uploadError}</p>
      )}

      {/* Photo Proof Strip */}
      {response.photos.length > 0 && (
        <div className="mt-3 pl-0 sm:pl-9">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {response.photos.map((photo, index) => (
              <div
                key={photo.id}
                className="flex items-start gap-2.5 p-2 bg-slate-50 border border-slate-200 rounded-md"
              >
                <button
                  type="button"
                  onClick={() => onInspectPhoto(photo)}
                  className="w-14 h-14 rounded overflow-hidden bg-slate-200 shrink-0 border border-slate-200 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                  title="Click to enlarge photo"
                >
                  <img
                    src={photo.dataUrl}
                    alt={photo.caption || `Item ${item.number} photo ${index + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums truncate">
                      Proof {index + 1} ·{' '}
                      {new Date(photo.capturedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(photo.id)}
                      className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors"
                      aria-label="Delete photo proof"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={photo.caption}
                    onChange={(e) =>
                      handleUpdateCaption(photo.id, e.target.value)
                    }
                    placeholder="Add photo caption…"
                    className="mt-1 w-full h-7 px-2 text-xs bg-white border border-slate-200 rounded text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-red-700"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
