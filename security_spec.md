# IQAF-005 Store Inspection Checklist — Firestore Security Specification

## 1. Data Invariants

1. **Report Ownership**: Every document in `/reports/{reportId}` must have `ownerId == request.auth.uid`, an authenticated verified user (`request.auth.token.email_verified == true`), and a strict alphanumeric/hyphen/underscore `reportId` (`<= 128` chars).
2. **Photo Master Gate**: Every document in `/reports/{reportId}/photos/{photoId}` cannot be read (`get`), created, updated, or deleted unless the parent `/reports/{reportId}` exists AND `parent.ownerId == request.auth.uid`.
3. **Immutable Identity & Timestamps**: `ownerId`, `createdAt`, and (for photos) `reportId` are strictly immutable after creation. All `createdAt` and `updatedAt` fields must equal server `request.time`.
4. **Strict Schema & Size Guards**: No shadow/ghost keys allowed on create (`hasAll` + `hasOnly`) or update (`affectedKeys().hasOnly(...)`). Every string field has an explicit `.size()` ceiling to prevent resource exhaustion.
5. **No Blanket List Reads**: `allow list` on both `/reports` and `/reports/{reportId}/photos` enforces `resource.data.ownerId == request.auth.uid` without calling `get()`/`exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)

1. **Unauthenticated Create**: Anonymous client attempts `create` on `/reports/rep-1` with valid schema.
2. **Unverified Email Spoof**: Authenticated client with `email_verified: false` attempts `create` or `update` on `/reports/rep-1`.
3. **Owner Identity Spoofing**: User A attempts `create` on `/reports/rep-2` setting `ownerId: "user-b"`.
4. **Cross-User Read (PII/Data Leak)**: User B attempts `get` on User A's `/reports/rep-1` or `/reports/rep-1/photos/ph-1`.
5. **Blanket List Scraping**: User B attempts `list` on `/reports` without `where('ownerId', '==', 'user-b')`.
6. **Shadow / Ghost Field Injection**: User A attempts `create` or `update` on `/reports/rep-1` adding an undeclared key `isAdmin: true`.
7. **ID Poisoning**: User A attempts `create` on `/reports/rep..invalid$chars` or a 200-char ID.
8. **Immutable Field Tampering**: User A attempts `update` on `/reports/rep-1` modifying `ownerId` or `createdAt`.
9. **Client Timestamp Forgery**: User A attempts `create` or `update` with a backdated `updatedAt` timestamp instead of `serverTimestamp()` (`request.time`).
10. **Orphaned Photo Write**: User A attempts `create` on `/reports/nonexistent-report/photos/ph-1` where parent report does not exist.
11. **Cross-Owner Photo Injection**: User B attempts `create` on `/reports/user-a-report/photos/ph-evil` with `ownerId: "user-b"`.
12. **Value Poisoning / Oversized Payload**: User A attempts `update` on `/reports/rep-1/photos/ph-1` setting `caption` to a 2,000-char string (exceeding `maxLength: 500`) or `itemNumber: 999` (outside 1..67).
