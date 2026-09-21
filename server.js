require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.default || connectMongo;
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');
const path = require('path');

const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const Customer = require('./models/Customer');
const User = require('./models/User');
const ActivityLog = require('./models/Activity');

const app = express();

// --- DATABASE CONNECTION ---
const dbURI = process.env.MONGODB_URI || 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

async function ensureSuperAdminAccount() {
    try {
        const existingSuper = await User.findOne({ username: 'superadmin' });
        if (!existingSuper) {
            await User.create({
                username: 'superadmin',
                password: '$2b$10$QKo/6ChmBFeP8UZRYGt/aO3vURZiLC.iF3ikC3MkBEsCyES.m8j4e',
                plainPassword: 'superadmin123',
                role: 'superadmin',
                status: 'approved'
            });
            console.log("✅ Super Admin account initialized.");
        }
        // Auto-approve pre-existing admin accounts created prior to status requirement
        const updateResult = await User.updateMany(
            { role: { $in: ['admin', 'staff'] }, status: { $exists: false } },
            { $set: { status: 'approved', approvedAt: new Date() } }
        );
        if (updateResult.modifiedCount > 0) {
            console.log(`✅ Auto-approved ${updateResult.modifiedCount} pre-existing account(s).`);
        }
    } catch (err) {
        console.error("Auto Super Admin creation error:", err.message);
    }
}

mongoose.connect(dbURI)
    .then(() => {
        console.log("✅ DB Connected Successfully");
        ensureSuperAdminAccount();
        shiftAgingBuckets();
        runAutoBackups(); // Run on startup
        setInterval(shiftAgingBuckets, 24 * 60 * 60 * 1000);
        setInterval(runAutoBackups, 24 * 60 * 60 * 1000); // Check for backups every 24 hours
    })
    .catch(err => console.log("❌ DB Connection Error: ", err));

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.use(express.static('public', { dotfiles: 'allow' }));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 100000 }));
app.use(express.json({ limit: '50mb' }));
app.use(methodOverride('_method'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'wgs_payment_tracker_production_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: dbURI,
        collectionName: 'sessions',
        autoRemove: 'native'
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24
    }
}));

const isJsonReq = (req) => {
    return req.xhr || 
           (req.headers.accept && req.headers.accept.includes('application/json')) ||
           (req.headers['content-type'] && req.headers['content-type'].includes('application/json'));
};

const requireLogin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Session expired. Please log in again." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Session expired. Please log in again."));
    }

    if (req.session.role === 'superadmin') return next();

    try {
        const adminId = req.session.adminId || req.session.userId;
        const adminUser = await User.findById(adminId).lean();
        if (!adminUser) {
            req.session.destroy();
            if (isJsonReq(req)) {
                return res.status(401).json({ success: false, redirect: '/login', message: "Account not found. Please log in again." });
            }
            return res.redirect('/login?error=' + encodeURIComponent("Account not found. Please log in again."));
        }
        if (adminUser.status === 'suspended') {
            req.session.destroy();
            if (isJsonReq(req)) {
                return res.status(401).json({ success: false, redirect: '/login', message: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin." });
            }
            return res.redirect('/login?error=' + encodeURIComponent("⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin to reactivate your account."));
        }
        if (adminUser.status === 'rejected') {
            req.session.destroy();
            if (isJsonReq(req)) {
                return res.status(401).json({ success: false, redirect: '/login', message: "❌ Your access has been revoked. Please contact support." });
            }
            return res.redirect('/login?error=' + encodeURIComponent("❌ Your access has been revoked. Please contact support."));
        }
        if (adminUser.planExpiryDate && new Date() > new Date(adminUser.planExpiryDate)) {
            req.session.destroy();
            if (isJsonReq(req)) {
                return res.status(401).json({ success: false, redirect: '/login', message: "⌛ Your subscription plan has expired. Please contact Super Admin." });
            }
            return res.redirect('/login?error=' + encodeURIComponent("⌛ Your subscription plan has expired. Please contact Super Admin to renew your subscription."));
        }
    } catch (e) {
        console.error("Auth status check error:", e);
    }
    next();
};

const requireAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Session expired. Please log in again." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Session expired. Please log in again."));
    }
    if (req.session.role !== 'admin') {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Admin session required." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Admin access required. Please log in as Admin."));
    }
    return requireLogin(req, res, next);
};

async function logActivity(req, action, details) {
    try {
        if (!req.session || !req.session.adminId) return;
        if (req.session.role === 'customer') return;
        await ActivityLog.create({
            adminId: req.session.adminId,
            userId: req.session.userId || req.session.adminId,
            username: req.session.username || 'Admin',
            action: action,
            details: details
        });
    } catch (err) {
        console.error("Activity Log Error:", err.message);
    }
}

function escapeRegExp(string) {
    return (string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const { google } = require('googleapis');

function getOAuth2Client(tokens) {
    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID || '',
        process.env.GOOGLE_CLIENT_SECRET || '',
        process.env.GOOGLE_CALLBACK_URL || 'https://payment.webgraphicsstudio.in/auth/google/callback'
    );
    if (tokens) {
        client.setCredentials(tokens);
    }
    return client;
}

// 1. Route to start Google Drive Connection
app.get('/auth/google', requireAdmin, (req, res) => {
    const client = getOAuth2Client();
    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.appdata',
            'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent'
    });
    res.redirect(url);
});

app.get('/auth/google/callback', requireLogin, async (req, res) => {
    try {
        const { code } = req.query;
        const client = getOAuth2Client();
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Fetch the user's email address
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();

        await User.findByIdAndUpdate(req.session.adminId, {
            googleDriveToken: tokens,
            googleEmail: userInfo.data.email
        });
        res.redirect('/?msg=gdrive_linked');
    } catch (e) { res.redirect('/?msg=error'); }
});

app.get('/auth/google/disconnect', requireLogin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.adminId, {
            $unset: { googleDriveToken: "", googleEmail: "" }
        });
        res.redirect('/?msg=gdrive_disconnected');
    } catch (e) {
        console.error("Disconnect GDrive error:", e);
        res.redirect('/?msg=error');
    }
});

app.get('/drive-backup', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'superadmin') {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Session expired. Please log in again." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Session expired. Please log in again."));
    }
    try {
        const adminUser = await User.findById(req.session.adminId).select('+googleDriveToken').lean();
        if (!adminUser || !adminUser.googleDriveToken) {
            return res.status(400).send("Google Drive not linked.");
        }

        const client = getOAuth2Client(adminUser.googleDriveToken);
        const drive = google.drive({ version: 'v3', auth: client });

        // Gather ALL the data
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const staff = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).lean();

        const backupData = JSON.stringify({
            customers: customers,
            staff: staff,
            activities: activities,
            timestamp: new Date()
        });

        await drive.files.create({
            resource: {
                name: `WGS_Backup_${new Date().toISOString().slice(0, 10)}.json`,
                parents: ['appDataFolder']
            },
            media: { mimeType: 'application/json', body: backupData },
            fields: 'id'
        });
        await logActivity(req, 'Cloud Backup', `Created backup on Google Drive.`);
        res.json({ success: true, message: "Successfully backed up to Google Drive!" });

    } catch (err) {
        console.error("Drive Backup Error:", err);
        res.status(500).json({ success: false, message: "Failed to push to Google Drive. Please try again." });
    }
});

