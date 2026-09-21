const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    adminId: { type: String, required: true },
    companyName: { type: String, required: true },
    contactPerson: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    whatsappNumber: { type: String, default: '' },
    otherNumbers: { type: String, default: '' },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    lastPaymentDate: { type: Date, default: null },
    nextActionDate: { type: Date, default: null },

    // Tracks when aging buckets were last shifted (for daily auto-aging)
    agingLastShifted: { type: Date, default: null },

    // Aging Buckets (from Tally/Busy Export)
    aging: {
        under30: { type: Number, default: 0 },
        days30to60: { type: Number, default: 0 },
        days60to90: { type: Number, default: 0 },
        days90to120: { type: Number, default: 0 },
        days120to150: { type: Number, default: 0 },
        days150to180: { type: Number, default: 0 },
        above180: { type: Number, default: 0 },
        onAccount: { type: Number, default: 0 }
    }
});

customerSchema.index({ adminId: 1, phone: 1 });
customerSchema.index({ adminId: 1, companyName: 1 });

module.exports = mongoose.model('Customer', customerSchema);
