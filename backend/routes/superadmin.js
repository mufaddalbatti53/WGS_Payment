const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Customer = require('../models/Customer');
const PlanConfig = require('../models/PlanConfig');
const { requireSuperAdmin } = require('../middleware/auth');
const {
    syncStaffQuotaForAdmin,
    notifySuperAdminAccountChange,
    runExpiryEmailScan
} = require('../utils/emailService');

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchedPlan(planConfigObj, planId, planName) {
    const plans = Array.isArray(planConfigObj?.plans) ? planConfigObj.plans : [];
    if (!plans.length) return null;
    const cleanId = String(planId || '').trim().toLowerCase();
    const cleanName = String(planName || '').trim().toLowerCase();

    if (cleanId) {
        const byId = plans.find(p => String(p.id || '').trim().toLowerCase() === cleanId);
        if (byId) return byId;
    }
    if (cleanName) {
        const byExactName = plans.find(p => String(p.name || '').trim().toLowerCase() === cleanName);
        if (byExactName) return byExactName;
        if (cleanName.includes('custom')) return plans.find(p => p.id === 'customized' || p.isCustom) || null;
        if (/\bpro\b/.test(cleanName)) return plans.find(p => p.id === 'pro') || null;
        if (cleanName.includes('basic')) return plans.find(p => p.id === 'basic') || null;
    }
    return null;
}

