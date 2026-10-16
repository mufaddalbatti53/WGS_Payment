const mongoose = require('mongoose');

const processedPaymentSchema = new mongoose.Schema({
    paymentId: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    },
    orderId: { 
        type: String, 
        required: true, 
        trim: true 
    },
    signature: { 
        type: String, 
        trim: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    amountPaise: { 
        type: Number 
    },
    currency: { 
        type: String, 
        default: 'INR',
        trim: true 
    },
    status: { 
        type: String, 
        default: 'captured',
        trim: true 
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    username: { 
        type: String, 
        required: true, 
        trim: true,
        index: true 
    },
    email: { 
        type: String, 
        trim: true 
    },
    phone: { 
        type: String, 
        trim: true 
    },
    companyName: { 
        type: String, 
        trim: true 
    },
    planId: { 
        type: String, 
        trim: true 
    },
    planName: { 
        type: String, 
        trim: true 
    },
    type: { 
        type: String, 
        enum: ['purchase', 'renewal', 'addon'], 
        default: 'purchase' 
    },
    renewalMode: { 
        type: String, 
        trim: true 
    },
    durationMonths: { 
        type: Number 
    },
    addonIds: [{ 
        type: String, 
        trim: true 
    }],
    rawRazorpayResponse: { 
        type: mongoose.Schema.Types.Mixed 
    },
    processedAt: { 
        type: Date, 
        default: Date.now,
        index: true 
    }
}, { timestamps: true });

// Compound and single indexes for query and lookup efficiency
processedPaymentSchema.index({ orderId: 1 });
processedPaymentSchema.index({ userId: 1, createdAt: -1 });
processedPaymentSchema.index({ username: 1, createdAt: -1 });

module.exports = mongoose.model('ProcessedPayment', processedPaymentSchema);
