const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PlanConfig = require('../models/PlanConfig');
const User = require('../models/User');
const ActivityLog = require('../models/Activity');

function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateSubscriptionQuote(config, planId, customConfig = {}, addonIds = []) {
    const plans = config.plans || [];
    const plan = plans.find(p => p.id === planId) || plans[0];
    if (!plan) {
        throw new Error('Selected subscription plan not found.');
    }

    let finalPartiesLimit = Number(plan.maxCustomersLimit) || 250;
    let finalStaffLimit = Number(plan.maxStaffLimit) || 2;
    let finalMessagesLimit = Number(plan.dailyMessageLimit) || 50;
    let finalDurationMonths = Number(plan.durationMonths) || 1;
    let planPrice = Number(plan.price) || 999;

    const featureAccess = {
        allowGoogleDriveBackup: plan.featureAccess ? Boolean(plan.featureAccess.allowGoogleDriveBackup) : true,
        allowExcelImport: plan.featureAccess ? Boolean(plan.featureAccess.allowExcelImport) : true,
        allowPdfExport: plan.featureAccess ? Boolean(plan.featureAccess.allowPdfExport) : true
    };

    if (plan.isCustom || plan.id === 'customized') {
        finalPartiesLimit = Math.max(100, Math.min(50000, parseInt(customConfig.parties) || finalPartiesLimit));
        finalStaffLimit = Math.max(1, Math.min(500, parseInt(customConfig.staff) || finalStaffLimit));
        finalMessagesLimit = Math.max(50, Math.min(25000, parseInt(customConfig.messages) || finalMessagesLimit));
        finalDurationMonths = Math.max(1, Math.min(36, parseInt(customConfig.durationMonths) || finalDurationMonths));

        const basePrice = Number(plan.basePrice) || 499;
        const rateParties = Number(plan.pricePer100Parties) || 120;
        const rateStaff = Number(plan.pricePerStaff) || 80;
        const rateMsgs = Number(plan.pricePer50Messages) || 60;

        const monthlyCustomRate =
            basePrice +
            Math.ceil(finalPartiesLimit / 100) * rateParties +
            finalStaffLimit * rateStaff +
            Math.ceil(finalMessagesLimit / 50) * rateMsgs;

        planPrice = Math.round(monthlyCustomRate * finalDurationMonths);
    }

    const selectedAddons = [];
    let addonsTotal = 0;
    const validAddonIds = Array.isArray(addonIds) ? addonIds : [];

    for (const addonId of validAddonIds) {
        const addon = (config.addons || []).find(a => a.id === addonId && a.isActive !== false);
        if (!addon) continue;
        const addonPrice = Number(addon.price) || 0;
        const addonVal = Number(addon.value) || 0;
        addonsTotal += addonPrice;
        selectedAddons.push({
            id: addon.id,
            name: addon.name,
            type: addon.type,
            value: addonVal,
            price: addonPrice
        });

        if (addon.type === 'parties') finalPartiesLimit += addonVal;
        else if (addon.type === 'staff') finalStaffLimit += addonVal;
        else if (addon.type === 'messages') finalMessagesLimit += addonVal;
        else if (addon.type === 'duration') finalDurationMonths += addonVal;
        else if (addon.type === 'gdrive') featureAccess.allowGoogleDriveBackup = true;
    }

    const totalAmount = Math.max(1, Math.round(planPrice + addonsTotal));

    return {
        planId: plan.id,
        planName: plan.name,
        planPrice,
        addonsTotal,
        totalAmount,
        finalPartiesLimit,
        finalStaffLimit,
        finalMessagesLimit,
        finalDurationMonths,
        selectedAddons,
        featureAccess
    };
}

