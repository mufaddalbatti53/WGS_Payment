const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String }, // Used as Primary Calling Number
    whatsappNumber: { type: String },
    otherNumbers: { type: String },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    nextActionDate: { type: Date }
});

module.exports = mongoose.model('Customer', customerSchema);