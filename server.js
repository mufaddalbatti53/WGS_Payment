const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');

// Add this near the top of server.js
const xlsx = require('xlsx');
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
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(session({ secret: 'secretKey', resave: false, saveUninitialized: false }));

// --- HELPERS & MIDDLEWARE ---
const logActivity = async (req, action, details) => {
    const user = await User.findById(req.session.userId);
    const username = user ? user.username : "Unknown";
    await Activity.create({ username, action, details, adminId: req.session.adminId });
};

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

// --- ROUTES ---

// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => { res.render('login', { error: null }); });

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

app.get('/activity', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    const activities = await Activity.find({ adminId: req.session.adminId }).sort({ date: -1 }).limit(50);
    res.render('activity', { activities });
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
app.get('/export', async (req, res) => {
    try {
        const customers = await Customer.find({ adminId: req.session.adminId }).lean();

        // Map database fields to exact Excel column names
        const excelData = customers.map(c => ({
            'COMPANY NAME': c.companyName || '',
            'CONTACT PERSON': c.contactPerson || '',
            'EMAIL ADDRESS': c.email || '',
            'PRIMARY CALLING NUMBER': c.phone || '',
            'WHATSAPP NUMBER': c.whatsappNumber || '',
            'OTHER NUMBERS': c.otherNumbers || '',
            'TOTAL AMOUNT': c.totalAmount || 0,
            'PAID': c.paidAmount || 0,
            'NEXT ACTION DATE': c.nextActionDate ? new Date(c.nextActionDate).toLocaleDateString('en-IN') : ''
        }));

        const worksheet = xlsx.utils.json_to_sheet(excelData);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Customers');

        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        res.setHeader('Content-Disposition', 'attachment; filename="Customer_Data.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to export Excel file.");
    }
});


// --- IMPORT FROM EXCEL ROUTE (WITH SMART UPDATE) ---
// --- IMPORT FROM EXCEL ROUTE (MULTI-TENANT SECURED) ---
app.post('/import', upload.single('excelFile'), async (req, res) => {
    // 1. Security Check: Make sure they are logged in
    if (!req.session.userId) return res.redirect('/login');

    try {
        if (!req.file) return res.status(400).send('Please upload an Excel file.');

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Loop through all 100+ rows instantly
        for (let row of data) {
            if (row['COMPANY NAME']) {

                const updateData = {
                    companyName: row['COMPANY NAME'],
                    contactPerson: row['CONTACT PERSON'] || '',
                    email: row['EMAIL ADDRESS'] || '',
                    phone: row['PRIMARY CALLING NUMBER'] || '',
                    whatsappNumber: row['WHATSAPP NUMBER'] || '',
                    otherNumbers: row['OTHER NUMBERS'] || '',
                    totalAmount: row['TOTAL AMOUNT'] || 0,
                    paidAmount: row['PAID'] || 0,
                    nextActionDate: row['NEXT ACTION DATE'] || null,
                    adminId: req.session.adminId // <-- THE MAGIC STAMP!
                };

                // Smart Update: Make sure it only updates customers in THIS Admin's workspace
                await Customer.findOneAndUpdate(
                    {
                        companyName: row['COMPANY NAME'],
                        adminId: req.session.adminId // Only look for duplicates inside this company
                    },
                    { $set: updateData },
                    { new: true, upsert: true }
                );
            }
        }

        // After all rows are processed, refresh the dashboard at once
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to import Excel file.");
    }
});

// 5. CUSTOMER ACTIONS
// --- ADD NEW CUSTOMER (STAMPED WITH WORKSPACE ID) ---
app.post('/customers', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        // Create the customer and secretly attach the Admin's ID to them
        await Customer.create({
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email,
            phone: req.body.phone,
            whatsappNumber: req.body.whatsappNumber,
            totalAmount: req.body.totalAmount || 0,
            adminId: req.session.adminId // <-- THE MAGIC STAMP
        });

        res.redirect('/');
    } catch (err) {
        console.error("Add Customer Error:", err);
        res.status(500).send("Error adding customer.");
    }
});

// --- SECURE CUSTOMER ACTIONS ---

app.put('/customers/:id/edit', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    // SECURITY: Match the ID *and* the Workspace ID.
    // BUG FIX: Changed 'whatsapp' to 'whatsappNumber'
    await Customer.findOneAndUpdate(
        { _id: req.params.id, adminId: req.session.adminId },
        {
            companyName: req.body.companyName,
            contactPerson: req.body.contactPerson,
            email: req.body.email,
            phone: req.body.phone,
            whatsappNumber: req.body.whatsappNumber, // Fixed!
            otherNumbers: req.body.otherNumbers
        }
    );
    await logActivity(req, "Updated Details", `Updated profile for: ${req.body.companyName}`);
    res.redirect('/');
});

app.delete('/customers/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");

    // SECURITY: Only delete if it belongs to this admin's workspace
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, adminId: req.session.adminId });

    if (customer) await logActivity(req, "Deleted Customer", `Removed: ${customer.companyName}`);
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

    await logActivity(req, "Transaction Updated", `${customer.companyName}: ${details}`);
    res.redirect('/');
});

app.put('/customers/:id/update-reminder', requireLogin, async (req, res) => {
    // SECURITY: Ensure staff/admin can only set reminders for their own customers
    const customer = await Customer.findOne({ _id: req.params.id, adminId: req.session.adminId });

    if (!customer) return res.status(404).send("Customer not found.");

    customer.nextReminderDate = new Date(req.body.nextDate);
    await customer.save();

    await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName} set to ${req.body.nextDate}`);
    res.redirect('/');
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });

