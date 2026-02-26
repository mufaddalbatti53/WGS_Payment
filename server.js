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
// WARNING: Replace YOUR_DATABASE_PASSWORD_HERE with your real password!
const dbURI = 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

mongoose.connect(dbURI)
    .then(() => console.log("✅ DB Connected Successfully"))
    .catch(err => console.log("❌ DB Connection Error: ", err));

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
// Allows Android to read the hidden assetlinks.json file
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

// --- MASTER TRACKING FUNCTION (LOUD DEBUG VERSION) ---
async function logActivity(req, action, details) {
    console.log(`\n▶️ [ACTIVITY TRIGGERED] Attempting to log: "${action}"`);

    try {
        // 1. Check if it knows who is logged in
        if (!req.session) {
            console.log("❌ [ACTIVITY FAILED] Reason: No session found.");
            return;
        }
        if (!req.session.adminId) {
            console.log("❌ [ACTIVITY FAILED] Reason: req.session.adminId is missing.");
            return;
        }

        // 2. Try to save to the database
        // 🚨 IMPORTANT: If your model at the top is named `Activity`, change `ActivityLog.create` to `Activity.create` below!
        await ActivityLog.create({
            adminId: req.session.adminId,
            userId: req.session.userId || req.session.adminId, // Fallback just in case
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
// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => {
    // If they are already logged in, instantly bounce them back to the dashboard!
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

// --- LOGIN ROUTE (WITH MULTI-TENANCY WORKSPACES) ---
// --- LOGIN ROUTE (WITH BCRYPT ENCRYPTION FIX) ---
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. Find the user in the database
        const user = await User.findOne({ username });

        // If the user doesn't exist, stop here
        if (!user) {
            return res.send("Invalid username or password. Please try again.");
        }

        // 2. UNLOCK THE VAULT: Compare typed password with encrypted database password
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            // 3. Save basic user info to the session memory
            req.session.userId = user._id;
            req.session.role = user.role;

            // 4. Set the Workspace ID (adminId)
            if (user.role === 'admin') {
                req.session.adminId = user._id;
            } else if (user.role === 'staff') {
                req.session.adminId = user.adminId;
            }

            // 5. Send them to the dashboard
            res.redirect('/');

        } else {
            res.send("Invalid username or password. Please try again.");
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

// 2. DASHBOARD
// --- LOAD DASHBOARD (FILTERED BY WORKSPACE) ---
app.get('/', async (req, res) => {
    // 1. Check if they are logged in
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        // 2. Fetch ONLY the customers that belong to this specific Admin's workspace
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();

        // 3. Send the filtered data to the page
        res.render('index', { customers: customers, role: req.session.role });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Error loading dashboard.");
    }
});

// 3. ADMIN PAGES
app.get('/staff', requireLogin, async (req, res) => {
    // 1. Security Check: Block staff from viewing the management page
    if (req.session.role !== 'admin') {
        return res.status(403).send("Unauthorized. Only Admins can view this page.");
    }

    try {
        // 2. The Magic Filter: Find users who are staff AND belong to this Admin
        const myStaff = await User.find({
            role: 'staff',
            adminId: req.session.adminId
        }).lean();

        // 3. Send that filtered list to your staff.ejs page
        res.render('staff', { staffMembers: myStaff, role: req.session.role });
    } catch (error) {
        console.error("Error loading staff list:", error);
        res.status(500).send("Error loading staff list.");
    }
});

// --- VIEW ACTIVITY LOG ---
app.get('/activity', requireLogin, async (req, res) => {
    try {
        // 1. Fetch the activities from the database and store them in the 'activities' variable
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).sort({ createdAt: -1 }).lean();

        // 2. Pass BOTH the activities AND the role to the frontend!
        res.render('activity', {
            activities: activities,
            role: req.session.role
        });
    } catch (err) {
        console.error("Activity Load Error:", err);
        res.status(500).send("Error loading activity log.");
    }
});
// --- BULK DELETE ACTIVITY LOGS ---
app.post('/activity/delete-bulk', requireLogin, async (req, res) => {
    // Only Admin can clear logs
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
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) // Include the whole end day
            };
        }
        // If filterType is 'all', the query just remains { adminId: req.session.adminId } which deletes all.

        await ActivityLog.deleteMany(query);
        res.redirect('/activity');

    } catch (err) {
        console.error("Bulk Delete Error:", err);
        res.status(500).send("Failed to delete logs.");
    }
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

        // Create the user and link them to the Admin's workspace
        await User.create({
            username: req.body.username,
            password: hashedPassword,
            role: 'staff',
            adminId: req.session.adminId // <-- THE MAGIC STAMP IS HERE
        });

        await logActivity(req, "Created Staff", `Created: ${req.body.username}`);
        res.redirect('/staff');
    } catch (e) {
        res.send("Staff username taken");
    }
});

