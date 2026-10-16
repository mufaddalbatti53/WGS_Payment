const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { requireLogin, logActivity, isPlanExpiredDate, createAuthToken, saveSessionAsync, destroySessionSafe } = require('../middleware/auth');
const { notifyRegistrationOrRequest, checkAndSendExpiryNotificationsForAdmin, escapeHtml } = require('../utils/emailService');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { google } = require('googleapis');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 25,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'Too many login attempts. Please try again later.'
});

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'Too many verification code requests. Please wait a few minutes before trying again.'
});

const emailTransporter = nodemailer.createTransport({
    host: (process.env.SMTP_HOST || '').trim(),
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: (parseInt(process.env.SMTP_PORT) || 465) === 465,
    auth: {
        user: (process.env.SMTP_USER || '').trim(),
        pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
});

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

function safeHtml(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(str);
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Handle 2-Step OTP Customer Login: Request OTP
 */
async function handleCustomerOtpRequest(req, res) {
    try {
        const phoneRaw = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phoneRaw || phoneRaw.length < 10) {
            return res.json({ success: false, error: "Please enter a valid phone number (minimum 10 digits)." });
        }

        const phoneTail = phoneRaw.slice(-10);
        const customers = await Customer.find({
            phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') }
        });

        // Uniform response to prevent phone number enumeration
        const genericSuccessMsg = "If this phone number is registered with a vendor, a 6-digit verification code has been sent to your email.";

        // Find customer record with valid email
        const targetCustomer = customers.find(c => c.email && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(c.email.trim()));

        if (targetCustomer && targetCustomer.email) {
            const rawOtp = String(crypto.randomInt(100000, 1000000));
            const hashedOtp = hashOtp(rawOtp);
            const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            await Customer.updateMany(
                { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
                {
                    $set: {
                        loginOtp: hashedOtp,
                        loginOtpExpiry: expiry,
                        loginOtpAttempts: 0,
                        loginOtpRequestedAt: new Date()
                    }
                }
            );

            const userEmail = targetCustomer.email.trim();
            const safeName = safeHtml(targetCustomer.contactPerson || targetCustomer.companyName || 'Valued Customer');
            const mailOptions = {
                from: `"WGS Payment Tracker" <${(process.env.SMTP_USER || '').trim()}>`,
                to: userEmail,
                subject: '🔑 Your Verification Code — WGS Customer Portal',
                html: `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
                        <h2 style="color: #0f2d52; margin-top: 0; font-size: 20px;">Customer Portal Sign-In</h2>
                        <p style="color: #475569; font-size: 14px; line-height: 1.5;">Hello <strong>${safeName}</strong>,</p>
                        <p style="color: #475569; font-size: 14px; line-height: 1.5;">Here is your 6-digit verification code to securely access and view your statement of account:</p>
                        <div style="background: linear-gradient(135deg, #1558cc, #0f2d52); color: white; padding: 22px; border-radius: 12px; text-align: center; margin: 22px 0;">
                            <p style="margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85;">Verification Code</p>
                            <h1 style="margin: 0; font-size: 36px; letter-spacing: 8px; font-weight: 800;">${rawOtp}</h1>
                        </div>
                        <p style="color: #ef4444; font-weight: 600; font-size: 13px; margin: 12px 0;">⏰ This code is valid for 10 minutes.</p>
                        <p style="color: #64748b; font-size: 12.5px; margin: 0; line-height: 1.4;">If you did not request this login code, no action is needed.</p>
                    </div>
                `
            };

            await emailTransporter.sendMail(mailOptions).catch(err => {
                console.error('[Auth] Failed to send customer login OTP email:', err.message);
            });

            const parts = userEmail.split('@');
            const maskedEmail = parts[0].charAt(0) + '***@' + parts[1];
            return res.json({ success: true, message: genericSuccessMsg, step: 'verify', maskedEmail });
        }

        // Return uniform response even if phone number or email not registered
        return res.json({ success: true, message: genericSuccessMsg, step: 'verify', maskedEmail: 'your registered email' });
    } catch (err) {
        console.error('[Auth] Customer OTP request error:', err);
        return res.json({ success: false, error: "Unable to process verification code request. Please try again." });
    }
}

/**
 * Handle 2-Step OTP Customer Login: Verify OTP
 */
async function handleCustomerOtpVerify(req, res) {
    try {
        const phoneRaw = (req.body.phone || '').replace(/[^0-9]/g, '');
        const otpRaw = (req.body.otp || '').toString().trim();

        if (!phoneRaw || phoneRaw.length < 10) {
            return res.json({ success: false, error: "Please enter a valid phone number." });
        }
        if (!otpRaw || otpRaw.length !== 6) {
            return res.json({ success: false, error: "Please enter the 6-digit verification code from your email." });
        }

        const phoneTail = phoneRaw.slice(-10);
        const customers = await Customer.find({
            phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') }
        }).select('+loginOtp +loginOtpExpiry +loginOtpAttempts').sort({ _id: -1 });

        if (!customers || customers.length === 0) {
            return res.json({ success: false, error: "Invalid verification code or code has expired." });
        }

        // Find the record that has a loginOtp set
        const customer = customers.find(c => c.loginOtp) || customers[0];

        if (!customer.loginOtp || !customer.loginOtpExpiry) {
            return res.json({ success: false, error: "No verification code was requested. Please request a new code." });
        }

        // Check if exceeded max 5 attempts
        if ((customer.loginOtpAttempts || 0) >= 5) {
            await Customer.updateMany(
                { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
                { $unset: { loginOtp: '', loginOtpExpiry: '', loginOtpAttempts: '', loginOtpRequestedAt: '' } }
            );
            return res.json({ success: false, error: "Too many incorrect attempts. Verification code has been cancelled. Please request a new code." });
        }

        // Check expiry
        if (new Date() > new Date(customer.loginOtpExpiry)) {
            await Customer.updateMany(
                { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
                { $unset: { loginOtp: '', loginOtpExpiry: '', loginOtpAttempts: '', loginOtpRequestedAt: '' } }
            );
            return res.json({ success: false, error: "Verification code has expired. Please request a new code." });
        }

        const hashedSubmitted = hashOtp(otpRaw);
        if (customer.loginOtp !== hashedSubmitted) {
            const nextAttempts = (customer.loginOtpAttempts || 0) + 1;
            await Customer.updateMany(
                { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
                { $set: { loginOtpAttempts: nextAttempts } }
            );

            if (nextAttempts >= 5) {
                await Customer.updateMany(
                    { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
                    { $unset: { loginOtp: '', loginOtpExpiry: '', loginOtpAttempts: '', loginOtpRequestedAt: '' } }
                );
                return res.json({ success: false, error: "Too many incorrect attempts. Verification code has been cancelled. Please request a new code." });
            }

            return res.json({ success: false, error: `Invalid verification code. Please check and try again (${5 - nextAttempts} attempts remaining).` });
        }

        // Correct OTP! Clear OTP fields across matching customer records
        await Customer.updateMany(
            { phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') } },
            { $unset: { loginOtp: '', loginOtpExpiry: '', loginOtpAttempts: '', loginOtpRequestedAt: '' } }
        );

        req.session.userPhone = phoneTail;
        req.session.userId = customer._id;
        req.session.role = 'customer';
        req.session.adminId = customer.adminId;

        await saveSessionAsync(req);
        const token = createAuthToken(req.session);
        res.setHeader('X-Auth-Token', token);

        return res.json({
            success: true,
            token,
            user: {
                role: 'customer',
                userId: customer._id,
                adminId: customer.adminId,
                companyName: customer.companyName
            }
        });
    } catch (err) {
        console.error('[Auth] Customer OTP verify error:', err);
        return res.json({ success: false, error: "An error occurred during verification. Please try again." });
    }
}

// Dedicated customer login routes
router.post('/customer-login/request-otp', otpLimiter, handleCustomerOtpRequest);
router.post('/customer-login/verify-otp', loginLimiter, handleCustomerOtpVerify);

// POST /login handles Admin, Staff, and Customer 2-Step OTP flows
router.post('/login', loginLimiter, async (req, res) => {
    try {
        if (req.body.type === 'customer') {
            if (req.body.otp) {
                return handleCustomerOtpVerify(req, res);
            }
            return handleCustomerOtpRequest(req, res);
        }

        const rawUsername = (req.body.username || '').toString();
        const cleanUsername = rawUsername.trim();
        const { password } = req.body;
        if (!cleanUsername || !password) return res.json({ success: false, error: "Invalid username or password." });

        let user = await User.findOne({ username: cleanUsername }).select('+password').lean();
        if (!user) {
            user = await User.findOne({
                username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
            }).select('+password').lean();
        }

        if (!user) return res.json({ success: false, error: "Invalid username or password." });

        if (user.role === 'admin') {
            if (user.status === 'pending') return res.json({ success: false, error: "⏳ Your account is pending Super Admin approval. Please wait for approval before logging in." });
            if (user.status === 'suspended') return res.json({ success: false, error: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin to reactivate your account." });
            if (user.status === 'rejected') return res.json({ success: false, error: "❌ Your access request was not approved. Please contact support." });
        } else if (user.role === 'staff') {
            if (user.status === 'suspended' || user.status === 'rejected') {
                return res.json({ success: false, error: "⏸️ Your staff account is currently suspended or inactive. Please contact your Admin." });
            }
            const parentAdmin = await User.findById(user.adminId).lean();
            if (parentAdmin) {
                if (parentAdmin.status === 'suspended') return res.json({ success: false, error: "⏸️ Your company account is currently suspended due to unpaid fees. Please contact Super Admin." });
                if (parentAdmin.status === 'rejected') return res.json({ success: false, error: "❌ Your company access has been revoked. Please contact support." });
                if (isPlanExpiredDate(parentAdmin.planExpiryDate)) {
                    checkAndSendExpiryNotificationsForAdmin(parentAdmin).catch(() => {});
                    return res.json({
                        success: false,
                        error: "⌛ Your company's subscription plan has expired. Staff sign-in is disabled until your Admin renews the plan or purchases an add-on."
                    });
                }
                if (user.isQuotaLocked || parentAdmin.requiresStaffSelection) {
                    return res.json({
                        success: false,
                        error: `🔒 Your staff account is currently paused because your company's plan allows up to ${parentAdmin.maxStaffLimit ?? 5} active staff. Please ask your Admin to enable your account or upgrade their Staff quota.`
                    });
                }
            }
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            req.session.userId = user._id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.adminId = user.role === 'admin' ? user._id : (user.role === 'superadmin' ? user._id : user.adminId);

            await saveSessionAsync(req);
            const token = createAuthToken(req.session);
            res.setHeader('X-Auth-Token', token);

            if (user.role === 'admin') {
                checkAndSendExpiryNotificationsForAdmin(user).catch(() => {});
            }

            return res.json({ 
                success: true, 
                token,
                user: { 
                    username: user.username, 
                    role: user.role, 
                    userId: user._id, 
                    adminId: req.session.adminId 
                } 
            });
        } else {
            return res.json({ success: false, error: "Invalid username or password." });
        }
    } catch (error) {
        console.error('[Auth] Login error:', error);
        res.status(500).json({ success: false, error: "An error occurred during login. Please try again." });
    }
});

router.post('/register', async (req, res) => {
    try {
        const rawUsername = req.body.username ? req.body.username.trim() : '';
        const rawPassword = req.body.password ? req.body.password.toString() : '';

        if (!rawUsername || !rawPassword) {
            return res.json({ success: false, error: "Username and password are required." });
        }
        if (rawPassword.length < 8) {
            return res.json({ success: false, error: "Password must be at least 8 characters long." });
        }

        const existingUser = await User.findOne({ username: new RegExp('^\\s*' + escapeRegExp(rawUsername) + '\\s*$', 'i') }).lean();
        if (existingUser) {
            return res.json({ success: false, error: "Username already taken. Please choose another username." });
        }

        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const hashedAnswer = await bcrypt.hash(req.body.securityAnswer || '', 10);

        const newUser = await User.create({
            username: rawUsername,
            password: hashedPassword,
            email: req.body.email ? req.body.email.trim() : '',
            companyEmail: req.body.email ? req.body.email.trim() : '',
            phone: req.body.phone ? req.body.phone.trim() : '',
            contactNo: req.body.phone ? req.body.phone.trim() : '',
            role: 'admin',
            status: 'pending',
            requestedAt: new Date(),
            securityQuestion: req.body.securityQuestion,
            securityAnswer: hashedAnswer
        });

        notifyRegistrationOrRequest(newUser).catch(() => {});

        res.json({ success: true, message: "✅ Registration request submitted! Please wait for Super Admin approval before logging in." });
    } catch (e) {
        console.error('[Auth] Registration error:', e);
        res.status(500).json({ success: false, error: "An error occurred during registration. Please try again." });
    }
});

const handleLogout = (req, res) => {
    destroySessionSafe(req, res, () => {
        res.clearCookie('connect.sid', { path: '/' });
        res.json({ success: true });
    });
};
router.post('/logout', handleLogout);
router.post('/api/logout', handleLogout);
router.get('/logout', handleLogout);

router.post('/change-password', requireLogin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.json({ success: false, error: 'All fields required' });
        if (newPassword.length < 8) return res.json({ success: false, error: 'Password must be at least 8 characters long.' });

        const user = await User.findById(req.session.userId).select('+password');
        if (!user) return res.json({ success: false, error: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.json({ success: false, error: 'Current password is incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        await logActivity(req, 'Password Changed', `User changed their login password.`);
        res.json({ success: true });
    } catch (err) {
        console.error('[Auth] Change password error:', err);
        res.json({ success: false, error: 'Server error while changing password.' });
    }
});

router.post('/forgot-password/request-otp', otpLimiter, async (req, res) => {
    try {
        const username = (req.body.username || '').trim();
        if (!username) return res.json({ success: false, error: 'Please enter your username.' });

        const genericMsg = 'If an account exists with this username, a 6-digit verification code has been sent to the registered email address.';

        const user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(username) + '\\s*$', 'i')
        });

        if (!user) {
            // Do not reveal that username does not exist
            return res.json({ success: true, maskedEmail: 'your registered email', message: genericMsg });
        }

        const userEmail = user.email || user.companyEmail;
        if (!userEmail || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userEmail.trim())) {
            // Account has no valid email, but don't leak account status
            return res.json({ success: true, maskedEmail: 'your registered email', message: genericMsg });
        }

        const rawOtp = String(crypto.randomInt(100000, 1000000));
        const hashedOtp = hashOtp(rawOtp);
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await User.findByIdAndUpdate(user._id, {
            resetOtp: hashedOtp,
            resetOtpExpiry: expiry,
            resetOtpAttempts: 0,
            resetOtpRequestedAt: new Date()
        });

        const safeUsername = safeHtml(user.username);
        const mailOptions = {
            from: `"WGS Payment Manager" <${(process.env.SMTP_USER || '').trim()}>`,
            to: userEmail.trim(),
            subject: '🔑 Password Reset OTP — WGS Payment Manager',
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 30px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
                    <h2 style="color: #0f2d52; margin-top: 0;">Password Reset Request</h2>
                    <p style="color: #4a7fa8;">You requested a password reset for your account <strong>"${safeUsername}"</strong>.</p>
                    <div style="background: linear-gradient(135deg, #1558cc, #0f2d52); color: white; padding: 25px; border-radius: 12px; text-align: center; margin: 20px 0;">
                        <p style="margin: 0 0 5px 0; font-size: 13px; opacity: 0.8;">Your One-Time Password (OTP)</p>
                        <h1 style="margin: 0; font-size: 36px; letter-spacing: 8px;">${rawOtp}</h1>
                    </div>
                    <p style="color: #ef4444; font-weight: 600; font-size: 13px;">⏰ This OTP expires in 10 minutes.</p>
                    <p style="color: #4a7fa8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
                </div>
            `
        };

        await emailTransporter.sendMail(mailOptions);

        const parts = userEmail.trim().split('@');
        const maskedEmail = parts[0].charAt(0) + '***@' + parts[1];

        res.json({ success: true, maskedEmail: maskedEmail, message: genericMsg });
    } catch (err) {
        console.error('[Auth] OTP request error:', err);
        res.json({ success: false, error: 'Failed to send OTP. Please try again later.' });
    }
});

router.post('/forgot-password/reset', loginLimiter, async (req, res) => {
    try {
        const { username, otp, newPassword } = req.body;
        const cleanUsername = (username || '').trim();
        const rawOtp = (otp || '').toString().trim();
        const rawNewPassword = (newPassword || '').toString();

        if (!cleanUsername || !rawOtp || !rawNewPassword) {
            return res.json({ success: false, error: 'All fields are required.' });
        }
        if (rawNewPassword.length < 8) {
            return res.json({ success: false, error: 'Password must be at least 8 characters long.' });
        }

        const user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).select('+resetOtp +resetOtpExpiry +resetOtpAttempts');

        if (!user || !user.resetOtp || !user.resetOtpExpiry) {
            return res.json({ success: false, error: 'Invalid verification code or code has expired. Please request a new code.' });
        }

        // Cancel code after 5 wrong tries
        if ((user.resetOtpAttempts || 0) >= 5) {
            await User.findByIdAndUpdate(user._id, {
                $unset: { resetOtp: '', resetOtpExpiry: '', resetOtpAttempts: '', resetOtpRequestedAt: '' }
            });
            return res.json({ success: false, error: 'Too many incorrect attempts. Verification code has been cancelled. Please request a new code.' });
        }

        if (new Date() > new Date(user.resetOtpExpiry)) {
            await User.findByIdAndUpdate(user._id, {
                $unset: { resetOtp: '', resetOtpExpiry: '', resetOtpAttempts: '', resetOtpRequestedAt: '' }
            });
            return res.json({ success: false, error: 'Verification code has expired. Please request a new code.' });
        }

        const hashedSubmitted = hashOtp(rawOtp);
        if (user.resetOtp !== hashedSubmitted) {
            const nextAttempts = (user.resetOtpAttempts || 0) + 1;
            await User.findByIdAndUpdate(user._id, { $set: { resetOtpAttempts: nextAttempts } });

            if (nextAttempts >= 5) {
                await User.findByIdAndUpdate(user._id, {
                    $unset: { resetOtp: '', resetOtpExpiry: '', resetOtpAttempts: '', resetOtpRequestedAt: '' }
                });
                return res.json({ success: false, error: 'Too many incorrect attempts. Verification code has been cancelled. Please request a new code.' });
            }

            return res.json({ success: false, error: `Invalid verification code. Please check and try again (${5 - nextAttempts} attempts remaining).` });
        }

        // Password reset success
        const hashedPassword = await bcrypt.hash(rawNewPassword, 12);
        await User.findByIdAndUpdate(user._id, {
            password: hashedPassword,
            $unset: { resetOtp: '', resetOtpExpiry: '', resetOtpAttempts: '', resetOtpRequestedAt: '' }
        });

        res.json({ success: true, message: 'Password reset successful!' });
    } catch (err) {
        console.error('[Auth] Password reset error:', err);
        res.json({ success: false, error: 'An error occurred during password reset. Please try again.' });
    }
});

module.exports = router;
