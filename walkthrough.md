# Walkthrough — Mobile Super Admin & Real-Time App-Side Enforcements

## Key Accomplishments

### 1. Mobile-Friendly Super Admin Control Center (`views/superadmin.ejs`)
- **Responsive Layout & Header**: Header collapses into clean vertical stack on mobile screens with touched-optimized action buttons.
- **Adaptive Stats Grid**: Automatically scales from 4 columns on desktop down to 2 columns on tablets and 1 column on mobile devices.
- **Touch-Scrollable Tabs**: Tabs feature smooth horizontal touch scrolling (`overflow-x: auto; scrollbar-width: none`), preventing awkward text wrapping on small displays.
- **Responsive Data Tables & Modals**: Tables enable smooth horizontal touch swiping inside `.card-table`, and `#limitsModal` adapts to screen height (`max-height: 90vh; overflow-y: auto; width: 92%`).

---

### 2. App-Side Enforcement & Real-Time Alert System

#### A. Account Suspension Alert & Lockout
- **Action**: Super Admin suspends an Admin via `POST /superadmin/suspend/:id`.
- **App-Side Result**:
  - `requireLogin` middleware and `POST /login` destroy session and display alert:
    `⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin to reactivate your account.`
  - All linked staff accounts are locked out simultaneously.
  - **Zero Data Loss**: Resuming an account restores full access with all customer and billing data intact.

#### B. 10-Day Subscription Expiry Warning Alert
- **Action**: Super Admin sets a `planExpiryDate` in the Manage Limits modal.
- **App-Side Result**:
  - When plan expires in **10 days or fewer**, a warning banner appears at the top of the Admin Dashboard and Staff view:
    `⏰ Subscription Expiry Warning: Your plan expires in X day(s) (on DD/MM/YYYY). Please contact Super Admin to renew your subscription.`
  - Once expired, login is blocked with prompt to renew.

#### C. Quota Limits & Enforcement
- **Party / Customer Limit (`maxCustomersLimit`)**:
  - Enforced on both single party creation (`POST /customers`) and Excel bulk import (`POST /import`).
  - Displays top warning banner on dashboard if creation/import is attempted past limit.
- **Staff Limit (`maxStaffLimit`)**:
  - Enforced in `POST /create-staff`.
  - `views/staff.ejs` displays real-time badge: `Staff Limit: X / Y`.
- **Daily Reminder Limit (`dailyMessageLimit`)**:
  - Enforced in `POST /customers/:id/auto-snooze`. Returns error notice if daily limit is reached.

---

## Verification Summary

| Component | Status | Verification Details |
| :--- | :--- | :--- |
| **Super Admin Mobile CSS** | ✅ Passed | Added `@media` query rules for 992px, 768px, and 480px |
| **EJS Template Render** | ✅ Passed | Rendered all 7 templates cleanly with mock contexts |
| **Node.js Syntax** | ✅ Passed | `node --check server.js` returned 0 errors |
| **Suspension Alert** | ✅ Passed | Session destroy & alert notice on login/requireLogin |
| **10-Day Expiry Alert** | ✅ Passed | Dynamic calculation & banner on `index.ejs` & `staff.ejs` |
| **Excel Import Quota** | ✅ Passed | Checked `maxCustomersLimit` before bulk write |
