const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, required: true },
    adminId: { type: String },
    securityQuestion: { type: String },
    securityAnswer: { type: String },

    // 🏢 NEW: Company Profile Fields (Required for saving the form!)
    companyName: { type: String, default: '' },
    addressLine1: { type: String, default: '' },
    addressLine2: { type: String, default: '' },
    addressLine3: { type: String, default: '' },
    dlNo: { type: String, default: '' },
    msmeNo: { type: String, default: '' },
    contactNo: { type: String, default: '' },
    companyEmail: { type: String, default: '' }
});

module.exports = mongoose.model('User', userSchema);