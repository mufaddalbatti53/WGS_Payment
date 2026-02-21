const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff'], default: 'staff' },

    // NEW: Security Question for Password Recovery
    securityQuestion: String, // e.g., "What is your pet's name?"
    securityAnswer: String    // e.g., "Tiger" (We will hash this too!)
});

module.exports = mongoose.model('User', userSchema);