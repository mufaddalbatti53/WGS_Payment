const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');

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
    await Activity.create({ username, action, details });
};

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

// --- ROUTES ---

// 1. LOGIN & RECOVERY
app.get('/login', (req, res) => { res.render('login', { error: null }); });

app.post('/login', async (req, res) => {
    const { type, username, password, phone } = req.body;

    // STAFF LOGIN
    if (type === 'staff') {
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.role = user.role;
            return res.redirect('/');
        }
        return res.render('login', { error: "Invalid Credentials" });
    }
    // CUSTOMER LOGIN
    if (type === 'customer') {
        const customer = await Customer.findOne({ phone: phone });
        if (customer) {
            req.session.userId = customer._id;
            req.session.role = 'customer';
            return res.redirect('/');
        }
        return res.render('login', { error: "Number not found" });
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
app.get('/', requireLogin, async (req, res) => {
    const role = req.session.role;
    let customers = [];
    if (role === 'admin' || role === 'staff') {
        customers = await Customer.find({});
    } else {
        customers = await Customer.find({ _id: req.session.userId });
    }
    res.render('index', { customers, role });
});

// 3. ADMIN PAGES
app.get('/staff', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    const staffMembers = await User.find({ role: 'staff' });
    res.render('staff', { staffMembers });
});

app.get('/activity', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    const activities = await Activity.find({}).sort({ date: -1 }).limit(50);
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
        await User.create({ username: req.body.username, password: hashedPassword, role: 'staff' });
        await logActivity(req, "Created Staff", `Created: ${req.body.username}`);
        res.redirect('/staff');
    } catch (e) { res.send("Staff username taken"); }
});

app.post('/reset-staff-password', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const { staffId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const staff = await User.findByIdAndUpdate(staffId, { password: hashedPassword });
    await logActivity(req, "Password Reset", `Reset password for: ${staff.username}`);
    res.redirect('/staff');
});

app.delete('/staff/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const staff = await User.findByIdAndDelete(req.params.id);
    if (staff) await logActivity(req, "Deleted Staff", `Removed: ${staff.username}`);
    res.redirect('/staff');
});

// 5. CUSTOMER ACTIONS
app.post('/customers', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    await Customer.create({
        companyName: req.body.companyName,
        contactPerson: req.body.contactPerson,
        phone: req.body.countryCode + req.body.localPhone,
        otherNumbers: req.body.otherNumbers,
        whatsapp: req.body.countryCode + req.body.whatsapp,
        email: req.body.email,
        totalAmount: req.body.totalAmount,
        nextReminderDate: new Date()
    });
    await logActivity(req, "Added Customer", `Added: ${req.body.companyName}`);
    res.redirect('/');
});

app.put('/customers/:id/edit', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    await Customer.findByIdAndUpdate(req.params.id, {
        companyName: req.body.companyName,
        contactPerson: req.body.contactPerson,
        email: req.body.email,
        phone: req.body.phone,
        whatsapp: req.body.whatsapp,
        otherNumbers: req.body.otherNumbers
    });
    await logActivity(req, "Updated Details", `Updated profile for: ${req.body.companyName}`);
    res.redirect('/');
});

app.delete('/customers/:id', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin') return res.send("Unauthorized");
    const customer = await Customer.findByIdAndDelete(req.params.id);
    await logActivity(req, "Deleted Customer", `Removed: ${customer.companyName}`);
    res.redirect('/');
});

app.put('/customers/:id/transaction', requireLogin, async (req, res) => {
    if (req.session.role === 'customer') return res.send("Unauthorized");
    const customer = await Customer.findById(req.params.id);

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
    const customer = await Customer.findById(req.params.id);
    customer.nextReminderDate = new Date(req.body.nextDate);
    await customer.save();
    await logActivity(req, "Reminder Updated", `Next reminder for ${customer.companyName} set to ${req.body.nextDate}`);
    res.redirect('/');
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });

