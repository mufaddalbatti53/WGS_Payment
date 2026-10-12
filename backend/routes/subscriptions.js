const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PlanConfig = require('../models/PlanConfig');
const User = require('../models/User');
const ActivityLog = require('../models/Activity');
const { createAuthToken, saveSessionAsync, invalidateAuthCache } = require('../middleware/auth');
const {
    syncStaffQuotaForAdmin,
    notifyPlanPurchased,
    notifyPlanRenewedOrAddon,
    notifyRegistrationOrRequest
} = require('../utils/emailService');

function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateSubscriptionQuote(config, planId, customConfig = {}, addonIds = [], fallbackUserAddons = []) {
    const plans = config.plans || [];
    const targetKey = String(planId || 'basic').trim().toLowerCase();
    let plan = plans.find(p => String(p.id).toLowerCase() === targetKey || String(p.name).toLowerCase() === targetKey);
    if (!plan) {
        if (/custom/i.test(targetKey)) plan = plans.find(p => p.isCustom || p.id === 'customized');
        else if (/\bpro\b/i.test(targetKey)) plan = plans.find(p => p.id === 'pro');
        else if (/basic/i.test(targetKey)) plan = plans.find(p => p.id === 'basic');
    }
    if (!plan) plan = plans[0];
    if (!plan) {
        throw new Error('Selected subscription plan not found.');
    }

    let finalPartiesLimit = Number(plan.maxCustomersLimit) || 250;
    let finalStaffLimit = Number(plan.maxStaffLimit) || 2;
    let finalMessagesLimit = Number(plan.dailyMessageLimit) || 50;
    let finalDurationMonths = Number(plan.durationMonths) || 12;
    let planPrice = Number(plan.price) || 4999;

    const featureAccess = {
        allowGoogleDriveBackup: plan.featureAccess ? Boolean(plan.featureAccess.allowGoogleDriveBackup) : true,
        allowExcelImport: plan.featureAccess ? Boolean(plan.featureAccess.allowExcelImport) : true,
        allowPdfExport: plan.featureAccess ? Boolean(plan.featureAccess.allowPdfExport) : true
    };

    if (plan.isCustom || plan.id === 'customized') {
        finalPartiesLimit = Math.max(100, Math.min(50000, parseInt(customConfig.parties) || finalPartiesLimit));
        finalStaffLimit = Math.max(1, Math.min(500, parseInt(customConfig.staff) || finalStaffLimit));
        finalMessagesLimit = Math.max(50, Math.min(25000, parseInt(customConfig.messages) || finalMessagesLimit));
        finalDurationMonths = Math.max(12, Math.min(60, parseInt(customConfig.durationMonths) || finalDurationMonths));

        const basePrice = Number(plan.basePrice) || 2999;
        const rateParties = Number(plan.pricePer100Parties) || 500;
        const rateStaff = Number(plan.pricePerStaff) || 400;
        const rateMsgs = Number(plan.pricePer50Messages) || 300;

        const yearlyCustomRate =
            basePrice +
            Math.ceil(finalPartiesLimit / 100) * rateParties +
            finalStaffLimit * rateStaff +
            Math.ceil(finalMessagesLimit / 50) * rateMsgs;

        planPrice = Math.round(yearlyCustomRate * (finalDurationMonths / 12));
    }

    const selectedAddons = [];
    let addonsTotal = 0;
    const validAddonIds = Array.isArray(addonIds) ? addonIds : [];
    const fallbackList = Array.isArray(fallbackUserAddons) ? fallbackUserAddons : [];

    for (const addonId of validAddonIds) {
        let addon = (config.addons || []).find(a => a.id === addonId && a.isActive !== false);
        if (!addon) {
            addon = fallbackList.find(a => a && (a.id === addonId || a.name === addonId));
        }
        if (!addon) continue;
        const addonPrice = Number(addon.price) || 0;
        const addonVal = Number(addon.value) || 0;
        const addonName = addon.name || addon.title || addon.id;
        addonsTotal += addonPrice;
        selectedAddons.push({
            id: addon.id,
            name: addonName,
            title: addonName,
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
        baseAmount: planPrice,
        addonsTotal,
        addonsAmount: addonsTotal,
        totalAmount,
        finalPartiesLimit,
        finalStaffLimit,
        finalMessagesLimit,
        finalDurationMonths,
        limits: {
            partyLimit: finalPartiesLimit,
            staffLimit: finalStaffLimit,
            dailyMessageLimit: finalMessagesLimit,
            durationMonths: finalDurationMonths
        },
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
            return res.status(400).json({ success: false, message: 'Missing payment verification details.', error: 'Missing payment verification details.' });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (!keySecret) {
            return res.status(400).json({ success: false, message: 'Razorpay secret not configured.', error: 'Razorpay secret not configured.' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Payment signature verification failed.', error: 'Payment signature verification failed.' });
        }

        const quote = calculateSubscriptionQuote(config, planId, customConfig, addonIds);
        const reg = registrationData || {};
        const cleanUsername = (reg.username || '').toString().trim();
        const cleanCompany = (reg.companyName || '').toString().trim();
        const cleanEmail = (reg.email || '').toString().trim().toLowerCase();
        const cleanPhone = (reg.contactNo || '').toString().trim();

        const now = new Date();
        let user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).select('+password');

        if (user) {
            if (user.role !== 'admin') {
                return res.status(400).json({ success: false, message: 'Cannot apply subscription to a non-admin account.', error: 'Cannot apply subscription to a non-admin account.' });
            }
            const isSameLoggedInSession = req.session && String(req.session.userId) === String(user._id);
            if (!isSameLoggedInSession && reg.password) {
                const isMatch = await bcrypt.compare(reg.password, user.password);
                if (!isMatch) {
                    return res.status(400).json({
                        success: false,
                        message: 'Existing username password mismatch.',
                        error: 'Existing username password mismatch.'
                    });
                }
            }
        }

        // Calculate new expiry date
        let baseDate = now;
        if (user && user.planExpiryDate && new Date(user.planExpiryDate) > now) {
            baseDate = new Date(user.planExpiryDate);
        }
        const expiryDate = new Date(baseDate);
        expiryDate.setMonth(expiryDate.getMonth() + quote.finalDurationMonths);

        if (!user) {
            const hashedPassword = await bcrypt.hash(reg.password, 10);
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
            user.lastPreExpiryEmailSentAt = null;
            user.lastPreExpiryDaysNotified = null;
            user.lastPostExpiryEmailSentAt = null;
            await user.save();

            // Re-activate staff accounts under this Admin
            await User.updateMany({ role: 'staff', adminId: user._id }, { status: 'approved' });
        }

        invalidateAuthCache(user._id);

        const staffQuotaStatus = await syncStaffQuotaForAdmin(
            user._id,
            quote.finalStaffLimit,
            Array.isArray(req.body.selectedStaffIds) ? req.body.selectedStaffIds : null
        );

        await ActivityLog.create({
            adminId: String(user._id),
            userId: String(user._id),
            username: user.username,
            action: 'Subscription Activated',
            details: `Purchased ${quote.planName} (₹${quote.totalAmount}, PayID: ${razorpay_payment_id}) — Limits: ${quote.finalPartiesLimit} Parties, ${quote.finalStaffLimit} Staff, ${quote.finalMessagesLimit} Msgs/day.`
        }).catch(() => {});

        notifyPlanPurchased(user, quote, razorpay_payment_id, staffQuotaStatus).catch(() => {});

        // Automatically log the Admin in
        let token = '';
        if (req.session) {
            req.session.userId = user._id;
            req.session.adminId = user._id;
            req.session.role = 'admin';
            req.session.username = user.username;
            await saveSessionAsync(req);
            token = createAuthToken(req.session);
            res.setHeader('X-Auth-Token', token);
        }

        res.json({
            success: true,
            token,
            message: 'Payment verified and Admin account activated!',
            redirect: 'dashboard.html?from=login',
            staffQuotaStatus,
            user: {
                username: user.username,
                role: user.role,
                companyName: user.companyName,
                planName: user.planName
            }
        });
    } catch (err) {
        console.error('Error verifying subscription payment:', err);
        res.status(500).json({ success: false, message: 'Server error verifying payment: ' + err.message, error: 'Server error verifying payment: ' + err.message });
    }
});

// POST /api/subscriptions/submit-request (Fallback when Razorpay keys are not configured or user requests manual approval)
router.post('/submit-request', async (req, res) => {
    try {
        const { planId, customConfig, addonIds, registrationData } = req.body;
        if (!registrationData || !registrationData.username || !registrationData.password) {
            return res.status(400).json({ success: false, message: 'Please enter a username and password for your Admin account.', error: 'Please enter a username and password for your Admin account.' });
        }

        const cleanUsername = registrationData.username.toString().trim();
        if (cleanUsername.length < 3) {
            return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.', error: 'Username must be at least 3 characters.' });
        }
        if (registrationData.password.toString().length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.', error: 'Password must be at least 6 characters.' });
        }

        const existingUser = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).lean();

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists. Please choose a different username or sign in.',
                error: 'Username already exists. Please choose a different username or sign in.'
            });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const quote = calculateSubscriptionQuote(config, planId, customConfig, addonIds);

        const cleanCompany = (registrationData.companyName || '').toString().trim();
        const cleanEmail = (registrationData.email || '').toString().trim().toLowerCase();
        const cleanPhone = (registrationData.contactNo || '').toString().trim();
        const hashedPassword = await bcrypt.hash(registrationData.password, 10);

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
            adminId: String(user._id),
            userId: String(user._id),
            username: user.username,
            action: 'Plan Request Submitted',
            details: `Requested ${quote.planName} (Quoted: ₹${quote.totalAmount}) — Limits: ${quote.finalPartiesLimit} Parties, ${quote.finalStaffLimit} Staff, ${quote.finalMessagesLimit} Msgs/day.`
        }).catch(() => {});

        notifyRegistrationOrRequest(user, quote).catch(() => {});

        res.json({
            success: true,
            message: `Your ${quote.planName} subscription request (₹${quote.totalAmount.toLocaleString('en-IN')}) has been submitted! Super Admin will review and activate your account shortly.`
        });
    } catch (err) {
        console.error('Error submitting subscription request:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error submitting request.', error: err.message || 'Server error submitting request.' });
    }
});

