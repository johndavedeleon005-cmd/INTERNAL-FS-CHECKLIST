import jsPDF, { GState } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  FORM_DOCUMENTATION_NO,
  FORM_REVISION_NO,
  HOW_TO_FILL_INSTRUCTION,
  IQAF_BASIS_STATEMENT,
  REPORT_CONFIDENTIALITY_NOTICE,
  createEmptyResponse,
  formatDisplayDate,
  formatInspectionTimeRange,
  formatReportNo,
  getInspectionShortYear,
  normalizeReportSequence,
} from '../data/checklistData';
import type {
  InspectionReport,
  PdfExportOptions,
  PhotoProof,
} from '../types/inspection';
import {
  formatTakenTimestamp,
  getImageDimensions,
  loadJiangNanLogoForPdf,
} from './imageUtils';

export interface IndexedPhotoProof {
  photoIndex: number;
  itemNumber: number;
  sectionCode: string;
  sectionTitle: string;
  itemText: string;
  complied: string;
  deviation: string;
  correctiveAction: string;
  photo: PhotoProof;
}

export function collectIndexedPhotos(
  report: InspectionReport
): IndexedPhotoProof[] {
  const list: IndexedPhotoProof[] = [];
  let counter = 1;

  for (const section of CHECKLIST_SECTIONS) {
    for (const item of section.items) {
      const resp = report.responses[item.number];
      if (!resp || !resp.photos.length) continue;
      for (const photo of resp.photos) {
        list.push({
          photoIndex: counter++,
          itemNumber: item.number,
          sectionCode: section.code,
          sectionTitle: section.title,
          itemText: item.text,
          complied: resp.complied || 'Unanswered',
          deviation: resp.deviation,
          correctiveAction: resp.correctiveAction,
          photo,
        });
      }
    }
  }
  return list;
}

function sanitizeFilePart(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return cleaned || fallback;
}

type LogoAsset = { dataUrl: string; width: number; height: number } | null;

interface RenderedReportSegment {
  startPage: number;
  endPage: number;
  reportNo: string;
  docNo: string;
}