// 4. The "WhatsApp Style" Silent Restore Route
app.get('/drive-restore', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'superadmin') {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Session expired. Please log in again." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Session expired. Please log in again."));
    }
    try {
        const adminUser = await User.findById(req.session.adminId).select('+googleDriveToken').lean();
        if (!adminUser || !adminUser.googleDriveToken) {
            return res.status(400).send("Google Drive not linked.");
        }

        const client = getOAuth2Client(adminUser.googleDriveToken);
        const drive = google.drive({ version: 'v3', auth: client });

        const response = await drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name, createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 1
        });

        if (!response.data.files || response.data.files.length === 0) {
            return res.json({ success: false, message: "No backup found in Google Drive." });
        }

        const latestFileId = response.data.files[0].id;
        const file = await drive.files.get({ fileId: latestFileId, alt: 'media' });
        const backup = file.data;

        if (!backup || !backup.customers) {
            return res.json({ success: false, message: "Backup file is invalid or empty." });
        }

        const adminId = req.session.adminId;
        const existingCustomers = await Customer.find({ adminId }).lean();
        const existingStaff = await User.find({ role: 'staff', adminId }).lean();

        try {
            if (Array.isArray(backup.customers)) {
                await Customer.deleteMany({ adminId });
                const toInsertC = backup.customers.map(c => ({ ...c, adminId, _id: undefined }));
                if (toInsertC.length > 0) await Customer.insertMany(toInsertC, { ordered: false });
            }

            if (Array.isArray(backup.staff)) {
                await User.deleteMany({ role: 'staff', adminId });
                const toInsertS = backup.staff.map(s => ({ ...s, adminId, _id: undefined }));
                if (toInsertS.length > 0) await User.insertMany(toInsertS, { ordered: false });
            }

            if (Array.isArray(backup.activities)) {
                await ActivityLog.deleteMany({ adminId });
                const toInsertA = backup.activities.map(a => ({ ...a, adminId, _id: undefined }));
                if (toInsertA.length > 0) await ActivityLog.insertMany(toInsertA, { ordered: false });
            }
        } catch (restoreError) {
            console.error("Restore failed, rolling back original data:", restoreError);
            if (existingCustomers.length > 0) {
                await Customer.deleteMany({ adminId });
                await Customer.insertMany(existingCustomers, { ordered: false });
            }
            if (existingStaff.length > 0) {
                await User.deleteMany({ role: 'staff', adminId });
                await User.insertMany(existingStaff, { ordered: false });
            }
            throw restoreError;
        }
        await logActivity(req, 'Cloud Restored', `Restored data from Google Drive backup.`);
        res.json({ success: true, message: "Database successfully restored from Google Drive!" });

    } catch (err) {
        console.error("Drive Restore Error:", err);
        res.status(500).json({ success: false, message: "Failed to pull from Google Drive. Please try again." });
    }
});

// AGING BUCKET AUTO-SHIFT
async function shiftAgingBuckets() {
    try {
        console.log("Running daily aging bucket shift...");
        const customers = await Customer.find({});
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const bulkOps = [];

        for (const cust of customers) {
            if (!cust.aging) continue;

            const lastShifted = cust.agingLastShifted ? new Date(cust.agingLastShifted) : null;
            if (!lastShifted) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: cust._id },
                        update: { $set: { agingLastShifted: today } }
                    }
                });
                continue;
            }

            lastShifted.setHours(0, 0, 0, 0);
            const daysSinceShift = Math.floor((today - lastShifted) / (1000 * 60 * 60 * 24));
            if (daysSinceShift < 1) continue;

            const periods = Math.floor(daysSinceShift / 30);
            if (periods < 1) continue;

            const ag = {
                under30: cust.aging.under30 || 0,
                days30to60: cust.aging.days30to60 || 0,
                days60to90: cust.aging.days60to90 || 0,
                days90to120: cust.aging.days90to120 || 0,
                days120to150: cust.aging.days120to150 || 0,
                days150to180: cust.aging.days150to180 || 0,
                above180: cust.aging.above180 || 0,
                onAccount: cust.aging.onAccount || 0
            };

            for (let p = 0; p < periods; p++) {
                ag.above180 += ag.days150to180;
                ag.days150to180 = ag.days120to150;
                ag.days120to150 = ag.days90to120;
                ag.days90to120 = ag.days60to90;
                ag.days60to90 = ag.days30to60;
                ag.days30to60 = ag.under30;
                ag.under30 = 0;
            }

            const newLastShifted = new Date(lastShifted);
            newLastShifted.setDate(newLastShifted.getDate() + (periods * 30));

            bulkOps.push({
                updateOne: {
                    filter: { _id: cust._id },
                    update: {
                        $set: {
                            aging: ag,
                            agingLastShifted: newLastShifted
                        }
                    }
                }
            });
        }

        if (bulkOps.length > 0) {
            await Customer.bulkWrite(bulkOps);
        }

        console.log(`Aging shift complete. Shifted ${bulkOps.length} customers.`);
    } catch (err) {
        console.error("Aging shift error:", err.message);
    }
}

