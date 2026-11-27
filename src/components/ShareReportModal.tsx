import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Check,
  Copy,
  Link2,
  Link2Off,
  Loader2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { formatReportNo } from '../data/checklistData';
import {
  type CloudReportSummary,
  buildShareUrl,
  createOrUpdateShareLinkOnline,
  isValidEmailAddress,
  normalizeEmail,
  revokeShareLinkOnline,
  updateReportCollaboratorsOnline,
} from '../utils/cloudReports';

interface ShareReportModalProps {
  user: User;
  reportSummary: CloudReportSummary;
  onClose: () => void;
  onUpdated?: (message: string) => void;
}

export function ShareReportModal({
  user,
  reportSummary,
  onClose,
  onUpdated,
}: ShareReportModalProps) {
  const [emailInput, setEmailInput] = useState('');
  const [newRole, setNewRole] = useState<'viewer' | 'editor'>('viewer');
  const [linkRole, setLinkRole] = useState<'viewer' | 'editor'>(
    reportSummary.activeShareRole === 'editor' ? 'editor' : 'viewer'
  );
  const [sharedEmails, setSharedEmails] = useState<string[]>(
    reportSummary.sharedWithEmails
  );
  const [editorEmails, setEditorEmails] = useState<string[]>(
    reportSummary.editorEmails
  );
  const [activeShareLinkId, setActiveShareLinkId] = useState<string | null>(
    reportSummary.activeShareLinkId
  );
  const [activeShareRole, setActiveShareRole] = useState<'none' | 'viewer' | 'editor'>(
    reportSummary.activeShareRole
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'share' | 'direct' | null>(null);

  // Keep modal synchronized with live Firestore updates
  useEffect(() => {
    setSharedEmails(reportSummary.sharedWithEmails);
    setEditorEmails(reportSummary.editorEmails);
    setActiveShareLinkId(reportSummary.activeShareLinkId);
    setActiveShareRole(reportSummary.activeShareRole);
    if (reportSummary.activeShareRole === 'viewer' || reportSummary.activeShareRole === 'editor') {
      setLinkRole(reportSummary.activeShareRole);
    }
  }, [reportSummary]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const ownerName = user.displayName || user.email || 'Inspector';
  const ownerEmailLower = user.email ? normalizeEmail(user.email) : '';
  const reportNo = formatReportNo(
    reportSummary.storeLocation,
    reportSummary.dateOfInspection,
    reportSummary.reportSequence
  );

  const shareLinkUrl = activeShareLinkId
    ? buildShareUrl({ shareId: activeShareLinkId })
    : '';
  const directReportUrl = buildShareUrl({ reportId: reportSummary.id });

  const copyText = async (text: string, target: 'share' | 'direct') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === target ? null : prev));
      }, 2000);
    } catch {
      setErrorMsg('Could not copy automatically — please select and copy the URL.');
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const email = normalizeEmail(emailInput);

    if (!isValidEmailAddress(email)) {
      setErrorMsg('Please enter a valid Google email address.');
      return;
    }
    if (email === ownerEmailLower) {
      setErrorMsg('You are already the owner of this report.');
      return;
    }
    if (sharedEmails.includes(email)) {
      setErrorMsg(`${email} already has access. Change their role below if needed.`);
      return;
    }
    if (sharedEmails.length >= 25) {
      setErrorMsg('Maximum of 25 collaborators per report reached.');
      return;
    }

    const nextShared = [...sharedEmails, email];
    const nextEditors =
      newRole === 'editor' ? [...editorEmails, email] : [...editorEmails];

    setBusyAction('add');
    try {
      const saved = await updateReportCollaboratorsOnline(
        user.uid,
        user.email,
        ownerName,
        reportSummary.id,
        nextShared,
        nextEditors
      );
      setSharedEmails(saved.sharedWithEmails);
      setEditorEmails(saved.editorEmails);
      setEmailInput('');
      onUpdated?.(`Shared with ${email} (${newRole === 'editor' ? 'Editor' : 'Viewer'})`);
    } catch {
      setErrorMsg('Could not add collaborator. Please check your connection and try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleChangeCollaboratorRole = async (
    email: string,
    role: 'viewer' | 'editor'
  ) => {
    setErrorMsg(null);
    const nextEditors =
      role === 'editor'
        ? Array.from(new Set([...editorEmails, email]))
        : editorEmails.filter((e) => e !== email);

    setBusyAction(`role:${email}`);
    try {
      const saved = await updateReportCollaboratorsOnline(
        user.uid,
        user.email,
        ownerName,
        reportSummary.id,
        sharedEmails,
        nextEditors
      );
      setSharedEmails(saved.sharedWithEmails);
      setEditorEmails(saved.editorEmails);
      onUpdated?.(`Updated ${email} to ${role === 'editor' ? 'Editor' : 'Viewer'}`);
    } catch {
      setErrorMsg('Could not update role. Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveCollaborator = async (email: string) => {
    setErrorMsg(null);
    const nextShared = sharedEmails.filter((e) => e !== email);
    const nextEditors = editorEmails.filter((e) => e !== email);

    setBusyAction(`remove:${email}`);
    try {
      const saved = await updateReportCollaboratorsOnline(
        user.uid,
        user.email,
        ownerName,
        reportSummary.id,
        nextShared,
        nextEditors
      );
      setSharedEmails(saved.sharedWithEmails);
      setEditorEmails(saved.editorEmails);
      onUpdated?.(`Removed ${email} from report`);
    } catch {
      setErrorMsg('Could not remove collaborator. Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateOrUpdateShareLink = async (role: 'viewer' | 'editor') => {
    setErrorMsg(null);
    setBusyAction('link');
    try {
      const res = await createOrUpdateShareLinkOnline(
        user.uid,
        ownerName,
        {
          id: reportSummary.id,
          documentationNo: reportSummary.documentationNo,
          storeLocation: reportSummary.storeLocation,
          dateOfInspection: reportSummary.dateOfInspection,
          reportSequence: reportSummary.reportSequence,
          activeShareLinkId,
          sharedWithEmails: sharedEmails,
          editorEmails,
        },
        role
      );
      setActiveShareLinkId(res.shareId);
      setActiveShareRole(res.role);
      setLinkRole(res.role);
      onUpdated?.(
        activeShareLinkId
          ? `Share link updated to ${role === 'editor' ? 'Can Edit' : 'Can View'}`
          : 'Shareable link created'
      );
    } catch {
      setErrorMsg('Could not create shareable link. Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeShareLink = async () => {
    if (!activeShareLinkId) return;
    setErrorMsg(null);
    setBusyAction('revoke');
    try {
      await revokeShareLinkOnline(reportSummary.id, activeShareLinkId);
      setActiveShareLinkId(null);
      setActiveShareRole('none');
      onUpdated?.('Share link revoked');
    } catch {
      setErrorMsg('Could not revoke share link. Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-report-modal-title"
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="share-report-modal-title"
              className="text-base font-bold text-slate-950 leading-tight"
            >
              Share Inspection Report
            </h2>
            <p className="text-xs text-slate-600 mt-0.5 truncate">
              {reportSummary.storeLocation || 'Untitled Store Location'}
            </p>
            <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
              {reportNo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            aria-label="Close share dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="px-3.5 py-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Section 1: Invite Collaborators by Email */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Users className="w-3.5 h-3.5 text-slate-600" />
                <span>People with Access</span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                {sharedEmails.length}/25 collaborators
              </span>
            </div>

            <form
              onSubmit={handleAddCollaborator}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="colleague@company.com"
                disabled={busyAction !== null}
                className="flex-1 h-9 px-3 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newRole}
                  onChange={(e) =>
                    setNewRole(e.target.value === 'editor' ? 'editor' : 'viewer')
                  }
                  disabled={busyAction !== null}
                  aria-label="Collaborator role"
                  className="h-9 px-2.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  type="submit"
                  disabled={busyAction !== null || !emailInput.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  {busyAction === 'add' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  Add
                </button>
              </div>
            </form>

            {/* Owner + Collaborator list */}
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
              <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-slate-50/70">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {ownerName} (You)
                  </div>
                  {user.email && (
                    <div className="text-[11px] text-slate-500 truncate">
                      {user.email}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                  Owner
                </span>
              </div>

              {sharedEmails.length === 0 ? (
                <div className="px-3.5 py-3 text-xs text-slate-500">
                  Only you have access. Add an email above to share directly to
                  a teammate&apos;s &ldquo;Shared With Me&rdquo; library.
                </div>
              ) : (
                sharedEmails.map((email) => {
                  const isEditor = editorEmails.includes(email);
                  const isRowBusy =
                    busyAction === `role:${email}` ||
                    busyAction === `remove:${email}`;
                  return (
                    <div
                      key={email}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-slate-800 truncate min-w-0">
                        {email}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={isEditor ? 'editor' : 'viewer'}
                          disabled={busyAction !== null}
                          onChange={(e) =>
                            handleChangeCollaboratorRole(
                              email,
                              e.target.value === 'editor' ? 'editor' : 'viewer'
                            )
                          }
                          aria-label={`Role for ${email}`}
                          className="h-7 px-2 text-[11px] font-medium bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-slate-400"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => handleRemoveCollaborator(email)}
                          className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          aria-label={`Remove ${email}`}
                          title="Revoke access"
                        >
                          {isRowBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {sharedEmails.length > 0 && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Invited teammates see this report automatically in their
                  library.
                </span>
                <button
                  type="button"
                  onClick={() => copyText(directReportUrl, 'direct')}
                  className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-950 whitespace-nowrap"
                >
                  {copiedTarget === 'direct' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-700" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy Direct Link
                    </>
                  )}
                </button>
              </div>
            )}
          </section>

          {/* Section 2: Shareable Invite Link */}
          <section className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Link2 className="w-3.5 h-3.5 text-slate-600" />
                <span>Shareable Link</span>
              </div>
              {activeShareLinkId && (
                <span className="text-[11px] font-semibold text-emerald-700">
                  Active · {activeShareRole === 'editor' ? 'Can Edit' : 'Can View'}
                </span>
              )}
            </div>

            {!activeShareLinkId ? (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Generate a secure link for Store Managers, Area Managers, or
                  QA reviewers. Recipients sign in with Google to open the
                  report and attached photos.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={linkRole}
                    onChange={(e) =>
                      setLinkRole(
                        e.target.value === 'editor' ? 'editor' : 'viewer'
                      )
                    }
                    disabled={busyAction !== null}
                    aria-label="Share link access level"
                    className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-800"
                  >
                    <option value="viewer">Anyone with link can View</option>
                    <option value="editor">Anyone with link can Edit</option>
                  </select>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleCreateOrUpdateShareLink(linkRole)}
                    className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    {busyAction === 'link' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    Create Share Link
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-emerald-50/40 border border-emerald-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareLinkUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 h-8 px-2.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(shareLinkUrl, 'share')}
                    className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedTarget === 'share' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600">
                      Link access:
                    </span>
                    <select
                      value={linkRole}
                      disabled={busyAction !== null}
                      onChange={(e) => {
                        const next =
                          e.target.value === 'editor' ? 'editor' : 'viewer';
                        setLinkRole(next);
                        void handleCreateOrUpdateShareLink(next);
                      }}
                      aria-label="Update share link access"
                      className="h-7 px-2 text-[11px] font-medium bg-white border border-slate-300 rounded-md text-slate-800"
                    >
                      <option value="viewer">Can View</option>
                      <option value="editor">Can Edit</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleRevokeShareLink}
                    className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    {busyAction === 'revoke' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Link2Off className="w-3 h-3" />
                    )}
                    Revoke Link
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-[11px] text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <span>
                Verified Google sign-in is required to open shared reports.
                Revoking access immediately blocks photo and report reads.
              </span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-8 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
