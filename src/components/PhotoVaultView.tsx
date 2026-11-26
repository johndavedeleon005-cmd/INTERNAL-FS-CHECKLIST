import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  Clock,
  CloudCheck,
  Database,
  Download,
  HardDrive,
  ImagePlus,
  Loader2,
  RotateCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  formatDisplayDate,
} from '../data/checklistData';
import type {
  InspectionReport,
  PhotoProof,
  StoredPhotoRecord,
} from '../types/inspection';
import {
  compressImageFile,
  extractPhotoTakenTimestamp,
  formatTakenTimestamp,
  isSupportedImageFile,
} from '../utils/imageUtils';

interface PhotoVaultViewProps {
  report: InspectionReport;
  storedPhotos: StoredPhotoRecord[];
  onOpenCameraForItem: (itemNumber: number) => void;
  onAttachPhotosToItem: (itemNumber: number, photos: PhotoProof[]) => void;
  onRetryPhotoUpload: (itemNumber: number, photoId: string) => void;
  onUpdateCurrentPhotoCaption: (
    itemNumber: number,
    photoId: string,
    caption: string
  ) => void;
  onDeleteStoredPhoto: (record: StoredPhotoRecord) => void;
  onInspectStoredPhoto: (record: StoredPhotoRecord) => void;
}

