import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Cloud,
  CloudOff,
  CloudUpload,
  Download,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  TOTAL_ITEMS_COUNT,
  formatDisplayDate,
  formatReportNo,
} from '../data/checklistData';
import type { InspectionReport } from '../types/inspection';
import type { CloudReportSummary } from '../utils/cloudReports';

interface ReportsLibraryViewProps {
  user: User | null;
  authReady: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  isSigningIn: boolean;
  currentReport: InspectionReport;
  hasUnsavedCloudChanges: boolean;
  isSavingOnline: boolean;
  cloudReports: CloudReportSummary[];
  loadingCloudReports: boolean;
  localReports: InspectionReport[];
  busyReportId: string | null;
  onCreateNewReport: () => void;
  onLoadSampleReport: () => void;
  onSaveCurrentReport: () => Promise<void>;
  onEditCloudReport: (reportId: string) => Promise<void>;
  onPreviewCloudReport: (reportId: string) => Promise<void>;
  onDownloadCloudReportPdf: (reportId: string) => Promise<void>;
  onDownloadCloudReportExcel: (reportId: string) => Promise<void>;
  onEmailCloudReport: (reportId: string) => Promise<void>;
  onDeleteCloudReport: (reportId: string) => Promise<void>;
  onEditLocalReport: (report: InspectionReport) => void;
  onUploadLocalReportToCloud: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportPdf: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportExcel: (report: InspectionReport) => Promise<void>;
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
  hasUnsavedCloudChanges,
  isSavingOnline,
  cloudReports,
  loadingCloudReports,
  localReports,
  busyReportId,
  onCreateNewReport,
  onLoadSampleReport,
  onSaveCurrentReport,
  onEditCloudReport,
  onPreviewCloudReport,
  onDownloadCloudReportPdf,
  onDownloadCloudReportExcel,
  onEmailCloudReport,
  onDeleteCloudReport,
  onEditLocalReport,
  onUploadLocalReportToCloud,
  onDownloadLocalReportPdf,
  onDownloadLocalReportExcel,
  onEmailLocalReport,
  onDeleteLocalReport,
}: ReportsLibraryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const cloudIds = useMemo(
    () => new Set(cloudReports.map((r) => r.id)),
    [cloudReports]
  );

  // Local-only reports not already synced in cloudReports
  const localOnlyReports = useMemo(
    () => localReports.filter((r) => !cloudIds.has(r.id)),
    [localReports, cloudIds]
  );

  const q = searchQuery.trim().toLowerCase();

  const filteredCloudReports = useMemo(() => {
    if (!q) return cloudReports;
    return cloudReports.filter((r) =>
      `${r.storeLocation} ${r.inspectedBy} ${r.dateOfInspection} ${r.documentationNo} ${formatReportNo(r.storeLocation, r.dateOfInspection)}`
        .toLowerCase()
        .includes(q)
    );
  }, [cloudReports, q]);

  const filteredLocalReports = useMemo(() => {
    if (!q) return localOnlyReports;
    return localOnlyReports.filter((r) =>
      `${r.meta.storeLocation} ${r.meta.inspectedBy} ${r.meta.dateOfInspection} ${r.meta.documentationNo} ${formatReportNo(r.meta.storeLocation, r.meta.dateOfInspection)}`
        .toLowerCase()
        .includes(q)
    );
  }, [localOnlyReports, q]);

  const currentStats = useMemo(
    () => summarizeLocalReport(currentReport),
    [currentReport]
  );

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
            to edit anytime, and download PDF or Excel reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
            {isSavingOnline
              ? 'Saving…'
              : user
                ? 'Save Current Online'
                : 'Save Locally'}
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
                  {cloudReports.length === 1 ? 'report' : 'reports'} stored
                  online
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
              <CloudOff className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Sign in to store reports and photos online
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Save IQAF-005 reports and photo proofs to your private cloud
                  database so you can reopen, edit anytime, and download PDFs
                  from any device.
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
          </div>
          <div className="text-sm font-bold text-slate-950 mt-0.5 truncate">
            {currentReport.meta.storeLocation || 'Untitled Store Inspection'}
          </div>
          <div className="text-[11px] font-mono font-semibold text-slate-600 mt-0.5 truncate">
            Report No.:{' '}
            {formatReportNo(
              currentReport.meta.storeLocation,
              currentReport.meta.dateOfInspection
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
            {user && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    hasUnsavedCloudChanges
                      ? 'text-amber-700 font-medium'
                      : 'text-emerald-700 font-medium'
                  }
                >
                  {hasUnsavedCloudChanges
                    ? 'Unsaved edits'
                    : 'Synced online'}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
            {user ? 'Save Online' : 'Save Snapshot'}
          </button>
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

      {/* Search bar */}
      <div className="relative max-w-md">
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

      {/* Online Saved Reports Table */}
      {user && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Online Reports ({filteredCloudReports.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stored securely in Firestore with attached photo proofs — edit
                or download anytime
              </p>
            </div>
            <Cloud className="w-4 h-4 text-emerald-700 shrink-0" />
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
                const applicable = item.stats.yes + item.stats.no;
                const score =
                  applicable > 0
                    ? Math.round((item.stats.yes / applicable) * 100)
                    : null;

                return (
                  <div
                    key={item.id}
                    className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                      isActive ? 'bg-red-50/35' : 'bg-white hover:bg-slate-50/60'
                    }`}
                  >
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
                        {formatReportNo(
                          item.storeLocation,
                          item.dateOfInspection
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

      {/* Local Browser Reports (shown if user is signed out OR has unsynced local snapshots) */}
      {(!user || filteredLocalReports.length > 0) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">
              Local Browser Snapshots ({filteredLocalReports.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {user
                ? 'Saved locally on this device — upload any snapshot to sync it online'
                : 'Saved locally in IndexedDB — sign in with Google above to sync reports online'}
            </p>
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
                return (
                  <div
                    key={entry.id}
                    className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white hover:bg-slate-50/60"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {entry.meta.storeLocation || 'Untitled Store Location'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-600 mt-0.5 truncate">
                        Report No.:{' '}
                        {formatReportNo(
                          entry.meta.storeLocation,
                          entry.meta.dateOfInspection
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

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {user && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUploadLocalReportToCloud(entry)}
                          className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          Sync Online
                        </button>
                      )}
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
