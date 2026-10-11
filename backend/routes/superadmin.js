const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { requireSuperAdmin } = require('../middleware/auth');

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/dashboard', requireSuperAdmin, async (req, res) => {
    try {
        const [adminUsers, staffUsers, partyCounts] = await Promise.all([
            User.find({ role: 'admin' }).sort({ _id: -1 }).lean(),
            User.find({ role: 'staff' }).sort({ _id: -1 }).lean(),
            Customer.aggregate([{ $group: { _id: "$adminId", count: { $sum: 1 } } }])
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
                dailyMessageCount: u.dailyMessageCount || 0
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
            rejectedUsers
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error loading Super Admin dashboard: " + err.message });
    }
});

router.post('/update-limits/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid User ID provided.' });
        }

        const { maxStaffLimit, maxCustomersLimit, dailyMessageLimit, planExpiryDate, status } = req.body;

        const updateData = {
            maxStaffLimit: Math.max(0, parseInt(maxStaffLimit) || 0),
            maxCustomersLimit: Math.max(0, parseInt(maxCustomersLimit) || 0),
            dailyMessageLimit: Math.max(0, parseInt(dailyMessageLimit) || 0)
        };

        if (status && ['approved', 'pending', 'rejected', 'suspended'].includes(status)) {
            updateData.status = status;
            if (status === 'approved') {
                const existing = await User.findById(req.params.id).select('approvedAt').lean();
                if (existing && !existing.approvedAt) {
                    updateData.approvedAt = new Date();
                }
            }
            await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: status });
        }

        if (planExpiryDate) {
            updateData.planExpiryDate = new Date(planExpiryDate);
        } else if (planExpiryDate === '') {
            updateData.planExpiryDate = null;
        }

        const targetUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, message: `Updated plan limits and status for ${targetUser ? targetUser.username : 'admin'}.`, user: targetUser });
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
        await User.findByIdAndUpdate(req.params.id, { status: 'approved', approvedAt: new Date() });
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
