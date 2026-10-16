const crypto = require('crypto');
const User = require('../models/User');
const ActivityLog = require('../models/Activity');

function getAuthSecret() {
    const rawSecret = (process.env.SESSION_SECRET || '').trim();
    if (rawSecret && rawSecret.length >= 32) return rawSecret;
    if (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
        throw new Error('SESSION_SECRET environment variable must be configured with at least 32 characters in production.');
    }
    return 'wgs-payment-manager-secure-development-session-key-32chars';
}

function createAuthToken(sessionData) {
    if (!sessionData || !sessionData.userId) return '';
    const payload = {
        userId: String(sessionData.userId),
        role: sessionData.role || 'admin',
        username: sessionData.username || '',
        adminId: sessionData.adminId ? String(sessionData.adminId) : String(sessionData.userId),
        userPhone: sessionData.userPhone || '',
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    const dataB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = crypto.createHmac('sha256', getAuthSecret()).update(dataB64).digest('base64url');
    return `${dataB64}.${sigB64}`;
}

function verifyAuthToken(token) {
    try {
        if (!token || typeof token !== 'string' || !token.includes('.')) return null;
        const [dataB64, sigB64] = token.trim().split('.');
        if (!dataB64 || !sigB64) return null;
        const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(dataB64).digest('base64url');
        const bufA = Buffer.from(sigB64);
        const bufB = Buffer.from(expectedSig);
        if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
        const payload = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8'));
        if (!payload || !payload.userId || !payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

const _authUserCache = new Map();
const AUTH_CACHE_TTL_MS = 10000; // 10s cache for burst API calls

function getCachedAuthUser(userId, fields) {
    if (!userId) return Promise.resolve(null);
    const key = `${userId}:${fields}`;
    const now = Date.now();
    const cached = _authUserCache.get(key);
    if (cached && cached.exp > now) {
        return Promise.resolve(cached.doc);
    }
    return User.findById(userId).select(fields).lean().then(doc => {
        if (_authUserCache.size > 500) _authUserCache.clear();
        _authUserCache.set(key, { doc, exp: now + AUTH_CACHE_TTL_MS });
        return doc;
    });
}

function invalidateAuthCache(userId) {
    if (!userId) {
        _authUserCache.clear();
        return;
    }
    const prefix = `${String(userId)}:`;
    for (const k of _authUserCache.keys()) {
        if (k.startsWith(prefix)) _authUserCache.delete(k);
    }
}

function saveSessionAsync(req) {
    return new Promise((resolve) => {
        if (!req.session) return resolve();
        const saveFn = req._origSessionSave || req.session.save;
        if (typeof saveFn !== 'function') return resolve();
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const timer = setTimeout(finish, 300);
        try {
            saveFn.call(req.session, () => {
                clearTimeout(timer);
                finish();
            });
        } catch (e) {
            clearTimeout(timer);
            finish();
        }
    });
}

function destroySessionSafe(req, res, cb) {
    if (res && typeof res.setHeader === 'function') {
        res.setHeader('X-Clear-Auth-Token', '1');
    }
    if (req && req.session) {
        if (req.session.userId) invalidateAuthCache(req.session.userId);
        if (req.session.adminId) invalidateAuthCache(req.session.adminId);
    }
    let finished = false;
    const done = () => {
        if (finished) return;
        finished = true;
        if (typeof cb === 'function') {
            try { cb(); } catch (e) {}
        }
    };
    if (req && req.session && typeof req.session.destroy === 'function' && !req._hydratedFromToken) {
        const timer = setTimeout(done, 250);
        try {
            req.session.destroy(() => {
                clearTimeout(timer);
                done();
            });
        } catch (e) {
            clearTimeout(timer);
            done();
        }
    } else {
        if (req && req.session) {
            delete req.session.userId;
            delete req.session.role;
            delete req.session.username;
            delete req.session.adminId;
        }
        done();
    }
}

function hydrateSessionFromTokenMiddleware(req, res, next) {
    try {
        let hydratedTokenPayload = null;
        if (!req.session || !req.session.userId) {
            let rawToken = '';
            const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
            if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
                rawToken = authHeader.slice(7).trim();
            } else if (req.headers['x-auth-token']) {
                rawToken = String(req.headers['x-auth-token']).trim();
            }
            if (rawToken) {
                const payload = verifyAuthToken(rawToken);
                if (payload) {
                    hydratedTokenPayload = payload;
                    if (!req.session) req.session = {};
                    req._hydratedFromToken = true;
                    if (typeof req.session.save === 'function' && !req._origSessionSave) {
                        req._origSessionSave = req.session.save;
                        // Prevent express-session from inserting a new orphan session document into MongoDB on every stateless token request
                        req.session.save = function(fn) {
                            if (typeof fn === 'function') fn();
                            return this;
                        };
                    }
                    req.session.userId = payload.userId;
                    req.session.role = payload.role;
                    req.session.username = payload.username;
                    req.session.adminId = payload.adminId || payload.userId;
                    if (payload.userPhone) req.session.userPhone = payload.userPhone;
                }
            }
        }
        if (req.session && req.session.userId) {
            // Only issue a refreshed X-Auth-Token if no token was supplied or it has < 6 days remaining
            const needsRefresh = !hydratedTokenPayload || (hydratedTokenPayload.exp - Date.now() < 6 * 24 * 60 * 60 * 1000);
            if (needsRefresh) {
                const freshToken = createAuthToken(req.session);
                if (freshToken) {
                    res.setHeader('X-Auth-Token', freshToken);
                }
            }
        }
    } catch (e) {}
    next();
}

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
            adminId ? getCachedAuthUser(adminId, 'status planExpiryDate role requiresStaffSelection maxStaffLimit') : Promise.resolve(null),
            req.session.role === 'staff'
                ? getCachedAuthUser(req.session.userId, 'status isQuotaLocked')
                : Promise.resolve(null)
        ]);

        if (!adminUser) {
            if (req.session.role === 'customer') return next();
            destroySessionSafe(req, res);
            return res.status(401).json({ success: false, message: "Account not found. Please log in again." });
        }
        if (adminUser.status === 'suspended') {
            destroySessionSafe(req, res);
            return res.status(401).json({ success: false, message: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin." });
        }
        if (adminUser.status === 'rejected') {
            destroySessionSafe(req, res);
            return res.status(401).json({ success: false, message: "❌ Your access has been revoked. Please contact support." });
        }

        const expired = isPlanExpiredDate(adminUser.planExpiryDate);

        if (req.session.role === 'staff') {
            if (!staffUser || staffUser.status === 'suspended' || staffUser.status === 'rejected') {
                destroySessionSafe(req, res);
                return res.status(401).json({
                    success: false,
                    error: "⏸️ Your staff account is currently inactive. Please contact your Admin.",
                    message: "⏸️ Your staff account is currently inactive. Please contact your Admin."
                });
            }
            if (expired) {
                destroySessionSafe(req, res);
                return res.status(401).json({
                    success: false,
                    error: "⌛ Your company's subscription plan has expired. Staff login and access are disabled until your Admin renews the plan or adds an add-on.",
                    message: "⌛ Your company's subscription plan has expired. Staff login and access are disabled until your Admin renews the plan or adds an add-on."
                });
            }
            if (staffUser.isQuotaLocked || adminUser.requiresStaffSelection) {
                destroySessionSafe(req, res);
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
    isPlanExpiredDate,
    createAuthToken,
    verifyAuthToken,
    saveSessionAsync,
    destroySessionSafe,
    hydrateSessionFromTokenMiddleware,
    invalidateAuthCache
};