// Helper to resolve current Admin user for Dashboard Renewal
async function resolveRenewalAdminUser(req) {
    const adminId = req.session && (req.session.adminId || req.session.userId);
    if (!adminId) return null;
    const user = await User.findById(adminId);
    if (!user || user.role !== 'admin') return null;
    return user;
}

// Helper to calculate quote when purchasing standalone Add-ons from the Dashboard
function calculateAddonsOnlyQuote(user, config, addonIds = []) {
    const validAddonIds = Array.isArray(addonIds) ? addonIds : [];
    const selectedAddons = [];
    let addonsTotal = 0;

    let finalPartiesLimit = Number(user.maxCustomersLimit) || 250;
    let finalStaffLimit = Number(user.maxStaffLimit) || 2;
    let finalMessagesLimit = Number(user.dailyMessageLimit) || 50;
    let addedDurationMonths = 0;

    const featureAccess = {
        allowGoogleDriveBackup: user.featureAccess?.allowGoogleDriveBackup !== undefined ? Boolean(user.featureAccess.allowGoogleDriveBackup) : true,
        allowExcelImport: user.featureAccess?.allowExcelImport !== undefined ? Boolean(user.featureAccess.allowExcelImport) : true,
        allowPdfExport: user.featureAccess?.allowPdfExport !== undefined ? Boolean(user.featureAccess.allowPdfExport) : true
    };

    for (const addonId of validAddonIds) {
        const addon = (config.addons || []).find(a => a.id === addonId && a.isActive !== false);
        if (!addon) continue;
        const addonPrice = Number(addon.price) || 0;
        const addonVal = Number(addon.value) || 0;
        const addonName = addon.name || addon.title || addon.id;
        addonsTotal += addonPrice;
        selectedAddons.push({
            id: addon.id,
            name: addonName,
            title: addonName,
            type: addon.type,
            value: addonVal,
            price: addonPrice
        });

        if (addon.type === 'parties') finalPartiesLimit += addonVal;
        else if (addon.type === 'staff') finalStaffLimit += addonVal;
        else if (addon.type === 'messages') finalMessagesLimit += addonVal;
        else if (addon.type === 'duration') addedDurationMonths += addonVal;
        else if (addon.type === 'gdrive') featureAccess.allowGoogleDriveBackup = true;
    }

    if (!selectedAddons.length) {
        throw new Error('Please select at least one Add-on to purchase.');
    }

    const totalAmount = Math.max(1, Math.round(addonsTotal));
    return {
        planId: user.planId || 'basic',
        planName: user.planName || 'Basic Plan',
        planPrice: 0,
        baseAmount: 0,
        addonsTotal: totalAmount,
        addonsAmount: totalAmount,
        totalAmount,
        finalPartiesLimit,
        finalStaffLimit,
        finalMessagesLimit,
        finalDurationMonths: addedDurationMonths,
        limits: {
            partyLimit: finalPartiesLimit,
            staffLimit: finalStaffLimit,
            dailyMessageLimit: finalMessagesLimit,
            durationMonths: addedDurationMonths || (user.planDurationMonths || 12)
        },
        selectedAddons,
        featureAccess
    };
}

