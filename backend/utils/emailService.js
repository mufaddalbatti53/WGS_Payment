const nodemailer = require('nodemailer');
const User = require('../models/User');
const PlanConfig = require('../models/PlanConfig');

const FRONTEND_URL = (process.env.FRONTEND_ORIGIN || process.env.PUBLIC_APP_ORIGIN || 'https://payment.webgraphicsstudio.in').replace(/\/+$/, '');

function createTransporter() {
    const host = (process.env.SMTP_HOST || '').trim();
    const user = (process.env.SMTP_USER || '').trim();
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;

    const port = parseInt(process.env.SMTP_PORT) || 465;
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000
    });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isValidEmail(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(str.trim());
}

function getClientEmails(user) {
    if (!user) return [];
    const candidates = [user.companyEmail, user.email, user.googleEmail];
    const unique = new Set();
    for (const c of candidates) {
        if (isValidEmail(c)) unique.add(c.trim().toLowerCase());
    }
    return Array.from(unique);
}

async function getSuperAdminEmails() {
    const unique = new Set();
    try {
        const config = await PlanConfig.getOrCreateSingleton();
        if (config && isValidEmail(config.superadminEmail)) {
            unique.add(config.superadminEmail.trim().toLowerCase());
        }
    } catch (e) {}

    if (isValidEmail(process.env.SUPERADMIN_EMAIL)) {
        unique.add(process.env.SUPERADMIN_EMAIL.trim().toLowerCase());
    }

    try {
        const saUsers = await User.find({ role: 'superadmin' }).select('email companyEmail').lean();
        for (const sa of saUsers) {
            if (isValidEmail(sa.email)) unique.add(sa.email.trim().toLowerCase());
            if (isValidEmail(sa.companyEmail)) unique.add(sa.companyEmail.trim().toLowerCase());
        }
    } catch (e) {}

    if (isValidEmail(process.env.SMTP_USER)) {
        unique.add(process.env.SMTP_USER.trim().toLowerCase());
    }

    return Array.from(unique);
}

async function sendEmailSafe({ to, subject, html }) {
    try {
        const recipients = (Array.isArray(to) ? to : [to]).filter(isValidEmail);
        if (!recipients.length) return false;

        const transporter = createTransporter();
        if (!transporter) {
            console.warn('[EmailService] SMTP not configured; skipping email:', subject);
            return false;
        }

        await transporter.sendMail({
            from: `"WGS Payment Tracker" <${(process.env.SMTP_USER || '').trim()}>`,
            to: recipients.join(', '),
            subject,
            html
        });
        return true;
    } catch (err) {
        console.error('[EmailService] Failed to send email:', subject, err.message);
        return false;
    }
}

function formatDateIN(dateVal) {
    if (!dateVal) return 'Lifetime / Not Set';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Lifetime / Not Set';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildEmailWrapper(headerTitle, headerSubtitle, headerBg, bodyHtml) {
    return `
    <div style="font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);">
        <div style="background: ${headerBg || 'linear-gradient(135deg, #0f2d52, #1558cc)'}; color: #ffffff; padding: 28px 30px;">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; opacity: 0.85; margin-bottom: 6px;">WGS Payment Tracker</div>
            <h2 style="margin: 0; font-size: 22px; font-weight: 800; line-height: 1.3;">${headerTitle}</h2>
            ${headerSubtitle ? `<p style="margin: 6px 0 0 0; font-size: 13.5px; opacity: 0.9;">${headerSubtitle}</p>` : ''}
        </div>
        <div style="padding: 28px 30px; color: #1e293b; font-size: 14px; line-height: 1.6;">
            ${bodyHtml}
            <div style="margin-top: 26px; padding-top: 18px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
                <p style="margin: 0 0 6px 0;"><strong>WGS Payment Tracker</strong> — Smart Ledger, Aging Analysis & Automated Reminders</p>
                <a href="${FRONTEND_URL}" style="color: #1558cc; font-weight: 700; text-decoration: none;">${FRONTEND_URL}</a>
            </div>
        </div>
    </div>`;
}

/**
 * Syncs staff quota locks when an Admin's maxStaffLimit changes (via plan purchase, renewal, add-on, or SuperAdmin edit).
 * If totalStaff > maxStaffLimit and preferredActiveStaffIds is NOT supplied, sets requiresStaffSelection = true on the Admin
 * and pauses excess staff until the Admin selects which maxStaffLimit staff get access.
 */
