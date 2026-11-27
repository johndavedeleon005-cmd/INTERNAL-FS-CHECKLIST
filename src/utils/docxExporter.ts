import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertInchesToTwip,
} from 'docx';
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
  SignOffEntry,
  SignOffRoleKey,
} from '../types/inspection';
import {
  formatTakenTimestamp,
  getImageDimensions,
  loadJiangNanLogoForPdf,
} from './imageUtils';
import { collectIndexedPhotos, type IndexedPhotoProof } from './pdfExporter';

// 8.5in Letter portrait with 0.5in left/right margins => 7.5in = 10,800 dxa (twips)
const PAGE_CONTENT_TWIPS = 10800;

const BORDER_COLOR = '404040';
const GRID_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
};

const CELL_MARGIN_STANDARD = {
  top: 70,
  bottom: 70,
  left: 100,
  right: 100,
};

type DocxImageType = 'png' | 'jpg' | 'gif' | 'bmp';

interface PreparedDocxImage {
  type: DocxImageType;
  data: Uint8Array;
  width: number;
  height: number;
}

function sanitizeFilePart(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return cleaned || fallback;
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function reencodeDataUrlViaCanvas(
  dataUrl: string,
  targetMime: 'image/png' | 'image/jpeg'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.max(1, img.naturalWidth || img.width || 300);
        const h = Math.max(1, img.naturalHeight || img.height || 200);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        if (targetMime === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
        } else {
          ctx.clearRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        const out =
          targetMime === 'image/jpeg'
            ? canvas.toDataURL('image/jpeg', 0.85)
            : canvas.toDataURL('image/png');
        canvas.width = 0;
        canvas.height = 0;
        resolve(out);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to decode image for DOCX'));
    img.src = dataUrl;
  });
}

async function prepareImageForDocx(
  dataUrl: string,
  preferredMime: 'image/png' | 'image/jpeg' = 'image/jpeg'
): Promise<PreparedDocxImage | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/') || !dataUrl.includes(',')) {
    return null;
  }
  try {
    let workingUrl = dataUrl;
    const headerMatch = workingUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/);
    const rawExt = headerMatch?.[1]?.toLowerCase() ?? '';
    let docType: DocxImageType | null = null;

    if (rawExt === 'png') docType = 'png';
    else if (rawExt === 'jpeg' || rawExt === 'jpg') docType = 'jpg';
    else if (rawExt === 'gif') docType = 'gif';
    else if (rawExt === 'bmp') docType = 'bmp';

    if (!docType) {
      workingUrl = await reencodeDataUrlViaCanvas(workingUrl, preferredMime);
      docType = preferredMime === 'image/png' ? 'png' : 'jpg';
    }

    const commaIdx = workingUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const base64Part = workingUrl.slice(commaIdx + 1);
    const data = decodeBase64ToUint8Array(base64Part);
    const dims = await getImageDimensions(workingUrl);

    return {
      type: docType,
      data,
      width: Math.max(1, dims.width),
      height: Math.max(1, dims.height),
    };
  } catch {
    return null;
  }
}

function fitDimensionsPx(
  srcWidth: number,
  srcHeight: number,
  maxWidthPx: number,
  maxHeightPx: number
): { width: number; height: number } {
  const scale = Math.min(maxWidthPx / srcWidth, maxHeightPx / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

function makeCell(
  widthDxa: number,
  children: (Paragraph | Table)[],
  options?: {
    fill?: string;
    vAlign?: (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable];
    columnSpan?: number;
    rowSpan?: number;
    margins?: { top: number; bottom: number; left: number; right: number };
  }
): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    columnSpan: options?.columnSpan,
    rowSpan: options?.rowSpan,
    verticalAlign: options?.vAlign ?? VerticalAlignTable.CENTER,
    margins: options?.margins ?? CELL_MARGIN_STANDARD,
    shading: options?.fill
      ? { type: ShadingType.CLEAR, color: 'auto', fill: options.fill }
      : undefined,
    children,
  });
}

function makeTextParagraph(
  text: string,
  options?: {
    bold?: boolean;
    italic?: boolean;
    sizeHalfPts?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spaceBefore?: number;
    spaceAfter?: number;
  }
): Paragraph {
  return new Paragraph({
    alignment: options?.align ?? AlignmentType.LEFT,
    spacing: {
      before: options?.spaceBefore ?? 0,
      after: options?.spaceAfter ?? 0,
    },
    children: [
      new TextRun({
        text,
        bold: options?.bold ?? false,
        italics: options?.italic ?? false,
        size: options?.sizeHalfPts ?? 17, // 8.5pt
        color: options?.color ?? '111111',
        font: 'Calibri',
      }),
    ],
  });
}

function buildTopControlHeaderTable(
  titleText: string,
  subtitleText: string | null,
  docNo: string,
  revNo: string,
  logoImage: PreparedDocxImage | null
): Table {
  const leftLogoAndTitleW = 6300;
  const rightLabelW = 2350;
  const rightValueW = PAGE_CONTENT_TWIPS - leftLogoAndTitleW - rightLabelW; // 2150

  const titleChildren: Paragraph[] = [];
  if (logoImage) {
    const logoSize = fitDimensionsPx(logoImage.width, logoImage.height, 140, 36);
    titleChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [
          new ImageRun({
            type: logoImage.type,
            data: logoImage.data,
            transformation: logoSize,
          }),
        ],
      })
    );
  }
  titleChildren.push(
    makeTextParagraph(titleText, {
      bold: true,
      sizeHalfPts: 24, // 12pt
      align: AlignmentType.CENTER,
      spaceAfter: subtitleText ? 30 : 0,
    })
  );
  if (subtitleText) {
    titleChildren.push(
      makeTextParagraph(subtitleText, {
        sizeHalfPts: 15, // 7.5pt
        color: '4B5563',
        align: AlignmentType.CENTER,
      })
    );
  }

  return new Table({
    width: { size: PAGE_CONTENT_TWIPS, type: WidthType.DXA },
    columnWidths: [leftLogoAndTitleW, rightLabelW, rightValueW],
    layout: TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(leftLogoAndTitleW, titleChildren, {
            rowSpan: 2,
            fill: 'FFFFFF',
          }),
          makeCell(
            rightLabelW,
            [
              makeTextParagraph('Documentation No.:', {
                bold: true,
                sizeHalfPts: 16,
                align: AlignmentType.RIGHT,
              }),
            ],
            { fill: 'F8FAFC' }
          ),
          makeCell(
            rightValueW,
            [
              makeTextParagraph(docNo, {
                bold: true,
                sizeHalfPts: 16,
              }),
            ],
            { fill: 'FFFFFF' }
          ),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(
            rightLabelW,
            [
              makeTextParagraph('Revision No.:', {
                bold: true,
                sizeHalfPts: 16,
                align: AlignmentType.RIGHT,
              }),
            ],
            { fill: 'F8FAFC' }
          ),
          makeCell(
            rightValueW,
            [
              makeTextParagraph(revNo, {
                sizeHalfPts: 16,
              }),
            ],
            { fill: 'FFFFFF' }
          ),
        ],
      }),
    ],
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 4000);
}

/**
 * Generates and downloads a formatted Microsoft Word (.docx) document for
 * an IQAF-005 Store Inspection report, including optional Summary & Photo Proofs.
 */
