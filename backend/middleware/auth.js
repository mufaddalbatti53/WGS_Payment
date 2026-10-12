const User = require('../models/User');
const ActivityLog = require('../models/Activity');

function isPlanExpiredDate(planExpiryDate) {
    if (!planExpiryDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(planExpiryDate);
    expiry.setHours(0, 0, 0, 0);
    return expiry.getTime() < today.getTime();
}

const requireLogin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }

    if (req.session.role === 'superadmin') return next();

    try {
        const adminId = req.session.adminId || req.session.userId;
        const [adminUser, staffUser] = await Promise.all([
            User.findById(adminId).select('status planExpiryDate role requiresStaffSelection maxStaffLimit').lean(),
            req.session.role === 'staff'
                ? User.findById(req.session.userId).select('status isQuotaLocked').lean()
                : Promise.resolve(null)
        ]);

        if (!adminUser) {
            req.session.destroy();
            return res.status(401).json({ success: false, message: "Account not found. Please log in again." });
        }
        if (adminUser.status === 'suspended') {
            req.session.destroy();
            return res.status(401).json({ success: false, message: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin." });
        }
        if (adminUser.status === 'rejected') {
            req.session.destroy();
            return res.status(401).json({ success: false, message: "❌ Your access has been revoked. Please contact support." });
        }

        const expired = isPlanExpiredDate(adminUser.planExpiryDate);

        if (req.session.role === 'staff') {
            if (!staffUser || staffUser.status === 'suspended' || staffUser.status === 'rejected') {
                req.session.destroy();
                return res.status(401).json({
                    success: false,
                    error: "⏸️ Your staff account is currently inactive. Please contact your Admin.",
                    message: "⏸️ Your staff account is currently inactive. Please contact your Admin."
                });
            }
            if (expired) {
                req.session.destroy();
                return res.status(401).json({
                    success: false,
                    error: "⌛ Your company's subscription plan has expired. Staff login and access are disabled until your Admin renews the plan or adds an add-on.",
                    message: "⌛ Your company's subscription plan has expired. Staff login and access are disabled until your Admin renews the plan or adds an add-on."
                });
            }
            if (staffUser.isQuotaLocked || adminUser.requiresStaffSelection) {
                req.session.destroy();
                return res.status(401).json({
                    success: false,
                    error: `🔒 Your staff account is paused because your company's plan allows up to ${adminUser.maxStaffLimit ?? 5} active staff. Please ask your Admin to select your account or upgrade their Staff quota.`,
                    message: `🔒 Your staff account is paused because your company's plan allows up to ${adminUser.maxStaffLimit ?? 5} active staff. Please ask your Admin to select your account or upgrade their Staff quota.`
                });
            }
        }

        if (expired) {
            // Admin Read-Only Mode: Only allow viewing dashboard/staff/activity via GET, or subscription/logout endpoints
            const urlPath = (req.originalUrl || req.baseUrl || '').split('?')[0];
            const isAllowedReadOnlyGet =
                req.method === 'GET' &&
                (urlPath.startsWith('/api/dashboard') || urlPath === '/api/staff' || urlPath.startsWith('/api/activity'));
            const isSubscriptionOrLogout =
                urlPath.startsWith('/api/subscriptions') || urlPath.includes('/logout');

            if (!isAllowedReadOnlyGet && !isSubscriptionOrLogout) {
                return res.status(403).json({
                    success: false,
                    code: 'PLAN_EXPIRED',
                    error: "🔒 Read-Only Mode: Your subscription has expired. You can only view your dashboard until you renew your plan or purchase an add-on.",
                    message: "🔒 Read-Only Mode: Your subscription has expired. You can only view your dashboard until you renew your plan or purchase an add-on."
                });
            }
        } else if (req.session.role === 'admin' && adminUser.requiresStaffSelection) {
            // If Admin has more staff than new plan allows (e.g. 5 staff, plan allows 3), require selecting active staff first before other mutations
            const urlPath = (req.originalUrl || req.baseUrl || '').split('?')[0];
            const isAllowedDuringStaffSelection =
                req.method === 'GET' ||
                urlPath.startsWith('/api/staff') ||
                urlPath.startsWith('/api/subscriptions') ||
                urlPath.includes('/logout');

            if (!isAllowedDuringStaffSelection) {
                return res.status(403).json({
                    success: false,
                    code: 'STAFF_SELECTION_REQUIRED',
                    error: `👥 Action Required: Your current plan allows ${adminUser.maxStaffLimit ?? 3} staff accounts. Please first select which ${adminUser.maxStaffLimit ?? 3} staff members will get active access.`,
                    message: `👥 Action Required: Your current plan allows ${adminUser.maxStaffLimit ?? 3} staff accounts. Please first select which ${adminUser.maxStaffLimit ?? 3} staff members will get active access.`
                });
            }
        }
    } catch (e) {
        console.error("Auth status check error:", e);
        return res.status(500).json({ success: false, message: "Internal server error during auth check." });
    }
    next();
};

const requireAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    if (req.session.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin session required." });
    }
    return requireLogin(req, res, next);
};

const requireSuperAdmin = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    if (req.session.role === 'superadmin') {
        next();
    } else {
        return res.status(403).json({ success: false, message: "Super Admin access required." });
    }
};

async function logActivity(req, action, details) {
    try {
        if (!req.session || !req.session.adminId) return;
        if (req.session.role === 'customer') return;
        await ActivityLog.create({
            adminId: req.session.adminId,
            userId: req.session.userId || req.session.adminId,
            username: req.session.username || 'Admin',
            action: action,
            details: details
        });
    } catch (err) {
        console.error("Activity Log Error:", err.message);
    }
}

module.exports = {
    requireLogin,
    requireAdmin,
    requireSuperAdmin,
    logActivity,
    isPlanExpiredDate
};
