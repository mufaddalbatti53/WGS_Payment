const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');

// Add this near the top of server.js
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // Stores uploaded files in RAM safely

const Customer = require('./models/Customer');
const User = require('./models/User');
const Activity = require('./models/Activity');

const app = express();

// --- DATABASE CONNECTION ---
const dbURI = 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

mongoose.connect(dbURI)
    .then(() => console.log("✅ DB Connected Successfully"))
    .catch(err => console.log("❌ DB Connection Error: ", err));

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.use(express.static('public', { dotfiles: 'allow' }));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(session({ secret: 'secretKey', resave: false, saveUninitialized: false }));

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

// --- ROUTES ---

// Activity Log Schema
const activitySchema = new mongoose.Schema({
    adminId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', activitySchema);

// --- MASTER TRACKING FUNCTION ---
async function logActivity(req, action, details) {
    console.log(`\n▶️ [ACTIVITY TRIGGERED] Attempting to log: "${action}"`);
    try {
        if (!req.session) {
            console.log("❌ [ACTIVITY FAILED] Reason: No session found.");
            return;
        }
        if (!req.session.adminId) {
            console.log("❌ [ACTIVITY FAILED] Reason: req.session.adminId is missing.");
            return;
        }

        await ActivityLog.create({
            adminId: req.session.adminId,
            userId: req.session.userId || req.session.adminId,
            username: req.session.username || 'Admin',
            action: action,
            details: details
        });

        console.log("✅ [ACTIVITY SUCCESS] Successfully saved to database!\n");
    } catch (err) {
        console.error("❌ [ACTIVITY DATABASE ERROR] Here is why it crashed:", err.message, "\n");
    }
}

// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    try {
        if (req.body.type === 'customer') {
            const phoneRaw = req.body.phone.replace(/[^0-9]/g, '');

            // 🚨 FIX: Sort by -1 to guarantee we grab the NEWEST Excel import for this phone
            const customer = await Customer.findOne({
                phone: { $regex: new RegExp(phoneRaw + '$') }
            }).sort({ _id: -1 });

            if (!customer) {
                return res.render('login', { error: "No account found with this phone number." });
            }

            // 🚨 FIX: Store the phone number in the session!
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
            req.session.adminId = user.role === 'admin' ? user._id : user.adminId;
            return res.redirect('/');
        } else {
            return res.render('login', { error: "Invalid username or password." });
        }
    } catch (error) {
        console.error("Login Error:", error);
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

// 🚨 NEW ENDPOINT: Triggered when WhatsApp/SMS/Email is clicked
app.post('/customers/:id/auto-snooze', async (req, res) => {
    try {
        const customer = await Customer.findById(req.params.id);
        if (customer) {
            const newDate = new Date();
            newDate.setDate(newDate.getDate() + 10); // Add 10 days automatically
            customer.nextActionDate = newDate;
            await customer.save();

            // Log this action so you know who sent the reminder
            const Activity = require('./models/Activity');
            await Activity.create({
                adminId: req.session.adminId,
                userId: req.session.userId,
                username: req.session.role.toUpperCase(),
                action: "Reminder Sent",
                details: `Sent payment reminder to ${customer.companyName}. Auto-snoozed for 10 days.`
            });
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Auto-Snooze Error:", err);
        res.status(500).json({ success: false });
    }
});

// 🚨 UPDATED DASHBOARD (Removed the blind midnight auto-rollover)
app.get('/', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        let finalCustomers = [];

        if (req.session.role === 'customer') {
            // 🚨 FIX: Always fetch the customer by Phone so it survives Excel re-imports!
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

        res.render('index', {
            customers: finalCustomers,
            role: req.session.role,
            adminUser: adminUser
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Error loading dashboard.");
    }
});

// 3. ADMIN PAGES
app.get('/staff', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') {
        return res.status(403).send("Unauthorized. Only Admins can view this page.");
    }
    try {
        const myStaff = await User.find({
            role: 'staff',
            adminId: req.session.adminId
        }).lean();
        res.render('staff', { staffMembers: myStaff, role: req.session.role });
    } catch (error) {
        console.error("Error loading staff list:", error);
        res.status(500).send("Error loading staff list.");
    }
});

app.get('/activity', requireLogin, async (req, res) => {
    try {
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).lean();
        res.render('activity', {
            activities: activities,
            role: req.session.role
        });
    } catch (err) {
        console.error("Activity Load Error:", err);
        res.status(500).send("Error loading activity log.");
    }
});

app.post('/activity/delete-bulk', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
    try {
        const { filterType, startDate, endDate } = req.body;
        let query = { adminId: req.session.adminId };
        const now = new Date();

        if (filterType === 'older_than_30') {
            const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
            query.createdAt = { $lt: thirtyDaysAgo };
        }
        else if (filterType === 'last_30') {
            const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
            query.createdAt = { $gte: thirtyDaysAgo };
        }
        else if (filterType === 'custom' && startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }

        await ActivityLog.deleteMany(query);
        res.redirect('/activity');
    } catch (err) {
        console.error("Bulk Delete Error:", err);
        res.status(500).send("Failed to delete logs.");
    }
});

