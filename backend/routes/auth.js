const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { requireLogin, logActivity, isPlanExpiredDate } = require('../middleware/auth');
const { notifyRegistrationOrRequest, checkAndSendExpiryNotificationsForAdmin } = require('../utils/emailService');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { google } = require('googleapis');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'Too many login attempts. Please try again later.'
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

router.post('/login', loginLimiter, async (req, res) => {
    try {
        if (req.body.type === 'customer') {
            const phoneRaw = (req.body.phone || '').replace(/[^0-9]/g, '');
            if (!phoneRaw || phoneRaw.length < 10) return res.json({ success: false, error: "Please enter a valid phone number." });
            const phoneTail = phoneRaw.slice(-10);
            const customer = await Customer.findOne({
                phone: { $regex: new RegExp(escapeRegExp(phoneTail) + '$') }
            }).sort({ _id: -1 });

            if (!customer) return res.json({ success: false, error: "No account found with this phone number." });

            req.session.userPhone = phoneTail;
            req.session.userId = customer._id;
            req.session.role = 'customer';
            req.session.adminId = customer.adminId;
            return res.json({ success: true, user: { role: 'customer', userId: customer._id, adminId: customer.adminId } });
        }

        const rawUsername = (req.body.username || '').toString();
        const cleanUsername = rawUsername.trim();
        const { password } = req.body;
        if (!cleanUsername || !password) return res.json({ success: false, error: "Invalid username or password." });

        let user = await User.findOne({ username: rawUsername }).select('+password');
        if (!user && cleanUsername !== rawUsername) {
            user = await User.findOne({ username: cleanUsername }).select('+password');
        }
        if (!user) {
            user = await User.findOne({
                username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
            }).select('+password');
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

            if (user.role === 'admin') {
                checkAndSendExpiryNotificationsForAdmin(user).catch(() => {});
            }

            return res.json({ 
                success: true, 
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
        res.status(500).json({ success: false, error: "An error occurred during login." });
    }
});

router.post('/register', async (req, res) => {
    try {
        const rawUsername = req.body.username ? req.body.username.trim() : '';
        if (!rawUsername || !req.body.password) {
            return res.json({ success: false, error: "Username and password are required." });
        }
        const existingUser = await User.findOne({ username: new RegExp('^\\s*' + escapeRegExp(rawUsername) + '\\s*$', 'i') });
        if (existingUser) {
            return res.json({ success: false, error: "Username already taken. Please choose another username." });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
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

        await notifyRegistrationOrRequest(newUser);

        res.json({ success: true, message: "✅ Registration request submitted! Please wait for Super Admin approval before logging in." });
    } catch (e) {
        res.status(500).json({ success: false, error: "Registration error: " + e.message });
    }
});

const handleLogout = (req, res) => {
    if (req.session) {
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    } else {
        res.json({ success: true });
    }
};
router.post('/logout', handleLogout);
router.post('/api/logout', handleLogout);

router.post('/change-password', requireLogin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.json({ success: false, error: 'All fields required' });
        if (newPassword.length < 6) return res.json({ success: false, error: 'Password must be at least 6 characters' });

        const user = await User.findById(req.session.userId).select('+password');
        if (!user) return res.json({ success: false, error: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.json({ success: false, error: 'Current password is incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        await logActivity(req, 'Password Changed', `Admin changed their login password.`);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Server error' });
    }
});

router.post('/forgot-password/request-otp', async (req, res) => {
    try {
        const username = (req.body.username || '').trim();
        if (!username) return res.json({ success: false, error: 'Please enter your username.' });

        const user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(username) + '\\s*$', 'i')
        });
        if (!user) return res.json({ success: false, error: 'Username not found.' });

        const userEmail = user.email || user.companyEmail;
        if (!userEmail) {
            return res.json({ success: false, error: 'No email address is linked to this account. Please contact Super Admin.' });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

        await User.findByIdAndUpdate(user._id, { resetOtp: otp, resetOtpExpiry: expiry });

        const mailOptions = {
            from: `"WGS Payment Manager" <${process.env.SMTP_USER}>`,
            to: userEmail,
            subject: '🔑 Password Reset OTP — WGS Payment Manager',
            html: `
                <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 30px; background: #f8fafc; border-radius: 16px;">
                    <h2 style="color: #0f2d52; margin-top: 0;">Password Reset Request</h2>
                    <p style="color: #4a7fa8;">You requested a password reset for your account <strong>"${user.username}"</strong>.</p>
                    <div style="background: linear-gradient(135deg, #1558cc, #0f2d52); color: white; padding: 25px; border-radius: 12px; text-align: center; margin: 20px 0;">
                        <p style="margin: 0 0 5px 0; font-size: 13px; opacity: 0.8;">Your One-Time Password (OTP)</p>
                        <h1 style="margin: 0; font-size: 36px; letter-spacing: 8px;">${otp}</h1>
                    </div>
                    <p style="color: #ef4444; font-weight: 600; font-size: 13px;">⏰ This OTP expires in 10 minutes.</p>
                    <p style="color: #4a7fa8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
                </div>
            `
        };

        await emailTransporter.sendMail(mailOptions);

        const parts = userEmail.split('@');
        const maskedEmail = parts[0].charAt(0) + '***@' + parts[1];

        res.json({ success: true, maskedEmail: maskedEmail });
    } catch (err) {
        console.error('OTP request error:', err);
        res.json({ success: false, error: 'Failed to send OTP. Please try again later.' });
    }
});

router.post('/forgot-password/reset', async (req, res) => {
    try {
        const { username, otp, newPassword } = req.body;
        const cleanUsername = (username || '').trim();
        if (!cleanUsername || !otp || !newPassword) return res.json({ success: false, error: 'All fields are required.' });
        if (newPassword.length < 6) return res.json({ success: false, error: 'Password must be at least 6 characters.' });

        const user = await User.findOne({
            username: new RegExp('^\\s*' + escapeRegExp(cleanUsername) + '\\s*$', 'i')
        }).select('+resetOtp +resetOtpExpiry');
        if (!user) return res.json({ success: false, error: 'Username not found.' });

        if (!user.resetOtp || !user.resetOtpExpiry) {
            return res.json({ success: false, error: 'No OTP was requested. Please go back and request one first.' });
        }

        if (new Date() > new Date(user.resetOtpExpiry)) {
            await User.findByIdAndUpdate(user._id, { $unset: { resetOtp: '', resetOtpExpiry: '' } });
            return res.json({ success: false, error: 'OTP has expired. Please request a new one.' });
        }

        if (user.resetOtp !== otp.trim()) {
            return res.json({ success: false, error: 'Invalid OTP. Please check and try again.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.findByIdAndUpdate(user._id, {
            password: hashedPassword,
            $unset: { resetOtp: '', resetOtpExpiry: '' }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Password reset error:', err);
        res.json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

module.exports = router;
