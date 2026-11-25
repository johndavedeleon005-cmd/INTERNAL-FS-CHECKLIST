import {
  FilePlus2,
  FolderOpen,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  formatDisplayDate,
} from '../data/checklistData';
import type { InspectionReport } from '../types/inspection';

interface SavedReportsDrawerProps {
  open: boolean;
  onClose: () => void;
  currentReportId: string;
  savedReports: InspectionReport[];
  onSaveCurrentSnapshot: () => void;
  onLoadReport: (report: InspectionReport) => void;
  onDeleteReport: (id: string) => void;
  onCreateBlank: () => void;
  onLoadSample: () => void;
}

function summarizeReport(report: InspectionReport) {
  let answered = 0;
  let deviations = 0;
  let photos = 0;
  for (const item of ALL_CHECKLIST_ITEMS) {
    const r = report.responses[item.number];
    if (!r) continue;
    if (r.complied) answered++;
    if (r.complied === 'No') deviations++;
    photos += r.photos.length;
  }
  return { answered, deviations, photos };
}

export function SavedReportsDrawer({
  open,
  onClose,
  currentReportId,
  savedReports,
  onSaveCurrentSnapshot,
  onLoadReport,
  onDeleteReport,
  onCreateBlank,
  onLoadSample,
}: SavedReportsDrawerProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Saved Inspection Audits"
    >
      <div
        className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Saved Audits
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Stored locally in your browser
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close saved audits drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSaveCurrentSnapshot}
            className="w-full inline-flex items-center justify-center gap-2 h-9 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save Current Inspection to History
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onCreateBlank();
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              New Blank Form
            </button>
            <button
              type="button"
              onClick={() => {
                onLoadSample();
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Load Sample Audit
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {savedReports.length === 0 ? (
            <div className="text-center py-12 px-4">
              <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
              <p className="text-sm font-medium text-slate-800">
                No saved audits yet
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Your active form auto-saves continuously. Click &ldquo;Save
                Current Inspection to History&rdquo; to archive completed store
                visits here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {savedReports.map((entry) => {
                const stats = summarizeReport(entry);
                const isCurrent = entry.id === currentReportId;
                return (
                  <div
                    key={entry.id}
                    className={`p-3.5 transition-colors ${
                      isCurrent ? 'bg-red-50/40' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadReport(entry);
                          onClose();
                        }}
                        className="text-left flex-1 min-w-0"
                      >
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {entry.meta.storeLocation || 'Untitled Store Location'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {formatDisplayDate(entry.meta.dateOfInspection) ||
                            'No date'}{' '}
                          · {entry.meta.inspectedBy || 'No inspector'}
                        </div>
                        <div className="text-xs text-slate-600 mt-1.5 font-mono tabular-nums">
                          {stats.answered}/{ALL_CHECKLIST_ITEMS.length} checked ·{' '}
                          <span
                            className={
                              stats.deviations > 0
                                ? 'text-red-700 font-semibold'
                                : ''
                            }
                          >
                            {stats.deviations} No
                          </span>{' '}
                          · {stats.photos} photos
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteReport(entry.id)}
                        className="p-1.5 text-slate-400 hover:text-red-700 rounded transition-colors shrink-0"
                        aria-label="Delete saved audit"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