async function syncStaffQuotaForAdmin(adminId, maxStaffLimit, preferredActiveStaffIds = null) {
    if (!adminId) return { totalStaff: 0, maxStaffLimit: 0, activeStaffCount: 0, pausedStaffCount: 0, requiresSelection: false, staffList: [] };

    const staffList = await User.find({ role: 'staff', adminId }).sort({ _id: 1 });
    const totalStaff = staffList.length;
    const limit = Number(maxStaffLimit ?? 5);

    // Unlimited (0) or total staff fits within the plan's maxStaffLimit
    if (limit <= 0 || totalStaff <= limit) {
        if (totalStaff > 0) {
            await User.updateMany({ role: 'staff', adminId }, { $set: { isQuotaLocked: false } });
        }
        await User.findByIdAndUpdate(adminId, { $set: { requiresStaffSelection: false } });
        const updatedStaff = staffList.map(s => ({
            _id: s._id,
            username: s.username,
            status: s.status,
            isQuotaLocked: false
        }));
        return {
            totalStaff,
            maxStaffLimit: limit,
            activeStaffCount: totalStaff,
            pausedStaffCount: 0,
            requiresSelection: false,
            staffList: updatedStaff
        };
    }

    // Total staff exceeds the new plan's maxStaffLimit (e.g., 5 staff exist, new plan allows 3)
    if (Array.isArray(preferredActiveStaffIds) && preferredActiveStaffIds.length > 0) {
        const allowedSet = new Set(preferredActiveStaffIds.slice(0, limit).map(id => String(id)));
        const activeIds = [];
        const lockedIds = [];

        for (const s of staffList) {
            if (allowedSet.has(String(s._id)) && activeIds.length < limit) {
                activeIds.push(s._id);
            } else {
                lockedIds.push(s._id);
            }
        }

        if (activeIds.length > 0) {
            await User.updateMany({ _id: { $in: activeIds }, role: 'staff', adminId }, { $set: { isQuotaLocked: false, status: 'approved' } });
        }
        if (lockedIds.length > 0) {
            await User.updateMany({ _id: { $in: lockedIds }, role: 'staff', adminId }, { $set: { isQuotaLocked: true } });
        }
        await User.findByIdAndUpdate(adminId, { $set: { requiresStaffSelection: false } });

        const updatedStaff = staffList.map(s => ({
            _id: s._id,
            username: s.username,
            status: s.status,
            isQuotaLocked: !activeIds.some(id => String(id) === String(s._id))
        }));

        return {
            totalStaff,
            maxStaffLimit: limit,
            activeStaffCount: activeIds.length,
            pausedStaffCount: lockedIds.length,
            requiresSelection: false,
            staffList: updatedStaff
        };
    }

    // No explicit selection made yet — pause excess staff and require Admin to choose which `limit` staff get access
    const activeIds = staffList.slice(0, limit).map(s => s._id);
    const lockedIds = staffList.slice(limit).map(s => s._id);

    if (activeIds.length > 0) {
        await User.updateMany({ _id: { $in: activeIds }, role: 'staff', adminId }, { $set: { isQuotaLocked: false } });
    }
    if (lockedIds.length > 0) {
        await User.updateMany({ _id: { $in: lockedIds }, role: 'staff', adminId }, { $set: { isQuotaLocked: true } });
    }
    await User.findByIdAndUpdate(adminId, { $set: { requiresStaffSelection: true } });

    const updatedStaff = staffList.map((s, idx) => ({
        _id: s._id,
        username: s.username,
        status: s.status,
        isQuotaLocked: idx >= limit
    }));

    return {
        totalStaff,
        maxStaffLimit: limit,
        activeStaffCount: activeIds.length,
        pausedStaffCount: lockedIds.length,
        requiresSelection: true,
        staffList: updatedStaff
    };
}

/**
 * 1. Client Buys Plan on Landing Page
 */
