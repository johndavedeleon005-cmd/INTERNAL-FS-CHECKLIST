import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Cloud,
  CloudUpload,
  CopyPlus,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Save,
  Search,
  Share2,
  Sparkles,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  TOTAL_ITEMS_COUNT,
  formatDisplayDate,
  formatReportNo,
  resolveReportSequenceMap,
  type ReportSequenceRecord,
} from '../data/checklistData';
import type {
  InspectionReport,
  PdfExportOptions,
  ReportCollaborationInfo,
} from '../types/inspection';
import type { CloudReportSummary } from '../utils/cloudReports';
import { BlankSheetMenuButton } from './BlankSheetMenuButton';

export interface MergedReportSelectionItem {
  id: string;
  source: 'cloud' | 'shared' | 'local';
}

interface ReportsLibraryViewProps {
  user: User | null;
  authReady: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  isSigningIn: boolean;
  currentReport: InspectionReport;
  activeCollaboration: ReportCollaborationInfo | null;
  hasUnsavedCloudChanges: boolean;
  isSavingOnline: boolean;
  cloudReports: CloudReportSummary[];
  sharedReports: CloudReportSummary[];
  loadingCloudReports: boolean;
  localReports: InspectionReport[];
  busyReportId: string | null;
  isExportingMergedPdf: boolean;
  mergedPdfProgress: { current: number; total: number } | null;
  exportOptions: PdfExportOptions;
  onChangeExportOptions: (next: PdfExportOptions) => void;
  onCreateNewReport: () => void;
  onLoadSampleReport: () => void;
  onDownloadBlankPdf: () => Promise<void>;
  onDownloadBlankExcel: () => Promise<void>;
  onDownloadBlankDocx: () => Promise<void>;
  onSaveCurrentReport: () => Promise<void>;
  onShareCloudReport: (summary: CloudReportSummary) => void;
  onDuplicateCloudReport: (reportId: string) => Promise<void>;
  onLeaveSharedReport: (reportId: string) => Promise<void>;
  onEditCloudReport: (reportId: string) => Promise<void>;
  onPreviewCloudReport: (reportId: string) => Promise<void>;
  onDownloadCloudReportPdf: (reportId: string) => Promise<void>;
  onDownloadCloudReportExcel: (reportId: string) => Promise<void>;
  onDownloadCloudReportDocx: (reportId: string) => Promise<void>;
  onEmailCloudReport: (reportId: string) => Promise<void>;
  onDeleteCloudReport: (reportId: string) => Promise<void>;
  onExportMergedPdf: (items: MergedReportSelectionItem[]) => Promise<void>;
  onEditLocalReport: (report: InspectionReport) => void;
  onUploadLocalReportToCloud: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportPdf: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportExcel: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportDocx: (report: InspectionReport) => Promise<void>;
  onEmailLocalReport: (report: InspectionReport) => void;
  onDeleteLocalReport: (id: string) => Promise<void>;
}

function summarizeLocalReport(report: InspectionReport) {
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
  return { answered, yes, no, na, photoCount };
}

