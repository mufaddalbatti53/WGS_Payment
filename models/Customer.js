const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Add this line!
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