// Helper to build customConfig & addonIds for an Admin's renewal mode ('with_addons', 'without_addons', or 'addons_only')
function resolveAdminRenewalParams(user, config, body = {}) {
    const rawMode = body.renewalMode || body.renewMode || 'with_addons';
    const renewalMode = rawMode === 'without_addons' ? 'without_addons' : (rawMode === 'addons_only' ? 'addons_only' : 'with_addons');
    let planId = body.planId || user.planId || '';

    // If SuperAdmin changed user.planName, ensure planId matches user.planName
    if (!body.planId && user.planName) {
        const pn = String(user.planName).trim();
        const matchedPlan = (config.plans || []).find(
            p => String(p.id).toLowerCase() === pn.toLowerCase() || String(p.name).toLowerCase() === pn.toLowerCase()
        );
        if (matchedPlan) {
            planId = matchedPlan.id;
        } else if (/custom/i.test(pn)) {
            planId = 'customized';
        } else if (/\bpro\b/i.test(pn)) {
            planId = 'pro';
        } else if (/basic/i.test(pn)) {
            planId = 'basic';
        }
    }
    if (!planId) planId = 'basic';

    // Reconstruct base customConfig if the user is on a Customized plan
    const activeAddons = Array.isArray(user.activeAddons) ? user.activeAddons : [];
    const addonPartiesSum = activeAddons.filter(a => a.type === 'parties').reduce((s, a) => s + (Number(a.value) || 0), 0);
    const addonStaffSum = activeAddons.filter(a => a.type === 'staff').reduce((s, a) => s + (Number(a.value) || 0), 0);
    const addonMsgsSum = activeAddons.filter(a => a.type === 'messages').reduce((s, a) => s + (Number(a.value) || 0), 0);

    const customConfig = body.customConfig || {
        parties: Math.max(100, (Number(user.maxCustomersLimit) || 500) - addonPartiesSum),
        staff: Math.max(1, (Number(user.maxStaffLimit) || 5) - addonStaffSum),
        messages: Math.max(50, (Number(user.dailyMessageLimit) || 100) - addonMsgsSum),
        durationMonths: 12
    };

    let addonIds = [];
    if (renewalMode === 'addons_only') {
        addonIds = Array.isArray(body.addonIds) ? body.addonIds : [];
    } else if (renewalMode === 'with_addons') {
        if (Array.isArray(body.addonIds)) {
            addonIds = body.addonIds;
        } else {
            addonIds = activeAddons.map(a => a.id || a.name).filter(Boolean);
        }
    } else {
        addonIds = [];
    }

    return { renewalMode, planId, customConfig, addonIds, fallbackUserAddons: activeAddons };
}

