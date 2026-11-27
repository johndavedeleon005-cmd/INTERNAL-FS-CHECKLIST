import { AlertTriangle, RefreshCw } from 'lucide-react';

interface OfflineShellHeaderBannerProps {
  isNetworkOffline: boolean;
  updateAvailable: boolean;
  isChecking: boolean;
  statusNote: string | null;
  onCheckForUpdates: () => void;
}

export function OfflineShellHeaderBanner({
  isNetworkOffline,
  updateAvailable,
  isChecking,
  statusNote,
  onCheckForUpdates,
}: OfflineShellHeaderBannerProps) {
  const headline = updateAvailable
    ? 'New app update available'
    : 'Running from offline cached version';

  const description = updateAvailable
    ? 'A newer version of the app shell is available on the server.'
    : isNetworkOffline
      ? 'App shell is loaded from local cache while offline.'
      : 'Session started from local offline cache — verify or fetch the latest app shell.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print bg-amber-50 border-b border-amber-300 px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-amber-100 border border-amber-300 text-amber-800 shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </span>
        <div className="min-w-0 text-xs text-amber-950 leading-snug">
          <span className="font-bold">{headline}</span>
          <span className="hidden md:inline text-amber-900">
            {' '}
            — {description}
          </span>
          {statusNote && (
            <span className="block sm:inline sm:ml-2 font-medium text-amber-900">
              · {statusNote}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onCheckForUpdates}
        disabled={isChecking}
        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white bg-amber-900 hover:bg-amber-950 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 shrink-0 ${isChecking ? 'animate-spin' : ''}`}
        />
        <span>{isChecking ? 'Checking…' : 'Check for updates'}</span>
      </button>
    </div>
  );
}
