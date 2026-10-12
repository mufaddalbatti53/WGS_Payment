const mongoose = require('mongoose');

const planItemSchema = new mongoose.Schema({
    id: { type: String, required: true }, // 'basic', 'pro', 'customized'
    name: { type: String, required: true },
    tagline: { type: String, default: '' },
    badge: { type: String, default: '' },
    isPopular: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    price: { type: Number, default: 4999 },
    durationMonths: { type: Number, default: 12 },
    billingLabel: { type: String, default: '/ year' },
    maxCustomersLimit: { type: Number, default: 250 },
    maxStaffLimit: { type: Number, default: 2 },
    dailyMessageLimit: { type: Number, default: 50 },
    // Customized plan yearly unit rates
    basePrice: { type: Number, default: 2999 },
    pricePer100Parties: { type: Number, default: 500 },
    pricePerStaff: { type: Number, default: 400 },
    pricePer50Messages: { type: Number, default: 300 },
    features: { type: [String], default: [] },
    featureAccess: {
        allowGoogleDriveBackup: { type: Boolean, default: true },
        allowExcelImport: { type: Boolean, default: true },
        allowPdfExport: { type: Boolean, default: true }
    },
    isActive: { type: Boolean, default: true }
}, { _id: false });

const addonItemSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, default: 999 },
    type: {
        type: String,
        enum: ['parties', 'staff', 'messages', 'duration', 'gdrive', 'custom'],
        default: 'parties'
    },
    value: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true }
}, { _id: false });

const planConfigSchema = new mongoose.Schema({
    singletonKey: { type: String, default: 'global_subscription_config', unique: true },
    razorpayKeyId: { type: String, default: '' },
    razorpayKeySecret: { type: String, default: '' },
    currency: { type: String, default: 'INR' },
    whatsappSalesNumber: { type: String, default: '917021056404' },
    plans: { type: [planItemSchema], default: [] },
    addons: { type: [addonItemSchema], default: [] }
}, { timestamps: true });

const DEFAULT_PLANS = [
    {
        id: 'basic',
        name: 'Basic Plan',
        tagline: 'Essential yearly payment tracking & aging analysis for growing businesses.',
        badge: 'YEARLY STARTER',
        isPopular: false,
        isCustom: false,
        price: 4999,
        durationMonths: 12,
        billingLabel: '/ year',
        maxCustomersLimit: 250,
        maxStaffLimit: 2,
        dailyMessageLimit: 50,
        features: [
            '1 Full Year (12 Months) Validity',
            'Up to 250 Active Parties',
            '2 Staff / Team Accounts',
            '50 Daily Payment Reminders (WhatsApp/SMS/Email)',
            '30-60-90-180+ Days Aging Buckets',
            'Tally / Busy Excel & PDF Reports',
            'Activity Audit Trail'
        ],
        featureAccess: {
            allowGoogleDriveBackup: false,
            allowExcelImport: true,
            allowPdfExport: true
        },
        isActive: true
    },
    {
        id: 'pro',
        name: 'Pro Plan',
        tagline: 'Full-featured yearly automation, cloud backups & higher quotas for finance teams.',
        badge: 'MOST POPULAR • YEARLY',
        isPopular: true,
        isCustom: false,
        price: 9999,
        durationMonths: 12,
        billingLabel: '/ year',
        maxCustomersLimit: 1500,
        maxStaffLimit: 10,
        dailyMessageLimit: 300,
        features: [
            '1 Full Year (12 Months) Validity',
            'Up to 1,500 Active Parties',
            '10 Staff / Team Accounts',
            '300 Daily Payment Reminders (WhatsApp/SMS/Email)',
            'Automated Google Drive Cloud Backups',
            'Tally / Busy Excel Import & Export',
            'Customer Self-Service Portal & Priority Support'
        ],
        featureAccess: {
            allowGoogleDriveBackup: true,
            allowExcelImport: true,
            allowPdfExport: true
        },
        isActive: true
    },
    {
        id: 'customized',
        name: 'Customized Plan',
        tagline: 'Tailor your exact yearly party quota, team size, and daily message limits with live pricing.',
        badge: 'CUSTOM YEARLY',
        isPopular: false,
        isCustom: true,
        price: 14999,
        durationMonths: 12,
        billingLabel: '/ year',
        maxCustomersLimit: 2000,
        maxStaffLimit: 15,
        dailyMessageLimit: 500,
        basePrice: 2999,
        pricePer100Parties: 500,
        pricePerStaff: 400,
        pricePer50Messages: 300,
        features: [
            '1 Full Year (12 Months) Validity (Extendable)',
            'Custom Active Parties Quota (100 – 10,000+)',
            'Custom Staff / Team Accounts (1 – 100+)',
            'Custom Daily Reminder Quota (50 – 2,500+)',
            'Automated Google Drive Cloud Backups Included',
            'Full Tally / Busy Excel Import & PDF Suite',
            'Dedicated Onboarding & Priority Support'
        ],
        featureAccess: {
            allowGoogleDriveBackup: true,
            allowExcelImport: true,
            allowPdfExport: true
        },
        isActive: true
    }
];

