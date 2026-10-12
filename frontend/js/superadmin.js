function escapeJsStr(str) {
    return (str || '').toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();

    const credForm = document.getElementById('superadminCredForm');
    if (credForm) {
        credForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('saNewPassword').value;
            const confirmPassword = document.getElementById('saConfirmPassword').value;
            const msgContainer = document.getElementById('settingsMsgContainer');
            if (password !== confirmPassword) {
                if (msgContainer) {
                    msgContainer.innerHTML = `<div class="alert-msg error">⚠️ New Passwords do not match. Please retype carefully.</div>`;
                } else {
                    alert('New Passwords do not match. Please retype carefully.');
                }
                return;
            }

            const currentPassword = document.getElementById('saCurrentPassword').value;
            const newUsername = document.getElementById('saUsername').value;

            try {
                const res = await apiJson('/api/superadmin/change-credentials', {
                    method: 'POST',
                    body: JSON.stringify({ newUsername, currentPassword, newPassword: password, confirmPassword })
                });
                if (res && res.success) {
                    msgContainer.innerHTML = `<div class="alert-msg success">✅ ${res.message || 'Credentials updated successfully.'}</div>`;
                    document.getElementById('saCurrentPassword').value = '';
                    document.getElementById('saNewPassword').value = '';
                    document.getElementById('saConfirmPassword').value = '';
                } else {
                    msgContainer.innerHTML = `<div class="alert-msg error">⚠️ ${(res && (res.message || res.error)) || 'Failed to update credentials.'}</div>`;
                }
            } catch (err) {
                msgContainer.innerHTML = `<div class="alert-msg error">⚠️ ${err.message}</div>`;
            }
        });
    }

    const limitsForm = document.getElementById('limitsForm');
    if (limitsForm) {
        limitsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('modalAdminId').value;
            const planName = (document.getElementById('modalPlanName')?.value || '').trim();
            const maxStaffLimit = document.getElementById('modalMaxStaff').value;
            const maxCustomersLimit = document.getElementById('modalMaxCustomers').value;
            const dailyMessageLimit = document.getElementById('modalDailyMessages').value;
            const planExpiryDate = document.getElementById('modalPlanExpiry').value;
            const status = document.getElementById('modalStatus').value;
            const featureAccess = {
                allowGoogleDriveBackup: document.getElementById('modalAllowGDrive')?.checked !== false,
                allowExcelImport: document.getElementById('modalAllowExcel')?.checked !== false,
                allowPdfExport: document.getElementById('modalAllowPdf')?.checked !== false
            };

            try {
                const res = await apiJson(`/api/superadmin/update-limits/${id}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        planName, maxStaffLimit, maxCustomersLimit, dailyMessageLimit, planExpiryDate, status, featureAccess
                    })
                });
                if (res && !res.success) {
                    alert('Error updating limits: ' + (res.message || 'Unknown error'));
                    return;
                }
                closeLimitsModal();
                loadDashboard();
            } catch (err) {
                alert('Error updating limits: ' + err.message);
            }
        });
    }

    // Immediately render default plans & add-ons so the editor is never empty
    if (!currentPlanConfigState) {
        currentPlanConfigState = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
        renderPlansEditor(currentPlanConfigState);
    }
});

const DEFAULT_SUPERADMIN_PLAN_CONFIG = {
    razorpayKeyId: '',
    razorpayKeySecret: '',
    whatsappSalesNumber: '917021056404',
    currency: 'INR',
    plans: [
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
    ],
    addons: [
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
    ]
};

let currentPlanConfigState = null;

async function loadDashboard() {
    try {
        const data = await apiJson('/api/superadmin/dashboard');
        if (data && data.success === false) {
            throw new Error(data.message || 'Super Admin access required');
        }
        
        const pendingUsers = data.pendingUsers || [];
        const approvedUsers = data.approvedUsers || [];
        const suspendedUsers = data.suspendedUsers || [];
        const rejectedUsers = data.rejectedUsers || [];

        document.getElementById('statPendingCount').textContent = pendingUsers.length;
        document.getElementById('tabPendingCount').textContent = pendingUsers.length;

        document.getElementById('statApprovedCount').textContent = approvedUsers.length;
        document.getElementById('tabApprovedCount').textContent = approvedUsers.length;

        document.getElementById('statSuspendedCount').textContent = suspendedUsers.length;
        document.getElementById('tabSuspendedCount').textContent = suspendedUsers.length;

        document.getElementById('statRejectedCount').textContent = rejectedUsers.length;
        document.getElementById('tabRejectedCount').textContent = rejectedUsers.length;

        document.getElementById('saUsername').value = data.superadminUsername || '';

        renderPending(pendingUsers);
        renderApproved(approvedUsers);
        renderSuspended(suspendedUsers);
        renderRejected(rejectedUsers);

        if (data.planConfig && Array.isArray(data.planConfig.plans) && data.planConfig.plans.length > 0) {
            currentPlanConfigState = data.planConfig;
            renderPlansEditor(currentPlanConfigState);
        } else {
            await loadSubscriptionConfigFallback();
        }

    } catch (error) {
        console.error('Error loading dashboard:', error);
        if (error.message.includes('Session expired') || error.message.includes('Super Admin access required') || error.message.includes('401') || error.message.includes('403')) {
            window.location.href = 'login.html';
        } else {
            alert('Error loading dashboard: ' + error.message);
        }
    }
}

async function loadSubscriptionConfigFallback() {
    try {
        const res = await apiJson('/api/superadmin/subscription-settings');
        if (res && res.success && res.planConfig && Array.isArray(res.planConfig.plans) && res.planConfig.plans.length > 0) {
            currentPlanConfigState = res.planConfig;
            renderPlansEditor(currentPlanConfigState);
            return;
        }
    } catch (e) {}
    if (!currentPlanConfigState) {
        currentPlanConfigState = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
    }
    renderPlansEditor(currentPlanConfigState);
}

window.resetDefaultPlansAndAddons = function() {
    if (!confirm('Reset the form fields below to the default 3 Yearly Plans (Basic, Pro, Customized) and 5 Yearly Add-ons? (Click Save afterwards to apply to the landing page.)')) return;
    const merged = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
    merged.razorpayKeyId = document.getElementById('rzpKeyIdInput')?.value || '';
    merged.razorpayKeySecret = document.getElementById('rzpKeySecretInput')?.value || '';
    merged.whatsappSalesNumber = document.getElementById('whatsappSalesInput')?.value || '917021056404';
    currentPlanConfigState = merged;
    renderPlansEditor(currentPlanConfigState);
};

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function formatDateLong(dateStr) {
    if (!dateStr) return 'Active';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
}

async function actionApprove(id) {
    try {
        const res = await apiJson(`/api/superadmin/approve/${id}`, { method: 'POST' });
        if (res && !res.success) { alert(res.message || 'Failed to approve'); return; }
        loadDashboard();
    } catch (err) { alert(err.message); }
}

async function actionReject(id, username, isRevoke = false) {
    const promptText = isRevoke ? `Revoke access for ${username}?` : `Reject request for ${username}?`;
    if (!confirm(promptText)) return;
    try {
        const res = await apiJson(`/api/superadmin/reject/${id}`, { method: 'POST' });
        if (res && !res.success) { alert(res.message || 'Failed to reject'); return; }
        loadDashboard();
    } catch (err) { alert(err.message); }
}

async function actionToggleSuspend(id, actionStr, username) {
    if (!confirm(`${actionStr === 'suspend' ? 'Suspend' : 'Resume'} account for ${username}?`)) return;
    try {
        const res = await apiJson(`/api/superadmin/${actionStr}/${id}`, { 
            method: 'POST'
        });
        if (res && !res.success) { alert(res.message || 'Action failed'); return; }
        loadDashboard();
    } catch (err) { alert(err.message); }
}

async function handleLogout() {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (err) { console.error(err); }
    window.location.href = 'login.html';
}

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById(tabId);
    if (target) target.style.display = 'block';

    document.querySelectorAll('.tab-btn').forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes("'" + tabId + "'")) {
            btn.classList.add('active');
        }
    });
}

function togglePassword(icon) {
    const input = icon.previousElementSibling;
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerText = '🔒';
    } else {
        input.type = 'password';
        icon.innerText = '👁️';
    }
}

function closeLimitsModal() {
    document.getElementById('limitsModal').style.display = 'none';
}

function openLimitsModalFromData(id, username, maxStaff, maxParties, dailyMsgs, planExpiry, status, rawStaff, planName, rawFeatureAccess) {
    document.getElementById('modalAdminId').value = id;
    document.getElementById('limitAdminName').innerText = username;
    const planNameInput = document.getElementById('modalPlanName');
    if (planNameInput) planNameInput.value = (planName && planName !== 'undefined' && planName !== 'null') ? planName : 'Custom / Standard';
    document.getElementById('modalMaxStaff').value = (maxStaff !== undefined && maxStaff !== null && maxStaff !== 'undefined' && maxStaff !== 'null') ? maxStaff : 5;
    document.getElementById('modalMaxCustomers').value = (maxParties !== undefined && maxParties !== null && maxParties !== 'undefined' && maxParties !== 'null') ? maxParties : 500;
    document.getElementById('modalDailyMessages').value = (dailyMsgs !== undefined && dailyMsgs !== null && dailyMsgs !== 'undefined' && dailyMsgs !== 'null') ? dailyMsgs : 100;
    document.getElementById('modalStatus').value = status || 'approved';

    let fa = { allowGoogleDriveBackup: true, allowExcelImport: true, allowPdfExport: true };
    try {
        if (typeof rawFeatureAccess === 'string' && rawFeatureAccess !== 'undefined' && rawFeatureAccess !== 'null') {
            fa = JSON.parse(decodeURIComponent(rawFeatureAccess));
        } else if (rawFeatureAccess && typeof rawFeatureAccess === 'object') {
            fa = rawFeatureAccess;
        }
    } catch (e) {}

    const gdriveChk = document.getElementById('modalAllowGDrive');
    const excelChk = document.getElementById('modalAllowExcel');
    const pdfChk = document.getElementById('modalAllowPdf');
    if (gdriveChk) gdriveChk.checked = fa.allowGoogleDriveBackup !== false;
    if (excelChk) excelChk.checked = fa.allowExcelImport !== false;
    if (pdfChk) pdfChk.checked = fa.allowPdfExport !== false;
    
    if (planExpiry && planExpiry !== 'null' && planExpiry !== 'undefined') {
        const d = new Date(planExpiry);
        if (!isNaN(d.getTime())) {
            document.getElementById('modalPlanExpiry').value = d.toISOString().split('T')[0];
        } else {
            document.getElementById('modalPlanExpiry').value = '';
        }
    } else {
        document.getElementById('modalPlanExpiry').value = '';
    }

    let staffList = [];
    try {
        if (typeof rawStaff === 'string' && rawStaff !== 'undefined' && rawStaff !== 'null') {
            staffList = JSON.parse(decodeURIComponent(rawStaff));
        } else {
            staffList = rawStaff || [];
        }
    } catch(e) {
        staffList = [];
    }

    const badge = document.getElementById('modalStaffBadge');
    if (badge) badge.innerText = staffList.length + ' Staff';

    const container = document.getElementById('modalStaffList');
    if (container) {
        if (!staffList || staffList.length === 0) {
            container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:12px; text-align:center;">No staff members created under this admin yet.</div>';
        } else {
            let html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
            html += '<thead><tr style="background:#f1f5f9; color:var(--text-muted); font-size:11px; text-transform:uppercase;"><th style="padding:8px 12px; text-align:left;">Staff Member</th><th style="padding:8px 12px; text-align:left;">Password</th><th style="padding:8px 12px; text-align:center;">Role</th></tr></thead><tbody>';
            staffList.forEach(s => {
                html += '<tr style="border-top:1px solid #f1f5f9;">';
                html += '<td style="padding:8px 12px; font-weight:700; color:var(--text-dark);">👤 ' + s.username + '</td>';
                html += '<td style="padding:8px 12px;"><span class="pwd-mask-text">Managed securely</span></td>';
                html += '<td style="padding:8px 12px; text-align:center;"><span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:8px; font-size:10px; font-weight:700;">STAFF</span></td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        }
    }

    document.getElementById('limitsModal').style.display = 'flex';
}

window.applyPlanPresetToModal = function(planId) {
    const cfg = currentPlanConfigState || DEFAULT_SUPERADMIN_PLAN_CONFIG;
    const plans = (cfg && cfg.plans) || DEFAULT_SUPERADMIN_PLAN_CONFIG.plans;
    const plan = plans.find(p => p.id === planId) || plans[0];
    if (!plan) return;

    const planNameInput = document.getElementById('modalPlanName');
    if (planNameInput) planNameInput.value = plan.name || 'Basic Plan';

    document.getElementById('modalMaxCustomers').value = plan.maxCustomersLimit ?? 250;
    document.getElementById('modalMaxStaff').value = plan.maxStaffLimit ?? 2;
    document.getElementById('modalDailyMessages').value = plan.dailyMessageLimit ?? 50;

    const fa = plan.featureAccess || {};
    const gdriveChk = document.getElementById('modalAllowGDrive');
    const excelChk = document.getElementById('modalAllowExcel');
    const pdfChk = document.getElementById('modalAllowPdf');
    if (gdriveChk) gdriveChk.checked = fa.allowGoogleDriveBackup !== false;
    if (excelChk) excelChk.checked = fa.allowExcelImport !== false;
    if (pdfChk) pdfChk.checked = fa.allowPdfExport !== false;

    const expEl = document.getElementById('modalPlanExpiry');
    if (expEl && !expEl.value) {
        const d = new Date();
        d.setMonth(d.getMonth() + (Number(plan.durationMonths) || 12));
        expEl.value = d.toISOString().split('T')[0];
    }
};

window.extendModalExpiryOneYear = function() {
    const expEl = document.getElementById('modalPlanExpiry');
    if (!expEl) return;
    let base = new Date();
    if (expEl.value) {
        const parsed = new Date(expEl.value);
        if (!isNaN(parsed.getTime()) && parsed > base) {
            base = parsed;
        }
    }
    base.setMonth(base.getMonth() + 12);
    expEl.value = base.toISOString().split('T')[0];
};

function buildPlanBadgeHtml(u) {
    const planLabel = u.planName || 'Standard';
    const addons = Array.isArray(u.activeAddons) && u.activeAddons.length
        ? `<div style="font-size:10.5px; color:#4f46e5; font-weight:700; margin-top:3px;">🧩 +${u.activeAddons.length} Add-on${u.activeAddons.length > 1 ? 's' : ''}: ${u.activeAddons.map(a => a.name).join(', ')}</div>`
        : '';
    const payLine = u.lastPaymentId
        ? `<div style="font-size:10.5px; color:#059669; font-weight:700; margin-top:2px;">💳 Paid ₹${Number(u.lastAmountPaid || 0).toLocaleString('en-IN')} (${u.lastPaymentId})</div>`
        : (u.lastAmountPaid > 0 ? `<div style="font-size:10.5px; color:#d97706; font-weight:700; margin-top:2px;">🧾 Quoted: ₹${Number(u.lastAmountPaid).toLocaleString('en-IN')}</div>` : '');
    return `
        <div style="margin-top:4px;">
            <span style="display:inline-block; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:800;">💎 ${planLabel}</span>
            ${addons}
            ${payLine}
        </div>
    `;
}

function renderPending(users) {
    const tbody = document.getElementById('pendingTbody');
    if (!users.length) {
        document.getElementById('pendingWrapper').innerHTML = '<div class="empty-state">🎉 No pending registration requests. All clear!</div>';
        return;
    }
    
    if (document.getElementById('pendingWrapper').querySelector('.empty-state')) {
        document.getElementById('pendingWrapper').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>ADMIN USER</th>
                    <th>CONTACT INFO</th>
                    <th>PASSWORD</th>
                    <th>REQUESTED DATE</th>
                    <th>ACTION</th>
                </tr>
            </thead>
            <tbody id="pendingTbody"></tbody>
        </table>`;
    }
    
    let html = '';
    users.forEach(u => {
        const dispEmail = u.companyEmail || u.email;
        const dispPhone = u.contactNo || u.phone;
        const contactHtml = [];
        if (u.companyName) contactHtml.push(`<div class="contact-item" style="font-weight:700; color:var(--text-dark);">🏢 ${u.companyName}</div>`);
        if (dispEmail) contactHtml.push(`<a href="mailto:${dispEmail}" class="contact-item">✉️ ${dispEmail}</a>`);
        if (dispPhone) contactHtml.push(`<a href="tel:${dispPhone}" class="contact-item">📞 ${dispPhone}</a>`);
        if (!u.companyName && !dispEmail && !dispPhone) contactHtml.push(`<span style="color:var(--text-muted);">No contact info</span>`);
        const rawStaff = encodeURIComponent(JSON.stringify(u.staffList || []));
        const rawFA = encodeURIComponent(JSON.stringify(u.featureAccess || {}));

        html += `
            <tr>
                <td>
                    <div class="admin-user-cell">
                        <div class="avatar-container">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=3b82f6&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar">
                            <span class="online-dot" style="background:#f59e0b;"></span>
                        </div>
                        <div>
                            <div class="username-title">${u.username}</div>
                            ${u.companyName ? `<div style="font-size:11px; color:var(--text-muted); font-weight:600;">${u.companyName}</div>` : ''}
                            <span class="status-badge-pill pending">PENDING</span>
                            ${buildPlanBadgeHtml(u)}
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-info-block">
                        ${contactHtml.join('')}
                        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
                            Quotas: <strong>${u.maxCustomersLimit || 500}</strong> Parties · <strong>${u.maxStaffLimit || 5}</strong> Staff · <strong>${u.dailyMessageLimit || 100}</strong> Msgs
                        </div>
                    </div>
                </td>
                <td>
                    <div class="password-pill-container">
                        <span class="pwd-mask-text">Managed securely</span>
                    </div>
                </td>
                <td>
                    <div style="font-size:12px; color:var(--text-muted);">
                        ${formatDate(u.requestedAt)}
                    </div>
                </td>
                <td>
                    <div class="action-btn-group">
                        <button type="button" class="btn-action-soft btn-action-approve" style="width:100%;" onclick="actionApprove('${u._id}')">Approve ✅</button>
                        <button type="button" class="btn-action-soft btn-action-manage" style="width:100%;"
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}')">⚙️ Edit Plan & Quotas</button>
                        <button type="button" class="btn-action-soft btn-action-revoke" style="width:100%;" onclick="actionReject('${u._id}', '${escapeJsStr(u.username)}', false)">Reject ❌</button>
                    </div>
                </td>
            </tr>
        `;
    });
    document.getElementById('pendingTbody').innerHTML = html;
}

function renderApproved(users) {
    const tbody = document.getElementById('approvedTbody');
    if (!users.length) {
        document.getElementById('approvedWrapper').innerHTML = '<div class="empty-state">No approved admins found.</div>';
        return;
    }
    
    if (document.getElementById('approvedWrapper').querySelector('.empty-state')) {
        document.getElementById('approvedWrapper').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>ADMIN USER</th>
                    <th>CONTACT INFO</th>
                    <th>USAGE METRICS</th>
                    <th>PASSWORD</th>
                    <th>APPROVED / EXPIRY</th>
                    <th>ACTION</th>
                </tr>
            </thead>
            <tbody id="approvedTbody"></tbody>
        </table>`;
    }
    
    let html = '';
    users.forEach(u => {
        const maxS = u.maxStaffLimit === 0 ? 99999 : (u.maxStaffLimit || 5);
        const maxP = u.maxCustomersLimit === 0 ? 99999 : (u.maxCustomersLimit || 500);
        const maxM = u.dailyMessageLimit === 0 ? 99999 : (u.dailyMessageLimit || 100);
        const sPct = Math.min(100, Math.round(((u.staffCount || 0) / maxS) * 100));
        const pPct = Math.min(100, Math.round(((u.partyCount || 0) / maxP) * 100));
        const mPct = Math.min(100, Math.round(((u.dailyMessageCount || 0) / maxM) * 100));

        const dispEmail = u.companyEmail || u.email;
        const dispPhone = u.contactNo || u.phone;
        const contactHtml = [];
        if (u.companyName) contactHtml.push(`<div class="contact-item" style="font-weight:700; color:var(--text-dark);">🏢 ${u.companyName}</div>`);
        if (dispEmail) contactHtml.push(`<a href="mailto:${dispEmail}" class="contact-item">✉️ ${dispEmail}</a>`);
        if (dispPhone) contactHtml.push(`<a href="tel:${dispPhone}" class="contact-item">📞 ${dispPhone}</a>`);
        if (!u.companyName && !dispEmail && !dispPhone) contactHtml.push(`<span style="color:var(--text-muted);">No contact info</span>`);

        const rawStaff = encodeURIComponent(JSON.stringify(u.staffList || []));
        const rawFA = encodeURIComponent(JSON.stringify(u.featureAccess || {}));

        html += `
            <tr>
                <td>
                    <div class="admin-user-cell">
                        <div class="avatar-container">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=2563eb&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar">
                            <span class="online-dot"></span>
                        </div>
                        <div>
                            <div class="username-title">${u.username}</div>
                            ${u.companyName ? `<div style="font-size:11px; color:var(--text-muted); font-weight:600;">${u.companyName}</div>` : ''}
                            <span class="status-badge-pill approved">APPROVED</span>
                            ${buildPlanBadgeHtml(u)}
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-info-block">
                        ${contactHtml.join('')}
                    </div>
                </td>
                <td>
                    <div class="metrics-block">
                        <div class="metric-progress-item">
                            <div class="metric-row-header">
                                <span>👥 Staff:</span>
                                <span>${u.staffCount || 0} / ${u.maxStaffLimit === 0 ? '∞' : (u.maxStaffLimit || 5)}</span>
                            </div>
                            <div class="progress-track">
                                <div class="progress-fill-bar" style="width: ${sPct}%;"></div>
                            </div>
                        </div>

                        <div class="metric-progress-item">
                            <div class="metric-row-header">
                                <span>📊 Parties:</span>
                                <span>${u.partyCount || 0} / ${u.maxCustomersLimit === 0 ? '∞' : (u.maxCustomersLimit || 500)}</span>
                            </div>
                            <div class="progress-track">
                                <div class="progress-fill-bar" style="width: ${pPct}%; background: linear-gradient(90deg, #34d399, #059669);"></div>
                            </div>
                        </div>

                        <div class="metric-progress-item">
                            <div class="metric-row-header">
                                <span>💬 Msgs:</span>
                                <span>${u.dailyMessageCount || 0} / ${u.dailyMessageLimit === 0 ? '∞' : (u.dailyMessageLimit || 100)}</span>
                            </div>
                            <div class="progress-track">
                                <div class="progress-fill-bar" style="width: ${mPct}%; background: linear-gradient(90deg, #f59e0b, #d97706);"></div>
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="password-pill-container">
                        <span class="pwd-mask-text">Managed securely</span>
                    </div>
                </td>
                <td>
                    <div style="font-size:12px; color:var(--text-dark);">
                        <div><strong>Approved:</strong> ${formatDateLong(u.approvedAt)}</div>
                        <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">
                            <strong>Expires:</strong> ${u.planExpiryDate ? formatDate(u.planExpiryDate) : '(Lifetime)'}
                        </div>
                    </div>
                </td>
                <td>
                    <div class="action-btn-group">
                        <button type="button" class="btn-action-soft btn-action-suspend" style="width:100%;" onclick="actionToggleSuspend('${u._id}', 'suspend', '${escapeJsStr(u.username)}')">⊗ Suspend</button>
                        <button type="button" class="btn-action-soft btn-action-manage"
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}')">⊕ Manage Plan & Access</button>
                        <button type="button" class="btn-action-soft btn-action-revoke" style="width:100%;" onclick="actionReject('${u._id}', '${escapeJsStr(u.username)}', true)">⊘ Revoke</button>
                    </div>
                </td>
            </tr>
        `;
    });
    document.getElementById('approvedTbody').innerHTML = html;
}

function renderSuspended(users) {
    const tbody = document.getElementById('suspendedTbody');
    if (!users.length) {
        document.getElementById('suspendedWrapper').innerHTML = '<div class="empty-state">No suspended admin accounts.</div>';
        return;
    }
    
    if (document.getElementById('suspendedWrapper').querySelector('.empty-state')) {
        document.getElementById('suspendedWrapper').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>ADMIN USER</th>
                    <th>CONTACT INFO</th>
                    <th>PRESERVED METRICS</th>
                    <th>PASSWORD</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                </tr>
            </thead>
            <tbody id="suspendedTbody"></tbody>
        </table>`;
    }
    
    let html = '';
    users.forEach(u => {
        const dispEmail = u.companyEmail || u.email;
        const dispPhone = u.contactNo || u.phone;
        const contactHtml = [];
        if (u.companyName) contactHtml.push(`<div class="contact-item" style="font-weight:700; color:var(--text-dark);">🏢 ${u.companyName}</div>`);
        if (dispEmail) contactHtml.push(`<a href="mailto:${dispEmail}" class="contact-item">✉️ ${dispEmail}</a>`);
        if (dispPhone) contactHtml.push(`<a href="tel:${dispPhone}" class="contact-item">📞 ${dispPhone}</a>`);
        if (!u.companyName && !dispEmail && !dispPhone) contactHtml.push(`<span style="color:var(--text-muted);">No contact info</span>`);

        const rawStaff = encodeURIComponent(JSON.stringify(u.staffList || []));
        const rawFA = encodeURIComponent(JSON.stringify(u.featureAccess || {}));

        html += `
            <tr>
                <td>
                    <div class="admin-user-cell">
                        <div class="avatar-container">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=6b21a8&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar">
                            <span class="online-dot" style="background:#9333ea;"></span>
                        </div>
                        <div>
                            <div class="username-title">${u.username}</div>
                            ${u.companyName ? `<div style="font-size:11px; color:var(--text-muted); font-weight:600;">${u.companyName}</div>` : ''}
                            <span class="status-badge-pill suspended">SUSPENDED</span>
                            ${buildPlanBadgeHtml(u)}
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-info-block">
                        ${contactHtml.join('')}
                    </div>
                </td>
                <td>
                    <div style="font-size:12px; color:var(--text-dark);">
                        <div>👥 Staff: <strong>${u.staffCount || 0}</strong></div>
                        <div>📊 Parties: <strong>${u.partyCount || 0}</strong></div>
                    </div>
                </td>
                <td>
                    <div class="password-pill-container">
                        <span class="pwd-mask-text">Managed securely</span>
                    </div>
                </td>
                <td>
                    <div style="font-size:12px; color:#6b21a8; font-weight:700;">
                        ⏸️ Access Paused
                        <div style="font-size:11px; color:var(--text-muted); font-weight:normal;">All data safe & preserved</div>
                    </div>
                </td>
                <td>
                    <div class="action-btn-group">
                        <button type="button" class="btn-action-soft btn-action-approve" style="width:100%;" onclick="actionToggleSuspend('${u._id}', 'resume', '${escapeJsStr(u.username)}')">▶️ Resume Account</button>
                        <button type="button" class="btn-action-soft btn-action-manage"
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}')">⚙️ Plan & Access</button>
                    </div>
                </td>
            </tr>
        `;
    });
    document.getElementById('suspendedTbody').innerHTML = html;
}

