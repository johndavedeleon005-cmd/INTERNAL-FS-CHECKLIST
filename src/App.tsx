import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Camera,
  CheckCheck,
  Cloud,
  Download,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FolderKanban,
  Images,
  Loader2,
  LogIn,
  Mail,
  Menu,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  HOW_TO_FILL_INSTRUCTION,
  IQAF_BASIS_STATEMENT,
  TOTAL_ITEMS_COUNT,
  createBlankInspection,
  createEmptyResponse,
  createSampleInspection,
  formatReportNo,
} from './data/checklistData';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import type {
  InspectionReport,
  ItemResponse,
  PdfExportOptions,
  PhotoProof,
  StoredPhotoRecord,
} from './types/inspection';
import {
  type CloudReportSummary,
  deleteReportOnline,
  deleteSinglePhotoOnline,
  loadAllUserPhotosOnline,
  loadReportWithPhotosOnline,
  sanitizeId,
  saveReportOnline,
  subscribeToUserReports,
  updatePhotoCaptionOnline,
  uploadSinglePhotoImmediatelyOnline,
} from './utils/cloudReports';
import { formatTakenTimestamp } from './utils/imageUtils';
import { exportInspectionToExcel } from './utils/excelExporter';
import { collectIndexedPhotos, exportInspectionToPdf } from './utils/pdfExporter';
import {
  deleteSavedReportFromDb,
  deleteStoredPhotoFromDb,
  loadActiveDraftFromDb,
  loadAllStoredPhotosFromDb,
  loadSavedReportsFromDb,
  saveActiveDraftToDb,
  saveReportSnapshotToDb,
} from './utils/storageDb';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { EmailReportModal } from './components/EmailReportModal';
import { InspectionItemRow } from './components/InspectionItemRow';
import { InspectionSummaryView } from './components/InspectionSummaryView';
import { JiangNanLogo } from './components/JiangNanLogo';
import { NetworkStatusIndicator } from './components/NetworkStatusIndicator';
import { PhotoLightbox } from './components/PhotoLightbox';
import { PhotoVaultView } from './components/PhotoVaultView';
import { ReportPreview } from './components/ReportPreview';
import { ReportsLibraryView } from './components/ReportsLibraryView';
import { SignaturePad } from './components/SignaturePad';

type ViewMode = 'reports' | 'form' | 'summary' | 'photos' | 'report';
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