export function PhotoVaultView({
  report,
  storedPhotos,
  onOpenCameraForItem,
  onAttachPhotosToItem,
  onRetryPhotoUpload,
  onUpdateCurrentPhotoCaption,
  onDeleteStoredPhoto,
  onInspectStoredPhoto,
}: PhotoVaultViewProps) {
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [targetItemNumber, setTargetItemNumber] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentReportPhotoMap = useMemo(() => {
    const map = new Map<string, PhotoProof>();
    for (const item of ALL_CHECKLIST_ITEMS) {
      const resp = report.responses[item.number];
      if (!resp) continue;
      for (const ph of resp.photos) {
        map.set(ph.id, ph);
      }
    }
    return map;
  }, [report.responses]);

  // Merge active inspection photos with persisted Firestore/IndexedDB photos (deduped by id)
  const mergedPhotos = useMemo(() => {
    const byId = new Map<string, StoredPhotoRecord>();

    for (const rec of storedPhotos) {
      byId.set(rec.id, rec);
    }

    // Ensure active report photos always show the freshest metadata/captions
    for (const section of CHECKLIST_SECTIONS) {
      for (const item of section.items) {
        const resp = report.responses[item.number];
        if (!resp || !resp.photos.length) continue;
        for (const photo of resp.photos) {
          byId.set(photo.id, {
            id: photo.id,
            reportId: report.id,
            storeLocation: report.meta.storeLocation || 'Current Inspection',
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

    return Array.from(byId.values()).sort((a, b) =>
      (b.capturedAt || '').localeCompare(a.capturedAt || '')
    );
  }, [storedPhotos, report]);

  const filteredPhotos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mergedPhotos.filter((rec) => {
      if (scope === 'current' && !currentReportPhotoMap.has(rec.id)) {
        return false;
      }
      if (!q) return true;
      const haystack = `${rec.itemNumber} ${rec.sectionCode} ${rec.sectionTitle} ${rec.itemText} ${rec.storeLocation} ${rec.caption} ${rec.deviation}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [mergedPhotos, scope, currentReportPhotoMap, searchQuery]);

  const currentCount = currentReportPhotoMap.size;

  const handleGalleryUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
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
            id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            dataUrl,
            caption: '',
            capturedAt: taken.iso,
            takenAtSource: taken.source,
            fileName: file.name || `item-${targetItemNumber}-proof.jpg`,
          });
        } catch {
          failedCount++;
        }
      }

      if (added.length > 0) {
        onAttachPhotosToItem(targetItemNumber, added);
      }
      if (failedCount > 0) {
        setProcessError(
          `${failedCount} file${failedCount === 1 ? '' : 's'} could not be processed as an image.`
        );
      }
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadPhoto = (rec: StoredPhotoRecord) => {
    const link = document.createElement('a');
    link.href = rec.dataUrl;
    const cleanStore = (rec.storeLocation || 'Store')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .slice(0, 28);
    link.download = `IQAF-005_Item${rec.itemNumber}_${cleanStore}_${rec.id.slice(-5)}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-[1060px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-950 tracking-tight">
            Stored Photo Proofs
          </h1>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              Photos upload immediately to Firestore when signed in (with
              original taken timestamp recorded) and remain cached locally.
            </span>
          </p>
        </div>

        {/* Direct capture/import bar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="Checklist item to attach photo to"
            value={targetItemNumber}
            onChange={(e) => setTargetItemNumber(Number(e.target.value))}
            className="h-9 max-w-[230px] px-2.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-red-700"
          >
            {CHECKLIST_SECTIONS.map((sec) => (
              <optgroup key={sec.code} label={`${sec.code}. ${sec.title}`}>
                {sec.items.map((item) => (
                  <option key={item.number} value={item.number}>
                    #{item.number} — {item.text.slice(0, 44)}
                    {item.text.length > 44 ? '…' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleGalleryUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => onOpenCameraForItem(targetItemNumber)}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            Camera
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {isProcessing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImagePlus className="w-3.5 h-3.5" />
            )}
            {isProcessing ? 'Adding…' : 'Gallery'}
          </button>
        </div>
      </div>

      {processError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700">
          {processError}
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
              scope === 'all'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Stored Photos ({mergedPhotos.length})
          </button>
          <button
            type="button"
            onClick={() => setScope('current')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
              scope === 'current'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Current Inspection ({currentCount})
          </button>
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by store, item #, or caption…"
            className="w-full h-9 pl-9 pr-8 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear photo search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stored Photos Grid */}
      {filteredPhotos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Camera className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-800">
            {mergedPhotos.length === 0
              ? 'No photo proofs stored yet'
              : 'No stored photos match this filter'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Capture with your camera or import from gallery on any checklist
            item. Every photo records the exact time it was taken and uploads
            immediately.
          </p>
          {mergedPhotos.length === 0 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => onOpenCameraForItem(targetItemNumber)}
                className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                Open Camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Import from Gallery
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPhotos.map((rec) => {
            const currentPhoto = currentReportPhotoMap.get(rec.id);
            const isInCurrent = Boolean(currentPhoto);
            const uploadState = currentPhoto?.uploadState;
            return (
              <div
                key={rec.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => onInspectStoredPhoto(rec)}
                  className="aspect-[4/3] bg-slate-100 border-b border-slate-200 overflow-hidden flex items-center justify-center hover:opacity-95 transition-opacity"
                  title="Click to inspect full photo"
                >
                  <img
                    src={rec.dataUrl}
                    alt={rec.caption || `Item ${rec.itemNumber} photo proof`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>

                <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                      <span className="font-semibold text-slate-900">
                        Item #{rec.itemNumber} ({rec.sectionCode})
                      </span>
                      <span
                        className={
                          rec.complied === 'No'
                            ? 'text-red-700 font-semibold'
                            : rec.complied === 'Yes'
                              ? 'text-emerald-700 font-semibold'
                              : 'text-slate-500'
                        }
                      >
                        {rec.complied || 'Unanswered'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 mt-1 line-clamp-2 leading-snug">
                      {rec.itemText}
                    </p>

                    <div className="text-[11px] text-slate-500 mt-1.5 truncate">
                      {rec.storeLocation || 'Untitled Store'} ·{' '}
                      {formatDisplayDate(rec.inspectionDate) || 'No date'}
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono text-slate-600 tabular-nums">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">
                        Taken: {formatTakenTimestamp(rec.capturedAt)}
                      </span>
                    </div>

                    {uploadState && (
                      <div className="mt-1 text-[11px]">
                        {uploadState === 'uploading' && (
                          <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Uploading online…
                          </span>
                        )}
                        {uploadState === 'synced' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CloudCheck className="w-3 h-3" />
                            Saved online
                          </span>
                        )}
                        {uploadState === 'local' && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <HardDrive className="w-3 h-3" />
                            Saved locally
                          </span>
                        )}
                        {uploadState === 'error' && (
                          <span className="inline-flex items-center gap-2 text-red-700 font-medium">
                            <span>Upload failed</span>
                            <button
                              type="button"
                              onClick={() =>
                                onRetryPhotoUpload(rec.itemNumber, rec.id)
                              }
                              className="inline-flex items-center gap-1 underline hover:text-red-900"
                            >
                              <RotateCw className="w-3 h-3" />
                              Retry
                            </button>
                          </span>
                        )}
                      </div>
                    )}

                    {isInCurrent ? (
                      <input
                        type="text"
                        value={rec.caption}
                        onChange={(e) =>
                          onUpdateCurrentPhotoCaption(
                            rec.itemNumber,
                            rec.id,
                            e.target.value
                          )
                        }
                        placeholder="Add photo caption…"
                        className="mt-2.5 w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-red-700"
                      />
                    ) : (
                      rec.caption && (
                        <p className="mt-2 text-xs text-slate-600 italic">
                          &ldquo;{rec.caption}&rdquo;
                        </p>
                      )
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{rec.fileName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadPhoto(rec)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100 rounded transition-colors"
                        title="Download JPG file"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteStoredPhoto(rec)}
                        className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        aria-label="Delete stored photo"
                        title="Remove from storage"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