function renderRejected(users) {
    const tbody = document.getElementById('rejectedTbody');
    if (!users.length) {
        document.getElementById('rejectedWrapper').innerHTML = '<div class="empty-state">No rejected requests.</div>';
        return;
    }
    
    if (document.getElementById('rejectedWrapper').querySelector('.empty-state')) {
        document.getElementById('rejectedWrapper').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>USER</th>
                    <th>CONTACT INFO</th>
                    <th>PASSWORD</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                </tr>
            </thead>
            <tbody id="rejectedTbody"></tbody>
        </table>`;
    }
    
    let html = '';
    users.forEach(u => {
        const dispEmail = u.companyEmail || u.email;
        const dispPhone = u.contactNo || u.phone;
        const contactHtml = [];
        if (u.companyName) contactHtml.push(`<div class="contact-item" style="font-weight:700; color:var(--text-dark);">🏢 ${u.companyName}</div>`);
        if (dispEmail) contactHtml.push(`<div class="contact-item">✉️ ${dispEmail}</div>`);
        if (dispPhone) contactHtml.push(`<div class="contact-item">📞 ${dispPhone}</div>`);

        html += `
            <tr>
                <td>
                    <div class="admin-user-cell">
                        <div class="avatar-container">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=ef4444&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar">
                        </div>
                        <div>
                            <div class="username-title">${u.username}</div>
                            ${u.companyName ? `<div style="font-size:11px; color:var(--text-muted); font-weight:600;">${u.companyName}</div>` : ''}
                            <span class="status-badge-pill rejected">REJECTED</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-info-block">
                        ${contactHtml.join('')}
                    </div>
                </td>
                <td>
                    <div class="password-pill-container">
                        <span class="pwd-mask-text">Managed securely</span>
                    </div>
                </td>
                <td>
                    <span class="status-badge-pill rejected">Rejected</span>
                </td>
                <td>
                    <button type="button" class="btn-action-soft btn-action-approve" onclick="actionApprove('${u._id}')">Approve Now ✅</button>
                </td>
            </tr>
        `;
    });
    document.getElementById('rejectedTbody').innerHTML = html;
}

// ── SUBSCRIPTION PLANS, ADD-ONS & RAZORPAY EDITOR ──
function renderPlansEditor(config) {
    if (!config) return;

    const rzpKeyIdEl = document.getElementById('rzpKeyIdInput');
    const rzpKeySecretEl = document.getElementById('rzpKeySecretInput');
    const waSalesEl = document.getElementById('whatsappSalesInput');
    const rzpBadge = document.getElementById('rzpStatusBadge');

    if (rzpKeyIdEl) rzpKeyIdEl.value = config.razorpayKeyId || '';
    if (rzpKeySecretEl) rzpKeySecretEl.value = config.razorpayKeySecret || '';
    if (waSalesEl) waSalesEl.value = config.whatsappSalesNumber || '917021056404';

    if (rzpBadge) {
        if (config.razorpayKeyId && config.razorpayKeySecret) {
            const isLive = config.razorpayKeyId.startsWith('rzp_live_');
            rzpBadge.style.background = '#dcfce7';
            rzpBadge.style.color = '#166534';
            rzpBadge.textContent = isLive ? '🟢 Razorpay LIVE Keys Active' : '🟢 Razorpay TEST Keys Active';
        } else {
            rzpBadge.style.background = '#fef3c7';
            rzpBadge.style.color = '#b45309';
            rzpBadge.textContent = '⚠️ Razorpay Keys Not Set (Request Mode)';
        }
    }

    const plansGrid = document.getElementById('plansEditorGrid');
    if (plansGrid) {
        const plans = config.plans || [];
        plansGrid.innerHTML = plans.map((plan, idx) => {
            const isCustom = Boolean(plan.isCustom || plan.id === 'customized');
            const fa = plan.featureAccess || {};
            const featuresText = (plan.features || []).join('\n');
            return `
                <div class="plan-edit-card ${plan.isPopular ? 'popular' : ''}" data-plan-idx="${idx}" data-plan-id="${escapeJsStr(plan.id)}">
                    <div class="plan-edit-card-header">
                        <span class="plan-tier-tag">${isCustom ? '🎛️ Tier 3: Customized' : (idx === 0 ? '🌱 Tier 1: Basic' : '🚀 Tier 2: Pro')}</span>
                        <label style="font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer;">
                            <input type="checkbox" class="plan-popular-chk" ${plan.isPopular ? 'checked' : ''}> Highlight Popular
                        </label>
                    </div>

                    <div class="pm-row-2">
                        <div class="pm-field">
                            <label>Plan Title</label>
                            <input type="text" class="plan-name-inp" value="${escapeJsStr(plan.name || '')}" required>
                        </div>
                        <div class="pm-field">
                            <label>Top Badge Text</label>
                            <input type="text" class="plan-badge-inp" value="${escapeJsStr(plan.badge || '')}">
                        </div>
                    </div>

                    <div class="pm-field">
                        <label>Subtitle / Tagline</label>
                        <input type="text" class="plan-tagline-inp" value="${escapeJsStr(plan.tagline || '')}">
                    </div>

                    <div class="pm-row-2">
                        <div class="pm-field">
                            <label>${isCustom ? 'Starting Yearly Price (₹ / Yr)' : 'Yearly Plan Price (₹ / Yr)'}</label>
                            <input type="number" class="plan-price-inp" min="0" value="${Number(plan.price) || 0}">
                        </div>
                        <div class="pm-field">
                            <label>Default Validity (Months)</label>
                            <input type="number" class="plan-duration-inp" min="1" max="60" value="${Number(plan.durationMonths) || 12}">
                        </div>
                    </div>

                    <div class="pm-row-3">
                        <div class="pm-field">
                            <label>${isCustom ? 'Default Parties' : 'Max Parties'}</label>
                            <input type="number" class="plan-parties-inp" min="0" value="${Number(plan.maxCustomersLimit) || 0}">
                        </div>
                        <div class="pm-field">
                            <label>${isCustom ? 'Default Staff' : 'Max Staff'}</label>
                            <input type="number" class="plan-staff-inp" min="0" value="${Number(plan.maxStaffLimit) || 0}">
                        </div>
                        <div class="pm-field">
                            <label>${isCustom ? 'Default Msgs/Day' : 'Msgs / Day'}</label>
                            <input type="number" class="plan-msgs-inp" min="0" value="${Number(plan.dailyMessageLimit) || 0}">
                        </div>
                    </div>

                    ${isCustom ? `
                    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px; margin-bottom:12px;">
                        <span class="access-checks-title" style="color:#1e40af;">🧮 Custom Plan Calculator Unit Rates (₹ / Year)</span>
                        <div class="pm-row-2">
                            <div class="pm-field" style="margin-bottom:8px;">
                                <label>Base Platform Fee (₹/Yr)</label>
                                <input type="number" class="plan-base-price-inp" min="0" value="${Number(plan.basePrice ?? 2999)}">
                            </div>
                            <div class="pm-field" style="margin-bottom:8px;">
                                <label>Per 100 Parties (₹/Yr)</label>
                                <input type="number" class="plan-rate-parties-inp" min="0" value="${Number(plan.pricePer100Parties ?? 500)}">
                            </div>
                        </div>
                        <div class="pm-row-2">
                            <div class="pm-field" style="margin-bottom:0;">
                                <label>Per Staff Account (₹/Yr)</label>
                                <input type="number" class="plan-rate-staff-inp" min="0" value="${Number(plan.pricePerStaff ?? 400)}">
                            </div>
                            <div class="pm-field" style="margin-bottom:0;">
                                <label>Per 50 Daily Msgs (₹/Yr)</label>
                                <input type="number" class="plan-rate-msgs-inp" min="0" value="${Number(plan.pricePer50Messages ?? 300)}">
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <div class="access-checks-box">
                        <span class="access-checks-title">🔐 Included Feature Access</span>
                        <label class="access-check-row">
                            <input type="checkbox" class="plan-fa-gdrive" ${fa.allowGoogleDriveBackup !== false ? 'checked' : ''}>
                            <span>☁️ Google Drive Cloud Backup</span>
                        </label>
                        <label class="access-check-row">
                            <input type="checkbox" class="plan-fa-excel" ${fa.allowExcelImport !== false ? 'checked' : ''}>
                            <span>📥 Bulk Excel Party Import</span>
                        </label>
                        <label class="access-check-row">
                            <input type="checkbox" class="plan-fa-pdf" ${fa.allowPdfExport !== false ? 'checked' : ''}>
                            <span>📄 Branded PDF Statement Export</span>
                        </label>
                    </div>

                    <div class="pm-field" style="margin-bottom:0;">
                        <label>Bullet Features Shown on Card (1 per line)</label>
                        <textarea class="plan-features-txt">${featuresText}</textarea>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderAddonsEditorList(config.addons || []);
}

function renderAddonsEditorList(addons) {
    const container = document.getElementById('addonsEditorList');
    if (!container) return;

    if (!addons.length) {
        container.innerHTML = `<div style="padding:18px; text-align:center; color:var(--text-muted); font-size:13px;">No add-ons configured. Click "+ Add New Add-on" to create one.</div>`;
        return;
    }

    container.innerHTML = addons.map((addon, idx) => `
        <div class="addon-edit-row" data-addon-id="${escapeJsStr(addon.id || `addon_${idx}`)}">
            <div class="pm-field" style="margin:0;">
                <label>Add-on Name</label>
                <input type="text" class="addon-name-inp" value="${escapeJsStr(addon.name || '')}" placeholder="e.g. +500 Extra Parties">
            </div>
            <div class="pm-field" style="margin:0;">
                <label>Description</label>
                <input type="text" class="addon-desc-inp" value="${escapeJsStr(addon.description || '')}" placeholder="Short benefit description">
            </div>
            <div class="pm-field" style="margin:0;">
                <label>Boost Type</label>
                <select class="addon-type-sel">
                    <option value="parties" ${addon.type === 'parties' ? 'selected' : ''}>📊 Extra Parties</option>
                    <option value="staff" ${addon.type === 'staff' ? 'selected' : ''}>👥 Extra Staff</option>
                    <option value="messages" ${addon.type === 'messages' ? 'selected' : ''}>💬 Extra Daily Msgs</option>
                    <option value="gdrive" ${addon.type === 'gdrive' ? 'selected' : ''}>☁️ Cloud Backup Unlock</option>
                    <option value="duration" ${addon.type === 'duration' ? 'selected' : ''}>📅 Extra Validity (Months)</option>
                </select>
            </div>
            <div class="pm-field" style="margin:0;">
                <label>Boost Value</label>
                <input type="number" class="addon-val-inp" min="0" value="${Number(addon.value) || 0}">
            </div>
            <div class="pm-field" style="margin:0;">
                <label>Price (₹)</label>
                <input type="number" class="addon-price-inp" min="0" value="${Number(addon.price) || 0}">
            </div>
            <div style="display:flex; align-items:center; gap:8px; padding-bottom:2px;">
                <button type="button" onclick="this.closest('.addon-edit-row').remove()" style="padding:9px 12px; background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; border-radius:9px; font-weight:700; cursor:pointer;" title="Remove Add-on">🗑️</button>
            </div>
        </div>
    `).join('');
}

function addNewAddonRow() {
    const container = document.getElementById('addonsEditorList');
    if (!container) return;
    if (container.querySelector('.addon-edit-row') === null) {
        container.innerHTML = '';
    }
    const row = document.createElement('div');
    row.className = 'addon-edit-row';
    row.setAttribute('data-addon-id', 'addon_' + Date.now());
    row.innerHTML = `
        <div class="pm-field" style="margin:0;">
            <label>Add-on Name</label>
            <input type="text" class="addon-name-inp" value="+250 Extra Parties" placeholder="e.g. +500 Extra Parties">
        </div>
        <div class="pm-field" style="margin:0;">
            <label>Description</label>
            <input type="text" class="addon-desc-inp" value="Expand your customer ledger limit" placeholder="Short benefit description">
        </div>
        <div class="pm-field" style="margin:0;">
            <label>Boost Type</label>
            <select class="addon-type-sel">
                <option value="parties" selected>📊 Extra Parties</option>
                <option value="staff">👥 Extra Staff</option>
                <option value="messages">💬 Extra Daily Msgs</option>
                <option value="gdrive">☁️ Cloud Backup Unlock</option>
                <option value="duration">📅 Extra Validity (Months)</option>
            </select>
        </div>
        <div class="pm-field" style="margin:0;">
            <label>Boost Value</label>
            <input type="number" class="addon-val-inp" min="0" value="250">
        </div>
        <div class="pm-field" style="margin:0;">
            <label>Price (₹)</label>
            <input type="number" class="addon-price-inp" min="0" value="299">
        </div>
        <div style="display:flex; align-items:center; gap:8px; padding-bottom:2px;">
            <button type="button" onclick="this.closest('.addon-edit-row').remove()" style="padding:9px 12px; background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; border-radius:9px; font-weight:700; cursor:pointer;" title="Remove Add-on">🗑️</button>
        </div>
    `;
    container.appendChild(row);
}

async function saveSubscriptionSettings() {
    const btn = document.getElementById('btnSavePlansConfig');
    const alertBox = document.getElementById('plansSaveAlert');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Saving Plans & Razorpay Settings...';
    }

    try {
        const razorpayKeyId = (document.getElementById('rzpKeyIdInput')?.value || '').trim();
        const razorpayKeySecret = (document.getElementById('rzpKeySecretInput')?.value || '').trim();
        const whatsappSalesNumber = (document.getElementById('whatsappSalesInput')?.value || '').trim();

        const planCards = Array.from(document.querySelectorAll('#plansEditorGrid .plan-edit-card'));
        const plans = planCards.map((card, idx) => {
            const planId = card.getAttribute('data-plan-id') || (idx === 0 ? 'basic' : idx === 1 ? 'pro' : 'customized');
            const isCustom = planId === 'customized';
            return {
                id: planId,
                name: card.querySelector('.plan-name-inp')?.value || 'Plan',
                badge: card.querySelector('.plan-badge-inp')?.value || '',
                tagline: card.querySelector('.plan-tagline-inp')?.value || '',
                price: Number(card.querySelector('.plan-price-inp')?.value || 0),
                durationMonths: Number(card.querySelector('.plan-duration-inp')?.value || 12),
                maxCustomersLimit: Number(card.querySelector('.plan-parties-inp')?.value || 0),
                maxStaffLimit: Number(card.querySelector('.plan-staff-inp')?.value || 0),
                dailyMessageLimit: Number(card.querySelector('.plan-msgs-inp')?.value || 0),
                isPopular: Boolean(card.querySelector('.plan-popular-chk')?.checked),
                isCustom,
                basePrice: Number(card.querySelector('.plan-base-price-inp')?.value ?? 2999),
                pricePer100Parties: Number(card.querySelector('.plan-rate-parties-inp')?.value ?? 500),
                pricePerStaff: Number(card.querySelector('.plan-rate-staff-inp')?.value ?? 400),
                pricePer50Messages: Number(card.querySelector('.plan-rate-msgs-inp')?.value ?? 300),
                featureAccess: {
                    allowGoogleDriveBackup: Boolean(card.querySelector('.plan-fa-gdrive')?.checked),
                    allowExcelImport: Boolean(card.querySelector('.plan-fa-excel')?.checked),
                    allowPdfExport: Boolean(card.querySelector('.plan-fa-pdf')?.checked)
                },
                features: (card.querySelector('.plan-features-txt')?.value || '')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(Boolean),
                isActive: true
            };
        });

        const addonRows = Array.from(document.querySelectorAll('#addonsEditorList .addon-edit-row'));
        const addons = addonRows.map((row, idx) => ({
            id: row.getAttribute('data-addon-id') || `addon_${Date.now()}_${idx}`,
            name: row.querySelector('.addon-name-inp')?.value || 'Add-on',
            description: row.querySelector('.addon-desc-inp')?.value || '',
            type: row.querySelector('.addon-type-sel')?.value || 'parties',
            value: Number(row.querySelector('.addon-val-inp')?.value || 0),
            price: Number(row.querySelector('.addon-price-inp')?.value || 0),
            isActive: true
        }));

        const res = await apiJson('/api/superadmin/subscription-settings', {
            method: 'POST',
            body: JSON.stringify({
                razorpayKeyId,
                razorpayKeySecret,
                whatsappSalesNumber,
                plans,
                addons
            })
        });

        if (res && res.success) {
            currentPlanConfigState = res.planConfig;
            renderPlansEditor(currentPlanConfigState);
            if (alertBox) {
                alertBox.innerHTML = `<div class="alert-msg success">✅ ${res.message}</div>`;
                setTimeout(() => { if (alertBox) alertBox.innerHTML = ''; }, 5000);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            if (alertBox) {
                alertBox.innerHTML = `<div class="alert-msg error">⚠️ ${(res && res.message) || 'Failed to save subscription settings.'}</div>`;
            }
        }
    } catch (err) {
        if (alertBox) {
            alertBox.innerHTML = `<div class="alert-msg error">⚠️ ${err.message}</div>`;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '💾 Save All Plans, Add-ons & Razorpay Settings';
        }
    }
}

