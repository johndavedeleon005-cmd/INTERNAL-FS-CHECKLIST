import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RotateCw,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { PhotoUploadDiagnostic } from '../types/inspection';

interface PhotoUploadDiagnosticOverlayProps {
  diagnostics: PhotoUploadDiagnostic[];
  isOpen: boolean;
  onToggleOpen: (open: boolean) => void;
  onRetryPhoto: (itemNumber: number, photoId: string) => void;
  onRetryAll: () => void;
  onDismissEntry: (photoId: string) => void;
  onClearAll: () => void;
}

export function PhotoUploadDiagnosticOverlay({
  diagnostics,
  isOpen,
  onToggleOpen,
  onRetryPhoto,
  onRetryAll,
  onDismissEntry,
  onClearAll,
}: PhotoUploadDiagnosticOverlayProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (diagnostics.length === 0) return null;

  const retryingCount = diagnostics.filter((d) => d.retrying).length;
  const activeFailureCount = diagnostics.length - retryingCount;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = async (label: string, payload: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedId(label);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === label ? null : prev));
      }, 2200);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  const formatKb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

  const formatClock = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (!isOpen) {
    return (
      <div className="no-print fixed bottom-5 left-5 z-50">
        <button
          type="button"
          onClick={() => onToggleOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 h-10 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-semibold shadow-lg transition-colors"
        >
          {retryingCount > 0 ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="tabular-nums">
            {retryingCount > 0
              ? `Retrying ${retryingCount} ${retryingCount === 1 ? 'photo' : 'photos'}…`
              : `${activeFailureCount} Photo Upload ${activeFailureCount === 1 ? 'Error' : 'Errors'}`}
          </span>
          <span className="font-mono text-[10.5px] bg-red-900/60 px-1.5 py-0.5 rounded">
            {diagnostics[0]?.errorCode || 'error'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <aside
      role="region"
      aria-label="Photo upload error diagnostics"
      className="no-print fixed bottom-4 left-4 right-4 sm:right-auto sm:w-[460px] max-h-[78vh] z-50 bg-white border border-red-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-red-700 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-red-950 truncate">
              Photo Upload Diagnostics ({diagnostics.length})
            </h2>
            <p className="text-[11px] text-red-800/80 truncate">
              Firebase Storage &amp; Firestore error codes &amp; attempt traces
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onToggleOpen(false)}
            className="p-1.5 text-red-800 hover:bg-red-100 rounded-md transition-colors"
            title="Minimize diagnostics"
            aria-label="Minimize diagnostics"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="p-1.5 text-red-800 hover:bg-red-100 rounded-md transition-colors"
            title="Dismiss all diagnostics"
            aria-label="Dismiss all diagnostics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Diagnostic Entries */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {diagnostics.map((entry) => {
          const isExpanded = Boolean(expandedIds[entry.id]);
          return (
            <div key={entry.id} className="p-3.5 space-y-2.5 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900 tabular-nums">
                      Item #{entry.itemNumber}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate max-w-[180px]">
                      {entry.fileName}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-mono text-[11px] font-semibold">
                      {entry.errorCode}
                    </span>
                    <span className="text-[11px] font-medium text-slate-700">
                      {entry.friendlySummary}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={Boolean(entry.retrying)}
                    onClick={() =>
                      onRetryPhoto(entry.itemNumber, entry.photoId)
                    }
                    className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                  >
                    {entry.retrying ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCw className="w-3 h-3" />
                    )}
                    {entry.retrying ? 'Retrying…' : 'Retry'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissEntry(entry.photoId)}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                    title="Dismiss entry"
                    aria-label="Dismiss diagnostic entry"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <p className="text-[11.5px] text-slate-600 leading-relaxed">
                {entry.guidance}
              </p>

              {/* Key Technical Metadata */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] font-mono bg-slate-50 border border-slate-200 rounded-md p-2 text-slate-700">
                <div className="truncate">
                  <span className="text-slate-400">Op: </span>
                  {entry.operationType || 'write'}
                </div>
                <div className="truncate tabular-nums">
                  <span className="text-slate-400">Size: </span>
                  {formatKb(entry.payloadBytes)} · {entry.attempts}{' '}
                  {entry.attempts === 1 ? 'try' : 'tries'}
                </div>
                <div className="truncate">
                  <span className="text-slate-400">Network: </span>
                  {entry.online ? 'online' : 'offline'}
                </div>
                <div className="truncate">
                  <span className="text-slate-400">Auth: </span>
                  {entry.authState.signedIn
                    ? entry.authState.emailVerified
                      ? 'verified'
                      : 'unverified'
                    : 'signed-out'}
                </div>
                {entry.path && (
                  <div className="col-span-2 truncate" title={entry.path}>
                    <span className="text-slate-400">Path: </span>
                    {entry.path}
                  </div>
                )}
              </div>

              {/* Expandable Raw Error & Attempt Timeline */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpand(entry.id)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  {isExpanded ? 'Hide raw trace' : 'Show raw trace & attempts'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy(entry.id, entry)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                >
                  {copiedId === entry.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy JSON
                    </>
                  )}
                </button>
              </div>

              {isExpanded && (
                <div className="space-y-2 pt-1">
                  <div className="bg-slate-950 text-slate-100 rounded-md p-2.5 text-[10.5px] font-mono break-all leading-relaxed">
                    {entry.rawMessage}
                  </div>
                  {entry.attemptLogs.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10.5px] font-semibold text-slate-600 uppercase tracking-wide">
                        Attempt Timeline
                      </div>
                      {entry.attemptLogs.map((log) => (
                        <div
                          key={`${entry.id}-${log.attempt}`}
                          className="text-[10.5px] font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              #{log.attempt} · {log.errorCode}
                            </span>
                            <span className="text-slate-400 tabular-nums">
                              {formatClock(log.timestamp)} ({log.durationMs}ms)
                            </span>
                          </div>
                          <div className="text-slate-600 truncate mt-0.5" title={log.message}>
                            {log.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy('all', diagnostics)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
          >
            {copiedId === 'all' ? (
              <>
                <Check className="w-3 h-3 text-emerald-600" />
                Copied All
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy All Logs
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1 px-2 h-8 text-[11px] font-medium text-slate-500 hover:text-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>

        <button
          type="button"
          disabled={retryingCount > 0}
          onClick={onRetryAll}
          className="inline-flex items-center gap-1.5 px-3 h-8 text-[11.5px] font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
        >
          {retryingCount > 0 ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCw className="w-3.5 h-3.5" />
          )}
          Retry All ({diagnostics.length})
        </button>
      </div>
    </aside>
  );
}