// --- SECURE STAFF ACTIONS ---

app.post('/reset-staff-password', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    const { staffId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // SECURITY: Double-padlock. Only update if the staff member belongs to THIS admin.
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

    // SECURITY: Double-padlock. Only delete if the staff member belongs to THIS admin.
    const staff = await User.findOneAndDelete({
        _id: req.params.id,
        adminId: req.session.adminId
    });

    if (staff) {
        await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
    }
    res.redirect('/staff');
});

// --- EXPORT TO EXCEL ROUTE ---
// --- EXPORT TO EXCEL ROUTE (BEAUTIFUL TEMPLATE) ---
// --- EXPORT TO EXCEL ROUTE (PREMIUM REPORT + PHONE NUMBER FIX) ---
app.get('/export', requireLogin, async (req, res) => {
    try {
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();

        const workbook = new ExcelJS.Workbook();

        // 1. Create sheet and FREEZE the top 2 rows so they stay visible when scrolling!
        const worksheet = workbook.addWorksheet('Customer Master', {
            views: [{ state: 'frozen', ySplit: 2 }]
        });

        // 2. Add a Premium Title Row (Spans across all columns)
        worksheet.mergeCells('A1:H1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = '📊 CUSTOMER FINANCIAL STATEMENT  |  Generated on: ' + new Date().toLocaleDateString('en-IN');
        titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } }; // Dark slate blue
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

        // 3. Define the Headers (MUST MATCH YOUR IMPORT ROUTE EXACTLY)
        worksheet.getRow(2).values = [
            'Company Name', 'Contact Person', 'Email Address',
            'Phone Number', 'WhatsApp Number', 'Total Due', 'Paid Amount', 'Next Action Date'
        ];

        // 4. Set Column Widths and Force Text Formatting for Phones
        worksheet.columns = [
            { key: 'companyName', width: 30 },
            { key: 'contactPerson', width: 25 },
            { key: 'email', width: 35 },
            // THE FIX: style: { numFmt: '@' } forces Excel to treat any typed number as TEXT!
            { key: 'phone', width: 25, style: { numFmt: '@' } },
            { key: 'whatsappNumber', width: 25, style: { numFmt: '@' } },
            { key: 'totalAmount', width: 20, style: { numFmt: '₹#,##0.00' } },
            { key: 'paidAmount', width: 20, style: { numFmt: '₹#,##0.00' } },
            { key: 'nextActionDate', width: 20 }
        ];

        // 5. Style the Header Row
        worksheet.getRow(2).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF27AE60' } }; // Theme Green
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        // 6. Add the Data with Zebra Striping
        customers.forEach((c, index) => {
            const row = worksheet.addRow({
                companyName: c.companyName || '',
                contactPerson: c.contactPerson || '',
                email: c.email || '',
                // THE SECOND FIX: Force existing database numbers to strings
                phone: c.phone ? String(c.phone) : '',
                whatsappNumber: c.whatsappNumber ? String(c.whatsappNumber) : '',
                totalAmount: c.totalAmount || 0,
                paidAmount: c.paidAmount || 0,
                nextActionDate: c.nextActionDate ? new Date(c.nextActionDate).toLocaleDateString('en-IN') : ''
            });

            // Alternate row colors (White and very light grey) for easy reading
            const isEven = index % 2 === 0;
            row.eachCell((cell, colNumber) => {
                cell.border = { top: { style: 'thin', color: { argb: 'FFEEEEEE' } }, bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
                if (isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
                }
                cell.alignment = { vertical: 'middle', horizontal: 'left' };

                // Keep the money columns aligned to the right
                if (colNumber === 6 || colNumber === 7) {
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                }
            });
        });

        // 7. Send the file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Customer_Master_List.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Failed to export Excel file.");
    }
});


