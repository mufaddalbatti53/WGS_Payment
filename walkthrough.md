# Walkthrough — Cascading Staff Suspension & Status Synchronization

## Key Accomplishments

### Cascading Status Synchronization (Admin & Staff Alignment)
- **Automatic Staff Suspension**:
  - When Super Admin suspends a parent Admin (`POST /superadmin/suspend/:id`), all staff accounts created by that Admin (`{ role: 'staff', adminId: parentId }`) are automatically set to `status: 'suspended'` in MongoDB.
  - Active staff sessions are terminated and blocked from logging in.
- **Automatic Staff Reactivation**:
  - When Super Admin resumes a parent Admin (`POST /superadmin/resume/:id`), all staff accounts linked to that Admin are automatically restored to `status: 'approved'`.
- **Status Modal & Revocation Sync**:
  - Updating account status via `POST /superadmin/update-limits/:id` or revoking access (`POST /superadmin/reject/:id`) automatically cascades the target status to all staff accounts under that Admin.

---

## Verification Summary

| Operation | Action | Staff Account Result |
| :--- | :--- | :--- |
| **Suspend Admin** | `POST /superadmin/suspend/:id` | All linked staff `status` set to `'suspended'` |
| **Resume Admin** | `POST /superadmin/resume/:id` | All linked staff `status` set to `'approved'` |
| **Reject Admin** | `POST /superadmin/reject/:id` | All linked staff `status` set to `'rejected'` |
| **Update Status Modal** | `POST /superadmin/update-limits/:id` | Cascades status update to all linked staff |
| **Node.js Syntax** | ✅ Passed | `server.js` clean check |
| **EJS Template Render** | ✅ Passed | Rendered `superadmin.ejs` (34.4 KB) with 0 errors |