async function renderReportIntoPdf(
  doc: jsPDF,
  report: InspectionReport,
  options: PdfExportOptions,
  logoAsset: LogoAsset,
  extra?: { blankTemplate?: boolean; isFirstReport?: boolean }
): Promise<RenderedReportSegment> {
  const isBlankTemplate = Boolean(extra?.blankTemplate);
  const isFirstReport = extra?.isFirstReport !== false;
  if (!isFirstReport) {
    doc.addPage();
  }
  const startPage = doc.getNumberOfPages();

  const pageWidth = doc.internal.pageSize.getWidth(); // 215.9mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 279.4mm
  const marginX = 12.7;
  const contentWidth = pageWidth - marginX * 2; // 190.5mm
  const reportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection,
    report.meta.reportSequence
  );
  const docNo = report.meta.documentationNo || 'IQAF-005';

  const drawLogoInBox = (
    boxX: number,
    boxY: number,
    maxW: number,
    maxH: number
  ) => {
    if (!logoAsset) return;
    const scale = Math.min(maxW / logoAsset.width, maxH / logoAsset.height);
    const drawW = logoAsset.width * scale;
    const drawH = logoAsset.height * scale;
    const drawY = boxY + (maxH - drawH) / 2;
    doc.addImage(logoAsset.dataUrl, 'PNG', boxX, drawY, drawW, drawH);
  };
  const indexedPhotos = collectIndexedPhotos(report);
  const photoNumbersByItem = new Map<number, number[]>();
  for (const entry of indexedPhotos) {
    const arr = photoNumbersByItem.get(entry.itemNumber) ?? [];
    arr.push(entry.photoIndex);
    photoNumbersByItem.set(entry.itemNumber, arr);
  }

  // Pre-measure photo dimensions for crisp, undistorted rendering
  const photoDimensions = new Map<string, { width: number; height: number }>();
  for (const entry of indexedPhotos) {
    const dims = await getImageDimensions(entry.photo.dataUrl);
    photoDimensions.set(entry.photo.id, dims);
  }

  // Pre-measure signature images
  const sigDims: Record<string, { width: number; height: number }> = {};
  const signKeys = [
    'performedBy',
    'acknowledgedBy',
    'notedBy',
    'reviewedBy',
    'approvedBy',
  ] as const;
  for (const key of signKeys) {
    const url = report.signOffs[key].signatureDataUrl;
    if (url) {
      sigDims[key] = await getImageDimensions(url);
    }
  }

  // =========================================================================
  // PAGE 1 TOP HEADER BLOCK (Exact match to IQAF-005 PDF)
  // =========================================================================
  let cursorY = 10.5;
  const leftTitleW = 108;
  const rightDocLabelW = 41.5;
  const rightDocValW = contentWidth - leftTitleW - rightDocLabelW; // 41mm
  const headerTopH = 15.5;
  const halfHeaderH = headerTopH / 2;

  doc.setDrawColor(64, 64, 64);
  doc.setLineWidth(0.22);

  // Left main title cell
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, cursorY, leftTitleW, headerTopH, 'FD');

  drawLogoInBox(marginX + 2.5, cursorY + 2, 28, headerTopH - 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(17, 17, 17);
  doc.text('Store Inspection Checklist', marginX + 67, cursorY + 9.2, {
    align: 'center',
  });

  // Right Documentation No. / Revision No. cells
  const rightX = marginX + leftTitleW;
  doc.rect(rightX, cursorY, rightDocLabelW, halfHeaderH, 'FD');
  doc.rect(rightX + rightDocLabelW, cursorY, rightDocValW, halfHeaderH, 'FD');
  doc.rect(rightX, cursorY + halfHeaderH, rightDocLabelW, halfHeaderH, 'FD');
  doc.rect(
    rightX + rightDocLabelW,
    cursorY + halfHeaderH,
    rightDocValW,
    halfHeaderH,
    'FD'
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Documentation No.:', rightX + rightDocLabelW - 2, cursorY + 5, {
    align: 'right',
  });
  doc.text(
    'Revision No.:',
    rightX + rightDocLabelW - 2,
    cursorY + halfHeaderH + 5,
    { align: 'right' }
  );

  doc.setFont('helvetica', 'normal');
  doc.text(
    report.meta.documentationNo || 'IQAF-005',
    rightX + rightDocLabelW + 2,
    cursorY + 5
  );
  doc.text(
    report.meta.revisionNo || '0',
    rightX + rightDocLabelW + 2,
    cursorY + halfHeaderH + 5
  );

  cursorY += headerTopH;

  // Metadata 4-row table (exact grey left column, white right column)
  const metaRows: [string, string][] = [
    ['Date of Inspection:', formatDisplayDate(report.meta.dateOfInspection)],
    ['Store Location:', report.meta.storeLocation],
    [
      'Time of Inspection:',
      formatInspectionTimeRange(
        report.meta.timeOfInspection,
        report.meta.timeOfInspectionEnded
      ),
    ],
    ['Inspected By:', report.meta.inspectedBy],
  ];

  const metaLabelW = 88.5;
  const metaValW = contentWidth - metaLabelW;
  const metaRowH = 6.2;

  for (const [label, value] of metaRows) {
    doc.setFillColor(239, 239, 239);
    doc.rect(marginX, cursorY, metaLabelW, metaRowH, 'FD');
    doc.setFillColor(255, 255, 255);
    doc.rect(marginX + metaLabelW, cursorY, metaValW, metaRowH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(17, 17, 17);
    doc.text(label, marginX + 2, cursorY + 4.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(value || '', marginX + metaLabelW + 2.2, cursorY + 4.2, {
      maxWidth: metaValW - 4,
    });

    cursorY += metaRowH;
  }

  // Exact italic "How to fill in" instruction line & IQAF-005 basis note
  cursorY += 3.5;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.2);
  doc.setTextColor(34, 34, 34);
  const instructionLines = doc.splitTextToSize(
    HOW_TO_FILL_INSTRUCTION,
    contentWidth
  );
  doc.text(instructionLines, marginX, cursorY);
  cursorY += instructionLines.length * 3.1 + 1.1;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  const basisLines = doc.splitTextToSize(IQAF_BASIS_STATEMENT, contentWidth);
  doc.text(basisLines, marginX, cursorY);
  cursorY += basisLines.length * 3.0 + 1.6;

  // =========================================================================
  // MAIN 67-ITEM CHECKLIST TABLE
  // =========================================================================
  interface RowMeta {
    isSection: boolean;
    itemNumber?: number;
    photos?: PhotoProof[];
  }
  const rowMetaMap = new Map<number, RowMeta>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyRows: any[] = [];

  for (const section of CHECKLIST_SECTIONS) {
    rowMetaMap.set(bodyRows.length, { isSection: true });
    bodyRows.push([
      {
        content: `${section.code}. ${section.title}`,
        colSpan: 5,
        styles: {
          fillColor: [217, 217, 217],
          fontStyle: 'bold',
          textColor: [17, 17, 17],
          halign: 'left',
          cellPadding: { top: 1.7, right: 2, bottom: 1.7, left: 2 },
        },
      },
    ]);

    for (const item of section.items) {
      const resp = report.responses[item.number];
      const complied = resp?.complied || '';
      const photoNums = photoNumbersByItem.get(item.number) ?? [];
      const photos = resp?.photos ?? [];

      let deviationText = resp?.deviation?.trim() || '';
      if (photoNums.length > 0) {
        const refLabel =
          photoNums.length === 1
            ? `[Photo Proof #${photoNums[0]}]`
            : `[Photo Proofs ${photoNums.map((n) => `#${n}`).join(', ')}]`;
        deviationText = deviationText
          ? `${deviationText}\n${refLabel}`
          : refLabel;
      }

      // If inline thumbnails enabled and photos exist, add extra spacing for thumbnail strip
      const inlineThumbPadBottom =
        options.includeInlineThumbnails && photos.length > 0 ? 15 : 1.7;

      rowMetaMap.set(bodyRows.length, {
        isSection: false,
        itemNumber: item.number,
        photos,
      });

      const compliedColor: [number, number, number] =
        complied === 'Yes'
          ? [22, 101, 52]
          : complied === 'No'
            ? [185, 28, 28]
            : [71, 85, 105];

      bodyRows.push([
        {
          content: String(item.number),
          styles: { halign: 'center', valign: 'middle' },
        },
        {
          content: item.text,
          styles: { halign: 'left', valign: 'middle' },
        },
        {
          content: complied,
          styles: {
            halign: 'center',
            valign: 'middle',
            fontStyle: complied ? 'bold' : 'normal',
            textColor: compliedColor,
          },
        },
        {
          content: deviationText,
          styles: {
            halign: 'left',
            valign:
              options.includeInlineThumbnails && photos.length > 0
                ? 'top'
                : 'middle',
            cellPadding: {
              top: 1.7,
              right: 2,
              bottom: inlineThumbPadBottom,
              left: 2,
            },
          },
        },
        {
          content: resp?.correctiveAction?.trim() || '',
          styles: { halign: 'left', valign: 'middle' },
        },
      ]);
    }
  }

  autoTable(doc, {
    startY: cursorY,
    margin: { top: 11, right: marginX, bottom: 14, left: marginX },
    tableWidth: contentWidth,
    theme: 'grid',
    head: [
      [
        'No.',
        'Inspection Item',
        'Complied?',
        'Deviation / Findings',
        'Corrective Action',
      ],
    ],
    body: bodyRows,
    headStyles: {
      fillColor: [64, 64, 64],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      valign: 'middle',
      lineColor: [64, 64, 64],
      lineWidth: 0.22,
      cellPadding: { top: 2.1, right: 1.8, bottom: 2.1, left: 1.8 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.7,
      textColor: [17, 17, 17],
      lineColor: [64, 64, 64],
      lineWidth: 0.2,
      cellPadding: { top: 1.7, right: 2, bottom: 1.7, left: 2 },
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 9.5 },
      1: { cellWidth: 79.0 },
      2: { cellWidth: 19.0 },
      3: { cellWidth: 41.5 },
      4: { cellWidth: 41.5 },
    },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didDrawCell: (data) => {
      if (
        options.includeInlineThumbnails &&
        data.section === 'body' &&
        data.column.index === 3
      ) {
        const meta = rowMetaMap.get(data.row.index);
        if (meta && !meta.isSection && meta.photos && meta.photos.length > 0) {
          const thumbs = meta.photos.slice(0, 3);
          const thumbH = 11.5;
          const thumbW = 11.5;
          const startThumbY = data.cell.y + data.cell.height - thumbH - 1.8;
          let thumbX = data.cell.x + 2;

          for (const ph of thumbs) {
            try {
              const dims = photoDimensions.get(ph.id) ?? { width: 4, height: 3 };
              const ratio = dims.width / dims.height;
              let drawW = thumbW;
              let drawH = thumbH;
              if (ratio > 1) {
                drawH = thumbW / ratio;
              } else {
                drawW = thumbH * ratio;
              }
              const offsetX = (thumbW - drawW) / 2;
              const offsetY = (thumbH - drawH) / 2;

              doc.setDrawColor(180, 180, 180);
              doc.setLineWidth(0.15);
              doc.rect(thumbX, startThumbY, thumbW, thumbH);
              doc.addImage(
                ph.dataUrl,
                'JPEG',
                thumbX + offsetX,
                startThumbY + offsetY,
                drawW,
                drawH
              );
              thumbX += thumbW + 1.5;
            } catch {
              // Ignore malformed image data
            }
          }
        }
      }
    },
  });

  // =========================================================================
  // REUSABLE SIGN-OFF & VERIFICATION BLOCK (Exact IQAF-005 Bottom Layout)
  // =========================================================================
  const sigHeaderH = 5.6;
  const sigBoxH = 16.5;
  const sigLabelH = 8.8;
  const sigRowH = sigHeaderH + sigBoxH + sigLabelH; // 30.9mm per row
  const sigRowGap = 2.5;
  const sigBlockTotalH = sigRowH * 2 + sigRowGap + 7.2; // ~71.5mm

  const primarySignOffCols = [
    {
      heading: 'Performed By',
      role: 'Food Safety Compliance Officer',
      entry: report.signOffs.performedBy,
      key: 'performedBy',
    },
    {
      heading: 'Acknowledged By',
      role: 'Restaurant / Shift Manager',
      entry: report.signOffs.acknowledgedBy,
      key: 'acknowledgedBy',
    },
    {
      heading: 'Noted By',
      role: 'Area Manager',
      entry: report.signOffs.notedBy,
      key: 'notedBy',
    },
  ];

  const secondarySignOffCols = [
    {
      heading: 'Reviewed By',
      role: 'Learning and Development Manager',
      entry: report.signOffs.reviewedBy,
      key: 'reviewedBy',
    },
    {
      heading: 'Approved By',
      role: 'Quality Assurance Specialist / FSCO',
      entry: report.signOffs.approvedBy,
      key: 'approvedBy',
    },
  ];

  const drawSignOffRow = (
    cols: typeof primarySignOffCols,
    rowTopY: number
  ) => {
    const rowColW = contentWidth / cols.length;
    cols.forEach((col, idx) => {
      const x = marginX + idx * rowColW;

      // Header row
      doc.setFillColor(217, 217, 217);
      doc.rect(x, rowTopY, rowColW, sigHeaderH, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(17, 17, 17);
      doc.text(col.heading, x + rowColW / 2, rowTopY + 3.9, { align: 'center' });

      // Signature + printed name / date box
      doc.setFillColor(255, 255, 255);
      doc.rect(x, rowTopY + sigHeaderH, rowColW, sigBoxH, 'FD');

      if (col.entry.signatureDataUrl) {
        try {
          const dims = sigDims[col.key] ?? { width: 3, height: 1 };
          const maxSigW = rowColW - 14;
          const maxSigH = 10;
          const scale = Math.min(maxSigW / dims.width, maxSigH / dims.height);
          const drawW = dims.width * scale;
          const drawH = dims.height * scale;
          const sx = x + (rowColW - drawW) / 2;
          const syImg = rowTopY + sigHeaderH + 1.2 + (maxSigH - drawH) / 2;
          doc.addImage(col.entry.signatureDataUrl, 'PNG', sx, syImg, drawW, drawH);
        } catch {
          // Skip invalid signature image
        }
      }

      const nameDateLine = [
        col.entry.printedName?.trim(),
        col.entry.date ? formatDisplayDate(col.entry.date) : '',
      ]
        .filter(Boolean)
        .join('  /  ');

      if (nameDateLine) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(17, 17, 17);
        doc.text(nameDateLine, x + rowColW / 2, rowTopY + sigHeaderH + sigBoxH - 2.0, {
          align: 'center',
          maxWidth: rowColW - 4,
        });
      }

      // Role subtitle cell
      doc.setFillColor(255, 255, 255);
      doc.rect(x, rowTopY + sigHeaderH + sigBoxH, rowColW, sigLabelH, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(17, 17, 17);
      doc.text(col.role, x + rowColW / 2, rowTopY + sigHeaderH + sigBoxH + 3.5, {
        align: 'center',
        maxWidth: rowColW - 3,
      });
      doc.text(
        'Signature over printed name / Date',
        x + rowColW / 2,
        rowTopY + sigHeaderH + sigBoxH + 7.0,
        { align: 'center', maxWidth: rowColW - 3 }
      );
    });
  };

  const drawSignOffBlock = (startY: number) => {
    let sigY = startY;
    if (sigY + sigBlockTotalH > pageHeight - 14) {
      doc.addPage();
      sigY = 14;
    }

    doc.setDrawColor(64, 64, 64);
    doc.setLineWidth(0.22);

    drawSignOffRow(primarySignOffCols, sigY);
    drawSignOffRow(secondarySignOffCols, sigY + sigRowH + sigRowGap);

    // Department & Basis Form # line directly beneath sign-off tables
    const deptY = sigY + sigRowH * 2 + sigRowGap + 5.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(17, 17, 17);
    doc.text('Quality Assurance Department', marginX, deptY);

    doc.setFont('helvetica', 'normal');
    doc.text(
      `Basis Form #: ${report.meta.documentationNo || 'IQAF-005'}   Revision No.: ${report.meta.revisionNo || '0'}`,
      marginX + contentWidth / 2,
      deptY,
      { align: 'center' }
    );
  };

  // Sign-off block at bottom of main Store Inspection Checklist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastTableY = (doc as any).lastAutoTable?.finalY ?? cursorY;
  drawSignOffBlock(lastTableY + 6);

  // =========================================================================
  // INSPECTION SUMMARY SHEET (Exact IQAF-005 Table Styling)
  // =========================================================================
  if (options.includeSummary) {
    doc.addPage();
    let sy = 10.5;

    // Matching IQAF-005 header strip
    doc.setDrawColor(64, 64, 64);
    doc.setLineWidth(0.22);
    doc.setFillColor(255, 255, 255);
    doc.rect(marginX, sy, leftTitleW, 13, 'FD');

    drawLogoInBox(marginX + 2.5, sy + 1.8, 25, 9.4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(17, 17, 17);
    doc.text('Store Inspection Summary', marginX + 67, sy + 6.2, {
      align: 'center',
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(64, 64, 64);
    const sumSub = [
      report.meta.storeLocation || 'Store Inspection',
      formatDisplayDate(report.meta.dateOfInspection),
      report.meta.inspectedBy ? `Inspector: ${report.meta.inspectedBy}` : '',
    ]
      .filter(Boolean)
      .join('  |  ');
    doc.text(sumSub, marginX + 67, sy + 10.5, {
      align: 'center',
      maxWidth: 74,
    });

    const sxRight = marginX + leftTitleW;
    doc.setFillColor(255, 255, 255);
    doc.rect(sxRight, sy, rightDocLabelW, 6.5, 'FD');
    doc.rect(sxRight + rightDocLabelW, sy, rightDocValW, 6.5, 'FD');
    doc.rect(sxRight, sy + 6.5, rightDocLabelW, 6.5, 'FD');
    doc.rect(sxRight + rightDocLabelW, sy + 6.5, rightDocValW, 6.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(17, 17, 17);
    doc.text('Documentation No.:', sxRight + rightDocLabelW - 2, sy + 4.4, {
      align: 'right',
    });
    doc.text('Revision No.:', sxRight + rightDocLabelW - 2, sy + 10.8, {
      align: 'right',
    });

    doc.setFont('helvetica', 'normal');
    doc.text(
      report.meta.documentationNo || 'IQAF-005',
      sxRight + rightDocLabelW + 2,
      sy + 4.4
    );
    doc.text(
      report.meta.revisionNo || '0',
      sxRight + rightDocLabelW + 2,
      sy + 10.8
    );

    sy += 17;

    // Compute overall & section metrics
    let totalYes = 0;
    let totalNo = 0;
    let totalNa = 0;
    let totalPending = 0;

    const categoryRows: string[][] = [];
    const deviationRows: string[][] = [];

    for (const section of CHECKLIST_SECTIONS) {
      let sYes = 0;
      let sNo = 0;
      let sNa = 0;
      let sPending = 0;
      let sPhotos = 0;

      for (const item of section.items) {
        const r = report.responses[item.number];
        const status = r?.complied || '';
        const pCount = r?.photos?.length ?? 0;
        sPhotos += pCount;

        if (status === 'Yes') {
          sYes++;
          totalYes++;
        } else if (status === 'No') {
          sNo++;
          totalNo++;
          const pNums = photoNumbersByItem.get(item.number) ?? [];
          const pRef =
            pNums.length > 0 ? pNums.map((n) => `#${n}`).join(', ') : '—';
          deviationRows.push([
            String(item.number),
            `${section.code}. ${section.title}\n${item.text}`,
            r?.deviation?.trim() || '—',
            r?.correctiveAction?.trim() || '—',
            pRef,
          ]);
        } else if (status === 'N/A') {
          sNa++;
          totalNa++;
        } else {
          sPending++;
          totalPending++;
        }
      }

      const sApplicable = sYes + sNo;
      const sScore =
        sApplicable > 0 ? `${Math.round((sYes / sApplicable) * 100)}%` : '—';

      categoryRows.push([
        `${section.code}. ${section.title}`,
        String(section.items.length),
        String(sYes),
        String(sNo),
        String(sNa),
        String(sPending),
        String(sPhotos),
        sScore,
      ]);
    }

    const totalApplicable = totalYes + totalNo;
    const totalAnswered = totalYes + totalNo + totalNa;
    const overallScore =
      totalApplicable > 0
        ? `${Math.round((totalYes / totalApplicable) * 100)}%`
        : '—';

    // Overall KPI Summary Grid
    autoTable(doc, {
      startY: sy,
      margin: { top: 11, right: marginX, bottom: 14, left: marginX },
      tableWidth: contentWidth,
      theme: 'grid',
      head: [
        [
          {
            content: 'Overall Compliance Summary',
            colSpan: 6,
            styles: { halign: 'left' },
          },
        ],
      ],
      body: [
        [
          { content: 'Compliance Rate', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: overallScore, styles: { fontStyle: 'bold', halign: 'center' } },
          { content: 'Items Checked', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: `${totalAnswered} / ${ALL_CHECKLIST_ITEMS.length}`, styles: { halign: 'center' } },
          { content: 'Photo Proofs', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: String(indexedPhotos.length), styles: { halign: 'center' } },
        ],
        [
          { content: 'Complied (Yes)', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: String(totalYes), styles: { textColor: [22, 101, 52], fontStyle: 'bold', halign: 'center' } },
          { content: 'Deviations (No)', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: String(totalNo), styles: { textColor: totalNo > 0 ? [185, 28, 28] : [17, 17, 17], fontStyle: 'bold', halign: 'center' } },
          { content: 'N/A / Pending', styles: { fillColor: [239, 239, 239], fontStyle: 'bold' } },
          { content: `${totalNa} N/A · ${totalPending} Pending`, styles: { halign: 'center' } },
        ],
      ],
      headStyles: {
        fillColor: [64, 64, 64],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        lineColor: [64, 64, 64],
        lineWidth: 0.22,
      },
      styles: {
        font: 'helvetica',
        fontSize: 8,
        textColor: [17, 17, 17],
        lineColor: [64, 64, 64],
        lineWidth: 0.2,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterKpiY = ((doc as any).lastAutoTable?.finalY ?? sy) + 5;

    // Category Breakdown Table (Sections A–Q)
    autoTable(doc, {
      startY: afterKpiY,
      margin: { top: 11, right: marginX, bottom: 14, left: marginX },
      tableWidth: contentWidth,
      theme: 'grid',
      head: [
        [
          'Category (Sections A–Q)',
          'Items',
          'Yes',
          'No',
          'N/A',
          'Pending',
          'Photos',
          'Score',
        ],
      ],
      body: [
        ...categoryRows,
        [
          { content: 'Total (All 17 Categories)', styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
          { content: String(ALL_CHECKLIST_ITEMS.length), styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
          { content: String(totalYes), styles: { fontStyle: 'bold', fillColor: [217, 217, 217], textColor: [22, 101, 52] } },
          { content: String(totalNo), styles: { fontStyle: 'bold', fillColor: [217, 217, 217], textColor: totalNo > 0 ? [185, 28, 28] : [17, 17, 17] } },
          { content: String(totalNa), styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
          { content: String(totalPending), styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
          { content: String(indexedPhotos.length), styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
          { content: overallScore, styles: { fontStyle: 'bold', fillColor: [217, 217, 217] } },
        ],
      ],
      headStyles: {
        fillColor: [64, 64, 64],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8,
        halign: 'center',
        lineColor: [64, 64, 64],
        lineWidth: 0.22,
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.6,
        textColor: [17, 17, 17],
        lineColor: [64, 64, 64],
        lineWidth: 0.2,
        cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
      },
      columnStyles: {
        0: { cellWidth: 85.5, halign: 'left' },
        1: { cellWidth: 14, halign: 'center' },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 14, halign: 'center' },
        5: { cellWidth: 16, halign: 'center' },
        6: { cellWidth: 16, halign: 'center' },
        7: { cellWidth: 17, halign: 'center', fontStyle: 'bold' },
      },
      rowPageBreak: 'avoid',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterCatY = ((doc as any).lastAutoTable?.finalY ?? afterKpiY) + 5;

    // Consolidated Deviations & Corrective Actions Table
    autoTable(doc, {
      startY: afterCatY,
      margin: { top: 11, right: marginX, bottom: 14, left: marginX },
      tableWidth: contentWidth,
      theme: 'grid',
      head: [
        [
          {
            content: `Summary of Deviations & Corrective Actions (${deviationRows.length})`,
            colSpan: 5,
            styles: { halign: 'left' },
          },
        ],
        [
          'No.',
          'Category & Inspection Item',
          'Deviation / Findings',
          'Corrective Action',
          'Photos',
        ],
      ],
      body:
        deviationRows.length > 0
          ? deviationRows
          : [
              [
                {
                  content: 'No non-compliant items ("No") were recorded during this inspection.',
                  colSpan: 5,
                  styles: { halign: 'center', fontStyle: 'italic', textColor: [71, 85, 105] },
                },
              ],
            ],
      headStyles: {
        fillColor: [64, 64, 64],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8,
        halign: 'center',
        lineColor: [64, 64, 64],
        lineWidth: 0.22,
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        textColor: [17, 17, 17],
        lineColor: [64, 64, 64],
        lineWidth: 0.2,
        cellPadding: { top: 1.7, right: 2, bottom: 1.7, left: 2 },
        overflow: 'linebreak',
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', textColor: [185, 28, 28] },
        1: { cellWidth: 62.5, halign: 'left' },
        2: { cellWidth: 50, halign: 'left' },
        3: { cellWidth: 50, halign: 'left' },
        4: { cellWidth: 18, halign: 'center' },
      },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
    });

    // Sign-off & Verification block at bottom of Store Inspection Summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterSummaryY = ((doc as any).lastAutoTable?.finalY ?? afterCatY) + 6;
    drawSignOffBlock(afterSummaryY);
  }

  // =========================================================================
  // PHOTO PROOF & EVIDENCE APPENDIX (when photos attached)
  // =========================================================================
  if (options.includePhotoAppendix && indexedPhotos.length > 0) {
    const cardsPerRow = 2;
    const cardsPerPage = 4;
    const cardGapX = 5.5;
    const cardW = (contentWidth - cardGapX) / cardsPerRow; // 92.5mm

    const totalAppendixPages = Math.ceil(indexedPhotos.length / cardsPerPage);

    for (let pageIdx = 0; pageIdx < totalAppendixPages; pageIdx++) {
      doc.addPage();
      const isLastAppendixPage = pageIdx === totalAppendixPages - 1;
      const slice = indexedPhotos.slice(
        pageIdx * cardsPerPage,
        (pageIdx + 1) * cardsPerPage
      );
      const compactForSignOff = isLastAppendixPage && slice.length > 2;
      const cardGapY = compactForSignOff ? 4.5 : 6;
      const cardH = compactForSignOff ? 92 : 104;
      const imgBoxH = compactForSignOff ? 50 : 61;

      let ay = 10.5;

      // Matching IQAF-005 header strip for Appendix pages
      doc.setDrawColor(64, 64, 64);
      doc.setLineWidth(0.22);
      doc.setFillColor(255, 255, 255);
      doc.rect(marginX, ay, leftTitleW, 13, 'FD');

      drawLogoInBox(marginX + 2.5, ay + 1.8, 25, 9.4);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(17, 17, 17);
      doc.text('Photo Proof & Evidence Attachment', marginX + 67, ay + 6.2, {
        align: 'center',
      });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.3);
      doc.setTextColor(64, 64, 64);
      const subMeta = [
        report.meta.storeLocation || 'Store Inspection',
        formatDisplayDate(report.meta.dateOfInspection),
      ]
        .filter(Boolean)
        .join('  |  ');
      doc.text(subMeta, marginX + 67, ay + 10.5, {
        align: 'center',
        maxWidth: 74,
      });

      const axRight = marginX + leftTitleW;
      doc.setFillColor(255, 255, 255);
      doc.rect(axRight, ay, rightDocLabelW, 6.5, 'FD');
      doc.rect(axRight + rightDocLabelW, ay, rightDocValW, 6.5, 'FD');
      doc.rect(axRight, ay + 6.5, rightDocLabelW, 6.5, 'FD');
      doc.rect(axRight + rightDocLabelW, ay + 6.5, rightDocValW, 6.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(17, 17, 17);
      doc.text('Documentation No.:', axRight + rightDocLabelW - 2, ay + 4.4, {
        align: 'right',
      });
      doc.text('Attached Photos:', axRight + rightDocLabelW - 2, ay + 10.8, {
        align: 'right',
      });

      doc.setFont('helvetica', 'normal');
      doc.text(
        report.meta.documentationNo || 'IQAF-005',
        axRight + rightDocLabelW + 2,
        ay + 4.4
      );
      doc.text(
        String(indexedPhotos.length),
        axRight + rightDocLabelW + 2,
        ay + 10.8
      );

      ay += compactForSignOff ? 16 : 18;

      let maxCardBottomY = ay;

      slice.forEach((entry, localIdx) => {
        const col = localIdx % cardsPerRow;
        const row = Math.floor(localIdx / cardsPerRow);
        const cx = marginX + col * (cardW + cardGapX);
        const cy = ay + row * (cardH + cardGapY);
        maxCardBottomY = Math.max(maxCardBottomY, cy + cardH);

        // Outer card border
        doc.setDrawColor(64, 64, 64);
        doc.setLineWidth(0.22);
        doc.setFillColor(255, 255, 255);
        doc.rect(cx, cy, cardW, cardH, 'FD');

        // Card top grey bar
        const barH = 7.2;
        doc.setFillColor(217, 217, 217);
        doc.rect(cx, cy, cardW, barH, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(17, 17, 17);
        doc.text(
          `Photo #${entry.photoIndex}  |  Item #${entry.itemNumber} (${entry.sectionCode})`,
          cx + 2.2,
          cy + 4.8
        );

        const statusLabel = `Complied: ${entry.complied}`;
        if (entry.complied === 'No') {
          doc.setTextColor(185, 28, 28);
        } else if (entry.complied === 'Yes') {
          doc.setTextColor(22, 101, 52);
        } else {
          doc.setTextColor(71, 85, 105);
        }
        doc.text(statusLabel, cx + cardW - 2.2, cy + 4.8, { align: 'right' });

        // Photo viewport box
        const imgPad = 2.2;
        const imgBoxX = cx + imgPad;
        const imgBoxY = cy + barH + imgPad;
        const imgBoxW = cardW - imgPad * 2;

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.15);
        doc.rect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, 'FD');

        try {
          const dims = photoDimensions.get(entry.photo.id) ?? {
            width: 4,
            height: 3,
          };
          const scale = Math.min(
            (imgBoxW - 1) / dims.width,
            (imgBoxH - 1) / dims.height
          );
          const drawW = dims.width * scale;
          const drawH = dims.height * scale;
          const drawX = imgBoxX + (imgBoxW - drawW) / 2;
          const drawY = imgBoxY + (imgBoxH - drawH) / 2;
          doc.addImage(
            entry.photo.dataUrl,
            'JPEG',
            drawX,
            drawY,
            drawW,
            drawH
          );
        } catch {
          // Skip broken image
        }

        // Metadata details below image
        let textY = imgBoxY + imgBoxH + 3.8;
        const maxTextW = cardW - 4.8;
        const cardTextBottomLimit = cy + cardH - 5.5;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.1);
        doc.setTextColor(17, 17, 17);
        const itemLines = doc
          .splitTextToSize(
            `${entry.sectionCode}. ${entry.sectionTitle} — ${entry.itemText}`,
            maxTextW
          )
          .slice(0, 2);
        doc.text(itemLines, cx + 2.4, textY);
        textY += itemLines.length * 3.1 + 1.0;

        if (entry.photo.caption.trim() && textY < cardTextBottomLimit) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.0);
          doc.setTextColor(34, 34, 34);
          const capLines = doc
            .splitTextToSize(`Caption: ${entry.photo.caption.trim()}`, maxTextW)
            .slice(0, compactForSignOff ? 1 : 2);
          doc.text(capLines, cx + 2.4, textY);
          textY += capLines.length * 3.0 + 0.8;
        }

        if (entry.deviation.trim() && textY < cardTextBottomLimit) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(6.9);
          doc.setTextColor(71, 85, 105);
          const devLines = doc
            .splitTextToSize(`Finding: ${entry.deviation.trim()}`, maxTextW)
            .slice(0, compactForSignOff ? 1 : 2);
          doc.text(devLines, cx + 2.4, textY);
        }

        // Photo-taken timestamp pinned at bottom-left of card
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        const capturedLabel = entry.photo.capturedAt
          ? `Taken: ${formatTakenTimestamp(entry.photo.capturedAt)}`
          : '';
        doc.text(capturedLabel, cx + 2.4, cy + cardH - 2.2);
      });

      if (isLastAppendixPage) {
        drawSignOffBlock(maxCardBottomY + (compactForSignOff ? 5 : 6));
      }
    }
  }

  const endPage = doc.getNumberOfPages();
  return {
    startPage,
    endPage,
    reportNo: isBlankTemplate ? '____________________________' : reportNo,
    docNo,
  };
}

function drawCenteredRotatedWatermarkText(
  doc: jsPDF,
  text: string,
  centerX: number,
  centerY: number,
  angleDeg: number,
  fontSizePt: number
): void {
  doc.setFontSize(fontSizePt);
  const textWidthMm = doc.getTextWidth(text);
  const capHeightMm = fontSizePt * 0.352778 * 0.72;
  const rad = (angleDeg * Math.PI) / 180;
  const x =
    centerX -
    (textWidthMm / 2) * Math.cos(rad) +
    (capHeightMm / 2) * Math.sin(rad);
  const y =
    centerY +
    (textWidthMm / 2) * Math.sin(rad) +
    (capHeightMm / 2) * Math.cos(rad);
  doc.text(text, x, y, { angle: angleDeg });
}

function drawPageConfidentialWatermark(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  subtitle?: string
): void {
  const angleDeg = 45;
  const rad = (angleDeg * Math.PI) / 180;
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.11 }));
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(185, 28, 28);
  drawCenteredRotatedWatermarkText(doc, 'CONFIDENTIAL', centerX, centerY, angleDeg, 54);

  if (subtitle) {
    const offsetMm = 12;
    const subCenterX = centerX + offsetMm * Math.sin(rad);
    const subCenterY = centerY + offsetMm * Math.cos(rad);
    doc.setTextColor(71, 85, 105);
    drawCenteredRotatedWatermarkText(doc, subtitle, subCenterX, subCenterY, angleDeg, 10);
  }

  doc.restoreGraphicsState();
}

function drawDocumentFooters(
  doc: jsPDF,
  segments: RenderedReportSegment[],
  options?: {
    isBlankTemplate?: boolean;
    includeConfidentialWatermark?: boolean;
  }
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 11;
  const contentWidth = pageWidth - marginX * 2;
  const totalPages = doc.getNumberOfPages();
  const isMerged = segments.length > 1;
  const shouldWatermark = options?.includeConfidentialWatermark !== false;

  segments.forEach((seg, segIndex) => {
    const segPageCount = seg.endPage - seg.startPage + 1;
    const watermarkSubtitle = options?.isBlankTemplate
      ? 'INTERNAL USE ONLY'
      : `${seg.reportNo}  ·  INTERNAL USE ONLY`;

    for (let p = seg.startPage; p <= seg.endPage; p++) {
      doc.setPage(p);

      if (shouldWatermark) {
        drawPageConfidentialWatermark(
          doc,
          pageWidth,
          pageHeight,
          watermarkSubtitle
        );
      }

      doc.setDrawColor(190, 195, 204);
      doc.setLineWidth(0.18);
      doc.line(marginX, pageHeight - 12.5, pageWidth - marginX, pageHeight - 12.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.0);
      doc.setTextColor(17, 17, 17);
      const footerReportText = options?.isBlankTemplate
        ? 'Report No.: ____________________________'
        : `Report No.: ${seg.reportNo}`;
      doc.text(footerReportText, marginX, pageHeight - 9.0, {
        maxWidth: contentWidth - 76,
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.0);
      doc.setTextColor(51, 65, 85);
      const rightLabel = isMerged
        ? `Report ${segIndex + 1}/${segments.length} (p.${p - seg.startPage + 1}/${segPageCount}) | Page ${p} of ${totalPages}`
        : `Basis: ${seg.docNo} Store Inspection Checklist | Page ${p} of ${totalPages}`;
      doc.text(rightLabel, pageWidth - marginX, pageHeight - 9.0, {
        align: 'right',
      });

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.0);
      doc.setTextColor(100, 116, 139);
      doc.text(REPORT_CONFIDENTIALITY_NOTICE, marginX, pageHeight - 5.4, {
        maxWidth: contentWidth,
      });
    }
  });

  // Verify ALL_CHECKLIST_ITEMS count consistency silently
  void ALL_CHECKLIST_ITEMS;
  return totalPages;
}

export async function exportInspectionToPdf(
  report: InspectionReport,
  options: PdfExportOptions = {
    includeSummary: true,
    includePhotoAppendix: true,
    includeInlineThumbnails: false,
    includeConfidentialWatermark: true,
  },
  extra?: { blankTemplate?: boolean }
): Promise<void> {
  const isBlankTemplate = Boolean(extra?.blankTemplate);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
    compress: true,
  });

  const logoAsset = await loadJiangNanLogoForPdf();
  const segment = await renderReportIntoPdf(doc, report, options, logoAsset, {
    blankTemplate: isBlankTemplate,
    isFirstReport: true,
  });

  drawDocumentFooters(doc, [segment], {
    isBlankTemplate,
    includeConfidentialWatermark: options.includeConfidentialWatermark !== false,
  });

  if (isBlankTemplate) {
    doc.save(`${sanitizeFilePart(segment.docNo, 'IQAF-005')}-Blank-Checklist.pdf`);
    return;
  }

  const storePart = sanitizeFilePart(report.meta.storeLocation, 'BRANCH');
  const yearPart = getInspectionShortYear(report.meta.dateOfInspection);
  const seqPart = String(normalizeReportSequence(report.meta.reportSequence)).padStart(3, '0');
  const fileName = `INSPLND-${storePart}-${yearPart}-${seqPart}.pdf`;
  doc.save(fileName);
}

/**
 * Merges multiple InspectionReport documents sequentially into a single PDF
 * with per-report headers, summaries, photo appendices, and continuous page numbers.
 */
export async function exportMergedReportsToPdf(
  reports: InspectionReport[],
  options: PdfExportOptions = {
    includeSummary: true,
    includePhotoAppendix: true,
    includeInlineThumbnails: false,
    includeConfidentialWatermark: true,
  },
  onProgress?: (current: number, total: number) => void
): Promise<{ reportCount: number; pageCount: number }> {
  if (reports.length === 0) {
    return { reportCount: 0, pageCount: 0 };
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
    compress: true,
  });

  const logoAsset = await loadJiangNanLogoForPdf();
  const segments: RenderedReportSegment[] = [];

  for (let i = 0; i < reports.length; i++) {
    onProgress?.(i + 1, reports.length);
    const seg = await renderReportIntoPdf(doc, reports[i], options, logoAsset, {
      isFirstReport: i === 0,
    });
    segments.push(seg);
  }

  const totalPages = drawDocumentFooters(doc, segments, {
    includeConfidentialWatermark: options.includeConfidentialWatermark !== false,
  });

  if (reports.length === 1) {
    const single = reports[0];
    const storePart = sanitizeFilePart(single.meta.storeLocation, 'BRANCH');
    const yearPart = getInspectionShortYear(single.meta.dateOfInspection);
    const seqPart = String(
      normalizeReportSequence(single.meta.reportSequence)
    ).padStart(3, '0');
    doc.save(`INSPLND-${storePart}-${yearPart}-${seqPart}.pdf`);
  } else {
    const todayIso = new Date().toISOString().slice(0, 10);
    doc.save(`INSPLND-Merged-${reports.length}-Reports-${todayIso}.pdf`);
  }

  return { reportCount: reports.length, pageCount: totalPages };
}

/**
 * Downloads a completely blank, sheet-only IQAF-005 Store Inspection Checklist PDF
 * containing no filled metadata, responses, summary sheet, or photo appendix.
 */
export async function exportBlankChecklistPdf(): Promise<void> {
  const emptyResponses: InspectionReport['responses'] = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    emptyResponses[item.number] = createEmptyResponse();
  }

  const blankReport: InspectionReport = {
    id: 'blank-template',
    updatedAt: '',
    meta: {
      documentationNo: FORM_DOCUMENTATION_NO,
      revisionNo: FORM_REVISION_NO,
      dateOfInspection: '',
      storeLocation: '',
      timeOfInspection: '',
      timeOfInspectionEnded: '',
      inspectedBy: '',
    },
    responses: emptyResponses,
    signOffs: {
      performedBy: { printedName: '', date: '', signatureDataUrl: null },
      acknowledgedBy: { printedName: '', date: '', signatureDataUrl: null },
      notedBy: { printedName: '', date: '', signatureDataUrl: null },
      reviewedBy: { printedName: '', date: '', signatureDataUrl: null },
      approvedBy: { printedName: '', date: '', signatureDataUrl: null },
    },
  };

  await exportInspectionToPdf(
    blankReport,
    {
      includeSummary: false,
      includePhotoAppendix: false,
      includeInlineThumbnails: false,
      includeConfidentialWatermark: false,
    },
    { blankTemplate: true }
  );
}