async function notifyPlanPurchased(user, quote, paymentId, staffQuotaStatus = null) {
    const clientEmails = getClientEmails(user);
    const superAdminEmails = await getSuperAdminEmails();
    const addonsList = (quote.selectedAddons || []).map(a => `${a.name} (₹${Number(a.price || 0).toLocaleString('en-IN')})`).join(', ') || 'None';
    const expiryStr = formatDateIN(user.planExpiryDate);

    const staffWarningHtml = (staffQuotaStatus && staffQuotaStatus.requiresSelection)
        ? `<div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 14px 16px; border-radius: 10px; margin: 16px 0; font-size: 13px;">
            <strong>👥 Action Required — Select Your Active Staff (${staffQuotaStatus.maxStaffLimit} of ${staffQuotaStatus.totalStaff}):</strong><br>
            Your account has <strong>${staffQuotaStatus.totalStaff}</strong> staff members, while your new plan includes <strong>${staffQuotaStatus.maxStaffLimit}</strong> staff accounts. Please select which ${staffQuotaStatus.maxStaffLimit} staff members should have active login access on your dashboard.
           </div>`
        : '';

    const clientHtml = buildEmailWrapper(
        '🎉 Subscription Activated Successfully!',
        `Thank you for subscribing to ${quote.planName}`,
        'linear-gradient(135deg, #059669, #10b981)',
        `
        <p>Hello <strong>${user.companyName || user.username}</strong>,</p>
        <p>Your payment has been verified and your <strong>${quote.planName}</strong> subscription is now active.</p>
        ${staffWarningHtml}
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f2d52;">📋 Subscription & Quota Summary</h3>
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #64748b;">Admin Username:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.username}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Active Plan:</td><td style="padding: 6px 0; font-weight: 700; text-align: right; color: #059669;">${quote.planName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Bundled Add-ons:</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${addonsList}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Amount Paid:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #0f2d52;">₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Payment ID:</td><td style="padding: 6px 0; font-family: monospace; text-align: right;">${paymentId || 'N/A'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Valid Until:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #1d4ed8;">${expiryStr}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Active Parties Quota:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${quote.finalPartiesLimit} Parties</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Staff Accounts Quota:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${quote.finalStaffLimit} Staff</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Daily Reminders Quota:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${quote.finalMessagesLimit} / day</td></tr>
            </table>
        </div>
        <div style="text-align: center; margin-top: 22px;">
            <a href="${FRONTEND_URL}/dashboard.html" style="display: inline-block; background: linear-gradient(135deg, #1558cc, #0f2d52); color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 700; text-decoration: none;">Open Your Dashboard →</a>
        </div>
        `
    );

    const saHtml = buildEmailWrapper(
        '💰 New Subscription Purchased!',
        `${user.companyName || user.username} (@${user.username}) purchased ${quote.planName}`,
        'linear-gradient(135deg, #1e3a8a, #2563eb)',
        `
        <p>A client has completed checkout and activated a subscription on <strong>WGS Payment Tracker</strong>.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #64748b;">Company / Name:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.companyName || '-'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Username:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">@${user.username}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Email:</td><td style="padding: 6px 0; text-align: right;">${user.companyEmail || user.email || '-'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Phone:</td><td style="padding: 6px 0; text-align: right;">${user.contactNo || user.phone || '-'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Plan Purchased:</td><td style="padding: 6px 0; font-weight: 700; text-align: right; color: #059669;">${quote.planName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Add-ons:</td><td style="padding: 6px 0; text-align: right;">${addonsList}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Total Paid:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #059669;">₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Razorpay Payment ID:</td><td style="padding: 6px 0; font-family: monospace; text-align: right;">${paymentId || 'N/A'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">New Expiry Date:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${expiryStr}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Assigned Quotas:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${quote.finalPartiesLimit} Parties · ${quote.finalStaffLimit} Staff · ${quote.finalMessagesLimit} Msgs</td></tr>
            </table>
        </div>
        <div style="text-align: center; margin-top: 20px;">
            <a href="${FRONTEND_URL}/superadmin.html" style="display: inline-block; background: #0f2d52; color: #ffffff; padding: 11px 24px; border-radius: 10px; font-weight: 700; text-decoration: none;">Open Super Admin Console →</a>
        </div>
        `
    );

    await Promise.allSettled([
        sendEmailSafe({ to: clientEmails, subject: `🎉 Subscription Activated: ${quote.planName} — WGS Payment Tracker`, html: clientHtml }),
        sendEmailSafe({ to: superAdminEmails, subject: `💰 New Plan Purchase: ${user.companyName || user.username} (₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')})`, html: saHtml })
    ]);
}

