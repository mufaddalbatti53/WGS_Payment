const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/Activity');
const { requireLogin, requireAdmin } = require('../middleware/auth');

router.get('/', requireLogin, async (req, res) => {
    try {
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).limit(500).lean();
        res.json({ success: true, activities: activities, role: req.session.role });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error loading activity." });
    }
});

router.post('/delete-bulk', requireAdmin, async (req, res) => {
    try {
        const { filterType, startDate, endDate } = req.body;
        let query = { adminId: req.session.adminId };
        
        if (filterType === 'older_than_30') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            query.createdAt = { $lt: cutoff };
        } else if (filterType === 'last_30') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            query.createdAt = { $gte: cutoff };
        } else if (filterType === 'custom' && startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }
        await ActivityLog.deleteMany(query);
        res.json({ success: true, message: "Activity logs deleted successfully." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to delete logs." });
    }
});

module.exports = router;
