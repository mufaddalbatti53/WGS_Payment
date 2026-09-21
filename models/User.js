const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff', 'superadmin'], required: true },
    adminId: { type: String },
    securityQuestion: { type: String },
    securityAnswer: { type: String },

    // Registration & Approval status
    email: { type: String },
    phone: { type: String },
    plainPassword: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], default: 'approved' },
    requestedAt: { type: Date },
    approvedAt: { type: Date },

    // Profile Info
    companyName: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    addressLine3: { type: String },
    dlNo: { type: String },
    msmeNo: { type: String },
    contactNo: { type: String },
    companyEmail: { type: String },
    // ☁️ Add this line right here!
    googleDriveToken: { type: Object },
    googleEmail: { type: String },
    autoBackupInterval: { type: Number, default: 0 }, // 0 means disabled
    lastAutoBackupDate: { type: Date },

    // 🏦 Bank & UPI Details (Optional)
    bankName: { type: String },
    accountName: { type: String },
    accountNumber: { type: String },
    ifscCode: { type: String },
    upiDetails: { type: String },

    // ⚙️ Super Admin Quotas & Limits
    maxStaffLimit: { type: Number, default: 5 },           // Default 5 staff per admin (0 = unlimited)
    maxCustomersLimit: { type: Number, default: 500 },      // Default 500 parties per admin (0 = unlimited)
    dailyMessageLimit: { type: Number, default: 100 },      // Default 100 reminders per day (0 = unlimited)
    dailyMessageCount: { type: Number, default: 0 },        // Messages sent today
    lastMessageResetDate: { type: Date, default: Date.now }, // Daily counter reset timestamp
    planExpiryDate: { type: Date, default: null }           // Optional subscription expiry
});

userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);