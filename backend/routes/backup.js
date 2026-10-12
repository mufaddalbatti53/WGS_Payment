const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { google } = require('googleapis');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const User = require('../models/User');
const Customer = require('../models/Customer');
const ActivityLog = require('../models/Activity');
const { requireLogin, requireAdmin, logActivity } = require('../middleware/auth');

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

router.get('/google', requireAdmin, async (req, res) => {
    try {
        const adminId = String(req.session.adminId || req.session.userId);
        const adminUser = await User.findById(adminId).select('featureAccess').lean();
        if (adminUser && adminUser.featureAccess && adminUser.featureAccess.allowGoogleDriveBackup === false) {
            return res.status(403).json({
                success: false,
                message: "Google Drive Cloud Backup is not enabled on your current subscription plan. Upgrade your plan or purchase the Cloud Backup Add-on."
            });
        }
        const client = getOAuth2Client();
        const secret = process.env.SESSION_SECRET || 'local-development-only-session-secret';
        const nonce = crypto.randomBytes(16).toString('hex');
        const sig = crypto.createHmac('sha256', secret).update(`${adminId}:${nonce}`).digest('hex');
        const state = `${adminId}.${nonce}.${sig}`;

        req.session.googleOAuthState = state;
        await new Promise(resolve => req.session.save(resolve));

        const url = client.generateAuthUrl({
            access_type: 'offline',
            state,
            scope: [
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/drive.appdata',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            prompt: 'consent'
        });
        res.json({ success: true, url: url });
    } catch (err) {
        console.error("Generate Google Auth URL error:", err);
        res.status(500).json({ success: false, message: "Failed to generate Google Drive link URL: " + err.message });
    }
});

router.get('/google/callback', async (req, res) => {
    const frontendUrl = (process.env.FRONTEND_ORIGIN || process.env.PUBLIC_APP_ORIGIN || 'https://payment.webgraphicsstudio.in').replace(/\/+$/, '');
    try {
        const { code, state } = req.query;
        if (!code || !state) {
            return res.redirect(`${frontendUrl}/dashboard.html?msg=error`);
        }

        const secret = process.env.SESSION_SECRET || 'local-development-only-session-secret';
        let targetAdminId = null;

        // Verify signed state token: adminId.nonce.sig
        const parts = String(state).split('.');
        if (parts.length === 3) {
            const [adminId, nonce, sig] = parts;
            const expectedSig = crypto.createHmac('sha256', secret).update(`${adminId}:${nonce}`).digest('hex');
            if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
                targetAdminId = adminId;
            }
        }

        // Fallback to active session state if available
        if (!targetAdminId && req.session && req.session.adminId) {
            const expectedState = req.session.googleOAuthState;
            if (expectedState && (state === expectedState)) {
                targetAdminId = req.session.adminId;
            }
        }

        if (!targetAdminId) {
            console.error("Google OAuth callback: Invalid state verification.");
            return res.redirect(`${frontendUrl}/dashboard.html?error=` + encodeURIComponent("Google authorization verification failed. Please try again."));
        }

        const client = getOAuth2Client();
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();

        const updatedUser = await User.findByIdAndUpdate(targetAdminId, {
            googleDriveToken: tokens,
            googleEmail: userInfo.data.email
        }, { new: true });

        // Restore / maintain session if req.session is present
        if (req.session) {
            req.session.userId = targetAdminId;
            req.session.adminId = targetAdminId;
            req.session.role = updatedUser ? updatedUser.role : 'admin';
            req.session.username = updatedUser ? updatedUser.username : 'Admin';
            delete req.session.googleOAuthState;
            await new Promise(resolve => req.session.save(resolve));
        }

        await logActivity(req, 'Google Drive Linked', `Linked Google Drive account: ${userInfo.data.email}`);
        return res.redirect(`${frontendUrl}/dashboard.html?driveConnected=true`);
    } catch (e) {
        console.error("Google OAuth callback error:", e);
        return res.redirect(`${frontendUrl}/dashboard.html?error=` + encodeURIComponent("Google Drive linking failed: " + (e.message || "Unknown error")));
    }
});

