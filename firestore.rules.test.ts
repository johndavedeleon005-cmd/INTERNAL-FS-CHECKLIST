/**
 * Phase 0 Security Rules Verification Specification (Dirty Dozen Test Cases)
 * Documents the 12 adversarial payloads that must be rejected by firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expected: 'PERMISSION_DENIED';
  reason: string;
}

export const DIRTY_DOZEN_SECURITY_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Create',
    collectionPath: '/reports/rep-001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isSignedIn() requires request.auth != null.',
  },
  {
    id: 2,
    name: 'Unverified Email Collaborator Spoof',
    collectionPath: '/reports/rep-user-a',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'isDocCollaborator() requires isVerifiedUser() (request.auth.token.email_verified == true).',
  },
  {
    id: 3,
    name: 'Owner Identity Spoofing',
    collectionPath: '/reports/rep-002',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'allow create enforces incoming().ownerId == request.auth.uid.',
  },
  {
    id: 4,
    name: 'Cross-User Get Leak',
    collectionPath: '/reports/rep-user-a',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'allow get restricts access to owner or verified email in sharedWithEmails.',
  },
  {
    id: 5,
    name: 'Blanket List Scraping',
    collectionPath: '/shareLinks',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list on /shareLinks requires resource.data.ownerId == request.auth.uid.',
  },
  {
    id: 6,
    name: 'Shadow Ghost Field Injection',
    collectionPath: '/reports/rep-001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidReport() enforces strict data.keys().hasOnly([...]).',
  },
  {
    id: 7,
    name: 'ID Poisoning Attack',
    collectionPath: '/reports/bad$id..injection',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidId(reportId) enforces ^[a-zA-Z0-9_\\-]+$ and <= 128 chars.',
  },
  {
    id: 8,
    name: 'Viewer Privilege Escalation',
    collectionPath: '/reports/rep-user-a',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Viewer is not in editorEmails and cannot modify responses or escalate role.',
  },
  {
    id: 9,
    name: 'Editor Sharing Hijack or Delete',
    collectionPath: '/reports/rep-user-a',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Editor action allowlist excludes sharedWithEmails, editorEmails, and ownerId; delete is owner-only.',
  },
  {
    id: 10,
    name: 'Share Link Hijack or Revoked Link Claim',
    collectionPath: '/reports/rep-user-a',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Claim action requires matching activeShareLinkId and active == true on /shareLinks/{shareId}.',
  },
  {
    id: 11,
    name: 'Orphaned or Spoofed Photo Write',
    collectionPath: '/reports/missing-parent/photos/ph-001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Master Gate checks parent report existence/editor role and uploadedByUid == request.auth.uid.',
  },
  {
    id: 12,
    name: 'Value Poisoning & Timestamp Forgery',
    collectionPath: '/reports/rep-001/photos/ph-001',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPhoto() enforces caption <= 500, itemNumber in 1..67, and updatedAt == request.time.',
  },
];
