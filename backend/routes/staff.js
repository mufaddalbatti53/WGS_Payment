const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { requireAdmin, logActivity } = require('../middleware/auth');

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', requireAdmin, async (req, res) => {
    try {
        const myStaff = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const adminUser = await User.findById(req.session.adminId).lean() || {};
        const maxStaffLimit = adminUser.maxStaffLimit ?? 5;

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

        res.json({
            success: true,
            staffMembers: myStaff,
            maxStaffLimit: maxStaffLimit,
            currentStaffCount: myStaff.length,
            subscriptionAlert: subscriptionAlert
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error loading staff." });
    }
});

router.post('/', requireAdmin, async (req, res) => {
    try {
        const rawUsername = req.body.username ? req.body.username.trim() : '';
        if (!rawUsername || !req.body.password) {
            return res.status(400).json({ success: false, message: 'Username and Password are required.' });
        }

        const adminUser = await User.findById(req.session.adminId);
        const maxStaff = adminUser ? (adminUser.maxStaffLimit ?? 5) : 5;
        if (maxStaff > 0) {
            const currentStaffCount = await User.countDocuments({ role: 'staff', adminId: req.session.adminId });
            if (currentStaffCount >= maxStaff) {
                return res.status(403).json({ success: false, message: `Staff limit reached (${currentStaffCount}/${maxStaff}). Contact Super Admin to upgrade your quota.` });
            }
        }

        const existingUser = await User.findOne({ username: new RegExp('^' + escapeRegExp(rawUsername) + '$', 'i') });
        if (existingUser) {
            return res.status(409).json({ success: false, message: `Username "${rawUsername}" is already taken.` });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const dummyAnswer = await bcrypt.hash("admin-managed", 10);

        const newStaff = await User.create({
            username: rawUsername,
            password: hashedPassword,
            role: 'staff',
            status: 'approved',
            adminId: req.session.adminId,
            securityQuestion: "Managed by Admin?",
            securityAnswer: dummyAnswer
        });

        await logActivity(req, "Created Staff", `Created: ${rawUsername}`);
        res.json({ success: true, message: `Staff account "${rawUsername}" created successfully.`, staff: newStaff });
    } catch (e) {
        console.error("Staff Creation Error: ", e);
        res.status(500).json({ success: false, message: 'Failed to create staff: ' + e.message });
    }
});

router.post('/reset-password', requireAdmin, async (req, res) => {
    try {
        const { staffId, newPassword } = req.body;
        if (!staffId || !newPassword) return res.status(400).json({ success: false, message: 'Staff member and new password are required.' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const staff = await User.findOneAndUpdate(
            { _id: staffId, adminId: req.session.adminId },
            { password: hashedPassword }
        );
        if (staff) await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
        res.json({ success: true, message: 'Staff password reset successfully.' });
    } catch (err) {
        console.error("Staff Reset Error:", err);
        res.status(500).json({ success: false, message: 'Failed to reset staff password: ' + err.message });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const staff = await User.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
        if (staff) await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
        res.json({ success: true, message: 'Staff deleted successfully.' });
    } catch (err) {
        console.error("Staff Delete Error:", err);
        res.status(500).json({ success: false, message: "Failed to delete staff." });
    }
});

module.exports = router;
