import { useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import {
  ALL_CHECKLIST_ITEMS,
  ALL_PRESET_BRANCHES,
  FACILITY_BRANCHES,
  STORE_BRANCHES,
  TOTAL_ITEMS_COUNT,
  formatDisplayDate,
  formatReportNo,
  normalizeBranchName,
  resolveReportSequenceMap,
  type ReportSequenceRecord,
} from '../data/checklistData';
import type { InspectionReport } from '../types/inspection';
import type { CloudReportSummary } from '../utils/cloudReports';

interface BranchDashboardViewProps {
  currentReport: InspectionReport;
  cloudReports: CloudReportSummary[];
  sharedReports: CloudReportSummary[];
  localReports: InspectionReport[];
  loadingCloudReports: boolean;
  busyReportId: string | null;
  onStartAuditForBranch: (branchName?: string) => void;
  onLoadSampleReport: () => void;
  onOpenReportsLibrary: () => void;
  onOpenCurrentReport: () => void;
  onEditCloudReport: (reportId: string) => Promise<void>;
  onPreviewCloudReport: (reportId: string) => Promise<void>;
  onDownloadCloudReportPdf: (reportId: string) => Promise<void>;
  onDownloadCloudReportExcel: (reportId: string) => Promise<void>;
  onDownloadCloudReportDocx: (reportId: string) => Promise<void>;
  onDeleteCloudReport: (reportId: string) => Promise<void>;
  onLeaveSharedReport: (reportId: string) => Promise<void>;
  onEditLocalReport: (report: InspectionReport) => void;
  onDownloadLocalReportPdf: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportExcel: (report: InspectionReport) => Promise<void>;
  onDownloadLocalReportDocx: (report: InspectionReport) => Promise<void>;
  onDeleteLocalReport: (reportId: string) => Promise<void>;
  onDiscardCurrentDraft: () => void;
}

type ScoreBasis = 'average' | 'latest';
type SortOrder = 'desc' | 'asc';
type StatusFilter = 'all' | 'compliant' | 'attention' | 'failed' | 'unaudited';

interface NormalizedBranchReport {
  id: string;
  source: 'cloud' | 'shared' | 'local' | 'draft';
  branchKey: string;
  branchDisplay: string;
  dateOfInspection: string;
  year: string;
  reportSequence?: number;
  inspectedBy: string;
  ownerName?: string;
  accessRole?: 'owner' | 'editor' | 'viewer';
  updatedAtIso: string;
  createdAtIso: string;
  answered: number;
  yes: number;
  no: number;
  na: number;
  photoCount: number;
  complianceRate: number | null;
  localReportRef?: InspectionReport;
}

interface BranchRankingRow {
  branchKey: string;
  branchName: string;
  category: 'Store Branch' | 'Corporate & Support' | 'Custom Branch';
  reports: NormalizedBranchReport[];
  scoredReportsCount: number;
  averageScore: number | null;
  latestScore: number | null;
  previousScore: number | null;
  trendDelta: number | null;
  activeScore: number | null;
  totalDeviations: number;
  latestDeviations: number;
  totalPhotos: number;
  latestAuditDate: string;
  rank: number | null;
}

function summarizeReportResponses(report: InspectionReport) {
  let answered = 0;
  let yes = 0;
  let no = 0;
  let na = 0;
  let photoCount = 0;

  for (const item of ALL_CHECKLIST_ITEMS) {
    const resp = report.responses[item.number];
    if (!resp) continue;
    if (resp.complied) answered++;
    if (resp.complied === 'Yes') yes++;
    if (resp.complied === 'No') no++;
    if (resp.complied === 'N/A') na++;
    photoCount += resp.photos.length;
  }

  const applicable = yes + no;
  const complianceRate =
    applicable > 0 ? Math.round((yes / applicable) * 100) : null;

  return { answered, yes, no, na, photoCount, complianceRate };
}

function extractYear(dateStr: string): string {
  const match = (dateStr || '').trim().match(/^(\d{4})/);
  return match ? match[1] : 'Undated';
}

function getComplianceStatus(score: number | null): {
  key: 'compliant' | 'attention' | 'failed' | 'unaudited';
  label: string;
  textClass: string;
  barClass: string;
} {
  if (score === null) {
    return {
      key: 'unaudited',
      label: 'Not Audited',
      textClass: 'text-slate-400',
      barClass: 'bg-slate-200',
    };
  }
  if (score >= 85) {
    return {
      key: 'compliant',
      label: 'Compliant',
      textClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
    };
  }
  if (score >= 70) {
    return {
      key: 'attention',
      label: 'Needs Attention',
      textClass: 'text-amber-700',
      barClass: 'bg-amber-500',
    };
  }
  return {
    key: 'failed',
    label: 'Failed',
    textClass: 'text-red-700',
    barClass: 'bg-red-600',
  };
}

function getBranchCategory(
  branchKey: string
): 'Store Branch' | 'Corporate & Support' | 'Custom Branch' {
  if (STORE_BRANCHES.includes(branchKey)) return 'Store Branch';
  if (FACILITY_BRANCHES.includes(branchKey)) return 'Corporate & Support';
  return 'Custom Branch';
}

export function BranchDashboardView({
  currentReport,
  cloudReports,
  sharedReports,
  localReports,
  loadingCloudReports,
  busyReportId,
  onStartAuditForBranch,
  onLoadSampleReport,
  onOpenReportsLibrary,
  onOpenCurrentReport,
  onEditCloudReport,
  onPreviewCloudReport,
  onDownloadCloudReportPdf,
  onDownloadCloudReportExcel,
  onDownloadCloudReportDocx,
  onDeleteCloudReport,
  onLeaveSharedReport,
  onEditLocalReport,
  onDownloadLocalReportPdf,
  onDownloadLocalReportExcel,
  onDownloadLocalReportDocx,
  onDeleteLocalReport,
  onDiscardCurrentDraft,
}: BranchDashboardViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [scoreBasis, setScoreBasis] = useState<ScoreBasis>('average');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showUnauditedBranches, setShowUnauditedBranches] = useState(true);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Deduplicate all available reports across cloud, shared, local snapshots, and active working draft
  const allReports = useMemo<NormalizedBranchReport[]>(() => {
    const byId = new Map<string, NormalizedBranchReport>();

    for (const r of cloudReports) {
      const branchKey = normalizeBranchName(r.storeLocation);
      const applicable = r.stats.yes + r.stats.no;
      byId.set(r.id, {
        id: r.id,
        source: 'cloud',
        branchKey,
        branchDisplay: branchKey || 'UNASSIGNED BRANCH',
        dateOfInspection: r.dateOfInspection,
        year: extractYear(r.dateOfInspection),
        reportSequence: r.reportSequence,
        inspectedBy: r.inspectedBy,
        ownerName: r.ownerName,
        accessRole: r.accessRole,
        updatedAtIso: r.updatedAtIso,
        createdAtIso: r.createdAtIso,
        answered: r.stats.answered,
        yes: r.stats.yes,
        no: r.stats.no,
        na: r.stats.na,
        photoCount: r.stats.photoCount,
        complianceRate:
          applicable > 0 ? Math.round((r.stats.yes / applicable) * 100) : null,
      });
    }

    for (const r of sharedReports) {
      if (byId.has(r.id)) continue;
      const branchKey = normalizeBranchName(r.storeLocation);
      const applicable = r.stats.yes + r.stats.no;
      byId.set(r.id, {
        id: r.id,
        source: 'shared',
        branchKey,
        branchDisplay: branchKey || 'UNASSIGNED BRANCH',
        dateOfInspection: r.dateOfInspection,
        year: extractYear(r.dateOfInspection),
        reportSequence: r.reportSequence,
        inspectedBy: r.inspectedBy,
        ownerName: r.ownerName,
        accessRole: r.accessRole,
        updatedAtIso: r.updatedAtIso,
        createdAtIso: r.createdAtIso,
        answered: r.stats.answered,
        yes: r.stats.yes,
        no: r.stats.no,
        na: r.stats.na,
        photoCount: r.stats.photoCount,
        complianceRate:
          applicable > 0 ? Math.round((r.stats.yes / applicable) * 100) : null,
      });
    }

    for (const r of localReports) {
      if (byId.has(r.id)) continue;
      const branchKey = normalizeBranchName(r.meta.storeLocation);
      const st = summarizeReportResponses(r);
      byId.set(r.id, {
        id: r.id,
        source: 'local',
        branchKey,
        branchDisplay: branchKey || 'UNASSIGNED BRANCH',
        dateOfInspection: r.meta.dateOfInspection,
        year: extractYear(r.meta.dateOfInspection),
        reportSequence: r.meta.reportSequence,
        inspectedBy: r.meta.inspectedBy,
        updatedAtIso: r.updatedAt,
        createdAtIso: r.updatedAt,
        answered: st.answered,
        yes: st.yes,
        no: st.no,
        na: st.na,
        photoCount: st.photoCount,
        complianceRate: st.complianceRate,
        localReportRef: r,
      });
    }

    // Include active working draft if it has a branch and at least 1 answered item and isn't already listed
    const draftBranchKey = normalizeBranchName(currentReport.meta.storeLocation);
    const draftStats = summarizeReportResponses(currentReport);
    if (!byId.has(currentReport.id) && draftBranchKey && draftStats.answered > 0) {
      byId.set(currentReport.id, {
        id: currentReport.id,
        source: 'draft',
        branchKey: draftBranchKey,
        branchDisplay: draftBranchKey,
        dateOfInspection: currentReport.meta.dateOfInspection,
        year: extractYear(currentReport.meta.dateOfInspection),
        reportSequence: currentReport.meta.reportSequence,
        inspectedBy: currentReport.meta.inspectedBy,
        updatedAtIso: currentReport.updatedAt,
        createdAtIso: currentReport.updatedAt,
        answered: draftStats.answered,
        yes: draftStats.yes,
        no: draftStats.no,
        na: draftStats.na,
        photoCount: draftStats.photoCount,
        complianceRate: draftStats.complianceRate,
        localReportRef: currentReport,
      });
    }

    return Array.from(byId.values());
  }, [cloudReports, sharedReports, localReports, currentReport]);

  const sequenceMap = useMemo(() => {
    const records: ReportSequenceRecord[] = allReports.map((r) => ({
      id: r.id,
      storeLocation: r.branchDisplay,
      dateOfInspection: r.dateOfInspection,
      reportSequence: r.reportSequence,
      createdAt: r.createdAtIso,
      updatedAt: r.updatedAtIso,
    }));
    return resolveReportSequenceMap(records);
  }, [allReports]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const r of allReports) {
      if (r.year && r.year !== 'Undated') years.add(r.year);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [allReports]);

  const reportsInPeriod = useMemo(() => {
    if (selectedYear === 'ALL') return allReports;
    return allReports.filter((r) => r.year === selectedYear);
  }, [allReports, selectedYear]);

  // Aggregate per-branch metrics and assign canonical Highest -> Lowest compliance ranks
  const allBranchRows = useMemo<BranchRankingRow[]>(() => {
    const grouped = new Map<string, NormalizedBranchReport[]>();

    // Seed all preset branches so coverage & unaudited tracking are accurate
    for (const preset of ALL_PRESET_BRANCHES) {
      grouped.set(preset, []);
    }

    for (const r of reportsInPeriod) {
      const key = r.branchKey || 'UNASSIGNED BRANCH';
      const existing = grouped.get(key);
      if (existing) existing.push(r);
      else grouped.set(key, [r]);
    }

    const rows: BranchRankingRow[] = [];

    for (const [branchKey, branchReports] of grouped.entries()) {
      // Skip UNASSIGNED if empty
      if (branchKey === 'UNASSIGNED BRANCH' && branchReports.length === 0) {
        continue;
      }

      // Sort reports newest-first
      const sortedReports = [...branchReports].sort((a, b) => {
        const dateCmp = (b.dateOfInspection || '').localeCompare(
          a.dateOfInspection || ''
        );
        if (dateCmp !== 0) return dateCmp;
        const seqCmp =
          (b.reportSequence ?? sequenceMap.get(b.id) ?? 0) -
          (a.reportSequence ?? sequenceMap.get(a.id) ?? 0);
        if (seqCmp !== 0) return seqCmp;
        return (b.updatedAtIso || '').localeCompare(a.updatedAtIso || '');
      });

      const scoredReports = sortedReports.filter((r) => r.complianceRate !== null);
      const averageScore =
        scoredReports.length > 0
          ? Math.round(
              scoredReports.reduce((acc, r) => acc + (r.complianceRate ?? 0), 0) /
                scoredReports.length
            )
          : null;

      const latestScore =
        scoredReports.length > 0 ? scoredReports[0].complianceRate : null;
      const previousScore =
        scoredReports.length > 1 ? scoredReports[1].complianceRate : null;
      const trendDelta =
        latestScore !== null && previousScore !== null
          ? latestScore - previousScore
          : null;

      const activeScore = scoreBasis === 'average' ? averageScore : latestScore;

      const totalDeviations = sortedReports.reduce((sum, r) => sum + r.no, 0);
      const latestDeviations = sortedReports[0]?.no ?? 0;
      const totalPhotos = sortedReports.reduce((sum, r) => sum + r.photoCount, 0);
      const latestAuditDate = sortedReports[0]?.dateOfInspection ?? '';

      rows.push({
        branchKey,
        branchName: branchKey,
        category: getBranchCategory(branchKey),
        reports: sortedReports,
        scoredReportsCount: scoredReports.length,
        averageScore,
        latestScore,
        previousScore,
        trendDelta,
        activeScore,
        totalDeviations,
        latestDeviations,
        totalPhotos,
        latestAuditDate,
        rank: null,
      });
    }

    // Assign canonical rank (#1 = highest compliance, ties broken by fewer deviations then more reports then alphabetical)
    const rankedOnly = rows
      .filter((r) => r.activeScore !== null)
      .sort((a, b) => {
        const scoreDiff = (b.activeScore ?? -1) - (a.activeScore ?? -1);
        if (scoreDiff !== 0) return scoreDiff;
        const devDiff = a.latestDeviations - b.latestDeviations;
        if (devDiff !== 0) return devDiff;
        const countDiff = b.reports.length - a.reports.length;
        if (countDiff !== 0) return countDiff;
        return a.branchName.localeCompare(b.branchName);
      });

    rankedOnly.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    return rows;
  }, [reportsInPeriod, scoreBasis, sequenceMap]);

  // Network-wide KPI metrics
  const kpis = useMemo(() => {
    const scoredBranches = allBranchRows
      .filter((r) => r.activeScore !== null)
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

    const scoredReports = reportsInPeriod.filter((r) => r.complianceRate !== null);
    const networkAvg =
      scoredReports.length > 0
        ? Math.round(
            scoredReports.reduce((sum, r) => sum + (r.complianceRate ?? 0), 0) /
              scoredReports.length
          )
        : null;

    const highestBranch = scoredBranches[0] ?? null;
    const lowestBranch =
      scoredBranches.length > 0
        ? scoredBranches[scoredBranches.length - 1]
        : null;

    const auditedPresetCount = ALL_PRESET_BRANCHES.filter((branch) =>
      allBranchRows.some((r) => r.branchKey === branch && r.reports.length > 0)
    ).length;

    const totalDeviations = reportsInPeriod.reduce((sum, r) => sum + r.no, 0);

    return {
      networkAvg,
      scoredBranchesCount: scoredBranches.length,
      totalReportsCount: reportsInPeriod.length,
      highestBranch,
      lowestBranch,
      auditedPresetCount,
      totalPresetCount: ALL_PRESET_BRANCHES.length,
      totalDeviations,
    };
  }, [allBranchRows, reportsInPeriod]);

  // Filtered and ordered rows for display
  const visibleBranchRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = allBranchRows.filter((row) => {
      const statusKey = getComplianceStatus(row.activeScore).key;

      if (statusFilter !== 'all' && statusKey !== statusFilter) {
        return false;
      }

      if (
        statusFilter === 'all' &&
        !showUnauditedBranches &&
        row.reports.length === 0
      ) {
        return false;
      }

      if (q) {
        const reportNos = row.reports
          .map((r) =>
            formatReportNo(
              r.branchDisplay,
              r.dateOfInspection,
              r.reportSequence ?? sequenceMap.get(r.id)
            )
          )
          .join(' ');
        const inspectors = row.reports.map((r) => r.inspectedBy).join(' ');
        const haystack =
          `${row.branchName} ${row.category} ${reportNos} ${inspectors}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      const aScored = a.activeScore !== null;
      const bScored = b.activeScore !== null;

      // Always keep audited/scored branches ahead of unaudited ones
      if (aScored !== bScored) return aScored ? -1 : 1;

      if (!aScored && !bScored) {
        // Put branches with incomplete drafts ahead of 0-report branches
        if (a.reports.length !== b.reports.length) {
          return b.reports.length - a.reports.length;
        }
        return a.branchName.localeCompare(b.branchName);
      }

      const rankA = a.rank ?? 9999;
      const rankB = b.rank ?? 9999;
      return sortOrder === 'desc' ? rankA - rankB : rankB - rankA;
    });
  }, [
    allBranchRows,
    searchQuery,
    statusFilter,
    showUnauditedBranches,
    sortOrder,
    sequenceMap,
  ]);

  const toggleBranchExpanded = (branchKey: string) => {
    setExpandedBranches((prev) => ({
      ...prev,
      [branchKey]: !prev[branchKey],
    }));
  };

  const handleOpenReportRow = (item: NormalizedBranchReport) => {
    if (item.source === 'draft') {
      onOpenCurrentReport();
      return;
    }
    if (item.source === 'local' && item.localReportRef) {
      onEditLocalReport(item.localReportRef);
      return;
    }
    void onEditCloudReport(item.id);
  };

  const handleDownloadRowPdf = (item: NormalizedBranchReport) => {
    if ((item.source === 'local' || item.source === 'draft') && item.localReportRef) {
      void onDownloadLocalReportPdf(item.localReportRef);
      return;
    }
    void onDownloadCloudReportPdf(item.id);
  };

  const handleDownloadRowExcel = (item: NormalizedBranchReport) => {
    if ((item.source === 'local' || item.source === 'draft') && item.localReportRef) {
      void onDownloadLocalReportExcel(item.localReportRef);
      return;
    }
    void onDownloadCloudReportExcel(item.id);
  };

  const handleDownloadRowDocx = (item: NormalizedBranchReport) => {
    if ((item.source === 'local' || item.source === 'draft') && item.localReportRef) {
      void onDownloadLocalReportDocx(item.localReportRef);
      return;
    }
    void onDownloadCloudReportDocx(item.id);
  };

  const handleConfirmRemoveRow = async (item: NormalizedBranchReport) => {
    try {
      if (item.source === 'cloud') {
        await onDeleteCloudReport(item.id);
      } else if (item.source === 'shared') {
        await onLeaveSharedReport(item.id);
      } else if (item.source === 'local') {
        await onDeleteLocalReport(item.id);
      } else {
        onDiscardCurrentDraft();
      }
    } finally {
      setConfirmRemoveId(null);
    }
  };

  return (
    <div className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-950 tracking-tight">
            Branch Compliance Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            All branch inspection reports ranked from highest to lowest
            compliance score. Click any branch to inspect its reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenReportsLibrary}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FolderKanban className="w-3.5 h-3.5 text-slate-500" />
            All Reports
          </button>
          <button
            type="button"
            onClick={() => onStartAuditForBranch()}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            New Inspection
          </button>
        </div>
      </div>

      {/* 4-Column Executive KPI Strip (Single-Elevation, Divided by Hairlines) */}
      <section
        aria-label="Network compliance summary"
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
      >
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Network Compliance
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-950">
              {kpis.networkAvg !== null ? `${kpis.networkAvg}%` : '—'}
            </span>
            {kpis.networkAvg !== null && (
              <span
                className={`text-xs font-semibold ${
                  getComplianceStatus(kpis.networkAvg).textClass
                }`}
              >
                {getComplianceStatus(kpis.networkAvg).label}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {kpis.totalReportsCount}{' '}
            {kpis.totalReportsCount === 1 ? 'report' : 'reports'} ·{' '}
            {kpis.totalDeviations} total deviations
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Highest Compliance (#1)
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-slate-950 truncate">
              {kpis.highestBranch ? kpis.highestBranch.branchName : '—'}
            </span>
            {kpis.highestBranch?.activeScore !== null &&
              kpis.highestBranch?.activeScore !== undefined && (
                <span className="text-xl font-bold font-mono tabular-nums text-emerald-700 shrink-0">
                  {kpis.highestBranch.activeScore}%
                </span>
              )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums truncate">
            {kpis.highestBranch
              ? `${kpis.highestBranch.reports.length} ${
                  kpis.highestBranch.reports.length === 1 ? 'report' : 'reports'
                } · ${kpis.highestBranch.latestDeviations} latest deviations`
              : 'No audited branches yet'}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Lowest Compliance
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-slate-950 truncate">
              {kpis.lowestBranch ? kpis.lowestBranch.branchName : '—'}
            </span>
            {kpis.lowestBranch?.activeScore !== null &&
              kpis.lowestBranch?.activeScore !== undefined && (
                <span
                  className={`text-xl font-bold font-mono tabular-nums shrink-0 ${
                    getComplianceStatus(kpis.lowestBranch.activeScore).textClass
                  }`}
                >
                  {kpis.lowestBranch.activeScore}%
                </span>
              )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums truncate">
            {kpis.lowestBranch
              ? `Rank #${kpis.lowestBranch.rank} · ${kpis.lowestBranch.latestDeviations} latest deviations`
              : 'No audited branches yet'}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Branch Coverage
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-950">
              {kpis.auditedPresetCount}/{kpis.totalPresetCount}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              ({Math.round((kpis.auditedPresetCount / kpis.totalPresetCount) * 100)}
              %)
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {kpis.scoredBranchesCount} ranked{' '}
            {kpis.scoredBranchesCount === 1 ? 'location' : 'locations'}
            {selectedYear !== 'ALL' ? ` in ${selectedYear}` : ''}
          </div>
        </div>
      </section>

      {/* Filter & Ranking Controls */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branch name, report no. (e.g. INSPLND-BANAWE-26-001), or inspector…"
              className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Year Filter */}
            <select
              aria-label="Filter by inspection year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="h-9 px-2.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
            >
              <option value="ALL">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  Year {yr}
                </option>
              ))}
            </select>

            {/* Score Basis Segmented Control */}
            <div
              className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg"
              role="group"
              aria-label="Ranking score basis"
            >
              <button
                type="button"
                onClick={() => setScoreBasis('average')}
                className={`px-2.5 h-8 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  scoreBasis === 'average'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Avg Score
              </button>
              <button
                type="button"
                onClick={() => setScoreBasis('latest')}
                className={`px-2.5 h-8 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  scoreBasis === 'latest'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Latest Audit
              </button>
            </div>

            {/* Sort Order Toggle */}
            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
              }
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {sortOrder === 'desc' ? (
                <>
                  <ArrowDownWideNarrow className="w-3.5 h-3.5 text-slate-600" />
                  Highest to Lowest
                </>
              ) : (
                <>
                  <ArrowUpNarrowWide className="w-3.5 h-3.5 text-slate-600" />
                  Lowest to Highest
                </>
              )}
            </button>
          </div>
        </div>

        {/* Status Filter Bar + Unaudited Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'All Branches' },
                { id: 'compliant', label: 'Compliant (≥85%)' },
                { id: 'attention', label: 'Needs Attention (70–84%)' },
                { id: 'failed', label: 'Failed (<70%)' },
                { id: 'unaudited', label: 'Not Audited' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {statusFilter === 'all' && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUnauditedBranches}
                onChange={(e) => setShowUnauditedBranches(e.target.checked)}
                className="rounded border-slate-300 text-red-700 focus:ring-red-700"
              />
              <span>Show unaudited branches ({kpis.totalPresetCount - kpis.auditedPresetCount})</span>
            </label>
          )}
        </div>
      </section>

      {/* Empty Callout when no reports exist at all */}
      {!loadingCloudReports && allReports.length === 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-950">
              No inspection reports recorded yet
            </h2>
            <p className="text-xs text-slate-600 mt-1 max-w-xl leading-relaxed">
              Complete and save store inspections to populate live compliance
              rankings across all 20 branch and facility locations. You can load
              the sample BANAWE audit or click Start Audit on any branch below.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onLoadSampleReport}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-500" />
              Load Sample Report
            </button>
            <button
              type="button"
              onClick={() => onStartAuditForBranch()}
              className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              Start First Audit
            </button>
          </div>
        </section>
      )}

      {/* Main Ranked Branch Compliance Table & Expandable Branch Reports */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-950">
              Branch Compliance Rankings ({visibleBranchRows.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ranked by{' '}
              {scoreBasis === 'average'
                ? 'average compliance rate'
                : 'most recent inspection score'}{' '}
              ({sortOrder === 'desc' ? 'highest to lowest' : 'lowest to highest'})
            </p>
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Compliant ≥85% · Needs Attention 70–84% · Failed &lt;70%
          </div>
        </div>

        {loadingCloudReports && allReports.length === 0 ? (
          <div className="divide-y divide-slate-200">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-8 h-4 bg-slate-200 rounded" />
                  <div className="space-y-1.5 flex-1 max-w-xs">
                    <div className="h-4 bg-slate-200 rounded w-40" />
                    <div className="h-3 bg-slate-100 rounded w-28" />
                  </div>
                </div>
                <div className="h-3 bg-slate-200 rounded w-48 hidden md:block" />
                <div className="h-4 bg-slate-200 rounded w-16" />
              </div>
            ))}
          </div>
        ) : visibleBranchRows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              No branches match your current filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setSelectedYear('ALL');
                setShowUnauditedBranches(true);
              }}
              className="mt-3 px-3 h-8 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {/* Desktop Column Header */}
            <div className="hidden md:grid md:grid-cols-12 gap-3 px-5 py-2.5 bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
              <div className="col-span-1">Rank</div>
              <div className="col-span-3">Branch</div>
              <div className="col-span-4">Compliance Score</div>
              <div className="col-span-1 text-right">Reports</div>
              <div className="col-span-1 text-right">Deviations</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {visibleBranchRows.map((row) => {
              const status = getComplianceStatus(row.activeScore);
              const isExpanded = Boolean(expandedBranches[row.branchKey]);
              const hasReports = row.reports.length > 0;

              return (
                <div key={row.branchKey} className="bg-white">
                  {/* Branch Summary Row */}
                  <div
                    className={`px-5 py-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center transition-colors ${
                      hasReports ? 'hover:bg-slate-50/70' : 'hover:bg-slate-50/40'
                    }`}
                  >
                    {/* Rank */}
                    <div className="md:col-span-1 flex items-center justify-between md:justify-start gap-2">
                      <span
                        className={`font-mono tabular-nums text-sm font-bold ${
                          row.rank === 1
                            ? 'text-emerald-700'
                            : row.rank !== null
                              ? 'text-slate-900'
                              : 'text-slate-300'
                        }`}
                      >
                        {row.rank !== null ? `#${row.rank}` : '—'}
                      </span>
                      <span className="md:hidden text-xs font-mono font-bold tabular-nums">
                        {row.activeScore !== null ? (
                          <span className={status.textClass}>
                            {row.activeScore}% · {status.label}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not Audited</span>
                        )}
                      </span>
                    </div>

                    {/* Branch Name & Quiet Metadata */}
                    <div className="md:col-span-3 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          hasReports
                            ? toggleBranchExpanded(row.branchKey)
                            : onStartAuditForBranch(row.branchName)
                        }
                        className="group text-left flex items-center gap-1.5 max-w-full"
                      >
                        {hasReports ? (
                          isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-700 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 shrink-0" />
                          )
                        ) : (
                          <span className="w-4 shrink-0" aria-hidden="true" />
                        )}
                        <span className="text-sm font-bold text-slate-950 group-hover:text-red-700 transition-colors truncate">
                          {row.branchName}
                        </span>
                      </button>
                      <div className="pl-5.5 text-xs text-slate-500 mt-0.5 truncate tabular-nums">
                        <span>{row.category}</span>
                        {row.latestAuditDate && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>
                              Last {formatDisplayDate(row.latestAuditDate)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Compliance Bar + Score + Status + Trend */}
                    <div className="md:col-span-4 space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-sm font-bold text-slate-950">
                            {row.activeScore !== null ? `${row.activeScore}%` : '—'}
                          </span>
                          <span className={`font-semibold ${status.textClass}`}>
                            {status.label}
                          </span>
                        </div>
                        {row.trendDelta !== null ? (
                          <span
                            className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${
                              row.trendDelta > 0
                                ? 'text-emerald-700'
                                : row.trendDelta < 0
                                  ? 'text-red-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            {row.trendDelta > 0 ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : row.trendDelta < 0 ? (
                              <TrendingDown className="w-3 h-3" />
                            ) : null}
                            {row.trendDelta > 0 ? `+${row.trendDelta}%` : `${row.trendDelta}%`} vs prev
                          </span>
                        ) : row.averageScore !== null &&
                          row.latestScore !== null &&
                          row.scoredReportsCount > 1 ? (
                          <span className="font-mono text-[11px] text-slate-500">
                            {scoreBasis === 'average'
                              ? `Latest ${row.latestScore}%`
                              : `Avg ${row.averageScore}%`}
                          </span>
                        ) : null}
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${status.barClass}`}
                          style={{
                            width: `${row.activeScore !== null ? Math.max(2, row.activeScore) : 0}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Reports Count */}
                    <div className="hidden md:block md:col-span-1 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums">
                      {row.reports.length}
                    </div>

                    {/* Deviations Count */}
                    <div className="hidden md:block md:col-span-1 text-right font-mono text-xs tabular-nums">
                      <span
                        className={
                          row.totalDeviations > 0
                            ? 'font-semibold text-red-700'
                            : 'text-slate-500'
                        }
                      >
                        {row.totalDeviations}
                      </span>
                    </div>

                    {/* Row Actions */}
                    <div className="md:col-span-2 flex items-center justify-end gap-2">
                      {hasReports ? (
                        <button
                          type="button"
                          onClick={() => toggleBranchExpanded(row.branchKey)}
                          className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          {isExpanded ? 'Hide' : 'Reports'} ({row.reports.length})
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onStartAuditForBranch(row.branchName)}
                          className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          <FilePlus2 className="w-3.5 h-3.5 text-slate-500" />
                          Start Audit
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Per-Branch Reports Sub-Table */}
                  {isExpanded && hasReports && (
                    <div className="bg-slate-50/80 border-t border-slate-200 px-5 py-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700">
                          {row.branchName} — Inspection History ({row.reports.length}{' '}
                          {row.reports.length === 1 ? 'report' : 'reports'})
                        </div>
                        <button
                          type="button"
                          onClick={() => onStartAuditForBranch(row.branchName)}
                          className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold text-red-700 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          <FilePlus2 className="w-3 h-3" />
                          New Audit for {row.branchName}
                        </button>
                      </div>

                      <div className="divide-y divide-slate-200 border-t border-slate-200">
                        {row.reports.map((rep) => {
                          const repNo = formatReportNo(
                            rep.branchDisplay,
                            rep.dateOfInspection,
                            rep.reportSequence ?? sequenceMap.get(rep.id)
                          );
                          const repStatus = getComplianceStatus(rep.complianceRate);
                          const isBusy = busyReportId === rep.id;
                          const isReadOnly = rep.accessRole === 'viewer';
                          const sourceLabel =
                            rep.source === 'cloud'
                              ? 'Online'
                              : rep.source === 'shared'
                                ? `Shared by ${rep.ownerName || 'Team'}`
                                : rep.source === 'draft'
                                  ? 'Current Draft (Unsaved)'
                                  : 'Local Snapshot';

                          return (
                            <div
                              key={rep.id}
                              className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                                  <span className="font-mono text-xs font-bold text-slate-950">
                                    {repNo}
                                  </span>
                                  <span
                                    className={`font-mono text-xs font-bold tabular-nums ${repStatus.textClass}`}
                                  >
                                    {rep.complianceRate !== null
                                      ? `${rep.complianceRate}% (${repStatus.label})`
                                      : 'In Progress'}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span>
                                    {formatDisplayDate(rep.dateOfInspection) ||
                                      'No date'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{rep.inspectedBy || 'No inspector'}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{sourceLabel}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono text-slate-600">
                                    {rep.answered}/{TOTAL_ITEMS_COUNT} checked ·{' '}
                                    {rep.yes} Yes ·{' '}
                                    <span
                                      className={
                                        rep.no > 0
                                          ? 'text-red-700 font-semibold'
                                          : ''
                                      }
                                    >
                                      {rep.no} No
                                    </span>{' '}
                                    · {rep.photoCount} photos
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleOpenReportRow(rep)}
                                  className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : isReadOnly ? (
                                    <Eye className="w-3.5 h-3.5" />
                                  ) : (
                                    <Pencil className="w-3.5 h-3.5" />
                                  )}
                                  {isReadOnly ? 'Open' : 'Edit'}
                                </button>
                                {(rep.source === 'cloud' ||
                                  rep.source === 'shared') && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => onPreviewCloudReport(rep.id)}
                                    className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                                  >
                                    <FileCheck2 className="w-3.5 h-3.5" />
                                    Preview
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDownloadRowDocx(rep)}
                                  className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  DOCX
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDownloadRowExcel(rep)}
                                  className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                                >
                                  <FileSpreadsheet className="w-3.5 h-3.5" />
                                  Excel
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDownloadRowPdf(rep)}
                                  className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  PDF
                                </button>
                                {confirmRemoveId === rep.id ? (
                                  <div className="inline-flex items-center gap-1.5 ml-1">
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => void handleConfirmRemoveRow(rep)}
                                      className={`px-2.5 h-8 text-xs font-semibold text-white rounded-md transition-colors whitespace-nowrap disabled:opacity-50 ${
                                        rep.source === 'shared'
                                          ? 'bg-slate-900 hover:bg-slate-800'
                                          : 'bg-red-700 hover:bg-red-800'
                                      }`}
                                    >
                                      {rep.source === 'shared'
                                        ? 'Confirm Remove'
                                        : rep.source === 'draft'
                                          ? 'Confirm Discard'
                                          : 'Confirm Delete'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => setConfirmRemoveId(null)}
                                      className="px-2 h-8 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => setConfirmRemoveId(rep.id)}
                                    className="inline-flex items-center justify-center w-8 h-8 text-slate-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 rounded-md transition-colors shrink-0"
                                    aria-label={
                                      rep.source === 'shared'
                                        ? 'Remove shared report from dashboard'
                                        : rep.source === 'draft'
                                          ? 'Discard unsaved draft'
                                          : rep.source === 'local'
                                            ? 'Delete local report'
                                            : 'Delete online report'
                                    }
                                    title={
                                      rep.source === 'shared'
                                        ? 'Remove shared report'
                                        : rep.source === 'draft'
                                          ? 'Discard unsaved draft'
                                          : rep.source === 'local'
                                            ? 'Delete local report'
                                            : 'Delete online report'
                                    }
                                  >
                                    {rep.source === 'shared' ? (
                                      <UserMinus className="w-4 h-4" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
