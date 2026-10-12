const mongoose = require('mongoose');

const planItemSchema = new mongoose.Schema({
    id: { type: String, required: true }, // 'basic', 'pro', 'customized'
    name: { type: String, required: true },
    tagline: { type: String, default: '' },
    badge: { type: String, default: '' },
    isPopular: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    price: { type: Number, default: 999 },
    durationMonths: { type: Number, default: 1 },
    billingLabel: { type: String, default: '/ month' },
    maxCustomersLimit: { type: Number, default: 200 },
    maxStaffLimit: { type: Number, default: 2 },
    dailyMessageLimit: { type: Number, default: 50 },
    // Customized plan unit rates
    basePrice: { type: Number, default: 499 },
    pricePer100Parties: { type: Number, default: 150 },
    pricePerStaff: { type: Number, default: 100 },
    pricePer50Messages: { type: Number, default: 75 },
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
    price: { type: Number, required: true, default: 199 },
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
        tagline: 'Essential payment tracking & aging analysis for growing businesses.',
        badge: 'STARTER',
        isPopular: false,
        isCustom: false,
        price: 999,
        durationMonths: 1,
        billingLabel: '/ month',
        maxCustomersLimit: 250,
        maxStaffLimit: 2,
        dailyMessageLimit: 50,
        features: [
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
        tagline: 'Full-featured automation, cloud backups & higher quotas for active finance teams.',
        badge: 'MOST POPULAR',
        isPopular: true,
        isCustom: false,
        price: 2499,
        durationMonths: 3,
        billingLabel: '/ 3 months',
        maxCustomersLimit: 1000,
        maxStaffLimit: 10,
        dailyMessageLimit: 250,
        features: [
            'Up to 1,000 Active Parties',
            '10 Staff / Team Accounts',
            '250 Daily Payment Reminders (WhatsApp/SMS/Email)',
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
        tagline: 'Tailor your exact party quota, team size, and daily message limits with live pricing.',
        badge: 'BUILD YOUR OWN',
        isPopular: false,
        isCustom: true,
        price: 1699,
        durationMonths: 1,
        billingLabel: '/ month',
        maxCustomersLimit: 500,
        maxStaffLimit: 5,
        dailyMessageLimit: 150,
        basePrice: 499,
        pricePer100Parties: 120,
        pricePerStaff: 80,
        pricePer50Messages: 60,
        features: [
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
        name: '+500 Extra Parties',
        description: 'Expand your party ledger capacity by 500 additional customer accounts.',
        price: 399,
        type: 'parties',
        value: 500,
        isActive: true
    },
    {
        id: 'addon_staff_5',
        name: '+5 Extra Staff Accounts',
        description: 'Add 5 more staff/employee logins for your collections and accounting team.',
        price: 299,
        type: 'staff',
        value: 5,
        isActive: true
    },
    {
        id: 'addon_msgs_100',
        name: '+100 Daily Reminders',
        description: 'Boost your daily WhatsApp, SMS & Email payment reminder quota by 100/day.',
        price: 199,
        type: 'messages',
        value: 100,
        isActive: true
    },
    {
        id: 'addon_gdrive',
        name: 'Cloud Backup Unlock',
        description: 'Enable automated & 1-click Google Drive cloud backups on Basic plans.',
        price: 249,
        type: 'gdrive',
        value: 1,
        isActive: true
    },
    {
        id: 'addon_validity_3m',
        name: '+3 Months Plan Validity',
        description: 'Extend your subscription validity by an additional 3 months.',
        price: 999,
        type: 'duration',
        value: 3,
        isActive: true
    }
];

planConfigSchema.statics.getOrCreateSingleton = async function () {
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
        }
        if (!config.addons || config.addons.length === 0) {
            config.addons = DEFAULT_ADDONS;
            modified = true;
        }
        if (modified) await config.save();
    }
    return config;
};

module.exports = mongoose.model('PlanConfig', planConfigSchema);
