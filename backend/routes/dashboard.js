const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const User = require('../models/User');
const PlanConfig = require('../models/PlanConfig');
const subscriptionsRouter = require('./subscriptions');
const { isPlanExpiredDate } = require('../middleware/auth');
const {
    checkAndSendExpiryNotificationsForAdmin,
    runExpiryEmailScan,
    syncStaffQuotaForAdmin
} = require('../utils/emailService');

router.get('/', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    if (req.session.role === 'superadmin') {
        return res.json({ success: true, redirect: 'superadmin.html' });
    }

    try {
        let customersPromise;
        if (req.session.role === 'customer') {
            if (req.session.userPhone) {
                customersPromise = Customer.find({
                    phone: { $regex: new RegExp(req.session.userPhone + '$') }
                }).sort({ _id: -1 }).limit(1).lean();
            } else {
                customersPromise = Customer.find({ _id: req.session.userId }).lean();
            }
        } else {
            customersPromise = Customer.find({ adminId: req.session.adminId }).lean();
        }

        const [finalCustomers, adminUserRaw, staffMembersRaw, planConfig] = await Promise.all([
            customersPromise,
            User.findById(req.session.adminId).select('+googleDriveToken').lean(),
            req.session.adminId
                ? User.find({ role: 'staff', adminId: req.session.adminId }).select('_id username status isQuotaLocked').sort({ _id: 1 }).lean()
                : Promise.resolve([]),
            PlanConfig.getOrCreateSingleton()
        ]);
        const adminUser = adminUserRaw || {};
        let staffMembers = Array.isArray(staffMembersRaw) ? staffMembersRaw : [];
        const staffCount = staffMembers.length;

        adminUser.isGoogleDriveLinked = Boolean(adminUser.googleDriveToken || adminUser.googleEmail);
        delete adminUser.googleDriveToken;
        delete adminUser.password;
        adminUser.featureAccess = {
            allowGoogleDriveBackup: adminUser.featureAccess?.allowGoogleDriveBackup !== undefined ? Boolean(adminUser.featureAccess.allowGoogleDriveBackup) : true,
            allowExcelImport: adminUser.featureAccess?.allowExcelImport !== undefined ? Boolean(adminUser.featureAccess.allowExcelImport) : true,
            allowPdfExport: adminUser.featureAccess?.allowPdfExport !== undefined ? Boolean(adminUser.featureAccess.allowPdfExport) : true
        };

        if (adminUser && adminUser._id) {
            if (adminUser.status === 'suspended') {
                req.session.destroy();
                return res.status(403).json({ success: false, message: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin." });
            }
            if (adminUser.status === 'rejected') {
                req.session.destroy();
                return res.status(403).json({ success: false, message: "❌ Your access has been revoked. Please contact support." });
            }
            if (req.session.role === 'staff') {
                const thisStaff = staffMembers.find(s => String(s._id) === String(req.session.userId));
                if (!thisStaff || thisStaff.status === 'suspended' || thisStaff.status === 'rejected') {
                    req.session.destroy();
                    return res.status(403).json({ success: false, message: "⏸️ Your staff account is currently inactive. Please contact your Admin." });
                }
                if (isPlanExpiredDate(adminUser.planExpiryDate)) {
                    req.session.destroy();
                    return res.status(403).json({ success: false, message: "⌛ Your company's subscription plan has expired. Staff login and access are disabled until your Admin renews the plan." });
                }
                if (thisStaff.isQuotaLocked || adminUser.requiresStaffSelection) {
                    req.session.destroy();
                    return res.status(403).json({ success: false, message: `🔒 Your staff account is paused because your company's plan allows up to ${adminUser.maxStaffLimit ?? 5} active staff.` });
                }
            } else if (req.session.role !== 'admin' && isPlanExpiredDate(adminUser.planExpiryDate)) {
                req.session.destroy();
                return res.status(403).json({ success: false, message: "⌛ Your organization's subscription plan has expired. Please ask your Admin to renew." });
            }

            // Trigger non-blocking expiry email check (10 days before & post-expiry)
            checkAndSendExpiryNotificationsForAdmin(adminUser).catch(() => {});
            runExpiryEmailScan().catch(() => {});
        }

        let subscriptionAlert = null;
        let daysLeftVal = null;
        let expiryFormattedStr = 'Lifetime / Active';

        if (adminUser.planExpiryDate) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(adminUser.planExpiryDate); expiry.setHours(0, 0, 0, 0);
            const diffTime = expiry.getTime() - today.getTime();
            daysLeftVal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            expiryFormattedStr = expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

            if (daysLeftVal <= 10) {
                subscriptionAlert = {
                    expired: daysLeftVal < 0,
                    nearExpiry: daysLeftVal >= 0 && daysLeftVal <= 10,
                    daysLeft: Math.max(0, daysLeftVal),
                    rawDaysLeft: daysLeftVal,
                    expiryFormatted: expiryFormattedStr
                };
            }
        }

        let quotaAlert = null;
        if (adminUser && adminUser._id) {
            const now = new Date();
            const lastReset = adminUser.lastMessageResetDate ? new Date(adminUser.lastMessageResetDate) : new Date(0);
            if (now.toDateString() !== lastReset.toDateString()) {
                adminUser.dailyMessageCount = 0;
            }
            const dailyLimit = adminUser.dailyMessageLimit ?? 100;
            if (dailyLimit > 0 && (adminUser.dailyMessageCount || 0) >= dailyLimit) {
                quotaAlert = `Daily message limit reached (${adminUser.dailyMessageCount}/${dailyLimit}).`;
            }
        }

        // Check if active unlocked staff count exceeds maxStaffLimit (and auto-sync if needed)
        const maxStaffLimit = Number(adminUser.maxStaffLimit ?? 5);
        let unlockedStaffCount = staffMembers.filter(s => !s.isQuotaLocked).length;
        let requiresStaffSelection = Boolean(adminUser.requiresStaffSelection);
        if (maxStaffLimit > 0 && staffCount > maxStaffLimit && unlockedStaffCount > maxStaffLimit) {
            const synced = await syncStaffQuotaForAdmin(adminUser._id, maxStaffLimit);
            staffMembers = synced.staffList || staffMembers;
            unlockedStaffCount = synced.activeStaffCount;
            requiresStaffSelection = true;
        }
        const pausedStaffCount = staffMembers.filter(s => s.isQuotaLocked).length;

        // Build Subscription Details & Renewal Quotes (With Add-ons vs Without Add-ons)
        let subscriptionDetails = null;
        if (adminUser && adminUser._id && planConfig) {
            const rawAddons = Array.isArray(adminUser.activeAddons) ? adminUser.activeAddons : [];
            const activeAddons = rawAddons.map(a => ({
                ...a,
                name: a.name || a.title || a.id || 'Add-on',
                title: a.title || a.name || a.id || 'Add-on'
            }));
            const calcQuote = subscriptionsRouter.calculateSubscriptionQuote;
            const resolveParams = subscriptionsRouter.resolveAdminRenewalParams;

            let renewWithAddonsQuote = null;
            let renewWithoutAddonsQuote = null;
            try {
                const paramsWith = resolveParams(adminUser, planConfig, { renewalMode: 'with_addons' });
                renewWithAddonsQuote = calcQuote(planConfig, paramsWith.planId, paramsWith.customConfig, paramsWith.addonIds, paramsWith.fallbackUserAddons);

                const paramsWithout = resolveParams(adminUser, planConfig, { renewalMode: 'without_addons' });
                renewWithoutAddonsQuote = calcQuote(planConfig, paramsWithout.planId, paramsWithout.customConfig, []);
            } catch (qErr) {
                console.warn('Error computing renewal quotes:', qErr.message);
            }

            const keyId = (planConfig.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
            const keySecret = (planConfig.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();

            subscriptionDetails = {
                planId: adminUser.planId || 'basic',
                planName: adminUser.planName || 'Basic Plan (Yearly)',
                planDurationMonths: adminUser.planDurationMonths || 12,
                approvedAt: adminUser.approvedAt || adminUser.requestedAt,
                planExpiryDate: adminUser.planExpiryDate || null,
                expiryFormatted: expiryFormattedStr,
                daysLeft: daysLeftVal,
                isNearExpiry: daysLeftVal !== null && daysLeftVal >= 0 && daysLeftVal <= 10,
                isExpired: daysLeftVal !== null && daysLeftVal < 0,
                isReadOnly: daysLeftVal !== null && daysLeftVal < 0,
                activeAddons,
                hasAddons: activeAddons.length > 0,
                quotas: {
                    partiesUsed: finalCustomers.length,
                    partiesLimit: adminUser.maxCustomersLimit ?? 500,
                    staffUsed: staffCount,
                    staffActive: unlockedStaffCount,
                    staffPaused: pausedStaffCount,
                    staffLimit: maxStaffLimit,
                    messagesUsed: adminUser.dailyMessageCount || 0,
                    messagesLimit: adminUser.dailyMessageLimit ?? 100
                },
                staffQuotaSelection: {
                    required: Boolean(maxStaffLimit > 0 && staffCount > maxStaffLimit && requiresStaffSelection),
                    hasExcessStaff: Boolean(maxStaffLimit > 0 && staffCount > maxStaffLimit),
                    totalStaff: staffCount,
                    maxStaffLimit: maxStaffLimit,
                    activeStaffCount: unlockedStaffCount,
                    pausedStaffCount: pausedStaffCount,
                    staffList: staffMembers.map(s => ({
                        _id: s._id,
                        username: s.username,
                        status: s.status || 'approved',
                        isQuotaLocked: Boolean(s.isQuotaLocked)
                    }))
                },
                featureAccess: adminUser.featureAccess,
                lastPaymentId: adminUser.lastPaymentId || '',
                lastAmountPaid: adminUser.lastAmountPaid || 0,
                renewWithAddonsQuote,
                renewWithoutAddonsQuote,
                availableAddons: (planConfig.addons || []).filter(a => a.isActive !== false),
                whatsappSalesNumber: planConfig.whatsappSalesNumber || '917021056404',
                isRazorpayConfigured: Boolean(keyId && keySecret)
            };
        }

        let totalPending = 0, actionRequiredCount = 0;
        let b_u30 = 0, b_30_60 = 0, b_60_90 = 0, b_90_120 = 0;
        let b_120_150 = 0, b_150_180 = 0, b_a180 = 0, b_onAcc = 0;
        let cnt_u30 = 0, cnt_30_60 = 0, cnt_60_90 = 0, cnt_90_120 = 0;
        let cnt_120_150 = 0, cnt_150_180 = 0, cnt_a180 = 0, cnt_onAcc = 0;

        const today = new Date(); today.setHours(0, 0, 0, 0);

        for (const c of finalCustomers) {
            const due = (c.totalAmount || 0) - (c.paidAmount || 0);
            totalPending += due;

            if (c.nextActionDate) {
                const nd = new Date(c.nextActionDate); nd.setHours(0, 0, 0, 0);
                if (due > 0 && today >= nd) actionRequiredCount++;
            } else if (due > 0) {
                actionRequiredCount++;
            }

            const ag = c.aging || {};
            const merged120to180 = (ag.days120to150 || 0) + (ag.days150to180 || 0);
            b_u30 += ag.under30 || 0;
            b_30_60 += ag.days30to60 || 0;
            b_60_90 += ag.days60to90 || 0;
            b_90_120 += ag.days90to120 || 0;
            b_120_150 += merged120to180;
            b_150_180 += ag.days150to180 || 0;
            b_a180 += ag.above180 || 0;
            b_onAcc += ag.onAccount || 0;

            if ((ag.under30 || 0) > 0) cnt_u30++;
            if ((ag.days30to60 || 0) > 0) cnt_30_60++;
            if ((ag.days60to90 || 0) > 0) cnt_60_90++;
            if ((ag.days90to120 || 0) > 0) cnt_90_120++;
            if (merged120to180 > 0) cnt_120_150++;
            if ((ag.days150to180 || 0) > 0) cnt_150_180++;
            if ((ag.above180 || 0) > 0) cnt_a180++;
            if ((ag.onAccount || 0) > 0) cnt_onAcc++;
        }

        const maxBucket = Math.max(b_u30, b_30_60, b_60_90, b_90_120, b_120_150, b_a180) || 1;
        const fmtINR = (n) => '₹ ' + Number(n).toLocaleString('en-IN');

        const stats = {
            totalPending, actionRequiredCount,
            totalParties: finalCustomers.length,
            buckets: {
                u30: { amt: b_u30, fmt: fmtINR(b_u30), cnt: cnt_u30, pct: Math.round((b_u30 / maxBucket) * 100) },
                d30_60: { amt: b_30_60, fmt: fmtINR(b_30_60), cnt: cnt_30_60, pct: Math.round((b_30_60 / maxBucket) * 100) },
                d60_90: { amt: b_60_90, fmt: fmtINR(b_60_90), cnt: cnt_60_90, pct: Math.round((b_60_90 / maxBucket) * 100) },
                d90_120: { amt: b_90_120, fmt: fmtINR(b_90_120), cnt: cnt_90_120, pct: Math.round((b_90_120 / maxBucket) * 100) },
                d120_150: { amt: b_120_150, fmt: fmtINR(b_120_150), cnt: cnt_120_150, pct: Math.round((b_120_150 / maxBucket) * 100) },
                d150_180: { amt: b_150_180, fmt: fmtINR(b_150_180), cnt: cnt_150_180, pct: Math.round((b_150_180 / maxBucket) * 100) },
                a180: { amt: b_a180, fmt: fmtINR(b_a180), cnt: cnt_a180, pct: Math.round((b_a180 / maxBucket) * 100) },
                onAcc: { amt: b_onAcc, fmt: fmtINR(b_onAcc), cnt: cnt_onAcc, pct: 0 }
            },
            totalPendingFmt: fmtINR(totalPending)
        };

        res.json({
            success: true,
            customers: finalCustomers,
            role: req.session.role,
            adminUser: adminUser,
            stats: stats,
            subscriptionAlert: subscriptionAlert,
            subscriptionDetails: subscriptionDetails,
            quotaAlert: quotaAlert
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ success: false, message: "Error loading dashboard." });
    }
});

module.exports = router;
