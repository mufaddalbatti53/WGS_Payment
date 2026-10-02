const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff', 'superadmin', 'customer'], default: 'admin', required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    securityQuestion: { type: String },
    securityAnswer: { type: String },

    // Registration & Approval status
    email: { 
        type: String, 
        trim: true,
        match: [/^(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/, 'Please enter a valid email address']
    },
    phone: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date },

    // Profile Info
    companyName: { type: String, trim: true },
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    addressLine3: { type: String, trim: true },
    dlNo: { type: String, trim: true },
    msmeNo: { type: String, trim: true },
    contactNo: { type: String, trim: true },
    companyEmail: { 
        type: String, 
        trim: true,
        match: [/^(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/, 'Please enter a valid email address']
    },
    
    // ☁️ Google Drive Integration
    googleDriveToken: { type: mongoose.Schema.Types.Mixed, select: false },
    googleEmail: { type: String, trim: true },
    autoBackupInterval: { type: Number, default: 0 },
    lastAutoBackupDate: { type: Date },

    // 🏦 Bank & UPI Details
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
    upiDetails: { type: String, trim: true },

    // ⚙️ Super Admin Quotas & Limits
    maxStaffLimit: { type: Number, default: 5 },
    maxCustomersLimit: { type: Number, default: 500 },
    dailyMessageLimit: { type: Number, default: 100 },
    dailyMessageCount: { type: Number, default: 0 },
    lastMessageResetDate: { type: Date, default: Date.now },
    planExpiryDate: { type: Date, default: null }
}, { timestamps: true });

// Dedicated Single & Compound Indexes for ultra-fast query performance
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ adminId: 1 });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ role: 1, adminId: 1 });

module.exports = mongoose.model('User', userSchema);