export async function exportInspectionToDocx(
  report: InspectionReport,
  options: PdfExportOptions = {
    includeSummary: true,
    includePhotoAppendix: true,
    includeInlineThumbnails: true,
    includeConfidentialWatermark: false,
  },
  extra?: { blankTemplate?: boolean }
): Promise<void> {
  const isBlankTemplate = Boolean(extra?.blankTemplate);
  const docNo = report.meta.documentationNo || FORM_DOCUMENTATION_NO;
  const revNo = report.meta.revisionNo || FORM_REVISION_NO;
  const reportNo = isBlankTemplate
    ? ''
    : formatReportNo(
        report.meta.storeLocation,
        report.meta.dateOfInspection,
        report.meta.reportSequence
      );
  const displayDate = isBlankTemplate
    ? ''
    : formatDisplayDate(report.meta.dateOfInspection);
  const displayTime = isBlankTemplate
    ? ''
    : formatInspectionTimeRange(
        report.meta.timeOfInspection,
        report.meta.timeOfInspectionEnded
      );

  const indexedPhotos: IndexedPhotoProof[] = isBlankTemplate
    ? []
    : collectIndexedPhotos(report);
  const photoNumbersByItem = new Map<number, number[]>();
  for (const entry of indexedPhotos) {
    const arr = photoNumbersByItem.get(entry.itemNumber) ?? [];
    arr.push(entry.photoIndex);
    photoNumbersByItem.set(entry.itemNumber, arr);
  }

  // Load logo, signatures, and photo proofs concurrently
  const rawLogo = await loadJiangNanLogoForPdf();
  const logoImage = rawLogo
    ? await prepareImageForDocx(rawLogo.dataUrl, 'image/png')
    : null;

  const signKeys = [
    'performedBy',
    'acknowledgedBy',
    'notedBy',
    'reviewedBy',
    'approvedBy',
  ] as const;
  const preparedSignatures: Record<string, PreparedDocxImage | null> = {};
  if (!isBlankTemplate) {
    await Promise.all(
      signKeys.map(async (key) => {
        const sigUrl = report.signOffs[key].signatureDataUrl;
        preparedSignatures[key] = sigUrl
          ? await prepareImageForDocx(sigUrl, 'image/png')
          : null;
      })
    );
  }

  const preparedPhotos = new Map<string, PreparedDocxImage | null>();
  if (!isBlankTemplate && options.includePhotoAppendix && indexedPhotos.length > 0) {
    await Promise.all(
      indexedPhotos.map(async (entry) => {
        const prepared = await prepareImageForDocx(
          entry.photo.dataUrl,
          'image/jpeg'
        );
        preparedPhotos.set(entry.photo.id, prepared);
      })
    );
  }

  const children: (Paragraph | Table)[] = [];

  if (!isBlankTemplate && options.includeConfidentialWatermark) {
    children.push(
      makeTextParagraph('CONFIDENTIAL — INTERNAL QUALITY ASSURANCE RECORD', {
        bold: true,
        sizeHalfPts: 16,
        color: 'B91C1C',
        align: AlignmentType.CENTER,
        spaceAfter: 80,
      })
    );
  }

  // =========================================================================
  // 1. TOP FORM HEADER & METADATA TABLE
  // =========================================================================
  children.push(
    buildTopControlHeaderTable(
      'Store Inspection Checklist',
      null,
      docNo,
      revNo,
      logoImage
    )
  );

  const metaLabelW = 4800;
  const metaValueW = PAGE_CONTENT_TWIPS - metaLabelW; // 6000
  const metaEntries: [string, string][] = isBlankTemplate
    ? [
        ['Date of Inspection:', ''],
        ['Store Location:', ''],
        ['Time of Inspection:', ''],
        ['Inspected By:', ''],
      ]
    : [
        ['Report No.:', reportNo],
        ['Date of Inspection:', displayDate],
        ['Store Location:', report.meta.storeLocation || ''],
        ['Time of Inspection:', displayTime],
        ['Inspected By:', report.meta.inspectedBy || ''],
      ];

  children.push(
    new Table({
      width: { size: PAGE_CONTENT_TWIPS, type: WidthType.DXA },
      columnWidths: [metaLabelW, metaValueW],
      layout: TableLayoutType.FIXED,
      borders: GRID_BORDERS,
      rows: metaEntries.map(
        ([label, val]) =>
          new TableRow({
            cantSplit: true,
            children: [
              makeCell(
                metaLabelW,
                [makeTextParagraph(label, { bold: true, sizeHalfPts: 16 })],
                { fill: 'EFEFEF' }
              ),
              makeCell(
                metaValueW,
                [
                  makeTextParagraph(val, {
                    bold: label === 'Report No.:',
                    sizeHalfPts: 16,
                  }),
                ],
                { fill: 'FFFFFF' }
              ),
            ],
          })
      ),
    })
  );

  children.push(
    makeTextParagraph(HOW_TO_FILL_INSTRUCTION, {
      italic: true,
      sizeHalfPts: 15,
      color: '374151',
      spaceBefore: 100,
      spaceAfter: 100,
    })
  );

  // =========================================================================
  // 2. FULL 17-SECTION CHECKLIST TABLE (SECTIONS A–Q)
  // =========================================================================
  const colNumW = 650;
  const colStdW = 4750;
  const colCompW = 1150;
  const colDevW = 2250;
  const colActW = PAGE_CONTENT_TWIPS - colNumW - colStdW - colCompW - colDevW; // 2000

  const checklistRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell(
          colNumW,
          [makeTextParagraph('#', { bold: true, sizeHalfPts: 16, color: 'FFFFFF', align: AlignmentType.CENTER })],
          { fill: '334155' }
        ),
        makeCell(
          colStdW,
          [makeTextParagraph('Inspection Standard / Item', { bold: true, sizeHalfPts: 16, color: 'FFFFFF' })],
          { fill: '334155' }
        ),
        makeCell(
          colCompW,
          [makeTextParagraph('Complied', { bold: true, sizeHalfPts: 16, color: 'FFFFFF', align: AlignmentType.CENTER })],
          { fill: '334155' }
        ),
        makeCell(
          colDevW,
          [makeTextParagraph('Deviation / Remarks', { bold: true, sizeHalfPts: 16, color: 'FFFFFF' })],
          { fill: '334155' }
        ),
        makeCell(
          colActW,
          [makeTextParagraph('Corrective Action & Photo Ref', { bold: true, sizeHalfPts: 16, color: 'FFFFFF' })],
          { fill: '334155' }
        ),
      ],
    }),
  ];

  for (const section of CHECKLIST_SECTIONS) {
    // Section Header Row
    checklistRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(
            PAGE_CONTENT_TWIPS,
            [
              makeTextParagraph(`${section.code}. ${section.title}`, {
                bold: true,
                sizeHalfPts: 17,
                color: 'FFFFFF',
              }),
            ],
            { columnSpan: 5, fill: '404040' }
          ),
        ],
      })
    );

    for (const item of section.items) {
      const resp = isBlankTemplate
        ? createEmptyResponse()
        : report.responses[item.number] ?? createEmptyResponse();

      const status = resp.complied || '';
      const statusColor =
        status === 'Yes'
          ? '166534'
          : status === 'No'
            ? 'B91C1C'
            : '475569';
      const statusFill =
        status === 'Yes'
          ? 'F0FDF4'
          : status === 'No'
            ? 'FEF2F2'
            : 'FFFFFF';

      const photoNums = isBlankTemplate
        ? []
        : photoNumbersByItem.get(item.number) ?? [];
      const photoRefLine =
        photoNums.length > 0
          ? `Photos: ${photoNums.map((n) => `#${n}`).join(', ')}`
          : '';
      const actionParagraphs: Paragraph[] = [];
      if (resp.correctiveAction?.trim()) {
        actionParagraphs.push(
          makeTextParagraph(resp.correctiveAction.trim(), { sizeHalfPts: 15 })
        );
      }
      if (photoRefLine) {
        actionParagraphs.push(
          makeTextParagraph(photoRefLine, {
            bold: true,
            sizeHalfPts: 14,
            color: '1E3A8A',
            spaceBefore: resp.correctiveAction?.trim() ? 40 : 0,
          })
        );
      }
      if (actionParagraphs.length === 0) {
        actionParagraphs.push(makeTextParagraph('', { sizeHalfPts: 15 }));
      }

      checklistRows.push(
        new TableRow({
          cantSplit: true,
          children: [
            makeCell(
              colNumW,
              [
                makeTextParagraph(String(item.number), {
                  bold: true,
                  sizeHalfPts: 15,
                  align: AlignmentType.CENTER,
                }),
              ],
              { fill: 'F8FAFC', vAlign: VerticalAlignTable.TOP }
            ),
            makeCell(
              colStdW,
              [makeTextParagraph(item.text, { sizeHalfPts: 15 })],
              { fill: 'FFFFFF', vAlign: VerticalAlignTable.TOP }
            ),
            makeCell(
              colCompW,
              [
                makeTextParagraph(status || (isBlankTemplate ? '' : '—'), {
                  bold: Boolean(status),
                  sizeHalfPts: 15,
                  color: statusColor,
                  align: AlignmentType.CENTER,
                }),
              ],
              { fill: statusFill, vAlign: VerticalAlignTable.CENTER }
            ),
            makeCell(
              colDevW,
              [
                makeTextParagraph(resp.deviation?.trim() || '', {
                  sizeHalfPts: 15,
                  color: status === 'No' ? '991B1B' : '111111',
                }),
              ],
              { fill: 'FFFFFF', vAlign: VerticalAlignTable.TOP }
            ),
            makeCell(colActW, actionParagraphs, {
              fill: 'FFFFFF',
              vAlign: VerticalAlignTable.TOP,
            }),
          ],
        })
      );
    }
  }

  children.push(
    new Table({
      width: { size: PAGE_CONTENT_TWIPS, type: WidthType.DXA },
      columnWidths: [colNumW, colStdW, colCompW, colDevW, colActW],
      layout: TableLayoutType.FIXED,
      borders: GRID_BORDERS,
      rows: checklistRows,
    })
  );

  // =========================================================================
  // 3. SIGN-OFF & ACKNOWLEDGEMENT BLOCK
  // =========================================================================
  children.push(
    makeTextParagraph('', { spaceBefore: 120, spaceAfter: 40 })
  );

  const primarySignDefs = [
    {
      key: 'performedBy' as const,
      heading: 'Performed By:',
      role: 'Food Safety Compliance Officer',
      entry: report.signOffs.performedBy,
    },
    {
      key: 'acknowledgedBy' as const,
      heading: 'Acknowledged By:',
      role: 'Restaurant / Shift Manager',
      entry: report.signOffs.acknowledgedBy,
    },
    {
      key: 'notedBy' as const,
      heading: 'Noted By:',
      role: 'Area Manager',
      entry: report.signOffs.notedBy,
    },
  ];

  const secondarySignDefs = [
    {
      key: 'reviewedBy' as const,
      heading: 'Reviewed By:',
      role: 'Learning and Development Manager',
      entry: report.signOffs.reviewedBy,
    },
    {
      key: 'approvedBy' as const,
      heading: 'Approved By:',
      role: 'Quality Assurance Specialist / FSCO',
      entry: report.signOffs.approvedBy,
    },
  ];

  const makeSignOffTable = (
    defs: Array<{
      key: SignOffRoleKey;
      heading: string;
      role: string;
      entry: SignOffEntry;
    }>
  ) => {
    const colW = Math.floor(PAGE_CONTENT_TWIPS / defs.length);
    return new Table({
      width: { size: colW * defs.length, type: WidthType.DXA },
      columnWidths: defs.map(() => colW),
      layout: TableLayoutType.FIXED,
      borders: GRID_BORDERS,
      rows: [
        new TableRow({
          cantSplit: true,
          children: defs.map((col) =>
            makeCell(
              colW,
              [
                makeTextParagraph(col.heading, {
                  bold: true,
                  sizeHalfPts: 16,
                  align: AlignmentType.CENTER,
                }),
              ],
              { fill: 'D9D9D9' }
            )
          ),
        }),
        new TableRow({
          cantSplit: true,
          children: defs.map((col) => {
            const boxChildren: Paragraph[] = [];
            const sigImg = preparedSignatures[col.key];
            if (sigImg) {
              const sizePx = fitDimensionsPx(sigImg.width, sigImg.height, 145, 42);
              boxChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 40, after: 40 },
                  children: [
                    new ImageRun({
                      type: sigImg.type,
                      data: sigImg.data,
                      transformation: sizePx,
                    }),
                  ],
                })
              );
            } else {
              boxChildren.push(
                makeTextParagraph(' ', {
                  spaceBefore: 180,
                  spaceAfter: 180,
                  align: AlignmentType.CENTER,
                })
              );
            }

            const nameDateLine = isBlankTemplate
              ? ''
              : [
                  col.entry.printedName?.trim(),
                  col.entry.date ? formatDisplayDate(col.entry.date) : '',
                ]
                  .filter(Boolean)
                  .join('  /  ');

            boxChildren.push(
              makeTextParagraph(nameDateLine || ' ', {
                bold: true,
                sizeHalfPts: 15,
                align: AlignmentType.CENTER,
                spaceBefore: 20,
              })
            );

            return makeCell(colW, boxChildren, {
              fill: 'FFFFFF',
              vAlign: VerticalAlignTable.BOTTOM,
            });
          }),
        }),
        new TableRow({
          cantSplit: true,
          children: defs.map((col) =>
            makeCell(
              colW,
              [
                makeTextParagraph(col.role, {
                  bold: true,
                  sizeHalfPts: 14,
                  align: AlignmentType.CENTER,
                }),
                makeTextParagraph('Signature over printed name / Date', {
                  sizeHalfPts: 13,
                  color: '475569',
                  align: AlignmentType.CENTER,
                }),
              ],
              { fill: 'F8FAFC' }
            )
          ),
        }),
      ],
    });
  };

  children.push(makeSignOffTable(primarySignDefs));
  children.push(
    new Paragraph({
      spacing: { before: 60, after: 0 },
      children: [],
    })
  );
  children.push(makeSignOffTable(secondarySignDefs));

  children.push(
    makeTextParagraph(
      `Quality Assurance Department   ·   Basis Form #: ${docNo}   ·   Revision No.: ${revNo}`,
      {
        bold: true,
        sizeHalfPts: 15,
        align: AlignmentType.CENTER,
        spaceBefore: 100,
      }
    )
  );

  // =========================================================================
  // 4. SUMMARY & CAPA SECTION (Optional, omitted on Blank Sheet)
  // =========================================================================
  if (!isBlankTemplate && options.includeSummary) {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    const sumSubtitle = [
      report.meta.storeLocation || 'Store Inspection',
      displayDate,
      report.meta.inspectedBy ? `Inspector: ${report.meta.inspectedBy}` : '',
    ]
      .filter(Boolean)
      .join('  |  ');

    children.push(
      buildTopControlHeaderTable(
        'Store Inspection Summary',
        sumSubtitle,
        docNo,
        revNo,
        logoImage
      )
    );
    children.push(makeTextParagraph('', { spaceAfter: 80 }));

    let totalYes = 0;
    let totalNo = 0;
    let totalNa = 0;
    let totalPending = 0;

    const categoryRowsData: {
      label: string;
      total: number;
      yes: number;
      no: number;
      na: number;
      pending: number;
      photos: number;
      score: string;
    }[] = [];

    const deviationRowsData: {
      itemNo: string;
      sectionAndText: string;
      deviation: string;
      action: string;
      photoRef: string;
    }[] = [];

    for (const section of CHECKLIST_SECTIONS) {
      let sYes = 0;
      let sNo = 0;
      let sNa = 0;
      let sPending = 0;
      let sPhotos = 0;

      for (const item of section.items) {
        const r = report.responses[item.number];
        const st = r?.complied || '';
        const pCount = r?.photos?.length ?? 0;
        sPhotos += pCount;
        if (st === 'Yes') {
          sYes++;
          totalYes++;
        } else if (st === 'No') {
          sNo++;
          totalNo++;
          const pNums = photoNumbersByItem.get(item.number) ?? [];
          deviationRowsData.push({
            itemNo: String(item.number),
            sectionAndText: `${section.code}. ${section.title}\n${item.text}`,
            deviation: r?.deviation?.trim() || '—',
            action: r?.correctiveAction?.trim() || '—',
            photoRef:
              pNums.length > 0 ? pNums.map((n) => `#${n}`).join(', ') : '—',
          });
        } else if (st === 'N/A') {
          sNa++;
          totalNa++;
        } else {
          sPending++;
          totalPending++;
        }
      }

      const sApplicable = sYes + sNo;
      categoryRowsData.push({
        label: `${section.code}. ${section.title}`,
        total: section.items.length,
        yes: sYes,
        no: sNo,
        na: sNa,
        pending: sPending,
        photos: sPhotos,
        score:
          sApplicable > 0 ? `${Math.round((sYes / sApplicable) * 100)}%` : '—',
      });
    }

    const totalApplicable = totalYes + totalNo;
    const totalAnswered = totalYes + totalNo + totalNa;
    const overallScore =
      totalApplicable > 0
        ? `${Math.round((totalYes / totalApplicable) * 100)}%`
        : '—';

    // KPI Grid Table (6 columns)
    const kpiW = Math.floor(PAGE_CONTENT_TWIPS / 6); // 1800
    children.push(
      new Table({
        width: { size: kpiW * 6, type: WidthType.DXA },
        columnWidths: [kpiW, kpiW, kpiW, kpiW, kpiW, kpiW],
        layout: TableLayoutType.FIXED,
        borders: GRID_BORDERS,
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              makeCell(
                kpiW * 6,
                [
                  makeTextParagraph('Overall Compliance Summary', {
                    bold: true,
                    sizeHalfPts: 16,
                    color: 'FFFFFF',
                  }),
                ],
                { columnSpan: 6, fill: '404040' }
              ),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              makeCell(kpiW, [makeTextParagraph('Compliance Rate', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(overallScore, { bold: true, sizeHalfPts: 16, align: AlignmentType.CENTER })]),
              makeCell(kpiW, [makeTextParagraph('Items Checked', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(`${totalAnswered} / ${ALL_CHECKLIST_ITEMS.length}`, { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
              makeCell(kpiW, [makeTextParagraph('Photo Proofs', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(String(indexedPhotos.length), { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              makeCell(kpiW, [makeTextParagraph('Complied (Yes)', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(String(totalYes), { bold: true, sizeHalfPts: 15, color: '166534', align: AlignmentType.CENTER })]),
              makeCell(kpiW, [makeTextParagraph('Deviations (No)', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(String(totalNo), { bold: true, sizeHalfPts: 15, color: totalNo > 0 ? 'B91C1C' : '111111', align: AlignmentType.CENTER })]),
              makeCell(kpiW, [makeTextParagraph('N/A & Pending', { bold: true, sizeHalfPts: 15 })], { fill: 'EFEFEF' }),
              makeCell(kpiW, [makeTextParagraph(`${totalNa} N/A · ${totalPending} Pend`, { sizeHalfPts: 14, align: AlignmentType.CENTER })]),
            ],
          }),
        ],
      })
    );

    children.push(makeTextParagraph('', { spaceAfter: 100 }));

    // Category Breakdown Table (8 columns)
    const cNameW = 4500;
    const cNumW = 900; // x7 = 6300; total = 10800
    children.push(
      new Table({
        width: { size: PAGE_CONTENT_TWIPS, type: WidthType.DXA },
        columnWidths: [cNameW, cNumW, cNumW, cNumW, cNumW, cNumW, cNumW, cNumW],
        layout: TableLayoutType.FIXED,
        borders: GRID_BORDERS,
        rows: [
          new TableRow({
            tableHeader: true,
            cantSplit: true,
            children: [
              'Category (Sections A–Q)',
              'Items',
              'Yes',
              'No',
              'N/A',
              'Pend',
              'Photos',
              'Score',
            ].map((hdr, idx) =>
              makeCell(
                idx === 0 ? cNameW : cNumW,
                [
                  makeTextParagraph(hdr, {
                    bold: true,
                    sizeHalfPts: 15,
                    color: 'FFFFFF',
                    align: idx === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                  }),
                ],
                { fill: '334155' }
              )
            ),
          }),
          ...categoryRowsData.map(
            (cat) =>
              new TableRow({
                cantSplit: true,
                children: [
                  makeCell(cNameW, [makeTextParagraph(cat.label, { sizeHalfPts: 15 })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.total), { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.yes), { sizeHalfPts: 15, color: '166534', align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.no), { sizeHalfPts: 15, bold: cat.no > 0, color: cat.no > 0 ? 'B91C1C' : '111111', align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.na), { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.pending), { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(String(cat.photos), { sizeHalfPts: 15, align: AlignmentType.CENTER })]),
                  makeCell(cNumW, [makeTextParagraph(cat.score, { bold: true, sizeHalfPts: 15, align: AlignmentType.CENTER })]),
                ],
              })
          ),
        ],
      })
    );

    // Deviations & Corrective Action Register
    children.push(
      makeTextParagraph(
        `Deviation & Corrective Action Register (${deviationRowsData.length})`,
        {
          bold: true,
          sizeHalfPts: 20,
          spaceBefore: 180,
          spaceAfter: 80,
        }
      )
    );

    if (deviationRowsData.length === 0) {
      children.push(
        makeTextParagraph(
          'No deviations ("No" responses) were recorded on this inspection checklist.',
          {
            italic: true,
            sizeHalfPts: 16,
            color: '166534',
            spaceAfter: 80,
          }
        )
      );
    } else {
      const dItemW = 700;
      const dStdW = 3600;
      const dDevW = 2800;
      const dActW = 2700;
      const dPhotoW = PAGE_CONTENT_TWIPS - dItemW - dStdW - dDevW - dActW; // 1000
      children.push(
        new Table({
          width: { size: PAGE_CONTENT_TWIPS, type: WidthType.DXA },
          columnWidths: [dItemW, dStdW, dDevW, dActW, dPhotoW],
          layout: TableLayoutType.FIXED,
          borders: GRID_BORDERS,
          rows: [
            new TableRow({
              tableHeader: true,
              cantSplit: true,
              children: [
                makeCell(dItemW, [makeTextParagraph('#', { bold: true, sizeHalfPts: 15, color: 'FFFFFF', align: AlignmentType.CENTER })], { fill: '991B1B' }),
                makeCell(dStdW, [makeTextParagraph('Section & Checklist Standard', { bold: true, sizeHalfPts: 15, color: 'FFFFFF' })], { fill: '991B1B' }),
                makeCell(dDevW, [makeTextParagraph('Deviation Findings', { bold: true, sizeHalfPts: 15, color: 'FFFFFF' })], { fill: '991B1B' }),
                makeCell(dActW, [makeTextParagraph('Corrective Action', { bold: true, sizeHalfPts: 15, color: 'FFFFFF' })], { fill: '991B1B' }),
                makeCell(dPhotoW, [makeTextParagraph('Photo Ref', { bold: true, sizeHalfPts: 15, color: 'FFFFFF', align: AlignmentType.CENTER })], { fill: '991B1B' }),
              ],
            }),
            ...deviationRowsData.map(
              (dev) =>
                new TableRow({
                  cantSplit: true,
                  children: [
                    makeCell(dItemW, [makeTextParagraph(dev.itemNo, { bold: true, sizeHalfPts: 15, align: AlignmentType.CENTER })], { fill: 'FEF2F2', vAlign: VerticalAlignTable.TOP }),
                    makeCell(dStdW, [makeTextParagraph(dev.sectionAndText, { sizeHalfPts: 15 })], { vAlign: VerticalAlignTable.TOP }),
                    makeCell(dDevW, [makeTextParagraph(dev.deviation, { sizeHalfPts: 15, color: '991B1B' })], { vAlign: VerticalAlignTable.TOP }),
                    makeCell(dActW, [makeTextParagraph(dev.action, { sizeHalfPts: 15 })], { vAlign: VerticalAlignTable.TOP }),
                    makeCell(dPhotoW, [makeTextParagraph(dev.photoRef, { bold: true, sizeHalfPts: 15, color: '1E3A8A', align: AlignmentType.CENTER })], { vAlign: VerticalAlignTable.TOP }),
                  ],
                })
            ),
          ],
        })
      );
    }
  }

  // =========================================================================
  // 5. PHOTO PROOFS APPENDIX (Optional, embedded images)
  // =========================================================================
  if (
    !isBlankTemplate &&
    options.includePhotoAppendix &&
    indexedPhotos.length > 0
  ) {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    children.push(
      buildTopControlHeaderTable(
        'Inspection Photo Proofs Appendix',
        `${report.meta.storeLocation || 'Store Inspection'}  ·  ${indexedPhotos.length} ${indexedPhotos.length === 1 ? 'Photo' : 'Photos'}`,
        docNo,
        revNo,
        logoImage
      )
    );
    children.push(makeTextParagraph('', { spaceAfter: 100 }));

    const photoCardW = Math.floor(PAGE_CONTENT_TWIPS / 2); // 5400
    const photoRows: TableRow[] = [];

    for (let i = 0; i < indexedPhotos.length; i += 2) {
      const pair = [indexedPhotos[i], indexedPhotos[i + 1] ?? null];
      const cells = pair.map((entry) => {
        if (!entry) {
          return makeCell(photoCardW, [makeTextParagraph('')], {
            fill: 'F8FAFC',
          });
        }

        const cellChildren: Paragraph[] = [
          makeTextParagraph(
            `Photo #${entry.photoIndex}  ·  Item #${entry.itemNumber} (${entry.complied})`,
            {
              bold: true,
              sizeHalfPts: 16,
              color: entry.complied === 'No' ? 'B91C1C' : '0F172A',
              spaceAfter: 40,
            }
          ),
          makeTextParagraph(
            `${entry.sectionCode}. ${entry.sectionTitle} — ${entry.itemText}`,
            {
              sizeHalfPts: 14,
              color: '475569',
              spaceAfter: 60,
            }
          ),
        ];

        const prepared = preparedPhotos.get(entry.photo.id);
        if (prepared) {
          const fitted = fitDimensionsPx(
            prepared.width,
            prepared.height,
            310,
            210
          );
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 60 },
              children: [
                new ImageRun({
                  type: prepared.type,
                  data: prepared.data,
                  transformation: fitted,
                }),
              ],
            })
          );
        }

        if (entry.photo.caption?.trim()) {
          cellChildren.push(
            makeTextParagraph(`Caption: ${entry.photo.caption.trim()}`, {
              bold: true,
              sizeHalfPts: 15,
              spaceAfter: 30,
            })
          );
        }

        cellChildren.push(
          makeTextParagraph(
            `Taken: ${formatTakenTimestamp(entry.photo.capturedAt)}`,
            {
              italic: true,
              sizeHalfPts: 13,
              color: '64748B',
            }
          )
        );

        return makeCell(photoCardW, cellChildren, {
          fill: 'FFFFFF',
          vAlign: VerticalAlignTable.TOP,
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
        });
      });

      photoRows.push(
        new TableRow({
          cantSplit: true,
          children: cells,
        })
      );
    }

    children.push(
      new Table({
        width: { size: photoCardW * 2, type: WidthType.DXA },
        columnWidths: [photoCardW, photoCardW],
        layout: TableLayoutType.FIXED,
        borders: GRID_BORDERS,
        rows: photoRows,
      })
    );
  }

  // =========================================================================
  // DOCUMENT HEADER, FOOTER & ASSEMBLY
  // =========================================================================
  const headerChildren = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text:
            !isBlankTemplate && options.includeConfidentialWatermark
              ? `CONFIDENTIAL  ·  ${docNo}  ·  Report No.: ${reportNo}`
              : `${docNo}${reportNo ? `  ·  Report No.: ${reportNo}` : ''}`,
          size: 14,
          bold: !isBlankTemplate && options.includeConfidentialWatermark,
          color:
            !isBlankTemplate && options.includeConfidentialWatermark
              ? 'B91C1C'
              : '64748B',
          font: 'Calibri',
        }),
      ],
    }),
  ];

  const footerChildren = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: [
        new TextRun({
          text: REPORT_CONFIDENTIALITY_NOTICE,
          italics: true,
          size: 13,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: `${IQAF_BASIS_STATEMENT}   |   Page `,
          size: 14,
          color: '475569',
          font: 'Calibri',
        }),
        new TextRun({
          children: [PageNumber.CURRENT],
          size: 14,
          color: '475569',
          font: 'Calibri',
        }),
        new TextRun({
          text: ' of ',
          size: 14,
          color: '475569',
          font: 'Calibri',
        }),
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          size: 14,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    }),
  ];

  const doc = new Document({
    creator: report.meta.inspectedBy || 'Store Inspection Checklist',
    title: isBlankTemplate
      ? `${docNo} Blank Store Inspection Checklist`
      : `${docNo} Store Inspection Report - ${report.meta.storeLocation || 'Inspection'}`,
    description: IQAF_BASIS_STATEMENT,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.5),
              height: convertInchesToTwip(11),
            },
            margin: {
              top: convertInchesToTwip(0.5),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.5),
              right: convertInchesToTwip(0.5),
              header: convertInchesToTwip(0.25),
              footer: convertInchesToTwip(0.25),
            },
          },
        },
        headers: {
          default: new Header({ children: headerChildren }),
        },
        footers: {
          default: new Footer({ children: footerChildren }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);

  const fileName = isBlankTemplate
    ? `${sanitizeFilePart(docNo, 'IQAF-005')}_Blank_Checklist_Sheet.docx`
    : `${sanitizeFilePart(docNo, 'IQAF-005')}_${sanitizeFilePart(report.meta.storeLocation, 'Store')}_${getInspectionShortYear(report.meta.dateOfInspection)}-${normalizeReportSequence(report.meta.reportSequence)}_${sanitizeFilePart(report.meta.dateOfInspection, 'Inspection')}.docx`;

  triggerBlobDownload(blob, fileName);
}

/**
 * Generates and downloads a completely blank printable Word (.docx)
 * Store Inspection Checklist sheet with no filled fields, summary, or photos.
 */
export async function exportBlankChecklistDocx(): Promise<void> {
  const blankResponses: InspectionReport['responses'] = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    blankResponses[item.number] = createEmptyResponse();
  }

  const blankReport: InspectionReport = {
    id: 'blank-template',
    updatedAt: '',
    meta: {
      documentationNo: FORM_DOCUMENTATION_NO,
      revisionNo: FORM_REVISION_NO,
      dateOfInspection: '',
      storeLocation: '',
      reportSequence: 1,
      timeOfInspection: '',
      timeOfInspectionEnded: '',
      inspectedBy: '',
    },
    responses: blankResponses,
    signOffs: {
      performedBy: { printedName: '', date: '', signatureDataUrl: null },
      acknowledgedBy: { printedName: '', date: '', signatureDataUrl: null },
      notedBy: { printedName: '', date: '', signatureDataUrl: null },
      reviewedBy: { printedName: '', date: '', signatureDataUrl: null },
      approvedBy: { printedName: '', date: '', signatureDataUrl: null },
    },
  };

  await exportInspectionToDocx(
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