// --- UPDATE COMPANY PROFILE ---
app.put('/settings', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");

    await User.findByIdAndUpdate(req.session.adminId, {
        companyName: req.body.companyName,
        addressLine1: req.body.addressLine1,
        addressLine2: req.body.addressLine2,
        addressLine3: req.body.addressLine3,
        dlNo: req.body.dlNo,
        msmeNo: req.body.msmeNo,
        contactNo: req.body.contactNo,
        companyEmail: req.body.companyEmail
    });

    await logActivity(req, "Company Profile", "Updated company profile details.");
    res.redirect('/');
});

// 4. ADMIN ACTIONS (Staff Management)
app.get('/register', (req, res) => { res.render('register'); });

app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const hashedAnswer = await bcrypt.hash(req.body.securityAnswer, 10);
        await User.create({
            username: req.body.username,
            password: hashedPassword,
            role: 'admin',
            securityQuestion: req.body.securityQuestion,
            securityAnswer: hashedAnswer
        });
        res.redirect('/login');
    } catch (e) { res.send("Error: " + e.message); }
});

app.post('/create-staff', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const dummyAnswer = await bcrypt.hash("admin-managed", 10);

        await User.create({
            username: req.body.username,
            password: hashedPassword,
            role: 'staff',
            adminId: req.session.adminId,
            securityQuestion: "Managed by Admin?",
            securityAnswer: dummyAnswer
        });

        await logActivity(req, "Created Staff", `Created: ${req.body.username}`);
        res.redirect('/staff');
    } catch (e) {
        console.error("Staff Creation Error:", e);
        if (e.code === 11000) {
            res.send("That exact username is already in use. Please go back and type a different one (like 'john_staff').");
        } else {
            res.send("Failed to create staff. Error: " + e.message);
        }
    }
});

app.post('/reset-staff-password', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const { staffId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const staff = await User.findOneAndUpdate(
        { _id: staffId, adminId: req.session.adminId },
        { password: hashedPassword }
    );

    if (staff) {
        await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
    }
    res.redirect('/staff');
});

app.delete('/staff/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    const staff = await User.findOneAndDelete({
        _id: req.params.id,
        adminId: req.session.adminId
    });

    if (staff) {
        await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
    }
    res.redirect('/staff');
});

// --- EXPORT TO EXCEL ROUTE (DYNAMIC & B&W) ---
app.get('/export', requireLogin, async (req, res) => {
    try {
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();

        // Grab the Admin's specific company details
        const admin = await User.findById(req.session.adminId).lean();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sundry Debtors');

        // 1. Dynamic Top Section (Will be blank if Admin skipped the form)
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

        const currentYear = new Date().getFullYear();
        const dateRange = `1-Apr-${currentYear - 1} to 31-Mar-${currentYear}`;
        worksheet.addRow([dateRange]);

        const compName = admin.companyName || 'Company';

        // 2. The Multi-Layered Headers
        worksheet.addRow(['', '', '', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', '', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors', 'Sundry Debtors']);
        worksheet.addRow(['', '', '', compName, compName, compName, '', compName, compName, compName, compName, compName, compName]);
        worksheet.addRow(['Particulars', 'Contact Person', 'Telephone No.', dateRange, dateRange, dateRange, '', dateRange, dateRange, dateRange, dateRange, dateRange, dateRange]);
        worksheet.addRow(['', '', '', 'Pending Bills', '(< 30 days )', '30 to 60 days', '', '60 to 90 days', '90 to 120 days', '120 to 150 days', '150 to 180 days', '(> 180 days )', 'On Account']);
        worksheet.addRow(['', '', '', 'Debit', 'Debit', 'Debit', 'Credit', 'Debit', 'Debit', 'Debit', 'Debit', 'Debit', 'Debit']);
        worksheet.addRow([]);

        worksheet.getColumn(1).width = 35;
        worksheet.getColumn(2).width = 25;
        worksheet.getColumn(3).width = 15;
        for (let i = 4; i <= 13; i++) worksheet.getColumn(i).width = 15;

        // Populate Rows
        customers.forEach((c) => {
            const aging = c.aging || {};
            worksheet.addRow([
                c.companyName || '', c.contactPerson || '', c.phone ? String(c.phone) : '',
                c.totalAmount || 0, aging.under30 || '', aging.days30to60 || '', '',
                aging.days60to90 || '', aging.days90to120 || '', aging.days120to150 || '',
                aging.days150to180 || '', aging.above180 || '', aging.onAccount || ''
            ]);
        });

        // 3. Black and White Styling
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell, colNumber) => {
                cell.font = { color: { argb: 'FF000000' } }; // Pure Black Text

                // Bold the Company header info and Table Headers
                if (rowNumber <= 11 || (rowNumber >= 12 && rowNumber <= 16)) {
                    cell.font = { bold: true, color: { argb: 'FF000000' } };
                }

                if (rowNumber > 17 && colNumber > 3) {
                    cell.alignment = { horizontal: 'right' };
                } else {
                    cell.alignment = { horizontal: 'left' };
                }
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Sundry_Debtors_Export.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Failed to export Excel file.");
    }
});