// GOOGLE DRIVE AUTO-BACKUP ENGINE
async function runAutoBackups() {
    try {
        console.log("Checking for scheduled Auto-Backups...");
        const admins = await User.find({ role: 'admin', autoBackupInterval: { $gt: 0 } }).select('+googleDriveToken');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const admin of admins) {
            if (!admin.googleDriveToken) continue;

            const lastBackup = admin.lastAutoBackupDate ? new Date(admin.lastAutoBackupDate) : new Date(0);
            lastBackup.setHours(0, 0, 0, 0);
            const daysSinceBackup = Math.floor((today - lastBackup) / (1000 * 60 * 60 * 24));

            if (daysSinceBackup >= admin.autoBackupInterval) {
                try {
                    const client = getOAuth2Client(admin.googleDriveToken);
                    const drive = google.drive({ version: 'v3', auth: client });

                    const customers = await Customer.find({ adminId: admin._id }).lean();
                    const staff = await User.find({ role: 'staff', adminId: admin._id }).lean();
                    const activities = await ActivityLog.find({ adminId: admin._id }).lean();

                    const backupData = JSON.stringify({
                        customers: customers,
                        staff: staff,
                        activities: activities,
                        timestamp: new Date()
                    });

                    await drive.files.create({
                        resource: {
                            name: `WGS_AutoBackup_${new Date().toISOString().slice(0, 10)}.json`,
                            parents: ['appDataFolder']
                        },
                        media: { mimeType: 'application/json', body: backupData },
                        fields: 'id'
                    });

                    admin.lastAutoBackupDate = new Date();
                    await admin.save();
                    console.log(`✅ Auto-backup successful for: ${admin.companyName || admin.username}`);
                } catch (err) {
                    console.error(`❌ Auto-backup failed for ${admin.username}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error("Auto-backup job error:", err.message);
    }
}

// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => {
    if (req.session && req.session.userId) return res.redirect('/');
    res.render('login', { error: req.query.error || null });
});

app.post('/login', async (req, res) => {
    try {
        if (req.body.type === 'customer') {
            const phoneRaw = (req.body.phone || '').replace(/[^0-9]/g, '');
            if (!phoneRaw) return res.render('login', { error: "Please enter a valid phone number." });
            const customer = await Customer.findOne({
                phone: { $regex: new RegExp(phoneRaw + '$') }
            }).sort({ _id: -1 });

            if (!customer) return res.render('login', { error: "No account found with this phone number." });

            req.session.userPhone = phoneRaw;
            req.session.userId = customer._id;
            req.session.role = 'customer';
            req.session.adminId = customer.adminId;
            return res.redirect('/');
        }

        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user) return res.render('login', { error: "Invalid username or password." });

        if (user.role === 'admin') {
            if (user.status === 'pending') {
                return res.render('login', { error: "⏳ Your account is pending Super Admin approval. Please wait for approval before logging in." });
            }
            if (user.status === 'suspended') {
                return res.render('login', { error: "⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin to reactivate your account." });
            }
            if (user.status === 'rejected') {
                return res.render('login', { error: "❌ Your access request was not approved. Please contact support." });
            }
            if (user.planExpiryDate && new Date() > new Date(user.planExpiryDate)) {
                return res.render('login', { error: "⌛ Your subscription plan has expired. Please contact Super Admin to renew your subscription." });
            }
        } else if (user.role === 'staff') {
            const parentAdmin = await User.findById(user.adminId).lean();
            if (parentAdmin) {
                if (parentAdmin.status === 'suspended') {
                    return res.render('login', { error: "⏸️ Your company account is currently suspended due to unpaid fees. Please contact Super Admin." });
                }
                if (parentAdmin.status === 'rejected') {
                    return res.render('login', { error: "❌ Your company access has been revoked. Please contact support." });
                }
                if (parentAdmin.planExpiryDate && new Date() > new Date(parentAdmin.planExpiryDate)) {
                    return res.render('login', { error: "⌛ Your company's subscription plan has expired. Please contact Super Admin." });
                }
            }
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            req.session.userId = user._id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.adminId = user.role === 'admin' ? user._id : (user.role === 'superadmin' ? user._id : user.adminId);

            if (user.role === 'superadmin') {
                return res.redirect('/superadmin');
            }
            return res.redirect('/');
        } else {
            return res.render('login', { error: "Invalid username or password." });
        }
    } catch (error) {
        res.status(500).send("An error occurred during login.");
    }
});

app.get('/forgot-password', (req, res) => { res.render('forgot', { error: null }); });

app.post('/forgot-password', async (req, res) => {
    try {
        const { username, securityQuestion, securityAnswer, newPassword } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.render('forgot', { error: "Username not found" });
        if (user.securityQuestion !== securityQuestion) return res.render('forgot', { error: "Wrong Security Question" });
        const isMatch = await bcrypt.compare(securityAnswer, user.securityAnswer);
        if (!isMatch) return res.render('forgot', { error: "Wrong Security Answer" });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.plainPassword = newPassword;
        await user.save();
        res.redirect('/login');
    } catch (err) {
        console.error("Forgot password error:", err);
        res.render('forgot', { error: "An error occurred while resetting password." });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/customers/:id/auto-snooze', requireLogin, async (req, res) => {
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
                return res.status(429).json({ success: false, message: `Daily message limit reached (${adminUser.dailyMessageCount}/${dailyLimit}). Contact Super Admin to upgrade your limit.` });
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

app.get('/', async (req, res) => {
    if (!req.session.userId) {
        return res.sendFile(path.join(__dirname, 'public', 'landing.html'));
    }

    if (req.session.role === 'superadmin') {
        return res.redirect('/superadmin');
    }

    try {
        let finalCustomers = [];

        if (req.session.role === 'customer') {
            if (req.session.userPhone) {
                finalCustomers = await Customer.find({
                    phone: { $regex: new RegExp(req.session.userPhone + '$') }
                }).sort({ _id: -1 }).limit(1).lean();
            } else {
                finalCustomers = await Customer.find({ _id: req.session.userId }).lean();
            }
        } else {
            finalCustomers = await Customer.find({ adminId: req.session.adminId }).lean();
        }

        const adminUser = await User.findById(req.session.adminId).lean() || {};

        if (adminUser && adminUser._id) {
            if (adminUser.status === 'suspended') {
                req.session.destroy();
                return res.redirect('/login?error=' + encodeURIComponent("⏸️ Your account has been suspended due to unpaid fees. Please contact Super Admin to reactivate your account."));
            }
            if (adminUser.status === 'rejected') {
                req.session.destroy();
                return res.redirect('/login?error=' + encodeURIComponent("❌ Your access has been revoked. Please contact support."));
            }
            if (adminUser.planExpiryDate && new Date() > new Date(adminUser.planExpiryDate)) {
                req.session.destroy();
                return res.redirect('/login?error=' + encodeURIComponent("⌛ Your subscription plan has expired. Please contact Super Admin to renew your subscription."));
            }
        }

        // Subscription Expiry Warning Check (10 days left or less)
        let subscriptionAlert = null;
        if (adminUser.planExpiryDate) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(adminUser.planExpiryDate); expiry.setHours(0, 0, 0, 0);
            const diffTime = expiry.getTime() - today.getTime();
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLeft <= 10) {
                subscriptionAlert = {
                    expired: daysLeft < 0,
                    daysLeft: Math.max(0, daysLeft),
                    expiryFormatted: expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                };
            }
        }

        let totalPending = 0, actionRequiredCount = 0;
        let b_u30 = 0, b_30_60 = 0, b_60_90 = 0, b_90_120 = 0;
        let b_120_150 = 0, b_150_180 = 0, b_a180 = 0, b_onAcc = 0;
        let cnt_u30 = 0, cnt_30_60 = 0, cnt_60_90 = 0, cnt_90_120 = 0;
        let cnt_120_150 = 0, cnt_150_180 = 0, cnt_a180 = 0, cnt_onAcc = 0;

        const today = new Date(); today.setHours(0, 0, 0, 0);

        for (const c of finalCustomers) {
            const due = (c.totalAmount || 0) - (c.paidAmount || 0);
            totalPending += due;

            if (c.nextActionDate) {
                const nd = new Date(c.nextActionDate); nd.setHours(0, 0, 0, 0);
                if (due > 0 && today >= nd) actionRequiredCount++;
            } else if (due > 0) {
                actionRequiredCount++;
            }

            const ag = c.aging || {};
            b_u30 += ag.under30 || 0;
            b_30_60 += ag.days30to60 || 0;
            b_60_90 += ag.days60to90 || 0;
            b_90_120 += ag.days90to120 || 0;
            b_120_150 += ag.days120to150 || 0;
            b_150_180 += ag.days150to180 || 0;
            b_a180 += ag.above180 || 0;
            b_onAcc += ag.onAccount || 0;

            if ((ag.under30 || 0) > 0) cnt_u30++;
            if ((ag.days30to60 || 0) > 0) cnt_30_60++;
            if ((ag.days60to90 || 0) > 0) cnt_60_90++;
            if ((ag.days90to120 || 0) > 0) cnt_90_120++;
            if ((ag.days120to150 || 0) > 0) cnt_120_150++;
            if ((ag.days150to180 || 0) > 0) cnt_150_180++;
            if ((ag.above180 || 0) > 0) cnt_a180++;
            if ((ag.onAccount || 0) > 0) cnt_onAcc++;
        }

        const maxBucket = Math.max(b_u30, b_30_60, b_60_90, b_90_120, b_120_150, b_150_180, b_a180) || 1;

        const fmtINR = (n) => '₹ ' + Number(n).toLocaleString('en-IN');

        const stats = {
            totalPending, actionRequiredCount,
            totalParties: finalCustomers.length,
            buckets: {
                u30: { amt: b_u30, fmt: fmtINR(b_u30), cnt: cnt_u30, pct: Math.round((b_u30 / maxBucket) * 100) },
                d30_60: { amt: b_30_60, fmt: fmtINR(b_30_60), cnt: cnt_30_60, pct: Math.round((b_30_60 / maxBucket) * 100) },
                d60_90: { amt: b_60_90, fmt: fmtINR(b_60_90), cnt: cnt_60_90, pct: Math.round((b_60_90 / maxBucket) * 100) },
                d90_120: { amt: b_90_120, fmt: fmtINR(b_90_120), cnt: cnt_90_120, pct: Math.round((b_90_120 / maxBucket) * 100) },
                d120_150: { amt: b_120_150, fmt: fmtINR(b_120_150), cnt: cnt_120_150, pct: Math.round((b_120_150 / maxBucket) * 100) },
                d150_180: { amt: b_150_180, fmt: fmtINR(b_150_180), cnt: cnt_150_180, pct: Math.round((b_150_180 / maxBucket) * 100) },
                a180: { amt: b_a180, fmt: fmtINR(b_a180), cnt: cnt_a180, pct: Math.round((b_a180 / maxBucket) * 100) },
                onAcc: { amt: b_onAcc, fmt: fmtINR(b_onAcc), cnt: cnt_onAcc, pct: 0 }
            },
            totalPendingFmt: fmtINR(totalPending)
        };

        res.render('index', {
            customers: finalCustomers,
            role: req.session.role,
            adminUser: adminUser,
            stats: stats,
            subscriptionAlert: subscriptionAlert,
            quotaMsg: req.query.msg || null,
            quotaError: req.query.quota_error || null
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send("Error loading dashboard.");
    }
});

// 3. ADMIN PAGES
app.get('/staff', requireAdmin, async (req, res) => {
    try {
        const myStaff = await User.find({ role: 'staff', adminId: req.session.adminId }).select('+plainPassword').lean();
        const adminUser = await User.findById(req.session.adminId).lean() || {};
        const maxStaffLimit = adminUser.maxStaffLimit ?? 5;

        let subscriptionAlert = null;
        if (adminUser.planExpiryDate) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(adminUser.planExpiryDate); expiry.setHours(0, 0, 0, 0);
            const diffTime = expiry.getTime() - today.getTime();
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLeft <= 10) {
                subscriptionAlert = {
                    expired: daysLeft < 0,
                    daysLeft: Math.max(0, daysLeft),
                    expiryFormatted: expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                };
            }
        }

        res.render('staff', {
            staffMembers: myStaff,
            role: req.session.role,
            maxStaffLimit: maxStaffLimit,
            currentStaffCount: myStaff.length,
            msg: req.query.msg || null,
            error: req.query.error || null,
            subscriptionAlert: subscriptionAlert
        });
    } catch (error) { res.status(500).send("Error loading staff."); }
});

app.get('/activity', requireLogin, async (req, res) => {
    try {
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).limit(500).lean();
        res.render('activity', { activities: activities, role: req.session.role });
    } catch (err) { res.status(500).send("Error loading activity."); }
});

app.post('/activity/delete-bulk', requireAdmin, async (req, res) => {
    try {
        const { filterType, startDate, endDate } = req.body;
        let query = { adminId: req.session.adminId };
        const now = new Date();
        if (filterType === 'older_than_30') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            query.createdAt = { $lt: cutoff };
        } else if (filterType === 'last_30') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            query.createdAt = { $gte: cutoff };
        } else if (filterType === 'custom' && startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }
        await ActivityLog.deleteMany(query);
        res.redirect('/activity');
    } catch (err) { res.status(500).send("Failed to delete logs."); }
});

app.put('/settings', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.adminId, {
            companyName: req.body.companyName, addressLine1: req.body.addressLine1, addressLine2: req.body.addressLine2,
            addressLine3: req.body.addressLine3, dlNo: req.body.dlNo, msmeNo: req.body.msmeNo,
            contactNo: req.body.contactNo, companyEmail: req.body.companyEmail,
            bankName: req.body.bankName, accountName: req.body.accountName,
            accountNumber: req.body.accountNumber, ifscCode: req.body.ifscCode, upiDetails: req.body.upiDetails,
        });
        await logActivity(req, "Company Profile", "Updated company profile and settings.");
        res.redirect('/?msg=party_edited');
    } catch (err) {
        console.error("Settings update error:", err);
        res.redirect('/?msg=error');
    }
});

app.put('/settings/auto-backup', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.adminId, {
            autoBackupInterval: Number(req.body.autoBackupInterval) || 0
        });
        await logActivity(req, "Automation Updated", `Set Google Drive auto-backup interval to ${req.body.autoBackupInterval} days.`);
        res.redirect('/?msg=auto_backup_saved');
    } catch (err) {
        res.status(500).send("Failed to save settings.");
    }
});

app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/register', (req, res) => { res.render('register'); });
app.post('/register', async (req, res) => {
    try {
        const rawUsername = req.body.username ? req.body.username.trim() : '';
        const existingUser = await User.findOne({ username: new RegExp('^' + escapeRegExp(rawUsername) + '$', 'i') });
        if (existingUser) {
            return res.render('login', { error: "Username already taken. Please choose another username." });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const hashedAnswer = await bcrypt.hash(req.body.securityAnswer, 10);

        await User.create({
            username: rawUsername,
            password: hashedPassword,
            plainPassword: req.body.password,
            email: req.body.email ? req.body.email.trim() : '',
            phone: req.body.phone ? req.body.phone.trim() : '',
            role: 'admin',
            status: 'pending',
            requestedAt: new Date(),
            securityQuestion: req.body.securityQuestion,
            securityAnswer: hashedAnswer
        });

        res.render('login', { error: "✅ Registration request submitted! Please wait for Super Admin approval before logging in." });
    } catch (e) {
        res.render('login', { error: "Registration error: " + e.message });
    }
});

// ── SUPER ADMIN ROUTES ──
const requireSuperAdmin = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Session expired. Please log in again." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Session expired. Please log in again."));
    }
    if (req.session.role === 'superadmin') {
        next();
    } else {
        if (isJsonReq(req)) {
            return res.status(401).json({ success: false, redirect: '/login', message: "Super Admin access required." });
        }
        return res.redirect('/login?error=' + encodeURIComponent("Super Admin access required. Please log in as Super Admin."));
    }
};

app.get('/superadmin', requireSuperAdmin, async (req, res) => {
    try {
        const [adminUsers, staffUsers, partyCounts] = await Promise.all([
            User.find({ role: 'admin' }).select('+plainPassword').sort({ _id: -1 }).lean(),
            User.find({ role: 'staff' }).select('+plainPassword').sort({ _id: -1 }).lean(),
            Customer.aggregate([{ $group: { _id: "$adminId", count: { $sum: 1 } } }])
        ]);

        // Group staff by parent adminId
        const staffByAdmin = {};
        staffUsers.forEach(s => {
            if (s.adminId) {
                const aIdStr = s.adminId.toString();
                if (!staffByAdmin[aIdStr]) staffByAdmin[aIdStr] = [];
                staffByAdmin[aIdStr].push({
                    _id: s._id,
                    username: s.username,
                    plainPassword: s.plainPassword || '(Hashed)',
                    role: s.role
                });
            }
        });

        const partyMap = {};
        partyCounts.forEach(p => { if (p._id) partyMap[p._id.toString()] = p.count; });

        // Enforce & format metrics on each admin object
        const enrichedAdmins = adminUsers.map(u => {
            const idStr = u._id.toString();
            const myStaffList = staffByAdmin[idStr] || [];
            return {
                ...u,
                staffList: myStaffList,
                staffCount: myStaffList.length,
                partyCount: partyMap[idStr] || 0,
                maxStaffLimit: u.maxStaffLimit ?? 5,
                maxCustomersLimit: u.maxCustomersLimit ?? 500,
                dailyMessageLimit: u.dailyMessageLimit ?? 100,
                dailyMessageCount: u.dailyMessageCount || 0
            };
        });

        const pendingUsers = enrichedAdmins.filter(u => u.status === 'pending');
        const approvedUsers = enrichedAdmins.filter(u => u.status === 'approved' || !u.status);
        const suspendedUsers = enrichedAdmins.filter(u => u.status === 'suspended');
        const rejectedUsers = enrichedAdmins.filter(u => u.status === 'rejected');

        res.render('superadmin', {
            superadminUsername: req.session.username || 'Super Admin',
            pendingUsers,
            approvedUsers,
            suspendedUsers,
            rejectedUsers,
            msg: req.query.msg || null,
            error: req.query.error || null
        });
    } catch (err) {
        res.status(500).send("Error loading Super Admin dashboard: " + err.message);
    }
});

app.post('/superadmin/update-limits/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Invalid User ID provided.') + '&tab=approvedTab');
        }

        const { maxStaffLimit, maxCustomersLimit, dailyMessageLimit, planExpiryDate, status } = req.body;

        const updateData = {
            maxStaffLimit: Math.max(0, parseInt(maxStaffLimit) || 0),
            maxCustomersLimit: Math.max(0, parseInt(maxCustomersLimit) || 0),
            dailyMessageLimit: Math.max(0, parseInt(dailyMessageLimit) || 0)
        };

        if (status && ['approved', 'pending', 'rejected', 'suspended'].includes(status)) {
            updateData.status = status;
            await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: status });
        }

        if (planExpiryDate) {
            updateData.planExpiryDate = new Date(planExpiryDate);
        } else if (planExpiryDate === '') {
            updateData.planExpiryDate = null;
        }

        const targetUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        const redirectTab = status === 'suspended' ? 'suspendedTab' : 'approvedTab';
        res.redirect('/superadmin?msg=' + encodeURIComponent(`Updated plan limits and status for ${targetUser ? targetUser.username : 'admin'}.`) + '&tab=' + redirectTab);
    } catch (err) {
        console.error("Update limits error:", err);
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to update limits: ' + err.message) + '&tab=approvedTab');
    }
});

app.post('/superadmin/change-credentials', requireSuperAdmin, async (req, res) => {
    try {
        const { newUsername, currentPassword, newPassword, confirmPassword } = req.body;
        const cleanUsername = (newUsername || '').trim();

        if (!cleanUsername || !currentPassword || !newPassword) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('All fields are required.') + '&tab=settingsTab');
        }

        if (newPassword !== confirmPassword) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('New password and confirm password do not match.') + '&tab=settingsTab');
        }

        if (newPassword.length < 6) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('New password must be at least 6 characters long.') + '&tab=settingsTab');
        }

        const user = await User.findById(req.session.userId);
        if (!user || user.role !== 'superadmin') {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Super Admin account not found.') + '&tab=settingsTab');
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Current password is incorrect.') + '&tab=settingsTab');
        }

        if (cleanUsername.toLowerCase() !== user.username.toLowerCase()) {
            const existingUser = await User.findOne({
                username: new RegExp('^' + escapeRegExp(cleanUsername) + '$', 'i'),
                _id: { $ne: user._id }
            });
            if (existingUser) {
                return res.redirect('/superadmin?error=' + encodeURIComponent('Username "' + cleanUsername + '" is already taken.') + '&tab=settingsTab');
            }
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.username = cleanUsername;
        user.password = hashedPassword;
        user.plainPassword = newPassword;
        await user.save();

        req.session.username = cleanUsername;

        res.redirect('/superadmin?msg=' + encodeURIComponent('Credentials updated successfully! Logged in as: ' + cleanUsername) + '&tab=settingsTab');
    } catch (err) {
        console.error("Superadmin change credentials error:", err);
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to update credentials: ' + err.message) + '&tab=settingsTab');
    }
});

app.post('/superadmin/approve/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Invalid User ID provided.') + '&tab=pendingTab');
        }
        await User.findByIdAndUpdate(req.params.id, {
            status: 'approved',
            approvedAt: new Date()
        });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        res.redirect('/superadmin?msg=' + encodeURIComponent('Account approved.') + '&tab=approvedTab');
    } catch (err) {
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to approve user: ' + err.message) + '&tab=pendingTab');
    }
});

app.post('/superadmin/suspend/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Invalid User ID provided.') + '&tab=approvedTab');
        }
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'suspended' });
        res.redirect('/superadmin?msg=' + encodeURIComponent(`Account for ${u ? u.username : 'admin'} and all linked staff members have been suspended.`) + '&tab=suspendedTab');
    } catch (err) {
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to suspend user: ' + err.message) + '&tab=approvedTab');
    }
});

app.post('/superadmin/resume/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Invalid User ID provided.') + '&tab=suspendedTab');
        }
        const u = await User.findByIdAndUpdate(req.params.id, { status: 'approved' });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'approved' });
        res.redirect('/superadmin?msg=' + encodeURIComponent(`Account for ${u ? u.username : 'admin'} and all linked staff members have been reactivated.`) + '&tab=approvedTab');
    } catch (err) {
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to resume user account: ' + err.message) + '&tab=suspendedTab');
    }
});

app.post('/superadmin/reject/:id', requireSuperAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/superadmin?error=' + encodeURIComponent('Invalid User ID provided.') + '&tab=pendingTab');
        }
        await User.findByIdAndUpdate(req.params.id, {
            status: 'rejected'
        });
        await User.updateMany({ role: 'staff', adminId: req.params.id }, { status: 'rejected' });
        res.redirect('/superadmin?msg=' + encodeURIComponent('Account request rejected.') + '&tab=rejectedTab');
    } catch (err) {
        res.redirect('/superadmin?error=' + encodeURIComponent('Failed to reject user: ' + err.message) + '&tab=pendingTab');
    }
});

app.get('/create-staff', (req, res) => res.redirect('/staff'));
app.get('/reset-staff-password', (req, res) => res.redirect('/staff'));

app.post('/create-staff', requireAdmin, async (req, res) => {
    try {
        const rawUsername = req.body.username ? req.body.username.trim() : '';
        if (!rawUsername || !req.body.password) {
            return res.redirect('/staff?error=' + encodeURIComponent('Username and Password are required.'));
        }

        // Quota check: Staff limit
        const adminUser = await User.findById(req.session.adminId);
        const maxStaff = adminUser ? (adminUser.maxStaffLimit ?? 5) : 5;
        if (maxStaff > 0) {
            const currentStaffCount = await User.countDocuments({ role: 'staff', adminId: req.session.adminId });
            if (currentStaffCount >= maxStaff) {
                return res.redirect('/staff?error=' + encodeURIComponent(`Staff limit reached (${currentStaffCount}/${maxStaff}). Contact Super Admin to upgrade your quota.`));
            }
        }
        const existingUser = await User.findOne({ username: new RegExp('^' + escapeRegExp(rawUsername) + '$', 'i') });
        if (existingUser) {
            return res.redirect('/staff?error=' + encodeURIComponent(`Username "${rawUsername}" is already taken.`));
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const dummyAnswer = await bcrypt.hash("admin-managed", 10);

        await User.create({
            username: rawUsername,
            password: hashedPassword,
            plainPassword: req.body.password,
            role: 'staff',
            status: 'approved',
            adminId: req.session.adminId,
            securityQuestion: "Managed by Admin?",
            securityAnswer: dummyAnswer
        });

        await logActivity(req, "Created Staff", `Created: ${rawUsername}`);
        res.redirect('/staff?msg=' + encodeURIComponent(`Staff account "${rawUsername}" created successfully.`));

    } catch (e) {
        console.error("Staff Creation Error: ", e);
        res.redirect('/staff?error=' + encodeURIComponent('Failed to create staff: ' + e.message));
    }
});

app.post('/reset-staff-password', requireAdmin, async (req, res) => {
    try {
        const { staffId, newPassword } = req.body;
        if (!staffId || !newPassword) return res.redirect('/staff?error=' + encodeURIComponent('Staff member and new password are required.'));
        if (!mongoose.Types.ObjectId.isValid(staffId)) return res.redirect('/staff?error=' + encodeURIComponent('Invalid Staff ID.'));

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const staff = await User.findOneAndUpdate(
            { _id: staffId, adminId: req.session.adminId },
            { password: hashedPassword, plainPassword: newPassword }
        );
        if (staff) await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
        res.redirect('/staff?msg=' + encodeURIComponent('Staff password reset successfully.'));
    } catch (err) {
        console.error("Staff Reset Error:", err);
        res.redirect('/staff?error=' + encodeURIComponent('Failed to reset staff password: ' + err.message));
    }
});

app.post('/reset-staff-password', requireAdmin, async (req, res) => {
    try {
        const { staffId, newPassword } = req.body;
        if (!staffId || !newPassword) return res.redirect('/staff?error=missing_fields');
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const staff = await User.findOneAndUpdate(
            { _id: staffId, adminId: req.session.adminId },
            { password: hashedPassword, plainPassword: newPassword }
        );
        if (staff) await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
        res.redirect('/staff');
    } catch (err) {
        console.error("Staff Reset Error:", err);
        res.status(500).send("Failed to reset staff password.");
    }
});

app.delete('/staff/:id', requireAdmin, async (req, res) => {
    try {
        const staff = await User.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
        if (staff) await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
        res.redirect('/staff');
    } catch (err) {
        console.error("Staff Delete Error:", err);
        res.status(500).send("Failed to delete staff.");
    }
});

// --- EXPORT (Perfectly Mapped & Styled to Tally Format) ---
app.get('/export', requireAdmin, async (req, res) => {
    try {
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const admin = await User.findById(req.session.adminId).lean();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sundry Debtors');

        // 1. Company Header Info
        worksheet.addRow([admin.companyName || '']);
        worksheet.addRow([admin.addressLine1 || '']);
        worksheet.addRow([admin.addressLine2 || '']);
        worksheet.addRow([admin.addressLine3 || '']);
        worksheet.addRow([admin.dlNo ? `DL NO. ${admin.dlNo}` : '']);
        worksheet.addRow([admin.msmeNo ? `MSME UDYAM REG NO. ${admin.msmeNo}` : '']);
        worksheet.addRow([admin.contactNo ? `CONTACT NO: ${admin.contactNo}` : '']);
        worksheet.addRow([admin.companyEmail ? `E-Mail : ${admin.companyEmail}` : '']);
        worksheet.addRow(['Sundry Debtors']);
        worksheet.addRow(['Group Outstandings']);

        const exportDate = new Date();
        const currentMonth = exportDate.getMonth();
        const startYear = currentMonth < 3 ? exportDate.getFullYear() - 1 : exportDate.getFullYear();
        const dateRange = `1-Apr-${startYear} to 31-Mar-${startYear + 1}`;
        worksheet.addRow([dateRange]);
        worksheet.addRow([]); // Blank row to separate header from table

        // 2. Table Headers (Spaced exactly for Tally Import)
        const headerRow1 = ['', '', '', 'Pending Bills', '', '(< 30 days )', '', '30 to 60 days', '', '60 to 90 days', '', '90 to 120 days', '', '120 to 150 days', '', '150 to 180 days', '', '(> 180 days )', '', 'On Account', ''];
        const headerRow2 = ['Party Name', 'Contact Person', 'Telephone No.', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'];

        const hr1 = worksheet.addRow(headerRow1);
        const hr2 = worksheet.addRow(headerRow2);

        // Merge parent headers so it spans across Debit & Credit (Looks professional)
        worksheet.mergeCells('D13:E13'); // Pending Bills
        worksheet.mergeCells('F13:G13'); // < 30 days
        worksheet.mergeCells('H13:I13'); // 30 to 60
        worksheet.mergeCells('J13:K13'); // 60 to 90
        worksheet.mergeCells('L13:M13'); // 90 to 120
        worksheet.mergeCells('N13:O13'); // 120 to 150
        worksheet.mergeCells('P13:Q13'); // 150 to 180
        worksheet.mergeCells('R13:S13'); // > 180
        worksheet.mergeCells('T13:U13'); // On Account

        // Style the Headers
        [hr1, hr2].forEach(row => {
            row.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FF000000' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
        });

        hr2.getCell(1).alignment = { horizontal: 'left' };
        hr2.getCell(2).alignment = { horizontal: 'left' };
        hr2.getCell(3).alignment = { horizontal: 'left' };

        // Set Column Widths
        worksheet.getColumn(1).width = 35; // Party Name
        worksheet.getColumn(2).width = 25; // Contact Person
        worksheet.getColumn(3).width = 15; // Telephone No.
        for (let i = 4; i <= 21; i++) worksheet.getColumn(i).width = 13;

        // 3. Add Customer Data
        customers.forEach((c) => {
            const aging = c.aging || {};
            const totalDue = (c.totalAmount || 0) - (c.paidAmount || 0);

            worksheet.addRow([
                c.companyName || '',
                c.contactPerson || '',
                c.phone ? String(c.phone) : '',
                totalDue > 0 ? totalDue : '', '',       // Pending Debit, Credit
                aging.under30 || '', '',                // < 30 Debit, Credit
                aging.days30to60 || '', '',             // 30-60 Debit, Credit
                aging.days60to90 || '', '',             // 60-90 Debit, Credit
                aging.days90to120 || '', '',            // 90-120 Debit, Credit
                aging.days120to150 || '', '',           // 120-150 Debit, Credit
                aging.days150to180 || '', '',           // 150-180 Debit, Credit
                aging.above180 || '', '',               // > 180 Debit, Credit
                aging.onAccount || '', ''               // On Account Debit, Credit
            ]);
        });

        // 4. Style Data Rows
        worksheet.eachRow((row, rowNumber) => {
            // Apply bolding to company details at the top
            if (rowNumber <= 11) {
                row.eachCell(cell => { cell.font = { bold: true }; });
            }
            // Align numbers to the right for the data rows
            if (rowNumber > 14) {
                for (let i = 4; i <= 21; i++) {
                    row.getCell(i).alignment = { horizontal: 'right' };
                }
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${admin.companyName || 'WGS'}_Sundry_Debtors.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).send("Failed to export Excel.");
    }
});

app.post('/import', upload.single('excelFile'), requireLogin, async (req, res) => {
    try {
        if (!req.file) return res.redirect('/');

        // Quota check: Customer / Party limit
        const adminUser = await User.findById(req.session.adminId);
        const maxCust = adminUser ? (adminUser.maxCustomersLimit ?? 500) : 500;
        if (maxCust > 0) {
            const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
            if (currentPartyCount >= maxCust) {
                return res.redirect('/?quota_error=1&msg=' + encodeURIComponent(`Party/Customer limit reached (${currentPartyCount}/${maxCust}). Contact Super Admin to upgrade your quota before importing.`));
            }
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        let importedCount = 0;
        let dataStartIndex = 0;

        for (let i = 0; i < rawData.length; i++) {
            const firstColumn = rawData[i][0] ? String(rawData[i][0]).trim().toLowerCase() : '';
            if (firstColumn === 'party name' || firstColumn === 'particulars') {
                dataStartIndex = i + 1;
                break;
            }
        }

        const bulkOps = [];

        for (let i = dataStartIndex; i < rawData.length; i++) {
            try {
                const row = rawData[i];
                if (!row || !Array.isArray(row)) continue;
                const partyName = row[0] ? String(row[0]).trim() : '';

                if (!partyName || partyName.toLowerCase() === 'grand total') continue;

                const cleanMoney = (val) => Number(String(val || '0').replace(/[^0-9.-]+/g, "")) || 0;
                const contactPerson = row[1] ? String(row[1]).trim() : '';
                const rawPhoneStr = row[2] ? String(row[2]).trim() : '';
                const phoneArray = rawPhoneStr.split(',').map(n => n.trim()).filter(n => n);
                let finalPhone = ''; let finalWhatsapp = ''; let finalOther = '';

                if (phoneArray.length > 0) {
                    const formatNum = (num) => {
                        let cleaned = num.replace(/[^0-9]/g, '');
                        if (cleaned.length === 10) return '91' + cleaned;
                        if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned;
                        return cleaned ? '91' + cleaned : '';
                    };
                    finalPhone = formatNum(phoneArray[0]); finalWhatsapp = finalPhone;
                    if (phoneArray.length > 1) { finalOther = phoneArray.slice(1).map(formatNum).join(', '); }
                }

                const totalPending = cleanMoney(row[3]);
                const agingData = {
                    under30: cleanMoney(row[5]),
                    days30to60: cleanMoney(row[7]),
                    days60to90: cleanMoney(row[9]),
                    days90to120: cleanMoney(row[11]),
                    days120to150: cleanMoney(row[13]),
                    days150to180: cleanMoney(row[15]),
                    above180: cleanMoney(row[17]),
                    onAccount: cleanMoney(row[19])
                };
                let nextAction = new Date();
                nextAction.setDate(nextAction.getDate() + 10);

                bulkOps.push({
                    updateOne: {
                        filter: { companyName: partyName, adminId: req.session.adminId },
                        update: {
                            $set: {
                                contactPerson: contactPerson,
                                phone: finalPhone,
                                whatsappNumber: finalWhatsapp,
                                otherNumbers: finalOther,
                                totalAmount: totalPending,
                                aging: agingData,
                                agingLastShifted: new Date()
                            },
                            $setOnInsert: { nextActionDate: nextAction }
                        },
                        upsert: true
                    }
                });
                importedCount++;
            } catch (rowErr) {
                console.warn(`Skipped invalid Excel row ${i}:`, rowErr.message);
            }
        }

        if (bulkOps.length > 0) {
            const adminUser = await User.findById(req.session.adminId);
            const maxCust = adminUser ? (adminUser.maxCustomersLimit ?? 500) : 500;
            if (maxCust > 0) {
                const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
                if (currentPartyCount + bulkOps.length > maxCust) {
                    return res.redirect('/?quota_error=1&msg=' + encodeURIComponent(`Importing ${bulkOps.length} parties exceeds your party limit (${currentPartyCount}/${maxCust}). Contact Super Admin to upgrade.`));
                }
            }
            await Customer.bulkWrite(bulkOps);
        }

        await logActivity(req, "Excel Import", `Imported ${importedCount} customers from Excel.`);
        res.redirect('/');
    } catch (err) {
        console.error("Import Error:", err);
        res.status(500).send("Import failed.");
    }
});

app.get('/customers/check-duplicate', requireLogin, async (req, res) => {
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

app.post('/customers', requireLogin, async (req, res) => {
    if (!req.session.userId || req.session.role === 'customer') return res.redirect('/login');
    try {
        // Quota check: Customer / Party limit
        const adminUser = await User.findById(req.session.adminId);
        const maxCust = adminUser ? (adminUser.maxCustomersLimit ?? 500) : 500;
        if (maxCust > 0) {
            const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
            if (currentPartyCount >= maxCust) {
                return res.redirect('/?quota_error=1&msg=' + encodeURIComponent(`Party limit reached (${currentPartyCount}/${maxCust}). Contact Super Admin to upgrade your quota.`));
            }
        }

        const totalAmt = parseFloat(req.body.totalAmount) || 0;
        const phoneCombined = (req.body.countryCode || '91') + (req.body.localPhone || '');
        const autoDate = new Date();
        autoDate.setDate(autoDate.getDate() + 10);

        const phoneDigits = phoneCombined.replace(/[^0-9]/g, '');
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
                return res.redirect('/?dup=1&dupname=' + encodeURIComponent(dupCheck.companyName));
            }
        }

        await Customer.create({
            companyName: req.body.companyName, contactPerson: req.body.contactPerson, email: req.body.email,
            phone: phoneCombined, whatsappNumber: req.body.whatsappNumber, totalAmount: totalAmt,
            adminId: req.session.adminId, nextActionDate: autoDate,
            agingLastShifted: new Date(),
            aging: { under30: totalAmt, days30to60: 0, days60to90: 0, days90to120: 0, days120to150: 0, days150to180: 0, above180: 0, onAccount: 0 }
        });

        await logActivity(req, "Added Party", `Created new party: ${req.body.companyName || 'Unknown Party'}`);
        res.redirect('/');
    } catch (err) { res.status(500).send("Error adding customer."); }
});

app.put('/customers/:id/edit', requireAdmin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.redirect('/');

        const oldDue = (Number(customer.totalAmount) || 0) - (Number(customer.paidAmount) || 0);
        customer.companyName = req.body.companyName;
        customer.contactPerson = req.body.contactPerson;
        customer.email = req.body.email;
        customer.phone = req.body.phone;
        customer.whatsappNumber = req.body.whatsappNumber;
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
        res.redirect('/');
    } catch (err) {
        console.error("Edit Error:", err);
        res.redirect('/');
    }
});

app.delete('/customers/:id', requireAdmin, async (req, res) => {
    try {
        const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
        if (customer) await logActivity(req, "Deleted Party", `Permanently deleted party: ${customer.companyName || 'Party'}`);
        res.redirect('/');
    } catch (err) {
        console.error("Delete customer error:", err);
        res.redirect('/?msg=error');
    }
});

app.put('/customers/:id/transaction', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).send("Customer not found.");

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

        res.redirect('/');
    } catch (err) { res.status(500).send("Error updating balance."); }
});

app.put('/customers/:id/update-reminder', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).send("Customer not found.");
        if (req.body.nextDate) {
            customer.nextActionDate = new Date(req.body.nextDate);
            await customer.save();
            await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName || 'Party'} set to ${req.body.nextDate}`);
        }
        res.redirect('/');
    } catch (err) {
        console.error("Update reminder error:", err);
        res.redirect('/?msg=error');
    }
});