async function handleCreateRenewalOrder(req, res) {
    try {
        const user = await resolveRenewalAdminUser(req);
        if (!user) {
            const msg = 'Please log in as an Admin to renew your subscription or purchase add-ons.';
            return res.status(401).json({ success: false, message: msg, error: msg });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const { renewalMode, planId, customConfig, addonIds, fallbackUserAddons } = resolveAdminRenewalParams(user, config, req.body);
        const quote = renewalMode === 'addons_only'
            ? calculateAddonsOnlyQuote(user, config, addonIds)
            : calculateSubscriptionQuote(config, planId, customConfig, addonIds, fallbackUserAddons);

        const keyId = (config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();

        if (!keyId || !keySecret) {
            const msg = 'Razorpay API keys have not been configured in Super Admin settings yet. Please contact Super Admin on WhatsApp to complete renewal.';
            return res.status(400).json({
                success: false,
                code: 'RAZORPAY_NOT_CONFIGURED',
                message: msg,
                error: msg,
                whatsappSalesNumber: config.whatsappSalesNumber || '917021056404',
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
                receipt: `wgs_renew_${Date.now()}`,
                notes: {
                    username: user.username,
                    companyName: user.companyName || '',
                    planId: quote.planId,
                    planName: quote.planName,
                    renewalMode,
                    addonIds: JSON.stringify(addonIds || [])
                }
            })
        });

        const rzpData = await rzpRes.json();
        if (!rzpRes.ok || !rzpData.id) {
            console.error('Razorpay renewal order error:', rzpData);
            const msg = (rzpData.error && rzpData.error.description) || 'Failed to create Razorpay renewal order.';
            return res.status(400).json({
                success: false,
                message: msg,
                error: msg
            });
        }

        const prefillData = {
            name: user.companyName || user.username,
            companyName: user.companyName || user.username,
            email: user.companyEmail || user.email || '',
            contact: user.contactNo || user.phone || '',
            phone: user.contactNo || user.phone || ''
        };

        res.json({
            success: true,
            orderId: rzpData.id,
            amount: rzpData.amount,
            currency: rzpData.currency,
            keyId,
            quote,
            renewalMode,
            prefill: prefillData,
            adminInfo: prefillData
        });
    } catch (err) {
        console.error('Error creating renewal order:', err);
        const msg = err.message || 'Server error creating renewal order.';
        res.status(500).json({ success: false, message: msg, error: msg });
    }
}

router.post('/create-renewal-order', handleCreateRenewalOrder);
router.post('/renew-order', handleCreateRenewalOrder);

async function handleVerifyRenewal(req, res) {
    try {
        const user = await resolveRenewalAdminUser(req);
        if (!user) {
            const msg = 'Please log in as an Admin to verify renewal.';
            return res.status(401).json({ success: false, message: msg, error: msg });
        }

        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            const msg = 'Missing payment verification details.';
            return res.status(400).json({ success: false, message: msg, error: msg });
        }

        const config = await PlanConfig.getOrCreateSingleton();
        const keyId = (config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
        const keySecret = (config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (!keySecret) {
            const msg = 'Razorpay secret not configured.';
            return res.status(400).json({ success: false, message: msg, error: msg });
        }

        const expectedSignature = crypto
            .createHmac('sha256', keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            const msg = 'Payment signature verification failed.';
            return res.status(400).json({ success: false, message: msg, error: msg });
        }

        // Ensure renewalMode and addonIds are accurately resolved even if the client omitted them
        const effectiveBody = { ...req.body };
        if (!effectiveBody.renewalMode && effectiveBody.renewMode) {
            effectiveBody.renewalMode = effectiveBody.renewMode;
        }
        if ((!effectiveBody.renewalMode || (effectiveBody.renewalMode === 'addons_only' && !effectiveBody.addonIds)) && keyId && keySecret) {
            try {
                const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
                const ordRes = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpay_order_id)}`, {
                    headers: { 'Authorization': `Basic ${authHeader}` }
                });
                const ordData = await ordRes.json();
                if (ordData && ordData.notes) {
                    if (ordData.notes.renewalMode) effectiveBody.renewalMode = ordData.notes.renewalMode;
                    if (ordData.notes.addonIds && !effectiveBody.addonIds) {
                        try { effectiveBody.addonIds = JSON.parse(ordData.notes.addonIds); } catch (e) {}
                    }
                }
            } catch (ordErr) {
                console.warn('Could not fetch order notes for renewalMode fallback:', ordErr.message);
            }
        }

        const { renewalMode, planId, customConfig, addonIds, fallbackUserAddons } = resolveAdminRenewalParams(user, config, effectiveBody);
        const quote = renewalMode === 'addons_only'
            ? calculateAddonsOnlyQuote(user, config, addonIds)
            : calculateSubscriptionQuote(config, planId, customConfig, addonIds, fallbackUserAddons);

        const now = new Date();
        let baseDate = now;
        const wasExpired = !user.planExpiryDate || new Date(user.planExpiryDate) <= now;
        if (user.planExpiryDate && new Date(user.planExpiryDate) > now) {
            baseDate = new Date(user.planExpiryDate);
        }

        let expiryDate = user.planExpiryDate ? new Date(user.planExpiryDate) : new Date(now);
        if (renewalMode === 'addons_only') {
            // If purchasing a duration add-on, or if the account was expired and they purchased an add-on to unlock access
            const monthsToAdd = quote.finalDurationMonths > 0 ? quote.finalDurationMonths : (wasExpired ? 12 : 0);
            if (monthsToAdd > 0) {
                expiryDate = new Date(baseDate);
                expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
            }
        } else {
            expiryDate = new Date(baseDate);
            expiryDate.setMonth(expiryDate.getMonth() + quote.finalDurationMonths);
        }

        user.status = 'approved';
        if (!user.approvedAt) user.approvedAt = now;
        user.maxCustomersLimit = quote.finalPartiesLimit;
        user.maxStaffLimit = quote.finalStaffLimit;
        user.dailyMessageLimit = quote.finalMessagesLimit;
        if (renewalMode !== 'addons_only') {
            user.planDurationMonths = quote.finalDurationMonths;
            user.planId = quote.planId;
            user.planName = quote.planName;
            user.activeAddons = renewalMode === 'without_addons' ? [] : quote.selectedAddons;
        } else {
            const existingAddons = Array.isArray(user.activeAddons) ? user.activeAddons : [];
            user.activeAddons = [...existingAddons, ...quote.selectedAddons];
        }
        user.planExpiryDate = expiryDate;
        user.featureAccess = quote.featureAccess;
        user.lastPaymentId = razorpay_payment_id;
        user.lastOrderId = razorpay_order_id;
        user.lastAmountPaid = quote.totalAmount;
        user.lastPreExpiryEmailSentAt = null;
        user.lastPreExpiryDaysNotified = null;
        user.lastPostExpiryEmailSentAt = null;
        await user.save();

        invalidateAuthCache(user._id);

        // Also re-approve any staff accounts under this Admin and sync staff quota locks
        await User.updateMany({ role: 'staff', adminId: user._id }, { status: 'approved' });
        const staffQuotaStatus = await syncStaffQuotaForAdmin(
            user._id,
            user.maxStaffLimit,
            Array.isArray(req.body.selectedStaffIds) ? req.body.selectedStaffIds : null
        );

        const modeLabel = renewalMode === 'addons_only'
            ? `Add-on Pack (${quote.selectedAddons.map(a => a.name).join(', ')})`
            : (renewalMode === 'with_addons' && quote.selectedAddons.length ? 'Yearly Plan Renewal (WITH Add-ons)' : 'Yearly Plan Renewal (WITHOUT Add-ons)');

        await ActivityLog.create({
            adminId: String(user._id),
            userId: String(user._id),
            username: user.username,
            action: renewalMode === 'addons_only' ? 'Add-on Purchased' : 'Subscription Renewed',
            details: `${modeLabel} — ${user.planName} (₹${quote.totalAmount}, PayID: ${razorpay_payment_id}) valid until ${expiryDate.toLocaleDateString('en-IN')}.`
        }).catch(() => {});

        notifyPlanRenewedOrAddon(user, quote, modeLabel, razorpay_payment_id, staffQuotaStatus).catch(() => {});

        res.json({
            success: true,
            message: `${modeLabel} completed! Valid until ${expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
            newExpiryDate: expiryDate,
            staffQuotaStatus
        });
    } catch (err) {
        console.error('Error verifying renewal:', err);
        const msg = 'Server error verifying renewal: ' + err.message;
        res.status(500).json({ success: false, message: msg, error: msg });
    }
}

router.post('/verify-renewal', handleVerifyRenewal);
router.post('/renew-verify', handleVerifyRenewal);

router.calculateSubscriptionQuote = calculateSubscriptionQuote;
router.calculateAddonsOnlyQuote = calculateAddonsOnlyQuote;
router.resolveAdminRenewalParams = resolveAdminRenewalParams;
module.exports = router;
