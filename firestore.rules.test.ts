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
    reason: 'isVerifiedUser() requires request.auth != null.',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof',
    collectionPath: '/reports/rep-001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isVerifiedUser() requires request.auth.token.email_verified == true.',
  },
  {
    id: 3,
    name: 'Owner Identity Spoofing',
    collectionPath: '/reports/rep-002',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidReport() enforces data.ownerId == request.auth.uid.',
  },
  {
    id: 4,
    name: 'Cross-User Get Leak',
    collectionPath: '/reports/rep-user-a',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'allow get checks existing().ownerId == request.auth.uid.',
  },
  {
    id: 5,
    name: 'Blanket List Scraping',
    collectionPath: '/reports',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list requires resource.data.ownerId == request.auth.uid.',
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
    name: 'Immutable Field Tampering',
    collectionPath: '/reports/rep-001',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'allow update enforces ownerId and createdAt immutability + affectedKeys().hasOnly.',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: '/reports/rep-001',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'allow update strictly requires incoming().updatedAt == request.time.',
  },
  {
    id: 10,
    name: 'Orphaned Photo Write',
    collectionPath: '/reports/missing-parent/photos/ph-001',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Master Gate isReportOwner() verifies exists() on parent report.',
  },
  {
    id: 11,
    name: 'Cross-Owner Photo Injection',
    collectionPath: '/reports/rep-user-a/photos/ph-evil',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Master Gate checks parent report ownerId == request.auth.uid.',
  },
  {
    id: 12,
    name: 'Value Poisoning Oversized Caption / Invalid Item Number',
    collectionPath: '/reports/rep-001/photos/ph-001',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPhoto() enforces caption.size() <= 500 and itemNumber in 1..67.',
  },
];