/**
 * 2. Client Renews Plan or Buys Add-ons from Dashboard
 */
async function notifyPlanRenewedOrAddon(user, quote, modeLabel, paymentId, staffQuotaStatus = null) {
    const clientEmails = getClientEmails(user);
    const superAdminEmails = await getSuperAdminEmails();
    const addonsList = (user.activeAddons || []).map(a => `${a.name} (₹${Number(a.price || 0).toLocaleString('en-IN')})`).join(', ') || 'None';
    const expiryStr = formatDateIN(user.planExpiryDate);

    const staffWarningHtml = (staffQuotaStatus && staffQuotaStatus.requiresSelection)
        ? `<div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 14px 16px; border-radius: 10px; margin: 16px 0; font-size: 13px;">
            <strong>👥 Action Required — Select Your Active Staff (${staffQuotaStatus.maxStaffLimit} of ${staffQuotaStatus.totalStaff}):</strong><br>
            You have <strong>${staffQuotaStatus.totalStaff}</strong> staff accounts, and your renewed plan allows <strong>${staffQuotaStatus.maxStaffLimit}</strong> active staff. Please select which ${staffQuotaStatus.maxStaffLimit} staff members get login access on your dashboard.
           </div>`
        : '';

    const clientHtml = buildEmailWrapper(
        `✅ ${modeLabel} Confirmed!`,
        `Your subscription & account quotas have been updated`,
        'linear-gradient(135deg, #2563eb, #1d4ed8)',
        `
        <p>Hello <strong>${user.companyName || user.username}</strong>,</p>
        <p>Your payment of <strong>₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}</strong> for <strong>${modeLabel}</strong> has been verified and applied to your account.</p>
        ${staffWarningHtml}
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f2d52;">📋 Updated Subscription Details</h3>
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #64748b;">Admin Username:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.username}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Plan Name:</td><td style="padding: 6px 0; font-weight: 700; text-align: right; color: #1d4ed8;">${user.planName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Renewal / Purchase Type:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${modeLabel}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Active Add-ons:</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${addonsList}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Amount Paid:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #059669;">₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Payment ID:</td><td style="padding: 6px 0; font-family: monospace; text-align: right;">${paymentId || 'N/A'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Valid Until:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #059669;">${expiryStr}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Updated Quotas:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.maxCustomersLimit} Parties · ${user.maxStaffLimit} Staff · ${user.dailyMessageLimit} Msgs/day</td></tr>
            </table>
        </div>
        <div style="text-align: center; margin-top: 22px;">
            <a href="${FRONTEND_URL}/dashboard.html" style="display: inline-block; background: linear-gradient(135deg, #1558cc, #0f2d52); color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 700; text-decoration: none;">Go to Dashboard →</a>
        </div>
        `
    );

    const saHtml = buildEmailWrapper(
        `🔄 ${modeLabel}: ${user.companyName || user.username}`,
        `Client @${user.username} paid ₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}`,
        'linear-gradient(135deg, #0f2d52, #2563eb)',
        `
        <p>Client <strong>${user.companyName || user.username}</strong> (@${user.username}) completed a <strong>${modeLabel}</strong> payment.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #64748b;">Company / Username:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.companyName || '-'} (@${user.username})</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Contact:</td><td style="padding: 6px 0; text-align: right;">${user.companyEmail || user.email || '-'} | ${user.contactNo || user.phone || '-'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Action:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${modeLabel}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Plan:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.planName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Active Add-ons:</td><td style="padding: 6px 0; text-align: right;">${addonsList}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Amount Paid:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: #059669;">₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')} (${paymentId || 'N/A'})</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">New Expiry Date:</td><td style="padding: 6px 0; font-weight: 800; text-align: right;">${expiryStr}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Updated Quotas:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.maxCustomersLimit} Parties · ${user.maxStaffLimit} Staff · ${user.dailyMessageLimit} Msgs/day</td></tr>
            </table>
        </div>
        `
    );

    await Promise.allSettled([
        sendEmailSafe({ to: clientEmails, subject: `✅ ${modeLabel} Confirmed — WGS Payment Tracker`, html: clientHtml }),
        sendEmailSafe({ to: superAdminEmails, subject: `🔄 ${modeLabel}: ${user.companyName || user.username} (₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')})`, html: saHtml })
    ]);
}

