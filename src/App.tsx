import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCheck,
  Download,
  FileCheck2,
  FilePlus2,
  Loader2,
  Menu,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  CHECKLIST_SECTIONS,
  HOW_TO_FILL_INSTRUCTION,
  TOTAL_ITEMS_COUNT,
  createBlankInspection,
  createEmptyResponse,
  createSampleInspection,
} from './data/checklistData';
import type {
  InspectionReport,
  ItemResponse,
  PdfExportOptions,
  PhotoProof,
} from './types/inspection';
import { collectIndexedPhotos, exportInspectionToPdf } from './utils/pdfExporter';
import { InspectionItemRow } from './components/InspectionItemRow';
import { JiangNanLogo } from './components/JiangNanLogo';
import { PhotoLightbox } from './components/PhotoLightbox';
import { ReportPreview } from './components/ReportPreview';
import { SavedReportsDrawer } from './components/SavedReportsDrawer';
import { SignaturePad } from './components/SignaturePad';

const DRAFT_STORAGE_KEY = 'iqaf005_active_draft_v1';
const HISTORY_STORAGE_KEY = 'iqaf005_saved_history_v1';

type ViewMode = 'form' | 'report';
type FilterMode = 'all' | 'unanswered' | 'Yes' | 'No' | 'N/A' | 'photos';

function loadInitialDraft(): InspectionReport {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return createBlankInspection();
    const parsed = JSON.parse(raw) as InspectionReport;
    if (!parsed || !parsed.meta || !parsed.responses) {
      return createBlankInspection();
    }
    // Ensure all 67 items exist cleanly
    const normalizedResponses: Record<number, ItemResponse> = {};
    for (const item of ALL_CHECKLIST_ITEMS) {
      normalizedResponses[item.number] =
        parsed.responses[item.number] ?? createEmptyResponse();
    }
    return {
      ...parsed,
      responses: normalizedResponses,
    };
  } catch {
    return createBlankInspection();
  }
}

