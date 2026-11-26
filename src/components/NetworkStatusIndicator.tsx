import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  LogIn,
  RefreshCw,
  Save,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface NetworkStatusIndicatorProps {
  isSignedIn: boolean;
  isSigningIn: boolean;
  isSavingOnline: boolean;
  hasUnsavedCloudChanges: boolean;
  uploadingPhotoCount: number;
  failedPhotoCount: number;
  localOnlyPhotoCount: number;
  totalPhotosCount: number;
  lastSyncedAt: string | null;
  autoSaveEnabled?: boolean;
  onToggleAutoSave?: (enabled: boolean) => void;
  onSaveOnline: () => Promise<void>;
  onRetryFailedPhotos: () => void;
  onSignIn: () => Promise<void>;
  onConnectivityChange?: (online: boolean) => void;
}

type VisualStatusTone = 'green' | 'amber' | 'red';

export function NetworkStatusIndicator({
  isSignedIn,
  isSigningIn,
  isSavingOnline,
  hasUnsavedCloudChanges,
  uploadingPhotoCount,
  failedPhotoCount,
  localOnlyPhotoCount,
  totalPhotosCount,
  lastSyncedAt,
  autoSaveEnabled = true,
  onToggleAutoSave,
  onSaveOnline,
  onRetryFailedPhotos,
  onSignIn,
  onConnectivityChange,
}: NetworkStatusIndicatorProps) {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [serverReachable, setServerReachable] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevConnectedRef = useRef<boolean | null>(null);
  const onConnectivityChangeRef = useRef(onConnectivityChange);
  onConnectivityChangeRef.current = onConnectivityChange;

  const verifyConnection = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBrowserOnline(false);
      setServerReachable(false);
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    setIsChecking(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      setBrowserOnline(true);
      // On static hosts (e.g., GitHub Pages) there is no Express /api/health endpoint,
      // so the host responds with HTTP 404. Any non-5xx HTTP response confirms the network is up.
      setServerReachable(res.ok || res.status === 404);
    } catch {
      setServerReachable(false);
    } finally {
      window.clearTimeout(timeoutId);
      setIsChecking(false);
      setLastCheckedAt(new Date().toISOString());
    }
  }, []);

  // Listen to browser online/offline events and run lightweight periodic reachability checks
  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      void verifyConnection();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setServerReachable(false);
      setLastCheckedAt(new Date().toISOString());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void verifyConnection();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    void verifyConnection();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void verifyConnection();
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [verifyConnection]);

  const isConnected = browserOnline && serverReachable;

  // Notify parent when connectivity transitions after initial state settles
  useEffect(() => {
    if (prevConnectedRef.current === null) {
      prevConnectedRef.current = isConnected;
      return;
    }
    if (prevConnectedRef.current !== isConnected) {
      prevConnectedRef.current = isConnected;
      onConnectivityChangeRef.current?.(isConnected);
    }
  }, [isConnected]);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  const isActivelySyncing = isSavingOnline || uploadingPhotoCount > 0;
  const hasPendingOnlineWork =
    isSignedIn && (hasUnsavedCloudChanges || localOnlyPhotoCount > 0);

  let tone: VisualStatusTone = 'green';
  let shortLabel = isSignedIn ? 'Synced' : 'Online';
  let headline = isSignedIn
    ? 'Online · All changes synced'
    : 'Online · Local storage active';

  if (!isConnected) {
    tone = 'amber';
    shortLabel = 'Offline';
    headline = 'Offline · Saving locally';
  } else if (isActivelySyncing) {
    tone = 'amber';
    shortLabel =
      uploadingPhotoCount > 0
        ? `Syncing (${uploadingPhotoCount})`
        : 'Syncing…';
    headline =
      uploadingPhotoCount > 0 && isSavingOnline
        ? `Saving report & uploading ${uploadingPhotoCount} ${uploadingPhotoCount === 1 ? 'photo' : 'photos'}…`
        : uploadingPhotoCount > 0
          ? `Uploading ${uploadingPhotoCount} ${uploadingPhotoCount === 1 ? 'photo' : 'photos'} to cloud…`
          : 'Saving report to database…';
  } else if (failedPhotoCount > 0) {
    tone = 'red';
    shortLabel = `${failedPhotoCount} Failed`;
    headline = `${failedPhotoCount} photo ${failedPhotoCount === 1 ? 'upload' : 'uploads'} failed`;
  } else if (hasPendingOnlineWork) {
    tone = 'amber';
    shortLabel = 'Unsaved';
    headline = 'Online · Pending cloud save';
  }

  const dotClass =
    tone === 'green'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : 'bg-red-600';

  const textClass =
    tone === 'green'
      ? 'text-emerald-800'
      : tone === 'amber'
        ? 'text-amber-800'
        : 'text-red-700';

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Not yet';
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return 'Recently';
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Network and sync status: ${headline}`}
        title={headline}
        className="inline-flex items-center gap-2 h-9 px-2.5 rounded-lg text-xs font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/30 transition-colors whitespace-nowrap shrink-0"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          {isActivelySyncing && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping motion-reduce:hidden" />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotClass}`}
          />
        </span>

        {!isConnected ? (
          <WifiOff className={`w-3.5 h-3.5 shrink-0 ${textClass}`} />
        ) : isActivelySyncing ? (
          <Loader2
            className={`w-3.5 h-3.5 shrink-0 animate-spin ${textClass}`}
          />
        ) : failedPhotoCount > 0 ? (
          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${textClass}`} />
        ) : (
          <Wifi className={`w-3.5 h-3.5 shrink-0 ${textClass}`} />
        )}

        <span
          className={`hidden sm:inline font-semibold tabular-nums ${textClass}`}
        >
          {shortLabel}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Network and sync details"
          className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden"
        >
          {/* Header summary */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${dotClass}`}
                />
                <span className="text-xs font-bold text-slate-950 truncate">
                  {headline}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                {!isConnected
                  ? 'Edits and photos are safely stored locally on this device and can be synced once your connection returns.'
                  : isActivelySyncing
                    ? 'Active uploads or database saves are currently transferring. Keep this tab open until syncing finishes.'
                    : failedPhotoCount > 0
                      ? 'One or more photo proofs failed to upload online. They remain saved locally and can be retried now.'
                      : isSignedIn
                        ? 'Connected to the network. Photos upload immediately when attached and reports save online to Firestore.'
                        : 'Connected to the network. Sign in with Google to sync reports and photo proofs online.'}
              </p>
            </div>
          </div>

          {/* Live status breakdown rows */}
          <div className="px-4 py-3 space-y-2.5 text-xs divide-y divide-slate-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 flex items-center gap-1.5">
                {isConnected ? (
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                )}
                Network
              </span>
              <span
                className={`font-semibold ${
                  isConnected ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {isConnected
                  ? 'Connected'
                  : browserOnline
                    ? 'Server unreachable'
                    : 'Offline'}
              </span>
            </div>

            <div className="pt-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-500 flex items-center gap-1.5">
                {isSignedIn ? (
                  <Cloud className="w-3.5 h-3.5 text-slate-500" />
                ) : (
                  <CloudOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                Database Save
              </span>
              <span className="font-medium text-slate-800 tabular-nums">
                {isSavingOnline ? (
                  <span className="text-amber-700 font-semibold">Saving…</span>
                ) : !isSignedIn ? (
                  <span className="text-slate-500">Local only</span>
                ) : hasUnsavedCloudChanges ? (
                  <span className="text-amber-700 font-semibold">
                    Unsaved edits
                  </span>
                ) : (
                  <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Synced
                  </span>
                )}
              </span>
            </div>

            <div className="pt-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-500">Photo Uploads</span>
              <span className="font-mono text-[11.5px] tabular-nums">
                {uploadingPhotoCount > 0 ? (
                  <span className="text-amber-700 font-semibold">
                    Uploading {uploadingPhotoCount}…
                  </span>
                ) : failedPhotoCount > 0 ? (
                  <span className="text-red-700 font-semibold">
                    {failedPhotoCount} failed
                  </span>
                ) : totalPhotosCount === 0 ? (
                  <span className="text-slate-400">No photos attached</span>
                ) : localOnlyPhotoCount > 0 && isSignedIn ? (
                  <span className="text-amber-700 font-semibold">
                    {localOnlyPhotoCount} pending sync
                  </span>
                ) : isSignedIn ? (
                  <span className="text-emerald-700 font-semibold">
                    {totalPhotosCount} synced
                  </span>
                ) : (
                  <span className="text-slate-600">
                    {totalPhotosCount} stored locally
                  </span>
                )}
              </span>
            </div>

            <div className="pt-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Auto-save</span>
              {onToggleAutoSave ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSaveEnabled}
                  onClick={() => onToggleAutoSave(!autoSaveEnabled)}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-semibold transition-colors ${
                    autoSaveEnabled
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      autoSaveEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  {autoSaveEnabled ? 'On' : 'Paused'}
                </button>
              ) : (
                <span className="font-semibold text-emerald-700">On</span>
              )}
            </div>

            <div className="pt-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Last synced</span>
              <span className="font-mono tabular-nums text-slate-700">
                {formatTime(lastSyncedAt)}
              </span>
            </div>
          </div>

          {/* Action footer */}
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={isChecking}
              onClick={() => void verifyConnection()}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 text-[11.5px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`}
              />
              {isChecking ? 'Checking…' : 'Check Now'}
            </button>

            {failedPhotoCount > 0 && isSignedIn && isConnected ? (
              <button
                type="button"
                onClick={() => {
                  onRetryFailedPhotos();
                  setOpen(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-[11.5px] font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3 h-3" />
                Retry Failed ({failedPhotoCount})
              </button>
            ) : !isSignedIn ? (
              <button
                type="button"
                disabled={isSigningIn || !isConnected}
                onClick={() => {
                  setOpen(false);
                  void onSignIn();
                }}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-[11.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                <LogIn className="w-3 h-3" />
                Sign In to Sync
              </button>
            ) : hasPendingOnlineWork && isConnected ? (
              <button
                type="button"
                disabled={isSavingOnline}
                onClick={() => {
                  setOpen(false);
                  void onSaveOnline();
                }}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-[11.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                <Save className="w-3 h-3" />
                Save Online Now
              </button>
            ) : (
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                Checked {formatTime(lastCheckedAt)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
