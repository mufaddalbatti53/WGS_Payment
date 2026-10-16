const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { requireAdmin, logActivity, isPlanExpiredDate, invalidateAuthCache } = require('../middleware/auth');
const { syncStaffQuotaForAdmin } = require('../utils/emailService');

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', requireAdmin, async (req, res) => {
    try {
        const myStaff = await User.find({ role: 'staff', adminId: req.session.adminId }).sort({ _id: 1 }).lean();
        const adminUser = await User.findById(req.session.adminId).lean() || {};
        const maxStaffLimit = adminUser.maxStaffLimit ?? 5;

        let subscriptionAlert = null;
        let isExpired = false;
        if (adminUser.planExpiryDate) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(adminUser.planExpiryDate); expiry.setHours(0, 0, 0, 0);
            const diffTime = expiry.getTime() - today.getTime();
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isExpired = daysLeft < 0;

            if (daysLeft <= 10) {
                subscriptionAlert = {
                    expired: daysLeft < 0,
                    daysLeft: Math.max(0, daysLeft),
                    expiryFormatted: expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                };
            }
        }

        const activeStaffCount = myStaff.filter(s => !s.isQuotaLocked).length;
        const pausedStaffCount = myStaff.filter(s => s.isQuotaLocked).length;
        const hasExcessStaff = maxStaffLimit > 0 && myStaff.length > maxStaffLimit;
        const requiresStaffSelection = Boolean(hasExcessStaff && (adminUser.requiresStaffSelection || activeStaffCount > maxStaffLimit));

        res.json({
            success: true,
            staffMembers: myStaff.map(s => ({
                ...s,
                isQuotaLocked: Boolean(s.isQuotaLocked)
            })),
            maxStaffLimit: maxStaffLimit,
            currentStaffCount: myStaff.length,
            activeStaffCount,
            pausedStaffCount,
            hasExcessStaff,
            requiresStaffSelection,
            isExpired,
            subscriptionAlert: subscriptionAlert
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error loading staff." });
    }
});

// POST /api/staff/select-active — Admin selects which `maxStaffLimit` staff members get active access
router.post('/select-active', requireAdmin, async (req, res) => {
    try {
        const adminUser = await User.findById(req.session.adminId);
        if (!adminUser) {
            return res.status(404).json({ success: false, message: 'Admin account not found.' });
        }
        if (isPlanExpiredDate(adminUser.planExpiryDate)) {
            return res.status(403).json({
                success: false,
                code: 'PLAN_EXPIRED',
                message: 'Your subscription has expired. Please renew your plan or add an add-on first.'
            });
        }

        const maxStaff = Number(adminUser.maxStaffLimit ?? 5);
        const allStaff = await User.find({ role: 'staff', adminId: req.session.adminId }).sort({ _id: 1 });
        const rawIds = Array.isArray(req.body.activeStaffIds) ? req.body.activeStaffIds.map(String) : [];

        if (maxStaff > 0 && rawIds.length > maxStaff) {
            return res.status(400).json({
                success: false,
                message: `Your current plan allows up to ${maxStaff} active staff accounts. Please select at most ${maxStaff} staff members.`
            });
        }

        if (allStaff.length > 0 && rawIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: `Please select up to ${Math.min(allStaff.length, maxStaff || allStaff.length)} staff member(s) to activate.`
            });
        }

        const staffQuotaStatus = await syncStaffQuotaForAdmin(req.session.adminId, maxStaff, rawIds);
        invalidateAuthCache();
        await logActivity(req, "Selected Active Staff", `Activated ${staffQuotaStatus.activeStaffCount} of ${staffQuotaStatus.totalStaff} staff accounts within plan quota (${maxStaff}).`);

        res.json({
            success: true,
            message: `Active staff updated! ${staffQuotaStatus.activeStaffCount} staff enabled, ${staffQuotaStatus.pausedStaffCount} paused.`,
            staffQuotaStatus
        });
    } catch (err) {
        console.error("Select active staff error:", err);
        res.status(500).json({ success: false, message: 'Failed to update active staff selection: ' + err.message });
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
                return res.status(403).json({ success: false, message: `Staff limit reached (${currentStaffCount}/${maxStaff}). Upgrade your plan or purchase an Extra Staff Add-on.` });
            }
        }

        if (!req.body.password || req.body.password.toString().length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
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
            isQuotaLocked: false,
            adminId: req.session.adminId,
            securityQuestion: "Managed by Admin?",
            securityAnswer: dummyAnswer
        });

        await logActivity(req, "Created Staff", `Created: ${rawUsername}`);

        // Sanitize staff object before returning to client (do not leak password hash)
        const staffObj = newStaff.toObject();
        delete staffObj.password;
        delete staffObj.securityAnswer;

        res.json({ success: true, message: `Staff account "${rawUsername}" created successfully.`, staff: staffObj });
    } catch (e) {
        console.error("Staff Creation Error: ", e);
        res.status(500).json({ success: false, message: 'Failed to create staff account. Please try again.' });
    }
});

router.post('/reset-password', requireAdmin, async (req, res) => {
    try {
        const { staffId, newPassword } = req.body;
        if (!staffId || !newPassword) return res.status(400).json({ success: false, message: 'Staff member and new password are required.' });
        if (newPassword.toString().length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const staff = await User.findOneAndUpdate(
            { _id: staffId, adminId: req.session.adminId },
            { password: hashedPassword }
        );
        if (staff) await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
        res.json({ success: true, message: 'Staff password reset successfully.' });
    } catch (err) {
        console.error("Staff Reset Error:", err);
        res.status(500).json({ success: false, message: 'Failed to reset staff password. Please try again.' });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const staff = await User.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
        if (staff) {
            const adminUser = await User.findById(req.session.adminId).select('maxStaffLimit').lean();
            await syncStaffQuotaForAdmin(req.session.adminId, adminUser ? adminUser.maxStaffLimit : 5);
            invalidateAuthCache();
            await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
        }
        res.json({ success: true, message: 'Staff deleted successfully.' });
    } catch (err) {
        console.error("Staff Delete Error:", err);
        res.status(500).json({ success: false, message: "Failed to delete staff." });
    }
});

module.exports = router;