function loadSavedHistory(): InspectionReport[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [report, setReport] = useState<InspectionReport>(loadInitialDraft);
  const [savedReports, setSavedReports] =
    useState<InspectionReport[]>(loadSavedHistory);
  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSectionCode, setActiveSectionCode] = useState<string>('ALL');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const [exportOptions, setExportOptions] = useState<PdfExportOptions>({
    includePhotoAppendix: true,
    includeInlineThumbnails: false,
  });

  const [lightboxState, setLightboxState] = useState<{
    itemNumber: number;
    itemText: string;
    photoId: string;
  } | null>(null);

  // Auto-save active inspection draft to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(report));
      setStorageWarning(null);
    } catch {
      setStorageWarning(
        'Browser storage is full due to attached photos. Export your PDF to save this inspection safely.'
      );
    }
  }, [report]);

  // Persist history list
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(savedReports));
    } catch {
      // Ignore quota issue on history
    }
  }, [savedReports]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

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
      bySection,
    };
  }, [report.responses]);

  const indexedPhotos = useMemo(() => collectIndexedPhotos(report), [report]);

  const updateMeta = <K extends keyof InspectionReport['meta']>(
    key: K,
    value: InspectionReport['meta'][K]
  ) => {
    setReport((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      meta: { ...prev.meta, [key]: value },
    }));
  };

  const updateItemResponse = (itemNumber: number, next: ItemResponse) => {
    setReport((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      responses: {
        ...prev.responses,
        [itemNumber]: next,
      },
    }));
  };

  const markSectionAllYes = (sectionCode: string) => {
    const section = CHECKLIST_SECTIONS.find((s) => s.code === sectionCode);
    if (!section) return;
    setReport((prev) => {
      const nextResponses = { ...prev.responses };
      for (const item of section.items) {
        const current = nextResponses[item.number] ?? createEmptyResponse();
        // Only fill unanswered items if some already have No/N/A, OR set all to Yes if none are No
        if (!current.complied) {
          nextResponses[item.number] = { ...current, complied: 'Yes' };
        }
      }
      // If all were already answered, set all in section to Yes
      const allAlreadyAnswered = section.items.every(
        (it) => Boolean(prev.responses[it.number]?.complied)
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

  const handleSaveSnapshot = () => {
    const snapshot: InspectionReport = {
      ...report,
      updatedAt: new Date().toISOString(),
    };
    setSavedReports((prev) => {
      const filtered = prev.filter((r) => r.id !== snapshot.id);
      return [snapshot, ...filtered];
    });
    showToast('Inspection saved to local audit history');
  };

  const handleCreateBlank = () => {
    setReport(createBlankInspection());
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
    setViewMode('form');
    showToast('Started a new blank IQAF-005 inspection');
  };

  const handleLoadSample = () => {
    setReport(createSampleInspection());
    setActiveSectionCode('ALL');
    setFilterMode('all');
    setSearchQuery('');
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

  // Active photo for lightbox
  const activeLightboxPhoto: PhotoProof | null = useMemo(() => {
    if (!lightboxState) return null;
    const resp = report.responses[lightboxState.itemNumber];
    if (!resp) return null;
    return resp.photos.find((p) => p.id === lightboxState.photoId) ?? null;
  }, [lightboxState, report.responses]);

  // Helper for Prev/Next section stepping when viewing a single section
  const activeSectionIdx = CHECKLIST_SECTIONS.findIndex(
    (s) => s.code === activeSectionCode
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Progress summary */}
      <div className="px-4 py-4 border-b border-slate-200">
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
        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
          <span className="text-emerald-700 font-medium">{metrics.yes} Yes</span>
          <span aria-hidden="true">·</span>
          <span className={metrics.no > 0 ? 'text-red-700 font-semibold' : ''}>
            {metrics.no} No
          </span>
          <span aria-hidden="true">·</span>
          <span>{metrics.na} N/A</span>
          <span aria-hidden="true">·</span>
          <span>{metrics.totalPhotos} Photos</span>
        </div>
      </div>

      {/* Navigation list */}
      <nav
        className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5"
        aria-label="Checklist sections"
      >
        <button
          type="button"
          onClick={() => handleJumpToSection('ALL')}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'form' && activeSectionCode === 'ALL'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span>All Sections (A–Q)</span>
          <span className="font-mono tabular-nums opacity-80">67</span>
        </button>

        <button
          type="button"
          onClick={() => handleJumpToSection('HEADER')}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          <span>Store &amp; Audit Details</span>
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
                  <span className="text-red-700 font-semibold">
                    {stat.no}!
                  </span>
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

        {/* Zone 2: Clean Single-Line Nav Links */}
        <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('form')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'form'
                ? 'border-red-700 text-slate-950 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Inspection Form
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
            Report Preview
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="py-1 border-b-2 border-transparent hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Saved Audits
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
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

      {/* Mobile View Switcher bar (visible only < sm) */}
      <div className="no-print sm:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
          <button
            type="button"
            onClick={() => setViewMode('form')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'form'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => setViewMode('report')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'report'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            Report Preview
          </button>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          Saved Audits
        </button>
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
                Checklist Sections
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
            <div className="no-print bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-900">
              {storageWarning}
            </div>
          )}

          {viewMode === 'report' ? (
            <ReportPreview
              report={report}
              exportOptions={exportOptions}
              onChangeExportOptions={setExportOptions}
              onExportPdf={handleExportPdf}
              isExporting={isExporting}
              onBackToForm={() => setViewMode('form')}
              onInspectPhoto={(itemNumber, itemText, photo) =>
                setLightboxState({ itemNumber, itemText, photoId: photo.id })
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
                        Doc No. {report.meta.documentationNo} · Revision{' '}
                        {report.meta.revisionNo} · 67 Compliance Items
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleLoadSample}
                      className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-slate-500" />
                      Fill Sample
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateBlank}
                      className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      <FilePlus2 className="w-3.5 h-3.5 text-slate-500" />
                      Reset
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
                      value={report.meta.inspectedBy}
                      onChange={(e) =>
                        updateMeta('inspectedBy', e.target.value)
                      }
                      placeholder="Inspector full name"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    />
                  </label>
                </div>

                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 italic leading-relaxed">
                  {HOW_TO_FILL_INSTRUCTION}
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
                              onInspectPhoto={(photo) =>
                                setLightboxState({
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
                        Automatically indexed and appended to the exported
                        IQAF-005 PDF report
                      </p>
                    </div>
                    <Camera className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {indexedPhotos.map((entry) => (
                      <button
                        key={entry.photo.id}
                        type="button"
                        onClick={() =>
                          setLightboxState({
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
                      Quality Assurance Department · Form #: IQAF-005 · Revision
                      No.: 0
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <SignaturePad
                    title="Performed By"
                    roleSubtitle="Food Safety Compliance Officer"
                    value={report.signOffs.performedBy}
                    onChange={(next) =>
                      setReport((prev) => ({
                        ...prev,
                        updatedAt: new Date().toISOString(),
                        signOffs: { ...prev.signOffs, performedBy: next },
                      }))
                    }
                  />
                  <SignaturePad
                    title="Acknowledged By"
                    roleSubtitle="Restaurant / Shift Manager / Area Manager"
                    value={report.signOffs.acknowledgedBy}
                    onChange={(next) =>
                      setReport((prev) => ({
                        ...prev,
                        updatedAt: new Date().toISOString(),
                        signOffs: { ...prev.signOffs, acknowledgedBy: next },
                      }))
                    }
                  />
                  <SignaturePad
                    title="Noted By"
                    roleSubtitle="Immediate Manager"
                    value={report.signOffs.notedBy}
                    onChange={(next) =>
                      setReport((prev) => ({
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
                    Ready to review the IQAF-005 Report?
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
                <div className="flex items-center gap-2.5 shrink-0">
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
            </div>
          )}
        </main>
      </div>

      {/* Photo Lightbox Modal */}
      {lightboxState && activeLightboxPhoto && (
        <PhotoLightbox
          photo={activeLightboxPhoto}
          itemNumber={lightboxState.itemNumber}
          itemText={lightboxState.itemText}
          onUpdateCaption={(caption) => {
            const current =
              report.responses[lightboxState.itemNumber] ??
              createEmptyResponse();
            updateItemResponse(lightboxState.itemNumber, {
              ...current,
              photos: current.photos.map((p) =>
                p.id === activeLightboxPhoto.id ? { ...p, caption } : p
              ),
            });
          }}
          onDelete={() => {
            const current =
              report.responses[lightboxState.itemNumber] ??
              createEmptyResponse();
            updateItemResponse(lightboxState.itemNumber, {
              ...current,
              photos: current.photos.filter(
                (p) => p.id !== activeLightboxPhoto.id
              ),
            });
          }}
          onClose={() => setLightboxState(null)}
        />
      )}

      {/* Saved Audits Drawer */}
      <SavedReportsDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentReportId={report.id}
        savedReports={savedReports}
        onSaveCurrentSnapshot={handleSaveSnapshot}
        onLoadReport={(loaded) => {
          setReport(loaded);
          showToast('Loaded saved inspection');
        }}
        onDeleteReport={(id) => {
          setSavedReports((prev) => prev.filter((r) => r.id !== id));
          showToast('Removed saved audit');
        }}
        onCreateBlank={handleCreateBlank}
        onLoadSample={handleLoadSample}
      />

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
