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
import type { InspectionReport } from '../types/inspection';

export interface DeviationAiSuggestion {
  itemNumber: number;
  rootCauseHint: string;
  recommendedAction: string;
  preventiveMeasure: string;
}

export interface EmailAiAnalysis {
  overallEmailNote: string;
  suggestions: DeviationAiSuggestion[];
  generatedAt: string;
}

export interface EmailDeviationItem {
  itemNumber: number;
  sectionCode: string;
  sectionTitle: string;
  itemText: string;
  recordedDeviation: string;
  recordedCorrectiveAction: string;
  photoCount: number;
}

export interface EmailCategoryRow {
  code: string;
  title: string;
  total: number;
  yes: number;
  no: number;
  na: number;
  pending: number;
  score: number | null;
}

export interface ComputedEmailReportData {
  reportNo: string;
  storeLocation: string;
  dateFormatted: string;
  timeFormatted: string;
  inspectedBy: string;
  documentationNo: string;
  revisionNo: string;
  answered: number;
  unanswered: number;
  yes: number;
  no: number;
  na: number;
  applicable: number;
  totalPhotos: number;
  complianceRate: number | null;
  categoryRows: EmailCategoryRow[];
  deviations: EmailDeviationItem[];
  signOffs: {
    label: string;
    role: string;
    name: string;
    date: string;
    signed: boolean;
  }[];
}

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

export function computeReportEmailData(
  report: InspectionReport
): ComputedEmailReportData {
  let answered = 0;
  let yes = 0;
  let no = 0;
  let na = 0;
  let totalPhotos = 0;

  const categoryRows: EmailCategoryRow[] = CHECKLIST_SECTIONS.map((section) => {
    let sYes = 0;
    let sNo = 0;
    let sNa = 0;
    let sPending = 0;

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
      } else if (resp.complied === 'N/A') {
        sNa++;
        na++;
        answered++;
      } else {
        sPending++;
      }
      totalPhotos += resp.photos.length;
    }

    const sApplicable = sYes + sNo;
    return {
      code: section.code,
      title: section.title,
      total: section.items.length,
      yes: sYes,
      no: sNo,
      na: sNa,
      pending: sPending,
      score: sApplicable > 0 ? Math.round((sYes / sApplicable) * 100) : null,
    };
  });

  const deviations: EmailDeviationItem[] = ALL_CHECKLIST_ITEMS.filter(
    (item) => report.responses[item.number]?.complied === 'No'
  ).map((item) => {
    const resp = report.responses[item.number] ?? createEmptyResponse();
    const section = CHECKLIST_SECTIONS.find((s) => s.code === item.sectionCode);
    return {
      itemNumber: item.number,
      sectionCode: item.sectionCode,
      sectionTitle: section?.title ?? '',
      itemText: item.text,
      recordedDeviation: resp.deviation.trim(),
      recordedCorrectiveAction: resp.correctiveAction.trim(),
      photoCount: resp.photos.length,
    };
  });

  const applicable = yes + no;
  const complianceRate =
    applicable > 0 ? Math.round((yes / applicable) * 100) : null;

  return {
    reportNo: formatReportNo(
      report.meta.storeLocation,
      report.meta.dateOfInspection,
      report.meta.reportSequence
    ),
    storeLocation: report.meta.storeLocation.trim() || 'Store Branch Not Set',
    dateFormatted:
      formatDisplayDate(report.meta.dateOfInspection) || 'Not specified',
    timeFormatted:
      formatInspectionTimeRange(
        report.meta.timeOfInspection,
        report.meta.timeOfInspectionEnded
      ) || 'Not specified',
    inspectedBy: report.meta.inspectedBy.trim() || 'Not specified',
    documentationNo: report.meta.documentationNo || 'IQAF-005',
    revisionNo: report.meta.revisionNo || '0',
    answered,
    unanswered: TOTAL_ITEMS_COUNT - answered,
    yes,
    no,
    na,
    applicable,
    totalPhotos,
    complianceRate,
    categoryRows,
    deviations,
    signOffs: [
      {
        label: 'Performed By',
        role: 'Food Safety Compliance Officer',
        name: report.signOffs.performedBy.printedName.trim(),
        date: formatDisplayDate(report.signOffs.performedBy.date),
        signed: Boolean(report.signOffs.performedBy.signatureDataUrl),
      },
      {
        label: 'Acknowledged By',
        role: 'Restaurant / Shift Manager',
        name: report.signOffs.acknowledgedBy.printedName.trim(),
        date: formatDisplayDate(report.signOffs.acknowledgedBy.date),
        signed: Boolean(report.signOffs.acknowledgedBy.signatureDataUrl),
      },
      {
        label: 'Noted By',
        role: 'Area Manager',
        name: report.signOffs.notedBy.printedName.trim(),
        date: formatDisplayDate(report.signOffs.notedBy.date),
        signed: Boolean(report.signOffs.notedBy.signatureDataUrl),
      },
      {
        label: 'Reviewed By',
        role: 'Learning and Development Manager',
        name: report.signOffs.reviewedBy.printedName.trim(),
        date: formatDisplayDate(report.signOffs.reviewedBy.date),
        signed: Boolean(report.signOffs.reviewedBy.signatureDataUrl),
      },
      {
        label: 'Approved By',
        role: 'Quality Assurance Specialist / FSCO',
        name: report.signOffs.approvedBy.printedName.trim(),
        date: formatDisplayDate(report.signOffs.approvedBy.date),
        signed: Boolean(report.signOffs.approvedBy.signatureDataUrl),
      },
    ],
  };
}