router.get('/dashboard', requireSuperAdmin, async (req, res) => {
    try {
        runExpiryEmailScan().catch(() => {});

        const [adminUsers, staffUsers, partyCounts, planConfigDoc] = await Promise.all([
            User.find({ role: 'admin' }).sort({ _id: -1 }).lean(),
            User.find({ role: 'staff' }).sort({ _id: -1 }).lean(),
            Customer.aggregate([{ $group: { _id: "$adminId", count: { $sum: 1 } } }]),
            PlanConfig.getOrCreateSingleton()
        ]);

        const configObj = planConfigDoc ? planConfigDoc.toObject() : { plans: [], addons: [] };

        const staffByAdmin = {};
        staffUsers.forEach(s => {
            if (s.adminId) {
                const aIdStr = s.adminId.toString();
                if (!staffByAdmin[aIdStr]) staffByAdmin[aIdStr] = [];
                staffByAdmin[aIdStr].push({
                    _id: s._id,
                    username: s.username,
                    role: s.role,
                    isQuotaLocked: Boolean(s.isQuotaLocked)
                });
            }
        });

        const partyMap = {};
        partyCounts.forEach(p => { if (p._id) partyMap[p._id.toString()] = p.count; });

        const enrichedAdmins = adminUsers.map(u => {
            const idStr = u._id.toString();
            const myStaffList = staffByAdmin[idStr] || [];
            const matchedPlan = findMatchedPlan(configObj, u.planId, u.planName);
            const resolvedPlanId = u.planId || (matchedPlan ? matchedPlan.id : 'basic');
            const resolvedPlanName = u.planName || (matchedPlan ? matchedPlan.name : 'Basic Plan');
            const resolvedDurationMonths = u.planDurationMonths || (matchedPlan ? matchedPlan.durationMonths : 12) || 12;
            const resolvedPlanPrice = (u.lastAmountPaid && u.lastAmountPaid > 0)
                ? u.lastAmountPaid
                : (matchedPlan ? Number(matchedPlan.price || 0) : 0);

            return {
                ...u,
                staffList: myStaffList,
                staffCount: myStaffList.length,
                partyCount: partyMap[idStr] || 0,
                maxStaffLimit: u.maxStaffLimit ?? (matchedPlan ? matchedPlan.maxStaffLimit : 5),
                maxCustomersLimit: u.maxCustomersLimit ?? (matchedPlan ? matchedPlan.maxCustomersLimit : 500),
                dailyMessageLimit: u.dailyMessageLimit ?? (matchedPlan ? matchedPlan.dailyMessageLimit : 100),
                dailyMessageCount: u.dailyMessageCount || 0,
                planId: resolvedPlanId,
                planName: resolvedPlanName,
                planDurationMonths: resolvedDurationMonths,
                planPrice: resolvedPlanPrice,
                livePlanPrice: matchedPlan ? Number(matchedPlan.price || 0) : resolvedPlanPrice,
                featureAccess: {
                    allowGoogleDriveBackup: u.featureAccess?.allowGoogleDriveBackup !== undefined ? Boolean(u.featureAccess.allowGoogleDriveBackup) : true,
                    allowExcelImport: u.featureAccess?.allowExcelImport !== undefined ? Boolean(u.featureAccess.allowExcelImport) : true,
                    allowPdfExport: u.featureAccess?.allowPdfExport !== undefined ? Boolean(u.featureAccess.allowPdfExport) : true
                }
            };
        });

        const pendingUsers = enrichedAdmins.filter(u => u.status === 'pending');
        const approvedUsers = enrichedAdmins.filter(u => u.status === 'approved' || !u.status);
        const suspendedUsers = enrichedAdmins.filter(u => u.status === 'suspended');
        const rejectedUsers = enrichedAdmins.filter(u => u.status === 'rejected');

        res.json({
            success: true,
            superadminUsername: req.session.username || 'Super Admin',
            pendingUsers,
            approvedUsers,
            suspendedUsers,
            rejectedUsers,
            planConfig: configObj
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error loading Super Admin dashboard: " + err.message });
    }
});

router.get('/subscription-settings', requireSuperAdmin, async (req, res) => {
    try {
        const config = await PlanConfig.getOrCreateSingleton();
        res.json({ success: true, planConfig: config.toObject() });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load subscription settings: ' + err.message });
    }
});

router.post('/subscription-settings', requireSuperAdmin, async (req, res) => {
    try {
        const config = await PlanConfig.getOrCreateSingleton(true);
        const { razorpayKeyId, razorpayKeySecret, whatsappSalesNumber, superadminEmail, currency, plans, addons } = req.body;

        if (razorpayKeyId !== undefined) config.razorpayKeyId = String(razorpayKeyId).trim();
        if (razorpayKeySecret !== undefined) config.razorpayKeySecret = String(razorpayKeySecret).trim();
        if (whatsappSalesNumber !== undefined) config.whatsappSalesNumber = String(whatsappSalesNumber).trim();
        if (superadminEmail !== undefined) config.superadminEmail = String(superadminEmail).trim();
        if (currency !== undefined) config.currency = String(currency).trim() || 'INR';

        if (Array.isArray(plans) && plans.length > 0) {
            config.plans = plans.map(p => ({
                id: String(p.id || 'basic').trim(),
                name: String(p.name || 'Plan').trim(),
                tagline: String(p.tagline || '').trim(),
                badge: String(p.badge || '').trim(),
                price: Math.max(0, Number(p.price) || 0),
                durationMonths: Math.max(1, parseInt(p.durationMonths) || 12),
                billingLabel: String(p.billingLabel || '/ year').trim(),
                maxCustomersLimit: Math.max(0, parseInt(p.maxCustomersLimit) || 0),
                maxStaffLimit: Math.max(0, parseInt(p.maxStaffLimit) || 0),
                dailyMessageLimit: Math.max(0, parseInt(p.dailyMessageLimit) || 0),
                isPopular: Boolean(p.isPopular),
                isCustom: Boolean(p.isCustom || p.id === 'customized'),
                basePrice: Math.max(0, Number(p.basePrice ?? 2999)),
                pricePer100Parties: Math.max(0, Number(p.pricePer100Parties ?? 500)),
                pricePerStaff: Math.max(0, Number(p.pricePerStaff ?? 400)),
                pricePer50Messages: Math.max(0, Number(p.pricePer50Messages ?? 300)),
                featureAccess: {
                    allowGoogleDriveBackup: p.featureAccess?.allowGoogleDriveBackup !== undefined ? Boolean(p.featureAccess.allowGoogleDriveBackup) : true,
                    allowExcelImport: p.featureAccess?.allowExcelImport !== undefined ? Boolean(p.featureAccess.allowExcelImport) : true,
                    allowPdfExport: p.featureAccess?.allowPdfExport !== undefined ? Boolean(p.featureAccess.allowPdfExport) : true
                },
                features: Array.isArray(p.features)
                    ? p.features.map(f => String(f).trim()).filter(Boolean)
                    : String(p.features || '').split('\n').map(f => f.trim()).filter(Boolean),
                isActive: p.isActive !== false
            }));
        }

        if (Array.isArray(addons)) {
            config.addons = addons.map((a, idx) => ({
                id: String(a.id || `addon_${Date.now()}_${idx}`).trim(),
                name: String(a.name || 'Add-on').trim(),
                description: String(a.description || '').trim(),
                type: ['parties', 'staff', 'messages', 'gdrive', 'duration'].includes(a.type) ? a.type : 'parties',
                value: Math.max(0, Number(a.value) || 0),
                price: Math.max(0, Number(a.price) || 0),
                isActive: a.isActive !== false
            }));
        }

        config.updatedAt = new Date();
        await config.save();
        if (typeof PlanConfig.setCachedSingleton === 'function') {
            PlanConfig.setCachedSingleton(config);
        }

        // Also sync any unpaid pending admins on standard Basic/Pro plans so their pending defaults reflect the updated plan values
        for (const plan of (config.plans || [])) {
            if (!plan.isCustom && (plan.id === 'basic' || plan.id === 'pro')) {
                await User.updateMany(
                    {
                        role: 'admin',
                        status: 'pending',
                        planId: plan.id,
                        $or: [{ lastPaymentId: { $exists: false } }, { lastPaymentId: null }, { lastPaymentId: '' }],
                        'activeAddons.0': { $exists: false }
                    },
                    {
                        $set: {
                            planName: plan.name,
                            maxCustomersLimit: plan.maxCustomersLimit,
                            maxStaffLimit: plan.maxStaffLimit,
                            dailyMessageLimit: plan.dailyMessageLimit,
                            planDurationMonths: plan.durationMonths || 12,
                            lastAmountPaid: plan.price,
                            featureAccess: plan.featureAccess
                        }
                    }
                );
            }
        }

        res.json({
            success: true,
            message: 'Subscription plans, add-ons, and Razorpay settings saved successfully!',
            planConfig: config.toObject()
        });
    } catch (err) {
        console.error('Error saving subscription settings:', err);
        res.status(500).json({ success: false, message: 'Failed to save subscription settings: ' + err.message });
    }
});

router.post('/update-limits/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid User ID provided.' });
        }

        const {
            maxStaffLimit,
            maxCustomersLimit,
            dailyMessageLimit,
            planExpiryDate,
            status,
            planName,
            planId,
            planDurationMonths,
            planPrice,
            featureAccess
        } = req.body;

        const planConfigDoc = await PlanConfig.getOrCreateSingleton();
        const matchedPlan = findMatchedPlan(planConfigDoc ? planConfigDoc.toObject() : null, planId, planName);

        const updateData = {
            maxStaffLimit: Math.max(0, parseInt(maxStaffLimit) || 0),
            maxCustomersLimit: Math.max(0, parseInt(maxCustomersLimit) || 0),
            dailyMessageLimit: Math.max(0, parseInt(dailyMessageLimit) || 0)
        };

        if (planName !== undefined) {
            const cleanPlanName = String(planName).trim() || (matchedPlan ? matchedPlan.name : 'Custom / Standard');
            updateData.planName = cleanPlanName;
            if (planId) {
                updateData.planId = String(planId).trim();
            } else if (matchedPlan) {
                updateData.planId = matchedPlan.id;
            } else if (/custom/i.test(cleanPlanName)) {
                updateData.planId = 'customized';
            } else if (/\bpro\b/i.test(cleanPlanName)) {
                updateData.planId = 'pro';
            } else if (/basic/i.test(cleanPlanName)) {
                updateData.planId = 'basic';
            }
        } else if (planId) {
            updateData.planId = String(planId).trim();
            if (matchedPlan) updateData.planName = matchedPlan.name;
        }

        const resolvedMonths = Math.max(1, parseInt(planDurationMonths) || (matchedPlan ? matchedPlan.durationMonths : 12) || 12);
        updateData.planDurationMonths = resolvedMonths;

        if (planPrice !== undefined && planPrice !== null && planPrice !== '') {
            updateData.lastAmountPaid = Math.max(0, Number(planPrice) || 0);
        } else if (matchedPlan && matchedPlan.price > 0) {
            const existingForPrice = await User.findById(req.params.id).select('lastAmountPaid planId').lean();
            if (!existingForPrice || !existingForPrice.lastAmountPaid || existingForPrice.planId !== updateData.planId) {
                updateData.lastAmountPaid = Number(matchedPlan.price);
            }
        }

        if (featureAccess && typeof featureAccess === 'object') {
            updateData.featureAccess = {
                allowGoogleDriveBackup: featureAccess.allowGoogleDriveBackup !== undefined ? Boolean(featureAccess.allowGoogleDriveBackup) : true,
                allowExcelImport: featureAccess.allowExcelImport !== undefined ? Boolean(featureAccess.allowExcelImport) : true,
                allowPdfExport: featureAccess.allowPdfExport !== undefined ? Boolean(featureAccess.allowPdfExport) : true
            };
        }

        const existingUser = await User.findById(req.params.id).select('approvedAt planExpiryDate planDurationMonths').lean();

        if (status && ['approved', 'pending', 'rejected', 'suspended'].includes(status)) {
            updateData.status = status;
            if (status === 'approved' && existingUser && !existingUser.approvedAt) {
                updateData.approvedAt = new Date();
            }
            await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: status });
        }

        if (planExpiryDate) {
            updateData.planExpiryDate = new Date(planExpiryDate);
            updateData.lastPreExpiryEmailSentAt = null;
            updateData.lastPreExpiryDaysNotified = null;
            updateData.lastPostExpiryEmailSentAt = null;
        } else {
            // Automatically set expiry date based on plan validity if none was provided
            const exp = new Date();
            exp.setMonth(exp.getMonth() + resolvedMonths);
            updateData.planExpiryDate = exp;
            updateData.lastPreExpiryEmailSentAt = null;
            updateData.lastPreExpiryDaysNotified = null;
            updateData.lastPostExpiryEmailSentAt = null;
        }

        const targetUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (targetUser) {
            const staffQuotaStatus = await syncStaffQuotaForAdmin(targetUser._id, targetUser.maxStaffLimit);
            await notifySuperAdminAccountChange(
                targetUser,
                'Plan, Quotas & Access Updated',
                `Super Admin updated your subscription plan (${targetUser.planName || 'Standard'}), account quotas, expiry date, or feature permissions.`,
                staffQuotaStatus
            );
        }

        res.json({ success: true, message: `Updated plan limits, access, and status for ${targetUser ? targetUser.username : 'admin'}.`, user: targetUser });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update limits: ' + err.message });
    }
});

