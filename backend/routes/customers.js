const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const User = require('../models/User');
const { requireLogin, requireAdmin, logActivity } = require('../middleware/auth');

router.post('/:id/auto-snooze', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found." });
        }

        const adminUser = await User.findById(req.session.adminId);
        if (adminUser) {
            const now = new Date();
            const lastReset = adminUser.lastMessageResetDate ? new Date(adminUser.lastMessageResetDate) : new Date(0);
            if (now.toDateString() !== lastReset.toDateString()) {
                adminUser.dailyMessageCount = 0;
                adminUser.lastMessageResetDate = now;
            }

            const dailyLimit = adminUser.dailyMessageLimit ?? 100;
            if (dailyLimit > 0 && adminUser.dailyMessageCount >= dailyLimit) {
                return res.status(429).json({ success: false, message: `Daily message limit reached (${adminUser.dailyMessageCount}/${dailyLimit}).` });
            }

            adminUser.dailyMessageCount += 1;
            await adminUser.save();
        }

        const newDate = new Date();
        newDate.setDate(newDate.getDate() + 10);
        customer.nextActionDate = newDate;
        await customer.save();
        await logActivity(req, "Reminder Sent", `Sent payment reminder to ${customer.companyName || 'Party'}. Auto-snoozed for 10 days.`);

        res.json({ success: true });
    } catch (err) {
        console.error("Auto snooze error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.get('/check-duplicate', requireLogin, async (req, res) => {
    try {
        const name = (req.query.name || '').trim();
        const phone = (req.query.phone || '').trim().replace(/[^0-9]/g, '');
        if (!name && !phone) return res.json({ isDuplicate: false });

        const conditions = [];
        if (name) {
            conditions.push({ companyName: { $regex: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        }
        if (phone && phone.length >= 10) {
            conditions.push({ phone: { $regex: new RegExp(phone.slice(-10) + '$') } });
        }
        if (conditions.length === 0) return res.json({ isDuplicate: false });

        const existing = await Customer.findOne({ adminId: req.session.adminId, $or: conditions }).lean();
        if (existing) {
            return res.json({
                isDuplicate: true,
                matchedName: existing.companyName,
                matchReason: existing.companyName.toLowerCase() === name.toLowerCase() ? 'name' : 'phone'
            });
        }
        res.json({ isDuplicate: false });
    } catch (err) {
        res.json({ isDuplicate: false });
    }
});

router.post('/', requireLogin, async (req, res) => {
    if (!req.session.userId || req.session.role === 'customer') {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    try {
        const adminUser = await User.findById(req.session.adminId);
        const maxCust = adminUser ? (adminUser.maxCustomersLimit ?? 500) : 500;
        if (maxCust > 0) {
            const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
            if (currentPartyCount >= maxCust) {
                return res.status(403).json({ success: false, message: `Party limit reached (${currentPartyCount}/${maxCust}).` });
            }
        }

        const totalAmt = parseFloat(req.body.totalAmount) || 0;
        const autoDate = new Date();
        autoDate.setDate(autoDate.getDate() + 10);

        const rawPhone = (req.body.phone || req.body.localPhone || '').toString().trim();
        let phoneDigits = rawPhone.replace(/[^0-9]/g, '');
        let phoneCombined = phoneDigits;
        if (phoneDigits.length === 10) {
            phoneCombined = (req.body.countryCode || '91') + phoneDigits;
        } else if (req.body.localPhone) {
            phoneCombined = (req.body.countryCode || '91') + req.body.localPhone.toString().trim().replace(/[^0-9]/g, '');
        }

        const rawWa = (req.body.whatsappNumber || '').toString().trim();
        let waDigits = rawWa.replace(/[^0-9]/g, '');
        let waCombined = waDigits;
        if (waDigits.length === 10) {
            waCombined = (req.body.countryCode || '91') + waDigits;
        }

        const orConditions = [];
        if (req.body.companyName) {
            orConditions.push({ companyName: { $regex: new RegExp('^' + req.body.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        }
        if (phoneDigits.length >= 10) {
            orConditions.push({ phone: { $regex: new RegExp(phoneDigits.slice(-10) + '$') } });
        }

        if (orConditions.length > 0) {
            const dupCheck = await Customer.findOne({ adminId: req.session.adminId, $or: orConditions });
            if (dupCheck) {
                return res.status(409).json({ success: false, message: 'Duplicate customer found.', duplicateName: dupCheck.companyName });
            }
        }

        const customer = await Customer.create({
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email || '',
            phone: phoneCombined,
            whatsappNumber: waCombined || req.body.whatsappNumber || '',
            otherNumbers: req.body.otherNumbers || '',
            totalAmount: totalAmt,
            adminId: req.session.adminId,
            nextActionDate: autoDate,
            agingLastShifted: new Date(),
            aging: { under30: totalAmt, days30to60: 0, days60to90: 0, days90to120: 0, days120to150: 0, days150to180: 0, above180: 0, onAccount: 0 }
        });

        await logActivity(req, "Added Party", `Created new party: ${req.body.companyName || 'Unknown Party'}`);
        res.json({ success: true, customer });
    } catch (err) {
        console.error("Error adding customer:", err);
        res.status(500).json({ success: false, message: "Error adding customer." });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

        const oldDue = (Number(customer.totalAmount) || 0) - (Number(customer.paidAmount) || 0);
        customer.companyName = req.body.companyName;
        customer.contactPerson = req.body.contactPerson;
        customer.email = req.body.email;

        if (req.body.phone !== undefined) {
            const rawP = (req.body.phone || '').toString().trim();
            let pDigits = rawP.replace(/[^0-9]/g, '');
            if (pDigits.length === 10) pDigits = '91' + pDigits;
            customer.phone = pDigits || rawP;
        }

        if (req.body.whatsappNumber !== undefined) {
            const rawW = (req.body.whatsappNumber || '').toString().trim();
            let wDigits = rawW.replace(/[^0-9]/g, '');
            if (wDigits.length === 10) wDigits = '91' + wDigits;
            customer.whatsappNumber = wDigits || rawW;
        }

        customer.otherNumbers = req.body.otherNumbers;

        if (req.body.totalAmount !== undefined) customer.totalAmount = Number(req.body.totalAmount) || 0;
        if (req.body.paidAmount !== undefined) customer.paidAmount = Number(req.body.paidAmount) || 0;

        const newDue = customer.totalAmount - customer.paidAmount;
        const dueDiff = newDue - oldDue;
        if (dueDiff !== 0) {
            if (!customer.aging) {
                customer.aging = { under30: 0, days30to60: 0, days60to90: 0, days90to120: 0, days120to150: 0, days150to180: 0, above180: 0, onAccount: 0 };
            }
            customer.aging.under30 = (Number(customer.aging.under30) || 0) + dueDiff;
            if (customer.aging.under30 < 0) customer.aging.under30 = 0;
            customer.markModified('aging');
        }

        await customer.save();
        await logActivity(req, "Edited Party", `Updated profile and financials for ${customer.companyName || 'Party'}.`);
        res.json({ success: true, customer });
    } catch (err) {
        console.error("Edit Error:", err);
        res.status(500).json({ success: false, message: "Error updating customer." });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
        if (customer) await logActivity(req, "Deleted Party", `Permanently deleted party: ${customer.companyName || 'Party'}`);
        res.json({ success: true });
    } catch (err) {
        console.error("Delete customer error:", err);
        res.status(500).json({ success: false, message: "Error deleting customer." });
    }
});

router.put('/:id/transaction', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });

        let purchase = parseFloat(req.body.newPurchase) || 0;
        let payment = parseFloat(req.body.payment) || 0;

        customer.totalAmount = (Number(customer.totalAmount) || 0) + purchase;
        customer.paidAmount = (Number(customer.paidAmount) || 0) + payment;

        if (!customer.aging) customer.aging = { under30: 0, days30to60: 0, days60to90: 0, days90to120: 0, days120to150: 0, days150to180: 0, above180: 0, onAccount: 0 };

        if (purchase > 0) {
            if (customer.aging.onAccount > 0) {
                if (purchase <= customer.aging.onAccount) {
                    customer.aging.onAccount -= purchase; purchase = 0;
                } else {
                    purchase -= customer.aging.onAccount; customer.aging.onAccount = 0;
                }
            }
            customer.aging.under30 += purchase;
        }

        if (payment > 0) {
            customer.lastPaymentDate = new Date();
            let p = payment;
            if (p > 0 && customer.aging.above180 > 0) { let d = Math.min(p, customer.aging.above180); customer.aging.above180 -= d; p -= d; }
            if (p > 0 && customer.aging.days150to180 > 0) { let d = Math.min(p, customer.aging.days150to180); customer.aging.days150to180 -= d; p -= d; }
            if (p > 0 && customer.aging.days120to150 > 0) { let d = Math.min(p, customer.aging.days120to150); customer.aging.days120to150 -= d; p -= d; }
            if (p > 0 && customer.aging.days90to120 > 0) { let d = Math.min(p, customer.aging.days90to120); customer.aging.days90to120 -= d; p -= d; }
            if (p > 0 && customer.aging.days60to90 > 0) { let d = Math.min(p, customer.aging.days60to90); customer.aging.days60to90 -= d; p -= d; }
            if (p > 0 && customer.aging.days30to60 > 0) { let d = Math.min(p, customer.aging.days30to60); customer.aging.days30to60 -= d; p -= d; }
            if (p > 0 && customer.aging.under30 > 0) { let d = Math.min(p, customer.aging.under30); customer.aging.under30 -= d; p -= d; }
            if (p > 0) { customer.aging.onAccount += p; }
        }

        customer.markModified('aging');
        await customer.save();

        let details = "";
        if (req.body.newPurchase > 0) details += `Bought goods worth Rs ${req.body.newPurchase}. `;
        if (req.body.payment > 0) details += `Paid Rs ${req.body.payment}.`;
        if (details !== "") await logActivity(req, "Payment Updated", `Updated ${customer.companyName || 'Party'}. ${details}`);

        res.json({ success: true, customer });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error updating balance." });
    }
});

router.put('/:id/update-reminder', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });
        if (req.body.nextDate) {
            customer.nextActionDate = new Date(req.body.nextDate);
            await customer.save();
            await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName || 'Party'} set to ${req.body.nextDate}`);
        }
        res.json({ success: true, customer });
    } catch (err) {
        console.error("Update reminder error:", err);
        res.status(500).json({ success: false, message: "Error updating reminder." });
    }
});

router.post('/bulk', requireAdmin, async (req, res) => {
    const { action, customerIds } = req.body;
    let ids = [];
    if (Array.isArray(customerIds)) ids = customerIds;
    else if (customerIds) ids = [customerIds];

    try {
        if (action === 'delete-all') {
            const result = await Customer.deleteMany({ adminId: req.session.adminId });
            await logActivity(req, "Bulk Delete", `Deleted ALL ${result.deletedCount} parties.`);
        } else if (action === 'delete' && ids.length > 0) {
            let totalDeleted = 0;
            const chunkSize = 500;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                const result = await Customer.deleteMany({ _id: { $in: chunk }, adminId: req.session.adminId });
                totalDeleted += result.deletedCount;
            }
            await logActivity(req, "Bulk Delete", `Permanently deleted ${totalDeleted} parties at once.`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
