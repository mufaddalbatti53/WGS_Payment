require('dotenv').config();
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception caught to prevent server crash:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
if (!process.env.VERCEL) {
    try {
        require('dns').setServers(['8.8.8.8', '8.8.4.4']);
    } catch (e) {}
}
const express = require('express');
const mongoose = require('mongoose');
mongoose.connection.on('error', err => {
    console.error('Mongoose connection error:', err.message);
});
mongoose.connection.on('disconnected', () => {
    console.warn('Mongoose disconnected from MongoDB.');
});
const session = require('express-session');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.default || connectMongo;
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');

const User = require('./models/User');
const Customer = require('./models/Customer');
const ActivityLog = require('./models/Activity');

const app = express();

const allowedOrigins = [
    process.env.FRONTEND_ORIGIN,
    process.env.PUBLIC_APP_ORIGIN,
    'https://payment.webgraphicsstudio.in',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5173',
    'http://localhost:3000'
].filter(Boolean).map(o => o.replace(/\/+$/, ''));

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/+$/, '');
        if (
            allowedOrigins.includes(cleanOrigin) ||
            /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(cleanOrigin) ||
            /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(cleanOrigin)
        ) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition']
}));

let databaseReady = false;
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        database: databaseReady ? 'connected' : 'connecting',
        uptime: Math.floor(process.uptime())
    });
});

const dbURI = process.env.MONGODB_URI;
if (!dbURI) {
    throw new Error('MONGODB_URI must be configured before starting the application.');
}

async function ensureSuperAdminAccount() {
    try {
        const bootstrapUsername = (process.env.SUPERADMIN_USERNAME || '').trim();
        const bootstrapPassword = process.env.SUPERADMIN_PASSWORD;
        if (!bootstrapUsername) return;

        const existingSuper = await User.findOne({
            username: new RegExp('^\\s*' + bootstrapUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i')
        }).select('+password');

        if (!existingSuper && bootstrapPassword) {
            await User.create({
                username: bootstrapUsername,
                password: await bcrypt.hash(bootstrapPassword, 12),
                role: 'superadmin',
                status: 'approved'
            });
            console.log("✅ Super Admin account initialized.");
        } else if (existingSuper) {
            let updated = false;
            if (existingSuper.role !== 'superadmin') {
                existingSuper.role = 'superadmin';
                updated = true;
            }
            if (existingSuper.status !== 'approved') {
                existingSuper.status = 'approved';
                updated = true;
            }
            if (updated) {
                await existingSuper.save();
                console.log("✅ Super Admin account role/status verified.");
            }
        }
    } catch (err) {
        console.error("Auto Super Admin creation error:", err.message);
    }
}

mongoose.connect(dbURI)
    .then(() => {
        console.log("✅ DB Connected Successfully");
        databaseReady = true;
        ensureSuperAdminAccount().catch(err => {
            console.error("Account bootstrap error:", err.message);
        });
        if (process.env.VERCEL !== '1') {
            shiftAgingBuckets();
            runAutoBackups();
            setInterval(shiftAgingBuckets, 24 * 60 * 60 * 1000);
            setInterval(runAutoBackups, 24 * 60 * 60 * 1000);
        }
    })
    .catch(err => {
        databaseReady = false;
        console.log("❌ DB Connection Error: ", err);
    });

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 10000 }));
app.use(express.json({ limit: '2mb' }));

const isProductionOrVercel = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

app.use(session({
    secret: process.env.SESSION_SECRET || (() => {
        if (isProductionOrVercel) {
            throw new Error('SESSION_SECRET must be configured in production.');
        }
        return 'local-development-only-session-secret';
    })(),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: dbURI,
        collectionName: 'sessions',
        autoRemove: 'native'
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        httpOnly: true,
        sameSite: isProductionOrVercel ? 'none' : 'lax',
        secure: isProductionOrVercel
    }
}));

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

                    const autoBackupFileName = `WGS_AutoBackup_${new Date().toISOString().slice(0, 10)}.json`;
                    try {
                        await drive.files.create({
                            resource: { name: autoBackupFileName, parents: ['appDataFolder'] },
                            media: { mimeType: 'application/json', body: backupData },
                            fields: 'id'
                        });
                    } catch (appDataErr) {
                        console.warn(`appDataFolder auto-backup failed for ${admin.username}, falling back to root Drive:`, appDataErr.message);
                        await drive.files.create({
                            resource: { name: autoBackupFileName },
                            media: { mimeType: 'application/json', body: backupData },
                            fields: 'id'
                        });
                    }

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

app.get('/api/cron/maintenance', async (req, res) => {
    const expectedToken = process.env.CRON_SECRET;
    const suppliedToken = req.headers.authorization;
    if (!expectedToken || suppliedToken !== `Bearer ${expectedToken}`) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    try {
        await shiftAgingBuckets();
        await runAutoBackups();
        res.json({ success: true });
    } catch (err) {
        console.error('Scheduled maintenance error:', err);
        res.status(500).json({ success: false, message: 'Scheduled maintenance failed.' });
    }
});

const authRoutes = require('./routes/auth');
const customersRoutes = require('./routes/customers');
const staffRoutes = require('./routes/staff');
const activityRoutes = require('./routes/activity');
const superadminRoutes = require('./routes/superadmin');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backup');
const subscriptionsRoutes = require('./routes/subscriptions');

app.use('/api', authRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/auth', backupRoutes); // for /auth/google mapping

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => { console.log(`Server running on port ${PORT}`); });
}

module.exports = app;
