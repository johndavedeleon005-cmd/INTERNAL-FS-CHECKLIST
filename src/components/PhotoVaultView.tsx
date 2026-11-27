import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  CheckSquare,
  ChevronDown,
  Clock,
  CloudCheck,
  Database,
  Download,
  HardDrive,
  ImagePlus,
  Loader2,
  Pencil,
  RotateCw,
  Search,
  Square,
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
  generatePhotoId,
  isSupportedImageFile,
} from '../utils/imageUtils';

interface PhotoVaultViewProps {
  report: InspectionReport;
  storedPhotos: StoredPhotoRecord[];
  hdUploadsEnabled?: boolean;
  onToggleHdUploads?: (enabled: boolean) => void;
  onOpenCameraForItem: (itemNumber: number) => void;
  onAttachPhotosToItem: (itemNumber: number, photos: PhotoProof[]) => void;
  onRetryPhotoUpload: (itemNumber: number, photoId: string) => void;
  onUpdateCurrentPhotoCaption: (
    itemNumber: number,
    photoId: string,
    caption: string
  ) => void;
  onDeleteStoredPhoto: (record: StoredPhotoRecord) => void;
  onBulkDeleteStoredPhotos: (records: StoredPhotoRecord[]) => Promise<void>;
  onBulkRecaptionStoredPhotos: (
    records: StoredPhotoRecord[],
    caption: string
  ) => Promise<void>;
  onInspectStoredPhoto: (record: StoredPhotoRecord) => void;
  onShowUploadDiagnostics?: () => void;
}