export function ReportsLibraryView({
  user,
  authReady,
  onSignIn,
  onSignOut,
  isSigningIn,
  currentReport,
  activeCollaboration,
  hasUnsavedCloudChanges,
  isSavingOnline,
  cloudReports,
  sharedReports,
  loadingCloudReports,
  localReports,
  busyReportId,
  isExportingMergedPdf,
  mergedPdfProgress,
  exportOptions,
  onChangeExportOptions,
  onCreateNewReport,
  onLoadSampleReport,
  onDownloadBlankPdf,
  onDownloadBlankExcel,
  onDownloadBlankDocx,
  onSaveCurrentReport,
  onShareCloudReport,
  onDuplicateCloudReport,
  onLeaveSharedReport,
  onEditCloudReport,
  onPreviewCloudReport,
  onDownloadCloudReportPdf,
  onDownloadCloudReportExcel,
  onDownloadCloudReportDocx,
  onEmailCloudReport,
  onDeleteCloudReport,
  onExportMergedPdf,
  onEditLocalReport,
  onUploadLocalReportToCloud,
  onDownloadLocalReportPdf,
  onDownloadLocalReportExcel,
  onDownloadLocalReportDocx,
  onEmailLocalReport,
  onDeleteLocalReport,
}: ReportsLibraryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const cloudIds = useMemo(
    () =>
      new Set([
        ...cloudReports.map((r) => r.id),
        ...sharedReports.map((r) => r.id),
      ]),
    [cloudReports, sharedReports]
  );

  // Local-only reports not already synced in cloudReports
  const localOnlyReports = useMemo(
    () => localReports.filter((r) => !cloudIds.has(r.id)),
    [localReports, cloudIds]
  );

  const sequenceMap = useMemo(() => {
    const records: ReportSequenceRecord[] = [
      ...cloudReports.map((r) => ({
        id: r.id,
        storeLocation: r.storeLocation,
        dateOfInspection: r.dateOfInspection,
        reportSequence: r.reportSequence,
        createdAt: r.createdAtIso,
        updatedAt: r.updatedAtIso,
      })),
      ...sharedReports.map((r) => ({
        id: r.id,
        storeLocation: r.storeLocation,
        dateOfInspection: r.dateOfInspection,
        reportSequence: r.reportSequence,
        createdAt: r.createdAtIso,
        updatedAt: r.updatedAtIso,
      })),
      ...localReports.map((r) => ({
        id: r.id,
        storeLocation: r.meta.storeLocation,
        dateOfInspection: r.meta.dateOfInspection,
        reportSequence: r.meta.reportSequence,
        updatedAt: r.updatedAt,
      })),
      {
        id: currentReport.id,
        storeLocation: currentReport.meta.storeLocation,
        dateOfInspection: currentReport.meta.dateOfInspection,
        reportSequence: currentReport.meta.reportSequence,
        updatedAt: currentReport.updatedAt,
      },
    ];
    return resolveReportSequenceMap(records);
  }, [cloudReports, sharedReports, localReports, currentReport]);

  const getFormattedReportNo = (
    id: string,
    storeLocation: string,
    dateOfInspection: string,
    explicitSeq?: number
  ) =>
    formatReportNo(
      storeLocation,
      dateOfInspection,
      explicitSeq ?? sequenceMap.get(id)
    );

  const q = searchQuery.trim().toLowerCase();

  const filteredCloudReports = useMemo(() => {
    if (!q) return cloudReports;
    return cloudReports.filter((r) =>
      `${r.storeLocation} ${r.inspectedBy} ${r.dateOfInspection} ${r.documentationNo} ${formatReportNo(r.storeLocation, r.dateOfInspection, r.reportSequence ?? sequenceMap.get(r.id))}`
        .toLowerCase()
        .includes(q)
    );
  }, [cloudReports, q, sequenceMap]);

  const filteredSharedReports = useMemo(() => {
    if (!q) return sharedReports;
    return sharedReports.filter((r) =>
      `${r.storeLocation} ${r.inspectedBy} ${r.ownerName} ${r.dateOfInspection} ${r.documentationNo} ${formatReportNo(r.storeLocation, r.dateOfInspection, r.reportSequence ?? sequenceMap.get(r.id))}`
        .toLowerCase()
        .includes(q)
    );
  }, [sharedReports, q, sequenceMap]);

  const filteredLocalReports = useMemo(() => {
    if (!q) return localOnlyReports;
    return localOnlyReports.filter((r) =>
      `${r.meta.storeLocation} ${r.meta.inspectedBy} ${r.meta.dateOfInspection} ${r.meta.documentationNo} ${formatReportNo(r.meta.storeLocation, r.meta.dateOfInspection, r.meta.reportSequence ?? sequenceMap.get(r.id))}`
        .toLowerCase()
        .includes(q)
    );
  }, [localOnlyReports, q, sequenceMap]);

  const currentStats = useMemo(
    () => summarizeLocalReport(currentReport),
    [currentReport]
  );

  const allSelectableItems = useMemo<MergedReportSelectionItem[]>(() => {
    const items: MergedReportSelectionItem[] = [];
    cloudReports.forEach((r) => items.push({ id: r.id, source: 'cloud' }));
    sharedReports.forEach((r) => items.push({ id: r.id, source: 'shared' }));
    if (localOnlyReports.length > 0) {
      localOnlyReports.forEach((r) => items.push({ id: r.id, source: 'local' }));
    }
    return items;
  }, [cloudReports, sharedReports, localOnlyReports]);

  const visibleSelectableIds = useMemo(() => {
    const ids: string[] = [];
    filteredCloudReports.forEach((r) => ids.push(r.id));
    filteredSharedReports.forEach((r) => ids.push(r.id));
    if (filteredLocalReports.length > 0) {
      filteredLocalReports.forEach((r) => ids.push(r.id));
    }
    return ids;
  }, [filteredCloudReports, filteredSharedReports, filteredLocalReports]);

  const selectedOrderedItems = useMemo(
    () => allSelectableItems.filter((item) => selectedIds.has(item.id)),
    [allSelectableItems, selectedIds]
  );

  const selectedCount = selectedOrderedItems.length;
  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((id) => selectedIds.has(id));

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectGroup = (ids: string[]) => {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allGroupSelected = ids.every((id) => next.has(id));
      if (allGroupSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  return (
    <div className="max-w-[1060px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-950 tracking-tight">
            Inspection Reports
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Create new IQAF-005 reports, save online with photo proofs, reopen
            to edit anytime, and download PDF, Word (.docx), or Excel reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <BlankSheetMenuButton
            size="md"
            onDownloadBlankPdf={onDownloadBlankPdf}
            onDownloadBlankExcel={onDownloadBlankExcel}
            onDownloadBlankDocx={onDownloadBlankDocx}
          />
          <button
            type="button"
            onClick={onLoadSampleReport}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-500" />
            Sample Report
          </button>
          <button
            type="button"
            onClick={onSaveCurrentReport}
            disabled={isSavingOnline}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {isSavingOnline ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {isSavingOnline ? 'Saving…' : 'Save Current Online'}
          </button>
          <button
            type="button"
            onClick={onCreateNewReport}
            className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            New Report
          </button>
        </div>
      </div>

      {/* Online Cloud Storage Account Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {!authReady ? (
          <div className="flex items-center gap-2.5 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            <span>Checking online sync session…</span>
          </div>
        ) : user ? (
          <>
            <div className="flex items-start gap-3 min-w-0">
              <Cloud className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Online Cloud Storage Connected
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  Signed in as{' '}
                  <span className="font-medium text-slate-700">
                    {user.displayName || user.email}
                  </span>
                  {user.displayName && user.email ? ` (${user.email})` : ''} ·{' '}
                  {cloudReports.length}{' '}
                  {cloudReports.length === 1 ? 'report' : 'reports'} owned
                  {sharedReports.length > 0
                    ? ` · ${sharedReports.length} shared with you`
                    : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <Cloud className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Public Online Database Connected
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Public cloud saving is enabled ({cloudReports.length} online{' '}
                  {cloudReports.length === 1 ? 'report' : 'reports'}). Optionally
                  sign in with Google to manage email sharing permissions.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="inline-flex items-center gap-2 px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              {isSigningIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
              )}
              {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
            </button>
          </>
        )}
      </section>

      {/* Active Working Report Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500">
            Currently Open in Editor
            {activeCollaboration && activeCollaboration.accessRole !== 'owner' && (
              <span className="ml-2 text-slate-700 font-medium">
                · Shared by {activeCollaboration.ownerName} (
                {activeCollaboration.accessRole === 'editor'
                  ? 'Editor'
                  : 'View Only'}
                )
              </span>
            )}
          </div>
          <div className="text-sm font-bold text-slate-950 mt-0.5 truncate">
            {currentReport.meta.storeLocation || 'Untitled Store Inspection'}
          </div>
          <div className="text-[11px] font-mono font-semibold text-slate-600 mt-0.5 truncate">
            Report No.:{' '}
            {getFormattedReportNo(
              currentReport.id,
              currentReport.meta.storeLocation,
              currentReport.meta.dateOfInspection,
              currentReport.meta.reportSequence
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>
              {formatDisplayDate(currentReport.meta.dateOfInspection) ||
                'No date'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {currentReport.meta.inspectedBy || 'Inspector not set'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-700">
              {currentStats.answered}/{TOTAL_ITEMS_COUNT} checked ·{' '}
              {currentStats.no} No · {currentStats.photoCount} photos
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                hasUnsavedCloudChanges
                  ? 'text-amber-700 font-medium'
                  : 'text-emerald-700 font-medium'
              }
            >
              {hasUnsavedCloudChanges ? 'Unsaved edits' : 'Synced online'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeCollaboration?.accessRole !== 'viewer' && (
            <button
              type="button"
              onClick={onSaveCurrentReport}
              disabled={isSavingOnline}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
            >
              {isSavingOnline ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Online
            </button>
          )}
          <button
            type="button"
            onClick={() => onEmailLocalReport(currentReport)}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </button>
          <button
            type="button"
            onClick={() => onDownloadLocalReportDocx(currentReport)}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            DOCX
          </button>
          <button
            type="button"
            onClick={() => onDownloadLocalReportExcel(currentReport)}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => onDownloadLocalReportPdf(currentReport)}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </section>

      {/* Search & Merged PDF Export Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reports by store location, inspector, or date…"
            className="w-full h-9 pl-9 pr-8 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear report search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label
            className="inline-flex items-center gap-1.5 px-2.5 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer select-none whitespace-nowrap"
            title="Stamp diagonal CONFIDENTIAL watermark across every page in exported PDFs"
          >
            <input
              type="checkbox"
              checked={exportOptions.includeConfidentialWatermark !== false}
              onChange={(e) =>
                onChangeExportOptions({
                  ...exportOptions,
                  includeConfidentialWatermark: e.target.checked,
                })
              }
              className="rounded border-slate-300 text-red-700 focus:ring-red-700"
            />
            <span>CONFIDENTIAL Watermark</span>
          </label>
          {visibleSelectableIds.length > 0 && (
            <button
              type="button"
              disabled={isExportingMergedPdf}
              onClick={() => toggleSelectGroup(visibleSelectableIds)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {allVisibleSelected ? 'Deselect All' : 'Select All Visible'}
            </button>
          )}
          {selectedCount > 0 && (
            <button
              type="button"
              disabled={isExportingMergedPdf}
              onClick={clearSelection}
              className="inline-flex items-center gap-1 px-2.5 h-9 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap tabular-nums"
            >
              <X className="w-3.5 h-3.5" />
              Clear ({selectedCount})
            </button>
          )}
          <button
            type="button"
            disabled={selectedCount === 0 || isExportingMergedPdf}
            onClick={() => onExportMergedPdf(selectedOrderedItems)}
            title={
              selectedCount === 0
                ? 'Select one or more reports below to merge into a single PDF'
                : `Export ${selectedCount} selected ${selectedCount === 1 ? 'report' : 'reports'} into one merged PDF`
            }
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:bg-slate-200 disabled:text-slate-500 rounded-lg transition-colors whitespace-nowrap tabular-nums"
          >
            {isExportingMergedPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Files className="w-3.5 h-3.5" />
            )}
            {isExportingMergedPdf
              ? mergedPdfProgress && mergedPdfProgress.total > 0
                ? `Merging ${mergedPdfProgress.current}/${mergedPdfProgress.total}…`
                : 'Merging PDF…'
              : selectedCount > 0
                ? `Export Merged PDF (${selectedCount})`
                : 'Export Merged PDF'}
          </button>
        </div>
      </div>

      {/* Online Saved Reports Table */}
      {authReady && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Online Reports ({filteredCloudReports.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stored securely in Firestore with attached photo proofs — edit,
                select to merge, or download anytime
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {filteredCloudReports.length > 0 && (
                <button
                  type="button"
                  disabled={isExportingMergedPdf}
                  onClick={() =>
                    toggleSelectGroup(filteredCloudReports.map((r) => r.id))
                  }
                  className="px-2.5 h-7 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                >
                  {filteredCloudReports.every((r) => selectedIds.has(r.id))
                    ? 'Deselect Section'
                    : 'Select All'}
                </button>
              )}
              <Cloud className="w-4 h-4 text-emerald-700 shrink-0" />
            </div>
          </div>

          {loadingCloudReports ? (
            <div className="p-8 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading online reports…</span>
            </div>
          ) : filteredCloudReports.length === 0 ? (
            <div className="p-10 text-center">
              <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
              <p className="text-sm font-semibold text-slate-800">
                {cloudReports.length === 0
                  ? 'No reports saved online yet'
                  : 'No online reports match your search'}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Click &ldquo;Save Current Online&rdquo; to store your active
                checklist and photo proofs in the cloud, or start a new report.
              </p>
              {cloudReports.length === 0 && (
                <button
                  type="button"
                  onClick={onSaveCurrentReport}
                  disabled={isSavingOnline}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Current Report Online
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredCloudReports.map((item) => {
                const isActive = item.id === currentReport.id;
                const isBusy = busyReportId === item.id;
                const isSelected = selectedIds.has(item.id);
                const applicable = item.stats.yes + item.stats.no;
                const score =
                  applicable > 0
                    ? Math.round((item.stats.yes / applicable) * 100)
                    : null;

                return (
                  <div
                    key={item.id}
                    className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-slate-50'
                        : isActive
                          ? 'bg-red-50/35'
                          : 'bg-white hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExportingMergedPdf}
                        onChange={() => toggleSelectId(item.id)}
                        aria-label={`Select ${item.storeLocation || 'report'} for merged PDF`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-red-700 accent-red-700 focus:ring-red-700 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-slate-950 truncate">
                            {item.storeLocation || 'Untitled Store Location'}
                          </span>
                          {isActive && (
                            <span className="text-[11px] font-semibold text-red-700">
                              · Open in Editor
                            </span>
                          )}
                        </div>
                      <div className="text-[11px] font-mono text-slate-600 mt-0.5 truncate">
                        Report No.:{' '}
                        {getFormattedReportNo(
                          item.id,
                          item.storeLocation,
                          item.dateOfInspection,
                          item.reportSequence
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>
                          {formatDisplayDate(item.dateOfInspection) ||
                            'No date'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.inspectedBy || 'No inspector'}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Updated{' '}
                          {new Date(item.updatedAtIso).toLocaleString([], {
                            month: 'short',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-mono tabular-nums text-slate-600 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span>
                          {item.stats.answered}/{TOTAL_ITEMS_COUNT} checked
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700">
                          {item.stats.yes} Yes
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            item.stats.no > 0
                              ? 'text-red-700 font-semibold'
                              : ''
                          }
                        >
                          {item.stats.no} No
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.stats.photoCount} photos</span>
                        {score !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-slate-900">
                              Score {score}%
                            </span>
                          </>
                        )}
                        {(item.sharedWithEmails.length > 0 ||
                          item.activeShareLinkId) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-emerald-700">
                              {item.activeShareLinkId ? (
                                <Link2 className="w-3 h-3" />
                              ) : (
                                <Users className="w-3 h-3" />
                              )}
                              {item.sharedWithEmails.length > 0
                                ? `Shared (${item.sharedWithEmails.length})`
                                : 'Link active'}
                            </span>
                          </>
                        )}
                      </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEditCloudReport(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Pencil className="w-3.5 h-3.5" />
                        )}
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onShareCloudReport(item)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Share
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onPreviewCloudReport(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        Preview
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEmailCloudReport(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Email
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportDocx(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        DOCX
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportExcel(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Excel
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportPdf(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDuplicateCloudReport(item.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
                        aria-label="Duplicate report"
                        title="Duplicate report"
                      >
                        <CopyPlus className="w-4 h-4" />
                      </button>

                      {confirmDeleteId === item.id ? (
                        <div className="inline-flex items-center gap-1.5 ml-1">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              await onDeleteCloudReport(item.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2.5 h-8 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md whitespace-nowrap"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 h-8 text-xs text-slate-600 hover:text-slate-900"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                          aria-label="Delete online report"
                          title="Delete online report"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Shared With Me Reports */}
      {user && (sharedReports.length > 0 || filteredSharedReports.length > 0) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Shared With Me ({filteredSharedReports.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Reports shared with {user.email} — collaborate in real time or
                export PDF/Excel copies
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {filteredSharedReports.length > 0 && (
                <button
                  type="button"
                  disabled={isExportingMergedPdf}
                  onClick={() =>
                    toggleSelectGroup(filteredSharedReports.map((r) => r.id))
                  }
                  className="px-2.5 h-7 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                >
                  {filteredSharedReports.every((r) => selectedIds.has(r.id))
                    ? 'Deselect Section'
                    : 'Select All'}
                </button>
              )}
              <Users className="w-4 h-4 text-slate-500 shrink-0" />
            </div>
          </div>

          {filteredSharedReports.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No shared reports match your search.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredSharedReports.map((item) => {
                const isActive = item.id === currentReport.id;
                const isBusy = busyReportId === item.id;
                const isSelected = selectedIds.has(item.id);
                const isEditor = item.accessRole === 'editor';
                const applicable = item.stats.yes + item.stats.no;
                const score =
                  applicable > 0
                    ? Math.round((item.stats.yes / applicable) * 100)
                    : null;

                return (
                  <div
                    key={item.id}
                    className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-slate-50'
                        : isActive
                          ? 'bg-red-50/35'
                          : 'bg-white hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExportingMergedPdf}
                        onChange={() => toggleSelectId(item.id)}
                        aria-label={`Select shared report ${item.storeLocation || 'report'} for merged PDF`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-red-700 accent-red-700 focus:ring-red-700 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-slate-950 truncate">
                            {item.storeLocation || 'Untitled Store Location'}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              isEditor ? 'text-emerald-700' : 'text-slate-600'
                            }`}
                          >
                            · {isEditor ? 'Can Edit' : 'View Only'}
                          </span>
                          {isActive && (
                            <span className="text-[11px] font-semibold text-red-700">
                              · Open
                            </span>
                          )}
                        </div>
                      <div className="text-[11px] font-mono text-slate-600 mt-0.5 truncate">
                        Report No.:{' '}
                        {getFormattedReportNo(
                          item.id,
                          item.storeLocation,
                          item.dateOfInspection,
                          item.reportSequence
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>Shared by {item.ownerName}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {formatDisplayDate(item.dateOfInspection) ||
                            'No date'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Updated{' '}
                          {new Date(item.updatedAtIso).toLocaleString([], {
                            month: 'short',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-mono tabular-nums text-slate-600 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span>
                          {item.stats.answered}/{TOTAL_ITEMS_COUNT} checked
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700">
                          {item.stats.yes} Yes
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            item.stats.no > 0
                              ? 'text-red-700 font-semibold'
                              : ''
                          }
                        >
                          {item.stats.no} No
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.stats.photoCount} photos</span>
                        {score !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-slate-900">
                              Score {score}%
                            </span>
                          </>
                        )}
                      </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEditCloudReport(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isEditor ? (
                          <Pencil className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        {isEditor ? 'Edit' : 'Open'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onPreviewCloudReport(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        Preview
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportDocx(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        DOCX
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportExcel(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Excel
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDownloadCloudReportPdf(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDuplicateCloudReport(item.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
                        aria-label="Duplicate to My Reports"
                        title="Duplicate to My Reports"
                      >
                        <CopyPlus className="w-4 h-4" />
                      </button>
                      {confirmLeaveId === item.id ? (
                        <div className="inline-flex items-center gap-1.5 ml-1">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              await onLeaveSharedReport(item.id);
                              setConfirmLeaveId(null);
                            }}
                            className="px-2.5 h-8 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                          >
                            Confirm Leave
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmLeaveId(null)}
                            className="px-2 h-8 text-xs text-slate-600 hover:text-slate-900"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmLeaveId(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                          aria-label="Leave shared report"
                          title="Leave shared report"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Local Browser Reports (shown if user is signed out OR has unsynced local snapshots) */}
      {(!user || filteredLocalReports.length > 0) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Local Browser Snapshots ({filteredLocalReports.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {user
                  ? 'Saved locally on this device — upload any snapshot to sync it online'
                  : 'Saved locally in IndexedDB — sign in with Google above to sync reports online'}
              </p>
            </div>
            {filteredLocalReports.length > 0 && (
              <button
                type="button"
                disabled={isExportingMergedPdf}
                onClick={() =>
                  toggleSelectGroup(filteredLocalReports.map((r) => r.id))
                }
                className="px-2.5 h-7 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {filteredLocalReports.every((r) => selectedIds.has(r.id))
                  ? 'Deselect Section'
                  : 'Select All'}
              </button>
            )}
          </div>

          {filteredLocalReports.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No local snapshots saved yet. Click &ldquo;Save Locally&rdquo; or
              sign in to save reports online.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredLocalReports.map((entry) => {
                const st = summarizeLocalReport(entry);
                const isBusy = busyReportId === entry.id;
                const isSelected = selectedIds.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    className={`px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-slate-50'
                        : 'bg-white hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="min-w-0 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExportingMergedPdf}
                        onChange={() => toggleSelectId(entry.id)}
                        aria-label={`Select local snapshot ${entry.meta.storeLocation || 'report'} for merged PDF`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-red-700 accent-red-700 focus:ring-red-700 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {entry.meta.storeLocation || 'Untitled Store Location'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 mt-0.5 truncate">
                          Report No.:{' '}
                          {getFormattedReportNo(
                            entry.id,
                            entry.meta.storeLocation,
                            entry.meta.dateOfInspection,
                            entry.meta.reportSequence
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {formatDisplayDate(entry.meta.dateOfInspection) ||
                            'No date'}{' '}
                          · {entry.meta.inspectedBy || 'No inspector'} ·{' '}
                          <span className="font-mono">
                            {st.answered}/{TOTAL_ITEMS_COUNT} checked · {st.no} No
                            · {st.photoCount} photos
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onUploadLocalReportToCloud(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <CloudUpload className="w-3.5 h-3.5" />
                        Sync Online
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditLocalReport(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onEmailLocalReport(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Email
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadLocalReportDocx(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        DOCX
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadLocalReportExcel(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Excel
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadLocalReportPdf(entry)}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteLocalReport(entry.id)}
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                        aria-label="Delete local snapshot"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
