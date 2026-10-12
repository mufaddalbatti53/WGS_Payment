const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const User = require('../models/User');

router.get('/', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    if (req.session.role === 'superadmin') {
        return res.json({ success: true, redirect: 'superadmin.html' });
    }

    try {
        let finalCustomers = [];

        if (req.session.role === 'customer') {
            if (req.session.userPhone) {
                finalCustomers = await Customer.find({
                    phone: { $regex: new RegExp(req.session.userPhone + '$') }
                }).sort({ _id: -1 }).limit(1).lean();
            } else {
                finalCustomers = await Customer.find({ _id: req.session.userId }).lean();
            }
        } else {
            finalCustomers = await Customer.find({ adminId: req.session.adminId }).lean();
        }

        const adminUser = await User.findById(req.session.adminId).select('+googleDriveToken').lean() || {};
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
            if (adminUser.planExpiryDate && new Date() > new Date(adminUser.planExpiryDate)) {
                req.session.destroy();
                return res.status(403).json({ success: false, message: "⌛ Your subscription plan has expired. Please contact Super Admin to renew your subscription." });
            }
        }

        let subscriptionAlert = null;
        if (adminUser.planExpiryDate) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(adminUser.planExpiryDate); expiry.setHours(0, 0, 0, 0);
            const diffTime = expiry.getTime() - today.getTime();
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLeft <= 10) {
                subscriptionAlert = {
                    expired: daysLeft < 0,
                    daysLeft: Math.max(0, daysLeft),
                    expiryFormatted: expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
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
            quotaAlert: quotaAlert
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ success: false, message: "Error loading dashboard." });
    }
});

module.exports = router;