// --- IMPORT FROM EXCEL ROUTE (WITH SMART UPDATE) ---
// --- IMPORT FROM EXCEL ROUTE (MULTI-TENANT SECURED) ---
// --- IMPORT FROM EXCEL ROUTE (UPDATED FOR PREMIUM TEMPLATE) ---
// --- IMPORT FROM EXCEL ROUTE (WITH SAFE DATE PARSING) ---
app.post('/import', upload.single('excelFile'), requireLogin, async (req, res) => {
    try {
        if (!req.file) return res.redirect('/');

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Read from Row 2 (skipping the title row)
        const importedData = xlsx.utils.sheet_to_json(sheet, { range: 1 });

        for (let row of importedData) {
            if (!row['Company Name']) continue;

            // 1. Force phone numbers to be text
            const phoneStr = String(row['Phone Number'] || '');
            const waStr = String(row['WhatsApp Number'] || row['Phone Number'] || '');

            // 2. Clean the money
            const cleanTotal = Number(String(row['Total Due'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
            const cleanPaid = Number(String(row['Paid Amount'] || '0').replace(/[^0-9.-]+/g, "")) || 0;

            // 3. SAFE DATE PARSER: Prevents the "Invalid Date" crash
            let safeActionDate = null;
            if (row['Next Action Date']) {
                let tempDate;

                // If Excel sends a serial number (e.g., 45000)
                if (typeof row['Next Action Date'] === 'number') {
                    tempDate = new Date(Math.round((row['Next Action Date'] - 25569) * 86400 * 1000));
                }
                // If Excel sends a string date
                else {
                    const dateStr = String(row['Next Action Date']);
                    // If it's DD/MM/YYYY or DD-MM-YYYY, swap to MM/DD/YYYY for JavaScript
                    if (dateStr.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/)) {
                        const parts = dateStr.split(/[\/\-]/);
                        tempDate = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
                    } else {
                        tempDate = new Date(dateStr);
                    }
                }

                // Only attach the date if it successfully converted
                if (!isNaN(tempDate.getTime())) {
                    safeActionDate = tempDate;
                }
            }

            // 4. Save to Database
            await Customer.findOneAndUpdate(
                { companyName: row['Company Name'], adminId: req.session.adminId },
                {
                    contactPerson: row['Contact Person'] || '',
                    email: row['Email Address'] || '',
                    phone: phoneStr,
                    whatsappNumber: waStr,
                    totalAmount: cleanTotal,
                    paidAmount: cleanPaid,
                    // Safely apply the verified date, or leave it blank
                    ...(safeActionDate && { nextActionDate: safeActionDate })
                },
                { upsert: true, returnDocument: 'after' }
            );
        }

        await logActivity(req, "Excel Import", `Imported/Updated ${importedData.length} customers from Excel.`);
        res.redirect('/');

    } catch (err) {
        console.error("Import Error:", err);
        res.status(500).send("Failed to import Excel file. Please ensure it matches the exact template.");
    }
});

// 5. CUSTOMER ACTIONS
// --- ADD NEW CUSTOMER (STAMPED WITH WORKSPACE ID) ---
// --- ADD NEW CUSTOMER (WITH PHONE NUMBER FIX) ---
// --- ADD NEW CUSTOMER (NOW ASKS FOR FIRST ACTION DATE) ---
app.post('/customers', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const fullPhoneNumber = req.body.countryCode + req.body.localPhone;

        await Customer.create({
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email,
            phone: fullPhoneNumber,
            whatsappNumber: req.body.whatsappNumber,
            totalAmount: req.body.totalAmount || 0,
            adminId: req.session.adminId,
            nextActionDate: req.body.nextActionDate // <-- Captures the date immediately!
        });
        await logActivity(req, "Added Party", `Created new party: ${req.body.companyName} with Total ₹${req.body.totalAmount || 0}`);

        res.redirect('/');
    } catch (err) {
        console.error("Add Customer Error:", err);
        res.status(500).send("Error adding customer.");
    }
});
// --- SECURE CUSTOMER ACTIONS ---

// --- SECURE CUSTOMER ACTIONS ---

app.put('/customers/:id/edit', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    // THE FIX: We added "const customer =" right here!
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

    // THE FIX: Now that 'customer' exists, the log works safely!
    if (customer) {
        await logActivity(req, "Edited Party", `Updated profile details for ${customer.companyName}.`);
    }

    res.redirect('/');
});

app.delete('/customers/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");

    // Grab the customer before deleting so we know their name for the log!
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });

    if (customer) {
        // 🚨 ADD THIS TRACKER:
        await logActivity(req, "Deleted Party", `Permanently deleted party: ${customer.companyName}`);
    }

    res.redirect('/');
});

app.put('/customers/:id/transaction', requireLogin, async (req, res) => {
    // SECURITY: Find customer within this specific workspace
    const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });

    if (!customer) return res.status(404).send("Customer not found.");

    const newPurchase = Number(req.body.newPurchase) || 0;
    const payment = Number(req.body.payment) || 0;

    customer.totalAmount = Number(customer.totalAmount) + newPurchase;
    customer.paidAmount = Number(customer.paidAmount) + payment;
    await customer.save();

    let details = "";
    if (newPurchase > 0) details += `Bought goods worth ₹${newPurchase}. `;
    if (payment > 0) details += `Paid ₹${payment}.`;

    await logActivity(req, "Payment Updated", `Added ₹${payment} payment and ₹${newPurchase} new purchase to ${customer.companyName}.`);
    res.redirect('/');
});

app.put('/customers/:id/update-reminder', requireLogin, async (req, res) => {
    // SECURITY: Ensure staff/admin can only set reminders for their own customers
    const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });

    if (!customer) return res.status(404).send("Customer not found.");

    customer.nextActionDate = new Date(req.body.nextDate);
    await customer.save();

    await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName} set to ${req.body.nextDate}`);
    res.redirect('/');
});



// --- START SERVER ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });

