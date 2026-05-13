const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // Add this line
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');

const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const Customer = require('./models/Customer');
const User = require('./models/User');
const Activity = require('./models/Activity');

const app = express();

// --- DATABASE CONNECTION ---
const dbURI = 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

mongoose.connect(dbURI)
    .then(() => {
        console.log("✅ DB Connected Successfully");
        shiftAgingBuckets();
        setInterval(shiftAgingBuckets, 24 * 60 * 60 * 1000);
    })
    .catch(err => console.log("❌ DB Connection Error: ", err));

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.use(express.static('public', { dotfiles: 'allow' }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 100000 }));
app.use(express.json({ limit: '50mb' }));
app.use(methodOverride('_method'));
app.use(session({
    secret: 'secretkey', // Keep whatever secret you already have here
    resave: false,
    saveUninitialized: false,
    // Add the store configuration below:
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin', // Use your actual MongoDB connection string variable
        collectionName: 'sessions', // This will create a new collection in your DB called 'sessions'
        autoRemove: 'native' // Automatically deletes expired sessions
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // Sets session to expire in 1 day (optional)
    }
}));

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

const activitySchema = new mongoose.Schema({
    adminId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', activitySchema);

async function logActivity(req, action, details) {
    try {
        if (!req.session || !req.session.adminId) return;
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
const { google } = require('googleapis');

// Replace with your keys from Step 1
const oauth2Client = new google.auth.OAuth2(
    '636131280622-8ptviiun9hnh3538urpjfhio536as2fi.apps.googleusercontent.com',
    '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',
    'https://wgs-payment.onrender.com/auth/google/callback' // Update for production
);

// 1. Route to start Google Drive Connection
app.get('/auth/google', requireLogin, (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.file'] // Only gives access to files created by this app
    });
    res.redirect(url);
});

// 2. Google Callback (Saves the token)
app.get('/auth/google/callback', requireLogin, async (req, res) => {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);

    // Save this token to your User database so they don't have to login every time
    await User.findByIdAndUpdate(req.session.adminId, { googleDriveToken: tokens });
    res.redirect('/?driveConnected=true');
});

// 3. The "WhatsApp Style" Silent Backup Route
app.get('/drive-backup', requireLogin, async (req, res) => {
    try {
        const adminUser = await User.findById(req.session.adminId).lean();
        if (!adminUser.googleDriveToken) {
            return res.status(400).send("Google Drive not linked.");
        }

        oauth2Client.setCredentials(adminUser.googleDriveToken);
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // Gather all the data
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const backupData = JSON.stringify({ customers: customers, timestamp: new Date() });

        // Upload directly to Google Drive
        const fileMetadata = {
            name: `WGS_Backup_${new Date().toISOString().slice(0, 10)}.json`,
            parents: ['appDataFolder'] // This hides the file from the user's main drive, just like WhatsApp!
        };
        const media = {
            mimeType: 'application/json',
            body: backupData
        };

        await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        res.json({ success: true, message: "Backed up to Google Drive successfully!" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Drive Backup Failed" });
    }
});
// ========================================================
// AGING BUCKET AUTO-SHIFT
// Every 30 days amounts move: under30 -> 30_60 -> 60_90...
// Tracked per customer via agingLastShifted field
// ========================================================
async function shiftAgingBuckets() {
    try {
        console.log("Running daily aging bucket shift...");
        const customers = await Customer.find({});
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let shiftedCount = 0;

        for (const cust of customers) {
            if (!cust.aging) continue;

            const lastShifted = cust.agingLastShifted ? new Date(cust.agingLastShifted) : null;
            if (!lastShifted) {
                cust.agingLastShifted = today;
                await cust.save();
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
                ag.above180    += ag.days150to180;
                ag.days150to180 = ag.days120to150;
                ag.days120to150 = ag.days90to120;
                ag.days90to120  = ag.days60to90;
                ag.days60to90   = ag.days30to60;
                ag.days30to60   = ag.under30;
                ag.under30      = 0;
            }

            cust.aging.under30      = ag.under30;
            cust.aging.days30to60   = ag.days30to60;
            cust.aging.days60to90   = ag.days60to90;
            cust.aging.days90to120  = ag.days90to120;
            cust.aging.days120to150 = ag.days120to150;
            cust.aging.days150to180 = ag.days150to180;
            cust.aging.above180     = ag.above180;
            cust.markModified('aging');

            const newLastShifted = new Date(lastShifted);
            newLastShifted.setDate(newLastShifted.getDate() + (periods * 30));
            cust.agingLastShifted = newLastShifted;

            await cust.save();
            shiftedCount++;
        }

        console.log(`Aging shift complete. Shifted ${shiftedCount} customers.`);
    } catch (err) {
        console.error("Aging shift error:", err.message);
    }
}

// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    try {
        if (req.body.type === 'customer') {
            const phoneRaw = req.body.phone.replace(/[^0-9]/g, '');
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

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            req.session.userId = user._id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.adminId = user.role === 'admin' ? user._id : user.adminId;
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
    const { username, securityQuestion, securityAnswer, newPassword } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.render('forgot', { error: "Username not found" });
    if (user.securityQuestion !== securityQuestion) return res.render('forgot', { error: "Wrong Security Question" });
    const isMatch = await bcrypt.compare(securityAnswer, user.securityAnswer);
    if (!isMatch) return res.render('forgot', { error: "Wrong Security Answer" });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    res.redirect('/login');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/customers/:id/auto-snooze', async (req, res) => {
    try {
        const customer = await Customer.findById(req.params.id);
        if (customer) {
            const newDate = new Date();
            newDate.setDate(newDate.getDate() + 10);
            customer.nextActionDate = newDate;
            await customer.save();
            await ActivityLog.create({
                adminId: req.session.adminId,
                userId: req.session.userId,
                username: req.session.role ? req.session.role.toUpperCase() : 'USER',
                action: "Reminder Sent",
                details: `Sent payment reminder to ${customer.companyName || 'Party'}. Auto-snoozed for 10 days.`
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

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

        // --- Pre-compute all dashboard stats so EJS has zero logic ---
        let totalPending = 0, actionRequiredCount = 0;
        let b_u30=0, b_30_60=0, b_60_90=0, b_90_120=0;
        let b_120_150=0, b_150_180=0, b_a180=0, b_onAcc=0;
        let cnt_u30=0, cnt_30_60=0, cnt_60_90=0, cnt_90_120=0;
        let cnt_120_150=0, cnt_150_180=0, cnt_a180=0, cnt_onAcc=0;

        const today = new Date(); today.setHours(0,0,0,0);

        for (const c of finalCustomers) {
            const due = (c.totalAmount || 0) - (c.paidAmount || 0);
            totalPending += due;

            if (c.nextActionDate) {
                const nd = new Date(c.nextActionDate); nd.setHours(0,0,0,0);
                if (due > 0 && today >= nd) actionRequiredCount++;
            } else if (due > 0) {
                actionRequiredCount++;
            }

            const ag = c.aging || {};
            b_u30     += ag.under30     || 0;
            b_30_60   += ag.days30to60  || 0;
            b_60_90   += ag.days60to90  || 0;
            b_90_120  += ag.days90to120 || 0;
            b_120_150 += ag.days120to150|| 0;
            b_150_180 += ag.days150to180|| 0;
            b_a180    += ag.above180    || 0;
            b_onAcc   += ag.onAccount   || 0;

            if ((ag.under30     || 0) > 0) cnt_u30++;
            if ((ag.days30to60  || 0) > 0) cnt_30_60++;
            if ((ag.days60to90  || 0) > 0) cnt_60_90++;
            if ((ag.days90to120 || 0) > 0) cnt_90_120++;
            if ((ag.days120to150|| 0) > 0) cnt_120_150++;
            if ((ag.days150to180|| 0) > 0) cnt_150_180++;
            if ((ag.above180    || 0) > 0) cnt_a180++;
            if ((ag.onAccount   || 0) > 0) cnt_onAcc++;
        }

        const maxBucket = Math.max(b_u30, b_30_60, b_60_90, b_90_120, b_120_150, b_150_180, b_a180) || 1;

        const fmtINR = (n) => '₹ ' + Number(n).toLocaleString('en-IN');

        const stats = {
            totalPending, actionRequiredCount,
            totalParties: finalCustomers.length,
            buckets: {
                u30:     { amt: b_u30,     fmt: fmtINR(b_u30),     cnt: cnt_u30,     pct: Math.round((b_u30/maxBucket)*100)     },
                d30_60:  { amt: b_30_60,   fmt: fmtINR(b_30_60),   cnt: cnt_30_60,   pct: Math.round((b_30_60/maxBucket)*100)   },
                d60_90:  { amt: b_60_90,   fmt: fmtINR(b_60_90),   cnt: cnt_60_90,   pct: Math.round((b_60_90/maxBucket)*100)   },
                d90_120: { amt: b_90_120,  fmt: fmtINR(b_90_120),  cnt: cnt_90_120,  pct: Math.round((b_90_120/maxBucket)*100)  },
                d120_150:{ amt: b_120_150, fmt: fmtINR(b_120_150), cnt: cnt_120_150, pct: Math.round((b_120_150/maxBucket)*100) },
                d150_180:{ amt: b_150_180, fmt: fmtINR(b_150_180), cnt: cnt_150_180, pct: Math.round((b_150_180/maxBucket)*100) },
                a180:    { amt: b_a180,    fmt: fmtINR(b_a180),    cnt: cnt_a180,    pct: Math.round((b_a180/maxBucket)*100)    },
                onAcc:   { amt: b_onAcc,   fmt: fmtINR(b_onAcc),   cnt: cnt_onAcc,   pct: 0                                     }
            },
            totalPendingFmt: fmtINR(totalPending)
        };

        res.render('index', {
            customers: finalCustomers,
            role: req.session.role,
            adminUser: adminUser,
            stats: stats
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send("Error loading dashboard.");
    }
});

// 3. ADMIN PAGES
app.get('/staff', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    try {
        const myStaff = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        res.render('staff', { staffMembers: myStaff, role: req.session.role });
    } catch (error) { res.status(500).send("Error loading staff."); }
});

app.get('/activity', requireLogin, async (req, res) => {
    try {
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).lean();
        res.render('activity', { activities: activities, role: req.session.role });
    } catch (err) { res.status(500).send("Error loading activity."); }
});

app.post('/activity/delete-bulk', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    try {
        const { filterType, startDate, endDate } = req.body;
        let query = { adminId: req.session.adminId };
        const now = new Date();
        if (filterType === 'older_than_30') {
            query.createdAt = { $lt: new Date(now.setDate(now.getDate() - 30)) };
        } else if (filterType === 'last_30') {
            query.createdAt = { $gte: new Date(now.setDate(now.getDate() - 30)) };
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

app.put('/settings', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    await User.findByIdAndUpdate(req.session.adminId, {
        companyName: req.body.companyName, addressLine1: req.body.addressLine1, addressLine2: req.body.addressLine2,
        addressLine3: req.body.addressLine3, dlNo: req.body.dlNo, msmeNo: req.body.msmeNo,
        contactNo: req.body.contactNo, companyEmail: req.body.companyEmail,
        bankName: req.body.bankName, accountName: req.body.accountName,
        accountNumber: req.body.accountNumber, ifscCode: req.body.ifscCode, upiDetails: req.body.upiDetails
    });
    await logActivity(req, "Company Profile", "Updated company profile and bank details.");
    res.redirect('/');
});

app.get('/register', (req, res) => { res.render('register'); });
app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const hashedAnswer = await bcrypt.hash(req.body.securityAnswer, 10);
        await User.create({
            username: req.body.username, password: hashedPassword, role: 'admin',
            securityQuestion: req.body.securityQuestion, securityAnswer: hashedAnswer
        });
        res.redirect('/login');
    } catch (e) { res.send("Error: " + e.message); }
});

app.post('/create-staff', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    try {
        // 1. Clean up the username (remove accidental spaces)
        const rawUsername = req.body.username.trim();

        // 2. Check if the username already exists (case-insensitive)
        const existingUser = await User.findOne({ username: new RegExp('^' + rawUsername + '$', 'i') });
        if (existingUser) {
            return res.send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h2 style="color: #ef4444;">Username Already Taken</h2>
                    <p>The username <strong>"${rawUsername}"</strong> is already in use.</p>
                    <button onclick="window.history.back()" style="padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 8px; cursor: pointer;">Go Back and Try Another</button>
                </div>
            `);
        }

        // 3. Create the staff member
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const dummyAnswer = await bcrypt.hash("admin-managed", 10);

        await User.create({
            username: rawUsername,
            password: hashedPassword,
            role: 'staff',
            adminId: req.session.adminId,
            securityQuestion: "Managed by Admin?",
            securityAnswer: dummyAnswer
        });

        await logActivity(req, "Created Staff", `Created: ${rawUsername}`);
        res.redirect('/staff');

    } catch (e) {
        console.error("Staff Creation Error: ", e);
        res.send("Failed to create staff. Error: " + e.message);
    }
});

app.post('/reset-staff-password', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const { staffId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const staff = await User.findOneAndUpdate({ _id: staffId, adminId: req.session.adminId }, { password: hashedPassword });
    if (staff) await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
    res.redirect('/staff');
});

app.delete('/staff/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const staff = await User.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
    if (staff) await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
    res.redirect('/staff');
});

// --- EXPORT ---
app.get('/export', requireLogin, async (req, res) => {
    try {
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const admin = await User.findById(req.session.adminId).lean();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sundry Debtors');

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
        const endYear = startYear + 1;
        const dateRange = `1-Apr-${startYear} to 31-Mar-${endYear}`;
        worksheet.addRow([dateRange]);

        const compName = admin.companyName || 'Company';
        worksheet.addRow(['', '', '', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', '', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors']);
        worksheet.addRow(['', '', '', compName, compName, compName, '', compName, compName, compName, compName, compName, compName]);
        worksheet.addRow(['Party Name', 'Company Name', 'Telephone No.', dateRange, dateRange, dateRange, '', dateRange, dateRange, dateRange, dateRange, dateRange, dateRange]);
        worksheet.addRow(['', '', '', 'Pending Bills', '(< 30 days )', '30 to 60 days', '', '60 to 90 days', '90 to 120 days', '120 to 150 days', '150 to 180 days', '(> 180 days )', 'On Account']);
        worksheet.addRow(['', '', '', 'Debit', 'Debit', 'Debit', 'Credit', 'Debit', 'Debit', 'Debit', 'Debit', 'Debit', 'Debit']);
        worksheet.addRow([]);

        worksheet.getColumn(1).width = 35; worksheet.getColumn(2).width = 25; worksheet.getColumn(3).width = 15;
        for (let i = 4; i <= 13; i++) worksheet.getColumn(i).width = 15;

        customers.forEach((c) => {
            const aging = c.aging || {};
            const totalDue = (c.totalAmount || 0) - (c.paidAmount || 0);
            worksheet.addRow([
                c.companyName || '', c.contactPerson || '', c.phone ? String(c.phone) : '',
                totalDue > 0 ? totalDue : 0,
                aging.under30 || '', aging.days30to60 || '', '',
                aging.days60to90 || '', aging.days90to120 || '', aging.days120to150 || '',
                aging.days150to180 || '', aging.above180 || '', aging.onAccount || ''
            ]);
        });

        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell, colNumber) => {
                cell.font = { color: { argb: 'FF000000' } };
                if (rowNumber <= 11 || (rowNumber >= 12 && rowNumber <= 16)) { cell.font = { bold: true, color: { argb: 'FF000000' } }; }
                if (rowNumber > 17 && colNumber > 3) { cell.alignment = { horizontal: 'right' }; } else { cell.alignment = { horizontal: 'left' }; }
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Sundry_Debtors_Export.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) { res.status(500).send("Failed to export Excel."); }
});

// --- SMART IMPORT (Optimized with BulkWrite) ---
// --- SMART IMPORT (Optimized with BulkWrite & Corrected Tally Columns) ---
app.post('/import', upload.single('excelFile'), requireLogin, async (req, res) => {
    try {
        if (!req.file) return res.redirect('/');
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        let importedCount = 0;
        let dataStartIndex = 0;

        // Find where the actual data starts
        for (let i = 0; i < rawData.length; i++) {
            const firstColumn = rawData[i][0] ? String(rawData[i][0]).trim().toLowerCase() : '';
            if (firstColumn === 'party name' || firstColumn === 'particulars') {
                dataStartIndex = i + 1;
                break;
            }
        }

        const bulkOps = [];

        for (let i = dataStartIndex; i < rawData.length; i++) {
            const row = rawData[i];
            const partyName = row[0] ? String(row[0]).trim() : '';

            // Skip empty rows and grand totals
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

            const totalPending = cleanMoney(row[3]); // Column D (Pending Bills Debit)

            // CORRECTED MAPPING: Tally exports have "Debit" and "Credit" sub-columns for every bucket.
            // This means the data is spaced out by 2 columns (index 5, 7, 9, 11, etc.)
            const agingData = {
                under30: cleanMoney(row[5]),       // < 30 days (Debit)
                days30to60: cleanMoney(row[7]),    // 30 to 60 days (Debit)
                days60to90: cleanMoney(row[9]),    // 60 to 90 days (Debit)
                days90to120: cleanMoney(row[11]),  // 90 to 120 days (Debit)
                days120to150: cleanMoney(row[13]), // 120 to 150 days (Debit)
                days150to180: cleanMoney(row[15]), // 150 to 180 days (Debit)
                above180: cleanMoney(row[17]),     // > 180 days (Debit)
                onAccount: cleanMoney(row[19])     // On Account (Debit)
            };

            let nextAction = new Date();
            nextAction.setDate(nextAction.getDate() + 10);

            // Using BulkWrite for instant uploading
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
        }

        // Send all 300+ records to the database instantly
        if (bulkOps.length > 0) {
            await Customer.bulkWrite(bulkOps);
        }

        await logActivity(req, "Excel Import", `Imported ${importedCount} customers from Excel.`);
        res.redirect('/');
    } catch (err) {
        console.error("Import Error:", err);
        res.status(500).send("Import failed.");
    }
});

// --- DUPLICATE CHECK API ---
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

app.post('/customers', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const totalAmt = parseFloat(req.body.totalAmount) || 0;
        const phoneCombined = (req.body.countryCode || '91') + (req.body.localPhone || '');
        const autoDate = new Date();
        autoDate.setDate(autoDate.getDate() + 10);

        // Server-side duplicate guard
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

app.put('/customers/:id/edit', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
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

app.delete('/customers/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });
    if (customer) await logActivity(req, "Deleted Party", `Permanently deleted party: ${customer.companyName || 'Party'}`);
    res.redirect('/');
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
    const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
    if (!customer) return res.status(404).send("Customer not found.");
    customer.nextActionDate = new Date(req.body.nextDate);
    await customer.save();
    await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName || 'Party'} set to ${req.body.nextDate}`);
    res.redirect('/');
});

app.post('/customers/bulk', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");

    // Accept both JSON (fetch) and urlencoded (form) bodies
    const body = req.body;
    const action = body.action;

    let ids = [];
    // JSON body sends { customerIds: [...] }
    if (Array.isArray(body.customerIds)) ids = body.customerIds;
    else if (body.customerIds) ids = [body.customerIds];

    // "delete-all" action ignores IDs and deletes everything for this admin
    try {
        if (action === 'delete-all') {
            const result = await Customer.deleteMany({ adminId: req.session.adminId });
            await logActivity(req, "Bulk Delete", `Deleted ALL ${result.deletedCount} parties.`);
        } else if (action === 'delete' && ids.length > 0) {
            // Process in chunks of 500 to avoid any MongoDB document limit issues
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
        // If JSON request, return JSON error
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    // If JSON request (fetch), return JSON success
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.json({ success: true });
    }
    res.redirect('/');
});

// ============================================================
// BACKUP — full JSON download of all admin data
// ============================================================
app.get('/backup-data', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    try {
        const adminUser  = await User.findById(req.session.adminId).lean();
        const customers  = await Customer.find({ adminId: req.session.adminId }).lean();
        const staff      = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).lean();

        // Redact password hashes from backup for safety
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
        res.json(backup);
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ error: 'Backup failed' });
    }
});

