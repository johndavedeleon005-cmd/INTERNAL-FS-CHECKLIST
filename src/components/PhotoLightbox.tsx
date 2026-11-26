import { useEffect } from 'react';
import { Clock, Download, Trash2, X } from 'lucide-react';
import type { PhotoProof } from '../types/inspection';
import { formatTakenTimestamp } from '../utils/imageUtils';

interface PhotoLightboxProps {
  photo: PhotoProof;
  itemNumber: number;
  itemText: string;
  readOnlyCaption?: boolean;
  onUpdateCaption?: (caption: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function PhotoLightbox({
  photo,
  itemNumber,
  itemText,
  readOnlyCaption = false,
  onUpdateCaption,
  onDelete,
  onClose,
}: PhotoLightboxProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = photo.dataUrl;
    link.download =
      photo.fileName || `IQAF-005_Item${itemNumber}_${photo.id.slice(-5)}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo proof for Item ${itemNumber}`}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-3xl w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-mono text-slate-500 tabular-nums">
              <span>Item #{itemNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                <Clock className="w-3 h-3 shrink-0" />
                Taken: {formatTakenTimestamp(photo.capturedAt)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{photo.fileName}</span>
            </div>
            <p className="text-sm font-medium text-slate-900 mt-0.5 line-clamp-2">
              {itemText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close photo preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-900 flex items-center justify-center max-h-[60vh] overflow-hidden p-3">
          <img
            src={photo.dataUrl}
            alt={photo.caption || `Photo proof for item ${itemNumber}`}
            referrerPolicy="no-referrer"
            className="max-h-[56vh] max-w-full object-contain rounded"
          />
        </div>

        <div className="px-5 py-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="flex-1 block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              Photo Caption / Proof Description
            </span>
            <input
              type="text"
              readOnly={readOnlyCaption}
              value={photo.caption}
              onChange={(e) => onUpdateCaption?.(e.target.value)}
              placeholder={
                readOnlyCaption
                  ? 'No caption recorded'
                  : 'Describe what this photo shows (appears in PDF appendix)'
              }
              className={`w-full h-9 px-3 text-sm border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 ${
                readOnlyCaption ? 'bg-slate-50 text-slate-600' : 'bg-white'
              }`}
            />
          </label>
          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Save JPG
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-9 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