export async function fetchAiDeviationSuggestions(
  report: InspectionReport
): Promise<EmailAiAnalysis> {
  const data = computeReportEmailData(report);

  const response = await fetch('/api/ai/deviation-suggestions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      storeLocation: data.storeLocation,
      dateOfInspection: data.dateFormatted,
      reportNo: data.reportNo,
      complianceRate: data.complianceRate,
      totalChecked: data.answered,
      yesCount: data.yes,
      deviations: data.deviations.map((d) => ({
        itemNumber: d.itemNumber,
        sectionCode: d.sectionCode,
        sectionTitle: d.sectionTitle,
        itemText: d.itemText,
        recordedDeviation: d.recordedDeviation,
        recordedCorrectiveAction: d.recordedCorrectiveAction,
      })),
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | (EmailAiAnalysis & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        `Unable to generate AI suggestions (HTTP ${response.status}).`
    );
  }

  if (!payload || !Array.isArray(payload.suggestions)) {
    throw new Error('Unexpected response format from AI suggestion service.');
  }

  return {
    overallEmailNote: payload.overallEmailNote || '',
    suggestions: payload.suggestions,
    generatedAt: payload.generatedAt || new Date().toISOString(),
  };
}

const SIMPLE_EMAIL_REGEX = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]{2,}$/;

export function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function parseAndValidateEmailList(raw: string): {
  valid: string[];
  invalid: string[];
} {
  const parts = raw
    .split(/[,;\n]+/)
    .map((entry) => stripHeaderBreaks(entry))
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (!SIMPLE_EMAIL_REGEX.test(part)) {
      invalid.push(part);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(part);
    }
  }

  return { valid, invalid };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

export interface EmailComposePayload {
  reportData: ComputedEmailReportData;
  senderNote: string;
  includeAiSuggestions: boolean;
  aiAnalysis: EmailAiAnalysis | null;
}