// GET /api/subscriptions/config (Public for Landing Page)
router.get('/config', async (req, res) => {
    try {
        const config = await PlanConfig.getOrCreateSingleton();
        const keyId = (config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();

        res.json({
            success: true,
            currency: config.currency || 'INR',
            whatsappSalesNumber: config.whatsappSalesNumber || '917021056404',
            razorpayKeyId: keyId,
            isRazorpayConfigured: Boolean(keyId && keySecret),
            plans: (config.plans || []).filter(p => p.isActive !== false),
            addons: (config.addons || []).filter(a => a.isActive !== false)
        });
    } catch (err) {
        console.error('Error loading subscription config:', err);
        res.status(500).json({ success: false, message: 'Failed to load subscription plans.' });
    }
});

// POST /api/subscriptions/create-order
router.post('/create-order', async (req, res) => {
    try {
        const { planId, customConfig, addonIds, registrationData } = req.body;
        if (!registrationData || !registrationData.username || !registrationData.password) {
            return res.status(400).json({ success: false, message: 'Please enter a username and password for your Admin account.' });
        }

        const cleanUsername = registrationData.username.toString().trim();
        if (cleanUsername.length < 3) {
            return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
        }
        if (registrationData.password.toString().length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }

        // Check if username exists; if it exists, verify password (allowing existing admin to upgrade/renew)
        const existingUser = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).select('+password');

        if (existingUser) {
            if (existingUser.role !== 'admin') {
                return res.status(400).json({ success: false, message: 'This username is reserved. Please choose another Admin username.' });
            }
            const isMatch = await bcrypt.compare(registrationData.password, existingUser.password);
            if (!isMatch) {
                return res.status(400).json({
                    success: false,
                    message: 'Username already exists. Choose a different username, or enter your current password to renew/upgrade your existing account.'
                });
            }
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const quote = calculateSubscriptionQuote(config, planId, customConfig, addonIds);

        const keyId = (config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();

        if (!keyId || !keySecret) {
            return res.status(400).json({
                success: false,
                code: 'RAZORPAY_NOT_CONFIGURED',
                message: 'Razorpay API Key ID & Secret have not been configured in Super Admin settings yet. You can submit an access request or ask Super Admin to add the Razorpay keys.',
                quote
            });
        }

        const amountInPaise = Math.round(quote.totalAmount * 100);
        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authHeader}`
            },
            body: JSON.stringify({
                amount: amountInPaise,
                currency: config.currency || 'INR',
                receipt: `wgs_${Date.now()}`,
                notes: {
                    username: cleanUsername,
                    companyName: (registrationData.companyName || '').toString().trim(),
                    planId: quote.planId,
                    planName: quote.planName
                }
            })
        });

        const rzpData = await rzpRes.json();
        if (!rzpRes.ok || !rzpData.id) {
            console.error('Razorpay order error:', rzpData);
            return res.status(400).json({
                success: false,
                message: (rzpData.error && rzpData.error.description) || 'Failed to create Razorpay order. Please check Razorpay API credentials.'
            });
        }

        res.json({
            success: true,
            orderId: rzpData.id,
            amount: rzpData.amount,
            currency: rzpData.currency,
            keyId,
            quote
        });
    } catch (err) {
        console.error('Error creating subscription order:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error creating order.' });
    }
});

// POST /api/subscriptions/verify-payment
router.post('/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            planId,
            customConfig,
            addonIds,
            registrationData
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Missing payment verification details.' });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (!keySecret) {
            return res.status(400).json({ success: false, message: 'Razorpay secret not configured.' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Payment signature verification failed.' });
        }

        const quote = calculateSubscriptionQuote(config, planId, customConfig, addonIds);
        const cleanUsername = (registrationData.username || '').toString().trim();
        const cleanCompany = (registrationData.companyName || '').toString().trim();
        const cleanEmail = (registrationData.email || '').toString().trim().toLowerCase();
        const cleanPhone = (registrationData.contactNo || '').toString().trim();

        const now = new Date();
        let user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).select('+password');

        // Calculate new expiry date
        let baseDate = now;
        if (user && user.planExpiryDate && new Date(user.planExpiryDate) > now) {
            baseDate = new Date(user.planExpiryDate);
        }
        const expiryDate = new Date(baseDate);
        expiryDate.setMonth(expiryDate.getMonth() + quote.finalDurationMonths);

        if (!user) {
            const hashedPassword = await bcrypt.hash(registrationData.password, 12);
            user = await User.create({
                username: cleanUsername,
                password: hashedPassword,
                role: 'admin',
                status: 'approved',
                requestedAt: now,
                approvedAt: now,
                companyName: cleanCompany || cleanUsername,
                email: cleanEmail,
                companyEmail: cleanEmail,
                phone: cleanPhone,
                contactNo: cleanPhone,
                maxCustomersLimit: quote.finalPartiesLimit,
                maxStaffLimit: quote.finalStaffLimit,
                dailyMessageLimit: quote.finalMessagesLimit,
                planDurationMonths: quote.finalDurationMonths,
                planExpiryDate: expiryDate,
                planId: quote.planId,
                planName: quote.planName,
                activeAddons: quote.selectedAddons,
                featureAccess: quote.featureAccess,
                lastPaymentId: razorpay_payment_id,
                lastOrderId: razorpay_order_id,
                lastAmountPaid: quote.totalAmount
            });
        } else {
            user.status = 'approved';
            if (!user.approvedAt) user.approvedAt = now;
            if (cleanCompany) user.companyName = cleanCompany;
            if (cleanEmail) {
                user.email = cleanEmail;
                if (!user.companyEmail) user.companyEmail = cleanEmail;
            }
            if (cleanPhone) {
                user.phone = cleanPhone;
                if (!user.contactNo) user.contactNo = cleanPhone;
            }
            user.maxCustomersLimit = quote.finalPartiesLimit;
            user.maxStaffLimit = quote.finalStaffLimit;
            user.dailyMessageLimit = quote.finalMessagesLimit;
            user.planDurationMonths = quote.finalDurationMonths;
            user.planExpiryDate = expiryDate;
            user.planId = quote.planId;
            user.planName = quote.planName;
            user.activeAddons = quote.selectedAddons;
            user.featureAccess = quote.featureAccess;
            user.lastPaymentId = razorpay_payment_id;
            user.lastOrderId = razorpay_order_id;
            user.lastAmountPaid = quote.totalAmount;
            await user.save();
        }

        await ActivityLog.create({
            adminId: user._id,
            actorName: user.username,
            actorRole: 'admin',
            actionType: 'Subscription Activated',
            details: `Purchased ${quote.planName} (₹${quote.totalAmount}, PayID: ${razorpay_payment_id}) — Limits: ${quote.finalPartiesLimit} Parties, ${quote.finalStaffLimit} Staff, ${quote.finalMessagesLimit} Msgs/day.`
        });

        // Automatically log the Admin in
        if (req.session) {
            req.session.userId = user._id;
            req.session.adminId = user._id;
            req.session.role = 'admin';
            req.session.username = user.username;
            await new Promise(resolve => req.session.save(resolve));
        }

        res.json({
            success: true,
            message: 'Payment verified and Admin account activated!',
            redirect: 'dashboard.html?from=login',
            user: {
                username: user.username,
                role: user.role,
                companyName: user.companyName,
                planName: user.planName
            }
        });
    } catch (err) {
        console.error('Error verifying subscription payment:', err);
        res.status(500).json({ success: false, message: 'Server error verifying payment: ' + err.message });
    }
});

// POST /api/subscriptions/submit-request (Fallback when Razorpay keys are not configured or user requests manual approval)
router.post('/submit-request', async (req, res) => {
    try {
        const { planId, customConfig, addonIds, registrationData } = req.body;
        if (!registrationData || !registrationData.username || !registrationData.password) {
            return res.status(400).json({ success: false, message: 'Please enter a username and password for your Admin account.' });
        }

        const cleanUsername = registrationData.username.toString().trim();
        if (cleanUsername.length < 3) {
            return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
        }
        if (registrationData.password.toString().length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }

        const existingUser = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists. Please choose a different username or sign in.'
            });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const quote = calculateSubscriptionQuote(config, planId, customConfig, addonIds);

        const cleanCompany = (registrationData.companyName || '').toString().trim();
        const cleanEmail = (registrationData.email || '').toString().trim().toLowerCase();
        const cleanPhone = (registrationData.contactNo || '').toString().trim();
        const hashedPassword = await bcrypt.hash(registrationData.password, 12);

        const user = await User.create({
            username: cleanUsername,
            password: hashedPassword,
            role: 'admin',
            status: 'pending',
            requestedAt: new Date(),
            companyName: cleanCompany || cleanUsername,
            email: cleanEmail,
            companyEmail: cleanEmail,
            phone: cleanPhone,
            contactNo: cleanPhone,
            maxCustomersLimit: quote.finalPartiesLimit,
            maxStaffLimit: quote.finalStaffLimit,
            dailyMessageLimit: quote.finalMessagesLimit,
            planDurationMonths: quote.finalDurationMonths,
            planId: quote.planId,
            planName: quote.planName,
            activeAddons: quote.selectedAddons,
            featureAccess: quote.featureAccess,
            lastAmountPaid: quote.totalAmount
        });

        await ActivityLog.create({
            adminId: user._id,
            actorName: user.username,
            actorRole: 'admin',
            actionType: 'Plan Request Submitted',
            details: `Requested ${quote.planName} (Quoted: ₹${quote.totalAmount}) — Limits: ${quote.finalPartiesLimit} Parties, ${quote.finalStaffLimit} Staff, ${quote.finalMessagesLimit} Msgs/day.`
        });

        res.json({
            success: true,
            message: `Your ${quote.planName} subscription request (₹${quote.totalAmount.toLocaleString('en-IN')}) has been submitted! Super Admin will review and activate your account shortly.`
        });
    } catch (err) {
        console.error('Error submitting subscription request:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error submitting request.' });
    }
});

module.exports = router;