/**
 * 3. Client Submits Manual Plan Request or Registration
 */
async function notifyRegistrationOrRequest(user, quote = null) {
    const clientEmails = getClientEmails(user);
    const superAdminEmails = await getSuperAdminEmails();
    const planLabel = (quote && quote.planName) || user.planName || 'Standard Yearly Plan';
    const amountLabel = quote ? `₹${Number(quote.totalAmount || 0).toLocaleString('en-IN')}` : 'Pending Approval';

    const clientHtml = buildEmailWrapper(
        '⏳ Account Request Received',
        'Your registration is pending Super Admin approval',
        'linear-gradient(135deg, #0f2d52, #3b82f6)',
        `
        <p>Hello <strong>${user.companyName || user.username}</strong>,</p>
        <p>We have received your account request for <strong>${planLabel}</strong> on WGS Payment Tracker.</p>
        <p>Our Super Admin team will review and activate your account shortly. You will receive an email confirmation as soon as your account is approved.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <div><strong>Username:</strong> ${user.username}</div>
            <div><strong>Requested Plan:</strong> ${planLabel} (${amountLabel})</div>
        </div>
        `
    );

    const saHtml = buildEmailWrapper(
        '🔔 New Admin Registration Request',
        `${user.companyName || user.username} (@${user.username}) is awaiting approval`,
        'linear-gradient(135deg, #d97706, #f59e0b)',
        `
        <p>A new Admin account registration / subscription request has been submitted:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <div><strong>Company:</strong> ${user.companyName || '-'}</div>
            <div><strong>Username:</strong> @${user.username}</div>
            <div><strong>Email:</strong> ${user.companyEmail || user.email || '-'}</div>
            <div><strong>Phone:</strong> ${user.contactNo || user.phone || '-'}</div>
            <div><strong>Requested Plan:</strong> ${planLabel} (${amountLabel})</div>
        </div>
        <div style="text-align: center; margin-top: 20px;">
            <a href="${FRONTEND_URL}/superadmin.html" style="display: inline-block; background: #0f2d52; color: #ffffff; padding: 11px 24px; border-radius: 10px; font-weight: 700; text-decoration: none;">Review in Super Admin Console →</a>
        </div>
        `
    );

    await Promise.allSettled([
        sendEmailSafe({ to: clientEmails, subject: `⏳ Registration Request Received — WGS Payment Tracker`, html: clientHtml }),
        sendEmailSafe({ to: superAdminEmails, subject: `🔔 New Registration Request: ${user.companyName || user.username} (@${user.username})`, html: saHtml })
    ]);
}

/**
 * 4. SuperAdmin Changes Anything on a Client's Account
 */
