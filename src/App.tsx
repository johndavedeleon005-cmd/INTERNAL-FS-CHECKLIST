import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Camera,
  CheckCheck,
  Clock,
  Cloud,
  CopyPlus,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Images,
  LayoutDashboard,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Menu,
  RefreshCw,
  Save,
  Search,
  Share2,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  CUSTOM_BRANCH_OPTION,
  FACILITY_BRANCHES,
  HOW_TO_FILL_INSTRUCTION,
  IQAF_BASIS_STATEMENT,
  REPORT_CONFIDENTIALITY_NOTICE,
  STORE_BRANCHES,
  TOTAL_ITEMS_COUNT,
  computeNextBranchReportSequence,
  createBlankInspection,
  createEmptyResponse,
  createSampleInspection,
  formatReportNo,
  getCurrentTimeString,
  getInspectionShortYear,
  isPresetBranch,
  normalizeBranchName,
  resolveReportSequenceMap,
  type ReportSequenceRecord,
} from './data/checklistData';
import {
  auth,
  extractFirebaseErrorDetails,
  getOrCreatePublicInspectorId,
  signInWithGoogle,
  signOutUser,
} from './firebase';
import type {
  InspectionReport,
  ItemResponse,
  PdfExportOptions,
  PhotoProof,
  PhotoUploadAttemptLog,
  PhotoUploadDiagnostic,
  ReportCollaborationInfo,
  SignOffEntry,
  SignOffRoleKey,
  StoredPhotoRecord,
} from './types/inspection';
import {
  type CloudReportSummary,
  type ReportDirtyDelta,
  autosaveReportDocumentOnline,
  claimShareLinkOnline,
  clearCloudReportCache,
  deletePhotosBatchOnline,
  deleteReportOnline,
  deleteSinglePhotoOnline,
  duplicateReportOnline,
  leaveSharedReportOnline,
  loadAllUserPhotosOnline,
  loadReportWithPhotosOnline,
  sanitizeId,
  saveReportOnline,
  subscribeToActiveReport,
  subscribeToSharedReports,
  subscribeToUserReports,
  updatePhotoCaptionOnline,
  updatePhotosCaptionBatchOnline,
  uploadSinglePhotoImmediatelyOnline,
} from './utils/cloudReports';
import {
  formatTakenTimestamp,
  getHdUploadsPreference,
  setHdUploadsPreference,
} from './utils/imageUtils';
import {
  exportBlankChecklistDocx,
  exportInspectionToDocx,
} from './utils/docxExporter';
import {
  exportBlankChecklistExcel,
  exportInspectionToExcel,
} from './utils/excelExporter';
import {
  collectIndexedPhotos,
  exportBlankChecklistPdf,
  exportInspectionToPdf,
  exportMergedReportsToPdf,
} from './utils/pdfExporter';
import {
  type BackgroundSyncPhotoItem,
  type BackgroundSyncState,
  INITIAL_BACKGROUND_SYNC_STATE,
  PhotoBackgroundSyncService,
} from './utils/photoBackgroundSync';
import {
  deleteSavedReportFromDb,
  deleteStoredPhotoFromDb,
  extractPhotoRecordsFromReport,
  isLocalStorageQuotaError,
  loadActiveDraftFromDb,
  loadAllStoredPhotosFromDb,
  loadDraftSyncStateFromDb,
  loadSavedReportsFromDb,
  saveActiveDraftToDb,
  saveDraftSyncStateToDb,
  saveReportSnapshotToDb,
  upsertStoredPhotoInDb,
} from './utils/storageDb';
import { AuthGateScreen } from './components/AuthGateScreen';
import { BlankSheetMenuButton } from './components/BlankSheetMenuButton';
import { BranchDashboardView } from './components/BranchDashboardView';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { EmailReportModal } from './components/EmailReportModal';
import { InspectionItemRow } from './components/InspectionItemRow';
import { InspectionSummaryView } from './components/InspectionSummaryView';
import { JiangNanLogo } from './components/JiangNanLogo';
import {
  type CloudSaveErrorInfo,
  NetworkStatusIndicator,
} from './components/NetworkStatusIndicator';
import { OfflineShellHeaderBanner } from './components/OfflineShellHeaderBanner';
import { PhotoLightbox } from './components/PhotoLightbox';
import { PhotoUploadDiagnosticOverlay } from './components/PhotoUploadDiagnosticOverlay';
import { PhotoVaultView } from './components/PhotoVaultView';
import { ReportPreview } from './components/ReportPreview';
import {
  type MergedReportSelectionItem,
  ReportsLibraryView,
} from './components/ReportsLibraryView';
import { ShareReportModal } from './components/ShareReportModal';
import { SignaturePad } from './components/SignaturePad';
import {
  type AppShellDetectionSnapshot,
  checkForAppShellUpdates,
  initializeAppShellDetection,
  subscribeToAppShellStatus,
} from './utils/appShellStatus';

type ViewMode = 'dashboard' | 'reports' | 'form' | 'summary' | 'photos' | 'report';
type FilterMode = 'all' | 'unanswered' | 'Yes' | 'No' | 'N/A' | 'photos';

type LightboxState =
  | {
      kind: 'current';
      itemNumber: number;
      itemText: string;
      photoId: string;
    }
  | {
      kind: 'stored';
      record: StoredPhotoRecord;
    };