export default function App() {
  // Auth & Online Cloud state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [cloudReports, setCloudReports] = useState<CloudReportSummary[]>([]);
  const [loadingCloudReports, setLoadingCloudReports] = useState(false);
  const [cloudPhotos, setCloudPhotos] = useState<StoredPhotoRecord[]>([]);
  const [isSavingOnline, setIsSavingOnline] = useState(false);
  const [hasUnsavedCloudChanges, setHasUnsavedCloudChanges] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);

  // Active working report & local IndexedDB cache
  const [report, setReport] = useState<InspectionReport>(createBlankInspection);
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const [exportOptions, setExportOptions] = useState<PdfExportOptions>({
    includeSummary: true,
    includePhotoAppendix: true,
    includeInlineThumbnails: false,
  });

  const [lightboxState, setLightboxState] = useState<LightboxState | null>(null);
  const [cameraTarget, setCameraTarget] = useState<{
    itemNumber: number;
    itemText: string;
  } | null>(null);
  const [emailReportTarget, setEmailReportTarget] =
    useState<InspectionReport | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const captionTimersRef = useRef<Map<string, number>>(new Map());
  const reportRef = useRef<InspectionReport>(report);
  reportRef.current = report;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Track Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to online Firestore reports when signed in
  useEffect(() => {
    if (!authReady || !user) {
      setCloudReports([]);
      setCloudPhotos([]);
      setLoadingCloudReports(false);
      return;
    }

    setLoadingCloudReports(true);
    const unsubscribe = subscribeToUserReports(
      user.uid,
      (list) => {
        setCloudReports(list);
        setLoadingCloudReports(false);
      },
      (err) => {
        setLoadingCloudReports(false);
        setStorageWarning(
          `Online sync notice: ${err.message.slice(0, 140)}`
        );
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Refresh online Photo Vault whenever cloud reports list changes
  useEffect(() => {
    if (!user || cloudReports.length === 0) {
      setCloudPhotos([]);
      return;
    }
    let cancelled = false;
    const idsWithPhotos = cloudReports
      .filter((r) => r.stats.photoCount > 0)
      .map((r) => r.id);

    if (idsWithPhotos.length === 0) {
      setCloudPhotos([]);
      return;
    }

    loadAllUserPhotosOnline(user.uid, idsWithPhotos)
      .then((records) => {
        if (!cancelled) setCloudPhotos(records);
      })
      .catch(() => {
        // Error already logged by handleFirestoreError
      });

    return () => {
      cancelled = true;
    };
  }, [user, cloudReports]);

  // Hydrate active draft & local IndexedDB snapshots on startup
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [draft, history, photos] = await Promise.all([
        loadActiveDraftFromDb(),
        loadSavedReportsFromDb(),
        loadAllStoredPhotosFromDb(),
      ]);
      if (cancelled) return;
      setReport(draft);
      setLocalReports(history);
      setLocalPhotos(photos);
      setIsHydrated(true);
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save active draft to IndexedDB for instant offline safety
  useEffect(() => {
    if (!isHydrated) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveActiveDraftToDb(report)
        .then(() => loadAllStoredPhotosFromDb())
        .then((allPhotos) => {
          setLocalPhotos(allPhotos);
        })
        .catch(() => {
          // Ignore silent local backup failure
        });
    }, 240);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [report, isHydrated]);

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

  const totalUniqueStoredPhotos = useMemo(() => {
    const ids = new Set<string>(combinedStoredPhotos.map((p) => p.id));
    for (const p of indexedPhotos) {
      ids.add(p.photo.id);
    }
    return ids.size;
  }, [combinedStoredPhotos, indexedPhotos]);

  const mutateReport = (
    updater: (prev: InspectionReport) => InspectionReport
  ) => {
    setReport((prev) => updater(prev));
    setHasUnsavedCloudChanges(true);
  };

  const updateMeta = <K extends keyof InspectionReport['meta']>(
    key: K,
    value: InspectionReport['meta'][K]
  ) => {
    mutateReport((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      meta: { ...prev.meta, [key]: value },
    }));
  };

  const updateItemResponse = (itemNumber: number, next: ItemResponse) => {
    mutateReport((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      responses: {
        ...prev.responses,
        [itemNumber]: next,
      },
    }));
  };

  const openCameraForItem = (itemNumber: number) => {
    const itemDef = ALL_CHECKLIST_ITEMS.find((it) => it.number === itemNumber);
    setCameraTarget({
      itemNumber,
      itemText: itemDef?.text ?? `Checklist Item #${itemNumber}`,
    });
  };

  const uploadSinglePhotoTask = async (
    activeUser: User,
    snapshotReport: InspectionReport,
    itemNumber: number,
    photo: PhotoProof
  ): Promise<boolean> => {
    try {
      const result = await uploadSinglePhotoImmediatelyOnline(
        activeUser.uid,
        snapshotReport,
        itemNumber,
        photo
      );

      setReport((prev) => {
        if (
          prev.id !== snapshotReport.id &&
          prev.id !== result.reportId
        ) {
          return prev;
        }
        const current = prev.responses[itemNumber];
        if (!current) return prev;
        return {
          ...prev,
          id: result.reportId,
          responses: {
            ...prev.responses,
            [itemNumber]: {
              ...current,
              photos: current.photos.map((p) =>
                p.id === photo.id || p.id === result.photoId
                  ? {
                      ...p,
                      id: result.photoId,
                      dataUrl: result.safeDataUrl,
                      uploadState: 'synced',
                      uploadError: undefined,
                    }
                  : p
              ),
            },
          },
        };
      });

      setCloudPhotos((prev) => {
        const filtered = prev.filter((p) => p.id !== result.storedRecord.id);
        return [result.storedRecord, ...filtered];
      });
      setLastSyncedAt(new Date().toISOString());
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = msg.includes('Quota exceeded');
      if (isQuota) {
        setStorageWarning(
          'Daily Firestore free tier quota exceeded. Photo remains saved locally on this device.'
        );
      }

      setReport((prev) => {
        const current = prev.responses[itemNumber];
        if (!current) return prev;
        return {
          ...prev,
          responses: {
            ...prev.responses,
            [itemNumber]: {
              ...current,
              photos: current.photos.map((p) =>
                p.id === photo.id
                  ? {
                      ...p,
                      uploadState: 'error',
                      uploadError: isQuota
                        ? 'Cloud quota exceeded'
                        : 'Upload failed',
                    }
                  : p
              ),
            },
          },
        };
      });
      return false;
    }
  };

  const attachPhotosToItem = (itemNumber: number, newPhotos: PhotoProof[]) => {
    if (newPhotos.length === 0) return;

    const activeUser = user;
    const preparedPhotos: PhotoProof[] = newPhotos.map((ph) => ({
      ...ph,
      id: sanitizeId(ph.id, 'ph'),
      uploadState: activeUser ? 'uploading' : 'local',
      uploadError: undefined,
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

    // Persist immediately to IndexedDB without waiting for debounce
    void saveActiveDraftToDb(nextReport)
      .then(() => loadAllStoredPhotosFromDb())
      .then((allPhotos) => setLocalPhotos(allPhotos))
      .catch(() => {
        // Ignore silent local backup error
      });

    if (activeUser) {
      showToast(
        `Uploading ${preparedPhotos.length} ${preparedPhotos.length === 1 ? 'photo' : 'photos'} for Item #${itemNumber}…`
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
            `${succeeded} ${succeeded === 1 ? 'photo' : 'photos'} uploaded & saved online`
          );
        } else if (failed > 0) {
          showToast(
            `${failed} ${failed === 1 ? 'photo' : 'photos'} failed to upload — tap Retry on the photo`
          );
        }
      })();
    } else {
      setHasUnsavedCloudChanges(true);
      showToast(
        `Saved ${preparedPhotos.length} ${preparedPhotos.length === 1 ? 'photo' : 'photos'} locally — sign in with Google to upload online`
      );
    }
  };

  const retryPhotoUpload = (itemNumber: number, photoId: string) => {
    if (!user) {
      showToast('Sign in with Google to upload photos online');
      return;
    }
    const current = reportRef.current.responses[itemNumber];
    const target = current?.photos.find((p) => p.id === photoId);
    if (!target) return;

    setReport((prev) => {
      const resp = prev.responses[itemNumber];
      if (!resp) return prev;
      return {
        ...prev,
        responses: {
          ...prev.responses,
          [itemNumber]: {
            ...resp,
            photos: resp.photos.map((p) =>
              p.id === photoId
                ? { ...p, uploadState: 'uploading', uploadError: undefined }
                : p
            ),
          },
        },
      };
    });

    void uploadSinglePhotoTask(user, reportRef.current, itemNumber, target).then(
      (ok) => {
        if (ok) {
          showToast('Photo uploaded & saved online');
        } else {
          showToast('Retry failed — check your connection and try again');
        }
      }
    );
  };

  const retryAllFailedPhotos = () => {
    if (!user) {
      showToast('Sign in with Google to upload photos online');
      return;
    }
    const failedTargets: { itemNumber: number; photoId: string }[] = [];
    for (const [numStr, resp] of Object.entries(reportRef.current.responses)) {
      const itemNumber = Number(numStr);
      for (const photo of resp.photos) {
        if (photo.uploadState === 'error') {
          failedTargets.push({ itemNumber, photoId: photo.id });
        }
      }
    }
    if (failedTargets.length === 0) return;
    showToast(
      `Retrying ${failedTargets.length} failed ${failedTargets.length === 1 ? 'photo' : 'photos'}…`
    );
    for (const target of failedTargets) {
      retryPhotoUpload(target.itemNumber, target.photoId);
    }
  };

  const updatePhotoCaption = (
    itemNumber: number,
    photoId: string,
    caption: string
  ) => {
    mutateReport((prev) => {
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
    });

    // If this photo is already synced online, debounce-sync its caption immediately
    if (user) {
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
          ).catch(() => {
            // Silent fallback — will also sync on Save Online
          });
        }, 650);
        captionTimersRef.current.set(photoId, timerId);
      }
    }
  };

  const removePhotoFromItemAndStorage = async (
    itemNumber: number,
    photoId: string
  ) => {
    const activeReportId = reportRef.current.id;
    mutateReport((prev) => {
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
    });
    try {
      await deleteStoredPhotoFromDb(photoId);
      setLocalPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      // ignore
    }
    if (
      user &&
      (cloudReports.some((r) => r.id === activeReportId) ||
        cloudPhotos.some((p) => p.id === photoId))
    ) {
      try {
        await deleteSinglePhotoOnline(user.uid, activeReportId, photoId);
        setCloudPhotos((prev) => prev.filter((p) => p.id !== photoId));
      } catch {
        // ignore if photo hadn't been synced yet
      }
    }
  };

  const deleteStoredPhotoRecord = async (record: StoredPhotoRecord) => {
    mutateReport((prev) => {
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
    });
    try {
      await deleteStoredPhotoFromDb(record.id);
      setLocalPhotos((prev) => prev.filter((p) => p.id !== record.id));
    } catch {
      // ignore
    }
    if (user && cloudReports.some((r) => r.id === record.reportId)) {
      try {
        await deleteSinglePhotoOnline(user.uid, record.reportId, record.id);
        setCloudPhotos((prev) => prev.filter((p) => p.id !== record.id));
      } catch {
        // handled by cloudReports
      }
    }
    showToast('Photo removed');
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
      setStorageWarning(null);
      showToast('Signed in with Google — online cloud storage enabled');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('popup-closed-by-user')) {
        showToast('Sign-in failed. Please allow popups and try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    showToast('Signed out');
  };

  // Save current report (online to Firestore if signed in, plus local IndexedDB snapshot)
  const handleSaveCurrentReport = async () => {
    setIsSavingOnline(true);
    setStorageWarning(null);
    try {
      const snapshot: InspectionReport = {
        ...report,
        updatedAt: new Date().toISOString(),
      };

      await saveReportSnapshotToDb(snapshot);
      setLocalReports((prev) => {
        const filtered = prev.filter((r) => r.id !== snapshot.id);
        return [snapshot, ...filtered];
      });

      if (user) {
        const savedOnline = await saveReportOnline(user.uid, snapshot);
        setReport(savedOnline);
        setHasUnsavedCloudChanges(false);
        setLastSyncedAt(new Date().toISOString());
        // Refresh cloud photo vault
        const idsToLoad = Array.from(
          new Set([
            ...cloudReports.filter((r) => r.stats.photoCount > 0).map((r) => r.id),
            savedOnline.id,
          ])
        );
        const refreshedPhotos = await loadAllUserPhotosOnline(user.uid, idsToLoad);
        setCloudPhotos(refreshedPhotos);
        showToast('Report and photo proofs saved online');
      } else {
        showToast('Saved locally — sign in with Google to save online');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Quota exceeded')) {
        setStorageWarning(
          'Daily Firestore free tier quota exceeded. Quota resets tomorrow; your work remains saved locally.'
        );
      } else {
        showToast('Could not save report online. Check your connection.');
      }
    } finally {
      setIsSavingOnline(false);
    }
  };

  const handleUploadLocalReportToCloud = async (entry: InspectionReport) => {
    if (!user) return;
    setBusyReportId(entry.id);
    try {
      await saveReportOnline(user.uid, entry);
      showToast('Local report synced online');
    } catch {
      showToast('Could not sync report online');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleEditCloudReport = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(user.uid, reportId);
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setReport(loaded);
      setHasUnsavedCloudChanges(false);
      setActiveSectionCode('ALL');
      setFilterMode('all');
      setSearchQuery('');
      setViewMode('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Loaded online report for editing');
    } catch {
      showToast('Could not load report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handlePreviewCloudReport = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(user.uid, reportId);
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setReport(loaded);
      setHasUnsavedCloudChanges(false);
      setViewMode('report');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      showToast('Could not load report preview');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownloadCloudReportPdf = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(user.uid, reportId);
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      await exportInspectionToPdf(loaded, exportOptions);
      showToast('PDF report downloaded');
    } catch {
      showToast('Could not download report PDF');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownloadCloudReportExcel = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(user.uid, reportId);
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      await exportInspectionToExcel(loaded);
      showToast('Excel (.xlsx) report downloaded');
    } catch {
      showToast('Could not download Excel report');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleEmailCloudReport = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      const loaded = await loadReportWithPhotosOnline(user.uid, reportId);
      if (!loaded) {
        showToast('Report not found');
        return;
      }
      setEmailReportTarget(loaded);
    } catch {
      showToast('Could not load report for emailing');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDeleteCloudReport = async (reportId: string) => {
    if (!user) return;
    setBusyReportId(reportId);
    try {
      await deleteReportOnline(user.uid, reportId);
      await deleteSavedReportFromDb(reportId);
      setLocalReports((prev) => prev.filter((r) => r.id !== reportId));
      setCloudPhotos((prev) => prev.filter((p) => p.reportId !== reportId));
      if (report.id === reportId) {
        setReport(createBlankInspection());
        setHasUnsavedCloudChanges(false);
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
      showToast('Local snapshot removed');
    } catch {
      showToast('Could not delete snapshot');
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

  const handleCreateBlank = () => {
    const fresh = createBlankInspection();
    if (user?.displayName) {
      fresh.meta.inspectedBy = user.displayName;
      fresh.signOffs.performedBy.printedName = user.displayName;
    }
    setReport(fresh);
    setHasUnsavedCloudChanges(true);
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
    setViewMode('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Created a new blank IQAF-005 report');
  };

  const handleLoadSample = () => {
    setReport(createSampleInspection());
    setHasUnsavedCloudChanges(true);
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
  const currentReportNo = formatReportNo(
    report.meta.storeLocation,
    report.meta.dateOfInspection
  );

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
                  {hasUnsavedCloudChanges ? (
                    <span className="text-amber-700 font-medium">Unsaved</span>
                  ) : (
                    <span className="text-emerald-700 font-medium">Synced</span>
                  )}
                </div>
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
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">
              Store reports &amp; photos online
            </div>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors"
            >
              {isSigningIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
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
            {user ? cloudReports.length : localReports.length}
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
          <span className="font-mono tabular-nums opacity-80">67</span>
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
          const isComplete = stat.answered === stat.total;

          return (
            <button
              key={section.code}
              type="button"
              onClick={() => handleJumpToSection(section.code)}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                isActive
                  ? 'bg-red-50 text-red-900 font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="truncate">
                <span className="font-mono font-semibold mr-1.5">
                  {section.code}.
                </span>
                {section.title}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums shrink-0">
                {stat.no > 0 && (
                  <span className="text-red-700 font-semibold">{stat.no}!</span>
                )}
                <span
                  className={
                    isComplete
                      ? 'text-emerald-700 font-medium'
                      : 'text-slate-400'
                  }
                >
                  {stat.answered}/{stat.total}
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* =================================================================== */}
      {/* TOP NAVIGATION BAR (Strict 3-Zone Contract)                         */}
      {/* =================================================================== */}
      <header className="no-print sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8">
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

        {/* Zone 2: 5 Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
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
            isSignedIn={Boolean(user)}
            isSigningIn={isSigningIn}
            isSavingOnline={isSavingOnline}
            hasUnsavedCloudChanges={hasUnsavedCloudChanges}
            uploadingPhotoCount={photoSyncCounts.uploading}
            failedPhotoCount={photoSyncCounts.failed}
            localOnlyPhotoCount={photoSyncCounts.localOnly}
            totalPhotosCount={indexedPhotos.length}
            lastSyncedAt={lastSyncedAt}
            onSaveOnline={handleSaveCurrentReport}
            onRetryFailedPhotos={retryAllFailedPhotos}
            onSignIn={handleSignIn}
            onConnectivityChange={(online) => {
              showToast(
                online
                  ? 'Connection restored — ready to sync online'
                  : 'You are offline — edits and photos remain saved locally'
              );
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
      <div className="flex-1 flex min-h-0">
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

          {viewMode === 'reports' ? (
            <ReportsLibraryView
              user={user}
              authReady={authReady}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              isSigningIn={isSigningIn}
              currentReport={report}
              hasUnsavedCloudChanges={hasUnsavedCloudChanges}
              isSavingOnline={isSavingOnline}
              cloudReports={cloudReports}
              loadingCloudReports={loadingCloudReports}
              localReports={localReports}
              busyReportId={busyReportId}
              onCreateNewReport={handleCreateBlank}
              onLoadSampleReport={handleLoadSample}
              onSaveCurrentReport={handleSaveCurrentReport}
              onEditCloudReport={handleEditCloudReport}
              onPreviewCloudReport={handlePreviewCloudReport}
              onDownloadCloudReportPdf={handleDownloadCloudReportPdf}
              onDownloadCloudReportExcel={handleDownloadCloudReportExcel}
              onEmailCloudReport={handleEmailCloudReport}
              onDeleteCloudReport={handleDeleteCloudReport}
              onEditLocalReport={(entry) => {
                setReport(entry);
                setHasUnsavedCloudChanges(true);
                setViewMode('form');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                showToast('Loaded local snapshot for editing');
              }}
              onUploadLocalReportToCloud={handleUploadLocalReportToCloud}
              onDownloadLocalReportPdf={async (entry) => {
                setIsExporting(true);
                try {
                  await exportInspectionToPdf(entry, exportOptions);
                  showToast('PDF downloaded');
                } finally {
                  setIsExporting(false);
                }
              }}
              onDownloadLocalReportExcel={async (entry) => {
                setIsExportingExcel(true);
                try {
                  await exportInspectionToExcel(entry);
                  showToast('Excel (.xlsx) report downloaded');
                } finally {
                  setIsExportingExcel(false);
                }
              }}
              onEmailLocalReport={(entry) => setEmailReportTarget(entry)}
              onDeleteLocalReport={handleDeleteLocalReport}
            />
          ) : viewMode === 'summary' ? (
            <InspectionSummaryView
              report={report}
              totalStoredPhotosCount={totalUniqueStoredPhotos}
              onJumpToSection={handleJumpToSection}
              onJumpToItem={handleJumpToItem}
              onJumpToSignOff={() => handleJumpToSection('SIGNOFF')}
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
              onEmailReport={() => setEmailReportTarget(report)}
              isExporting={isExporting}
              isExportingExcel={isExportingExcel}
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
              onOpenCameraForItem={openCameraForItem}
              onAttachPhotosToItem={attachPhotosToItem}
              onRetryPhotoUpload={retryPhotoUpload}
              onUpdateCurrentPhotoCaption={updatePhotoCaption}
              onDeleteStoredPhoto={deleteStoredPhotoRecord}
              onInspectStoredPhoto={(record) =>
                setLightboxState({ kind: 'stored', record })
              }
            />
          ) : viewMode === 'report' ? (
            <ReportPreview
              report={report}
              exportOptions={exportOptions}
              onChangeExportOptions={setExportOptions}
              onExportPdf={handleExportPdf}
              onExportExcel={handleExportExcel}
              onEmailReport={() => setEmailReportTarget(report)}
              isExporting={isExporting}
              isExportingExcel={isExportingExcel}
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
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <JiangNanLogo />
                    <div className="border-l border-slate-200 pl-4">
                      <h1 className="text-lg font-bold text-slate-950 leading-tight">
                        Store Inspection Checklist
                      </h1>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                        Basis: {report.meta.documentationNo} (Rev.{' '}
                        {report.meta.revisionNo}) · 67 Compliance Items
                      </div>
                      <div className="text-xs font-mono font-semibold text-slate-800 mt-0.5 tabular-nums">
                        Report No.: {currentReportNo}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                      {isSavingOnline
                        ? 'Saving…'
                        : user
                          ? 'Save Online'
                          : 'Save Report'}
                    </button>
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
                  </div>
                </div>

                {/* Metadata Inputs matching PDF Header Table */}
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <label className="block">
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

                  <label className="block sm:col-span-2 lg:col-span-1">
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Store Location
                    </span>
                    <input
                      type="text"
                      maxLength={200}
                      value={report.meta.storeLocation}
                      onChange={(e) =>
                        updateMeta('storeLocation', e.target.value)
                      }
                      placeholder="e.g., BGC High Street South"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Time of Inspection
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

                  <label className="block">
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
                </div>

                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 space-y-1">
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
                  {user ? (
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
                  ) : (
                    <button
                      type="button"
                      onClick={handleSignIn}
                      disabled={isSigningIn}
                      className="font-semibold text-slate-700 hover:text-slate-950 hover:underline whitespace-nowrap"
                    >
                      Sign in to Save Online
                    </button>
                  )}
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
                          ? 'Uploaded immediately to Firestore when added, with taken timestamp recorded, and included in PDF exports'
                          : 'Saved locally in IndexedDB with taken timestamp recorded, and included in PDF exports'}
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

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <SignaturePad
                    title="Performed By"
                    roleSubtitle="Food Safety Compliance Officer"
                    value={report.signOffs.performedBy}
                    onChange={(next) =>
                      mutateReport((prev) => ({
                        ...prev,
                        updatedAt: new Date().toISOString(),
                        signOffs: { ...prev.signOffs, performedBy: next },
                      }))
                    }
                  />
                  <SignaturePad
                    title="Acknowledged By"
                    roleSubtitle="Restaurant / Shift Manager"
                    value={report.signOffs.acknowledgedBy}
                    onChange={(next) =>
                      mutateReport((prev) => ({
                        ...prev,
                        updatedAt: new Date().toISOString(),
                        signOffs: { ...prev.signOffs, acknowledgedBy: next },
                      }))
                    }
                  />
                  <SignaturePad
                    title="Noted By"
                    roleSubtitle="Area Manager"
                    value={report.signOffs.notedBy}
                    onChange={(next) =>
                      mutateReport((prev) => ({
                        ...prev,
                        updatedAt: new Date().toISOString(),
                        signOffs: { ...prev.signOffs, notedBy: next },
                      }))
                    }
                  />
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

              {/* Form Footer with automatic Report No. & IQAF-005 Basis */}
              <footer className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500">
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  Report No.: {currentReportNo}
                </span>
                <span>{IQAF_BASIS_STATEMENT}</span>
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

      {/* Quiet feedback toast */}
      {toastMessage && (
        <div
          role="status"
          className="no-print fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
