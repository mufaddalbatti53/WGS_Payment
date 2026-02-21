const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    companyName: String,
    contactPerson: String,
    phone: String,           // Primary Calling Number
    otherNumbers: String,    // NEW: Extra numbers (Comma separated)
    whatsapp: String,        // Primary WhatsApp
    email: String,

    totalAmount: Number,
    paidAmount: { type: Number, default: 0 },

    nextReminderDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Customer', customerSchema);