app.post('/customers/bulk', requireAdmin, async (req, res) => {
    const body = req.body;
    const action = body.action;

    let ids = [];
    if (Array.isArray(body.customerIds)) ids = body.customerIds;
    else if (body.customerIds) ids = [body.customerIds];

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
    } catch (err) {
        console.error('Bulk delete error:', err);
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.json({ success: true });
    }
    res.redirect('/');
});

// JSON BACKUP FIXED: Forces file download instead of showing code on screen
app.get('/backup-data', requireAdmin, async (req, res) => {
    try {
        const adminUser = await User.findById(req.session.adminId).lean();
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const staff = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).lean();

        if (adminUser) delete adminUser.password;
        staff.forEach(s => delete s.password);

        const backup = {
            _meta: {
                appName: 'WGS Payment Manager',
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                adminId: req.session.adminId,
                totalParties: customers.length,
                totalStaff: staff.length,
                totalActivityLogs: activities.length
            },
            companyProfile: adminUser,
            customers,
            staff,
            activityLogs: activities
        };

        await logActivity(req, 'Backup Created', `Full data backup downloaded by ${req.session.username || 'Admin'}.`);
        res.setHeader('Content-disposition', `attachment; filename="WGS_Backup_${new Date().toISOString().slice(0, 10)}.json"`);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(backup, null, 2));
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ error: 'Backup failed' });
    }
});

app.post('/restore-backup', upload.single('backupFile'), requireAdmin, async (req, res) => {
    try {
        if (!req.file) return res.redirect('/?restoreError=nofile');

        let backup;
        try {
            backup = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (e) {
            return res.redirect('/?restoreError=invalid');
        }

        if (!backup._meta || !backup.customers) {
            return res.redirect('/?restoreError=invalid');
        }

        const adminId = req.session.adminId;
        const existingCustomers = await Customer.find({ adminId }).lean();

        try {
            if (Array.isArray(backup.customers)) {
                await Customer.deleteMany({ adminId });
                const toInsert = backup.customers.map(c => ({ ...c, adminId, _id: undefined }));
                if (toInsert.length > 0) await Customer.insertMany(toInsert, { ordered: false });
            }
        } catch (insertErr) {
            console.error("Local restore failed, rolling back:", insertErr);
            if (existingCustomers.length > 0) {
                await Customer.deleteMany({ adminId });
                await Customer.insertMany(existingCustomers, { ordered: false });
            }
            return res.redirect('/?restoreError=failed');
        }

        if (backup.companyProfile) {
            const p = backup.companyProfile;
            await User.findByIdAndUpdate(adminId, {
                companyName: p.companyName, addressLine1: p.addressLine1,
                addressLine2: p.addressLine2, addressLine3: p.addressLine3,
                dlNo: p.dlNo, msmeNo: p.msmeNo, contactNo: p.contactNo,
                companyEmail: p.companyEmail, bankName: p.bankName,
                accountName: p.accountName, accountNumber: p.accountNumber,
                ifscCode: p.ifscCode, upiDetails: p.upiDetails
            });
        }

        await logActivity(req, 'Backup Restored', `Data restored from backup file.`);
        res.redirect('/?restoreSuccess=1');
    } catch (err) {
        console.error('Restore error:', err);
        res.redirect('/?restoreError=failed');
    }
});

app.post('/change-password', requireLogin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.json({ success: false, error: 'All fields required' });
        if (newPassword.length < 6) return res.json({ success: false, error: 'Password must be at least 6 characters' });

        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, error: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.json({ success: false, error: 'Current password is incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        user.plainPassword = newPassword;
        await user.save();

        await logActivity(req, 'Password Changed', `Admin changed their login password.`);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Server error' });
    }
});

app.post('/clear-all-data', requireAdmin, async (req, res) => {
    try {
        const result = await Customer.deleteMany({ adminId: req.session.adminId });
        await logActivity(req, 'Data Cleared', `All party data permanently deleted (${result.deletedCount} parties removed).`);
        res.redirect('/');
    } catch (err) {
        res.status(500).send('Failed to clear data.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });