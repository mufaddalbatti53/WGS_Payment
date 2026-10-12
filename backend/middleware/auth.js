const User = require('../models/User');
const ActivityLog = require('../models/Activity');

const requireLogin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }

    if (req.session.role === 'superadmin') return next();

    try {
        const adminId = req.session.adminId || req.session.userId;
        const adminUser = await User.findById(adminId).lean();
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
        if (adminUser.planExpiryDate && new Date() > new Date(adminUser.planExpiryDate)) {
            const isDashboardLoad = req.session.role === 'admin' && req.method === 'GET' && (req.baseUrl === '/api/dashboard' || req.originalUrl.startsWith('/api/dashboard'));
            if (!isDashboardLoad) {
                if (req.session.role === 'staff') {
                    req.session.destroy();
                    return res.status(401).json({
                        success: false,
                        error: "⌛ Your company's subscription plan has expired. Please ask your Admin to renew.",
                        message: "⌛ Your company's subscription plan has expired. Please ask your Admin to renew."
                    });
                }
                return res.status(403).json({
                    success: false,
                    code: 'PLAN_EXPIRED',
                    error: "⌛ Your yearly subscription plan has expired. Please click 'Renew Plan' in the top-right Subscription menu on your dashboard to extend your plan.",
                    message: "⌛ Your yearly subscription plan has expired. Please click 'Renew Plan' in the top-right Subscription menu on your dashboard to extend your plan."
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
    logActivity
};
