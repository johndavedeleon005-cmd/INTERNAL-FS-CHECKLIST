import * as XLSX from 'xlsx';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  FORM_DOCUMENTATION_NO,
  FORM_REVISION_NO,
  HOW_TO_FILL_INSTRUCTION,
  IQAF_BASIS_STATEMENT,
  formatDisplayDate,
  formatDisplayTime,
  formatReportNo,
} from '../data/checklistData';
import type { InspectionReport } from '../types/inspection';
import { formatTakenTimestamp } from './imageUtils';
import { collectIndexedPhotos } from './pdfExporter';

function sanitizeFilePart(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return cleaned || fallback;
}

function setFormulaCell(
  ws: XLSX.WorkSheet,
  addr: string,
  formula: string,
  cachedValue: number | string,
  numFmt?: string
) {
  if (typeof cachedValue === 'number') {
    ws[addr] = {
      t: 'n',
      f: formula,
      v: cachedValue,
      ...(numFmt ? { z: numFmt } : {}),
    };
  } else {
    ws[addr] = {
      t: 's',
      f: formula,
      v: cachedValue,
      ...(numFmt ? { z: numFmt } : {}),
    };
  }
}

/**
 * Exports a complete multi-sheet Excel (.xlsx) workbook designed for
 * spreadsheet-based auditing, filtering, pivot tables, and CAPA tracking.
 */
