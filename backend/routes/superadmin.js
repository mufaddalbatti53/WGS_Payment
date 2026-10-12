const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Customer = require('../models/Customer');
const PlanConfig = require('../models/PlanConfig');
const { requireSuperAdmin } = require('../middleware/auth');

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/dashboard', requireSuperAdmin, async (req, res) => {
    try {
        const [adminUsers, staffUsers, partyCounts, planConfigDoc] = await Promise.all([
            User.find({ role: 'admin' }).sort({ _id: -1 }).lean(),
            User.find({ role: 'staff' }).sort({ _id: -1 }).lean(),
            Customer.aggregate([{ $group: { _id: "$adminId", count: { $sum: 1 } } }]),
            PlanConfig.getOrCreateSingleton()
        ]);

        const staffByAdmin = {};
        staffUsers.forEach(s => {
            if (s.adminId) {
                const aIdStr = s.adminId.toString();
                if (!staffByAdmin[aIdStr]) staffByAdmin[aIdStr] = [];
                staffByAdmin[aIdStr].push({
                    _id: s._id,
                    username: s.username,
                    role: s.role
                });
            }
        });

        const partyMap = {};
        partyCounts.forEach(p => { if (p._id) partyMap[p._id.toString()] = p.count; });

        const enrichedAdmins = adminUsers.map(u => {
            const idStr = u._id.toString();
            const myStaffList = staffByAdmin[idStr] || [];
            return {
                ...u,
                staffList: myStaffList,
                staffCount: myStaffList.length,
                partyCount: partyMap[idStr] || 0,
                maxStaffLimit: u.maxStaffLimit ?? 5,
                maxCustomersLimit: u.maxCustomersLimit ?? 500,
                dailyMessageLimit: u.dailyMessageLimit ?? 100,
                dailyMessageCount: u.dailyMessageCount || 0,
                planName: u.planName || 'Custom / Standard',
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
            planConfig: planConfigDoc ? planConfigDoc.toObject() : null
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
        const { razorpayKeyId, razorpayKeySecret, whatsappSalesNumber, currency, plans, addons } = req.body;

        if (razorpayKeyId !== undefined) config.razorpayKeyId = String(razorpayKeyId).trim();
        if (razorpayKeySecret !== undefined) config.razorpayKeySecret = String(razorpayKeySecret).trim();
        if (whatsappSalesNumber !== undefined) config.whatsappSalesNumber = String(whatsappSalesNumber).trim();
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

        const { maxStaffLimit, maxCustomersLimit, dailyMessageLimit, planExpiryDate, status, planName, planId, featureAccess } = req.body;

        const updateData = {
            maxStaffLimit: Math.max(0, parseInt(maxStaffLimit) || 0),
            maxCustomersLimit: Math.max(0, parseInt(maxCustomersLimit) || 0),
            dailyMessageLimit: Math.max(0, parseInt(dailyMessageLimit) || 0)
        };

        if (planName !== undefined) {
            const cleanPlanName = String(planName).trim() || 'Custom / Standard';
            updateData.planName = cleanPlanName;
            if (planId) {
                updateData.planId = String(planId).trim();
            } else if (/custom/i.test(cleanPlanName)) {
                updateData.planId = 'customized';
            } else if (/\bpro\b/i.test(cleanPlanName)) {
                updateData.planId = 'pro';
            } else if (/basic/i.test(cleanPlanName)) {
                updateData.planId = 'basic';
            }
        } else if (planId) {
            updateData.planId = String(planId).trim();
        }

        if (featureAccess && typeof featureAccess === 'object') {
            updateData.featureAccess = {
                allowGoogleDriveBackup: featureAccess.allowGoogleDriveBackup !== undefined ? Boolean(featureAccess.allowGoogleDriveBackup) : true,
                allowExcelImport: featureAccess.allowExcelImport !== undefined ? Boolean(featureAccess.allowExcelImport) : true,
                allowPdfExport: featureAccess.allowPdfExport !== undefined ? Boolean(featureAccess.allowPdfExport) : true
            };
        }

        if (status && ['approved', 'pending', 'rejected', 'suspended'].includes(status)) {
            updateData.status = status;
            if (status === 'approved') {
                const existing = await User.findById(req.params.id).select('approvedAt planExpiryDate planDurationMonths').lean();
                if (existing && !existing.approvedAt) {
                    updateData.approvedAt = new Date();
                }
                if (existing && !existing.planExpiryDate && !planExpiryDate && existing.planDurationMonths > 0) {
                    const exp = new Date();
                    exp.setMonth(exp.getMonth() + Number(existing.planDurationMonths || 12));
                    updateData.planExpiryDate = exp;
                }
            }
            await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: status });
        }

        if (planExpiryDate) {
            updateData.planExpiryDate = new Date(planExpiryDate);
        } else if (planExpiryDate === '' && !updateData.planExpiryDate) {
            updateData.planExpiryDate = null;
        }

        const targetUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, message: `Updated plan limits, access, and status for ${targetUser ? targetUser.username : 'admin'}.`, user: targetUser });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update limits: ' + err.message });
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
        const now = new Date();
        const updateObj = { status: 'approved', approvedAt: now };
        if (existingUser && !existingUser.planExpiryDate && existingUser.planDurationMonths > 0) {
            const expiry = new Date(now);
            expiry.setMonth(expiry.getMonth() + Number(existingUser.planDurationMonths));
            updateObj.planExpiryDate = expiry;
        }
        await User.findByIdAndUpdate(req.params.id, updateObj);
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        res.json({ success: true, message: 'Account approved.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/suspend/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'suspended' });
        res.json({ success: true, message: `Account for ${u ? u.username : 'admin'} suspended.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/resume/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'approved' });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        res.json({ success: true, message: `Account for ${u ? u.username : 'admin'} reactivated.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/reject/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await User.findByIdAndUpdate(req.params.id, { status: 'rejected' });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'rejected' });
        res.json({ success: true, message: 'Account request rejected.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/delete-admin/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await User.deleteMany({ role: 'staff', adminId: req.params.id });
        await Customer.deleteMany({ adminId: req.params.id });
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Admin account and associated data deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