export function buildEmailPlainText({
  reportData,
  senderNote,
  includeAiSuggestions,
  aiAnalysis,
}: EmailComposePayload): string {
  const lines: string[] = [];
  const suggestionMap = new Map<number, DeviationAiSuggestion>();
  if (includeAiSuggestions && aiAnalysis) {
    for (const s of aiAnalysis.suggestions) {
      suggestionMap.set(s.itemNumber, s);
    }
  }

  lines.push('STORE INSPECTION COMPLIANCE REPORT');
  lines.push(`Report No.: ${reportData.reportNo}`);
  lines.push(
    `Basis: ${reportData.documentationNo} (Rev. ${reportData.revisionNo})`
  );
  lines.push('='.repeat(64));
  lines.push('');

  if (senderNote.trim()) {
    lines.push(senderNote.trim());
    lines.push('');
    lines.push('-'.repeat(64));
    lines.push('');
  }

  lines.push('INSPECTION DETAILS');
  lines.push(`Store Location: ${reportData.storeLocation}`);
  lines.push(`Date of Inspection: ${reportData.dateFormatted}`);
  lines.push(`Time of Inspection: ${reportData.timeFormatted}`);
  lines.push(`Inspected By: ${reportData.inspectedBy}`);
  lines.push('');

  lines.push('OVERALL COMPLIANCE RESULTS');
  lines.push(
    `Compliance Score: ${reportData.complianceRate !== null ? `${reportData.complianceRate}%` : 'N/A'}`
  );
  lines.push(
    `Items Checked: ${reportData.answered} / ${TOTAL_ITEMS_COUNT} (${reportData.unanswered} pending)`
  );
  lines.push(
    `Complied (Yes): ${reportData.yes} | Deviations (No): ${reportData.no} | N/A: ${reportData.na} | Photo Proofs: ${reportData.totalPhotos}`
  );
  lines.push('');

  if (includeAiSuggestions && aiAnalysis?.overallEmailNote?.trim()) {
    lines.push('AI COMPLIANCE SUMMARY (EMAIL ONLY)');
    lines.push(aiAnalysis.overallEmailNote.trim());
    lines.push('');
  }

  lines.push(
    `DEVIATIONS${includeAiSuggestions && aiAnalysis ? ' & AI-GENERATED SUGGESTIONS (EMAIL ONLY)' : ''} (${reportData.deviations.length})`
  );
  lines.push('-'.repeat(64));
  if (reportData.deviations.length === 0) {
    lines.push('No non-compliant items ("No") were recorded during this inspection.');
    lines.push('');
  } else {
    for (const dev of reportData.deviations) {
      const suggestion = suggestionMap.get(dev.itemNumber);
      lines.push(
        `Item #${dev.itemNumber} [${dev.sectionCode}. ${dev.sectionTitle}]`
      );
      lines.push(`Requirement: ${dev.itemText}`);
      lines.push(
        `Recorded Findings: ${dev.recordedDeviation || 'Not specified'}`
      );
      lines.push(
        `Recorded Corrective Action: ${dev.recordedCorrectiveAction || 'Not specified'}`
      );
      if (dev.photoCount > 0) {
        lines.push(`Attached Photo Proofs in Report: ${dev.photoCount}`);
      }
      if (suggestion) {
        lines.push('AI-Generated Guidance (Email Only):');
        if (suggestion.rootCauseHint) {
          lines.push(`  - Risk / Root Cause: ${suggestion.rootCauseHint}`);
        }
        if (suggestion.recommendedAction) {
          lines.push(`  - Suggested Action: ${suggestion.recommendedAction}`);
        }
        if (suggestion.preventiveMeasure) {
          lines.push(`  - Preventive Tip: ${suggestion.preventiveMeasure}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('COMPLIANCE BREAKDOWN BY CATEGORY (SECTIONS A-Q)');
  lines.push('-'.repeat(64));
  for (const row of reportData.categoryRows) {
    const scoreStr = row.score !== null ? `${row.score}%` : '—';
    lines.push(
      `${row.code}. ${row.title}: ${scoreStr} (Yes: ${row.yes}, No: ${row.no}, N/A: ${row.na}, Pending: ${row.pending})`
    );
  }
  lines.push('');

  lines.push('SIGN-OFF STATUS');
  for (const slot of reportData.signOffs) {
    const status = slot.signed ? 'Signed' : 'Pending signature';
    const person = slot.name || 'Name pending';
    const datePart = slot.date ? ` (${slot.date})` : '';
    lines.push(`- ${slot.label} (${slot.role}): ${person}${datePart} — ${status}`);
  }
  lines.push('');
  lines.push('-'.repeat(64));
  lines.push(`Report No.: ${reportData.reportNo}`);
  lines.push(IQAF_BASIS_STATEMENT);
  lines.push(REPORT_CONFIDENTIALITY_NOTICE);
  if (includeAiSuggestions && aiAnalysis) {
    lines.push(
      'Note: AI-generated suggestions are provided in this email summary only and are not part of the official IQAF-005 PDF or Excel report.'
    );
  }

  return lines.join('\r\n');
}

export function buildEmailHtml({
  reportData,
  senderNote,
  includeAiSuggestions,
  aiAnalysis,
}: EmailComposePayload): string {
  const suggestionMap = new Map<number, DeviationAiSuggestion>();
  if (includeAiSuggestions && aiAnalysis) {
    for (const s of aiAnalysis.suggestions) {
      suggestionMap.set(s.itemNumber, s);
    }
  }

  const scoreColor =
    reportData.complianceRate === null
      ? '#334155'
      : reportData.complianceRate >= 90
        ? '#047857'
        : reportData.complianceRate >= 75
          ? '#b45309'
          : '#b91c1c';

  const deviationsHtml =
    reportData.deviations.length === 0
      ? `<div style="padding:16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;color:#065f46;font-size:13px;">
          <strong>Zero deviations recorded.</strong> All applicable inspected items complied with ${escapeHtml(reportData.documentationNo)} standards.
        </div>`
      : reportData.deviations
          .map((dev) => {
            const suggestion = suggestionMap.get(dev.itemNumber);
            const aiBlock = suggestion
              ? `<div style="margin-top:10px;padding:12px 14px;background:#f8fafc;border-left:3px solid #1e293b;border-radius:0 6px 6px 0;">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#334155;margin-bottom:6px;">
                    AI-Generated Suggestion (Email Only)
                  </div>
                  ${
                    suggestion.rootCauseHint
                      ? `<div style="font-size:12.5px;color:#334155;margin-bottom:5px;line-height:1.45;"><strong>Risk / Root Cause:</strong> ${formatMultilineHtml(suggestion.rootCauseHint)}</div>`
                      : ''
                  }
                  ${
                    suggestion.recommendedAction
                      ? `<div style="font-size:12.5px;color:#0f172a;margin-bottom:5px;line-height:1.45;"><strong>Suggested Action:</strong> ${formatMultilineHtml(suggestion.recommendedAction)}</div>`
                      : ''
                  }
                  ${
                    suggestion.preventiveMeasure
                      ? `<div style="font-size:12.5px;color:#334155;line-height:1.45;"><strong>Preventive Control:</strong> ${formatMultilineHtml(suggestion.preventiveMeasure)}</div>`
                      : ''
                  }
                </div>`
              : '';

            return `<div style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden;background:#ffffff;">
              <div style="background:#fef2f2;border-bottom:1px solid #fecaca;padding:9px 14px;">
                <span style="font-family:monospace;font-weight:700;color:#b91c1c;font-size:12.5px;">Item #${dev.itemNumber}</span>
                <span style="color:#64748b;font-size:12px;margin-left:8px;">${escapeHtml(dev.sectionCode)}. ${escapeHtml(dev.sectionTitle)}</span>
              </div>
              <div style="padding:12px 14px;">
                <div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:8px;line-height:1.4;">
                  ${escapeHtml(dev.itemText)}
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12.5px;">
                  <tr>
                    <td style="padding:4px 8px 4px 0;vertical-align:top;width:36%;color:#64748b;font-weight:600;">Recorded Findings:</td>
                    <td style="padding:4px 0;vertical-align:top;color:#1e293b;line-height:1.4;">${dev.recordedDeviation ? formatMultilineHtml(dev.recordedDeviation) : '<span style="color:#94a3b8;font-style:italic;">Not specified</span>'}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 8px 4px 0;vertical-align:top;color:#64748b;font-weight:600;">Recorded Corrective Action:</td>
                    <td style="padding:4px 0;vertical-align:top;color:#1e293b;line-height:1.4;">${dev.recordedCorrectiveAction ? formatMultilineHtml(dev.recordedCorrectiveAction) : '<span style="color:#94a3b8;font-style:italic;">Not specified</span>'}</td>
                  </tr>
                  ${
                    dev.photoCount > 0
                      ? `<tr>
                          <td style="padding:4px 8px 4px 0;vertical-align:top;color:#64748b;font-weight:600;">Photo Proofs Logged:</td>
                          <td style="padding:4px 0;vertical-align:top;color:#334155;">${dev.photoCount} ${dev.photoCount === 1 ? 'photo' : 'photos'} attached in full PDF/online report</td>
                        </tr>`
                      : ''
                  }
                </table>
                ${aiBlock}
              </div>
            </div>`;
          })
          .join('');

  const categoryRowsHtml = reportData.categoryRows
    .map((row) => {
      const scoreText = row.score !== null ? `${row.score}%` : '—';
      const rowScoreColor =
        row.score === null
          ? '#94a3b8'
          : row.score === 100
            ? '#047857'
            : row.score >= 80
              ? '#b45309'
              : '#b91c1c';
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;">
          <strong style="font-family:monospace;color:#64748b;">${escapeHtml(row.code)}.</strong> ${escapeHtml(row.title)}
        </td>
        <td style="padding:7px 6px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;font-family:monospace;color:#047857;">${row.yes}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;font-family:monospace;color:${row.no > 0 ? '#b91c1c;font-weight:700' : '#94a3b8'};">${row.no}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;font-family:monospace;color:#64748b;">${row.na}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;font-family:monospace;color:#64748b;">${row.pending}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-family:monospace;font-weight:700;color:${rowScoreColor};">${scoreText}</td>
      </tr>`;
    })
    .join('');

  const renderSignOffCell = (
    slot: ComputedEmailReportData['signOffs'][number],
    widthPct: string
  ) => `<td style="width:${widthPct};padding:10px;border:1px solid #e2e8f0;vertical-align:top;background:#f8fafc;">
        <div style="font-size:11.5px;font-weight:700;color:#0f172a;">${escapeHtml(slot.label)}</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">${escapeHtml(slot.role)}</div>
        <div style="font-size:12px;color:#0f172a;font-weight:600;">${slot.name ? escapeHtml(slot.name) : '<span style="color:#94a3b8;font-weight:400;">Name pending</span>'}</div>
        <div style="font-size:11px;color:${slot.signed ? '#047857' : '#b45309'};margin-top:3px;font-weight:600;">
          ${slot.signed ? 'Signed' : 'Signature pending'}${slot.date ? ` · ${escapeHtml(slot.date)}` : ''}
        </div>
      </td>`;

  const topSignOffCellsHtml = reportData.signOffs
    .slice(0, 3)
    .map((slot) => renderSignOffCell(slot, '33.33%'))
    .join('');
  const bottomSignOffCellsHtml = reportData.signOffs
    .slice(3)
    .map((slot) => renderSignOffCell(slot, '50%'))
    .join('');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
            <!-- Header Banner -->
            <tr>
              <td style="background:#0f172a;color:#ffffff;padding:20px 24px;">
                <div style="font-size:11px;font-family:monospace;color:#cbd5e1;letter-spacing:0.04em;">
                  REPORT NO.: ${escapeHtml(reportData.reportNo)}
                </div>
                <h1 style="margin:6px 0 4px 0;font-size:20px;line-height:1.25;font-weight:700;color:#ffffff;">
                  Store Inspection Compliance Report
                </h1>
                <div style="font-size:12.5px;color:#e2e8f0;">
                  ${escapeHtml(reportData.storeLocation)} · ${escapeHtml(reportData.dateFormatted)}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 24px;">
                ${
                  senderNote.trim()
                    ? `<div style="margin-bottom:18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;line-height:1.5;color:#1e293b;">
                        ${formatMultilineHtml(senderNote.trim())}
                      </div>`
                    : ''
                }

                <!-- Inspection Metadata -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:18px;font-size:12.5px;">
                  <tr>
                    <td style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;color:#475569;width:34%;">Store Location</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;">${escapeHtml(reportData.storeLocation)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;color:#475569;">Date &amp; Time</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(reportData.dateFormatted)} · ${escapeHtml(reportData.timeFormatted)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;color:#475569;">Inspected By</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(reportData.inspectedBy)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569;">Basis Form</td>
                    <td style="padding:8px 12px;color:#0f172a;font-family:monospace;">${escapeHtml(reportData.documentationNo)} (Rev. ${escapeHtml(reportData.revisionNo)})</td>
                  </tr>
                </table>

                <!-- KPI Strip -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:18px;">
                  <tr>
                    <td style="width:25%;padding:12px;border-right:1px solid #e2e8f0;text-align:center;">
                      <div style="font-size:11px;color:#64748b;font-weight:600;">Compliance Score</div>
                      <div style="font-size:22px;font-weight:700;font-family:monospace;color:${scoreColor};margin-top:4px;">
                        ${reportData.complianceRate !== null ? `${reportData.complianceRate}%` : '—'}
                      </div>
                    </td>
                    <td style="width:25%;padding:12px;border-right:1px solid #e2e8f0;text-align:center;">
                      <div style="font-size:11px;color:#64748b;font-weight:600;">Items Checked</div>
                      <div style="font-size:20px;font-weight:700;font-family:monospace;color:#0f172a;margin-top:4px;">
                        ${reportData.answered}/${TOTAL_ITEMS_COUNT}
                      </div>
                    </td>
                    <td style="width:25%;padding:12px;border-right:1px solid #e2e8f0;text-align:center;">
                      <div style="font-size:11px;color:#64748b;font-weight:600;">Complied (Yes)</div>
                      <div style="font-size:20px;font-weight:700;font-family:monospace;color:#047857;margin-top:4px;">
                        ${reportData.yes}
                      </div>
                    </td>
                    <td style="width:25%;padding:12px;text-align:center;">
                      <div style="font-size:11px;color:#64748b;font-weight:600;">Deviations (No)</div>
                      <div style="font-size:20px;font-weight:700;font-family:monospace;color:${reportData.no > 0 ? '#b91c1c' : '#047857'};margin-top:4px;">
                        ${reportData.no}
                      </div>
                    </td>
                  </tr>
                </table>

                ${
                  includeAiSuggestions && aiAnalysis?.overallEmailNote?.trim()
                    ? `<div style="margin-bottom:20px;padding:14px 16px;background:#f8fafc;border:1px solid #cbd5e1;border-left:4px solid #b91c1c;border-radius:6px;">
                        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#475569;margin-bottom:5px;">
                          AI Compliance Executive Summary (Email Only)
                        </div>
                        <div style="font-size:13px;line-height:1.5;color:#0f172a;">
                          ${formatMultilineHtml(aiAnalysis.overallEmailNote.trim())}
                        </div>
                      </div>`
                    : ''
                }

                <!-- Deviations & AI Suggestions -->
                <h2 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#0f172a;">
                  Deviations${includeAiSuggestions && aiAnalysis ? ' &amp; AI-Generated Suggestions (Email Only)' : ''} (${reportData.deviations.length})
                </h2>
                ${deviationsHtml}

                <!-- Category Breakdown -->
                <h2 style="margin:22px 0 10px 0;font-size:15px;font-weight:700;color:#0f172a;">
                  Compliance Breakdown by Category (Sections A–Q)
                </h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:20px;">
                  <thead>
                    <tr style="background:#f1f5f9;">
                      <th align="left" style="padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">Category</th>
                      <th align="center" style="padding:8px 6px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">Yes</th>
                      <th align="center" style="padding:8px 6px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">No</th>
                      <th align="center" style="padding:8px 6px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">N/A</th>
                      <th align="center" style="padding:8px 6px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">Pending</th>
                      <th align="right" style="padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11.5px;color:#334155;">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${categoryRowsHtml}
                  </tbody>
                </table>

                <!-- Sign-Off Status -->
                <h2 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#0f172a;">
                  Sign-Off Status
                </h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    ${topSignOffCellsHtml}
                  </tr>
                </table>
                ${
                  bottomSignOffCellsHtml
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:-1px;margin-bottom:18px;">
                        <tr>
                          ${bottomSignOffCellsHtml}
                        </tr>
                      </table>`
                    : ''
                }
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;font-size:11px;color:#64748b;line-height:1.5;">
                <div style="font-family:monospace;font-weight:700;color:#334155;">
                  Report No.: ${escapeHtml(reportData.reportNo)}
                </div>
                <div>${escapeHtml(IQAF_BASIS_STATEMENT)}</div>
                <div style="margin-top:4px;font-style:italic;color:#64748b;">
                  ${escapeHtml(REPORT_CONFIDENTIALITY_NOTICE)}
                </div>
                ${
                  includeAiSuggestions && aiAnalysis
                    ? `<div style="margin-top:4px;color:#64748b;">
                        AI-generated deviation suggestions appear in this email report only and do not modify the saved IQAF-005 checklist, PDF, or Excel files.
                      </div>`
                    : ''
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function toBase64Url(str: string): string {
  return toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeHeaderUtf8(value: string): string {
  const clean = stripHeaderBreaks(value);
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${toBase64(clean)}?=`;
}

export interface SendGmailReportParams {
  accessToken: string;
  to: string[];
  cc: string[];
  subject: string;
  plainText: string;
  html: string;
}

export async function sendInspectionEmailViaGmail({
  accessToken,
  to,
  cc,
  subject,
  plainText,
  html,
}: SendGmailReportParams): Promise<{ id: string; threadId?: string }> {
  if (!accessToken.trim()) {
    throw new GmailAuthError('Gmail permission is required before sending.');
  }
  if (to.length === 0) {
    throw new Error('Please enter at least one valid recipient email address.');
  }

  const boundary = `iqaf_report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const headers: string[] = [
    `To: ${to.map(stripHeaderBreaks).join(', ')}`,
  ];
  if (cc.length > 0) {
    headers.push(`Cc: ${cc.map(stripHeaderBreaks).join(', ')}`);
  }
  headers.push(`Subject: ${encodeHeaderUtf8(subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const mimeMessage = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    toBase64(plainText),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    toBase64(html),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const raw = toBase64Url(mimeMessage);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (response.status === 401 || response.status === 403) {
    throw new GmailAuthError(
      'Your Gmail sending session expired or lacks send permission. Please reconnect Gmail and try again.'
    );
  }

  const data = (await response.json().catch(() => null)) as {
    id?: string;
    threadId?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok || !data?.id) {
    throw new Error(
      data?.error?.message ||
        `Gmail could not send this email (HTTP ${response.status}).`
    );
  }

  return { id: data.id, threadId: data.threadId };
}
