const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    adminId: { type: String, required: true },      // Links log to the specific company/admin
    userId: { type: String, required: true },       // Exact ID of the staff/admin who did it
    username: { type: String, required: true },     // Who did it? (e.g., "Staff_Ali" or "Admin")
    action: { type: String, required: true },       // What did they do? (e.g., "Payment Updated")
    details: { type: String, required: true },      // Extra info (e.g., "Added ₹500 to Customer X")
    createdAt: { type: Date, default: Date.now }    // Crucial: Must be 'createdAt' for Bulk Delete to work
});

activityLogSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);