async function notifySuperAdminAccountChange(user, actionTitle, summaryMessage, staffQuotaStatus = null) {
    if (!user) return;
    const clientEmails = getClientEmails(user);
    const superAdminEmails = await getSuperAdminEmails();
    const expiryStr = formatDateIN(user.planExpiryDate);
    const fa = user.featureAccess || {};

    const staffWarningHtml = (staffQuotaStatus && staffQuotaStatus.requiresSelection)
        ? `<div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 14px 16px; border-radius: 10px; margin: 16px 0; font-size: 13px;">
            <strong>👥 Action Required — Select Your Active Staff (${staffQuotaStatus.maxStaffLimit} of ${staffQuotaStatus.totalStaff}):</strong><br>
            Your account currently has <strong>${staffQuotaStatus.totalStaff}</strong> staff members, and your updated staff limit is <strong>${staffQuotaStatus.maxStaffLimit}</strong>. Please sign in to your dashboard and select which ${staffQuotaStatus.maxStaffLimit} staff members should have active login access.
           </div>`
        : '';

    const statusColor = user.status === 'approved' ? '#059669' : (user.status === 'suspended' ? '#9333ea' : '#dc2626');

    const detailsTable = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f2d52;">⚙️ Current Account & Plan Configuration</h3>
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #64748b;">Admin Username:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.username}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Account Status:</td><td style="padding: 6px 0; font-weight: 800; text-align: right; color: ${statusColor}; text-transform: uppercase;">${user.status || 'approved'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Subscription Plan:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.planName || 'Standard'}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Plan Expiry Date:</td><td style="padding: 6px 0; font-weight: 700; text-align: right; color: #1d4ed8;">${expiryStr}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Parties Limit:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.maxCustomersLimit === 0 ? 'Unlimited' : (user.maxCustomersLimit ?? 500)} Parties</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Staff Limit:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.maxStaffLimit === 0 ? 'Unlimited' : (user.maxStaffLimit ?? 5)} Staff</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Daily Reminders Limit:</td><td style="padding: 6px 0; font-weight: 700; text-align: right;">${user.dailyMessageLimit === 0 ? 'Unlimited' : (user.dailyMessageLimit ?? 100)} / day</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Feature Permissions:</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">
                    Cloud Backup: ${fa.allowGoogleDriveBackup !== false ? '✅' : '🔒'} · Excel: ${fa.allowExcelImport !== false ? '✅' : '🔒'} · PDF: ${fa.allowPdfExport !== false ? '✅' : '🔒'}
                </td></tr>
            </table>
        </div>
    `;

    const clientHtml = buildEmailWrapper(
        `🔔 Account Update: ${actionTitle}`,
        `Super Admin updated your WGS Payment Tracker account settings`,
        'linear-gradient(135deg, #0f2d52, #1558cc)',
        `
        <p>Hello <strong>${user.companyName || user.username}</strong>,</p>
        <p>${summaryMessage}</p>
        ${staffWarningHtml}
        ${detailsTable}
        <div style="text-align: center; margin-top: 22px;">
            <a href="${FRONTEND_URL}/dashboard.html" style="display: inline-block; background: linear-gradient(135deg, #1558cc, #0f2d52); color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 700; text-decoration: none;">Open Dashboard →</a>
        </div>
        `
    );

    const saHtml = buildEmailWrapper(
        `🛡️ Super Admin Action: ${actionTitle}`,
        `Account updated for ${user.companyName || user.username} (@${user.username})`,
        'linear-gradient(135deg, #1e293b, #334155)',
        `
        <p><strong>Super Admin Audit Notice:</strong> ${summaryMessage}</p>
        ${detailsTable}
        `
    );

    await Promise.allSettled([
        sendEmailSafe({ to: clientEmails, subject: `🔔 ${actionTitle} — WGS Payment Tracker`, html: clientHtml }),
        sendEmailSafe({ to: superAdminEmails, subject: `🛡️ [Super Admin Audit] ${actionTitle}: @${user.username}`, html: saHtml })
    ]);
}

/**
 * 5. Pre-Expiry (10 Days or Fewer Before Plan Ends) & Post-Expiry (After Plan Ends) Automated Emails
 */
async function checkAndSendExpiryNotificationsForAdmin(adminDoc) {
    try {
        if (!adminDoc || adminDoc.role !== 'admin' || !adminDoc.planExpiryDate) return;
        if (adminDoc.status === 'rejected' || adminDoc.status === 'pending') return;

        const now = new Date();
        const today = new Date(now); today.setHours(0, 0, 0, 0);
        const expiry = new Date(adminDoc.planExpiryDate); expiry.setHours(0, 0, 0, 0);
        const diffTime = expiry.getTime() - today.getTime();
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const expiryStr = formatDateIN(adminDoc.planExpiryDate);

        // CASE A: 10 days or fewer BEFORE plan ends (0 <= daysLeft <= 10)
        if (daysLeft >= 0 && daysLeft <= 10) {
            const lastSent = adminDoc.lastPreExpiryEmailSentAt ? new Date(adminDoc.lastPreExpiryEmailSentAt) : null;
            const hoursSinceLast = lastSent ? (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60) : 9999;

            // Send once when entering the 10-day window, and at most once per day when daysLeft changes
            if (adminDoc.lastPreExpiryDaysNotified === daysLeft && hoursSinceLast < 20) {
                return;
            }
            if (hoursSinceLast < 18) {
                return;
            }

            await User.findByIdAndUpdate(adminDoc._id, {
                $set: {
                    lastPreExpiryEmailSentAt: now,
                    lastPreExpiryDaysNotified: daysLeft
                }
            });

            const clientEmails = getClientEmails(adminDoc);
            const superAdminEmails = await getSuperAdminEmails();
            const dayText = daysLeft === 0 ? 'TODAY' : `in ${daysLeft} day(s)`;

            const clientHtml = buildEmailWrapper(
                `⚠️ Subscription Expiring ${dayText}!`,
                `Renew your ${adminDoc.planName || 'Yearly Plan'} to avoid Read-Only lock & staff sign-in pause`,
                'linear-gradient(135deg, #d97706, #ea580c)',
                `
                <p>Hello <strong>${adminDoc.companyName || adminDoc.username}</strong>,</p>
                <p>This is an important reminder that your <strong>${adminDoc.planName || 'Yearly Plan'}</strong> subscription on WGS Payment Tracker is scheduled to expire <strong>${dayText}</strong> on <strong>${expiryStr}</strong>.</p>
                <div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 15px 18px; border-radius: 12px; margin: 18px 0; font-size: 13.5px;">
                    <strong>🔒 What happens if my subscription expires?</strong>
                    <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                        <li>Your Admin dashboard will switch to <strong>Read-Only View Mode</strong> (you will only be able to view ledgers, not add/edit parties, transactions, or send reminders).</li>
                        <li>All <strong>Staff accounts will be unable to sign in</strong> until you renew your plan or add a validity add-on.</li>
                    </ul>
                </div>
                <p>You can renew in 1 click directly from the top-right <strong>Subscription & Renew</strong> menu on your dashboard — either <strong>With Your Add-ons</strong>, <strong>Without Add-ons</strong>, or by adding a new <strong>Add-on Pack</strong>.</p>
                <div style="text-align: center; margin-top: 22px;">
                    <a href="${FRONTEND_URL}/dashboard.html" style="display: inline-block; background: linear-gradient(135deg, #ea580c, #d97706); color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 800; text-decoration: none;">🔄 Renew Subscription Now →</a>
                </div>
                `
            );

            const saHtml = buildEmailWrapper(
                `⏰ Client Plan Expiring ${dayText}`,
                `${adminDoc.companyName || adminDoc.username} (@${adminDoc.username}) — Expires ${expiryStr}`,
                'linear-gradient(135deg, #b45309, #d97706)',
                `
                <p>Client <strong>${adminDoc.companyName || adminDoc.username}</strong> (@${adminDoc.username}) has a subscription expiring <strong>${dayText}</strong> (${expiryStr}).</p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
                    <div><strong>Company / Username:</strong> ${adminDoc.companyName || '-'} (@${adminDoc.username})</div>
                    <div><strong>Email / Phone:</strong> ${adminDoc.companyEmail || adminDoc.email || '-'} | ${adminDoc.contactNo || adminDoc.phone || '-'}</div>
                    <div><strong>Plan:</strong> ${adminDoc.planName || 'Standard'}</div>
                    <div><strong>Expiry Date:</strong> ${expiryStr} (${daysLeft} day(s) remaining)</div>
                </div>
                `
            );

            await Promise.allSettled([
                sendEmailSafe({ to: clientEmails, subject: `⚠️ Urgent: Your WGS Payment Tracker Plan Expires ${dayText} (${expiryStr})`, html: clientHtml }),
                sendEmailSafe({ to: superAdminEmails, subject: `⏰ Client Expiring ${dayText}: ${adminDoc.companyName || adminDoc.username} (@${adminDoc.username})`, html: saHtml })
            ]);
            return;
        }

        // CASE B: AFTER plan has ended (daysLeft < 0)
        if (daysLeft < 0) {
            const lastPost = adminDoc.lastPostExpiryEmailSentAt ? new Date(adminDoc.lastPostExpiryEmailSentAt) : null;
            const hoursSincePost = lastPost ? (now.getTime() - lastPost.getTime()) / (1000 * 60 * 60) : 9999;
            const daysExpired = Math.abs(daysLeft);

            // Send immediately when first expired, and reminder every 3 days up to 15 days post-expiry
            if (lastPost && (hoursSincePost < 72 || daysExpired > 15)) {
                return;
            }

            await User.findByIdAndUpdate(adminDoc._id, {
                $set: { lastPostExpiryEmailSentAt: now }
            });

            const clientEmails = getClientEmails(adminDoc);
            const superAdminEmails = await getSuperAdminEmails();

            const clientHtml = buildEmailWrapper(
                '🚨 Your Subscription Has Expired (Read-Only Mode)',
                `Expired on ${expiryStr} (${daysExpired} day(s) ago)`,
                'linear-gradient(135deg, #dc2626, #991b1b)',
                `
                <p>Hello <strong>${adminDoc.companyName || adminDoc.username}</strong>,</p>
                <p>Your <strong>${adminDoc.planName || 'Yearly Plan'}</strong> subscription expired on <strong>${expiryStr}</strong>.</p>
                <div style="background: #fef2f2; border: 1px solid #f87171; color: #991b1b; padding: 15px 18px; border-radius: 12px; margin: 18px 0; font-size: 13.5px;">
                    <strong>🔒 Account Currently in Read-Only Mode:</strong>
                    <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                        <li>All your party ledgers and transactions are <strong>100% safe and visible</strong> when you sign in as Admin.</li>
                        <li>Adding/editing parties, recording transactions, sending reminders, and exporting reports are locked.</li>
                        <li><strong>Staff logins are disabled</strong> until your subscription is renewed.</li>
                    </ul>
                </div>
                <p>Sign in to your Admin Dashboard and click <strong>Renew Plan</strong> or <strong>Buy Add-on</strong> in the top-right corner to restore full access immediately.</p>
                <div style="text-align: center; margin-top: 22px;">
                    <a href="${FRONTEND_URL}/dashboard.html" style="display: inline-block; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 800; text-decoration: none;">🔓 Sign In & Renew Plan Now →</a>
                </div>
                `
            );

            const saHtml = buildEmailWrapper(
                `🚨 Client Subscription Expired: ${adminDoc.companyName || adminDoc.username}`,
                `Expired on ${expiryStr} (${daysExpired} day(s) ago) — Account in Read-Only Mode`,
                'linear-gradient(135deg, #991b1b, #dc2626)',
                `
                <p>Client <strong>${adminDoc.companyName || adminDoc.username}</strong> (@${adminDoc.username})'s subscription expired on <strong>${expiryStr}</strong>.</p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
                    <div><strong>Company / Username:</strong> ${adminDoc.companyName || '-'} (@${adminDoc.username})</div>
                    <div><strong>Email / Phone:</strong> ${adminDoc.companyEmail || adminDoc.email || '-'} | ${adminDoc.contactNo || adminDoc.phone || '-'}</div>
                    <div><strong>Plan:</strong> ${adminDoc.planName || 'Standard'}</div>
                    <div><strong>Expired On:</strong> ${expiryStr} (${daysExpired} day(s) ago)</div>
                </div>
                `
            );

            await Promise.allSettled([
                sendEmailSafe({ to: clientEmails, subject: `🚨 Subscription Expired (Read-Only Mode) — WGS Payment Tracker`, html: clientHtml }),
                sendEmailSafe({ to: superAdminEmails, subject: `🚨 Client Expired: ${adminDoc.companyName || adminDoc.username} (@${adminDoc.username})`, html: saHtml })
            ]);
        }
    } catch (err) {
        console.error('[EmailService] Expiry check error:', err.message);
    }
}

let _lastGlobalExpiryScanAt = 0;
async function runExpiryEmailScan(force = false) {
    const nowMs = Date.now();
    // Throttle background scan to once per 30 minutes per instance unless forced
    if (!force && (nowMs - _lastGlobalExpiryScanAt < 30 * 60 * 1000)) return;
    _lastGlobalExpiryScanAt = nowMs;

    try {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() + 11);
        const adminsNearOrPastExpiry = await User.find({
            role: 'admin',
            status: 'approved',
            planExpiryDate: { $ne: null, $lte: thresholdDate }
        }).lean();

        for (const admin of adminsNearOrPastExpiry) {
            await checkAndSendExpiryNotificationsForAdmin(admin);
        }
    } catch (err) {
        console.error('[EmailService] Global expiry scan error:', err.message);
    }
}

module.exports = {
    escapeHtml,
    sendEmailSafe,
    syncStaffQuotaForAdmin,
    notifyPlanPurchased,
    notifyPlanRenewedOrAddon,
    notifyRegistrationOrRequest,
    notifySuperAdminAccountChange,
    checkAndSendExpiryNotificationsForAdmin,
    runExpiryEmailScan
};