router.post('/toggle-staff-quota/:staffId', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.staffId)) {
            return res.status(400).json({ success: false, message: 'Invalid Staff ID.' });
        }
        const staff = await User.findById(req.params.staffId);
        if (!staff || staff.role !== 'staff') {
            return res.status(404).json({ success: false, message: 'Staff user not found.' });
        }
        staff.isQuotaLocked = !staff.isQuotaLocked;
        await staff.save();
        res.json({
            success: true,
            message: `Staff ${staff.username} access is now ${staff.isQuotaLocked ? 'Locked / Paused 🔒' : 'Active ✅'}.`,
            isQuotaLocked: staff.isQuotaLocked,
            staffId: staff._id
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to toggle staff quota: ' + err.message });
    }
});

router.post('/change-credentials', requireSuperAdmin, async (req, res) => {
    try {
        const { newUsername, currentPassword, newPassword, confirmPassword } = req.body;
        const cleanUsername = (newUsername || '').trim();

        if (!cleanUsername || !currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        if (confirmPassword !== undefined && newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'New password and confirm password do not match.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
        }

        const user = await User.findById(req.session.userId).select('+password');
        if (!user || user.role !== 'superadmin') {
            return res.status(404).json({ success: false, message: 'Super Admin account not found.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        if (cleanUsername.toLowerCase() !== user.username.toLowerCase()) {
            const existingUser = await User.findOne({
                username: new RegExp('^' + escapeRegExp(cleanUsername) + '$', 'i'),
                _id: { $ne: user._id }
            });
            if (existingUser) {
                return res.status(409).json({ success: false, message: `Username "${cleanUsername}" is already taken.` });
            }
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.username = cleanUsername;
        user.password = hashedPassword;
        await user.save();

        req.session.username = cleanUsername;

        res.json({ success: true, message: 'Credentials updated successfully! Logged in as: ' + cleanUsername });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update credentials: ' + err.message });
    }
});

router.post('/approve/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const existingUser = await User.findById(req.params.id);
        const planConfigDoc = await PlanConfig.getOrCreateSingleton();
        const matchedPlan = findMatchedPlan(planConfigDoc ? planConfigDoc.toObject() : null, existingUser?.planId, existingUser?.planName);

        const now = new Date();
        const updateObj = {
            status: 'approved',
            approvedAt: now,
            lastPreExpiryEmailSentAt: null,
            lastPreExpiryDaysNotified: null,
            lastPostExpiryEmailSentAt: null
        };

        // If this is a manual approval (no Razorpay payment ID and no custom add-ons) and matches a standard plan (Basic/Pro),
        // ensure the latest configured plan values from Super Admin are applied on approval
        if (existingUser && !existingUser.lastPaymentId && (!existingUser.activeAddons || existingUser.activeAddons.length === 0) && matchedPlan && !matchedPlan.isCustom) {
            updateObj.planId = matchedPlan.id;
            updateObj.planName = matchedPlan.name;
            updateObj.maxCustomersLimit = matchedPlan.maxCustomersLimit;
            updateObj.maxStaffLimit = matchedPlan.maxStaffLimit;
            updateObj.dailyMessageLimit = matchedPlan.dailyMessageLimit;
            updateObj.planDurationMonths = matchedPlan.durationMonths || 12;
            updateObj.lastAmountPaid = matchedPlan.price;
            if (matchedPlan.featureAccess) {
                updateObj.featureAccess = matchedPlan.featureAccess;
            }
        }

        const durationMonths = Number(updateObj.planDurationMonths || existingUser?.planDurationMonths || matchedPlan?.durationMonths || 12);
        if (!existingUser || !existingUser.planExpiryDate || new Date(existingUser.planExpiryDate) <= now) {
            const expiry = new Date(now);
            expiry.setMonth(expiry.getMonth() + durationMonths);
            updateObj.planExpiryDate = expiry;
        }

        const approvedUser = await User.findByIdAndUpdate(req.params.id, updateObj, { new: true });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        if (approvedUser) {
            const staffQuotaStatus = await syncStaffQuotaForAdmin(approvedUser._id, approvedUser.maxStaffLimit);
            await notifySuperAdminAccountChange(
                approvedUser,
                'Account Approved & Activated',
                'Congratulations! Your Admin account has been approved and activated by Super Admin. You can now sign in to your dashboard.',
                staffQuotaStatus
            );
        }
        res.json({ success: true, message: 'Account approved.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/suspend/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' }, { new: true });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'suspended' });
        if (u) {
            await notifySuperAdminAccountChange(
                u,
                'Account Suspended',
                'Your Admin account has been temporarily suspended by Super Admin. All your ledger data remains safely preserved. Please contact Super Admin or renew your subscription to reactivate access.'
            );
        }
        res.json({ success: true, message: `Account for ${u ? u.username : 'admin'} suspended.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/resume/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        if (u) {
            const staffQuotaStatus = await syncStaffQuotaForAdmin(u._id, u.maxStaffLimit);
            await notifySuperAdminAccountChange(
                u,
                'Account Reactivated',
                'Your Admin account has been reactivated by Super Admin. Full access to your workspace is restored.',
                staffQuotaStatus
            );
        }
        res.json({ success: true, message: `Account for ${u ? u.username : 'admin'} reactivated.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/reject/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'rejected' });
        if (u) {
            await notifySuperAdminAccountChange(
                u,
                'Account Access Revoked / Declined',
                'Your Admin account access has been revoked or declined by Super Admin. Please contact support if you need assistance.'
            );
        }
        res.json({ success: true, message: 'Account request rejected.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/delete-admin/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const targetUser = await User.findById(req.params.id).lean();
        await User.deleteMany({ role: 'staff', adminId: req.params.id });
        await Customer.deleteMany({ adminId: req.params.id });
        await User.findByIdAndDelete(req.params.id);
        if (targetUser) {
            await notifySuperAdminAccountChange(
                targetUser,
                'Account Permanently Deleted',
                'Your Admin account and associated workspace data have been permanently deleted by Super Admin.'
            );
        }
        res.json({ success: true, message: 'Admin account and associated data deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
