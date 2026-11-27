import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
} from 'lucide-react';
import { TOTAL_ITEMS_COUNT } from '../data/checklistData';

interface BlankSheetMenuButtonProps {
  onDownloadBlankPdf: () => Promise<void> | void;
  onDownloadBlankExcel: () => Promise<void> | void;
  onDownloadBlankDocx?: () => Promise<void> | void;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
}

export function BlankSheetMenuButton({
  onDownloadBlankPdf,
  onDownloadBlankExcel,
  onDownloadBlankDocx,
  size = 'sm',
  align = 'right',
}: BlankSheetMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<'pdf' | 'excel' | 'docx' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = async (format: 'pdf' | 'excel' | 'docx') => {
    setBusyFormat(format);
    setOpen(false);
    try {
      if (format === 'pdf') {
        await onDownloadBlankPdf();
      } else if (format === 'docx') {
        await onDownloadBlankDocx?.();
      } else {
        await onDownloadBlankExcel();
      }
    } finally {
      setBusyFormat(null);
    }
  };

  const heightClass = size === 'md' ? 'h-9 px-3 rounded-lg' : 'h-8 px-3 rounded-md';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={busyFormat !== null}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex items-center gap-1.5 ${heightClass} text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap`}
        title="Download a completely blank checklist sheet (no filled info)"
      >
        {busyFormat ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-slate-500" />
        )}
        <span>{busyFormat ? 'Preparing…' : 'Blank Sheet'}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-40 mt-1.5 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 border-b border-slate-100">
            Download Blank Checklist (Sheet Only)
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleSelect('pdf')}
            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2.5 transition-colors"
          >
            <FileDown className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                Blank Checklist PDF
              </div>
              <div className="text-[11px] text-slate-500 leading-snug">
                Printable IQAF-005 sheet only — all fields &amp; {TOTAL_ITEMS_COUNT} items blank
              </div>
            </div>
          </button>
          {onDownloadBlankDocx && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleSelect('docx')}
              className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2.5 transition-colors"
            >
              <FileText className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900">
                  Blank Checklist Word (.docx)
                </div>
                <div className="text-[11px] text-slate-500 leading-snug">
                  Editable Word checklist sheet — all fields &amp; {TOTAL_ITEMS_COUNT} items blank
                </div>
              </div>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleSelect('excel')}
            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2.5 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                Blank Checklist Excel (.xlsx)
              </div>
              <div className="text-[11px] text-slate-500 leading-snug">
                Checklist tab only — no filled info, summary, or photos
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