router.post('/google/disconnect', requireLogin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.adminId, {
            $unset: { googleDriveToken: "", googleEmail: "" }
        });
        res.json({ success: true, message: "Google Drive disconnected." });
    } catch (e) {
        console.error("Disconnect GDrive error:", e);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post('/drive-backup', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: "Admin access required." });
    }
    try {
        const adminUser = await User.findById(req.session.adminId).select('+googleDriveToken').lean();
        if (adminUser && adminUser.featureAccess && adminUser.featureAccess.allowGoogleDriveBackup === false) {
            return res.status(403).json({ success: false, message: "Google Drive Cloud Backup is not enabled on your current subscription plan. Upgrade your plan or purchase the Cloud Backup Add-on." });
        }
        if (!adminUser || !adminUser.googleDriveToken) {
            return res.status(400).json({ success: false, message: "Google Drive not linked." });
        }

        const client = getOAuth2Client(adminUser.googleDriveToken);
        const drive = google.drive({ version: 'v3', auth: client });

        const customers = await Customer.find({ adminId: req.session.adminId }).lean();
        const staff = await User.find({ role: 'staff', adminId: req.session.adminId }).lean();
        const activities = await ActivityLog.find({ adminId: req.session.adminId }).lean();

        const backupData = JSON.stringify({
            customers: customers,
            staff: staff,
            activities: activities,
            timestamp: new Date()
        });

        const backupFileName = `WGS_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        try {
            await drive.files.create({
                resource: { name: backupFileName, parents: ['appDataFolder'] },
                media: { mimeType: 'application/json', body: backupData },
                fields: 'id'
            });
        } catch (appDataErr) {
            console.warn("appDataFolder upload failed, falling back to root Drive:", appDataErr.message);
            await drive.files.create({
                resource: { name: backupFileName },
                media: { mimeType: 'application/json', body: backupData },
                fields: 'id'
            });
        }
        await logActivity(req, 'Cloud Backup', `Created backup on Google Drive.`);
        res.json({ success: true, message: "Successfully backed up to Google Drive!" });

    } catch (err) {
        console.error("Drive Backup Error:", err);
        res.status(500).json({ success: false, message: "Failed to push to Google Drive: " + (err.message || "Please try again.") });
    }
});

router.post('/drive-restore', requireLogin, async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: "Admin access required." });
    }
    try {
        const adminUser = await User.findById(req.session.adminId).select('+googleDriveToken').lean();
        if (adminUser && adminUser.featureAccess && adminUser.featureAccess.allowGoogleDriveBackup === false) {
            return res.status(403).json({
                success: false,
                message: "Google Drive Cloud Restore is not enabled on your current subscription plan. Upgrade your plan or purchase the Cloud Backup Add-on."
            });
        }
        if (!adminUser || !adminUser.googleDriveToken) {
            return res.status(400).json({ success: false, message: "Google Drive not linked." });
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

router.get('/export', requireLogin, async (req, res) => {
    try {
        const adminId = req.session.adminId || req.session.userId;
        const customers = await Customer.find({ adminId: adminId }).lean();
        const admin = (await User.findById(adminId).lean()) || {};
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sundry Debtors');

        worksheet.addRow([admin.companyName || 'WGS Payment Tracker']);
        worksheet.addRow([admin.addressLine1 || '']);
        worksheet.addRow([admin.addressLine2 || '']);
        const bankLine = [
            admin.bankName ? `Bank: ${admin.bankName}` : '',
            admin.accountName ? `A/C Name: ${admin.accountName}` : '',
            admin.accountNumber ? `A/C No: ${admin.accountNumber}` : '',
            admin.ifscCode ? `IFSC: ${admin.ifscCode}` : '',
            admin.upiDetails ? `UPI: ${admin.upiDetails}` : ''
        ].filter(Boolean).join(' | ');
        worksheet.addRow([admin.addressLine3 || bankLine || '']);
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
        worksheet.addRow([]); 

        const headerRow1 = ['', '', '', 'Pending Bills', '', '(< 30 days )', '', '30 to 60 days', '', '60 to 90 days', '', '90 to 120 days', '', '120 to 150 days', '', '150 to 180 days', '', '(> 180 days )', '', 'On Account', ''];
        const headerRow2 = ['Party Name', 'Contact Person', 'Telephone No.', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'];

        const hr1 = worksheet.addRow(headerRow1);
        const hr2 = worksheet.addRow(headerRow2);

        worksheet.mergeCells('D13:E13'); 
        worksheet.mergeCells('F13:G13'); 
        worksheet.mergeCells('H13:I13'); 
        worksheet.mergeCells('J13:K13'); 
        worksheet.mergeCells('L13:M13'); 
        worksheet.mergeCells('N13:O13'); 
        worksheet.mergeCells('P13:Q13'); 
        worksheet.mergeCells('R13:S13'); 
        worksheet.mergeCells('T13:U13'); 

        [hr1, hr2].forEach(row => {
            row.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FF000000' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
        });

        hr2.getCell(1).alignment = { horizontal: 'left' };
        hr2.getCell(2).alignment = { horizontal: 'left' };
        hr2.getCell(3).alignment = { horizontal: 'left' };

        worksheet.getColumn(1).width = 35; 
        worksheet.getColumn(2).width = 25; 
        worksheet.getColumn(3).width = 15; 
        for (let i = 4; i <= 21; i++) worksheet.getColumn(i).width = 13;

        customers.forEach((c) => {
            const aging = c.aging || {};
            const totalDue = (c.totalAmount || 0) - (c.paidAmount || 0);

            worksheet.addRow([
                c.companyName || '',
                c.contactPerson || '',
                c.phone ? String(c.phone) : '',
                totalDue > 0 ? totalDue : '', '',       
                aging.under30 || '', '',                
                aging.days30to60 || '', '',             
                aging.days60to90 || '', '',             
                aging.days90to120 || '', '',            
                aging.days120to150 || '', '',           
                aging.days150to180 || '', '',           
                aging.above180 || '', '',               
                aging.onAccount || '', ''               
            ]);
        });

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 11) {
                row.eachCell(cell => { cell.font = { bold: true }; });
            }
            if (rowNumber > 14) {
                for (let i = 4; i <= 21; i++) {
                    row.getCell(i).alignment = { horizontal: 'right' };
                }
            }
        });

        const rawCompName = admin.companyName || 'WGS';
        const safeCompanyName = rawCompName.replace(/[^a-zA-Z0-9_\-]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${safeCompanyName}_Sundry_Debtors.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).json({ success: false, message: "Failed to export Excel file." });
    }
});

router.post('/import', upload.single('excelFile'), requireLogin, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

        const adminUser = await User.findById(req.session.adminId);
        if (adminUser && adminUser.featureAccess && adminUser.featureAccess.allowExcelImport === false) {
            return res.status(403).json({ success: false, message: "Bulk Excel Import is not enabled on your current subscription plan. Please upgrade your plan or contact Super Admin." });
        }
        const maxCust = adminUser ? (adminUser.maxCustomersLimit ?? 500) : 500;
        if (maxCust > 0) {
            const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
            if (currentPartyCount >= maxCust) {
                return res.status(403).json({ success: false, message: `Party/Customer limit reached (${currentPartyCount}/${maxCust}). Contact Super Admin to upgrade your quota before importing.` });
            }
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.worksheets[0];
        const rawData = [];
        sheet.eachRow({ includeEmpty: true }, row => {
            rawData.push(row.values.slice(1));
        });
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
            if (maxCust > 0) {
                const currentPartyCount = await Customer.countDocuments({ adminId: req.session.adminId });
                if (currentPartyCount + bulkOps.length > maxCust) {
                    return res.status(403).json({ success: false, message: `Importing ${bulkOps.length} parties exceeds your party limit (${currentPartyCount}/${maxCust}). Contact Super Admin to upgrade.` });
                }
            }
            await Customer.bulkWrite(bulkOps);
        }

        await logActivity(req, "Excel Import", `Imported ${importedCount} customers from Excel.`);
        res.json({ success: true, message: `Imported ${importedCount} customers successfully.` });
    } catch (err) {
        console.error("Import Error:", err);
        res.status(500).json({ success: false, message: "Import failed." });
    }
});

router.get('/backup-data', requireAdmin, async (req, res) => {
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
        res.status(500).json({ success: false, message: 'Backup failed' });
    }
});

router.post('/restore-backup', upload.single('backupFile'), requireAdmin, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file provided." });

        let backup;
        try {
            backup = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (e) {
            return res.status(400).json({ success: false, message: "Invalid backup file." });
        }

        if (!backup._meta || !backup.customers) {
            return res.status(400).json({ success: false, message: "Invalid backup file structure." });
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
            return res.status(500).json({ success: false, message: "Restore failed during customer import." });
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
        res.json({ success: true, message: "Backup restored successfully." });
    } catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ success: false, message: "Restore failed." });
    }
});

router.post('/clear-all-data', requireAdmin, async (req, res) => {
    try {
        const result = await Customer.deleteMany({ adminId: req.session.adminId });
        await logActivity(req, 'Data Cleared', `All party data permanently deleted (${result.deletedCount} parties removed).`);
        res.json({ success: true, message: "All data cleared successfully." });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to clear data.' });
    }
});

module.exports = router;
