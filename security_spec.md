# IQAF-005 Store Inspection Checklist — Firestore Security Specification

## 1. Data Invariants

1. **Verified Identity Required**: Every read and write across `/reports`, `/reports/{reportId}/photos`, and `/shareLinks` requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
2. **Tiered Report Access & Sharing**:
   - **Owner (`ownerId == request.auth.uid`)**: Full read, edit, share/revoke (`sharedWithEmails`, `editorEmails`, `activeShareLinkId`, `activeShareRole`), and delete rights.
   - **Editor (`email.lower() in editorEmails && email.lower() in sharedWithEmails`)**: Can read and collaboratively edit report responses, metadata, sign-offs, stats, `photoIds`, `syncVersion`, and upload/update/delete photos on the report. Cannot delete the report or modify sharing permissions (`sharedWithEmails`, `editorEmails`, `activeShareLinkId`, `activeShareRole`).
   - **Viewer (`email.lower() in sharedWithEmails`, not in `editorEmails`)**: Read-only access to the report and its photos. Cannot modify report content or photos. May leave the shared report by removing only their own email.
3. **Bounded Collaborator & Photo Lists**: `sharedWithEmails` and `editorEmails` are strictly bounded (`<= 25` entries); `photoIds` is strictly bounded (`<= 250` entries).
4. **Master Gate on Photos**: Every `get`, `create`, `update`, and `delete` on `/reports/{reportId}/photos/{photoId}` verifies parent `/reports/{reportId}` existence and current role (Owner, Editor, or Viewer) via `get()` after authentication and static schema validation. Revoking a collaborator on the parent report immediately revokes all photo access.
5. **Secret-Gated Share Link Claiming**: `/shareLinks/{shareId}` contains zero PII/emails and cannot be listed by non-owners. A verified user claiming a share link on `/reports/{reportId}` must supply the exact secret `activeShareLinkId` in `lastClaimedShareLinkId`, verify the link is `active == true` and matches `reportId`, and can only append their own verified lowercase email to `sharedWithEmails` (and `editorEmails` only when `activeShareRole == 'editor'`).
6. **Immutable Identity & Server Timestamps**: `ownerId`, `createdAt`, `reportId` (on photos & shareLinks), and `uploadedByUid` (on photos) are immutable after creation. All `createdAt` and `updatedAt` fields strictly equal `request.time`.
7. **Zero `get()`/`exists()` in `allow list`**: Every `allow list` rule validates `resource.data` directly against `request.auth.uid` or `request.auth.token.email.lower()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)

1. **Unauthenticated Create**: Anonymous client attempts `create` on `/reports/rep-1` with valid schema.
2. **Unverified Email Spoof**: Authenticated client with `email_verified: false` attempts `create`, `update`, or `get` on `/reports/rep-1`.
3. **Owner Identity Spoofing**: User A attempts `create` on `/reports/rep-2` setting `ownerId: "user-b"`.
4. **Cross-User Read (PII/Data Leak)**: User B (not in `sharedWithEmails`) attempts `get` on User A's `/reports/rep-1` or `/reports/rep-1/photos/ph-1`.
5. **Blanket List Scraping**: User B attempts `list` on `/reports` or `/shareLinks` without matching `ownerId` or `sharedWithEmails`.
6. **Shadow / Ghost Field Injection**: Owner or Editor attempts `create` or `update` adding an undeclared key `isAdmin: true`.
7. **ID Poisoning**: User attempts `create` on `/reports/rep..invalid$chars` or a 200-char document ID.
8. **Viewer Privilege Escalation**: A Viewer collaborator attempts `update` on `/reports/rep-1` to edit `responses` or add themselves to `editorEmails`.
9. **Editor Sharing Hijack**: An Editor collaborator attempts `update` on `/reports/rep-1` to add another email to `sharedWithEmails`, change `ownerId`, or `delete` the report.
10. **Share Link Guessing / Hijack**: User C attempts `update` on `/reports/rep-1` to add themselves to `sharedWithEmails` without supplying the matching secret `lastClaimedShareLinkId`, or using a revoked (`active: false`) share link.
11. **Orphaned / Cross-Owner Photo Write**: User attempts `create` on `/reports/nonexistent/photos/ph-1` or sets `uploadedByUid` to someone else's UID.
12. **Value Poisoning & Client Timestamp Forgery**: User attempts `update` with a backdated `updatedAt`, an oversized `caption` (> 500 chars), > 25 `sharedWithEmails`, or `syncVersion: -5`.
