const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    companyName: { type: String, required: true, trim: true },
    contactPerson: { type: String, default: '', trim: true },
    email: { 
        type: String, 
        default: '', 
        trim: true,
        match: [/^(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/, 'Please enter a valid email address'] 
    },
    phone: { type: String, default: '', trim: true },
    whatsappNumber: { type: String, default: '', trim: true },
    otherNumbers: { type: String, default: '', trim: true },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    lastPaymentDate: { type: Date, default: null },
    nextActionDate: { type: Date, default: null },

    // Tracks when aging buckets were last shifted (for daily auto-aging)
    agingLastShifted: { type: Date, default: null },

    // Aging Buckets (Structured schema validation - not Mixed)
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

// Indexes for high performance
customerSchema.index({ adminId: 1 });
customerSchema.index({ phone: 1 });
customerSchema.index({ companyName: 1 });
customerSchema.index({ adminId: 1, phone: 1 });
customerSchema.index({ adminId: 1, companyName: 1 });
customerSchema.index({ nextActionDate: 1 });

module.exports = mongoose.model('Customer', customerSchema);
