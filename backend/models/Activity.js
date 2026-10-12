const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    adminId: { type: String, required: true },
    userId: {
        type: String,
        required: true,
        default: function() { return this.adminId ? String(this.adminId) : 'system'; }
    },
    username: {
        type: String,
        required: true,
        default: function() { return this.actorName || 'Admin'; }
    },
    action: {
        type: String,
        required: true,
        default: function() { return this.actionType || 'Activity'; }
    },
    details: { type: String, required: true, default: '' },
    createdAt: { type: Date, default: Date.now }
});

activityLogSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);