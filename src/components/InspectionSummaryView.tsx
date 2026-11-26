import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Loader2,
  Mail,
  PenLine,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  IQAF_BASIS_STATEMENT,
  TOTAL_ITEMS_COUNT,
  createEmptyResponse,
  formatDisplayDate,
  formatDisplayTime,
  formatReportNo,
} from '../data/checklistData';
import type { InspectionReport, PhotoProof } from '../types/inspection';
import { collectIndexedPhotos } from '../utils/pdfExporter';

interface InspectionSummaryViewProps {
  report: InspectionReport;
  totalStoredPhotosCount: number;
  onJumpToSection: (sectionCode: string) => void;
  onJumpToItem: (itemNumber: number) => void;
  onJumpToSignOff: () => void;
  onOpenReportPreview: () => void;
  onOpenPhotoVault: () => void;
  onEmailReport: () => void;
  onExportPdf: () => Promise<void>;
  onExportExcel: () => Promise<void>;
  isExporting: boolean;
  isExportingExcel: boolean;
  onInspectPhoto: (itemNumber: number, itemText: string, photo: PhotoProof) => void;
}

export function InspectionSummaryView({
  report,
  totalStoredPhotosCount,
  onJumpToSection,
  onJumpToItem,
  onJumpToSignOff,
  onOpenReportPreview,
  onOpenPhotoVault,
  onEmailReport,
  onExportPdf,
  onExportExcel,
  isExporting,
  isExportingExcel,
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
    report.meta.dateOfInspection
  );

  const signOffStatus = [
    {
      label: 'Performed By',
      role: 'Food Safety Compliance Officer',
      entry: report.signOffs.performedBy,
    },
    {
      label: 'Acknowledged By',
      role: 'Restaurant / Shift Manager',
      entry: report.signOffs.acknowledgedBy,
    },
    {
      label: 'Noted By',
      role: 'Area Manager',
      entry: report.signOffs.notedBy,
    },
  ];

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
            {report.meta.timeOfInspection
              ? ` · ${formatDisplayTime(report.meta.timeOfInspection)}`
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

      {/* Sign-Off Readiness Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Sign-Off Status
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Required signatures for final IQAF-005 release
            </p>
          </div>
          <button
            type="button"
            onClick={onJumpToSignOff}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline whitespace-nowrap"
          >
            <PenLine className="w-3.5 h-3.5" />
            Complete Signatures
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {signOffStatus.map((slot) => {
            const signed = Boolean(slot.entry.signatureDataUrl);
            const named = Boolean(slot.entry.printedName.trim());
            return (
              <div
                key={slot.label}
                className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50"
              >
                <div className="text-xs font-semibold text-slate-900">
                  {slot.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {slot.role}
                </div>
                <div className="mt-2.5 text-xs tabular-nums">
                  {named ? (
                    <span className="font-medium text-slate-900">
                      {slot.entry.printedName}
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">Name pending</span>
                  )}
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span
                    className={
                      signed
                        ? 'text-emerald-700 font-medium'
                        : 'text-amber-700 font-medium'
                    }
                  >
                    {signed ? 'Signed' : 'Signature pending'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer with automatic Report No. and IQAF-005 basis */}
      <footer className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500">
        <span className="font-mono font-semibold text-slate-700 tabular-nums">
          Report No.: {reportNo}
        </span>
        <span>{IQAF_BASIS_STATEMENT}</span>
      </footer>
    </div>
  );
}
