const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAdmin, logActivity } = require('../middleware/auth');

const handleSettingsSave = async (req, res) => {
    try {
        const targetId = req.session.adminId || req.session.userId;
        const updatedUser = await User.findByIdAndUpdate(targetId, {
            companyName: req.body.companyName, 
            addressLine1: req.body.addressLine1, 
            addressLine2: req.body.addressLine2,
            addressLine3: req.body.addressLine3, 
            dlNo: req.body.dlNo, 
            msmeNo: req.body.msmeNo,
            contactNo: req.body.contactNo, 
            companyEmail: req.body.companyEmail,
            bankName: req.body.bankName, 
            accountName: req.body.accountName,
            accountNumber: req.body.accountNumber, 
            ifscCode: req.body.ifscCode, 
            upiDetails: req.body.upiDetails,
        }, { new: true }).lean();
        await logActivity(req, "Company Profile", "Updated company profile and settings.");
        res.json({ success: true, message: "Settings updated successfully.", adminUser: updatedUser });
    } catch (err) {
        console.error("Settings update error:", err);
        res.status(500).json({ success: false, message: "Failed to update settings." });
    }
};

router.put('/', requireAdmin, handleSettingsSave);
router.post('/', requireAdmin, handleSettingsSave);

const handleAutoBackupSave = async (req, res) => {
    try {
        const interval = Number(req.body.autoBackupInterval) || 0;
        await User.findByIdAndUpdate(req.session.adminId, {
            autoBackupInterval: interval
        });
        await logActivity(req, "Automation Updated", `Set Google Drive auto-backup interval to ${interval} days.`);
        res.json({ success: true, message: "Auto-backup settings saved." });
    } catch (err) {
        console.error("Auto-backup settings save error:", err);
        res.status(500).json({ success: false, message: "Failed to save auto-backup settings." });
    }
};

router.put('/auto-backup', requireAdmin, handleAutoBackupSave);
router.post('/auto-backup', requireAdmin, handleAutoBackupSave);

module.exports = router;