export function PhotoVaultView({
  report,
  storedPhotos,
  hdUploadsEnabled = true,
  onToggleHdUploads,
  onOpenCameraForItem,
  onAttachPhotosToItem,
  onRetryPhotoUpload,
  onUpdateCurrentPhotoCaption,
  onDeleteStoredPhoto,
  onBulkDeleteStoredPhotos,
  onBulkRecaptionStoredPhotos,
  onInspectStoredPhoto,
  onShowUploadDiagnostics,
}: PhotoVaultViewProps) {
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [targetItemNumber, setTargetItemNumber] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Bulk selection & bulk action state
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkActionModal, setBulkActionModal] = useState<
    'recaption' | 'delete' | null
  >(null);
  const [bulkCaptionInput, setBulkCaptionInput] = useState('');
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement | null>(null);

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

  const scopedPhotos = useMemo(() => {
    if (scope === 'current') {
      return mergedPhotos.filter((rec) => currentReportPhotoMap.has(rec.id));
    }
    return mergedPhotos;
  }, [mergedPhotos, scope, currentReportPhotoMap]);

  const { branchFilterOptions, sectionFilterCounts } = useMemo(() => {
    const byBranch = new Map<string, number>();
    const bySection = new Map<string, number>();

    for (const rec of scopedPhotos) {
      const branchName = rec.storeLocation?.trim() || 'Untitled Store';
      byBranch.set(branchName, (byBranch.get(branchName) ?? 0) + 1);
      bySection.set(
        rec.sectionCode,
        (bySection.get(rec.sectionCode) ?? 0) + 1
      );
    }

    const branches = Array.from(byBranch.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { branchFilterOptions: branches, sectionFilterCounts: bySection };
  }, [scopedPhotos]);

  const filteredPhotos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedPhotos.filter((rec) => {
      if (selectedBranch !== 'ALL') {
        const branchName = rec.storeLocation?.trim() || 'Untitled Store';
        if (branchName !== selectedBranch) return false;
      }
      if (selectedSection !== 'ALL' && rec.sectionCode !== selectedSection) {
        return false;
      }
      if (!q) return true;
      const haystack = `${rec.itemNumber} ${rec.sectionCode} ${rec.sectionTitle} ${rec.itemText} ${rec.storeLocation} ${rec.caption} ${rec.deviation}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [scopedPhotos, selectedBranch, selectedSection, searchQuery]);

  const hasActiveFilters =
    selectedBranch !== 'ALL' ||
    selectedSection !== 'ALL' ||
    searchQuery.trim() !== '';

  const currentCount = currentReportPhotoMap.size;

  const { sectionCounts, branchCounts } = useMemo(() => {
    const bySection = new Map<string, number>();
    const byBranch = new Map<string, number>();

    for (const rec of filteredPhotos) {
      bySection.set(
        rec.sectionCode,
        (bySection.get(rec.sectionCode) ?? 0) + 1
      );
      const branchName = rec.storeLocation?.trim() || 'Untitled Store';
      byBranch.set(branchName, (byBranch.get(branchName) ?? 0) + 1);
    }

    const secList = CHECKLIST_SECTIONS.filter(
      (sec) => (bySection.get(sec.code) ?? 0) > 0
    ).map((sec) => ({
      code: sec.code,
      title: sec.title,
      count: bySection.get(sec.code) ?? 0,
    }));

    const branchList = Array.from(byBranch.entries())
      .map(([branch, count]) => ({ branch, count }))
      .sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch));

    return { sectionCounts: secList, branchCounts: branchList };
  }, [filteredPhotos]);

  // Keep selected photo IDs pruned to existing records
  const mergedPhotoIdSet = useMemo(
    () => new Set(mergedPhotos.map((rec) => rec.id)),
    [mergedPhotos]
  );

  useEffect(() => {
    setSelectedPhotoIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (mergedPhotoIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mergedPhotoIdSet]);

  // Close bulk actions menu on outside click or Escape
  useEffect(() => {
    if (!bulkMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        bulkMenuRef.current &&
        !bulkMenuRef.current.contains(e.target as Node)
      ) {
        setBulkMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBulkMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [bulkMenuOpen]);

  const selectedRecords = useMemo(
    () => mergedPhotos.filter((rec) => selectedPhotoIds.has(rec.id)),
    [mergedPhotos, selectedPhotoIds]
  );

  const allFilteredSelected =
    filteredPhotos.length > 0 &&
    filteredPhotos.every((rec) => selectedPhotoIds.has(rec.id));

  const toggleSelectPhoto = (photoId: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const rec of filteredPhotos) {
          next.delete(rec.id);
        }
      } else {
        for (const rec of filteredPhotos) {
          next.add(rec.id);
        }
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedPhotoIds(new Set());
    setBulkMenuOpen(false);
  };

  const openBulkRecaptionModal = () => {
    setBulkMenuOpen(false);
    // Pre-fill only if all selected photos share the exact same non-empty caption
    const uniqueCaptions = new Set(
      selectedRecords.map((r) => (r.caption ?? '').trim())
    );
    const shared =
      uniqueCaptions.size === 1 ? Array.from(uniqueCaptions)[0] : '';
    setBulkCaptionInput(shared);
    setBulkActionModal('recaption');
  };

  const openBulkDeleteModal = () => {
    setBulkMenuOpen(false);
    setBulkActionModal('delete');
  };

  const handleConfirmBulkRecaption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRecords.length === 0 || isBulkRunning) return;
    setIsBulkRunning(true);
    try {
      await onBulkRecaptionStoredPhotos(selectedRecords, bulkCaptionInput);
      setBulkActionModal(null);
      setBulkCaptionInput('');
      setSelectedPhotoIds(new Set());
    } finally {
      setIsBulkRunning(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedRecords.length === 0 || isBulkRunning) return;
    setIsBulkRunning(true);
    try {
      await onBulkDeleteStoredPhotos(selectedRecords);
      setBulkActionModal(null);
      setSelectedPhotoIds(new Set());
    } finally {
      setIsBulkRunning(false);
    }
  };

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
            compressImageFile(file, { hd: hdUploadsEnabled }),
            extractPhotoTakenTimestamp(file, false),
          ]);
          added.push({
            id: generatePhotoId(),
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
              All photos auto-save locally and auto-sync to the cloud when
              online, with original taken timestamps recorded.
            </span>
          </p>
        </div>

        {/* Direct capture/import bar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onToggleHdUploads && (
            <button
              type="button"
              role="switch"
              aria-checked={hdUploadsEnabled}
              onClick={() => onToggleHdUploads(!hdUploadsEnabled)}
              title={
                hdUploadsEnabled
                  ? 'HD Uploads ON — up to 1920px Full-HD resolution'
                  : 'Standard Uploads — up to 1280px lighter resolution'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 h-9 text-xs font-semibold border rounded-lg transition-colors whitespace-nowrap ${
                hdUploadsEnabled
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  hdUploadsEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              {hdUploadsEnabled ? 'HD Uploads' : 'Standard'}
            </button>
          )}
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
      <div className="space-y-3">
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

          <div className="flex items-center gap-2 flex-1 sm:justify-end">
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

            <button
              type="button"
              aria-pressed={showSummary}
              onClick={() => setShowSummary((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                showSummary
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Summary Counts
            </button>
          </div>
        </div>

        {/* Branch & Checklist Section Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by branch"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 max-w-full sm:max-w-[250px]"
          >
            <option value="ALL">
              All Branches ({scopedPhotos.length})
            </option>
            {branchFilterOptions.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} ({b.count})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by checklist section"
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 max-w-full sm:max-w-[300px]"
          >
            <option value="ALL">All Checklist Sections (A–Q)</option>
            {CHECKLIST_SECTIONS.map((sec) => {
              const count = sectionFilterCounts.get(sec.code) ?? 0;
              return (
                <option key={sec.code} value={sec.code}>
                  {sec.code}. {sec.title} ({count})
                </option>
              );
            })}
          </select>

          {filteredPhotos.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-red-700" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400" />
              )}
              {allFilteredSelected
                ? `Deselect Shown (${filteredPhotos.length})`
                : `Select Shown (${filteredPhotos.length})`}
            </button>
          )}

          {hasActiveFilters && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-500 tabular-nums">
                Showing {filteredPhotos.length} of {scopedPhotos.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedBranch('ALL');
                  setSelectedSection('ALL');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Reset Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Selection & Bulk-Action Menu Bar */}
      {selectedRecords.length > 0 && (
        <div
          role="region"
          aria-label="Bulk photo actions"
          className="bg-slate-900 text-white rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold tabular-nums">
              {selectedRecords.length}{' '}
              {selectedRecords.length === 1 ? 'photo' : 'photos'} selected
            </span>
            {filteredPhotos.length > 0 && !allFilteredSelected && (
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="text-slate-300 hover:text-white underline underline-offset-2 whitespace-nowrap"
              >
                Select all {filteredPhotos.length} shown
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="text-slate-300 hover:text-white underline underline-offset-2 whitespace-nowrap"
            >
              Clear selection
            </button>
          </div>

          <div ref={bulkMenuRef} className="relative flex items-center gap-2">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={bulkMenuOpen}
              disabled={isBulkRunning}
              onClick={() => setBulkMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-semibold text-slate-950 bg-white hover:bg-slate-100 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {isBulkRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckSquare className="w-3.5 h-3.5 text-red-700" />
              )}
              <span>Bulk Actions</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  bulkMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {bulkMenuOpen && (
              <div
                role="menu"
                aria-label="Bulk photo action options"
                className="absolute right-0 top-full mt-2 w-56 bg-white text-slate-900 border border-slate-200 rounded-xl shadow-lg z-30 py-1.5 overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={openBulkRecaptionModal}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>
                    Re-caption selected ({selectedRecords.length})
                  </span>
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={openBulkDeleteModal}
                  className="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>
                    Delete selected ({selectedRecords.length})
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsible Photo Count Summary (per Section & per Branch) */}
      {showSummary && (
        <section
          aria-label="Photo count summary by section and branch"
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Photo Summary Counts
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {filteredPhotos.length}{' '}
                {filteredPhotos.length === 1 ? 'photo' : 'photos'} across{' '}
                {sectionCounts.length}{' '}
                {sectionCounts.length === 1 ? 'section' : 'sections'} and{' '}
                {branchCounts.length}{' '}
                {branchCounts.length === 1 ? 'branch' : 'branches'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSummary(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap"
            >
              Hide Summary
            </button>
          </div>

          {filteredPhotos.length === 0 ? (
            <p className="text-xs text-slate-500">
              No photos match the current filter to summarize.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Per Checklist Section */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>By Checklist Section</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {sectionCounts.length}{' '}
                    {sectionCounts.length === 1 ? 'section' : 'sections'}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {sectionCounts.map((sec) => {
                    const isSecSelected = selectedSection === sec.code;
                    return (
                      <button
                        key={sec.code}
                        type="button"
                        onClick={() =>
                          setSelectedSection(isSecSelected ? 'ALL' : sec.code)
                        }
                        className={`w-full px-3.5 py-2 flex items-center justify-between gap-3 text-xs text-left transition-colors ${
                          isSecSelected
                            ? 'bg-red-50/70 text-red-900'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">
                          <span className="font-semibold text-slate-900">
                            {sec.code}.
                          </span>{' '}
                          {sec.title}
                        </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                          {sec.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Per Branch */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>By Branch</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {branchCounts.length}{' '}
                    {branchCounts.length === 1 ? 'branch' : 'branches'}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {branchCounts.map((b) => {
                    const isBranchSelected = selectedBranch === b.branch;
                    return (
                      <button
                        key={b.branch}
                        type="button"
                        onClick={() =>
                          setSelectedBranch(
                            isBranchSelected ? 'ALL' : b.branch
                          )
                        }
                        className={`w-full px-3.5 py-2 flex items-center justify-between gap-3 text-xs text-left transition-colors ${
                          isBranchSelected
                            ? 'bg-red-50/70 text-red-900'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-slate-800 font-medium truncate">
                          {b.branch}
                        </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                          {b.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

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
            const isSelected = selectedPhotoIds.has(rec.id);
            return (
              <div
                key={rec.id}
                className={`bg-white border rounded-xl overflow-hidden flex flex-col transition-shadow ${
                  isSelected
                    ? 'border-red-700 ring-2 ring-red-700/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="relative aspect-[4/3] bg-slate-100 border-b border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => onInspectStoredPhoto(rec)}
                    className="w-full h-full flex items-center justify-center hover:opacity-95 transition-opacity"
                    title="Click to inspect full photo"
                  >
                    <img
                      src={rec.dataUrl}
                      alt={rec.caption || `Item ${rec.itemNumber} photo proof`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>

                  <label
                    className={`absolute top-2.5 left-2.5 z-10 inline-flex items-center justify-center w-7 h-7 rounded-md border shadow-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-red-700 border-red-800'
                        : 'bg-white/95 border-slate-300 hover:bg-white'
                    }`}
                    title={
                      isSelected ? 'Deselect photo' : 'Select photo for bulk action'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectPhoto(rec.id)}
                      aria-label={`Select photo for Item #${rec.itemNumber} (${rec.storeLocation || 'Untitled Store'})`}
                      className="w-4 h-4 accent-red-700 cursor-pointer"
                    />
                  </label>
                </div>

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
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-red-700 font-medium">
                            <span className="truncate">
                              {currentPhoto?.uploadError || 'Upload failed'}
                            </span>
                            {currentPhoto?.uploadErrorCode && (
                              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-800 shrink-0">
                                {currentPhoto.uploadErrorCode}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onRetryPhotoUpload(rec.itemNumber, rec.id)
                              }
                              className="inline-flex items-center gap-1 underline hover:text-red-900 shrink-0"
                            >
                              <RotateCw className="w-3 h-3" />
                              Retry
                            </button>
                            {onShowUploadDiagnostics && (
                              <button
                                type="button"
                                onClick={onShowUploadDiagnostics}
                                className="underline text-red-600 hover:text-red-900 shrink-0"
                              >
                                Details
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    )}

                    {isInCurrent ? (
                      <input
                        type="text"
                        value={rec.caption}
                        maxLength={500}
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

      {/* Bulk Re-Caption Modal */}
      {bulkActionModal === 'recaption' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-recaption-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <form
            onSubmit={(e) => void handleConfirmBulkRecaption(e)}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-slate-700" />
                <h2
                  id="bulk-recaption-title"
                  className="text-sm font-bold text-slate-950"
                >
                  Re-caption {selectedRecords.length}{' '}
                  {selectedRecords.length === 1 ? 'Photo' : 'Photos'}
                </h2>
              </div>
              <button
                type="button"
                disabled={isBulkRunning}
                onClick={() => setBulkActionModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
                aria-label="Close re-caption dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter the caption to apply simultaneously to all{' '}
                <strong className="text-slate-900">
                  {selectedRecords.length}
                </strong>{' '}
                selected {selectedRecords.length === 1 ? 'photo' : 'photos'}.
                Leave blank to clear existing captions.
              </p>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-800">
                  New Caption
                </span>
                <input
                  type="text"
                  autoFocus
                  maxLength={500}
                  value={bulkCaptionInput}
                  onChange={(e) => setBulkCaptionInput(e.target.value)}
                  placeholder="e.g., Cold storage chiller temperature verification…"
                  className="w-full h-10 px-3 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                />
                <span className="block text-right text-[11px] font-mono text-slate-400 tabular-nums">
                  {bulkCaptionInput.length}/500
                </span>
              </label>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isBulkRunning}
                onClick={() => setBulkActionModal(null)}
                className="px-3.5 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBulkRunning}
                className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {isBulkRunning && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>
                  {isBulkRunning
                    ? 'Updating…'
                    : `Apply to ${selectedRecords.length} ${selectedRecords.length === 1 ? 'Photo' : 'Photos'}`}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkActionModal === 'delete' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h2
                  id="bulk-delete-title"
                  className="text-sm font-bold text-slate-950"
                >
                  Delete {selectedRecords.length}{' '}
                  {selectedRecords.length === 1 ? 'Photo' : 'Photos'}?
                </h2>
              </div>
              <button
                type="button"
                disabled={isBulkRunning}
                onClick={() => setBulkActionModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
                aria-label="Close delete confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                This will permanently remove{' '}
                <strong className="text-slate-950">
                  {selectedRecords.length}
                </strong>{' '}
                selected {selectedRecords.length === 1 ? 'photo' : 'photos'}{' '}
                from their checklist items, local device storage, and synced
                cloud storage.
              </p>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isBulkRunning}
                onClick={() => setBulkActionModal(null)}
                className="px-3.5 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkRunning}
                onClick={() => void handleConfirmBulkDelete()}
                className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {isBulkRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {isBulkRunning
                    ? 'Deleting…'
                    : `Delete ${selectedRecords.length} ${selectedRecords.length === 1 ? 'Photo' : 'Photos'}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