// --- SMART TALLY IMPORTER (AUTO-10-DAY ASSIGNMENT) ---
app.post('/import', upload.single('excelFile'), requireLogin, async (req, res) => {
    try {
        if (!req.file) return res.redirect('/');

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        let importedCount = 0;

        let dataStartIndex = 0;
        for (let i = 0; i < rawData.length; i++) {
            const firstColumn = rawData[i][0] ? String(rawData[i][0]).trim().toLowerCase() : '';
            if (firstColumn === 'particulars') {
                dataStartIndex = i + 1;
                break;
            }
        }

        for (let i = dataStartIndex; i < rawData.length; i++) {
            const row = rawData[i];
            const partyName = row[0] ? String(row[0]).trim() : '';

            if (!partyName || partyName.toLowerCase() === 'grand total') {
                continue;
            }

            const cleanMoney = (val) => Number(String(val || '0').replace(/[^0-9.-]+/g, "")) || 0;
            const contactPerson = row[1] ? String(row[1]).trim() : '';

            const rawPhoneStr = row[2] ? String(row[2]).trim() : '';
            const phoneArray = rawPhoneStr.split(',').map(n => n.trim()).filter(n => n);

            let finalPhone = '';
            let finalWhatsapp = '';
            let finalOther = '';

            if (phoneArray.length > 0) {
                const formatNum = (num) => {
                    let cleaned = num.replace(/[^0-9]/g, '');
                    if (cleaned.length === 10) return '91' + cleaned;
                    if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned;
                    return cleaned ? '91' + cleaned : '';
                };

                finalPhone = formatNum(phoneArray[0]);
                finalWhatsapp = finalPhone;

                if (phoneArray.length > 1) {
                    finalOther = phoneArray.slice(1).map(formatNum).join(', ');
                }
            }

            const totalPending = cleanMoney(row[3]); 

            const agingData = {
                under30: cleanMoney(row[4]),        
                days30to60: cleanMoney(row[5]),     
                days60to90: cleanMoney(row[7]),     
                days90to120: cleanMoney(row[8]),    
                days120to150: cleanMoney(row[9]),   
                days150to180: cleanMoney(row[10]),  
                above180: cleanMoney(row[11]),      
                onAccount: cleanMoney(row[12])      
            };

            // 🚨 THE FIX: Look up customer to smartly manage their Action Date
            let cust = await Customer.findOne({ companyName: partyName, adminId: req.session.adminId });
            
            if (!cust) {
                // New customer: Create and set 10 days from now
                cust = new Customer({ companyName: partyName, adminId: req.session.adminId });
                let d = new Date(); d.setDate(d.getDate() + 10);
                cust.nextActionDate = d;
            } else if (!cust.nextActionDate) {
                // Existing customer missing a date: Give them 10 days
                let d = new Date(); d.setDate(d.getDate() + 10);
                cust.nextActionDate = d;
            }

            // Update everything else
            cust.contactPerson = contactPerson;
            cust.phone = finalPhone;
            cust.whatsappNumber = finalWhatsapp;
            cust.otherNumbers = finalOther;
            cust.totalAmount = totalPending;
            cust.aging = agingData;
            
            await cust.save();
            importedCount++;
        }

        await logActivity(req, "Excel Import", `Imported ${importedCount} real customers from Tally/CSV Export.`);
        res.redirect('/');

    } catch (err) {
        console.error("Smart Import Error:", err);
        res.status(500).send("Failed to import. Please check file format.");
    }
});

