import { useMemo } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CloudCheck,
  CloudOff,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Images,
  Loader2,
  Mail,
  Save,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  IQAF_BASIS_STATEMENT,
  REPORT_CONFIDENTIALITY_NOTICE,
  TOTAL_ITEMS_COUNT,
  createEmptyResponse,
  formatDisplayDate,
  formatInspectionTimeRange,
  formatReportNo,
} from '../data/checklistData';
import type {
  InspectionReport,
  PhotoProof,
  SignOffEntry,
  SignOffRoleKey,
} from '../types/inspection';
import { formatTakenTimestamp } from '../utils/imageUtils';
import { collectIndexedPhotos } from '../utils/pdfExporter';
import { SignaturePad } from './SignaturePad';

interface InspectionSummaryViewProps {
  report: InspectionReport;
  totalStoredPhotosCount: number;
  readOnly?: boolean;
  hasUnsavedCloudChanges: boolean;
  isNetworkOffline: boolean;
  isSavingOnline: boolean;
  pendingPhotoSyncCount: number;
  lastSyncedAt: string | null;
  onSaveOnline: () => Promise<void>;
  onJumpToSection: (sectionCode: string) => void;
  onJumpToItem: (itemNumber: number) => void;
  onUpdateSignOff: (
    slot: SignOffRoleKey,
    next: SignOffEntry
  ) => void;
  onOpenReportPreview: () => void;
  onOpenPhotoVault: () => void;
  onEmailReport: () => void;
  onExportPdf: () => Promise<void>;
  onExportExcel: () => Promise<void>;
  onExportDocx: () => Promise<void>;
  isExporting: boolean;
  isExportingExcel: boolean;
  isExportingDocx: boolean;
  onInspectPhoto: (itemNumber: number, itemText: string, photo: PhotoProof) => void;
}

export function InspectionSummaryView({
  report,
  totalStoredPhotosCount,
  readOnly = false,
  hasUnsavedCloudChanges,
  isNetworkOffline,
  isSavingOnline,
  pendingPhotoSyncCount,
  lastSyncedAt,
  onSaveOnline,
  onJumpToSection,
  onJumpToItem,
  onUpdateSignOff,
  onOpenReportPreview,
  onOpenPhotoVault,
  onEmailReport,
  onExportPdf,
  onExportExcel,
  onExportDocx,
  isExporting,
  isExportingExcel,
  isExportingDocx,
  onInspectPhoto,
}: InspectionSummaryViewProps) {
  const indexedPhotos = useMemo(() => collectIndexedPhotos(report), [report]);
  const photoNumsByItem = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const p of indexedPhotos) {
      const list = map.get(p.itemNumber) ?? [];
      list.push(p.photoIndex);
      map.set(p.itemNumber, list);
    }
    return map;
  }, [indexedPhotos]);

  const summary = useMemo(() => {
    let answered = 0;
    let yes = 0;
    let no = 0;
    let na = 0;
    let missingNoDetails = 0;

    const sectionRows = CHECKLIST_SECTIONS.map((section) => {
      let sYes = 0;
      let sNo = 0;
      let sNa = 0;
      let sPending = 0;
      let sPhotos = 0;

      for (const item of section.items) {
        const resp = report.responses[item.number] ?? createEmptyResponse();
        if (resp.complied === 'Yes') {
          sYes++;
          yes++;
          answered++;
        } else if (resp.complied === 'No') {
          sNo++;
          no++;
          answered++;
          if (!resp.deviation.trim() || !resp.correctiveAction.trim()) {
            missingNoDetails++;
          }
        } else if (resp.complied === 'N/A') {
          sNa++;
          na++;
          answered++;
        } else {
          sPending++;
        }
        sPhotos += resp.photos.length;
      }

      const applicable = sYes + sNo;
      const score = applicable > 0 ? Math.round((sYes / applicable) * 100) : null;

      return {
        code: section.code,
        title: section.title,
        total: section.items.length,
        yes: sYes,
        no: sNo,
        na: sNa,
        pending: sPending,
        photos: sPhotos,
        score,
      };
    });

    const deviations = ALL_CHECKLIST_ITEMS.filter(
      (item) => report.responses[item.number]?.complied === 'No'
    ).map((item) => {
      const section = CHECKLIST_SECTIONS.find((s) => s.code === item.sectionCode);
      return {
        item,
        sectionTitle: section?.title ?? '',
        response: report.responses[item.number] ?? createEmptyResponse(),
      };
    });

    const applicable = yes + no;
    const complianceRate =
      applicable > 0 ? Math.round((yes / applicable) * 100) : null;
    const progressRate = Math.round((answered / TOTAL_ITEMS_COUNT) * 100);

    return {
      answered,
      unanswered: TOTAL_ITEMS_COUNT - answered,
      yes,
      no,
      na,
      applicable,
      complianceRate,
      progressRate,
      missingNoDetails,
      sectionRows,
      deviations,
    };
  }, [report.responses]);

  const reportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection,
    report.meta.reportSequence
  );

  const signedCount = [
    report.signOffs.performedBy,
    report.signOffs.acknowledgedBy,
    report.signOffs.notedBy,
    report.signOffs.reviewedBy,
    report.signOffs.approvedBy,
  ].filter((entry) => Boolean(entry.signatureDataUrl)).length;

  return (
    <div className="max-w-[1060px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-950 tracking-tight">
            Inspection Summary
          </h1>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            <span className="font-mono font-semibold text-slate-700">
              Report No.: {reportNo}
            </span>{' '}
            · {report.meta.storeLocation || 'Store location not set'} ·{' '}
            {formatDisplayDate(report.meta.dateOfInspection) || 'No date'}
            {formatInspectionTimeRange(
              report.meta.timeOfInspection,
              report.meta.timeOfInspectionEnded
            )
              ? ` · ${formatInspectionTimeRange(report.meta.timeOfInspection, report.meta.timeOfInspectionEnded)}`
              : ''}
            {report.meta.inspectedBy
              ? ` · Inspector: ${report.meta.inspectedBy}`
              : ''}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {IQAF_BASIS_STATEMENT}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenReportPreview}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            Report Preview
          </button>
          <button
            type="button"
            onClick={onEmailReport}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Mail className="w-3.5 h-3.5 text-red-700" />
            Email Report
          </button>
          <button
            type="button"
            onClick={onExportDocx}
            disabled={isExportingDocx}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {isExportingDocx ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {isExportingDocx ? 'Saving DOCX…' : 'Save as DOCX'}
          </button>
          <button
            type="button"
            onClick={onExportExcel}
            disabled={isExportingExcel}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {isExportingExcel ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            Export Excel
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Export PDF
          </button>
        </div>
      </div>

      {/* Cloud Synchronization / Unsaved Offline Changes Indicator */}
      {!readOnly && (hasUnsavedCloudChanges || pendingPhotoSyncCount > 0 || isNetworkOffline) ? (
        <div
          role="status"
          aria-live="polite"
          className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {isNetworkOffline ? (
              <CloudOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-bold text-amber-950">
                {isNetworkOffline && (hasUnsavedCloudChanges || pendingPhotoSyncCount > 0)
                  ? 'Unsaved Offline Changes — Not Synchronized to Cloud'
                  : isNetworkOffline
                    ? 'Offline Mode — Changes Will Save Locally Until Reconnected'
                    : isSavingOnline
                      ? 'Synchronizing Changes to Cloud…'
                      : 'Unsaved Changes — Not Yet Synchronized to Cloud'}
              </div>
              <p className="text-[11.5px] text-amber-900/90 mt-0.5 tabular-nums">
                {hasUnsavedCloudChanges && pendingPhotoSyncCount > 0
                  ? `Checklist edits and ${pendingPhotoSyncCount} ${pendingPhotoSyncCount === 1 ? 'photo' : 'photos'} are saved locally on this device and awaiting cloud sync.`
                  : pendingPhotoSyncCount > 0
                    ? `${pendingPhotoSyncCount} ${pendingPhotoSyncCount === 1 ? 'photo is' : 'photos are'} saved locally and awaiting cloud upload.`
                    : hasUnsavedCloudChanges
                      ? 'Recent report edits are stored locally on this device and have not been saved to Firestore yet.'
                      : 'Your last saved state is synced, and any new edits made while offline will remain saved locally.'}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {isNetworkOffline ? (
              <span className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-amber-900 bg-amber-100/80 border border-amber-300 rounded-lg whitespace-nowrap">
                <CloudOff className="w-3.5 h-3.5" />
                Waiting for Connection
              </span>
            ) : (
              <button
                type="button"
                disabled={isSavingOnline}
                onClick={() => void onSaveOnline()}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {isSavingOnline ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {isSavingOnline ? 'Syncing…' : 'Sync to Cloud'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <span className="inline-flex items-center gap-2 font-medium">
            <CloudCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              {readOnly
                ? 'Viewing synchronized cloud report (read-only)'
                : 'All report edits and photo proofs are synchronized to the cloud'}
            </span>
          </span>
          {lastSyncedAt && (
            <span className="text-[11px] font-mono tabular-nums text-emerald-800">
              Last synced{' '}
              {new Date(lastSyncedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      )}

      {/* 4-Column KPI Summary Strip (Flat hairline dividers, no nested cards) */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-200">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Compliance Score
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-950">
            {summary.complianceRate !== null
              ? `${summary.complianceRate}%`
              : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.yes} Yes of {summary.applicable} applicable ({summary.na}{' '}
            N/A)
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Items Completed
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-950">
            {summary.answered}/{TOTAL_ITEMS_COUNT}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.progressRate}% checked · {summary.unanswered} pending
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Deviations Logged
          </div>
          <div
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              summary.no > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {summary.no}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.missingNoDetails > 0 ? (
              <span className="text-red-700 font-medium">
                {summary.missingNoDetails} missing deviation/action notes
              </span>
            ) : summary.no > 0 ? (
              'All deviations documented'
            ) : (
              'No non-compliant items'
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Photo Proofs
            </span>
            <button
              type="button"
              onClick={onOpenPhotoVault}
              className="text-xs font-semibold text-red-700 hover:underline"
            >
              Open Vault
            </button>
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-950">
            {indexedPhotos.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            In this audit · {totalStoredPhotosCount} total stored locally
          </div>
        </div>
      </section>

      {/* Deviations & Corrective Actions Summary */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Deviations &amp; Corrective Actions ({summary.deviations.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Consolidated list of all items marked &ldquo;No&rdquo; for
              follow-up and verification
            </p>
          </div>
          {summary.deviations.length > 0 && (
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
          )}
        </div>

        {summary.deviations.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">
              No deviations recorded
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Any checklist item marked &ldquo;No&rdquo; will appear here with
              its findings, corrective action, and attached photo proofs.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4 w-14 text-center">No.</th>
                  <th className="py-2.5 px-4 w-[28%]">Inspection Item</th>
                  <th className="py-2.5 px-4 w-[26%]">Deviation / Findings</th>
                  <th className="py-2.5 px-4 w-[26%]">Corrective Action</th>
                  <th className="py-2.5 px-4 w-28">Photo Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {summary.deviations.map(({ item, sectionTitle, response }) => {
                  const photoNums = photoNumsByItem.get(item.number) ?? [];
                  return (
                    <tr
                      key={item.number}
                      className="hover:bg-slate-50/70 align-top"
                    >
                      <td className="py-3 px-4 text-center font-mono font-semibold text-red-700 tabular-nums">
                        <button
                          type="button"
                          onClick={() => onJumpToItem(item.number)}
                          className="hover:underline"
                          title="Edit this item in form"
                        >
                          #{item.number}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-[11px] font-medium text-slate-500">
                          {item.sectionCode}. {sectionTitle}
                        </div>
                        <div className="text-slate-900 mt-0.5 leading-snug">
                          {item.text}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-800 whitespace-pre-wrap">
                        {response.deviation.trim() ? (
                          response.deviation
                        ) : (
                          <span className="text-red-700 italic">
                            Missing deviation note
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-800 whitespace-pre-wrap">
                        {response.correctiveAction.trim() ? (
                          response.correctiveAction
                        ) : (
                          <span className="text-red-700 italic">
                            Missing corrective action
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {response.photos.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {response.photos.map((ph, idx) => (
                              <button
                                key={ph.id}
                                type="button"
                                onClick={() =>
                                  onInspectPhoto(item.number, item.text, ph)
                                }
                                className="w-10 h-10 rounded border border-slate-300 overflow-hidden bg-slate-100 hover:opacity-90 shrink-0"
                                title={`Photo #${photoNums[idx] ?? idx + 1}`}
                              >
                                <img
                                  src={ph.dataUrl}
                                  alt={
                                    ph.caption ||
                                    `Item ${item.number} proof ${idx + 1}`
                                  }
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onJumpToItem(item.number)}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-red-700"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Add photo</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Category-by-Category Breakdown Table (Sections A–Q) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            Compliance Breakdown by Category (Sections A–Q)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click any category row to jump directly to its items in the
            checklist form
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-3 text-right">Items</th>
                <th className="py-2.5 px-3 text-right">Yes</th>
                <th className="py-2.5 px-3 text-right">No</th>
                <th className="py-2.5 px-3 text-right">N/A</th>
                <th className="py-2.5 px-3 text-right">Pending</th>
                <th className="py-2.5 px-3 text-right">Photos</th>
                <th className="py-2.5 px-4 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 tabular-nums">
              {summary.sectionRows.map((row) => (
                <tr
                  key={row.code}
                  onClick={() => onJumpToSection(row.code)}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    <span className="font-mono font-semibold text-slate-500 mr-2">
                      {row.code}.
                    </span>
                    {row.title}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                    {row.total}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-medium">
                    {row.yes}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono ${
                      row.no > 0
                        ? 'text-red-700 font-bold'
                        : 'text-slate-400'
                    }`}
                  >
                    {row.no}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                    {row.na}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                    {row.pending}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                    {row.photos}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold">
                    {row.score === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span
                        className={
                          row.score === 100
                            ? 'text-emerald-700'
                            : row.score >= 80
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {row.score}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900 tabular-nums">
                <td className="py-2.5 px-4">Total (All 17 Categories)</td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {TOTAL_ITEMS_COUNT}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                  {summary.yes}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-red-700">
                  {summary.no}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                  {summary.na}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                  {summary.unanswered}
                </td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {indexedPhotos.length}
                </td>
                <td className="py-2.5 px-4 text-right font-mono">
                  {summary.complianceRate !== null
                    ? `${summary.complianceRate}%`
                    : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Photo Attachments Gallery */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Photo Attachments ({indexedPhotos.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              All photo proofs attached across checklist items A–Q, synced to
              cloud storage and included in PDF exports
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenPhotoVault}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline whitespace-nowrap shrink-0"
          >
            <Images className="w-3.5 h-3.5" />
            Manage Photo Vault
          </button>
        </div>

        {indexedPhotos.length === 0 ? (
          <div className="p-8 text-center">
            <Camera className="w-7 h-7 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">
              No photo attachments in this report
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Photos captured or uploaded on any checklist item will appear here
              for verification before sign-off.
            </p>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {indexedPhotos.map((entry) => {
              const compliedClass =
                entry.complied === 'No'
                  ? 'text-red-700'
                  : entry.complied === 'Yes'
                    ? 'text-emerald-700'
                    : 'text-slate-500';
              const syncNotice =
                entry.photo.uploadState === 'error'
                  ? 'Upload failed — retry in checklist'
                  : entry.photo.uploadState === 'uploading'
                    ? 'Uploading…'
                    : entry.photo.uploadState === 'local'
                      ? 'Pending cloud sync'
                      : null;

              return (
                <div
                  key={entry.photo.id}
                  className="border border-slate-200 rounded-lg overflow-hidden bg-white flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onInspectPhoto(entry.itemNumber, entry.itemText, entry.photo)
                    }
                    className="group block w-full aspect-[4/3] bg-slate-100 overflow-hidden text-left cursor-pointer"
                    title={`Open Photo #${entry.photoIndex} in full view`}
                  >
                    <img
                      src={entry.photo.dataUrl}
                      alt={
                        entry.photo.caption ||
                        `Photo #${entry.photoIndex} for Item #${entry.itemNumber}`
                      }
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  </button>

                  <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                    <div>
                      <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono tabular-nums">
                        <span className="font-bold text-slate-900">
                          Photo #{entry.photoIndex}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onJumpToItem(entry.itemNumber)}
                            className="font-semibold text-slate-600 hover:text-red-700 hover:underline"
                          >
                            Item #{entry.itemNumber}
                          </button>
                          <span className="text-slate-300">·</span>
                          <span className={`font-semibold ${compliedClass}`}>
                            {entry.complied}
                          </span>
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 mt-1 truncate">
                        {entry.sectionCode}. {entry.sectionTitle}
                      </div>
                      <p className="text-xs text-slate-800 leading-snug mt-0.5 line-clamp-2">
                        {entry.itemText}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-0.5">
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        Taken: {formatTakenTimestamp(entry.photo.capturedAt)}
                      </div>
                      <div className="text-xs text-slate-600 truncate">
                        {entry.photo.caption?.trim() ? (
                          entry.photo.caption
                        ) : (
                          <span className="text-slate-400 italic">
                            No caption — click photo to add
                          </span>
                        )}
                      </div>
                      {syncNotice && (
                        <div className="text-[11px] font-medium text-amber-700">
                          {syncNotice}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sign-Off & Verification Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Sign-Off &amp; Verification
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quality Assurance Department · Basis Form #:{' '}
              {report.meta.documentationNo} (Rev. {report.meta.revisionNo}) ·{' '}
              <span className="font-mono font-semibold text-slate-700">
                Report No.: {reportNo}
              </span>
            </p>
          </div>
          <div className="text-xs font-mono font-semibold tabular-nums shrink-0">
            <span
              className={
                signedCount === 5 ? 'text-emerald-700' : 'text-amber-700'
              }
            >
              {signedCount === 5
                ? 'All 5 signatures complete'
                : `${signedCount} of 5 signed`}
            </span>
            {readOnly && (
              <span className="ml-2 text-slate-500 font-sans font-normal">
                (View-only)
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="lg:col-span-2">
            <SignaturePad
              title="Performed By"
              roleSubtitle="Food Safety Compliance Officer"
              value={report.signOffs.performedBy}
              readOnly={readOnly}
              onChange={(next) => onUpdateSignOff('performedBy', next)}
            />
          </div>
          <div className="lg:col-span-2">
            <SignaturePad
              title="Acknowledged By"
              roleSubtitle="Restaurant / Shift Manager"
              value={report.signOffs.acknowledgedBy}
              readOnly={readOnly}
              onChange={(next) => onUpdateSignOff('acknowledgedBy', next)}
            />
          </div>
          <div className="lg:col-span-2">
            <SignaturePad
              title="Noted By"
              roleSubtitle="Area Manager"
              value={report.signOffs.notedBy}
              readOnly={readOnly}
              onChange={(next) => onUpdateSignOff('notedBy', next)}
            />
          </div>
          <div className="lg:col-span-3">
            <SignaturePad
              title="Reviewed By"
              roleSubtitle="Learning and Development Manager"
              value={report.signOffs.reviewedBy}
              readOnly={readOnly}
              onChange={(next) => onUpdateSignOff('reviewedBy', next)}
            />
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <SignaturePad
              title="Approved By"
              roleSubtitle="Quality Assurance Specialist / FSCO"
              value={report.signOffs.approvedBy}
              readOnly={readOnly}
              onChange={(next) => onUpdateSignOff('approvedBy', next)}
            />
          </div>
        </div>
      </section>

      {/* Footer with automatic Report No., IQAF-005 basis, and confidentiality notice */}
      <footer className="pt-2.5 border-t border-slate-200 space-y-1 text-[11px] text-slate-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <span className="font-mono font-semibold text-slate-700 tabular-nums">
            Report No.: {reportNo}
          </span>
          <span>{IQAF_BASIS_STATEMENT}</span>
        </div>
        <p className="text-[10.5px] italic text-slate-400">
          {REPORT_CONFIDENTIALITY_NOTICE}
        </p>
      </footer>
    </div>
  );
}