// ============================================================
// BACKUP — Excel format download
// ============================================================
app.get('/backup-data-excel', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send('Unauthorized');
    try {
        const customers  = await Customer.find({ adminId: req.session.adminId }).lean();
        const staff      = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).lean();
        const adminUser  = await User.findById(req.session.adminId).lean();

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WGS Payment Manager';

        // Sheet 1 — Parties
        const partiesSheet = workbook.addWorksheet('Parties');
        partiesSheet.columns = [
            { header: 'Company Name', key: 'companyName', width: 30 },
            { header: 'Contact Person', key: 'contactPerson', width: 20 },
            { header: 'Phone', key: 'phone', width: 18 },
            { header: 'WhatsApp', key: 'whatsappNumber', width: 18 },
            { header: 'Email', key: 'email', width: 25 },
            { header: 'Total Amount', key: 'totalAmount', width: 15 },
            { header: 'Paid Amount', key: 'paidAmount', width: 15 },
            { header: 'Due Amount', key: 'dueAmount', width: 15 },
            { header: '<30 Days', key: 'under30', width: 13 },
            { header: '30-60 Days', key: 'days30to60', width: 13 },
            { header: '60-90 Days', key: 'days60to90', width: 13 },
            { header: '90-120 Days', key: 'days90to120', width: 13 },
            { header: '120-150 Days', key: 'days120to150', width: 14 },
            { header: '150-180 Days', key: 'days150to180', width: 14 },
            { header: '>180 Days', key: 'above180', width: 13 },
            { header: 'On Account', key: 'onAccount', width: 13 },
            { header: 'Last Payment Date', key: 'lastPaymentDate', width: 20 },
            { header: 'Next Action Date', key: 'nextActionDate', width: 20 },
        ];
        partiesSheet.getRow(1).font = { bold: true };
        customers.forEach(c => {
            partiesSheet.addRow({
                companyName: c.companyName || '',
                contactPerson: c.contactPerson || '',
                phone: c.phone || '',
                whatsappNumber: c.whatsappNumber || '',
                email: c.email || '',
                totalAmount: c.totalAmount || 0,
                paidAmount: c.paidAmount || 0,
                dueAmount: (c.totalAmount || 0) - (c.paidAmount || 0),
                under30: c.aging?.under30 || 0,
                days30to60: c.aging?.days30to60 || 0,
                days60to90: c.aging?.days60to90 || 0,
                days90to120: c.aging?.days90to120 || 0,
                days120to150: c.aging?.days120to150 || 0,
                days150to180: c.aging?.days150to180 || 0,
                above180: c.aging?.above180 || 0,
                onAccount: c.aging?.onAccount || 0,
                lastPaymentDate: c.lastPaymentDate ? new Date(c.lastPaymentDate).toLocaleDateString('en-IN') : '',
                nextActionDate: c.nextActionDate ? new Date(c.nextActionDate).toLocaleDateString('en-IN') : '',
            });
        });

        // Sheet 2 — Staff
        const staffSheet = workbook.addWorksheet('Staff');
        staffSheet.columns = [
            { header: 'Username', key: 'username', width: 20 },
            { header: 'Role', key: 'role', width: 12 },
        ];
        staffSheet.getRow(1).font = { bold: true };
        staff.forEach(s => staffSheet.addRow({ username: s.username, role: s.role }));

        // Sheet 3 — Activity Logs
        const actSheet = workbook.addWorksheet('Activity Logs');
        actSheet.columns = [
            { header: 'Date & Time', key: 'date', width: 22 },
            { header: 'User', key: 'username', width: 18 },
            { header: 'Action', key: 'action', width: 22 },
            { header: 'Details', key: 'details', width: 50 },
        ];
        actSheet.getRow(1).font = { bold: true };
        activities.forEach(a => {
            actSheet.addRow({
                date: a.createdAt ? new Date(a.createdAt).toLocaleString('en-IN') : '',
                username: a.username || '',
                action: a.action || '',
                details: a.details || '',
            });
        });

        // Sheet 4 — Company Profile
        const profileSheet = workbook.addWorksheet('Company Profile');
        if (adminUser) {
            [
                ['Company Name', adminUser.companyName],
                ['Address Line 1', adminUser.addressLine1],
                ['Address Line 2', adminUser.addressLine2],
                ['Address Line 3', adminUser.addressLine3],
                ['DL No.', adminUser.dlNo],
                ['MSME No.', adminUser.msmeNo],
                ['Contact No.', adminUser.contactNo],
                ['Email', adminUser.companyEmail],
                ['Bank Name', adminUser.bankName],
                ['Account Name', adminUser.accountName],
                ['Account Number', adminUser.accountNumber],
                ['IFSC Code', adminUser.ifscCode],
                ['UPI Details', adminUser.upiDetails],
            ].forEach(row => profileSheet.addRow(row));
        }

        await logActivity(req, 'Backup Created (Excel)', `Excel backup downloaded by ${req.session.username || 'Admin'}.`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="WGS_Backup_${new Date().toISOString().slice(0,10)}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Excel backup error:', err);
        res.status(500).send('Excel backup failed.');
    }
});

// ============================================================
// RESTORE — upload JSON backup and restore all data
// ============================================================
app.post('/restore-backup', upload.single('backupFile'), requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send('Unauthorized');
    try {
        if (!req.file) return res.redirect('/?restoreError=nofile');

        let backup;
        try {
            backup = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (e) {
            return res.redirect('/?restoreError=invalid');
        }

        // Validate it's our backup format
        if (!backup._meta || !backup.customers) {
            return res.redirect('/?restoreError=invalid');
        }

        const adminId = req.session.adminId;

        // Restore customers — upsert by companyName
        if (Array.isArray(backup.customers)) {
            // Delete existing, then re-insert
            await Customer.deleteMany({ adminId });
            const toInsert = backup.customers.map(c => ({ ...c, adminId, _id: undefined }));
            if (toInsert.length > 0) await Customer.insertMany(toInsert, { ordered: false });
        }

        // Restore company profile fields (not password)
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

        await logActivity(req, 'Backup Restored', `Data restored from backup file (${backup.customers.length} parties, exported ${backup._meta.exportedAt || 'unknown date'}).`);
        res.redirect('/?restoreSuccess=1');
    } catch (err) {
        console.error('Restore error:', err);
        res.redirect('/?restoreError=failed');
    }
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
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
        await user.save();

        await logActivity(req, 'Password Changed', `Admin changed their login password.`);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Server error' });
    }
});

// ============================================================
// CLEAR ALL PARTY DATA (Danger Zone)
// ============================================================
app.post('/clear-all-data', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send('Unauthorized');
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
