const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff'], required: true },
    adminId: { type: String },
    securityQuestion: { type: String },
    securityAnswer: { type: String },

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
    // 🏦 Bank & UPI Details (Optional)
    bankName: { type: String },
    accountName: { type: String },
    accountNumber: { type: String },
    ifscCode: { type: String },
    upiDetails: { type: String }
});

module.exports = mongoose.model('User', userSchema);