const DEFAULT_ADDONS = [
    {
        id: 'addon_parties_500',
        name: '+500 Extra Parties (Yearly)',
        description: 'Expand your party ledger capacity by 500 additional customer accounts for the year.',
        price: 1499,
        type: 'parties',
        value: 500,
        isActive: true
    },
    {
        id: 'addon_staff_5',
        name: '+5 Extra Staff Accounts (Yearly)',
        description: 'Add 5 more staff/employee logins for your collections and accounting team.',
        price: 999,
        type: 'staff',
        value: 5,
        isActive: true
    },
    {
        id: 'addon_msgs_100',
        name: '+100 Daily Reminders (Yearly)',
        description: 'Boost your daily WhatsApp, SMS & Email payment reminder quota by 100/day.',
        price: 799,
        type: 'messages',
        value: 100,
        isActive: true
    },
    {
        id: 'addon_gdrive',
        name: 'Cloud Backup Unlock (Yearly)',
        description: 'Enable automated & 1-click Google Drive cloud backups on Basic plans.',
        price: 999,
        type: 'gdrive',
        value: 1,
        isActive: true
    },
    {
        id: 'addon_validity_12m',
        name: '+1 Extra Year Validity (12 Months)',
        description: 'Extend your subscription validity by an additional 12 months (1 full year).',
        price: 3999,
        type: 'duration',
        value: 12,
        isActive: true
    }
];

let _cachedConfigDoc = null;
let _cachedConfigTime = 0;
const PLAN_CONFIG_CACHE_TTL_MS = 45 * 1000;

planConfigSchema.statics.invalidateCache = function () {
    _cachedConfigDoc = null;
    _cachedConfigTime = 0;
};

planConfigSchema.statics.setCachedSingleton = function (doc) {
    _cachedConfigDoc = doc;
    _cachedConfigTime = Date.now();
};

planConfigSchema.statics.getOrCreateSingleton = async function (forceRefresh = false) {
    if (!forceRefresh && _cachedConfigDoc && (Date.now() - _cachedConfigTime) < PLAN_CONFIG_CACHE_TTL_MS) {
        return _cachedConfigDoc;
    }

    let config = await this.findOne({ singletonKey: 'global_subscription_config' });
    if (!config) {
        config = await this.create({
            singletonKey: 'global_subscription_config',
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
            currency: 'INR',
            whatsappSalesNumber: '917021056404',
            plans: DEFAULT_PLANS,
            addons: DEFAULT_ADDONS
        });
    } else {
        let modified = false;
        if (!config.plans || config.plans.length === 0) {
            config.plans = DEFAULT_PLANS;
            modified = true;
        } else {
            // Migrate legacy 1-month default plans to Yearly (12 months)
            config.plans.forEach(p => {
                if (!p.durationMonths || (p.durationMonths === 1 && [499, 999, 1299, 1999].includes(Number(p.price)))) {
                    p.durationMonths = 12;
                    p.billingLabel = '/ year';
                    modified = true;
                }
            });
        }
        if (!config.addons || config.addons.length === 0) {
            config.addons = DEFAULT_ADDONS;
            modified = true;
        }
        if (modified) await config.save();
    }

    _cachedConfigDoc = config;
    _cachedConfigTime = Date.now();
    return config;
};

module.exports = mongoose.model('PlanConfig', planConfigSchema);