// 5. CUSTOMER ACTIONS (AUTO-ASSIGNS 10 DAYS)
app.post('/customers', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const fullPhoneNumber = req.body.countryCode + req.body.localPhone;
        const initialAmount = Number(req.body.totalAmount) || 0;

        // 🚨 THE FIX: Auto-generate date 10 days into the future
        const autoDate = new Date();
        autoDate.setDate(autoDate.getDate() + 10);

        await Customer.create({
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email,
            phone: fullPhoneNumber,
            whatsappNumber: req.body.whatsappNumber,
            totalAmount: initialAmount,
            adminId: req.session.adminId,
            nextActionDate: autoDate, // Uses the smart 10-day logic
            aging: {
                under30: initialAmount,
                days30to60: 0, days60to90: 0, days90to120: 0,
                days120to150: 0, days150to180: 0, above180: 0, onAccount: 0
            }
        });
        await logActivity(req, "Added Party", `Created new party: ${req.body.companyName} with Total ₹${initialAmount}`);

        res.redirect('/');
    } catch (err) {
        console.error("Add Customer Error:", err);
        res.status(500).send("Error adding customer.");
    }
});

app.put('/customers/:id/edit', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    const customer = await Customer.findOneAndUpdate(
        { _id: req.params.id, adminId: req.session.adminId },
        {
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email,
            phone: req.body.phone,
            whatsappNumber: req.body.whatsappNumber,
            otherNumbers: req.body.otherNumbers
        },
        { returnDocument: 'after' }
    );

    if (customer) {
        await logActivity(req, "Edited Party", `Updated profile details for ${customer.companyName}.`);
    }

    res.redirect('/');
});

app.delete('/customers/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");

    const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });

    if (customer) {
        await logActivity(req, "Deleted Party", `Permanently deleted party: ${customer.companyName}`);
    }

    res.redirect('/');
});

// FIFO Payment Engine
app.put('/customers/:id/transaction', requireLogin, async (req, res) => {
    try {
        const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!customer) return res.status(404).send("Customer not found.");

        const newPurchase = Number(req.body.newPurchase) || 0;
        const payment = Number(req.body.payment) || 0;

        if (payment > 0) customer.lastPaymentDate = new Date();

        customer.totalAmount = (Number(customer.totalAmount) || 0) + newPurchase;
        customer.paidAmount = (Number(customer.paidAmount) || 0) + payment;

        if (!customer.aging) {
            customer.aging = { under30: 0, days30to60: 0, days60to90: 0, days90to120: 0, days120to150: 0, days150to180: 0, above180: 0, onAccount: 0 };
        }

        customer.aging.under30 = (Number(customer.aging.under30) || 0) + newPurchase;

        let remainingPayment = payment;
        const bucketOrder = ['above180', 'days150to180', 'days120to150', 'days90to120', 'days60to90', 'days30to60', 'under30', 'onAccount'];

        for (let bucket of bucketOrder) {
            if (remainingPayment <= 0) break;

            let currentBucketVal = Number(customer.aging[bucket]) || 0;

            if (currentBucketVal > 0) {
                if (currentBucketVal >= remainingPayment) {
                    customer.aging[bucket] = currentBucketVal - remainingPayment;
                    remainingPayment = 0;
                } else {
                    remainingPayment -= currentBucketVal;
                    customer.aging[bucket] = 0;
                }
            }
        }

        if (remainingPayment > 0) {
            customer.aging.onAccount = (Number(customer.aging.onAccount) || 0) + remainingPayment;
        }

        customer.markModified('aging');

        await customer.save();

        let details = "";
        if (newPurchase > 0) details += `Bought goods worth ₹${newPurchase}. `;
        if (payment > 0) details += `Paid ₹${payment}.`;

        if (details !== "") {
            await logActivity(req, "Payment Updated", `Added ₹${payment} payment and ₹${newPurchase} new purchase to ${customer.companyName}.`);
        }

        res.redirect('/');

    } catch (err) {
        console.error("Transaction Error:", err);
        res.status(500).send("Error updating balance.");
    }
});

app.put('/customers/:id/update-reminder', requireLogin, async (req, res) => {
    const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });

    if (!customer) return res.status(404).send("Customer not found.");

    customer.nextActionDate = new Date(req.body.nextDate);
    await customer.save();

    await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName} set to ${req.body.nextDate}`);
    res.redirect('/');
});

// --- BULK CUSTOMER ACTIONS ---
app.post('/customers/bulk', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");

    const { action, customerIds } = req.body;

    let ids = [];
    if (Array.isArray(customerIds)) ids = customerIds;
    else if (customerIds) ids = [customerIds];

    if (ids.length === 0) return res.redirect('/');

    try {
        if (action === 'delete') {
            const result = await Customer.deleteMany({ _id: { $in: ids }, adminId: req.session.adminId });
            await logActivity(req, "Bulk Delete", `Permanently deleted ${result.deletedCount} parties at once.`);
        }
    } catch (err) {
        console.error("Bulk Action Error:", err);
    }

    res.redirect('/');
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });