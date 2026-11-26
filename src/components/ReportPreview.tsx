import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Printer,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  HOW_TO_FILL_INSTRUCTION,
  IQAF_BASIS_STATEMENT,
  formatDisplayDate,
  formatDisplayTime,
  formatReportNo,
} from '../data/checklistData';
import type {
  InspectionReport,
  PdfExportOptions,
  PhotoProof,
} from '../types/inspection';
import { formatTakenTimestamp } from '../utils/imageUtils';
import { collectIndexedPhotos } from '../utils/pdfExporter';
import { JiangNanLogo } from './JiangNanLogo';

interface ReportPreviewProps {
  report: InspectionReport;
  exportOptions: PdfExportOptions;
  onChangeExportOptions: (next: PdfExportOptions) => void;
  onEmailReport: () => void;
  onExportPdf: () => Promise<void>;
  onExportExcel: () => Promise<void>;
  isExporting: boolean;
  isExportingExcel: boolean;
  onBackToForm: () => void;
  onInspectPhoto: (itemNumber: number, itemText: string, photo: PhotoProof) => void;
}

export function ReportPreview({
  report,
  exportOptions,
  onChangeExportOptions,
  onEmailReport,
  onExportPdf,
  onExportExcel,
  isExporting,
  isExportingExcel,
  onBackToForm,
  onInspectPhoto,
}: ReportPreviewProps) {
  const [printHint, setPrintHint] = useState(false);

  const reportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection
  );
  const indexedPhotos = useMemo(() => collectIndexedPhotos(report), [report]);
  const photoNumbersByItem = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const entry of indexedPhotos) {
      const arr = map.get(entry.itemNumber) ?? [];
      arr.push(entry.photoIndex);
      map.set(entry.itemNumber, arr);
    }
    return map;
  }, [indexedPhotos]);

  const stats = useMemo(() => {
    let yes = 0;
    let no = 0;
    let na = 0;
    let unanswered = 0;

    const categoryRows = CHECKLIST_SECTIONS.map((section) => {
      let sYes = 0;
      let sNo = 0;
      let sNa = 0;
      let sPending = 0;
      let sPhotos = 0;

      for (const item of section.items) {
        const resp = report.responses[item.number];
        const status = resp?.complied || '';
        sPhotos += resp?.photos?.length ?? 0;

        if (status === 'Yes') {
          sYes++;
          yes++;
        } else if (status === 'No') {
          sNo++;
          no++;
        } else if (status === 'N/A') {
          sNa++;
          na++;
        } else {
          sPending++;
          unanswered++;
        }
      }

      const sApplicable = sYes + sNo;
      const score =
        sApplicable > 0 ? Math.round((sYes / sApplicable) * 100) : null;
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
    ).map((item) => ({
      item,
      sectionTitle:
        CHECKLIST_SECTIONS.find((s) => s.code === item.sectionCode)?.title ?? '',
      response: report.responses[item.number],
    }));

    const applicable = yes + no;
    const answered = yes + no + na;
    const complianceRate =
      applicable > 0 ? Math.round((yes / applicable) * 100) : null;
    return {
      yes,
      no,
      na,
      unanswered,
      answered,
      complianceRate,
      categoryRows,
      deviations,
    };
  }, [report.responses]);

  const handlePrint = () => {
    setPrintHint(false);
    try {
      window.print();
    } catch {
      setPrintHint(true);
    }
  };

  return (
    <div className="max-w-[980px] mx-auto px-4 sm:px-6 py-6 print-only-container">
      {/* Control bar (hidden when printing) */}
      <div className="no-print mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToForm}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Form
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                IQAF-005 Inspection Report Preview
              </h1>
              <p className="text-xs text-slate-500">
                Formatted to match the official Store Inspection Checklist
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
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
              {isExportingExcel ? 'Exporting…' : 'Export Excel'}
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
              {isExporting ? 'Generating PDF…' : 'Export PDF'}
            </button>
          </div>
        </div>

        {/* Summary & PDF Options Bar */}
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600 tabular-nums">
            <span>
              Complied (Yes):{' '}
              <strong className="font-semibold text-emerald-700">
                {stats.yes}
              </strong>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              Deviations (No):{' '}
              <strong className="font-semibold text-red-700">{stats.no}</strong>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              N/A:{' '}
              <strong className="font-semibold text-slate-800">{stats.na}</strong>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              Unanswered:{' '}
              <strong className="font-semibold text-slate-800">
                {stats.unanswered}
              </strong>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              Photos:{' '}
              <strong className="font-semibold text-slate-800">
                {indexedPhotos.length}
              </strong>
            </span>
            {stats.complianceRate !== null && (
              <>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span>
                  Score:{' '}
                  <strong className="font-semibold text-slate-900">
                    {stats.complianceRate}%
                  </strong>
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportOptions.includeSummary}
                onChange={(e) =>
                  onChangeExportOptions({
                    ...exportOptions,
                    includeSummary: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-red-700 focus:ring-red-700"
              />
              <span>Inspection Summary</span>
            </label>
            {indexedPhotos.length > 0 && (
              <>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exportOptions.includePhotoAppendix}
                    onChange={(e) =>
                      onChangeExportOptions({
                        ...exportOptions,
                        includePhotoAppendix: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300 text-red-700 focus:ring-red-700"
                  />
                  <span>Photo Proof Appendix</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeInlineThumbnails}
                    onChange={(e) =>
                      onChangeExportOptions({
                        ...exportOptions,
                        includeInlineThumbnails: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300 text-red-700 focus:ring-red-700"
                  />
                  <span>Inline Thumbnails</span>
                </label>
              </>
            )}
          </div>
        </div>

        {printHint && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Direct browser printing may be restricted in embedded previews. Use{' '}
            <strong>Export PDF</strong> to download the complete checklist document.
          </p>
        )}
      </div>

      {/* ===================================================================== */}
      {/* EXACT VISUAL REPLICA OF IQAF-005 STORE INSPECTION CHECKLIST PAPER     */}
      {/* ===================================================================== */}
      <div className="iqaf-sheet bg-white border border-slate-300 shadow-sm mx-auto p-6 sm:p-10 text-[11px] leading-[1.35]">
        {/* Header Grid: Logo + Title | Documentation No. + Revision No. */}
        <table className="iqaf-table">
          <colgroup>
            <col style={{ width: '56.7%' }} />
            <col style={{ width: '21.8%' }} />
            <col style={{ width: '21.5%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td rowSpan={2} className="px-3 py-2.5 bg-white">
                <div className="flex items-center justify-between gap-3">
                  <JiangNanLogo compact />
                  <div className="flex-1 text-center font-bold text-[15px] tracking-tight text-zinc-950 pr-2">
                    Store Inspection Checklist
                  </div>
                </div>
              </td>
              <td className="px-2 py-1.5 text-right font-bold text-[11px] bg-white">
                Documentation No.:
              </td>
              <td className="px-2 py-1.5 text-left text-[11px] bg-white font-mono">
                {report.meta.documentationNo || 'IQAF-005'}
              </td>
            </tr>
            <tr>
              <td className="px-2 py-1.5 text-right font-bold text-[11px] bg-white">
                Revision No.:
              </td>
              <td className="px-2 py-1.5 text-left text-[11px] bg-white font-mono">
                {report.meta.revisionNo || '0'}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Metadata 4-Row Table */}
        <table className="iqaf-table -mt-[1px]">
          <colgroup>
            <col style={{ width: '46.5%' }} />
            <col style={{ width: '53.5%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                Date of Inspection:
              </td>
              <td className="px-2.5 py-1.5 bg-white tabular-nums">
                {formatDisplayDate(report.meta.dateOfInspection)}
              </td>
            </tr>
            <tr>
              <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                Store Location:
              </td>
              <td className="px-2.5 py-1.5 bg-white">
                {report.meta.storeLocation}
              </td>
            </tr>
            <tr>
              <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                Time of Inspection:
              </td>
              <td className="px-2.5 py-1.5 bg-white tabular-nums">
                {formatDisplayTime(report.meta.timeOfInspection)}
              </td>
            </tr>
            <tr>
              <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                Inspected By:
              </td>
              <td className="px-2.5 py-1.5 bg-white">
                {report.meta.inspectedBy}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Exact Italic Instruction Line & IQAF-005 Basis Statement */}
        <p className="italic text-[10px] text-zinc-800 mt-2.5 mb-1 leading-snug">
          {HOW_TO_FILL_INSTRUCTION}
        </p>
        <p className="text-[9.5px] font-medium text-zinc-700 mb-2.5 leading-snug">
          {IQAF_BASIS_STATEMENT}
        </p>

        {/* Main 67-Item Table */}
        <table className="iqaf-table">
          <colgroup>
            <col style={{ width: '5%' }} />
            <col style={{ width: '41.5%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '21.75%' }} />
            <col style={{ width: '21.75%' }} />
          </colgroup>
          <thead>
            <tr className="bg-[#404040] text-white font-bold text-[11px]">
              <th className="py-1.5 px-1 text-center">No.</th>
              <th className="py-1.5 px-2 text-center">Inspection Item</th>
              <th className="py-1.5 px-1 text-center">Complied?</th>
              <th className="py-1.5 px-2 text-center">Deviation / Findings</th>
              <th className="py-1.5 px-2 text-center">Corrective Action</th>
            </tr>
          </thead>
          <tbody>
            {CHECKLIST_SECTIONS.map((section) => (
              <React.Fragment key={section.code}>
                <tr className="bg-[#D9D9D9] font-bold text-[11px] text-zinc-950">
                  <td colSpan={5} className="px-2 py-1.5 text-left">
                    {section.code}. {section.title}
                  </td>
                </tr>
                {section.items.map((item) => {
                  const resp = report.responses[item.number];
                  const complied = resp?.complied || '';
                  const photoNums = photoNumbersByItem.get(item.number) ?? [];
                  const photos = resp?.photos ?? [];

                  return (
                    <tr key={item.number} className="bg-white text-[10.8px]">
                      <td className="px-1 py-1.5 text-center tabular-nums">
                        {item.number}
                      </td>
                      <td className="px-2 py-1.5 text-left">{item.text}</td>
                      <td
                        className={`px-1 py-1.5 text-center font-bold ${
                          complied === 'Yes'
                            ? 'text-emerald-800'
                            : complied === 'No'
                              ? 'text-red-700'
                              : 'text-slate-600'
                        }`}
                      >
                        {complied}
                      </td>
                      <td className="px-2 py-1.5 text-left align-top">
                        {resp?.deviation && (
                          <div className="whitespace-pre-wrap break-words">
                            {resp.deviation}
                          </div>
                        )}
                        {photoNums.length > 0 && (
                          <div className="text-[9.5px] font-semibold text-zinc-700 mt-1">
                            {photoNums.length === 1
                              ? `[Photo Proof #${photoNums[0]}]`
                              : `[Photo Proofs ${photoNums.map((n) => `#${n}`).join(', ')}]`}
                          </div>
                        )}
                        {exportOptions.includeInlineThumbnails &&
                          photos.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {photos.slice(0, 3).map((ph) => (
                                <button
                                  key={ph.id}
                                  type="button"
                                  onClick={() =>
                                    onInspectPhoto(item.number, item.text, ph)
                                  }
                                  className="w-10 h-10 border border-zinc-400 overflow-hidden bg-slate-50 shrink-0"
                                  title="Click to inspect photo"
                                >
                                  <img
                                    src={ph.dataUrl}
                                    alt={
                                      ph.caption ||
                                      `Item ${item.number} photo proof`
                                    }
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1.5 text-left align-top whitespace-pre-wrap break-words">
                        {resp?.correctiveAction || ''}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {/* Sign-Off Block (Exact Page 3 Match) */}
        <div className="mt-6 iqaf-avoid-break">
          <table className="iqaf-table">
            <colgroup>
              <col style={{ width: '33.333%' }} />
              <col style={{ width: '33.333%' }} />
              <col style={{ width: '33.334%' }} />
            </colgroup>
            <tbody>
              <tr className="bg-[#D9D9D9] font-bold text-[11px] text-center">
                <td className="py-1.5 px-2">Performed By</td>
                <td className="py-1.5 px-2">Acknowledged By</td>
                <td className="py-1.5 px-2">Noted By</td>
              </tr>
              <tr className="bg-white text-center">
                {(
                  [
                    report.signOffs.performedBy,
                    report.signOffs.acknowledgedBy,
                    report.signOffs.notedBy,
                  ] as const
                ).map((entry, idx) => (
                  <td
                    key={idx}
                    className="px-2 pt-2 pb-1.5 h-[72px] align-bottom"
                  >
                    <div className="flex flex-col items-center justify-end h-full">
                      {entry.signatureDataUrl && (
                        <img
                          src={entry.signatureDataUrl}
                          alt="Signature"
                          referrerPolicy="no-referrer"
                          className="max-h-11 max-w-[140px] object-contain mb-0.5"
                        />
                      )}
                      {(entry.printedName || entry.date) && (
                        <div className="text-[10px] font-bold text-zinc-900 leading-tight">
                          {[
                            entry.printedName.trim(),
                            entry.date ? formatDisplayDate(entry.date) : '',
                          ]
                            .filter(Boolean)
                            .join(' / ')}
                        </div>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
              <tr className="bg-white text-center text-[10px] leading-snug">
                <td className="py-1.5 px-2">
                  <div>Food Safety Compliance Officer</div>
                  <div>Signature over printed name / Date</div>
                </td>
                <td className="py-1.5 px-2">
                  <div>Restaurant / Shift Manager</div>
                  <div>Signature over printed name / Date</div>
                </td>
                <td className="py-1.5 px-2">
                  <div>Area Manager</div>
                  <div>Signature over printed name / Date</div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-zinc-900">
            <span className="font-bold">Quality Assurance Department</span>
            <span>
              Basis Form #: {report.meta.documentationNo || 'IQAF-005'}
              <span className="inline-block w-4" />
              Revision No.: {report.meta.revisionNo || '0'}
            </span>
          </div>

          <div className="mt-3 pt-2 border-t border-zinc-300 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-700">
            <span className="font-mono font-bold text-zinc-900 tabular-nums">
              Report No.: {reportNo}
            </span>
            <span>
              Basis: {report.meta.documentationNo || 'IQAF-005'} Store
              Inspection Checklist
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* INSPECTION SUMMARY SHEET (Exact IQAF-005 Styling)                     */}
      {/* ===================================================================== */}
      {exportOptions.includeSummary && (
        <div className="iqaf-sheet iqaf-page-break bg-white border border-slate-300 shadow-sm mx-auto mt-6 p-6 sm:p-10 text-[11px] leading-[1.35]">
          <table className="iqaf-table mb-4">
            <colgroup>
              <col style={{ width: '56.7%' }} />
              <col style={{ width: '21.8%' }} />
              <col style={{ width: '21.5%' }} />
            </colgroup>
            <tbody>
              <tr>
                <td rowSpan={2} className="px-3 py-2 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <JiangNanLogo compact />
                    <div className="flex-1 text-center pr-2">
                      <div className="font-bold text-[14px] text-zinc-950">
                        Store Inspection Summary
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">
                        {[
                          report.meta.storeLocation || 'Store Inspection',
                          formatDisplayDate(report.meta.dateOfInspection),
                          report.meta.inspectedBy
                            ? `Inspector: ${report.meta.inspectedBy}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join('  |  ')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1 text-right font-bold text-[10.5px]">
                  Documentation No.:
                </td>
                <td className="px-2 py-1 text-left text-[10.5px] font-mono">
                  {report.meta.documentationNo || 'IQAF-005'}
                </td>
              </tr>
              <tr>
                <td className="px-2 py-1 text-right font-bold text-[10.5px]">
                  Revision No.:
                </td>
                <td className="px-2 py-1 text-left text-[10.5px] font-mono">
                  {report.meta.revisionNo || '0'}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Overall Compliance Summary Table */}
          <table className="iqaf-table mb-4">
            <thead>
              <tr className="bg-[#404040] text-white font-bold text-[11px]">
                <th colSpan={6} className="py-1.5 px-2 text-left">
                  Overall Compliance Summary
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  Compliance Rate
                </td>
                <td className="px-2 py-1.5 text-center font-bold">
                  {stats.complianceRate !== null
                    ? `${stats.complianceRate}%`
                    : '—'}
                </td>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  Items Checked
                </td>
                <td className="px-2 py-1.5 text-center">
                  {stats.answered} / {ALL_CHECKLIST_ITEMS.length}
                </td>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  Photo Proofs
                </td>
                <td className="px-2 py-1.5 text-center">
                  {indexedPhotos.length}
                </td>
              </tr>
              <tr>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  Complied (Yes)
                </td>
                <td className="px-2 py-1.5 text-center font-bold text-emerald-800">
                  {stats.yes}
                </td>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  Deviations (No)
                </td>
                <td
                  className={`px-2 py-1.5 text-center font-bold ${
                    stats.no > 0 ? 'text-red-700' : 'text-zinc-900'
                  }`}
                >
                  {stats.no}
                </td>
                <td className="px-2 py-1.5 font-bold bg-[#EFEFEF]">
                  N/A / Pending
                </td>
                <td className="px-2 py-1.5 text-center">
                  {stats.na} N/A · {stats.unanswered} Pending
                </td>
              </tr>
            </tbody>
          </table>

          {/* Category-by-Category Breakdown Table */}
          <table className="iqaf-table mb-4">
            <colgroup>
              <col style={{ width: '44%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr className="bg-[#404040] text-white font-bold text-[10.5px]">
                <th className="py-1.5 px-2 text-left">Category (Sections A–Q)</th>
                <th className="py-1.5 px-1 text-center">Items</th>
                <th className="py-1.5 px-1 text-center">Yes</th>
                <th className="py-1.5 px-1 text-center">No</th>
                <th className="py-1.5 px-1 text-center">N/A</th>
                <th className="py-1.5 px-1 text-center">Pending</th>
                <th className="py-1.5 px-1 text-center">Photos</th>
                <th className="py-1.5 px-1 text-center">Score</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-[10.5px]">
              {stats.categoryRows.map((row) => (
                <tr key={row.code}>
                  <td className="px-2 py-1 text-left">
                    <span className="font-bold">{row.code}.</span> {row.title}
                  </td>
                  <td className="px-1 py-1 text-center">{row.total}</td>
                  <td className="px-1 py-1 text-center text-emerald-800 font-semibold">
                    {row.yes}
                  </td>
                  <td
                    className={`px-1 py-1 text-center ${
                      row.no > 0 ? 'text-red-700 font-bold' : ''
                    }`}
                  >
                    {row.no}
                  </td>
                  <td className="px-1 py-1 text-center">{row.na}</td>
                  <td className="px-1 py-1 text-center">{row.pending}</td>
                  <td className="px-1 py-1 text-center">{row.photos}</td>
                  <td className="px-1 py-1 text-center font-bold">
                    {row.score !== null ? `${row.score}%` : '—'}
                  </td>
                </tr>
              ))}
              <tr className="bg-[#D9D9D9] font-bold">
                <td className="px-2 py-1.5 text-left">
                  Total (All 17 Categories)
                </td>
                <td className="px-1 py-1.5 text-center">
                  {ALL_CHECKLIST_ITEMS.length}
                </td>
                <td className="px-1 py-1.5 text-center text-emerald-800">
                  {stats.yes}
                </td>
                <td
                  className={`px-1 py-1.5 text-center ${
                    stats.no > 0 ? 'text-red-700' : ''
                  }`}
                >
                  {stats.no}
                </td>
                <td className="px-1 py-1.5 text-center">{stats.na}</td>
                <td className="px-1 py-1.5 text-center">{stats.unanswered}</td>
                <td className="px-1 py-1.5 text-center">
                  {indexedPhotos.length}
                </td>
                <td className="px-1 py-1.5 text-center">
                  {stats.complianceRate !== null
                    ? `${stats.complianceRate}%`
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Consolidated Deviations & Corrective Actions Table */}
          <table className="iqaf-table">
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="bg-[#404040] text-white font-bold text-[10.5px]">
                <th colSpan={5} className="py-1.5 px-2 text-left">
                  Summary of Deviations &amp; Corrective Actions (
                  {stats.deviations.length})
                </th>
              </tr>
              <tr className="bg-[#D9D9D9] text-zinc-950 font-bold text-[10px]">
                <th className="py-1 px-1 text-center">No.</th>
                <th className="py-1 px-2 text-left">Category &amp; Item</th>
                <th className="py-1 px-2 text-left">Deviation / Findings</th>
                <th className="py-1 px-2 text-left">Corrective Action</th>
                <th className="py-1 px-1 text-center">Photos</th>
              </tr>
            </thead>
            <tbody className="text-[10.5px]">
              {stats.deviations.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-3 px-2 text-center italic text-zinc-600"
                  >
                    No non-compliant items (&ldquo;No&rdquo;) were recorded
                    during this inspection.
                  </td>
                </tr>
              ) : (
                stats.deviations.map(({ item, sectionTitle, response }) => {
                  const pNums = photoNumbersByItem.get(item.number) ?? [];
                  return (
                    <tr key={item.number} className="align-top">
                      <td className="px-1 py-1.5 text-center font-bold text-red-700 tabular-nums">
                        {item.number}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-bold text-[9.5px] text-zinc-700">
                          {item.sectionCode}. {sectionTitle}
                        </div>
                        <div>{item.text}</div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-pre-wrap break-words">
                        {response?.deviation?.trim() || '—'}
                      </td>
                      <td className="px-2 py-1.5 whitespace-pre-wrap break-words">
                        {response?.correctiveAction?.trim() || '—'}
                      </td>
                      <td className="px-1 py-1.5 text-center font-mono text-[10px]">
                        {pNums.length > 0
                          ? pNums.map((n) => `#${n}`).join(', ')
                          : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div className="mt-5 pt-2 border-t border-zinc-300 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-700">
            <span className="font-mono font-bold text-zinc-900 tabular-nums">
              Report No.: {reportNo}
            </span>
            <span>
              Basis: {report.meta.documentationNo || 'IQAF-005'} Store
              Inspection Checklist
            </span>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PHOTO PROOF & EVIDENCE ATTACHMENT SHEET (Rendered when photos exist)  */}
      {/* ===================================================================== */}
      {exportOptions.includePhotoAppendix && indexedPhotos.length > 0 && (
        <div className="iqaf-sheet iqaf-page-break bg-white border border-slate-300 shadow-sm mx-auto mt-6 p-6 sm:p-10 text-[11px] leading-[1.35]">
          <table className="iqaf-table mb-5">
            <colgroup>
              <col style={{ width: '56.7%' }} />
              <col style={{ width: '21.8%' }} />
              <col style={{ width: '21.5%' }} />
            </colgroup>
            <tbody>
              <tr>
                <td rowSpan={2} className="px-3 py-2 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <JiangNanLogo compact />
                    <div className="flex-1 text-center pr-2">
                      <div className="font-bold text-[13.5px] text-zinc-950">
                        Photo Proof &amp; Evidence Attachment
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">
                        {[
                          report.meta.storeLocation || 'Store Inspection',
                          formatDisplayDate(report.meta.dateOfInspection),
                        ]
                          .filter(Boolean)
                          .join('  |  ')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1 text-right font-bold text-[10.5px]">
                  Documentation No.:
                </td>
                <td className="px-2 py-1 text-left text-[10.5px] font-mono">
                  {report.meta.documentationNo || 'IQAF-005'}
                </td>
              </tr>
              <tr>
                <td className="px-2 py-1 text-right font-bold text-[10.5px]">
                  Attached Photos:
                </td>
                <td className="px-2 py-1 text-left text-[10.5px] font-mono tabular-nums">
                  {indexedPhotos.length}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {indexedPhotos.map((entry) => (
              <div
                key={entry.photo.id}
                className="border border-[#404040] bg-white iqaf-avoid-break flex flex-col"
              >
                <div className="bg-[#D9D9D9] border-b border-[#404040] px-2.5 py-1.5 flex items-center justify-between text-[10.5px] font-bold">
                  <span className="tabular-nums">
                    Photo #{entry.photoIndex} | Item #{entry.itemNumber} (
                    {entry.sectionCode})
                  </span>
                  <span
                    className={
                      entry.complied === 'No'
                        ? 'text-red-700'
                        : entry.complied === 'Yes'
                          ? 'text-emerald-800'
                          : 'text-slate-600'
                    }
                  >
                    Complied: {entry.complied}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onInspectPhoto(entry.itemNumber, entry.itemText, entry.photo)
                  }
                  className="bg-slate-50 border-b border-slate-200 h-52 p-2 flex items-center justify-center overflow-hidden hover:opacity-95 transition-opacity"
                  title="Click to enlarge photo"
                >
                  <img
                    src={entry.photo.dataUrl}
                    alt={
                      entry.photo.caption ||
                      `Photo proof #${entry.photoIndex} for item ${entry.itemNumber}`
                    }
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain"
                  />
                </button>

                <div className="p-2.5 text-[10.5px] flex-1 flex flex-col justify-between gap-1.5">
                  <div>
                    <div className="font-bold text-zinc-900">
                      {entry.sectionCode}. {entry.sectionTitle} —{' '}
                      {entry.itemText}
                    </div>
                    {entry.photo.caption.trim() && (
                      <div className="text-zinc-800 mt-1">
                        <span className="font-semibold">Caption:</span>{' '}
                        {entry.photo.caption}
                      </div>
                    )}
                    {entry.deviation.trim() && (
                      <div className="text-zinc-600 italic mt-1">
                        Finding: {entry.deviation}
                      </div>
                    )}
                  </div>
                  <div className="text-[9.5px] text-zinc-500 font-mono tabular-nums pt-1 border-t border-slate-100">
                    Taken: {formatTakenTimestamp(entry.photo.capturedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-2 border-t border-zinc-300 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-700">
            <span className="font-mono font-bold text-zinc-900 tabular-nums">
              Report No.: {reportNo}
            </span>
            <span>
              Basis: {report.meta.documentationNo || 'IQAF-005'} Store
              Inspection Checklist
            </span>
          </div>
        </div>
      )}

      {/* Helpful empty-photo notice in preview only (not printed) */}
      {indexedPhotos.length === 0 && (
        <div className="no-print mt-4 bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              No photo proofs attached yet. Add photos on any item in the
              inspection form to automatically include the Photo Proof Appendix
              in your PDF report.
            </span>
          </div>
          <button
            type="button"
            onClick={onBackToForm}
            className="text-red-700 font-semibold hover:underline whitespace-nowrap shrink-0"
          >
            Add Photos
          </button>
        </div>
      )}

      {/* Ready indicator below paper */}
      <div className="no-print mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
          Export as formatted PDF or multi-sheet Excel (.xlsx) workbook with
          live compliance formulas and CAPA register.
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onEmailReport}
            className="font-semibold text-slate-800 hover:text-slate-950 whitespace-nowrap"
          >
            Email Report
          </button>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={onExportExcel}
            disabled={isExportingExcel}
            className="font-semibold text-emerald-800 hover:text-emerald-900 whitespace-nowrap"
          >
            {isExportingExcel ? 'Exporting…' : 'Download Excel (.xlsx)'}
          </button>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={onExportPdf}
            disabled={isExporting}
            className="font-semibold text-red-700 hover:text-red-800 whitespace-nowrap"
          >
            {isExporting ? 'Exporting…' : 'Download PDF File'}
          </button>
        </div>
      </div>
    </div>
  );
}