function formatRelativeTime(
  iso: string | null | undefined,
  referenceMs: number
): string {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return 'just now';
  const diffSec = Math.max(0, Math.floor((referenceMs - ts) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function App() {
  // Auth & Online Cloud state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const publicInspectorId = useMemo(() => getOrCreatePublicInspectorId(), []);
  const effectiveUid = user?.uid || publicInspectorId;
  const [cloudReports, setCloudReports] = useState<CloudReportSummary[]>([]);
  const [sharedReports, setSharedReports] = useState<CloudReportSummary[]>([]);
  const [activeCollaboration, setActiveCollaboration] =
    useState<ReportCollaborationInfo | null>(null);
  const [shareModalReportId, setShareModalReportId] = useState<string | null>(
    null
  );
  const [remoteUpdateNotice, setRemoteUpdateNotice] = useState<{
    version: number;
    editorName: string;
  } | null>(null);
  const [pendingShareLinkToken, setPendingShareLinkToken] = useState<
    string | null
  >(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  });
  const [pendingDirectReportId, setPendingDirectReportId] = useState<
    string | null
  >(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('report');
  });
  const [isClaimingShareLink, setIsClaimingShareLink] = useState(false);
  const [loadingCloudReports, setLoadingCloudReports] = useState(false);
  const [cloudPhotos, setCloudPhotos] = useState<StoredPhotoRecord[]>([]);
  const [isSavingOnline, setIsSavingOnline] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('iqaf005_autosave_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [hdUploadsEnabled, setHdUploadsEnabled] = useState<boolean>(() =>
    getHdUploadsPreference()
  );
  const [hasUnsavedCloudChanges, setHasUnsavedCloudChanges] = useState(false);
  const [lastCloudSaveError, setLastCloudSaveError] =
    useState<CloudSaveErrorInfo | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [isExportingMergedPdf, setIsExportingMergedPdf] = useState(false);
  const [mergedPdfProgress, setMergedPdfProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Active working report & local IndexedDB cache
  const [report, setReport] = useState<InspectionReport>(createBlankInspection);
  const [customBranchForReportId, setCustomBranchForReportId] = useState<string | null>(null);
  const [localReports, setLocalReports] = useState<InspectionReport[]>([]);
  const [localPhotos, setLocalPhotos] = useState<StoredPhotoRecord[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Navigation & UI state
  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSectionCode, setActiveSectionCode] = useState<string>('ALL');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isNetworkOffline, setIsNetworkOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [appShellSnapshot, setAppShellSnapshot] =
    useState<AppShellDetectionSnapshot>({
      bootedFromOfflineCache:
        typeof navigator !== 'undefined' ? !navigator.onLine : false,
      cachedAt: null,
      updateAvailable: false,
    });
  const [isCheckingAppUpdates, setIsCheckingAppUpdates] = useState(false);
  const [shellUpdateNote, setShellUpdateNote] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [relativeNowMs, setRelativeNowMs] = useState<number>(() => Date.now());

  const [exportOptions, setExportOptions] = useState<PdfExportOptions>({
    includeSummary: true,
    includePhotoAppendix: true,
    includeInlineThumbnails: false,
    includeConfidentialWatermark: true,
  });

  const [lightboxState, setLightboxState] = useState<LightboxState | null>(null);
  const [cameraTarget, setCameraTarget] = useState<{
    itemNumber: number;
    itemText: string;
  } | null>(null);
  const [emailReportTarget, setEmailReportTarget] =
    useState<InspectionReport | null>(null);
  const [uploadDiagnostics, setUploadDiagnostics] = useState<
    PhotoUploadDiagnostic[]
  >([]);
  const [diagnosticsOverlayOpen, setDiagnosticsOverlayOpen] = useState(false);
  const [backgroundSyncState, setBackgroundSyncState] =
    useState<BackgroundSyncState>(INITIAL_BACKGROUND_SYNC_STATE);
  const saveTimerRef = useRef<number | null>(null);
  const cloudAutosaveTimerRef = useRef<number | null>(null);
  const autosaveRetryTimerRef = useRef<number | null>(null);
  const autoSaveInFlightRef = useRef<boolean>(false);
  const pendingAutosaveFollowUpRef = useRef<boolean>(false);
  const editVersionRef = useRef<number>(0);
  const dirtyFieldsRef = useRef<{
    full: boolean;
    meta: boolean;
    items: Set<number>;
    signOffKeys: Set<SignOffRoleKey>;
    photoIds: Set<string>;
  }>({
    full: false,
    meta: false,
    items: new Set(),
    signOffKeys: new Set(),
    photoIds: new Set(),
  });
  const captionTimersRef = useRef<Map<string, number>>(new Map());
  const uploadRunTokensRef = useRef<Map<string, number>>(new Map());
  const backgroundSyncServiceRef = useRef<PhotoBackgroundSyncService | null>(
    null
  );
  const fetchedPhotoCountsRef = useRef<Map<string, number>>(new Map());
  const userRef = useRef<User | null>(user);
  userRef.current = user;
  const effectiveUidRef = useRef<string>(effectiveUid);
  effectiveUidRef.current = effectiveUid;
  const reportRef = useRef<InspectionReport>(report);
  reportRef.current = report;
  const localReportsRef = useRef<InspectionReport[]>(localReports);
  localReportsRef.current = localReports;
  const sharedReportsRef = useRef<CloudReportSummary[]>(sharedReports);
  sharedReportsRef.current = sharedReports;
  const autoSaveEnabledRef = useRef<boolean>(autoSaveEnabled);
  autoSaveEnabledRef.current = autoSaveEnabled;
  const activeCollaborationRef = useRef<ReportCollaborationInfo | null>(
    activeCollaboration
  );
  activeCollaborationRef.current = activeCollaboration;
  const hasUnsavedCloudChangesRef = useRef<boolean>(hasUnsavedCloudChanges);
  hasUnsavedCloudChangesRef.current = hasUnsavedCloudChanges;
  const lastSyncedAtRef = useRef<string | null>(lastSyncedAt);
  lastSyncedAtRef.current = lastSyncedAt;

  const isReadOnlyViewer = activeCollaboration?.accessRole === 'viewer';

  const persistActiveSyncState = useCallback(
    (overrides?: {
      reportId?: string;
      hasUnsavedCloudChanges?: boolean;
      lastSyncedAt?: string | null;
    }) => {
      const targetReportId = overrides?.reportId ?? reportRef.current.id;
      const unsaved =
        overrides?.hasUnsavedCloudChanges ?? hasUnsavedCloudChangesRef.current;
      const syncedAt =
        overrides?.lastSyncedAt !== undefined
          ? overrides.lastSyncedAt
          : lastSyncedAtRef.current;
      void saveDraftSyncStateToDb({
        reportId: targetReportId,
        hasUnsavedCloudChanges: unsaved,
        lastSyncedAt: syncedAt,
        dirtyFull: dirtyFieldsRef.current.full,
        dirtyMeta: dirtyFieldsRef.current.meta,
        dirtyItemNumbers: Array.from(dirtyFieldsRef.current.items),
        dirtySignOffKeys: Array.from(dirtyFieldsRef.current.signOffKeys),
        dirtyPhotoIds: Array.from(dirtyFieldsRef.current.photoIds),
        updatedAt: new Date().toISOString(),
      });
    },
    []
  );

  const resetDirtyTracker = () => {
    dirtyFieldsRef.current = {
      full: false,
      meta: false,
      items: new Set(),
      signOffKeys: new Set(),
      photoIds: new Set(),
    };
  };

  const clearUrlShareParams = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('share') || url.searchParams.has('report')) {
      url.searchParams.delete('share');
      url.searchParams.delete('report');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Refresh relative "Last modified" display every 15s and immediately when timestamps change
  useEffect(() => {
    setRelativeNowMs(Date.now());
    const id = window.setInterval(() => {
      setRelativeNowMs(Date.now());
    }, 15000);
    return () => window.clearInterval(id);
  }, [report.updatedAt, lastSyncedAt]);

  // Track global browser offline/online state (covers auth gate as well as main app)
  useEffect(() => {
    const handleWindowOffline = () => {
      setIsNetworkOffline(true);
    };
    const handleWindowOnline = () => {
      // When signed in, NetworkStatusIndicator verifies real reachability before clearing;
      // on the auth gate, clear immediately on browser online.
      if (!userRef.current) {
        setIsNetworkOffline(false);
      }
    };
    window.addEventListener('offline', handleWindowOffline);
    window.addEventListener('online', handleWindowOnline);
    return () => {
      window.removeEventListener('offline', handleWindowOffline);
      window.removeEventListener('online', handleWindowOnline);
    };
  }, []);

  // Detect whether the current page booted from an offline cached app shell
  useEffect(() => {
    const unsubscribe = subscribeToAppShellStatus((snapshot) => {
      setAppShellSnapshot(snapshot);
    });
    void initializeAppShellDetection();
    return unsubscribe;
  }, []);

  const handleCheckForAppUpdates = useCallback(async () => {
    setIsCheckingAppUpdates(true);
    setShellUpdateNote('Fetching latest app shell…');
    try {
      const result = await checkForAppShellUpdates();
      if (result.status === 'offline') {
        setIsNetworkOffline(true);
        setShellUpdateNote(result.message);
        showToast(result.message);
      } else if (result.shouldReload) {
        setShellUpdateNote(result.message);
        showToast(result.message);
        window.setTimeout(() => {
          window.location.reload();
        }, 450);
      } else {
        setIsNetworkOffline(false);
        setShellUpdateNote(null);
        showToast(result.message);
      }
    } finally {
      setIsCheckingAppUpdates(false);
    }
  }, []);

  const isRunningFromOfflineCache =
    appShellSnapshot.bootedFromOfflineCache ||
    appShellSnapshot.updateAvailable ||
    isNetworkOffline;

  // Track Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to online Firestore reports (public & signed-in) once auth initializes
  useEffect(() => {
    if (!authReady) {
      setCloudReports([]);
      setSharedReports([]);
      setCloudPhotos([]);
      fetchedPhotoCountsRef.current.clear();
      setActiveCollaboration(null);
      setRemoteUpdateNotice(null);
      setLastCloudSaveError(null);
      setLoadingCloudReports(false);
      return;
    }

    setLoadingCloudReports(true);
    const unsubOwned = subscribeToUserReports(
      effectiveUid,
      user?.email,
      (list) => {
        setCloudReports(list);
        setLoadingCloudReports(false);
      },
      (err) => {
        setLoadingCloudReports(false);
        const msg = err.message || '';
        if (
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('resource-exhausted')
        ) {
          return;
        }
        console.warn('[CloudReports] Online sync notice:', msg);
      }
    );

    const unsubShared = user?.email
      ? subscribeToSharedReports(
          effectiveUid,
          user.email,
          (list) => {
            setSharedReports(list);
          },
          (err) => {
            console.warn('[SharedReports] Listener warning:', err.message);
          }
        )
      : () => {
          setSharedReports([]);
        };

    return () => {
      unsubOwned();
      unsubShared();
    };
  }, [authReady, effectiveUid, user?.email]);

  // Handle incoming ?share=<token> or ?report=<id> links
  useEffect(() => {
    if (!authReady) return;
    if (!pendingShareLinkToken && !pendingDirectReportId) return;

    let cancelled = false;

    const processIncomingLink = async () => {
      if (pendingShareLinkToken) {
        if (!user) return;
        if (!user.email) {
          showToast('Verified Google email required to open share links');
          setPendingShareLinkToken(null);
          clearUrlShareParams();
          return;
        }
        setIsClaimingShareLink(true);
        try {
          const claimed = await claimShareLinkOnline(
            user.uid,
            user.email,
            pendingShareLinkToken
          );
          if (cancelled) return;
          const loaded = await loadReportWithPhotosOnline(
            user.uid,
            claimed.reportId,
            user.email
          );
          if (cancelled) return;
          if (loaded) {
            setReport(loaded.report);
            setActiveCollaboration(loaded.collaboration);
            setHasUnsavedCloudChanges(false);
            setLastSyncedAt(loaded.report.updatedAt || new Date().toISOString());
            setRemoteUpdateNotice(null);
            resetDirtyTracker();
            setViewMode('form');
            showToast(
              loaded.collaboration.accessRole === 'owner'
                ? 'Opened your report from share link'
                : `Opened shared report (${loaded.collaboration.accessRole === 'editor' ? 'Can Edit' : 'View Only'})`
            );
          } else {
            showToast('Shared report could not be found');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setStorageWarning(
            msg.includes('invalid or has been revoked')
              ? msg
              : 'Could not open shared link. It may have been revoked by the report owner.'
          );
        } finally {
          if (!cancelled) {
            setIsClaimingShareLink(false);
            setPendingShareLinkToken(null);
            clearUrlShareParams();
          }
        }
        return;
      }

      if (pendingDirectReportId) {
        setIsClaimingShareLink(true);
        try {
          const loaded = await loadReportWithPhotosOnline(
            effectiveUid,
            pendingDirectReportId,
            user?.email
          );
          if (cancelled) return;
          if (loaded) {
            setReport(loaded.report);
            setActiveCollaboration(loaded.collaboration);
            setHasUnsavedCloudChanges(false);
            setLastSyncedAt(loaded.report.updatedAt || new Date().toISOString());
            setRemoteUpdateNotice(null);
            resetDirtyTracker();
            setViewMode('form');
            showToast('Opened shared report');
          } else {
            showToast('Report not found or access not granted');
          }
        } catch {
          setStorageWarning(
            'Could not load the requested report.'
          );
        } finally {
          if (!cancelled) {
            setIsClaimingShareLink(false);
            setPendingDirectReportId(null);
            clearUrlShareParams();
          }
        }
      }
    };

    void processIncomingLink();
    return () => {
      cancelled = true;
    };
  }, [authReady, user, effectiveUid, pendingShareLinkToken, pendingDirectReportId]);

  // Live real-time listener on the currently open online report (multi-device & collaborator sync)
  const isCurrentReportOnline = useMemo(
    () =>
      cloudReports.some((r) => r.id === report.id) ||
      sharedReports.some((r) => r.id === report.id),
    [cloudReports, sharedReports, report.id]
  );

  useEffect(() => {
    if (!authReady || !isCurrentReportOnline) return;

    const unsubscribe = subscribeToActiveReport(
      report.id,
      effectiveUid,
      user?.email,
      ({ collaboration, hasPendingWrites }) => {
        const prevCollab = activeCollaborationRef.current;
        setActiveCollaboration(collaboration);

        if (hasPendingWrites) return;
        if (
          prevCollab &&
          collaboration.syncVersion > prevCollab.syncVersion &&
          collaboration.lastEditedByUid !== effectiveUid
        ) {
          const editorLabel =
            collaboration.lastEditedByName || collaboration.ownerName || 'Collaborator';
          if (hasUnsavedCloudChangesRef.current) {
            setRemoteUpdateNotice({
              version: collaboration.syncVersion,
              editorName: editorLabel,
            });
          } else {
            void loadReportWithPhotosOnline(effectiveUid, report.id, user?.email)
              .then((fresh) => {
                if (!fresh || reportRef.current.id !== report.id) return;
                if (hasUnsavedCloudChangesRef.current) return;
                setReport(fresh.report);
                setActiveCollaboration(fresh.collaboration);
                setLastSyncedAt(fresh.report.updatedAt || new Date().toISOString());
                setRemoteUpdateNotice(null);
                resetDirtyTracker();
                showToast(`Synced live update from ${editorLabel}`);
              })
              .catch(() => {
                // ignore transient fetch errors
              });
          }
        }
      }
    );

    return () => unsubscribe();
  }, [authReady, effectiveUid, user?.email, report.id, isCurrentReportOnline]);

  // Incrementally refresh online Photo Vault ONLY for reports whose photoCount actually changed
  useEffect(() => {
    if (!authReady || cloudReports.length === 0) {
      fetchedPhotoCountsRef.current.clear();
      setCloudPhotos([]);
      return;
    }

    const activeIdsWithPhotos = new Set<string>();
    const idsNeedingFetch: string[] = [];

    for (const r of cloudReports) {
      if (r.stats.photoCount > 0) {
        activeIdsWithPhotos.add(r.id);
        if (fetchedPhotoCountsRef.current.get(r.id) !== r.stats.photoCount) {
          idsNeedingFetch.push(r.id);
        }
      } else {
        fetchedPhotoCountsRef.current.delete(r.id);
      }
    }

    for (const cachedId of Array.from(fetchedPhotoCountsRef.current.keys())) {
      if (!activeIdsWithPhotos.has(cachedId)) {
        fetchedPhotoCountsRef.current.delete(cachedId);
      }
    }

    if (activeIdsWithPhotos.size === 0) {
      setCloudPhotos([]);
      return;
    }

    // Prune photos from removed reports immediately
    setCloudPhotos((prev) => {
      const next = prev.filter((p) => activeIdsWithPhotos.has(p.reportId));
      return next.length === prev.length ? prev : next;
    });

    if (idsNeedingFetch.length === 0) {
      return;
    }

    let cancelled = false;
    const expectedCounts = new Map<string, number>();
    for (const id of idsNeedingFetch) {
      const match = cloudReports.find((r) => r.id === id);
      if (match) expectedCounts.set(id, match.stats.photoCount);
    }

    loadAllUserPhotosOnline(effectiveUid, idsNeedingFetch)
      .then((records) => {
        if (cancelled) return;
        for (const [id, count] of expectedCounts.entries()) {
          fetchedPhotoCountsRef.current.set(id, count);
        }
        const fetchedReportIdSet = new Set(idsNeedingFetch);
        setCloudPhotos((prev) => {
          const kept = prev.filter(
            (p) =>
              activeIdsWithPhotos.has(p.reportId) &&
              !fetchedReportIdSet.has(p.reportId)
          );
          const merged = [...records, ...kept];
          merged.sort((a, b) =>
            (b.capturedAt || '').localeCompare(a.capturedAt || '')
          );
          return merged;
        });
      })
      .catch(() => {
        // Error already logged by handleFirestoreError
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, effectiveUid, cloudReports]);

  // Hydrate active draft, saved snapshots, photo vault & durable sync state on startup
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [draft, history, photos, syncState] = await Promise.all([
        loadActiveDraftFromDb(),
        loadSavedReportsFromDb(),
        loadAllStoredPhotosFromDb(),
        loadDraftSyncStateFromDb(),
      ]);
      if (cancelled) return;
      setReport(draft);
      setLocalReports(history);
      setLocalPhotos(photos);

      if (syncState && syncState.reportId === draft.id) {
        if (syncState.lastSyncedAt) {
          setLastSyncedAt(syncState.lastSyncedAt);
        }
        if (syncState.hasUnsavedCloudChanges) {
          setHasUnsavedCloudChanges(true);
          dirtyFieldsRef.current = {
            full:
              syncState.dirtyFull ||
              (!syncState.dirtyMeta &&
                syncState.dirtyItemNumbers.length === 0 &&
                syncState.dirtySignOffKeys.length === 0 &&
                syncState.dirtyPhotoIds.length === 0),
            meta: syncState.dirtyMeta,
            items: new Set(syncState.dirtyItemNumbers),
            signOffKeys: new Set(syncState.dirtySignOffKeys),
            photoIds: new Set(syncState.dirtyPhotoIds),
          };
        }
      }
      setIsHydrated(true);
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const flushLocalDraftNow = useCallback(async (targetReport: InspectionReport) => {
    try {
      const hasExistingSnapshot = localReportsRef.current.some(
        (r) => r.id === targetReport.id
      );
      await saveActiveDraftToDb(targetReport);
      if (hasExistingSnapshot) {
        await saveReportSnapshotToDb(targetReport);
        setLocalReports((prev) => {
          const idx = prev.findIndex((r) => r.id === targetReport.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = targetReport;
          return next;
        });
      }
      persistActiveSyncState({ reportId: targetReport.id });
      const allPhotos = await loadAllStoredPhotosFromDb();
      setLocalPhotos(allPhotos);
    } catch (err) {
      if (isLocalStorageQuotaError(err)) {
        setStorageWarning(
          'Device storage is full — delete old snapshots or export backups to avoid losing edits.'
        );
      }
    }
  }, [persistActiveSyncState]);

  // Auto-save active draft to IndexedDB for instant offline safety
  useEffect(() => {
    if (!isHydrated) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushLocalDraftNow(report);
    }, 240);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [report, isHydrated, flushLocalDraftNow]);

  // Keep durable sync metadata aligned whenever report identity, unsaved status, or sync timestamp changes
  useEffect(() => {
    if (!isHydrated) return;
    persistActiveSyncState({
      reportId: report.id,
      hasUnsavedCloudChanges,
      lastSyncedAt,
    });
  }, [
    isHydrated,
    report.id,
    report.updatedAt,
    hasUnsavedCloudChanges,
    lastSyncedAt,
    persistActiveSyncState,
  ]);

  const handleToggleAutoSave = (enabled: boolean) => {
    setAutoSaveEnabled(enabled);
    try {
      localStorage.setItem('iqaf005_autosave_enabled', String(enabled));
    } catch {
      // ignore storage errors
    }
    if (!enabled && autosaveRetryTimerRef.current) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }
    showToast(enabled ? 'Auto-save enabled' : 'Auto-save paused');
  };

  const handleToggleHdUploads = (enabled: boolean) => {
    setHdUploadsEnabled(enabled);
    setHdUploadsPreference(enabled);
    showToast(
      enabled
        ? 'HD photo uploads enabled (up to 1920px)'
        : 'Standard photo uploads enabled (up to 1280px)'
    );
  };

  const runCloudAutosave = async (targetUser?: User | null) => {
    if (
      isSavingOnline ||
      activeCollaborationRef.current?.accessRole === 'viewer' ||
      (typeof navigator !== 'undefined' && !navigator.onLine)
    ) {
      return;
    }

    if (autoSaveInFlightRef.current) {
      pendingAutosaveFollowUpRef.current = true;
      return;
    }

    if (autosaveRetryTimerRef.current) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }

    const activeUser = targetUser !== undefined ? targetUser : userRef.current;
    const activeUid = activeUser?.uid || effectiveUidRef.current;
    const saveVersion = editVersionRef.current;
    const snapshot: InspectionReport = {
      ...reportRef.current,
      updatedAt: new Date().toISOString(),
    };
    const collab = activeCollaborationRef.current;
    const isOwner = !collab || collab.ownerId === activeUid;
    const nextSyncVersion = (collab?.syncVersion ?? 0) + 1;
    const actorName =
      activeUser?.displayName ||
      activeUser?.email ||
      snapshot.meta.inspectedBy ||
      'Inspector';

    const dirtySnap: ReportDirtyDelta = {
      full:
        dirtyFieldsRef.current.full ||
        (!dirtyFieldsRef.current.meta &&
          dirtyFieldsRef.current.items.size === 0 &&
          dirtyFieldsRef.current.signOffKeys.size === 0 &&
          dirtyFieldsRef.current.photoIds.size === 0),
      meta: dirtyFieldsRef.current.meta,
      itemNumbers: Array.from(dirtyFieldsRef.current.items),
      signOffKeys: Array.from(dirtyFieldsRef.current.signOffKeys),
      photoIds: Array.from(dirtyFieldsRef.current.photoIds),
    };

    autoSaveInFlightRef.current = true;
    setIsAutoSaving(true);

    try {
      const saved = await autosaveReportDocumentOnline(
        activeUid,
        snapshot,
        {
          actorName,
          isOwner,
          nextSyncVersion,
          dirty: dirtySnap,
        }
      );

      const didForkId = saved.reportId !== snapshot.id;
      const persistedSnapshot: InspectionReport = didForkId
        ? { ...snapshot, id: saved.reportId }
        : snapshot;

      if (didForkId && reportRef.current.id === snapshot.id) {
        const migratedReport: InspectionReport = {
          ...reportRef.current,
          id: saved.reportId,
        };
        reportRef.current = migratedReport;
        setReport(migratedReport);
        void saveActiveDraftToDb(migratedReport).catch(() => undefined);
        void deleteSavedReportFromDb(snapshot.id).catch(() => undefined);
      }

      void saveReportSnapshotToDb(persistedSnapshot)
        .then(() =>
          setLocalReports((prev) => {
            const filtered = prev.filter(
              (r) => r.id !== snapshot.id && r.id !== persistedSnapshot.id
            );
            return [persistedSnapshot, ...filtered];
          })
        )
        .catch((err) => {
          if (isLocalStorageQuotaError(err)) {
            setStorageWarning(
              'Device storage is nearly full — cloud copy succeeded, consider clearing old local snapshots.'
            );
          }
        });

      const syncedIso = new Date().toISOString();
      setLastSyncedAt(syncedIso);
      setLastCloudSaveError(null);
      setActiveCollaboration((prev) =>
        prev
          ? {
              ...prev,
              syncVersion: saved.syncVersion,
              lastEditedByUid: activeUid,
              lastEditedByName: actorName,
            }
          : prev
      );
      if (editVersionRef.current === saveVersion) {
        setHasUnsavedCloudChanges(false);
        resetDirtyTracker();
        persistActiveSyncState({
          reportId: persistedSnapshot.id,
          hasUnsavedCloudChanges: false,
          lastSyncedAt: syncedIso,
        });
      } else {
        pendingAutosaveFollowUpRef.current = true;
        persistActiveSyncState({
          reportId: persistedSnapshot.id,
          lastSyncedAt: syncedIso,
        });
      }

      // If any local/failed photos remain on this report or saved local reports while online, kick off background sync
      const hasPendingPhotos =
        Object.values(persistedSnapshot.responses).some((r) =>
          r.photos.some(
            (ph) => ph.uploadState === 'local' || ph.uploadState === 'error'
          )
        ) ||
        localReportsRef.current.some((rep) =>
          Object.values(rep.responses).some((r) =>
            r.photos.some(
              (ph) => ph.uploadState === 'local' || ph.uploadState === 'error'
            )
          )
        );
      if (hasPendingPhotos) {
        void backgroundSyncServiceRef.current?.triggerSync('scheduled');
      }
    } catch (err) {
      const details = extractFirebaseErrorDetails(err);
      console.warn('[AutoSave] Deferred cloud autosave:', {
        code: details.code,
        message: details.rawMessage,
      });
      setLastCloudSaveError({
        code: details.code,
        summary: details.friendlySummary,
        detail: details.rawMessage,
        at: new Date().toISOString(),
      });
      if (
        details.code === 'resource-exhausted' ||
        details.code === 'storage/quota-exceeded'
      ) {
        setStorageWarning(
          'Daily Firestore quota reached — auto-save paused online while edits stay saved locally.'
        );
      } else if (
        autoSaveEnabledRef.current &&
        hasUnsavedCloudChangesRef.current &&
        (typeof navigator === 'undefined' || navigator.onLine) &&
        !autosaveRetryTimerRef.current
      ) {
        // Schedule automatic retry after transient network/Firestore errors
        autosaveRetryTimerRef.current = window.setTimeout(() => {
          autosaveRetryTimerRef.current = null;
          if (
            autoSaveEnabledRef.current &&
            hasUnsavedCloudChangesRef.current &&
            (typeof navigator === 'undefined' || navigator.onLine)
          ) {
            void runCloudAutosave(userRef.current);
          }
        }, 12_000);
      }
    } finally {
      autoSaveInFlightRef.current = false;
      setIsAutoSaving(false);

      if (pendingAutosaveFollowUpRef.current) {
        pendingAutosaveFollowUpRef.current = false;
        if (
          autoSaveEnabledRef.current &&
          hasUnsavedCloudChangesRef.current &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          window.setTimeout(() => {
            if (
              autoSaveEnabledRef.current &&
              hasUnsavedCloudChangesRef.current
            ) {
              void runCloudAutosave(userRef.current);
            }
          }, 500);
        }
      }
    }
  };

  // Clear pending autosave retry timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveRetryTimerRef.current) {
        window.clearTimeout(autosaveRetryTimerRef.current);
        autosaveRetryTimerRef.current = null;
      }
    };
  }, []);

  // Debounced online Firestore autosave whenever user edits the report
  useEffect(() => {
    if (
      !isHydrated ||
      !authReady ||
      !autoSaveEnabled ||
      !hasUnsavedCloudChanges ||
      isSavingOnline ||
      isReadOnlyViewer
    ) {
      return;
    }

    if (cloudAutosaveTimerRef.current) {
      window.clearTimeout(cloudAutosaveTimerRef.current);
    }

    cloudAutosaveTimerRef.current = window.setTimeout(() => {
      cloudAutosaveTimerRef.current = null;
      void runCloudAutosave(user);
    }, 1200);

    return () => {
      if (cloudAutosaveTimerRef.current) {
        window.clearTimeout(cloudAutosaveTimerRef.current);
        cloudAutosaveTimerRef.current = null;
      }
    };
  }, [
    report,
    hasUnsavedCloudChanges,
    autoSaveEnabled,
    isHydrated,
    authReady,
    user,
    effectiveUid,
    isSavingOnline,
    isReadOnlyViewer,
  ]);

  // Flush pending local IndexedDB draft & pending cloud autosave on tab hide / pagehide / reconnect
  useEffect(() => {
    if (!isHydrated) return;

    const flushAllPendingSaves = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void flushLocalDraftNow(reportRef.current);
      }
      if (
        autoSaveEnabled &&
        hasUnsavedCloudChangesRef.current &&
        !isSavingOnline &&
        activeCollaborationRef.current?.accessRole !== 'viewer'
      ) {
        if (cloudAutosaveTimerRef.current) {
          window.clearTimeout(cloudAutosaveTimerRef.current);
          cloudAutosaveTimerRef.current = null;
        }
        void runCloudAutosave(userRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAllPendingSaves();
      }
    };

    const handlePageHide = () => {
      flushAllPendingSaves();
    };

    const handleWindowOnlineFlush = () => {
      if (
        autoSaveEnabled &&
        hasUnsavedCloudChangesRef.current &&
        !isSavingOnline
      ) {
        window.setTimeout(() => {
          if (hasUnsavedCloudChangesRef.current) {
            void runCloudAutosave(userRef.current);
          }
        }, 700);
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUploadingPhotos = Object.values(reportRef.current.responses).some(
        (r) => r.photos.some((p) => p.uploadState === 'uploading')
      );
      if (hasUploadingPhotos || isSavingOnline || autoSaveInFlightRef.current) {
        flushAllPendingSaves();
        e.preventDefault();
        e.returnValue = '';
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleWindowOnlineFlush);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleWindowOnlineFlush);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isHydrated, autoSaveEnabled, isSavingOnline, flushLocalDraftNow]);

  // Combine online cloud photos and local photos (cloud takes priority on matching IDs)
  const combinedStoredPhotos = useMemo(() => {
    const map = new Map<string, StoredPhotoRecord>();
    for (const p of localPhotos) map.set(p.id, p);
    for (const p of cloudPhotos) map.set(p.id, p);
    return Array.from(map.values()).sort((a, b) =>
      (b.capturedAt || '').localeCompare(a.capturedAt || '')
    );
  }, [localPhotos, cloudPhotos]);

  // Live metrics across all 67 items
  const metrics = useMemo(() => {
    let answered = 0;
    let yes = 0;
    let no = 0;
    let na = 0;
    let totalPhotos = 0;
    let missingNoDetails = 0;

    const bySection: Record<
      string,
      { total: number; answered: number; no: number; photos: number }
    > = {};

    for (const section of CHECKLIST_SECTIONS) {
      let sAnswered = 0;
      let sNo = 0;
      let sPhotos = 0;

      for (const item of section.items) {
        const resp = report.responses[item.number] ?? createEmptyResponse();
        if (resp.complied) {
          answered++;
          sAnswered++;
        }
        if (resp.complied === 'Yes') yes++;
        if (resp.complied === 'No') {
          no++;
          sNo++;
          if (!resp.deviation.trim() || !resp.correctiveAction.trim()) {
            missingNoDetails++;
          }
        }
        if (resp.complied === 'N/A') na++;
        totalPhotos += resp.photos.length;
        sPhotos += resp.photos.length;
      }

      bySection[section.code] = {
        total: section.items.length,
        answered: sAnswered,
        no: sNo,
        photos: sPhotos,
      };
    }

    const applicable = yes + no;
    const complianceRate =
      applicable > 0 ? Math.round((yes / applicable) * 100) : null;
    const percent = Math.round((answered / TOTAL_ITEMS_COUNT) * 100);
    return {
      answered,
      yes,
      no,
      na,
      unanswered: TOTAL_ITEMS_COUNT - answered,
      totalPhotos,
      missingNoDetails,
      percent,
      complianceRate,
      bySection,
    };
  }, [report.responses]);

  const indexedPhotos = useMemo(() => collectIndexedPhotos(report), [report]);

  const photoSyncCounts = useMemo(() => {
    let uploading = 0;
    let failed = 0;
    let localOnly = 0;
    for (const entry of indexedPhotos) {
      if (entry.photo.uploadState === 'uploading') uploading++;
      else if (entry.photo.uploadState === 'error') failed++;
      else if (entry.photo.uploadState === 'local') localOnly++;
    }
    return { uploading, failed, localOnly };
  }, [indexedPhotos]);

  const otherReportsPendingPhotoCount = useMemo(() => {
    let count = 0;
    for (const rep of localReports) {
      if (rep.id === report.id) continue;
      const sharedSummary = sharedReports.find((r) => r.id === rep.id);
      if (sharedSummary && sharedSummary.accessRole === 'viewer') continue;
      for (const resp of Object.values(rep.responses)) {
        for (const ph of resp.photos) {
          if (ph.uploadState === 'local' || ph.uploadState === 'error') {
            count++;
          }
        }
      }
    }
    return count;
  }, [localReports, report.id, sharedReports]);

  const totalUniqueStoredPhotos = useMemo(() => {
    const ids = new Set<string>(combinedStoredPhotos.map((p) => p.id));
    for (const p of indexedPhotos) {
      ids.add(p.photo.id);
    }
    return ids.size;
  }, [combinedStoredPhotos, indexedPhotos]);

  const mutateReport = (
    updater: (prev: InspectionReport) => InspectionReport,
    dirty?: {
      full?: boolean;
      meta?: boolean;
      itemNumber?: number;
      signOffKey?: SignOffRoleKey;
      photoId?: string;
    }
  ) => {
    if (activeCollaborationRef.current?.accessRole === 'viewer') {
      showToast('View-only shared report — click Duplicate to make your own editable copy');
      return;
    }
    if (!dirty || dirty.full) {
      dirtyFieldsRef.current.full = true;
    } else {
      if (dirty.meta) dirtyFieldsRef.current.meta = true;
      if (typeof dirty.itemNumber === 'number') {
        dirtyFieldsRef.current.items.add(dirty.itemNumber);
      }
      if (dirty.signOffKey) {
        dirtyFieldsRef.current.signOffKeys.add(dirty.signOffKey);
      }
      if (dirty.photoId) {
        dirtyFieldsRef.current.photoIds.add(dirty.photoId);
      }
    }
    editVersionRef.current += 1;
    setReport((prev) => updater(prev));
    setHasUnsavedCloudChanges(true);
  };

  // Combined index of all known reports (cloud + shared + local) for automatic per-branch numbering
  const allKnownReportRecords = useMemo<ReportSequenceRecord[]>(
    () => [
      ...cloudReports.map((r) => ({
        id: r.id,
        storeLocation: r.storeLocation,
        dateOfInspection: r.dateOfInspection,
        reportSequence: r.reportSequence,
        createdAt: r.createdAtIso,
        updatedAt: r.updatedAtIso,
      })),
      ...sharedReports.map((r) => ({
        id: r.id,
        storeLocation: r.storeLocation,
        dateOfInspection: r.dateOfInspection,
        reportSequence: r.reportSequence,
        createdAt: r.createdAtIso,
        updatedAt: r.updatedAtIso,
      })),
      ...localReports.map((r) => ({
        id: r.id,
        storeLocation: r.meta.storeLocation,
        dateOfInspection: r.meta.dateOfInspection,
        reportSequence: r.meta.reportSequence,
        updatedAt: r.updatedAt,
      })),
    ],
    [cloudReports, sharedReports, localReports]
  );

  const resolvedSequenceMap = useMemo(
    () => resolveReportSequenceMap(allKnownReportRecords),
    [allKnownReportRecords]
  );

  const withResolvedSequence = useCallback(
    (entry: InspectionReport): InspectionReport => {
      if (
        typeof entry.meta.reportSequence === 'number' &&
        Number.isFinite(entry.meta.reportSequence) &&
        entry.meta.reportSequence >= 1
      ) {
        return entry;
      }
      const resolved =
        resolvedSequenceMap.get(entry.id) ??
        computeNextBranchReportSequence(
          entry.meta.storeLocation,
          entry.meta.dateOfInspection,
          allKnownReportRecords,
          entry.id
        );
      return {
        ...entry,
        meta: {
          ...entry.meta,
          reportSequence: resolved,
        },
      };
    },
    [resolvedSequenceMap, allKnownReportRecords]
  );

  const updateMeta = <K extends keyof InspectionReport['meta']>(
    key: K,
    value: InspectionReport['meta'][K]
  ) => {
    mutateReport(
      (prev) => {
        const nextMeta: InspectionReport['meta'] = { ...prev.meta, [key]: value };
        if (
          key === 'dateOfInspection' &&
          typeof value === 'string' &&
          prev.meta.storeLocation.trim() &&
          getInspectionShortYear(value) !==
            getInspectionShortYear(prev.meta.dateOfInspection)
        ) {
          nextMeta.reportSequence = computeNextBranchReportSequence(
            prev.meta.storeLocation,
            value,
            allKnownReportRecords,
            prev.id
          );
        }
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          meta: nextMeta,
        };
      },
      { meta: true }
    );
  };

  const handleSelectBranch = (selectedValue: string) => {
    if (selectedValue === CUSTOM_BRANCH_OPTION) {
      setCustomBranchForReportId(report.id);
      if (isPresetBranch(report.meta.storeLocation)) {
        mutateReport(
          (prev) => ({
            ...prev,
            updatedAt: new Date().toISOString(),
            meta: {
              ...prev.meta,
              storeLocation: '',
              reportSequence: 1,
            },
          }),
          { meta: true }
        );
      }
      return;
    }

    setCustomBranchForReportId(null);
    mutateReport(
      (prev) => {
        const nextSeq = computeNextBranchReportSequence(
          selectedValue,
          prev.meta.dateOfInspection,
          allKnownReportRecords,
          prev.id
        );
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          meta: {
            ...prev.meta,
            storeLocation: selectedValue,
            reportSequence: nextSeq,
          },
        };
      },
      { meta: true }
    );
  };

  const handleCustomBranchChange = (customValue: string) => {
    mutateReport(
      (prev) => {
        const nextSeq = computeNextBranchReportSequence(
          customValue,
          prev.meta.dateOfInspection,
          allKnownReportRecords,
          prev.id
        );
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          meta: {
            ...prev.meta,
            storeLocation: customValue,
            reportSequence: nextSeq,
          },
        };
      },
      { meta: true }
    );
  };

  const updateItemResponse = (itemNumber: number, next: ItemResponse) => {
    mutateReport(
      (prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        responses: {
          ...prev.responses,
          [itemNumber]: next,
        },
      }),
      { itemNumber }
    );
  };

  const openCameraForItem = (itemNumber: number) => {
    const itemDef = ALL_CHECKLIST_ITEMS.find((it) => it.number === itemNumber);
    setCameraTarget({
      itemNumber,
      itemText: itemDef?.text ?? `Checklist Item #${itemNumber}`,
    });
  };

  const patchPhotoUploadFields = (
    itemNumber: number,
    photoId: string,
    patch: Partial<PhotoProof>,
    expectedReportIds?: string[],
    nextReportId?: string
  ) => {
    const applyPatch = (prev: InspectionReport): InspectionReport => {
      if (
        expectedReportIds &&
        expectedReportIds.length > 0 &&
        !expectedReportIds.includes(prev.id)
      ) {
        return prev;
      }
      const current = prev.responses[itemNumber];
      if (!current) return prev;
      const targetId = patch.id ?? photoId;
      let matched = false;
      const nextPhotos = current.photos.map((p) => {
        if (p.id === photoId || p.id === targetId) {
          matched = true;
          return { ...p, ...patch };
        }
        return p;
      });
      if (!matched) return prev;
      return {
        ...prev,
        id: nextReportId ?? prev.id,
        responses: {
          ...prev.responses,
          [itemNumber]: {
            ...current,
            photos: nextPhotos,
          },
        },
      };
    };

    // Keep reportRef synchronously up to date so immediate retries never read stale error state
    reportRef.current = applyPatch(reportRef.current);
    setReport((prev) => applyPatch(prev));
  };

  const uploadSinglePhotoTask = async (
    activeUser: User | null,
    snapshotReport: InspectionReport,
    itemNumber: number,
    photo: PhotoProof
  ): Promise<boolean> => {
    const activeUid = activeUser?.uid || effectiveUidRef.current;
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS_MS = [700, 1800];
    const runToken = (uploadRunTokensRef.current.get(photo.id) ?? 0) + 1;
    uploadRunTokensRef.current.set(photo.id, runToken);

    const isStaleRun = () =>
      uploadRunTokensRef.current.get(photo.id) !== runToken;

    const payloadBytes = photo.dataUrl ? photo.dataUrl.length : 0;
    const attemptLogs: PhotoUploadAttemptLog[] = [];
    let lastErr: unknown = null;

    // Guarantee uploadState cleanly resets to 'uploading' and clears previous error fields
    // at the start of every initial upload and retry attempt.
    patchPhotoUploadFields(
      itemNumber,
      photo.id,
      {
        uploadState: 'uploading',
        uploadError: undefined,
        uploadErrorCode: undefined,
      },
      [snapshotReport.id]
    );
    setUploadDiagnostics((prev) =>
      prev.map((d) =>
        d.photoId === photo.id ? { ...d, retrying: true } : d
      )
    );

    console.info('[PhotoUpload] Starting upload task', {
      runToken,
      photoId: photo.id,
      itemNumber,
      reportId: snapshotReport.id,
      fileName: photo.fileName,
      payloadBytes,
      uid: activeUid,
      emailVerified: activeUser?.emailVerified ?? null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (isStaleRun()) {
        console.info('[PhotoUpload] Superseded by newer retry run; exiting', {
          runToken,
          photoId: photo.id,
        });
        return false;
      }

      if (attempt > 0) {
        // Re-assert clean uploading state on each automatic retry attempt
        patchPhotoUploadFields(
          itemNumber,
          photo.id,
          {
            uploadState: 'uploading',
            uploadError: undefined,
            uploadErrorCode: undefined,
          },
          [snapshotReport.id]
        );
        console.info('[PhotoUpload] Retrying photo upload automatically', {
          runToken,
          photoId: photo.id,
          itemNumber,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
        });
      }

      const attemptStart =
        typeof performance !== 'undefined' ? performance.now() : Date.now();

      try {
        const result = await uploadSinglePhotoImmediatelyOnline(
          activeUid,
          reportRef.current.id === snapshotReport.id
            ? reportRef.current
            : snapshotReport,
          itemNumber,
          photo,
          {
            reportOwnerId: activeCollaborationRef.current?.ownerId || activeUid,
            actorName:
              activeUser?.displayName ||
              activeUser?.email ||
              snapshotReport.meta.inspectedBy ||
              'Inspector',
          }
        );

        if (isStaleRun()) {
          return true;
        }

        const durationMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
            attemptStart
        );
        console.info('[PhotoUpload] Upload succeeded', {
          runToken,
          photoId: result.photoId,
          reportId: result.reportId,
          itemNumber,
          attempt: attempt + 1,
          durationMs,
        });

        patchPhotoUploadFields(
          itemNumber,
          photo.id,
          {
            id: result.photoId,
            dataUrl: result.safeDataUrl,
            uploadState: 'synced',
            uploadError: undefined,
            uploadErrorCode: undefined,
          },
          [snapshotReport.id, result.reportId],
          result.reportId
        );

        setUploadDiagnostics((prev) => {
          const next = prev.filter(
            (d) => d.photoId !== photo.id && d.photoId !== result.photoId
          );
          if (next.length === 0) {
            setDiagnosticsOverlayOpen(false);
          }
          return next;
        });

        setCloudPhotos((prev) => {
          const filtered = prev.filter((p) => p.id !== result.storedRecord.id);
          return [result.storedRecord, ...filtered];
        });
        setLocalPhotos((prev) => {
          const exists = prev.some(
            (p) => p.id === photo.id || p.id === result.photoId
          );
          if (!exists) return [result.storedRecord, ...prev];
          return prev.map((p) =>
            p.id === photo.id || p.id === result.photoId
              ? { ...p, ...result.storedRecord }
              : p
          );
        });
        const latestReport = reportRef.current;
        void saveActiveDraftToDb(latestReport).catch(() => undefined);
        if (result.reportId !== snapshotReport.id) {
          void deleteSavedReportFromDb(snapshotReport.id).catch(() => undefined);
        }
        void saveReportSnapshotToDb(latestReport)
          .then(() => {
            setLocalReports((prev) => {
              const filtered = prev.filter(
                (r) => r.id !== latestReport.id && r.id !== snapshotReport.id
              );
              return [latestReport, ...filtered];
            });
          })
          .catch(() => undefined);
        const syncedIso = new Date().toISOString();
        setLastSyncedAt(syncedIso);
        persistActiveSyncState({
          reportId: latestReport.id,
          lastSyncedAt: syncedIso,
        });
        return true;
      } catch (err) {
        lastErr = err;
        const durationMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
            attemptStart
        );
        const extracted = extractFirebaseErrorDetails(err);
        attemptLogs.push({
          attempt: attempt + 1,
          timestamp: new Date().toISOString(),
          durationMs,
          errorCode: extracted.code,
          message: extracted.rawMessage,
        });

        console.warn('[PhotoUpload] Attempt failed', {
          runToken,
          photoId: photo.id,
          itemNumber,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          durationMs,
          errorCode: extracted.code,
          operationType: extracted.operationType,
          path: extracted.path,
          retryable: extracted.retryable,
          rawMessage: extracted.rawMessage,
        });

        if (!extracted.retryable || attempt >= MAX_ATTEMPTS - 1) {
          break;
        }
        const delayMs = RETRY_DELAYS_MS[attempt] ?? 1500;
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }

    if (isStaleRun()) {
      return false;
    }

    const finalDetails = extractFirebaseErrorDetails(lastErr);
    const diagnosticEntry: PhotoUploadDiagnostic = {
      id: `${photo.id}-${Date.now()}`,
      photoId: photo.id,
      reportId: snapshotReport.id,
      itemNumber,
      fileName: photo.fileName || `item-${itemNumber}.jpg`,
      timestamp: new Date().toISOString(),
      errorCode: finalDetails.code,
      friendlySummary: finalDetails.friendlySummary,
      guidance: finalDetails.guidance,
      rawMessage: finalDetails.rawMessage,
      operationType: finalDetails.operationType,
      path:
        finalDetails.path ||
        `reports/${sanitizeId(snapshotReport.id, 'insp')}/photos/${sanitizeId(photo.id, 'ph')}`,
      payloadBytes,
      attempts: attemptLogs.length,
      attemptLogs,
      authState: {
        signedIn: Boolean(activeUser),
        uid: activeUid,
        email: activeUser?.email ?? null,
        emailVerified: activeUser?.emailVerified ?? null,
      },
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      retrying: false,
    };

    console.groupCollapsed(
      `[PhotoUpload] FAILED (${finalDetails.code}) · Item #${itemNumber} · ${photo.id}`
    );
    console.error('Diagnostic summary:', diagnosticEntry);
    console.error('Last raw error:', lastErr);
    console.groupEnd();

    if (
      finalDetails.code === 'resource-exhausted' ||
      finalDetails.code === 'storage/quota-exceeded'
    ) {
      setStorageWarning(
        `Firebase quota exceeded (${finalDetails.code}). Photo remains saved locally on this device.`
      );
    }

    const isOfflineFailure =
      typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOfflineFailure) {
      patchPhotoUploadFields(
        itemNumber,
        photo.id,
        {
          uploadState: 'local',
          uploadError: undefined,
          uploadErrorCode: undefined,
        },
        [snapshotReport.id]
      );
      void saveActiveDraftToDb(reportRef.current).catch(() => undefined);
      void saveReportSnapshotToDb(reportRef.current).catch(() => undefined);
      return false;
    }

    patchPhotoUploadFields(
      itemNumber,
      photo.id,
      {
        uploadState: 'error',
        uploadError: finalDetails.friendlySummary,
        uploadErrorCode: finalDetails.code,
      },
      [snapshotReport.id]
    );
    void saveActiveDraftToDb(reportRef.current).catch(() => undefined);
    void saveReportSnapshotToDb(reportRef.current).catch(() => undefined);

    setUploadDiagnostics((prev) => [
      diagnosticEntry,
      ...prev.filter((d) => d.photoId !== photo.id),
    ]);
    setDiagnosticsOverlayOpen(true);

    return false;
  };

  const attachPhotosToItem = (itemNumber: number, newPhotos: PhotoProof[]) => {
    if (newPhotos.length === 0) return;
    if (activeCollaborationRef.current?.accessRole === 'viewer') {
      showToast('View-only shared report — duplicate to attach photos');
      return;
    }

    const activeUser = user;
    const isOnlineNow =
      typeof navigator === 'undefined' ? true : navigator.onLine;
    const shouldUploadNow = isOnlineNow;

    const preparedPhotos: PhotoProof[] = newPhotos.map((ph) => ({
      ...ph,
      id: sanitizeId(ph.id, 'ph'),
      uploadState: shouldUploadNow ? 'uploading' : 'local',
      uploadError: undefined,
      uploadErrorCode: undefined,
    }));

    const prevReport = reportRef.current;
    const current = prevReport.responses[itemNumber] ?? createEmptyResponse();
    const nextReport: InspectionReport = {
      ...prevReport,
      id: sanitizeId(prevReport.id, 'insp'),
      updatedAt: new Date().toISOString(),
      responses: {
        ...prevReport.responses,
        [itemNumber]: {
          ...current,
          photos: [...current.photos, ...preparedPhotos],
        },
      },
    };

    reportRef.current = nextReport;
    setReport(nextReport);

    // Immediately auto-save BOTH active draft AND local report snapshot + photo vault in IndexedDB
    void Promise.all([
      saveActiveDraftToDb(nextReport),
      saveReportSnapshotToDb(nextReport),
    ])
      .then(() => {
        setLocalReports((prev) => {
          const filtered = prev.filter((r) => r.id !== nextReport.id);
          return [nextReport, ...filtered];
        });
        return loadAllStoredPhotosFromDb();
      })
      .then((allPhotos) => setLocalPhotos(allPhotos))
      .catch((err) => {
        if (isLocalStorageQuotaError(err)) {
          setStorageWarning(
            'Device storage is nearly full — consider clearing old local snapshots.'
          );
        }
      });

    if (shouldUploadNow) {
      showToast(
        `Auto-saving & syncing ${preparedPhotos.length} ${preparedPhotos.length === 1 ? 'photo' : 'photos'} (${hdUploadsEnabled ? 'HD' : 'Std'})…`
      );
      void (async () => {
        let succeeded = 0;
        let failed = 0;
        for (const photo of preparedPhotos) {
          const ok = await uploadSinglePhotoTask(
            activeUser,
            reportRef.current,
            itemNumber,
            photo
          );
          if (ok) succeeded++;
          else failed++;
        }
        if (failed === 0 && succeeded > 0) {
          showToast(
            `${succeeded} ${succeeded === 1 ? 'photo' : 'photos'} auto-saved & synced to cloud`
          );
        } else if (failed > 0) {
          setHasUnsavedCloudChanges(true);
          if (typeof navigator === 'undefined' || navigator.onLine) {
            void backgroundSyncServiceRef.current?.triggerSync('scheduled');
            showToast(
              `${failed} ${failed === 1 ? 'photo' : 'photos'} saved locally — retrying cloud sync automatically`
            );
          } else {
            showToast(
              `${failed} ${failed === 1 ? 'photo' : 'photos'} saved locally — will auto-sync when online`
            );
          }
        }
      })();
    } else {
      setHasUnsavedCloudChanges(true);
      persistActiveSyncState({
        reportId: nextReport.id,
        hasUnsavedCloudChanges: true,
      });
      showToast(
        `Saved ${preparedPhotos.length} ${preparedPhotos.length === 1 ? 'photo' : 'photos'} locally — will auto-sync to cloud when online`
      );
    }
  };

  const retryPhotoUpload = (itemNumber: number, photoId: string) => {
    const current = reportRef.current.responses[itemNumber];
    const target = current?.photos.find((p) => p.id === photoId);
    if (!target) {
      console.warn('[PhotoUpload] Retry skipped — photo no longer in active report', {
        itemNumber,
        photoId,
      });
      setUploadDiagnostics((prev) => prev.filter((d) => d.photoId !== photoId));
      return;
    }

    console.info('[PhotoUpload] Manual retry requested', {
      itemNumber,
      photoId,
      previousState: target.uploadState,
      previousErrorCode: target.uploadErrorCode ?? null,
    });

    const cleanTarget: PhotoProof = {
      ...target,
      uploadState: 'uploading',
      uploadError: undefined,
      uploadErrorCode: undefined,
    };

    // Reset state synchronously on both ref and React state before starting task
    patchPhotoUploadFields(itemNumber, photoId, {
      uploadState: 'uploading',
      uploadError: undefined,
      uploadErrorCode: undefined,
    });

    void uploadSinglePhotoTask(
      user,
      reportRef.current,
      itemNumber,
      cleanTarget
    ).then((ok) => {
      if (ok) {
        showToast('Photo uploaded & saved online');
      } else {
        showToast('Retry failed — check diagnostic error code for details');
      }
    });
  };

  // Background sync service listening to navigator 'online' / 'offline', visibility events,
  // and periodic sweep checks to automatically sync any 'error' or 'local' photos
  // across BOTH the active draft AND saved local reports.
  useEffect(() => {
    const getPendingPhotos = (): BackgroundSyncPhotoItem[] => {
      const pending: BackgroundSyncPhotoItem[] = [];
      const seenKeys = new Set<string>();

      const activeRep = reportRef.current;
      if (activeCollaborationRef.current?.accessRole !== 'viewer') {
        for (const [numStr, resp] of Object.entries(activeRep.responses)) {
          const itemNumber = Number(numStr);
          for (const photo of resp.photos) {
            if (photo.uploadState === 'error' || photo.uploadState === 'local') {
              const key = `${activeRep.id}:${photo.id}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                pending.push({ reportId: activeRep.id, itemNumber, photo });
              }
            }
          }
        }
      }

      // Also collect unsynced photos from saved local snapshots so no photo is left behind
      for (const localRep of localReportsRef.current) {
        if (localRep.id === activeRep.id) continue;
        const sharedSummary = sharedReportsRef.current.find(
          (r) => r.id === localRep.id
        );
        if (sharedSummary && sharedSummary.accessRole === 'viewer') continue;

        for (const [numStr, resp] of Object.entries(localRep.responses)) {
          const itemNumber = Number(numStr);
          for (const photo of resp.photos) {
            if (photo.uploadState === 'error' || photo.uploadState === 'local') {
              const key = `${localRep.id}:${photo.id}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                pending.push({ reportId: localRep.id, itemNumber, photo });
              }
            }
          }
        }
      }

      return pending;
    };

    const service = new PhotoBackgroundSyncService({
      getPendingPhotos,
      canSync: () =>
        Boolean(effectiveUidRef.current) &&
        (typeof navigator === 'undefined' || navigator.onLine),
      uploadPhoto: async ({ reportId, itemNumber, photo }) => {
        const activeUser = userRef.current;
        const activeUid = activeUser?.uid || effectiveUidRef.current;
        if (!activeUid) return false;

        // Active draft photo -> reuse full upload task with live status badges
        if (reportId === reportRef.current.id) {
          const cleanPhoto: PhotoProof = {
            ...photo,
            uploadState: 'uploading',
            uploadError: undefined,
            uploadErrorCode: undefined,
          };
          return uploadSinglePhotoTask(
            activeUser,
            reportRef.current,
            itemNumber,
            cleanPhoto
          );
        }

        // Inactive saved local report photo -> upload directly & persist synced state back into IndexedDB
        const targetLocalReport = localReportsRef.current.find(
          (r) => r.id === reportId
        );
        if (!targetLocalReport) return false;

        const sharedMatch = sharedReportsRef.current.find(
          (r) => r.id === targetLocalReport.id
        );
        if (sharedMatch && sharedMatch.accessRole === 'viewer') return false;

        try {
          const result = await uploadSinglePhotoImmediatelyOnline(
            activeUid,
            targetLocalReport,
            itemNumber,
            photo,
            {
              reportOwnerId: sharedMatch?.ownerId || activeUid,
              actorName:
                activeUser?.displayName ||
                activeUser?.email ||
                targetLocalReport.meta.inspectedBy ||
                'Inspector',
            }
          );

          const currResp = targetLocalReport.responses[itemNumber];
          if (currResp) {
            const updatedSnap: InspectionReport = {
              ...targetLocalReport,
              id: result.reportId,
              responses: {
                ...targetLocalReport.responses,
                [itemNumber]: {
                  ...currResp,
                  photos: currResp.photos.map((p) =>
                    p.id === photo.id || p.id === result.photoId
                      ? {
                          ...p,
                          id: result.photoId,
                          dataUrl: result.safeDataUrl,
                          uploadState: 'synced' as const,
                          uploadError: undefined,
                          uploadErrorCode: undefined,
                        }
                      : p
                  ),
                },
              },
            };
            await saveReportSnapshotToDb(updatedSnap).catch(() => undefined);
            setLocalReports((prev) =>
              prev.map((r) => (r.id === targetLocalReport.id ? updatedSnap : r))
            );
          }

          setCloudPhotos((prev) => {
            const filtered = prev.filter((p) => p.id !== result.storedRecord.id);
            return [result.storedRecord, ...filtered];
          });
          setLocalPhotos((prev) => {
            const exists = prev.some(
              (p) => p.id === photo.id || p.id === result.photoId
            );
            if (!exists) return [result.storedRecord, ...prev];
            return prev.map((p) =>
              p.id === photo.id || p.id === result.photoId
                ? { ...p, ...result.storedRecord }
                : p
            );
          });
          setLastSyncedAt(new Date().toISOString());
          return true;
        } catch (err) {
          console.warn('[BackgroundSync] Saved report photo sync failed:', {
            reportId,
            photoId: photo.id,
            err,
          });
          return false;
        }
      },
      onStateChange: (nextState) => {
        setBackgroundSyncState(nextState);
      },
      onSweepComplete: ({ trigger, succeeded, failed }) => {
        if (succeeded > 0 && failed === 0) {
          showToast(
            trigger === 'online'
              ? `Back online — auto-synced ${succeeded} ${succeeded === 1 ? 'photo' : 'photos'}`
              : `${succeeded} ${succeeded === 1 ? 'photo' : 'photos'} auto-synced to cloud`
          );
        } else if (failed > 0 && trigger !== 'scheduled') {
          showToast(
            `${failed} ${failed === 1 ? 'photo' : 'photos'} still failed — see diagnostics panel`
          );
        }
      },
    });

    backgroundSyncServiceRef.current = service;
    service.start();

    return () => {
      service.stop();
      backgroundSyncServiceRef.current = null;
    };
  }, []);

  // Automatically trigger background sync on startup / sign-in when offline-cached
  // 'error' or 'local' photos exist on the active report or any saved local reports.
  useEffect(() => {
    if (!isHydrated || !authReady) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void backgroundSyncServiceRef.current?.triggerSync('signin');
  }, [isHydrated, authReady, effectiveUid]);

  const retryAllFailedPhotos = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('You are offline — background sync will run when back online');
      return;
    }
    void backgroundSyncServiceRef.current?.triggerSync('manual');
  };

  const updatePhotoCaption = (
    itemNumber: number,
    photoId: string,
    caption: string
  ) => {
    mutateReport(
      (prev) => {
        const current = prev.responses[itemNumber] ?? createEmptyResponse();
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          responses: {
            ...prev.responses,
            [itemNumber]: {
              ...current,
              photos: current.photos.map((p) =>
                p.id === photoId ? { ...p, caption } : p
              ),
            },
          },
        };
      },
      { photoId }
    );

    setLocalPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, caption } : p))
    );
    setCloudPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, caption } : p))
    );

    // If this photo is already synced online, debounce-sync its caption immediately
    const targetPhoto = reportRef.current.responses[itemNumber]?.photos.find(
      (p) => p.id === photoId
    );
    if (targetPhoto?.uploadState === 'synced') {
      const existingTimer = captionTimersRef.current.get(photoId);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timerId = window.setTimeout(() => {
        captionTimersRef.current.delete(photoId);
        void updatePhotoCaptionOnline(
          reportRef.current.id,
          photoId,
          caption
        )
          .then(() => {
            dirtyFieldsRef.current.photoIds.delete(photoId);
          })
          .catch(() => {
            // Keeps photoId in dirtyFieldsRef so autosave / reconnect flushes it cleanly
          });
      }, 650);
      captionTimersRef.current.set(photoId, timerId);
    }
  };

  const removePhotoFromItemAndStorage = async (
    itemNumber: number,
    photoId: string
  ) => {
    if (activeCollaborationRef.current?.accessRole === 'viewer') {
      showToast('View-only shared report — duplicate to modify photos');
      return;
    }
    const activeReportId = reportRef.current.id;
    uploadRunTokensRef.current.delete(photoId);
    setUploadDiagnostics((prev) => prev.filter((d) => d.photoId !== photoId));
    mutateReport(
      (prev) => {
        const current = prev.responses[itemNumber] ?? createEmptyResponse();
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          responses: {
            ...prev.responses,
            [itemNumber]: {
              ...current,
              photos: current.photos.filter((p) => p.id !== photoId),
            },
          },
        };
      },
      { itemNumber }
    );
    try {
      await deleteStoredPhotoFromDb(photoId);
      setLocalPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      // ignore
    }
    const localMatch = localReports.find((rep) => rep.id === activeReportId);
    if (localMatch) {
      const curr = localMatch.responses[itemNumber];
      if (curr && curr.photos.some((p) => p.id === photoId)) {
        const updatedSnap: InspectionReport = {
          ...localMatch,
          responses: {
            ...localMatch.responses,
            [itemNumber]: {
              ...curr,
              photos: curr.photos.filter((p) => p.id !== photoId),
            },
          },
        };
        await saveReportSnapshotToDb(updatedSnap).catch(() => undefined);
        setLocalReports((prev) =>
          prev.map((r) => (r.id === updatedSnap.id ? updatedSnap : r))
        );
      }
    }
    if (
      cloudReports.some((r) => r.id === activeReportId) ||
      sharedReports.some((r) => r.id === activeReportId) ||
      cloudPhotos.some((p) => p.id === photoId)
    ) {
      try {
        await deleteSinglePhotoOnline(effectiveUid, activeReportId, photoId);
        setCloudPhotos((prev) => prev.filter((p) => p.id !== photoId));
      } catch {
        // ignore if photo hadn't been synced yet
      }
    }
  };

  const deleteStoredPhotoRecord = async (record: StoredPhotoRecord) => {
    uploadRunTokensRef.current.delete(record.id);
    const captionTimer = captionTimersRef.current.get(record.id);
    if (captionTimer) {
      window.clearTimeout(captionTimer);
      captionTimersRef.current.delete(record.id);
    }
    setUploadDiagnostics((prev) => {
      const next = prev.filter((d) => d.photoId !== record.id);
      if (next.length === 0) setDiagnosticsOverlayOpen(false);
      return next;
    });
    mutateReport(
      (prev) => {
        const current = prev.responses[record.itemNumber];
        if (!current || !current.photos.some((p) => p.id === record.id)) {
          return prev;
        }
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          responses: {
            ...prev.responses,
            [record.itemNumber]: {
              ...current,
              photos: current.photos.filter((p) => p.id !== record.id),
            },
          },
        };
      },
      { itemNumber: record.itemNumber }
    );
    try {
      await deleteStoredPhotoFromDb(record.id);
      setLocalPhotos((prev) => prev.filter((p) => p.id !== record.id));
    } catch {
      // ignore
    }
    const affectedSnapshot = localReports.find((rep) =>
      rep.id === record.reportId &&
      rep.responses[record.itemNumber]?.photos.some((p) => p.id === record.id)
    );
    if (affectedSnapshot) {
      const curr = affectedSnapshot.responses[record.itemNumber];
      const updatedSnap: InspectionReport = {
        ...affectedSnapshot,
        responses: {
          ...affectedSnapshot.responses,
          [record.itemNumber]: {
            ...curr,
            photos: curr.photos.filter((p) => p.id !== record.id),
          },
        },
      };
      await saveReportSnapshotToDb(updatedSnap).catch(() => undefined);
      setLocalReports((prev) =>
        prev.map((r) => (r.id === updatedSnap.id ? updatedSnap : r))
      );
    }
    if (
      cloudReports.some((r) => r.id === record.reportId) ||
      sharedReports.some((r) => r.id === record.reportId) ||
      cloudPhotos.some((p) => p.id === record.id)
    ) {
      try {
        await deleteSinglePhotoOnline(effectiveUid, record.reportId, record.id);
        setCloudPhotos((prev) => prev.filter((p) => p.id !== record.id));
      } catch {
        // handled by cloudReports
      }
    }
    showToast('Photo removed');
  };

  const bulkDeleteStoredPhotos = async (records: StoredPhotoRecord[]) => {
    if (records.length === 0) return;

    const editableRecords = records.filter((rec) => {
      if (
        rec.reportId === reportRef.current.id &&
        activeCollaborationRef.current?.accessRole === 'viewer'
      ) {
        return false;
      }
      const sharedSummary = sharedReports.find((r) => r.id === rec.reportId);
      if (sharedSummary && sharedSummary.accessRole === 'viewer') {
        return false;
      }
      return true;
    });

    if (editableRecords.length === 0) {
      showToast('Selected photos belong to view-only shared reports');
      return;
    }

    const deleteIdSet = new Set(editableRecords.map((r) => r.id));

    for (const id of deleteIdSet) {
      uploadRunTokensRef.current.delete(id);
      const timer = captionTimersRef.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        captionTimersRef.current.delete(id);
      }
    }

    setUploadDiagnostics((prev) => {
      const next = prev.filter((d) => !deleteIdSet.has(d.photoId));
      if (next.length === 0) setDiagnosticsOverlayOpen(false);
      return next;
    });

    // Update active report if any selected photos belong to it
    const activeHasMatch = Object.values(reportRef.current.responses).some((r) =>
      r.photos.some((p) => deleteIdSet.has(p.id))
    );
    if (activeHasMatch) {
      mutateReport((prev) => {
        let changed = false;
        const nextResponses = { ...prev.responses };
        for (const [keyStr, resp] of Object.entries(prev.responses)) {
          const itemNum = Number(keyStr);
          const filtered = resp.photos.filter((p) => !deleteIdSet.has(p.id));
          if (filtered.length !== resp.photos.length) {
            changed = true;
            nextResponses[itemNum] = { ...resp, photos: filtered };
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          responses: nextResponses,
        };
      });
    }

    // Remove from local IndexedDB photo store & saved local report snapshots
    await Promise.allSettled(
      editableRecords.map((rec) => deleteStoredPhotoFromDb(rec.id))
    );
    setLocalPhotos((prev) => prev.filter((p) => !deleteIdSet.has(p.id)));

    const affectedLocalSnapshots = localReports.filter((rep) =>
      Object.values(rep.responses).some((r) =>
        r.photos.some((p) => deleteIdSet.has(p.id))
      )
    );
    if (affectedLocalSnapshots.length > 0) {
      const updatedSnapshots = affectedLocalSnapshots.map((rep) => {
        const nextResponses = { ...rep.responses };
        for (const [keyStr, resp] of Object.entries(rep.responses)) {
          const itemNum = Number(keyStr);
          const filtered = resp.photos.filter((p) => !deleteIdSet.has(p.id));
          if (filtered.length !== resp.photos.length) {
            nextResponses[itemNum] = { ...resp, photos: filtered };
          }
        }
        return { ...rep, responses: nextResponses };
      });
      await Promise.allSettled(
        updatedSnapshots.map((snap) => saveReportSnapshotToDb(snap))
      );
      const updatedById = new Map(updatedSnapshots.map((s) => [s.id, s]));
      setLocalReports((prev) => prev.map((r) => updatedById.get(r.id) ?? r));
    }

    // Remove synced photos from Firestore in one batched operation per report
    const cloudCandidates = editableRecords.filter(
      (rec) =>
        cloudReports.some((r) => r.id === rec.reportId) ||
        sharedReports.some((r) => r.id === rec.reportId) ||
        cloudPhotos.some((p) => p.id === rec.id)
    );
    if (cloudCandidates.length > 0) {
      const byReport = new Map<string, string[]>();
      for (const rec of cloudCandidates) {
        const list = byReport.get(rec.reportId) ?? [];
        list.push(rec.id);
        byReport.set(rec.reportId, list);
      }
      await Promise.allSettled(
        Array.from(byReport.entries()).map(([repId, ids]) =>
          deletePhotosBatchOnline(effectiveUid, repId, ids)
        )
      );
      setCloudPhotos((prev) => prev.filter((p) => !deleteIdSet.has(p.id)));
    }

    const skippedCount = records.length - editableRecords.length;
    showToast(
      skippedCount > 0
        ? `Removed ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'} (${skippedCount} view-only skipped)`
        : `Removed ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'}`
    );
  };

  const bulkRecaptionStoredPhotos = async (
    records: StoredPhotoRecord[],
    rawCaption: string
  ) => {
    if (records.length === 0) return;

    const editableRecords = records.filter((rec) => {
      if (
        rec.reportId === reportRef.current.id &&
        activeCollaborationRef.current?.accessRole === 'viewer'
      ) {
        return false;
      }
      const sharedSummary = sharedReports.find((r) => r.id === rec.reportId);
      if (sharedSummary && sharedSummary.accessRole === 'viewer') {
        return false;
      }
      return true;
    });

    if (editableRecords.length === 0) {
      showToast('Selected photos belong to view-only shared reports');
      return;
    }

    const nextCaption = rawCaption.trim().slice(0, 500);
    const targetIdSet = new Set(editableRecords.map((r) => r.id));

    for (const id of targetIdSet) {
      const timer = captionTimersRef.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        captionTimersRef.current.delete(id);
      }
    }

    // Update active report photos in one batch if matched
    const activeHasMatch = Object.values(reportRef.current.responses).some((r) =>
      r.photos.some((p) => targetIdSet.has(p.id))
    );
    if (activeHasMatch) {
      mutateReport((prev) => {
        let changed = false;
        const nextResponses = { ...prev.responses };
        for (const [keyStr, resp] of Object.entries(prev.responses)) {
          const itemNum = Number(keyStr);
          if (resp.photos.some((p) => targetIdSet.has(p.id))) {
            changed = true;
            nextResponses[itemNum] = {
              ...resp,
              photos: resp.photos.map((p) =>
                targetIdSet.has(p.id) ? { ...p, caption: nextCaption } : p
              ),
            };
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          responses: nextResponses,
        };
      });
    }

    // Update local IndexedDB photo records & local saved snapshots
    await Promise.allSettled(
      editableRecords.map((rec) =>
        upsertStoredPhotoInDb({ ...rec, caption: nextCaption })
      )
    );
    setLocalPhotos((prev) =>
      prev.map((p) =>
        targetIdSet.has(p.id) ? { ...p, caption: nextCaption } : p
      )
    );

    const affectedLocalSnapshots = localReports.filter((rep) =>
      Object.values(rep.responses).some((r) =>
        r.photos.some((p) => targetIdSet.has(p.id))
      )
    );
    if (affectedLocalSnapshots.length > 0) {
      const updatedSnapshots = affectedLocalSnapshots.map((rep) => {
        const nextResponses = { ...rep.responses };
        for (const [keyStr, resp] of Object.entries(rep.responses)) {
          const itemNum = Number(keyStr);
          if (resp.photos.some((p) => targetIdSet.has(p.id))) {
            nextResponses[itemNum] = {
              ...resp,
              photos: resp.photos.map((p) =>
                targetIdSet.has(p.id) ? { ...p, caption: nextCaption } : p
              ),
            };
          }
        }
        return { ...rep, responses: nextResponses };
      });
      await Promise.allSettled(
        updatedSnapshots.map((snap) => saveReportSnapshotToDb(snap))
      );
      const updatedById = new Map(updatedSnapshots.map((s) => [s.id, s]));
      setLocalReports((prev) => prev.map((r) => updatedById.get(r.id) ?? r));
    }

    // Update Firestore photo documents in one batch per report when online
    let cloudSyncFailed = 0;
    const cloudCandidates = editableRecords.filter(
      (rec) =>
        cloudPhotos.some((p) => p.id === rec.id) ||
        cloudReports.some((r) => r.id === rec.reportId) ||
        sharedReports.some((r) => r.id === rec.reportId)
    );
    if (cloudCandidates.length > 0) {
      const byReport = new Map<string, Array<{ photoId: string; caption: string }>>();
      for (const rec of cloudCandidates) {
        const list = byReport.get(rec.reportId) ?? [];
        list.push({ photoId: rec.id, caption: nextCaption });
        byReport.set(rec.reportId, list);
      }
      const results = await Promise.allSettled(
        Array.from(byReport.entries()).map(([repId, updates]) =>
          updatePhotosCaptionBatchOnline(repId, updates)
        )
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          const entries = Array.from(byReport.values())[i] ?? [];
          cloudSyncFailed += entries.length;
        }
      }
      setCloudPhotos((prev) =>
        prev.map((p) =>
          targetIdSet.has(p.id) ? { ...p, caption: nextCaption } : p
        )
      );
    }

    const skippedCount = records.length - editableRecords.length;
    if (cloudSyncFailed > 0) {
      showToast(
        `Updated captions locally for ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'} (${cloudSyncFailed} pending cloud sync)`
      );
    } else if (skippedCount > 0) {
      showToast(
        `Updated captions for ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'} (${skippedCount} view-only skipped)`
      );
    } else {
      showToast(
        nextCaption
          ? `Updated caption for ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'}`
          : `Cleared caption for ${editableRecords.length} ${editableRecords.length === 1 ? 'photo' : 'photos'}`
      );
    }
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const cred = await signInWithGoogle();
      setStorageWarning(null);
      setAuthError(null);
      showToast('Signed in with Google — online cloud storage enabled');
      if (cred.user) {
        userRef.current = cred.user;
        void backgroundSyncServiceRef.current?.triggerSync('signin');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('unauthorized-domain')) {
        const domainMsg = `Sign-in blocked on "${window.location.hostname}". Add this domain to Firebase Console → Authentication → Settings → Authorized domains.`;
        setStorageWarning(domainMsg);
        setAuthError(domainMsg);
      } else if (msg.includes('popup-blocked')) {
        const popupMsg =
          'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
        setAuthError(popupMsg);
        showToast(popupMsg);
      } else if (!msg.includes('popup-closed-by-user')) {
        const fallbackMsg =
          'Google sign-in could not be completed. Please allow popups and try again.';
        setAuthError(fallbackMsg);
        showToast(fallbackMsg);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    backgroundSyncServiceRef.current?.resetBackoff();
    clearCloudReportCache();
    setAuthError(null);
    await signOutUser();
    showToast('Signed out');
  };

  // Save current report (online to Firestore if signed in & online, plus local IndexedDB snapshot)
  const handleSaveCurrentReport = async () => {
    if (isReadOnlyViewer) {
      showToast('View-only shared report — click Duplicate to save your own copy');
      return;
    }
    if (cloudAutosaveTimerRef.current) {
      window.clearTimeout(cloudAutosaveTimerRef.current);
      cloudAutosaveTimerRef.current = null;
    }
    if (autosaveRetryTimerRef.current) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }
    // Clear any pending debounced caption timers since full save writes all captions
    for (const timerId of captionTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    captionTimersRef.current.clear();

    setIsSavingOnline(true);
    setStorageWarning(null);
    const isOnlineNow =
      typeof navigator === 'undefined' ? true : navigator.onLine;

    try {
      const baseReport = withResolvedSequence({
        ...reportRef.current,
        updatedAt: new Date().toISOString(),
      });

      // When offline, normalize any in-flight 'uploading' photos to 'local' so background sync picks them up cleanly
      const snapshot: InspectionReport = isOnlineNow
        ? baseReport
        : {
            ...baseReport,
            responses: Object.fromEntries(
              Object.entries(baseReport.responses).map(([k, resp]) => [
                Number(k),
                {
                  ...resp,
                  photos: resp.photos.map((ph) =>
                    ph.uploadState === 'uploading'
                      ? {
                          ...ph,
                          uploadState: 'local' as const,
                          uploadError: undefined,
                          uploadErrorCode: undefined,
                        }
                      : ph
                  ),
                },
              ])
            ),
          };

      try {
        await saveReportSnapshotToDb(snapshot);
        await saveActiveDraftToDb(snapshot);
        setLocalReports((prev) => {
          const filtered = prev.filter((r) => r.id !== snapshot.id);
          return [snapshot, ...filtered];
        });
        const refreshedLocal = await loadAllStoredPhotosFromDb();
        setLocalPhotos(refreshedLocal);
      } catch (localErr) {
        if (isLocalStorageQuotaError(localErr)) {
          setStorageWarning(
            'Device storage is full — saving online, consider clearing old local snapshots.'
          );
        }
      }

      if (!isOnlineNow) {
        setReport(snapshot);
        setHasUnsavedCloudChanges(true);
        persistActiveSyncState({
          reportId: snapshot.id,
          hasUnsavedCloudChanges: true,
        });
        showToast(
          'Saved locally offline — report & photos will auto-sync when online'
        );
        return;
      }

      const collab = activeCollaborationRef.current;
      const actorName =
        user?.displayName ||
        user?.email ||
        snapshot.meta.inspectedBy ||
        'Inspector';
      const nextSyncVersion = (collab?.syncVersion ?? 0) + 1;
      const {
        report: savedOnline,
        syncVersion,
        failedPhotoCount,
      } = await saveReportOnline(effectiveUid, snapshot, {
        actorName,
        reportOwnerId: collab?.ownerId || effectiveUid,
        nextSyncVersion,
      });

      // Persist updated 'synced' photo states & normalized signatures back into IndexedDB
      const idbOps: Array<Promise<unknown>> = [
        saveReportSnapshotToDb(savedOnline),
        saveActiveDraftToDb(savedOnline),
      ];
      if (savedOnline.id !== snapshot.id) {
        idbOps.push(deleteSavedReportFromDb(snapshot.id));
      }
      await Promise.allSettled(idbOps);
      const refreshedLocalPhotos = await loadAllStoredPhotosFromDb();
      setLocalPhotos(refreshedLocalPhotos);
      setLocalReports((prev) => {
        const filtered = prev.filter(
          (r) => r.id !== savedOnline.id && r.id !== snapshot.id
        );
        return [savedOnline, ...filtered];
      });

      const syncedIso = new Date().toISOString();
      setReport(savedOnline);
      setLastCloudSaveError(null);
      setHasUnsavedCloudChanges(failedPhotoCount > 0);
      setRemoteUpdateNotice(null);
      resetDirtyTracker();
      setLastSyncedAt(syncedIso);
      persistActiveSyncState({
        reportId: savedOnline.id,
        hasUnsavedCloudChanges: failedPhotoCount > 0,
        lastSyncedAt: syncedIso,
      });
      setActiveCollaboration((prev) =>
        prev
          ? {
              ...prev,
              syncVersion,
              lastEditedByUid: effectiveUid,
              lastEditedByName: actorName,
            }
          : prev
      );
      // Clear diagnostic entries for any photos that successfully synced during full save
      const syncedPhotoIds = new Set<string>();
      for (const resp of Object.values(savedOnline.responses)) {
        for (const ph of resp.photos) {
          if (ph.uploadState === 'synced') {
            syncedPhotoIds.add(ph.id);
          }
        }
      }
      if (syncedPhotoIds.size > 0) {
        setUploadDiagnostics((prev) => {
          const next = prev.filter((d) => !syncedPhotoIds.has(d.photoId));
          if (next.length === 0) setDiagnosticsOverlayOpen(false);
          return next;
        });
      }

      // Immediately update cloudPhotos in memory from savedOnline (zero extra network downloads)
      const savedPhotoRecords = extractPhotoRecordsFromReport(savedOnline).filter(
        (rec) => syncedPhotoIds.has(rec.id)
      );
      fetchedPhotoCountsRef.current.set(savedOnline.id, savedPhotoRecords.length);
      setCloudPhotos((prev) => {
        const kept = prev.filter(
          (p) => p.reportId !== savedOnline.id && p.reportId !== snapshot.id
        );
        const merged = [...savedPhotoRecords, ...kept];
        merged.sort((a, b) =>
          (b.capturedAt || '').localeCompare(a.capturedAt || '')
        );
        return merged;
      });

      // Also sweep any queued photos remaining on other saved local reports
      if (otherReportsPendingPhotoCount > 0 || failedPhotoCount > 0) {
        void backgroundSyncServiceRef.current?.triggerSync('scheduled');
      }

      if (failedPhotoCount > 0) {
        showToast(
          `Report saved online, ${failedPhotoCount} ${
            failedPhotoCount === 1 ? 'photo' : 'photos'
          } retrying automatically`
        );
      } else {
        showToast('Report and all photo proofs saved online');
      }
    } catch (err) {
      const details = extractFirebaseErrorDetails(err);
      console.error('[SaveOnline] Failed to save report online:', {
        code: details.code,
        summary: details.friendlySummary,
        path: details.path,
        rawMessage: details.rawMessage,
      });
      setLastCloudSaveError({
        code: details.code,
        summary: details.friendlySummary,
        detail: details.rawMessage,
        at: new Date().toISOString(),
      });
      if (
        details.code === 'resource-exhausted' ||
        details.code === 'storage/quota-exceeded' ||
        details.rawMessage.includes('Quota exceeded')
      ) {
        setStorageWarning(
          'Daily Firestore free tier quota exceeded. Quota resets tomorrow; your work remains saved locally.'
        );
      } else {
        showToast(
          `Saved locally — cloud sync failed (${details.friendlySummary})`
        );
      }
    } finally {
      setIsSavingOnline(false);
    }
  };

  const handleShareCurrentReport = async () => {
    if (!user) {
      showToast('Sign in with Google to share reports online');
      return;
    }
    if (activeCollaboration && activeCollaboration.accessRole !== 'owner') {
      showToast('Only the report owner can manage sharing permissions');
      return;
    }
    // Ensure report exists online before opening Share dialog
    const existing = cloudReports.find((r) => r.id === report.id);
    if (!existing) {
      setIsSavingOnline(true);
      try {
        const actorName =
          user.displayName || user.email || report.meta.inspectedBy || 'Inspector';
        const { report: savedOnline } = await saveReportOnline(user.uid, report, {
          actorName,
          reportOwnerId: user.uid,
          nextSyncVersion: 1,
        });
        setReport(savedOnline);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(new Date().toISOString());
        resetDirtyTracker();
        setShareModalReportId(savedOnline.id);
      } catch {
        showToast('Save the report online before sharing');
      } finally {
        setIsSavingOnline(false);
      }
      return;
    }
    setShareModalReportId(existing.id);
  };

  const handleDuplicateCloudReport = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      const actorName =
        user?.displayName || user?.email || loaded.report.meta.inspectedBy || 'Inspector';
      const nextReportSequence = computeNextBranchReportSequence(
        loaded.report.meta.storeLocation,
        loaded.report.meta.dateOfInspection,
        allKnownReportRecords
      );
      const duplicated = await duplicateReportOnline(
        effectiveUid,
        actorName,
        loaded.report,
        { nextReportSequence }
      );
      setCustomBranchForReportId(null);
      setReport(duplicated);
      setActiveCollaboration(null);
      setHasUnsavedCloudChanges(false);
      setLastSyncedAt(duplicated.updatedAt || new Date().toISOString());
      setRemoteUpdateNotice(null);
      resetDirtyTracker();
      setViewMode('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Duplicated into your online reports');
    } catch {
      showToast('Could not duplicate report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDuplicateCurrentReport = async () => {
    setIsSavingOnline(true);
    try {
      const actorName =
        user?.displayName || user?.email || report.meta.inspectedBy || 'Inspector';
      const nextReportSequence = computeNextBranchReportSequence(
        report.meta.storeLocation,
        report.meta.dateOfInspection,
        allKnownReportRecords
      );
      const duplicated = await duplicateReportOnline(
        effectiveUid,
        actorName,
        report,
        {
          nextReportSequence,
        }
      );
      setCustomBranchForReportId(null);
      setReport(duplicated);
      setActiveCollaboration(null);
      setHasUnsavedCloudChanges(false);
      setLastSyncedAt(duplicated.updatedAt || new Date().toISOString());
      setRemoteUpdateNotice(null);
      resetDirtyTracker();
      setViewMode('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Created an editable copy in your online reports');
    } catch {
      showToast('Could not duplicate report');
    } finally {
      setIsSavingOnline(false);
    }
  };

  const handleLeaveSharedReport = async (reportId: string) => {
    if (!user?.email) return;
    setBusyReportId(reportId);
    try {
      await leaveSharedReportOnline(user.email, reportId);
      if (report.id === reportId) {
        setReport(createBlankInspection());
        setActiveCollaboration(null);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(null);
        setRemoteUpdateNotice(null);
        resetDirtyTracker();
      }
      showToast('Removed from Shared With Me');
    } catch {
      showToast('Could not leave shared report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handlePullLatestRemoteReport = async () => {
    setBusyReportId(report.id);
    try {
      const fresh = await loadReportWithPhotosOnline(
        effectiveUid,
        report.id,
        user?.email
      );
      if (fresh) {
        setReport(fresh.report);
        setActiveCollaboration(fresh.collaboration);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(fresh.report.updatedAt || new Date().toISOString());
        setRemoteUpdateNotice(null);
        resetDirtyTracker();
        showToast('Pulled latest version from cloud');
      }
    } catch {
      showToast('Could not refresh latest version');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleUploadLocalReportToCloud = async (entry: InspectionReport) => {
    setBusyReportId(entry.id);
    try {
      const actorName =
        user?.displayName || user?.email || entry.meta.inspectedBy || 'Inspector';
      const { report: savedOnline, failedPhotoCount } = await saveReportOnline(
        effectiveUid,
        withResolvedSequence(entry),
        {
          actorName,
          reportOwnerId: effectiveUid,
          nextSyncVersion: 1,
        }
      );
      await saveReportSnapshotToDb(savedOnline).catch(() => undefined);
      setLocalReports((prev) => {
        const filtered = prev.filter((r) => r.id !== savedOnline.id);
        return [savedOnline, ...filtered];
      });
      if (reportRef.current.id === savedOnline.id) {
        const syncedIso = new Date().toISOString();
        setReport(savedOnline);
        setHasUnsavedCloudChanges(failedPhotoCount > 0);
        setLastSyncedAt(syncedIso);
        resetDirtyTracker();
        persistActiveSyncState({
          reportId: savedOnline.id,
          hasUnsavedCloudChanges: failedPhotoCount > 0,
          lastSyncedAt: syncedIso,
        });
      }
      showToast(
        failedPhotoCount > 0
          ? `Report synced online (${failedPhotoCount} ${
              failedPhotoCount === 1 ? 'photo' : 'photos'
            } failed)`
          : 'Local report and photos synced online'
      );
    } catch {
      showToast('Could not sync report online');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleEditCloudReport = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setCustomBranchForReportId(null);
      setReport(withResolvedSequence(loaded.report));
      setActiveCollaboration(loaded.collaboration);
      setHasUnsavedCloudChanges(false);
      setLastSyncedAt(loaded.report.updatedAt || new Date().toISOString());
      setRemoteUpdateNotice(null);
      resetDirtyTracker();
      setActiveSectionCode('ALL');
      setFilterMode('all');
      setSearchQuery('');
      setViewMode('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(
        loaded.collaboration.accessRole === 'viewer'
          ? 'Opened shared report (View Only)'
          : 'Loaded online report for editing'
      );
    } catch {
      showToast('Could not load report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handlePreviewCloudReport = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setCustomBranchForReportId(null);
      setReport(withResolvedSequence(loaded.report));
      setActiveCollaboration(loaded.collaboration);
      setHasUnsavedCloudChanges(false);
      setLastSyncedAt(loaded.report.updatedAt || new Date().toISOString());
      setRemoteUpdateNotice(null);
      resetDirtyTracker();
      setViewMode('report');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      showToast('Could not load report preview');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownloadCloudReportPdf = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      await exportInspectionToPdf(withResolvedSequence(loaded.report), exportOptions);
      showToast('PDF report downloaded');
    } catch {
      showToast('Could not download report PDF');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownloadCloudReportExcel = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      await exportInspectionToExcel(withResolvedSequence(loaded.report));
      showToast('Excel (.xlsx) report downloaded');
    } catch {
      showToast('Could not download Excel report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownloadCloudReportDocx = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      await exportInspectionToDocx(
        withResolvedSequence(loaded.report),
        exportOptions
      );
      showToast('Word (.docx) report downloaded');
    } catch {
      showToast('Could not download Word (.docx) report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleEmailCloudReport = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(
        effectiveUid,
        reportId,
        user?.email
      );
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setEmailReportTarget(withResolvedSequence(loaded.report));
    } catch {
      showToast('Could not load report for emailing');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDeleteCloudReport = async (reportId: string) => {
    setBusyReportId(reportId);
    try {
      await deleteReportOnline(effectiveUid, reportId);
      await deleteSavedReportFromDb(reportId);
      fetchedPhotoCountsRef.current.delete(reportId);
      setLocalReports((prev) => prev.filter((r) => r.id !== reportId));
      setCloudPhotos((prev) => prev.filter((p) => p.reportId !== reportId));
      if (report.id === reportId) {
        setReport(createBlankInspection());
        setActiveCollaboration(null);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(null);
        setRemoteUpdateNotice(null);
        resetDirtyTracker();
      }
      showToast('Online report deleted');
    } catch {
      showToast('Could not delete online report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDeleteLocalReport = async (id: string) => {
    try {
      await deleteSavedReportFromDb(id);
      setLocalReports((prev) => prev.filter((r) => r.id !== id));
      if (
        report.id === id &&
        !cloudReports.some((r) => r.id === id) &&
        !sharedReports.some((r) => r.id === id)
      ) {
        setCustomBranchForReportId(null);
        setReport(createBlankInspection());
        setActiveCollaboration(null);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(null);
        setRemoteUpdateNotice(null);
        resetDirtyTracker();
      }
      showToast('Local snapshot removed');
    } catch {
      showToast('Could not delete snapshot');
    }
  };

  const handleDiscardCurrentDraft = () => {
    setCustomBranchForReportId(null);
    setReport(createBlankInspection());
    setActiveCollaboration(null);
    setHasUnsavedCloudChanges(false);
    setLastSyncedAt(null);
    setRemoteUpdateNotice(null);
    resetDirtyTracker();
    showToast('Unsaved draft removed');
  };

  const handleExportMergedPdf = async (items: MergedReportSelectionItem[]) => {
    if (items.length === 0 || isExportingMergedPdf) return;
    setIsExportingMergedPdf(true);
    setMergedPdfProgress({ current: 0, total: items.length });
    try {
      const resolvedReports: InspectionReport[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setMergedPdfProgress({ current: i + 1, total: items.length });

        if (
          item.id === report.id &&
          hasUnsavedCloudChanges &&
          activeCollaboration?.accessRole !== 'viewer'
        ) {
          resolvedReports.push(withResolvedSequence(report));
          continue;
        }

        if (item.source === 'local') {
          const localEntry = localReports.find((r) => r.id === item.id);
          if (localEntry) {
            resolvedReports.push(withResolvedSequence(localEntry));
          }
          continue;
        }

        const loaded = await loadReportWithPhotosOnline(
          effectiveUid,
          item.id,
          user?.email
        );
        if (loaded) {
          resolvedReports.push(withResolvedSequence(loaded.report));
          continue;
        }

        const fallbackLocal = localReports.find((r) => r.id === item.id);
        if (fallbackLocal) {
          resolvedReports.push(withResolvedSequence(fallbackLocal));
        }
      }

      if (resolvedReports.length === 0) {
        showToast('No selected reports could be loaded for export');
        return;
      }

      const result = await exportMergedReportsToPdf(
        resolvedReports,
        exportOptions,
        (current, total) => setMergedPdfProgress({ current, total })
      );
      showToast(
        `Exported merged PDF (${result.reportCount} ${
          result.reportCount === 1 ? 'report' : 'reports'
        }, ${result.pageCount} pages)`
      );
    } catch {
      showToast('Could not export merged PDF');
    } finally {
      setIsExportingMergedPdf(false);
      setMergedPdfProgress(null);
    }
  };

  const markSectionAllYes = (sectionCode: string) => {
    const section = CHECKLIST_SECTIONS.find((s) => s.code === sectionCode);
    if (!section) return;
    mutateReport((prev) => {
      const nextResponses = { ...prev.responses };
      for (const item of section.items) {
        const current = nextResponses[item.number] ?? createEmptyResponse();
        if (!current.complied) {
          nextResponses[item.number] = { ...current, complied: 'Yes' };
        }
      }
      const allAlreadyAnswered = section.items.every((it) =>
        Boolean(prev.responses[it.number]?.complied)
      );
      if (allAlreadyAnswered) {
        for (const item of section.items) {
          const current = nextResponses[item.number] ?? createEmptyResponse();
          nextResponses[item.number] = { ...current, complied: 'Yes' };
        }
      }
      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        responses: nextResponses,
      };
    });
    showToast(`Section ${sectionCode} marked Yes`);
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      await exportInspectionToPdf(report, exportOptions);
      showToast('PDF exported successfully');
    } catch {
      showToast('Could not generate PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    try {
      await exportInspectionToExcel(report);
      showToast('Excel (.xlsx) report exported');
    } catch {
      showToast('Could not generate Excel file. Please try again.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportDocx = async () => {
    setIsExportingDocx(true);
    try {
      await exportInspectionToDocx(report, exportOptions);
      showToast('Word (.docx) report saved');
    } catch {
      showToast('Could not generate Word (.docx) file. Please try again.');
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleDownloadBlankPdf = async () => {
    try {
      await exportBlankChecklistPdf();
      showToast('Blank checklist PDF (sheet only) downloaded');
    } catch {
      showToast('Could not generate blank checklist PDF.');
    }
  };

  const handleDownloadBlankExcel = async () => {
    try {
      await exportBlankChecklistExcel();
      showToast('Blank checklist Excel (.xlsx) downloaded');
    } catch {
      showToast('Could not generate blank checklist Excel file.');
    }
  };

  const handleDownloadBlankDocx = async () => {
    try {
      await exportBlankChecklistDocx();
      showToast('Blank checklist Word (.docx) downloaded');
    } catch {
      showToast('Could not generate blank checklist Word (.docx) file.');
    }
  };

  const handleCreateBlankForBranch = (branchName?: string) => {
    const fresh = createBlankInspection();
    const cleanedBranch = branchName?.trim() || '';
    if (user?.displayName) {
      fresh.meta.inspectedBy = user.displayName;
      fresh.signOffs.performedBy.printedName = user.displayName;
    }
    if (cleanedBranch) {
      fresh.meta.storeLocation = cleanedBranch;
      fresh.meta.reportSequence = computeNextBranchReportSequence(
        cleanedBranch,
        fresh.meta.dateOfInspection,
        allKnownReportRecords,
        fresh.id
      );
      setCustomBranchForReportId(isPresetBranch(cleanedBranch) ? null : fresh.id);
    } else {
      setCustomBranchForReportId(null);
    }
    setReport(fresh);
    setActiveCollaboration(null);
    setHasUnsavedCloudChanges(Boolean(cleanedBranch));
    setLastSyncedAt(null);
    setRemoteUpdateNotice(null);
    resetDirtyTracker();
    if (cleanedBranch) {
      dirtyFieldsRef.current.full = true;
    }
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
    setViewMode('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(
      cleanedBranch
        ? `Started new IQAF-005 audit for ${cleanedBranch}`
        : 'Created a new blank IQAF-005 report'
    );
  };

  const handleCreateBlank = () => {
    handleCreateBlankForBranch();
  };

  const handleLoadSample = () => {
    const sample = createSampleInspection();
    sample.meta.reportSequence = computeNextBranchReportSequence(
      sample.meta.storeLocation,
      sample.meta.dateOfInspection,
      allKnownReportRecords,
      sample.id
    );
    setCustomBranchForReportId(null);
    setReport(sample);
    setActiveCollaboration(null);
    setHasUnsavedCloudChanges(true);
    setLastSyncedAt(null);
    setRemoteUpdateNotice(null);
    resetDirtyTracker();
    dirtyFieldsRef.current.full = true;
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
    setViewMode('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Sample store inspection loaded');
  };

  const handleJumpToSection = (target: string) => {
    setViewMode('form');
    setMobileNavOpen(false);
    if (target === 'HEADER') {
      setActiveSectionCode('ALL');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (target === 'SIGNOFF') {
      setActiveSectionCode('ALL');
      setTimeout(() => {
        document
          .getElementById('section-signoff')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
      return;
    }
    if (target === 'ALL') {
      setActiveSectionCode('ALL');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setActiveSectionCode(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJumpToItem = (itemNumber: number) => {
    setViewMode('form');
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
    setMobileNavOpen(false);
    setTimeout(() => {
      document
        .getElementById(`item-${itemNumber}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  // Filter sections & items based on active section, status filter, and search query
  const visibleSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CHECKLIST_SECTIONS.filter(
      (s) => activeSectionCode === 'ALL' || s.code === activeSectionCode
    )
      .map((section) => {
        const matchingItems = section.items.filter((item) => {
          const resp = report.responses[item.number] ?? createEmptyResponse();

          if (filterMode === 'unanswered' && resp.complied !== '') return false;
          if (filterMode === 'Yes' && resp.complied !== 'Yes') return false;
          if (filterMode === 'No' && resp.complied !== 'No') return false;
          if (filterMode === 'N/A' && resp.complied !== 'N/A') return false;
          if (filterMode === 'photos' && resp.photos.length === 0) return false;

          if (q) {
            const haystack = `${item.number} ${section.code} ${section.title} ${item.text} ${resp.deviation} ${resp.correctiveAction}`.toLowerCase();
            if (!haystack.includes(q)) return false;
          }

          return true;
        });

        return { ...section, items: matchingItems };
      })
      .filter((section) => section.items.length > 0);
  }, [activeSectionCode, filterMode, searchQuery, report.responses]);

  // Resolve active photo for lightbox
  const activeLightboxInfo = useMemo(() => {
    if (!lightboxState) return null;
    if (lightboxState.kind === 'current') {
      const resp = report.responses[lightboxState.itemNumber];
      const photo = resp?.photos.find((p) => p.id === lightboxState.photoId);
      if (!photo) return null;
      return {
        photo,
        itemNumber: lightboxState.itemNumber,
        itemText: lightboxState.itemText,
        readOnlyCaption: false,
      };
    }

    const rec = lightboxState.record;
    const activeMatch = report.responses[rec.itemNumber]?.photos.find(
      (p) => p.id === rec.id
    );
    return {
      photo: activeMatch ?? {
        id: rec.id,
        dataUrl: rec.dataUrl,
        caption: rec.caption,
        capturedAt: rec.capturedAt,
        fileName: rec.fileName,
      },
      itemNumber: rec.itemNumber,
      itemText: rec.itemText,
      readOnlyCaption: !activeMatch,
      storedRecord: rec,
    };
  }, [lightboxState, report.responses]);

  const activeSectionIdx = CHECKLIST_SECTIONS.findIndex(
    (s) => s.code === activeSectionCode
  );
  const effectiveReportSequence =
    report.meta.reportSequence ?? resolvedSequenceMap.get(report.id) ?? 1;
  const currentReportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection,
    effectiveReportSequence
  );
  const normalizedStoreLocation = normalizeBranchName(report.meta.storeLocation);
  const isCustomBranchActive =
    customBranchForReportId === report.id ||
    (normalizedStoreLocation !== '' && !isPresetBranch(report.meta.storeLocation));
  const selectedBranchDropdownValue = isCustomBranchActive
    ? CUSTOM_BRANCH_OPTION
    : normalizedStoreLocation;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Cloud Account / Sync Panel */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
        {!authReady ? (
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Connecting…</span>
          </div>
        ) : user ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="truncate">
                    {user.displayName || user.email}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {cloudReports.length} online{' '}
                  {cloudReports.length === 1 ? 'report' : 'reports'} ·{' '}
                  {isAutoSaving || isSavingOnline ? (
                    <span className="text-amber-700 font-medium">
                      Auto-saving…
                    </span>
                  ) : hasUnsavedCloudChanges ? (
                    <span className="text-amber-700 font-medium">Unsaved</span>
                  ) : (
                    <span className="text-emerald-700 font-medium">
                      {autoSaveEnabled ? 'Auto-saved' : 'Synced'}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors shrink-0"
                title="Sign out of Google account"
                aria-label="Sign out of Google account"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleSaveCurrentReport}
                disabled={isSavingOnline}
                className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
              >
                {isSavingOnline ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Save Online
              </button>
              <button
                type="button"
                onClick={handleCreateBlank}
                className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
              >
                <FilePlus2 className="w-3 h-3" />
                New Report
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="truncate">Public Cloud Connected</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                {cloudReports.length} online{' '}
                {cloudReports.length === 1 ? 'report' : 'reports'} ·{' '}
                {isAutoSaving || isSavingOnline ? (
                  <span className="text-amber-700 font-medium">
                    Auto-saving…
                  </span>
                ) : hasUnsavedCloudChanges ? (
                  <span className="text-amber-700 font-medium">Unsaved</span>
                ) : (
                  <span className="text-emerald-700 font-medium">
                    {autoSaveEnabled ? 'Auto-saved' : 'Synced'}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleSaveCurrentReport}
                disabled={isSavingOnline}
                className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
              >
                {isSavingOnline ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Save Online
              </button>
              <button
                type="button"
                onClick={handleCreateBlank}
                className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
              >
                <FilePlus2 className="w-3 h-3" />
                New Report
              </button>
            </div>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="w-full inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-60 rounded-md transition-colors"
            >
              {isSigningIn ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <LogIn className="w-3 h-3" />
              )}
              Sign in with Google
            </button>
          </div>
        )}
      </div>

      {/* Progress summary */}
      <div className="px-4 py-3.5 border-b border-slate-200">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-slate-800">Audit Progress</span>
          <span className="font-mono font-semibold text-slate-900 tabular-nums">
            {metrics.answered}/{TOTAL_ITEMS_COUNT} ({metrics.percent}%)
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-red-700 transition-all duration-200"
            style={{ width: `${metrics.percent}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 font-mono tabular-nums">
          <span className="text-emerald-700 font-medium">{metrics.yes} Yes</span>
          <span aria-hidden="true">·</span>
          <span className={metrics.no > 0 ? 'text-red-700 font-semibold' : ''}>
            {metrics.no} No
          </span>
          <span aria-hidden="true">·</span>
          <span>{metrics.na} N/A</span>
          {metrics.complianceRate !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-900 font-semibold">
                {metrics.complianceRate}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* Navigation list */}
      <nav
        className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5"
        aria-label="Checklist sections"
      >
        <button
          type="button"
          onClick={() => {
            setViewMode('dashboard');
            setMobileNavOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'dashboard'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" />
            Branch Dashboard
          </span>
          <span className="font-mono tabular-nums text-[11px] opacity-85">
            Rankings
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('reports');
            setMobileNavOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'reports'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <FolderKanban className="w-3.5 h-3.5" />
            All Reports
          </span>
          <span className="font-mono tabular-nums text-[11px] opacity-85">
            {cloudReports.length + sharedReports.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleJumpToSection('ALL')}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'form' && activeSectionCode === 'ALL'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span>Checklist Form (A–Q)</span>
          <span className="font-mono tabular-nums opacity-80">{TOTAL_ITEMS_COUNT}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('summary');
            setMobileNavOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'summary'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            Inspection Summary
          </span>
          {metrics.complianceRate !== null && (
            <span className="font-mono tabular-nums text-[11px] opacity-85">
              {metrics.complianceRate}%
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('photos');
            setMobileNavOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'photos'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Images className="w-3.5 h-3.5" />
            Stored Photos
          </span>
          <span className="font-mono tabular-nums text-[11px] opacity-85">
            {totalUniqueStoredPhotos}
          </span>
        </button>

        <div className="pt-2 pb-1 px-2.5 text-[11px] font-semibold text-slate-400">
          Inspection Categories
        </div>

        {CHECKLIST_SECTIONS.map((section) => {
          const stat = metrics.bySection[section.code];
          const isActive =
            viewMode === 'form' && activeSectionCode === section.code;
          const isComplete = stat.total > 0 && stat.answered === stat.total;
          const completionPct =
            stat.total > 0 ? Math.round((stat.answered / stat.total) * 100) : 0;
          const ringRadius = 6;
          const ringCircumference = 2 * Math.PI * ringRadius;
          const ringDashOffset =
            ringCircumference - (completionPct / 100) * ringCircumference;
          const ringStrokeClass = isComplete
            ? stat.no > 0
              ? 'stroke-amber-600'
              : 'stroke-emerald-600'
            : completionPct > 0
              ? isActive
                ? 'stroke-red-700'
                : 'stroke-slate-700'
              : 'stroke-transparent';

          return (
            <button
              key={section.code}
              type="button"
              onClick={() => handleJumpToSection(section.code)}
              title={`${section.code}. ${section.title} — ${stat.answered}/${stat.total} completed (${completionPct}%)${stat.no > 0 ? `, ${stat.no} non-compliant` : ''}`}
              aria-label={`${section.code}. ${section.title}, ${completionPct}% complete (${stat.answered} of ${stat.total} items)`}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                isActive
                  ? 'bg-red-50 text-red-900 font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <svg
                  className="w-4 h-4 shrink-0 -rotate-90"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="2"
                    className={isActive ? 'stroke-red-200' : 'stroke-slate-200'}
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringDashOffset}
                    className={`transition-all duration-300 ${ringStrokeClass}`}
                  />
                </svg>
                <span className="truncate">
                  <span className="font-mono font-semibold mr-1">
                    {section.code}.
                  </span>
                  {section.title}
                </span>
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums shrink-0">
                {stat.no > 0 && (
                  <span className="text-red-700 font-semibold">{stat.no}!</span>
                )}
                <span
                  className={
                    isComplete
                      ? 'text-emerald-700 font-semibold'
                      : completionPct > 0
                        ? isActive
                          ? 'text-red-800 font-medium'
                          : 'text-slate-600 font-medium'
                        : 'text-slate-400'
                  }
                >
                  {completionPct}%
                </span>
              </span>
            </button>
          );
        })}

        <div className="pt-2 mt-2 border-t border-slate-200 space-y-0.5">
          <button
            type="button"
            onClick={() => handleJumpToSection('SIGNOFF')}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <span>Sign-Off &amp; Signatures</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('report');
              setMobileNavOpen(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-semibold transition-colors ${
              viewMode === 'report'
                ? 'bg-red-700 text-white'
                : 'text-red-700 hover:bg-red-50'
            }`}
          >
            <span>Report Preview &amp; PDF</span>
            <FileCheck2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>
    </div>
  );

  const bottomRightToastStack =
    isNetworkOffline || toastMessage ? (
      <div className="no-print fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 max-w-[calc(100vw-2.5rem)] pointer-events-none">
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg"
          >
            {toastMessage}
          </div>
        )}
        {isNetworkOffline && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex items-start gap-2.5 bg-slate-900 text-white border border-amber-500/40 px-3.5 py-2.5 rounded-lg shadow-lg max-w-xs sm:max-w-sm"
          >
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white leading-tight">
                Network connection lost
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                Working offline — edits stay saved locally and will sync once
                reconnected.
              </div>
            </div>
          </div>
        )}
      </div>
    ) : null;

  if (!authReady) {
    return (
      <>
        {isRunningFromOfflineCache && (
          <header className="no-print sticky top-0 z-40">
            <OfflineShellHeaderBanner
              isNetworkOffline={isNetworkOffline}
              updateAvailable={appShellSnapshot.updateAvailable}
              isChecking={isCheckingAppUpdates}
              statusNote={shellUpdateNote}
              onCheckForUpdates={() => void handleCheckForAppUpdates()}
            />
          </header>
        )}
        <AuthGateScreen
          mode="loading"
          isSigningIn={false}
          errorMessage={authError}
          hasPendingShareLink={Boolean(
            pendingShareLinkToken || pendingDirectReportId
          )}
          onSignIn={handleSignIn}
        />
        {bottomRightToastStack}
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 print-reset-layout">
      {/* =================================================================== */}
      {/* TOP NAVIGATION BAR (Strict 3-Zone Contract + Offline Cache Banner)  */}
      {/* =================================================================== */}
      <header className="no-print sticky top-0 z-30 bg-white border-b border-slate-200">
        {isRunningFromOfflineCache && (
          <OfflineShellHeaderBanner
            isNetworkOffline={isNetworkOffline}
            updateAvailable={appShellSnapshot.updateAvailable}
            isChecking={isCheckingAppUpdates}
            statusNote={shellUpdateNote}
            onCheckForUpdates={() => void handleCheckForAppUpdates()}
          />
        )}
        <div className="h-14 px-4 lg:px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden p-1.5 -ml-1.5 rounded-md text-slate-600 hover:bg-slate-100"
            aria-label="Open section menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setViewMode('form');
              setActiveSectionCode('ALL');
            }}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            IQAF-005 Inspection
          </a>
        </div>

        {/* Zone 2: Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => {
              setViewMode('dashboard');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'dashboard'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('reports');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'reports'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Reports
          </button>
          <button
            type="button"
            onClick={() => setViewMode('form')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'form'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Checklist
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('summary');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'summary'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('photos');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'photos'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Photos
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('report');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'report'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Preview
          </button>
        </nav>

        {/* Zone 3: Real-Time Network/Sync Status & Primary Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <NetworkStatusIndicator
            isSignedIn={true}
            isSigningIn={isSigningIn}
            isSavingOnline={isSavingOnline || isAutoSaving}
            hasUnsavedCloudChanges={hasUnsavedCloudChanges}
            lastSaveError={lastCloudSaveError}
            uploadingPhotoCount={photoSyncCounts.uploading}
            failedPhotoCount={photoSyncCounts.failed}
            localOnlyPhotoCount={photoSyncCounts.localOnly}
            queuedOtherReportsPhotoCount={otherReportsPendingPhotoCount}
            totalPhotosCount={indexedPhotos.length}
            lastSyncedAt={lastSyncedAt}
            autoSaveEnabled={autoSaveEnabled}
            onToggleAutoSave={handleToggleAutoSave}
            hdUploadsEnabled={hdUploadsEnabled}
            onToggleHdUploads={handleToggleHdUploads}
            backgroundSync={backgroundSyncState}
            onSaveOnline={handleSaveCurrentReport}
            onRetryFailedPhotos={retryAllFailedPhotos}
            onSignIn={handleSignIn}
            onConnectivityChange={(online) => {
              setIsNetworkOffline(!online);
              if (online) {
                setShellUpdateNote(null);
                showToast('Connection restored — syncing online');
                void backgroundSyncServiceRef.current?.triggerSync('online');
                if (autoSaveEnabled && hasUnsavedCloudChanges) {
                  void runCloudAutosave(user);
                }
              }
            }}
          />
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isExporting ? 'Exporting…' : 'Export PDF'}</span>
          </button>
        </div>
        </div>
      </header>

      {/* Mobile View Switcher bar (visible < md) */}
      <div className="no-print md:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto">
        {(
          [
            { id: 'reports', label: 'Reports' },
            { id: 'form', label: 'Checklist' },
            { id: 'summary', label: 'Summary' },
            { id: 'photos', label: 'Photos' },
            { id: 'report', label: 'Preview' },
          ] as { id: ViewMode; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setViewMode(tab.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              viewMode === tab.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile Sidebar Slide-over */}
      {mobileNavOpen && (
        <div
          className="no-print fixed inset-0 z-50 lg:hidden bg-slate-950/50 flex"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] h-full bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">
                Checklist Navigation
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MAIN WORKSPACE BODY                                                 */}
      {/* =================================================================== */}
      <div className="flex-1 flex min-h-0 print-reset-layout">
        {/* Desktop Sidebar */}
        <aside className="no-print hidden lg:block w-[264px] shrink-0 border-r border-slate-200 bg-white sticky top-14 h-[calc(100vh-3.5rem)]">
          {sidebarContent}
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0">
          {storageWarning && (
            <div className="no-print bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3">
              <span>{storageWarning}</span>
              <button
                type="button"
                onClick={() => setStorageWarning(null)}
                className="text-amber-800 hover:text-amber-950"
                aria-label="Dismiss warning"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Incoming share link sign-in prompt when recipient is signed out */}
          {authReady &&
            !user &&
            (pendingShareLinkToken || pendingDirectReportId) && (
              <div className="no-print bg-slate-900 text-white px-6 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Someone shared an IQAF-005 Store Inspection Report with you.
                    Sign in with Google to open it.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={isSigningIn}
                    className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-semibold text-slate-950 bg-white hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                  >
                    {isSigningIn ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    Sign in with Google
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingShareLinkToken(null);
                      setPendingDirectReportId(null);
                      clearUrlShareParams();
                    }}
                    className="p-1 text-slate-400 hover:text-white"
                    aria-label="Dismiss share link prompt"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

          {isClaimingShareLink && (
            <div className="no-print bg-slate-100 border-b border-slate-200 px-6 py-2.5 text-xs text-slate-700 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
              <span>Opening shared inspection report…</span>
            </div>
          )}

          {/* Read-only shared report banner */}
          {activeCollaboration && activeCollaboration.accessRole === 'viewer' && (
            <div className="no-print bg-slate-100 border-b border-slate-200 px-6 py-2.5 text-xs text-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-slate-600 shrink-0" />
                <span>
                  Shared by <strong>{activeCollaboration.ownerName}</strong> ·{' '}
                  <strong>View Only</strong> — you can inspect, preview, and
                  export PDF/Excel, or duplicate to make edits.
                </span>
              </div>
              <button
                type="button"
                disabled={isSavingOnline}
                onClick={handleDuplicateCurrentReport}
                className="inline-flex items-center gap-1.5 px-3 h-7 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                Duplicate to Edit
              </button>
            </div>
          )}

          {/* Live sync conflict banner when a collaborator saved a newer version */}
          {remoteUpdateNotice && (
            <div className="no-print bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>{remoteUpdateNotice.editorName}</strong> saved a newer
                  version (v{remoteUpdateNotice.version}) while you had unsaved
                  edits.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePullLatestRemoteReport}
                  className="px-3 h-7 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-md transition-colors whitespace-nowrap"
                >
                  Pull Latest
                </button>
                <button
                  type="button"
                  onClick={() => setRemoteUpdateNotice(null)}
                  className="px-2.5 h-7 text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap"
                >
                  Keep My Edits
                </button>
              </div>
            </div>
          )}

          {viewMode === 'dashboard' ? (
            <BranchDashboardView
              currentReport={report}
              cloudReports={cloudReports}
              sharedReports={sharedReports}
              localReports={localReports}
              loadingCloudReports={loadingCloudReports}
              busyReportId={busyReportId}
              onStartAuditForBranch={handleCreateBlankForBranch}
              onLoadSampleReport={handleLoadSample}
              onOpenReportsLibrary={() => {
                setViewMode('reports');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenCurrentReport={() => {
                setViewMode('form');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onEditCloudReport={handleEditCloudReport}
              onPreviewCloudReport={handlePreviewCloudReport}
              onDownloadCloudReportPdf={handleDownloadCloudReportPdf}
              onDownloadCloudReportExcel={handleDownloadCloudReportExcel}
              onDownloadCloudReportDocx={handleDownloadCloudReportDocx}
              onDeleteCloudReport={handleDeleteCloudReport}
              onLeaveSharedReport={handleLeaveSharedReport}
              onEditLocalReport={(entry) => {
                setCustomBranchForReportId(null);
                setReport(withResolvedSequence(entry));
                setActiveCollaboration(null);
                setHasUnsavedCloudChanges(true);
                setLastSyncedAt(null);
                setRemoteUpdateNotice(null);
                resetDirtyTracker();
                dirtyFieldsRef.current.full = true;
                setViewMode('form');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                showToast('Loaded local snapshot for editing');
              }}
              onDownloadLocalReportPdf={async (entry) => {
                setIsExporting(true);
                try {
                  await exportInspectionToPdf(withResolvedSequence(entry), exportOptions);
                  showToast('PDF downloaded');
                } finally {
                  setIsExporting(false);
                }
              }}
              onDownloadLocalReportExcel={async (entry) => {
                setIsExportingExcel(true);
                try {
                  await exportInspectionToExcel(withResolvedSequence(entry));
                  showToast('Excel (.xlsx) report downloaded');
                } finally {
                  setIsExportingExcel(false);
                }
              }}
              onDownloadLocalReportDocx={async (entry) => {
                setIsExportingDocx(true);
                try {
                  await exportInspectionToDocx(
                    withResolvedSequence(entry),
                    exportOptions
                  );
                  showToast('Word (.docx) report downloaded');
                } finally {
                  setIsExportingDocx(false);
                }
              }}
              onDeleteLocalReport={handleDeleteLocalReport}
              onDiscardCurrentDraft={handleDiscardCurrentDraft}
            />
          ) : viewMode === 'reports' ? (
            <ReportsLibraryView
              user={user}
              authReady={authReady}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              isSigningIn={isSigningIn}
              currentReport={report}
              activeCollaboration={activeCollaboration}
              hasUnsavedCloudChanges={hasUnsavedCloudChanges}
              isSavingOnline={isSavingOnline}
              cloudReports={cloudReports}
              sharedReports={sharedReports}
              loadingCloudReports={loadingCloudReports}
              localReports={localReports}
              busyReportId={busyReportId}
              isExportingMergedPdf={isExportingMergedPdf}
              mergedPdfProgress={mergedPdfProgress}
              exportOptions={exportOptions}
              onChangeExportOptions={setExportOptions}
              onCreateNewReport={handleCreateBlank}
              onLoadSampleReport={handleLoadSample}
              onDownloadBlankPdf={handleDownloadBlankPdf}
              onDownloadBlankExcel={handleDownloadBlankExcel}
              onDownloadBlankDocx={handleDownloadBlankDocx}
              onSaveCurrentReport={handleSaveCurrentReport}
              onShareCloudReport={(summary) => setShareModalReportId(summary.id)}
              onDuplicateCloudReport={handleDuplicateCloudReport}
              onLeaveSharedReport={handleLeaveSharedReport}
              onEditCloudReport={handleEditCloudReport}
              onPreviewCloudReport={handlePreviewCloudReport}
              onDownloadCloudReportPdf={handleDownloadCloudReportPdf}
              onDownloadCloudReportExcel={handleDownloadCloudReportExcel}
              onDownloadCloudReportDocx={handleDownloadCloudReportDocx}
              onEmailCloudReport={handleEmailCloudReport}
              onDeleteCloudReport={handleDeleteCloudReport}
              onExportMergedPdf={handleExportMergedPdf}
              onEditLocalReport={(entry) => {
                setCustomBranchForReportId(null);
                setReport(withResolvedSequence(entry));
                setActiveCollaboration(null);
                setHasUnsavedCloudChanges(true);
                setLastSyncedAt(null);
                setRemoteUpdateNotice(null);
                resetDirtyTracker();
                dirtyFieldsRef.current.full = true;
                setViewMode('form');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                showToast('Loaded local snapshot for editing');
              }}
              onUploadLocalReportToCloud={handleUploadLocalReportToCloud}
              onDownloadLocalReportPdf={async (entry) => {
                setIsExporting(true);
                try {
                  await exportInspectionToPdf(withResolvedSequence(entry), exportOptions);
                  showToast('PDF downloaded');
                } finally {
                  setIsExporting(false);
                }
              }}
              onDownloadLocalReportExcel={async (entry) => {
                setIsExportingExcel(true);
                try {
                  await exportInspectionToExcel(withResolvedSequence(entry));
                  showToast('Excel (.xlsx) report downloaded');
                } finally {
                  setIsExportingExcel(false);
                }
              }}
              onDownloadLocalReportDocx={async (entry) => {
                setIsExportingDocx(true);
                try {
                  await exportInspectionToDocx(
                    withResolvedSequence(entry),
                    exportOptions
                  );
                  showToast('Word (.docx) report downloaded');
                } finally {
                  setIsExportingDocx(false);
                }
              }}
              onEmailLocalReport={(entry) =>
                setEmailReportTarget(withResolvedSequence(entry))
              }
              onDeleteLocalReport={handleDeleteLocalReport}
            />
          ) : viewMode === 'summary' ? (
            <InspectionSummaryView
              report={report}
              totalStoredPhotosCount={totalUniqueStoredPhotos}
              readOnly={isReadOnlyViewer}
              hasUnsavedCloudChanges={hasUnsavedCloudChanges}
              isNetworkOffline={isNetworkOffline}
              isSavingOnline={isSavingOnline || isAutoSaving}
              pendingPhotoSyncCount={
                photoSyncCounts.localOnly + photoSyncCounts.failed
              }
              lastSyncedAt={lastSyncedAt}
              onSaveOnline={handleSaveCurrentReport}
              onJumpToSection={handleJumpToSection}
              onJumpToItem={handleJumpToItem}
              onUpdateSignOff={(
                slot: SignOffRoleKey,
                next: SignOffEntry
              ) =>
                mutateReport(
                  (prev) => ({
                    ...prev,
                    updatedAt: new Date().toISOString(),
                    signOffs: { ...prev.signOffs, [slot]: next },
                  }),
                  { signOffKey: slot }
                )
              }
              onOpenReportPreview={() => {
                setViewMode('report');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenPhotoVault={() => {
                setViewMode('photos');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onExportPdf={handleExportPdf}
              onExportExcel={handleExportExcel}
              onExportDocx={handleExportDocx}
              onEmailReport={() => setEmailReportTarget(report)}
              isExporting={isExporting}
              isExportingExcel={isExportingExcel}
              isExportingDocx={isExportingDocx}
              onInspectPhoto={(itemNumber, itemText, photo) =>
                setLightboxState({
                  kind: 'current',
                  itemNumber,
                  itemText,
                  photoId: photo.id,
                })
              }
            />
          ) : viewMode === 'photos' ? (
            <PhotoVaultView
              report={report}
              storedPhotos={combinedStoredPhotos}
              hdUploadsEnabled={hdUploadsEnabled}
              onToggleHdUploads={handleToggleHdUploads}
              onOpenCameraForItem={openCameraForItem}
              onAttachPhotosToItem={attachPhotosToItem}
              onRetryPhotoUpload={retryPhotoUpload}
              onUpdateCurrentPhotoCaption={updatePhotoCaption}
              onDeleteStoredPhoto={deleteStoredPhotoRecord}
              onBulkDeleteStoredPhotos={bulkDeleteStoredPhotos}
              onBulkRecaptionStoredPhotos={bulkRecaptionStoredPhotos}
              onInspectStoredPhoto={(record) =>
                setLightboxState({ kind: 'stored', record })
              }
              onShowUploadDiagnostics={() => setDiagnosticsOverlayOpen(true)}
            />
          ) : viewMode === 'report' ? (
            <ReportPreview
              report={report}
              exportOptions={exportOptions}
              onChangeExportOptions={setExportOptions}
              onExportPdf={handleExportPdf}
              onExportExcel={handleExportExcel}
              onExportDocx={handleExportDocx}
              onDownloadBlankPdf={handleDownloadBlankPdf}
              onDownloadBlankExcel={handleDownloadBlankExcel}
              onDownloadBlankDocx={handleDownloadBlankDocx}
              onEmailReport={() => setEmailReportTarget(report)}
              isExporting={isExporting}
              isExportingExcel={isExportingExcel}
              isExportingDocx={isExportingDocx}
              onBackToForm={() => setViewMode('form')}
              onInspectPhoto={(itemNumber, itemText, photo) =>
                setLightboxState({
                  kind: 'current',
                  itemNumber,
                  itemText,
                  photoId: photo.id,
                })
              }
            />
          ) : (
            <div className="max-w-[1060px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              {/* Inspection Header & Metadata Form Card */}
              <section className="bg-white border border-slate-200 rounded-xl">
                <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <JiangNanLogo />
                    <div className="border-l border-slate-200 pl-4">
                      <h1 className="text-lg font-bold text-slate-950 leading-tight">
                        Store Inspection Checklist
                      </h1>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                        Basis: {report.meta.documentationNo} (Rev.{' '}
                        {report.meta.revisionNo}) · {TOTAL_ITEMS_COUNT} Compliance Items
                      </div>
                      <div className="text-xs font-mono font-semibold text-slate-800 mt-0.5 tabular-nums">
                        Report No.: {currentReportNo}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2 shrink-0">
                    {(() => {
                      const updatedMs = report.updatedAt
                        ? Date.parse(report.updatedAt)
                        : NaN;
                      const syncedMs = lastSyncedAt
                        ? Date.parse(lastSyncedAt)
                        : NaN;
                      const useSyncedTs =
                        !hasUnsavedCloudChanges &&
                        Number.isFinite(syncedMs) &&
                        (!Number.isFinite(updatedMs) || syncedMs >= updatedMs);
                      const effectiveIso = useSyncedTs
                        ? lastSyncedAt
                        : report.updatedAt || lastSyncedAt;
                      const relText = formatRelativeTime(
                        effectiveIso,
                        relativeNowMs
                      );
                      const isSyncedState =
                        !hasUnsavedCloudChanges &&
                        !isNetworkOffline;
                      const fullClock =
                        effectiveIso && Number.isFinite(Date.parse(effectiveIso))
                          ? new Date(effectiveIso).toLocaleString()
                          : '';
                      return (
                        <div
                          title={
                            fullClock
                              ? `Last modified: ${fullClock} (${isSyncedState ? 'Synced to cloud' : 'Saved locally'})`
                              : 'Last modified timestamp'
                          }
                          className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums self-start sm:self-end"
                        >
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>
                            Last modified{' '}
                            <span className="font-medium text-slate-700">
                              {relText}
                            </span>
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span
                            className={
                              isSyncedState
                                ? 'text-emerald-700 font-medium'
                                : 'text-amber-700 font-medium'
                            }
                          >
                            {isSyncedState ? 'Synced to cloud' : 'Saved locally'}
                          </span>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!isReadOnlyViewer && (
                      <button
                        type="button"
                        onClick={handleSaveCurrentReport}
                        disabled={isSavingOnline}
                        className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                      >
                        {isSavingOnline ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {isSavingOnline ? 'Saving…' : 'Save Online'}
                      </button>
                    )}
                    {user && (!activeCollaboration || activeCollaboration.accessRole === 'owner') && (
                      <button
                        type="button"
                        onClick={handleShareCurrentReport}
                        disabled={isSavingOnline}
                        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                      >
                        <Share2 className="w-3.5 h-3.5 text-slate-600" />
                        Share
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCreateBlank}
                      className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      <FilePlus2 className="w-3.5 h-3.5 text-slate-500" />
                      New Report
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadSample}
                      className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-slate-500" />
                      Sample
                    </button>
                    <BlankSheetMenuButton
                      size="sm"
                      onDownloadBlankPdf={handleDownloadBlankPdf}
                      onDownloadBlankExcel={handleDownloadBlankExcel}
                      onDownloadBlankDocx={handleDownloadBlankDocx}
                    />
                    </div>
                  </div>
                </div>

                {/* Metadata Inputs matching PDF Header Table */}
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                  <label className="block lg:col-span-2">
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Date of Inspection
                    </span>
                    <input
                      type="date"
                      value={report.meta.dateOfInspection}
                      onChange={(e) =>
                        updateMeta('dateOfInspection', e.target.value)
                      }
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </label>

                  <div className="block lg:col-span-2">
                    <label className="block">
                      <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Store Location / Branch
                      </span>
                      <select
                        value={selectedBranchDropdownValue}
                        disabled={isReadOnlyViewer}
                        onChange={(e) => handleSelectBranch(e.target.value)}
                        className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                      >
                        <option value="">Select branch…</option>
                        <optgroup label="Store Branches">
                          {STORE_BRANCHES.map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Corporate &amp; Support">
                          {FACILITY_BRANCHES.map((facility) => (
                            <option key={facility} value={facility}>
                              {facility}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Other">
                          <option value={CUSTOM_BRANCH_OPTION}>Custom…</option>
                        </optgroup>
                      </select>
                    </label>
                    {isCustomBranchActive && (
                      <input
                        type="text"
                        maxLength={200}
                        disabled={isReadOnlyViewer}
                        value={report.meta.storeLocation}
                        onChange={(e) => handleCustomBranchChange(e.target.value)}
                        placeholder="Enter custom branch name"
                        className="mt-2 w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                      />
                    )}
                    <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums truncate">
                      {normalizedStoreLocation
                        ? `Auto #${String(effectiveReportSequence).padStart(3, '0')} · ${currentReportNo}`
                        : 'Select a branch to auto-number'}
                    </div>
                  </div>

                  <label className="block lg:col-span-2">
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Inspected By
                    </span>
                    <input
                      type="text"
                      maxLength={160}
                      value={report.meta.inspectedBy}
                      onChange={(e) =>
                        updateMeta('inspectedBy', e.target.value)
                      }
                      placeholder="Inspector full name"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </label>

                  <label className="block lg:col-span-3">
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Time of Inspection (Started)
                    </span>
                    <input
                      type="time"
                      value={report.meta.timeOfInspection}
                      onChange={(e) =>
                        updateMeta('timeOfInspection', e.target.value)
                      }
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </label>

                  <div className="block lg:col-span-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor="time-inspection-ended"
                        className="text-xs font-semibold text-slate-700"
                      >
                        Time Inspection Ended (Optional)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isReadOnlyViewer}
                          onClick={() =>
                            updateMeta(
                              'timeOfInspectionEnded',
                              getCurrentTimeString()
                            )
                          }
                          className="text-[11px] font-semibold text-red-700 hover:text-red-800 hover:underline disabled:opacity-50 whitespace-nowrap"
                        >
                          Set Now
                        </button>
                        {report.meta.timeOfInspectionEnded && (
                          <button
                            type="button"
                            disabled={isReadOnlyViewer}
                            onClick={() =>
                              updateMeta('timeOfInspectionEnded', '')
                            }
                            className="text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-50 whitespace-nowrap"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      id="time-inspection-ended"
                      type="time"
                      disabled={isReadOnlyViewer}
                      value={report.meta.timeOfInspectionEnded ?? ''}
                      onChange={(e) =>
                        updateMeta('timeOfInspectionEnded', e.target.value)
                      }
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 tabular-nums disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </div>
                </div>

                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 rounded-b-xl space-y-1">
                  <p className="text-xs text-slate-600 italic leading-relaxed">
                    {HOW_TO_FILL_INSTRUCTION}
                  </p>
                  <p className="text-[11px] font-medium text-slate-700">
                    {IQAF_BASIS_STATEMENT}
                  </p>
                </div>
              </section>

              {/* Live Summary & Cloud Status Strip inside Form */}
              <section className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                  <span>
                    Score:{' '}
                    <strong className="font-mono font-bold text-slate-950">
                      {metrics.complianceRate !== null
                        ? `${metrics.complianceRate}%`
                        : '—'}
                    </strong>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Checked:{' '}
                    <strong className="font-mono font-semibold text-slate-900">
                      {metrics.answered}/{TOTAL_ITEMS_COUNT}
                    </strong>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Yes:{' '}
                    <strong className="font-mono font-semibold text-emerald-700">
                      {metrics.yes}
                    </strong>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Deviations (No):{' '}
                    <strong className="font-mono font-semibold text-red-700">
                      {metrics.no}
                    </strong>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Photos:{' '}
                    <strong className="font-mono font-semibold text-slate-900">
                      {metrics.totalPhotos}
                    </strong>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('summary');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="font-semibold text-red-700 hover:underline whitespace-nowrap"
                  >
                    Open Full Summary
                  </button>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('reports');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="font-semibold text-slate-700 hover:text-slate-950 hover:underline whitespace-nowrap"
                  >
                    Online Reports ({cloudReports.length})
                  </button>
                </div>
              </section>

              {/* Search & Filter Toolbar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search items, sections, or findings…"
                    className="w-full h-9 pl-9 pr-8 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: `All (${TOTAL_ITEMS_COUNT})` },
                      {
                        id: 'unanswered',
                        label: `Pending (${metrics.unanswered})`,
                      },
                      { id: 'Yes', label: `Yes (${metrics.yes})` },
                      { id: 'No', label: `No (${metrics.no})` },
                      { id: 'N/A', label: `N/A (${metrics.na})` },
                      { id: 'photos', label: `Photos (${metrics.totalPhotos})` },
                    ] as { id: FilterMode; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterMode(tab.id)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        filterMode === tab.id
                          ? 'bg-white text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active single-section banner */}
              {activeSectionCode !== 'ALL' && (
                <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-xs">
                  <span className="text-slate-600">
                    Showing Section{' '}
                    <strong className="text-slate-900">
                      {activeSectionCode}
                    </strong>{' '}
                    only
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveSectionCode('ALL')}
                    className="font-semibold text-red-700 hover:underline whitespace-nowrap"
                  >
                    Show all 17 sections
                  </button>
                </div>
              )}

              {/* Checklist Sections A–Q */}
              {visibleSections.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <p className="text-sm font-semibold text-slate-800">
                    No inspection items match your current filter
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Try clearing the search query or switching back to All
                    items.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterMode('all');
                      setSearchQuery('');
                      setActiveSectionCode('ALL');
                    }}
                    className="mt-4 px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {visibleSections.map((section) => {
                    const stat = metrics.bySection[section.code];
                    return (
                      <section
                        key={section.code}
                        id={`section-${section.code}`}
                        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                      >
                        <div className="bg-slate-100 border-b border-slate-200 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-baseline gap-2.5 min-w-0">
                            <h2 className="text-sm font-bold text-slate-900">
                              {section.code}. {section.title}
                            </h2>
                            <span className="text-xs font-mono text-slate-500 tabular-nums">
                              {stat.answered}/{stat.total} answered
                              {stat.no > 0 ? ` · ${stat.no} No` : ''}
                              {stat.photos > 0
                                ? ` · ${stat.photos} ${stat.photos === 1 ? 'photo' : 'photos'}`
                                : ''}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => markSectionAllYes(section.code)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-emerald-300 hover:text-emerald-800 hover:bg-emerald-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                            title="Mark unanswered items in this section as Yes"
                          >
                            <CheckCheck className="w-3.5 h-3.5" />
                            Mark Section Yes
                          </button>
                        </div>

                        <div>
                          {section.items.map((item) => (
                            <InspectionItemRow
                              key={item.number}
                              item={item}
                              response={
                                report.responses[item.number] ??
                                createEmptyResponse()
                              }
                              hdUploadsEnabled={hdUploadsEnabled}
                              onChange={(next) =>
                                updateItemResponse(item.number, next)
                              }
                              onOpenCamera={() =>
                                openCameraForItem(item.number)
                              }
                              onAddPhotos={(added) =>
                                attachPhotosToItem(item.number, added)
                              }
                              onRetryPhotoUpload={(photoId) =>
                                retryPhotoUpload(item.number, photoId)
                              }
                              onRemovePhoto={(photoId) =>
                                void removePhotoFromItemAndStorage(
                                  item.number,
                                  photoId
                                )
                              }
                              onUpdatePhotoCaption={(photoId, caption) =>
                                updatePhotoCaption(
                                  item.number,
                                  photoId,
                                  caption
                                )
                              }
                              onInspectPhoto={(photo) =>
                                setLightboxState({
                                  kind: 'current',
                                  itemNumber: item.number,
                                  itemText: item.text,
                                  photoId: photo.id,
                                })
                              }
                              onShowUploadDiagnostics={() =>
                                setDiagnosticsOverlayOpen(true)
                              }
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              {/* Section-to-section stepping buttons when focused on 1 section */}
              {activeSectionCode !== 'ALL' && activeSectionIdx >= 0 && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={activeSectionIdx === 0}
                    onClick={() =>
                      handleJumpToSection(
                        CHECKLIST_SECTIONS[activeSectionIdx - 1].code
                      )
                    }
                    className="px-4 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  >
                    Previous Section
                  </button>
                  {activeSectionIdx < CHECKLIST_SECTIONS.length - 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleJumpToSection(
                          CHECKLIST_SECTIONS[activeSectionIdx + 1].code
                        )
                      }
                      className="px-4 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      Next: {CHECKLIST_SECTIONS[activeSectionIdx + 1].code}.{' '}
                      {CHECKLIST_SECTIONS[activeSectionIdx + 1].title}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleJumpToSection('SIGNOFF')}
                      className="px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors"
                    >
                      Proceed to Sign-Off
                    </button>
                  )}
                </div>
              )}

              {/* Photo Proof Summary Gallery (when photos attached) */}
              {indexedPhotos.length > 0 && (
                <section className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Attached Photo Proofs ({indexedPhotos.length})
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {user
                          ? `Auto-saved locally & auto-synced to cloud (${hdUploadsEnabled ? 'HD' : 'Standard'}) with taken timestamps, included in exports`
                          : 'Auto-saved locally in IndexedDB with taken timestamps, included in exports'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode('photos');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Manage Photo Vault
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {indexedPhotos.map((entry) => (
                      <button
                        key={entry.photo.id}
                        type="button"
                        onClick={() =>
                          setLightboxState({
                            kind: 'current',
                            itemNumber: entry.itemNumber,
                            itemText: entry.itemText,
                            photoId: entry.photo.id,
                          })
                        }
                        className="group text-left border border-slate-200 rounded-lg overflow-hidden bg-slate-50 hover:border-slate-300 transition-colors"
                      >
                        <div className="aspect-[4/3] bg-slate-200 overflow-hidden">
                          <img
                            src={entry.photo.dataUrl}
                            alt={
                              entry.photo.caption ||
                              `Photo #${entry.photoIndex}`
                            }
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                          />
                        </div>
                        <div className="p-2 bg-white">
                          <div className="text-[11px] font-mono font-semibold text-slate-700 tabular-nums">
                            Photo #{entry.photoIndex} · Item #{entry.itemNumber}
                          </div>
                          <div className="text-[10.5px] font-mono text-slate-500 tabular-nums truncate mt-0.5">
                            Taken: {formatTakenTimestamp(entry.photo.capturedAt)}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {entry.photo.caption || 'Click to add caption'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Sign-Off & Electronic Signatures Section */}
              <section
                id="section-signoff"
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Sign-Off &amp; Verification
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Quality Assurance Department · Basis Form #:{' '}
                      {report.meta.documentationNo} (Rev.{' '}
                      {report.meta.revisionNo}) ·{' '}
                      <span className="font-mono font-semibold text-slate-700">
                        Report No.: {currentReportNo}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                  <div className="lg:col-span-2">
                    <SignaturePad
                      title="Performed By"
                      roleSubtitle="Food Safety Compliance Officer"
                      value={report.signOffs.performedBy}
                      readOnly={isReadOnlyViewer}
                      onChange={(next) =>
                        mutateReport(
                          (prev) => ({
                            ...prev,
                            updatedAt: new Date().toISOString(),
                            signOffs: { ...prev.signOffs, performedBy: next },
                          }),
                          { signOffKey: 'performedBy' }
                        )
                      }
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <SignaturePad
                      title="Acknowledged By"
                      roleSubtitle="Restaurant / Shift Manager"
                      value={report.signOffs.acknowledgedBy}
                      readOnly={isReadOnlyViewer}
                      onChange={(next) =>
                        mutateReport(
                          (prev) => ({
                            ...prev,
                            updatedAt: new Date().toISOString(),
                            signOffs: { ...prev.signOffs, acknowledgedBy: next },
                          }),
                          { signOffKey: 'acknowledgedBy' }
                        )
                      }
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <SignaturePad
                      title="Noted By"
                      roleSubtitle="Area Manager"
                      value={report.signOffs.notedBy}
                      readOnly={isReadOnlyViewer}
                      onChange={(next) =>
                        mutateReport(
                          (prev) => ({
                            ...prev,
                            updatedAt: new Date().toISOString(),
                            signOffs: { ...prev.signOffs, notedBy: next },
                          }),
                          { signOffKey: 'notedBy' }
                        )
                      }
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <SignaturePad
                      title="Reviewed By"
                      roleSubtitle="Learning and Development Manager"
                      value={report.signOffs.reviewedBy}
                      readOnly={isReadOnlyViewer}
                      onChange={(next) =>
                        mutateReport(
                          (prev) => ({
                            ...prev,
                            updatedAt: new Date().toISOString(),
                            signOffs: { ...prev.signOffs, reviewedBy: next },
                          }),
                          { signOffKey: 'reviewedBy' }
                        )
                      }
                    />
                  </div>
                  <div className="md:col-span-2 lg:col-span-3">
                    <SignaturePad
                      title="Approved By"
                      roleSubtitle="Quality Assurance Specialist / FSCO"
                      value={report.signOffs.approvedBy}
                      readOnly={isReadOnlyViewer}
                      onChange={(next) =>
                        mutateReport(
                          (prev) => ({
                            ...prev,
                            updatedAt: new Date().toISOString(),
                            signOffs: { ...prev.signOffs, approvedBy: next },
                          }),
                          { signOffKey: 'approvedBy' }
                        )
                      }
                    />
                  </div>
                </div>
              </section>

              {/* Final Report CTA Strip */}
              <section className="bg-slate-900 text-white rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold">
                    Save Online, Review Summary, or Export PDF / Excel
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 tabular-nums">
                    {metrics.answered} of {TOTAL_ITEMS_COUNT} items completed ·{' '}
                    {metrics.no} deviations logged · {metrics.totalPhotos} photo
                    proofs attached
                    {metrics.missingNoDetails > 0
                      ? ` · ${metrics.missingNoDetails} "No" ${metrics.missingNoDetails === 1 ? 'item needs' : 'items need'} deviation/action notes`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleSaveCurrentReport}
                    disabled={isSavingOnline}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isSavingOnline ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {user ? 'Save Online' : 'Save Report'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('report');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    Preview Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailReportTarget(report)}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Mail className="w-4 h-4" />
                    Email Report
                  </button>
                  <button
                    type="button"
                    onClick={handleExportDocx}
                    disabled={isExportingDocx}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-blue-950 bg-blue-100 hover:bg-blue-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isExportingDocx ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    {isExportingDocx ? 'Saving DOCX…' : 'Save as DOCX'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    disabled={isExportingExcel}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-emerald-950 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isExportingExcel ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4" />
                    )}
                    Export Excel
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={isExporting}
                    className="inline-flex items-center gap-1.5 px-4 h-10 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isExporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Export PDF
                  </button>
                </div>
              </section>

              {/* Form Footer with automatic Report No., IQAF-005 Basis, & Confidentiality Notice */}
              <footer className="pt-2.5 border-t border-slate-200 space-y-1 text-[11px] text-slate-500">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    Report No.: {currentReportNo}
                  </span>
                  <span>{IQAF_BASIS_STATEMENT}</span>
                </div>
                <p className="text-[10.5px] italic text-slate-400">
                  {REPORT_CONFIDENTIALITY_NOTICE}
                </p>
              </footer>
            </div>
          )}
        </main>
      </div>

      {/* Photo Lightbox Modal */}
      {lightboxState && activeLightboxInfo && (
        <PhotoLightbox
          photo={activeLightboxInfo.photo}
          itemNumber={activeLightboxInfo.itemNumber}
          itemText={activeLightboxInfo.itemText}
          readOnlyCaption={activeLightboxInfo.readOnlyCaption}
          onUpdateCaption={
            activeLightboxInfo.readOnlyCaption
              ? undefined
              : (caption) =>
                  updatePhotoCaption(
                    activeLightboxInfo.itemNumber,
                    activeLightboxInfo.photo.id,
                    caption
                  )
          }
          onDelete={() => {
            if (lightboxState.kind === 'stored') {
              void deleteStoredPhotoRecord(lightboxState.record);
            } else {
              void removePhotoFromItemAndStorage(
                activeLightboxInfo.itemNumber,
                activeLightboxInfo.photo.id
              );
            }
          }}
          onClose={() => setLightboxState(null)}
        />
      )}

      {/* Live Camera Capture Modal */}
      {cameraTarget && (
        <CameraCaptureModal
          itemNumber={cameraTarget.itemNumber}
          itemText={cameraTarget.itemText}
          hdUploadsEnabled={hdUploadsEnabled}
          onToggleHdUploads={handleToggleHdUploads}
          onCaptureComplete={(photo) =>
            attachPhotosToItem(cameraTarget.itemNumber, [photo])
          }
          onClose={() => setCameraTarget(null)}
        />
      )}

      {/* Email Compliance Report Modal (Email-Only AI Deviation Suggestions) */}
      {emailReportTarget && (
        <EmailReportModal
          report={emailReportTarget}
          onClose={() => setEmailReportTarget(null)}
          onSentSuccess={(count) =>
            showToast(
              `Compliance report emailed to ${count} ${count === 1 ? 'recipient' : 'recipients'}`
            )
          }
        />
      )}

      {/* Share Report & Collaboration Modal */}
      {user &&
        shareModalReportId &&
        (() => {
          const found = cloudReports.find((r) => r.id === shareModalReportId);
          const summary: CloudReportSummary | null =
            found
              ? {
                  ...found,
                  reportSequence:
                    found.reportSequence ?? resolvedSequenceMap.get(found.id),
                }
              : shareModalReportId === report.id
              ? {
                  id: report.id,
                  ownerId: user.uid,
                  ownerName:
                    user.displayName ||
                    user.email ||
                    report.meta.inspectedBy ||
                    'Inspector',
                  accessRole: 'owner',
                  documentationNo: report.meta.documentationNo,
                  revisionNo: report.meta.revisionNo,
                  dateOfInspection: report.meta.dateOfInspection,
                  storeLocation: report.meta.storeLocation,
                  reportSequence: effectiveReportSequence,
                  timeOfInspection: report.meta.timeOfInspection,
                  timeOfInspectionEnded: report.meta.timeOfInspectionEnded ?? '',
                  inspectedBy: report.meta.inspectedBy,
                  stats: {
                    answered: metrics.answered,
                    yes: metrics.yes,
                    no: metrics.no,
                    na: metrics.na,
                    photoCount: metrics.totalPhotos,
                  },
                  photoIds: indexedPhotos.map((p) => p.photo.id),
                  sharedWithEmails: activeCollaboration?.sharedWithEmails ?? [],
                  editorEmails: activeCollaboration?.editorEmails ?? [],
                  activeShareLinkId:
                    activeCollaboration?.activeShareLinkId ?? null,
                  activeShareRole:
                    activeCollaboration?.activeShareRole ?? 'none',
                  syncVersion: activeCollaboration?.syncVersion ?? 1,
                  lastEditedByUid: user.uid,
                  lastEditedByName: user.displayName || user.email || '',
                  createdAtIso: report.updatedAt,
                  updatedAtIso: report.updatedAt,
                }
              : null;
          if (!summary) return null;
          return (
            <ShareReportModal
              user={user}
              reportSummary={summary}
              onClose={() => setShareModalReportId(null)}
              onUpdated={(msg) => showToast(msg)}
            />
          );
        })()}

      {/* Photo Upload Failure Diagnostic Overlay */}
      <PhotoUploadDiagnosticOverlay
        diagnostics={uploadDiagnostics}
        isOpen={diagnosticsOverlayOpen}
        onToggleOpen={setDiagnosticsOverlayOpen}
        onRetryPhoto={(itemNumber, photoId) =>
          retryPhotoUpload(itemNumber, photoId)
        }
        onRetryAll={retryAllFailedPhotos}
        onDismissEntry={(photoId) =>
          setUploadDiagnostics((prev) => {
            const next = prev.filter((d) => d.photoId !== photoId);
            if (next.length === 0) setDiagnosticsOverlayOpen(false);
            return next;
          })
        }
        onClearAll={() => {
          setUploadDiagnostics([]);
          setDiagnosticsOverlayOpen(false);
        }}
      />

      {/* Persistent offline & transient feedback toasts */}
      {bottomRightToastStack}
    </div>
  );
}