export async function exportInspectionToExcel(
  report: InspectionReport
): Promise<void> {
  const wb = XLSX.utils.book_new();

  const docNo = report.meta.documentationNo || FORM_DOCUMENTATION_NO;
  const revNo = report.meta.revisionNo || FORM_REVISION_NO;
  const reportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection
  );
  const displayDate =
    formatDisplayDate(report.meta.dateOfInspection) ||
    report.meta.dateOfInspection ||
    '';
  const displayTime =
    formatDisplayTime(report.meta.timeOfInspection) ||
    report.meta.timeOfInspection ||
    '';
  const exportedAt = formatTakenTimestamp(new Date().toISOString());

  const indexedPhotos = collectIndexedPhotos(report);
  const photoNumsByItem = new Map<number, number[]>();
  for (const entry of indexedPhotos) {
    const arr = photoNumsByItem.get(entry.itemNumber) ?? [];
    arr.push(entry.photoIndex);
    photoNumsByItem.set(entry.itemNumber, arr);
  }

  // Pre-compute category & overall metrics
  let totalYes = 0;
  let totalNo = 0;
  let totalNa = 0;
  let totalPending = 0;

  interface CategoryMetric {
    code: string;
    title: string;
    total: number;
    yes: number;
    no: number;
    na: number;
    pending: number;
    photos: number;
    scoreNum: number | null;
  }

  const categoryMetrics: CategoryMetric[] = CHECKLIST_SECTIONS.map((sec) => {
    let sYes = 0;
    let sNo = 0;
    let sNa = 0;
    let sPending = 0;
    let sPhotos = 0;

    for (const item of sec.items) {
      const r = report.responses[item.number];
      const status = r?.complied || '';
      sPhotos += r?.photos?.length ?? 0;
      if (status === 'Yes') {
        sYes++;
        totalYes++;
      } else if (status === 'No') {
        sNo++;
        totalNo++;
      } else if (status === 'N/A') {
        sNa++;
        totalNa++;
      } else {
        sPending++;
        totalPending++;
      }
    }

    const applicable = sYes + sNo;
    return {
      code: sec.code,
      title: sec.title,
      total: sec.items.length,
      yes: sYes,
      no: sNo,
      na: sNa,
      pending: sPending,
      photos: sPhotos,
      scoreNum: applicable > 0 ? sYes / applicable : null,
    };
  });

  const totalApplicable = totalYes + totalNo;
  const totalAnswered = totalYes + totalNo + totalNa;
  const overallScoreNum =
    totalApplicable > 0 ? totalYes / totalApplicable : null;

  const signOffRows = [
    {
      section: 'Performed By',
      role: 'Food Safety Compliance Officer',
      entry: report.signOffs.performedBy,
    },
    {
      section: 'Acknowledged By',
      role: 'Restaurant / Shift Manager',
      entry: report.signOffs.acknowledgedBy,
    },
    {
      section: 'Noted By',
      role: 'Area Manager',
      entry: report.signOffs.notedBy,
    },
  ];

  // =========================================================================
  // SHEET 1: SUMMARY & SCORECARD (with live Excel formulas)
  // =========================================================================
  const summaryAoa: (string | number)[][] = [
    ['STORE INSPECTION REPORT — SUMMARY & SCORECARD'],
    [IQAF_BASIS_STATEMENT],
    [],
    ['Report No.:', reportNo, '', 'Basis Form #:', docNo],
    [
      'Store Location:',
      report.meta.storeLocation || '',
      '',
      'Revision No.:',
      revNo,
    ],
    [
      'Date of Inspection:',
      displayDate,
      '',
      'Time of Inspection:',
      displayTime,
    ],
    [
      'Inspected By:',
      report.meta.inspectedBy || '',
      '',
      'Exported On:',
      exportedAt,
    ],
    [],
    ['OVERALL COMPLIANCE METRICS'],
    ['Metric', 'Value', 'Notes'],
    ['Overall Compliance Score', '', 'Complied (Yes) / Applicable (Yes + No)'],
    ['Total Checklist Items', ALL_CHECKLIST_ITEMS.length, 'Sections A through Q'],
    ['Items Checked', totalAnswered, 'Yes + No + N/A'],
    ['Complied (Yes)', totalYes, 'Meeting store standard'],
    ['Deviations (No)', totalNo, 'Requires corrective action'],
    ['Not Applicable (N/A)', totalNa, 'Excluded from score denominator'],
    ['Pending / Unanswered', totalPending, 'Not yet evaluated'],
    ['Photo Proofs Attached', indexedPhotos.length, 'Logged in Photo Proofs tab'],
    [],
    ['CATEGORY BREAKDOWN (SECTIONS A–Q)'],
    [
      'Section',
      'Category',
      'Total Items',
      'Yes',
      'No',
      'N/A',
      'Pending',
      'Photos',
      'Compliance Score',
    ],
  ];

  const catFirstRow = summaryAoa.length + 1; // 1-indexed Excel row of Section A
  for (const cat of categoryMetrics) {
    summaryAoa.push([
      cat.code,
      cat.title,
      cat.total,
      cat.yes,
      cat.no,
      cat.na,
      cat.pending,
      cat.photos,
      '',
    ]);
  }
  const catLastRow = summaryAoa.length; // 1-indexed Excel row of Section Q
  const catTotalRow = catLastRow + 1;

  summaryAoa.push([
    'TOTAL',
    'All 17 Categories (A–Q)',
    ALL_CHECKLIST_ITEMS.length,
    totalYes,
    totalNo,
    totalNa,
    totalPending,
    indexedPhotos.length,
    '',
  ]);

  summaryAoa.push([]);
  summaryAoa.push(['SIGN-OFF & VERIFICATION']);
  summaryAoa.push([
    'Sign-Off Role',
    'Designation',
    'Printed Name',
    'Date',
    'Signature Status',
  ]);
  for (const s of signOffRows) {
    summaryAoa.push([
      s.section,
      s.role,
      s.entry.printedName || '',
      s.entry.date ? formatDisplayDate(s.entry.date) : '',
      s.entry.signatureDataUrl ? 'Signed' : 'Pending',
    ]);
  }
  summaryAoa.push([]);
  summaryAoa.push([
    `Report No.: ${reportNo}`,
    '',
    '',
    '',
    `Basis: ${docNo} Store Inspection Checklist (Rev. ${revNo})`,
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);

  // Attach live Excel formulas for category scores & totals
  categoryMetrics.forEach((cat, idx) => {
    const r = catFirstRow + idx;
    setFormulaCell(
      wsSummary,
      `I${r}`,
      `IF((D${r}+E${r})>0,D${r}/(D${r}+E${r}),"")`,
      cat.scoreNum !== null ? cat.scoreNum : '',
      '0.0%'
    );
  });

  setFormulaCell(
    wsSummary,
    `C${catTotalRow}`,
    `SUM(C${catFirstRow}:C${catLastRow})`,
    ALL_CHECKLIST_ITEMS.length
  );
  setFormulaCell(
    wsSummary,
    `D${catTotalRow}`,
    `SUM(D${catFirstRow}:D${catLastRow})`,
    totalYes
  );
  setFormulaCell(
    wsSummary,
    `E${catTotalRow}`,
    `SUM(E${catFirstRow}:E${catLastRow})`,
    totalNo
  );
  setFormulaCell(
    wsSummary,
    `F${catTotalRow}`,
    `SUM(F${catFirstRow}:F${catLastRow})`,
    totalNa
  );
  setFormulaCell(
    wsSummary,
    `G${catTotalRow}`,
    `SUM(G${catFirstRow}:G${catLastRow})`,
    totalPending
  );
  setFormulaCell(
    wsSummary,
    `H${catTotalRow}`,
    `SUM(H${catFirstRow}:H${catLastRow})`,
    indexedPhotos.length
  );
  setFormulaCell(
    wsSummary,
    `I${catTotalRow}`,
    `IF((D${catTotalRow}+E${catTotalRow})>0,D${catTotalRow}/(D${catTotalRow}+E${catTotalRow}),"")`,
    overallScoreNum !== null ? overallScoreNum : '',
    '0.0%'
  );

  // Link overall KPI cells directly to category totals row
  setFormulaCell(
    wsSummary,
    'B11',
    `IF((D${catTotalRow}+E${catTotalRow})>0,D${catTotalRow}/(D${catTotalRow}+E${catTotalRow}),"")`,
    overallScoreNum !== null ? overallScoreNum : '',
    '0.0%'
  );
  setFormulaCell(
    wsSummary,
    'B12',
    `C${catTotalRow}`,
    ALL_CHECKLIST_ITEMS.length
  );
  setFormulaCell(
    wsSummary,
    'B13',
    `D${catTotalRow}+E${catTotalRow}+F${catTotalRow}`,
    totalAnswered
  );
  setFormulaCell(wsSummary, 'B14', `D${catTotalRow}`, totalYes);
  setFormulaCell(wsSummary, 'B15', `E${catTotalRow}`, totalNo);
  setFormulaCell(wsSummary, 'B16', `F${catTotalRow}`, totalNa);
  setFormulaCell(wsSummary, 'B17', `G${catTotalRow}`, totalPending);
  setFormulaCell(wsSummary, 'B18', `H${catTotalRow}`, indexedPhotos.length);

  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
    { s: { r: 8, c: 0 }, e: { r: 8, c: 8 } },
    { s: { r: 19, c: 0 }, e: { r: 19, c: 8 } },
  ];
  wsSummary['!cols'] = [
    { wch: 24 },
    { wch: 38 },
    { wch: 16 },
    { wch: 18 },
    { wch: 24 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary & Scorecard');

  // =========================================================================
  // SHEET 2: INSPECTION CHECKLIST (All 67 Items — Filter & Pivot Ready)
  // =========================================================================
  const checklistAoa: (string | number)[][] = [
    ['STORE INSPECTION CHECKLIST (67 COMPLIANCE ITEMS)'],
    [IQAF_BASIS_STATEMENT],
    [HOW_TO_FILL_INSTRUCTION],
    [],
    ['Report No.:', reportNo, '', 'Basis Form #:', `${docNo} (Rev. ${revNo})`],
    [
      'Store Location:',
      report.meta.storeLocation || '',
      '',
      'Date / Time:',
      [displayDate, displayTime].filter(Boolean).join(' · '),
    ],
    ['Inspected By:', report.meta.inspectedBy || ''],
    [],
    [
      'Item No.',
      'Section',
      'Category',
      'Inspection Item',
      'Complied?',
      'Deviation / Findings',
      'Corrective Action',
      'Photo Proof Refs',
      'Photo Count',
    ],
  ];

  const checklistHeaderRow = checklistAoa.length; // 1-indexed = 9
  for (const section of CHECKLIST_SECTIONS) {
    for (const item of section.items) {
      const resp = report.responses[item.number];
      const photoNums = photoNumsByItem.get(item.number) ?? [];
      const photoRefLabel =
        photoNums.length > 0
          ? photoNums.map((n) => `Photo #${n}`).join(', ')
          : '';
      checklistAoa.push([
        item.number,
        section.code,
        section.title,
        item.text,
        resp?.complied || '',
        resp?.deviation?.trim() || '',
        resp?.correctiveAction?.trim() || '',
        photoRefLabel,
        resp?.photos?.length ?? 0,
      ]);
    }
  }
  const checklistLastItemRow = checklistAoa.length;

  checklistAoa.push([]);
  checklistAoa.push([
    `Report No.: ${reportNo}`,
    '',
    '',
    `Basis: ${docNo} Store Inspection Checklist (Rev. ${revNo})`,
  ]);

  const wsChecklist = XLSX.utils.aoa_to_sheet(checklistAoa);
  wsChecklist['!autofilter'] = {
    ref: `A${checklistHeaderRow}:I${checklistLastItemRow}`,
  };
  wsChecklist['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } },
  ];
  wsChecklist['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 30 },
    { wch: 56 },
    { wch: 12 },
    { wch: 36 },
    { wch: 36 },
    { wch: 18 },
    { wch: 12 },
  ];

  XLSX.utils.book_append_sheet(wb, wsChecklist, 'Inspection Checklist');

  // =========================================================================
  // SHEET 3: DEVIATIONS & CAPA REGISTER (All "No" Items)
  // =========================================================================
  const capaAoa: (string | number)[][] = [
    ['DEVIATIONS & CORRECTIVE ACTION (CAPA) REGISTER'],
    [IQAF_BASIS_STATEMENT],
    [
      `Report No.: ${reportNo}  |  Store: ${report.meta.storeLocation || 'N/A'}  |  Date: ${displayDate || 'N/A'}`,
    ],
    [],
    [
      'Item No.',
      'Section',
      'Category',
      'Inspection Item',
      'Deviation / Findings',
      'Corrective Action',
      'Photo Proof Refs',
      'Follow-Up Status',
    ],
  ];

  const capaHeaderRow = capaAoa.length;
  let deviationCount = 0;

  for (const section of CHECKLIST_SECTIONS) {
    for (const item of section.items) {
      const resp = report.responses[item.number];
      if (resp?.complied !== 'No') continue;
      deviationCount++;
      const photoNums = photoNumsByItem.get(item.number) ?? [];
      capaAoa.push([
        item.number,
        section.code,
        section.title,
        item.text,
        resp.deviation.trim() || '—',
        resp.correctiveAction.trim() || '—',
        photoNums.length > 0
          ? photoNums.map((n) => `Photo #${n}`).join(', ')
          : '—',
        'Open',
      ]);
    }
  }

  if (deviationCount === 0) {
    capaAoa.push([
      '—',
      '—',
      'No non-compliant ("No") items were recorded during this inspection.',
      '',
      '',
      '',
      '',
      'Closed',
    ]);
  }
  const capaLastRow = capaAoa.length;

  capaAoa.push([]);
  capaAoa.push([
    `Report No.: ${reportNo}`,
    '',
    '',
    `Basis: ${docNo} Store Inspection Checklist (Rev. ${revNo})`,
  ]);

  const wsCapa = XLSX.utils.aoa_to_sheet(capaAoa);
  if (deviationCount > 0) {
    wsCapa['!autofilter'] = { ref: `A${capaHeaderRow}:H${capaLastRow}` };
  }
  wsCapa['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
  ];
  wsCapa['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 28 },
    { wch: 48 },
    { wch: 38 },
    { wch: 38 },
    { wch: 18 },
    { wch: 16 },
  ];

  XLSX.utils.book_append_sheet(wb, wsCapa, 'Deviations & CAPA');

  // =========================================================================
  // SHEET 4: PHOTO PROOFS LOG (With Recorded Taken Timestamps)
  // =========================================================================
  const photosAoa: (string | number)[][] = [
    ['PHOTO PROOF & EVIDENCE AUDIT LOG'],
    [IQAF_BASIS_STATEMENT],
    [
      `Report No.: ${reportNo}  |  Total Photo Proofs: ${indexedPhotos.length}`,
    ],
    [],
    [
      'Photo #',
      'Item No.',
      'Section',
      'Category',
      'Inspection Item',
      'Complied?',
      'Caption / Description',
      'Deviation / Findings',
      'Photo Taken Timestamp',
      'File Name',
    ],
  ];

  const photosHeaderRow = photosAoa.length;
  if (indexedPhotos.length === 0) {
    photosAoa.push([
      '—',
      '—',
      '—',
      'No photo proofs attached to this report.',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  } else {
    for (const entry of indexedPhotos) {
      photosAoa.push([
        `Photo #${entry.photoIndex}`,
        entry.itemNumber,
        entry.sectionCode,
        entry.sectionTitle,
        entry.itemText,
        entry.complied,
        entry.photo.caption.trim() || '',
        entry.deviation.trim() || '',
        formatTakenTimestamp(entry.photo.capturedAt),
        entry.photo.fileName || '',
      ]);
    }
  }
  const photosLastRow = photosAoa.length;

  photosAoa.push([]);
  photosAoa.push([
    `Report No.: ${reportNo}`,
    '',
    '',
    '',
    `Basis: ${docNo} Store Inspection Checklist (Rev. ${revNo})`,
  ]);

  const wsPhotos = XLSX.utils.aoa_to_sheet(photosAoa);
  if (indexedPhotos.length > 0) {
    wsPhotos['!autofilter'] = {
      ref: `A${photosHeaderRow}:J${photosLastRow}`,
    };
  }
  wsPhotos['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
  ];
  wsPhotos['!cols'] = [
    { wch: 11 },
    { wch: 10 },
    { wch: 10 },
    { wch: 26 },
    { wch: 44 },
    { wch: 12 },
    { wch: 30 },
    { wch: 32 },
    { wch: 26 },
    { wch: 28 },
  ];

  XLSX.utils.book_append_sheet(wb, wsPhotos, 'Photo Proofs Log');

  // Generate browser-safe Blob download
  const outBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([outBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const storePart = sanitizeFilePart(report.meta.storeLocation, 'BRANCH');
  const datePart = sanitizeFilePart(report.meta.dateOfInspection, 'DATE');
  const fileName = `INSPLND-${storePart}-${datePart}.xlsx`;

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
