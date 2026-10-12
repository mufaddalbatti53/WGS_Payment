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
            const planId = (document.getElementById('modalSelectedPlanId')?.value || '').trim();
            const planName = (document.getElementById('modalPlanName')?.value || '').trim();
            const planPrice = document.getElementById('modalPlanPrice')?.value;
            const planDurationMonths = document.getElementById('modalPlanDurationMonths')?.value || 12;
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
                        planId,
                        planName,
                        planPrice,
                        planDurationMonths,
                        maxStaffLimit,
                        maxCustomersLimit,
                        dailyMessageLimit,
                        planExpiryDate,
                        status,
                        featureAccess
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

    // Modal overlay backdrop click to close
    const limitsModalEl = document.getElementById('limitsModal');
    if (limitsModalEl) {
        limitsModalEl.addEventListener('click', (e) => {
            if (e.target === limitsModalEl) {
                closeLimitsModal();
            }
        });
    }

    // Delegated click listener for Plan Preset Buttons
    const presetBarEl = document.getElementById('modalPlanPresetBar');
    if (presetBarEl) {
        presetBarEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-plan-id]');
            if (btn) {
                const planId = btn.getAttribute('data-plan-id');
                if (planId && typeof window.applyPlanPresetToModal === 'function') {
                    window.applyPlanPresetToModal(planId);
                }
            }
        });
    }

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('limitsModal');
            if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
                closeLimitsModal();
            }
        }
    });

    // Immediately render default plans & add-ons so the editor is never empty
    if (!currentPlanConfigState) {
        currentPlanConfigState = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
        window.currentPlanConfigState = currentPlanConfigState;
        renderPlansEditor(currentPlanConfigState);
    }
});

const DEFAULT_SUPERADMIN_PLAN_CONFIG = {
    razorpayKeyId: '',
    razorpayKeySecret: '',
    whatsappSalesNumber: '917021056404',
    superadminEmail: '',
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

window.getLivePlansList = function() {
    const planCards = Array.from(document.querySelectorAll('#plansEditorGrid .plan-edit-card'));
    if (planCards.length > 0) {
        return planCards.map((card, idx) => {
            const planId = card.getAttribute('data-plan-id') || (idx === 0 ? 'basic' : idx === 1 ? 'pro' : 'customized');
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
                isCustom: planId === 'customized',
                featureAccess: {
                    allowGoogleDriveBackup: Boolean(card.querySelector('.plan-fa-gdrive')?.checked),
                    allowExcelImport: Boolean(card.querySelector('.plan-fa-excel')?.checked),
                    allowPdfExport: Boolean(card.querySelector('.plan-fa-pdf')?.checked)
                }
            };
        });
    }
    const cfg = currentPlanConfigState || window.currentPlanConfigState || DEFAULT_SUPERADMIN_PLAN_CONFIG;
    return (cfg && Array.isArray(cfg.plans) && cfg.plans.length > 0) ? cfg.plans : DEFAULT_SUPERADMIN_PLAN_CONFIG.plans;
};

function findLivePlan(planId, planName) {
    const plans = window.getLivePlansList();
    const cleanId = String(planId || '').trim().toLowerCase();
    const cleanName = String(planName || '').trim().toLowerCase();
    if (cleanId) {
        const byId = plans.find(p => String(p.id || '').trim().toLowerCase() === cleanId);
        if (byId) return byId;
    }
    if (cleanName) {
        const byName = plans.find(p => String(p.name || '').trim().toLowerCase() === cleanName);
        if (byName) return byName;
        if (cleanName.includes('custom')) return plans.find(p => p.id === 'customized' || p.isCustom) || null;
        if (/\bpro\b/.test(cleanName)) return plans.find(p => p.id === 'pro') || null;
        if (cleanName.includes('basic')) return plans.find(p => p.id === 'basic') || null;
    }
    return null;
}

async function loadDashboard() {
    try {
        const data = await apiJson('/api/superadmin/dashboard');
        if (data && data.success === false) {
            throw new Error(data.message || 'Super Admin access required');
        }

        if (data.planConfig && Array.isArray(data.planConfig.plans) && data.planConfig.plans.length > 0) {
            currentPlanConfigState = data.planConfig;
            window.currentPlanConfigState = currentPlanConfigState;
            renderPlansEditor(currentPlanConfigState);
        } else {
            await loadSubscriptionConfigFallback();
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
            window.currentPlanConfigState = currentPlanConfigState;
            renderPlansEditor(currentPlanConfigState);
            return;
        }
    } catch (e) {}
    if (!currentPlanConfigState) {
        currentPlanConfigState = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
        window.currentPlanConfigState = currentPlanConfigState;
    }
    renderPlansEditor(currentPlanConfigState);
}

window.resetDefaultPlansAndAddons = function() {
    if (!confirm('Reset the form fields below to the default 3 Yearly Plans (Basic, Pro, Customized) and 5 Yearly Add-ons? (Click Save afterwards to apply to the landing page.)')) return;
    const merged = JSON.parse(JSON.stringify(DEFAULT_SUPERADMIN_PLAN_CONFIG));
    merged.razorpayKeyId = document.getElementById('rzpKeyIdInput')?.value || '';
    merged.razorpayKeySecret = document.getElementById('rzpKeySecretInput')?.value || '';
    merged.whatsappSalesNumber = document.getElementById('whatsappSalesInput')?.value || '917021056404';
    merged.superadminEmail = document.getElementById('superadminEmailInput')?.value || '';
    currentPlanConfigState = merged;
    window.currentPlanConfigState = merged;
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
    const modal = document.getElementById('limitsModal');
    if (modal) modal.style.display = 'none';
}
window.closeLimitsModal = closeLimitsModal;

function computeAutoExpiryDateString(durationMonths) {
    const months = Math.max(1, parseInt(durationMonths) || 12);
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
}

function renderModalPlanPresetButtons(selectedPlanId) {
    const bar = document.getElementById('modalPlanPresetBar');
    if (!bar) return;
    const plans = window.getLivePlansList();
    bar.innerHTML = plans.map((plan, idx) => {
        const pId = plan.id || (idx === 0 ? 'basic' : idx === 1 ? 'pro' : 'customized');
        const isSelected = String(selectedPlanId || '').toLowerCase() === String(pId).toLowerCase();
        const isCustom = Boolean(plan.isCustom || pId === 'customized');
        const icon = isCustom ? '🎛️' : (pId === 'pro' ? '🚀' : '🌱');
        const activeBorder = isSelected ? '#1d4ed8' : (isCustom ? '#86efac' : (pId === 'pro' ? '#93c5fd' : '#cbd5e1'));
        const activeBg = isSelected ? 'linear-gradient(135deg, #dbeafe, #eff6ff)' : (isCustom ? '#f0fdf4' : (pId === 'pro' ? '#eff6ff' : '#f8fafc'));
        const activeShadow = isSelected ? '0 0 0 2px rgba(37,99,235,0.22)' : 'none';
        const priceFmt = Number(plan.price || 0).toLocaleString('en-IN');
        const dur = Number(plan.durationMonths || 12);

        return `
            <button type="button" data-plan-id="${escapeJsStr(pId)}" onclick="applyPlanPresetToModal('${escapeJsStr(pId)}')"
                style="text-align:left; padding:9px 11px; border-radius:10px; border:2px solid ${activeBorder}; background:${activeBg}; box-shadow:${activeShadow}; cursor:pointer; transition:all 0.15s;">
                <div style="pointer-events:none; display:flex; align-items:center; justify-content:space-between; gap:4px; font-size:12px; font-weight:800; color:#0f172a;">
                    <span>${icon} ${plan.name || 'Plan'}</span>
                    ${isSelected ? '<span style="background:#1d4ed8; color:#fff; font-size:9px; padding:1px 6px; border-radius:99px;">SELECTED</span>' : ''}
                </div>
                <div style="pointer-events:none; font-size:11.5px; font-weight:800; color:#1d4ed8; margin-top:3px;">
                    ₹${priceFmt} <span style="font-weight:600; color:#64748b; font-size:10.5px;">/ ${dur} Mo</span>
                </div>
                <div style="pointer-events:none; font-size:10px; color:#475569; margin-top:3px; line-height:1.35;">
                    👥 <strong>${plan.maxStaffLimit ?? 0}</strong> Staff · 📊 <strong>${plan.maxCustomersLimit ?? 0}</strong> Parties · 💬 <strong>${plan.dailyMessageLimit ?? 0}</strong> Msgs
                </div>
            </button>
        `;
    }).join('');
}
window.renderModalPlanPresetButtons = renderModalPlanPresetButtons;

function updateModalSelectedPlanSummary(planName, price, durationMonths, maxStaff, maxParties, dailyMsgs, expiryDateStr) {
    const box = document.getElementById('modalSelectedPlanSummary');
    if (!box) return;
    const priceNum = Number(price || 0);
    const expDisplay = expiryDateStr ? formatDate(expiryDateStr) : 'Auto on Save';
    box.style.display = 'block';
    box.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px;">
            <div>
                <strong style="font-size:12.5px; color:#1e3a8a;">💎 Active Selection: ${planName || 'Standard Plan'}</strong>
                ${priceNum > 0 ? `<span style="margin-left:6px; background:#1d4ed8; color:#fff; padding:2px 8px; border-radius:99px; font-size:10.5px; font-weight:800;">₹${priceNum.toLocaleString('en-IN')} / ${durationMonths || 12} Mo</span>` : ''}
            </div>
            <span style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:2px 8px; border-radius:99px; font-size:10.5px; font-weight:800;">
                📅 Valid Till: ${expDisplay}
            </span>
        </div>
        <div style="margin-top:5px; font-size:11px; color:#334155; font-weight:600;">
            Quotas Applied: 👥 <strong>${maxStaff}</strong> Staff &nbsp;·&nbsp; 📊 <strong>${maxParties}</strong> Parties &nbsp;·&nbsp; 💬 <strong>${dailyMsgs}</strong> Daily Reminders
        </div>
    `;
}

window.recalcModalExpiryFromDuration = function(monthsVal) {
    const months = Math.max(1, parseInt(monthsVal) || 12);
    const expEl = document.getElementById('modalPlanExpiry');
    if (expEl) {
        expEl.value = computeAutoExpiryDateString(months);
    }
    updateModalSelectedPlanSummary(
        document.getElementById('modalPlanName')?.value,
        document.getElementById('modalPlanPrice')?.value,
        months,
        document.getElementById('modalMaxStaff')?.value,
        document.getElementById('modalMaxCustomers')?.value,
        document.getElementById('modalDailyMessages')?.value,
        expEl ? expEl.value : ''
    );
};

window.setModalExpiryMonths = function(monthsVal) {
    const months = Math.max(1, parseInt(monthsVal) || 12);
    const expEl = document.getElementById('modalPlanExpiry');
    if (expEl) {
        expEl.value = computeAutoExpiryDateString(months);
    }
    const durInput = document.getElementById('modalPlanDurationMonths');
    if (durInput) durInput.value = months;
    updateModalSelectedPlanSummary(
        document.getElementById('modalPlanName')?.value,
        document.getElementById('modalPlanPrice')?.value,
        months,
        document.getElementById('modalMaxStaff')?.value,
        document.getElementById('modalMaxCustomers')?.value,
        document.getElementById('modalDailyMessages')?.value,
        expEl ? expEl.value : ''
    );
};

window.toggleStaffQuotaAccess = async function(staffId, adminId, btnEl) {
    if (!staffId) return;
    const originalText = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '⏳ Updating...';
    }
    try {
        const res = await apiJson(`/api/superadmin/toggle-staff-quota/${staffId}`, { method: 'POST' });
        if (res && res.success) {
            const isLocked = Boolean(res.isQuotaLocked);
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.style.background = isLocked ? '#fef3c7' : '#dcfce7';
                btnEl.style.borderColor = isLocked ? '#f59e0b' : '#86efac';
                btnEl.style.color = isLocked ? '#92400e' : '#166534';
                btnEl.innerHTML = isLocked ? '🔒 Paused (Click to Activate)' : '✅ Active (Click to Pause)';
                btnEl.title = isLocked ? 'Click to grant active quota access' : 'Click to pause/lock quota access';
            }
            loadDashboard();
        } else {
            alert('Error toggling staff access: ' + (res?.message || 'Unknown error'));
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalText;
            }
        }
    } catch (err) {
        alert('Failed to toggle staff access: ' + err.message);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalText;
        }
    }
};

function openLimitsModalFromData(id, username, maxStaff, maxParties, dailyMsgs, planExpiry, status, rawStaff, planName, rawFeatureAccess, planId, planPrice, planDurationMonths) {
    document.getElementById('modalAdminId').value = id;
    document.getElementById('limitAdminName').innerText = username;

    const cleanPlanName = (planName && planName !== 'undefined' && planName !== 'null') ? planName : 'Basic Plan';
    const cleanPlanId = (planId && planId !== 'undefined' && planId !== 'null') ? planId : '';
    const liveMatchedPlan = findLivePlan(cleanPlanId, cleanPlanName);
    const resolvedPlanId = cleanPlanId || (liveMatchedPlan ? liveMatchedPlan.id : 'basic');

    // If the admin is still pending approval and matches a standard plan (Basic/Pro), pre-fill from the latest live plan config
    const isPendingUnapproved = (status === 'pending' || status === 'rejected');
    const useLiveStandardDefaults = isPendingUnapproved && liveMatchedPlan && !liveMatchedPlan.isCustom;

    const effectivePlanName = useLiveStandardDefaults ? liveMatchedPlan.name : cleanPlanName;
    const effectiveStaff = useLiveStandardDefaults
        ? liveMatchedPlan.maxStaffLimit
        : ((maxStaff !== undefined && maxStaff !== null && maxStaff !== 'undefined' && maxStaff !== 'null') ? maxStaff : (liveMatchedPlan ? liveMatchedPlan.maxStaffLimit : 5));
    const effectiveParties = useLiveStandardDefaults
        ? liveMatchedPlan.maxCustomersLimit
        : ((maxParties !== undefined && maxParties !== null && maxParties !== 'undefined' && maxParties !== 'null') ? maxParties : (liveMatchedPlan ? liveMatchedPlan.maxCustomersLimit : 500));
    const effectiveMsgs = useLiveStandardDefaults
        ? liveMatchedPlan.dailyMessageLimit
        : ((dailyMsgs !== undefined && dailyMsgs !== null && dailyMsgs !== 'undefined' && dailyMsgs !== 'null') ? dailyMsgs : (liveMatchedPlan ? liveMatchedPlan.dailyMessageLimit : 100));
    const effectiveDuration = useLiveStandardDefaults
        ? (liveMatchedPlan.durationMonths || 12)
        : ((planDurationMonths && planDurationMonths !== 'undefined' && planDurationMonths !== 'null') ? Number(planDurationMonths) : (liveMatchedPlan ? (liveMatchedPlan.durationMonths || 12) : 12));
    const effectivePrice = useLiveStandardDefaults
        ? (liveMatchedPlan.price || 0)
        : ((planPrice && planPrice !== 'undefined' && planPrice !== 'null' && Number(planPrice) > 0) ? Number(planPrice) : (liveMatchedPlan ? (liveMatchedPlan.price || 0) : 0));

    const selectedPlanIdEl = document.getElementById('modalSelectedPlanId');
    if (selectedPlanIdEl) selectedPlanIdEl.value = resolvedPlanId;

    const planNameInput = document.getElementById('modalPlanName');
    if (planNameInput) planNameInput.value = effectivePlanName;

    const planPriceInput = document.getElementById('modalPlanPrice');
    if (planPriceInput) planPriceInput.value = effectivePrice;

    const planDurationInput = document.getElementById('modalPlanDurationMonths');
    if (planDurationInput) planDurationInput.value = effectiveDuration;

    document.getElementById('modalMaxStaff').value = effectiveStaff;
    document.getElementById('modalMaxCustomers').value = effectiveParties;
    document.getElementById('modalDailyMessages').value = effectiveMsgs;
    document.getElementById('modalStatus').value = status || 'approved';

    let fa = { allowGoogleDriveBackup: true, allowExcelImport: true, allowPdfExport: true };
    try {
        if (useLiveStandardDefaults && liveMatchedPlan.featureAccess) {
            fa = liveMatchedPlan.featureAccess;
        } else if (typeof rawFeatureAccess === 'string' && rawFeatureAccess !== 'undefined' && rawFeatureAccess !== 'null') {
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
    
    const expEl = document.getElementById('modalPlanExpiry');
    if (planExpiry && planExpiry !== 'null' && planExpiry !== 'undefined') {
        const d = new Date(planExpiry);
        if (!isNaN(d.getTime())) {
            expEl.value = d.toISOString().split('T')[0];
        } else {
            expEl.value = computeAutoExpiryDateString(effectiveDuration);
        }
    } else {
        // Automatically populate expiry date based on plan validity months if none is set yet
        expEl.value = computeAutoExpiryDateString(effectiveDuration);
    }

    renderModalPlanPresetButtons(resolvedPlanId);
    updateModalSelectedPlanSummary(effectivePlanName, effectivePrice, effectiveDuration, effectiveStaff, effectiveParties, effectiveMsgs, expEl.value);

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
            html += '<thead><tr style="background:#f1f5f9; color:var(--text-muted); font-size:11px; text-transform:uppercase;"><th style="padding:8px 12px; text-align:left;">Staff Member</th><th style="padding:8px 12px; text-align:left;">Quota Access</th><th style="padding:8px 12px; text-align:center;">Role</th></tr></thead><tbody>';
            staffList.forEach(s => {
                const isLocked = Boolean(s.isQuotaLocked);
                const toggleBtn = `
                    <button type="button" onclick="toggleStaffQuotaAccess('${s._id}', '${id}', this)"
                        style="font-size:11px; font-weight:700; padding:4px 9px; border-radius:8px; border:1px solid ${isLocked ? '#f59e0b' : '#86efac'}; background:${isLocked ? '#fef3c7' : '#dcfce7'}; color:${isLocked ? '#92400e' : '#166534'}; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:all 0.15s;"
                        title="${isLocked ? 'Click to grant active quota access' : 'Click to pause/lock quota access'}">
                        ${isLocked ? '🔒 Paused (Click to Activate)' : '✅ Active (Click to Pause)'}
                    </button>
                `;
                html += '<tr style="border-top:1px solid #f1f5f9;">';
                html += '<td style="padding:8px 12px; font-weight:700; color:var(--text-dark);">👤 ' + s.username + '</td>';
                html += '<td style="padding:8px 12px;">' + toggleBtn + '</td>';
                html += '<td style="padding:8px 12px; text-align:center;"><span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:8px; font-size:10px; font-weight:700;">STAFF</span></td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        }
    }

    document.getElementById('limitsModal').style.display = 'flex';
}
window.openLimitsModalFromData = openLimitsModalFromData;

window.applyPlanPresetToModal = function(planId) {
    const plans = window.getLivePlansList();
    const plan = plans.find(p => String(p.id || '').toLowerCase() === String(planId || '').toLowerCase()) || plans[0];
    if (!plan) return;

    const selectedPlanIdEl = document.getElementById('modalSelectedPlanId');
    if (selectedPlanIdEl) selectedPlanIdEl.value = plan.id || planId;

    const planNameInput = document.getElementById('modalPlanName');
    if (planNameInput) planNameInput.value = plan.name || 'Basic Plan';

    const planPriceInput = document.getElementById('modalPlanPrice');
    if (planPriceInput) planPriceInput.value = Number(plan.price ?? 0);

    const durationMonths = Math.max(1, Number(plan.durationMonths) || 12);
    const planDurationInput = document.getElementById('modalPlanDurationMonths');
    if (planDurationInput) planDurationInput.value = durationMonths;

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

    // Always auto-calculate and set the Plan Expiry Date when any plan is selected
    const expEl = document.getElementById('modalPlanExpiry');
    const autoExpiryStr = computeAutoExpiryDateString(durationMonths);
    if (expEl) {
        expEl.value = autoExpiryStr;
    }

    // If account was pending or rejected, automatically set status to approved when assigning a plan
    const statusEl = document.getElementById('modalStatus');
    if (statusEl && (statusEl.value === 'pending' || statusEl.value === 'rejected')) {
        statusEl.value = 'approved';
    }

    renderModalPlanPresetButtons(plan.id || planId);
    updateModalSelectedPlanSummary(
        plan.name,
        plan.price,
        durationMonths,
        plan.maxStaffLimit ?? 2,
        plan.maxCustomersLimit ?? 250,
        plan.dailyMessageLimit ?? 50,
        autoExpiryStr
    );
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
    updateModalSelectedPlanSummary(
        document.getElementById('modalPlanName')?.value,
        document.getElementById('modalPlanPrice')?.value,
        document.getElementById('modalPlanDurationMonths')?.value,
        document.getElementById('modalMaxStaff')?.value,
        document.getElementById('modalMaxCustomers')?.value,
        document.getElementById('modalDailyMessages')?.value,
        expEl.value
    );
};

function buildPlanBadgeHtml(u) {
    const livePlan = findLivePlan(u.planId, u.planName);
    const isPendingStandard = (u.status === 'pending' || u.status === 'rejected') && !u.lastPaymentId && (!u.activeAddons || !u.activeAddons.length) && livePlan && !livePlan.isCustom;

    const planId = (u.planId || (livePlan && livePlan.id) || 'basic').toLowerCase();
    const planLabel = isPendingStandard ? livePlan.name : (u.planName || (livePlan && livePlan.name) || 'Standard Plan');
    const durationMonths = isPendingStandard ? (livePlan.durationMonths || 12) : (u.planDurationMonths || (livePlan && livePlan.durationMonths) || 12);
    const displayPrice = isPendingStandard
        ? Number(livePlan.price || 0)
        : Number(u.lastAmountPaid > 0 ? u.lastAmountPaid : (u.planPrice || (livePlan && livePlan.price) || 0));

    const maxStaff = isPendingStandard ? livePlan.maxStaffLimit : (u.maxStaffLimit ?? (livePlan ? livePlan.maxStaffLimit : 5));
    const maxParties = isPendingStandard ? livePlan.maxCustomersLimit : (u.maxCustomersLimit ?? (livePlan ? livePlan.maxCustomersLimit : 500));
    const maxMsgs = isPendingStandard ? livePlan.dailyMessageLimit : (u.dailyMessageLimit ?? (livePlan ? livePlan.dailyMessageLimit : 100));
    const fa = (isPendingStandard && livePlan.featureAccess) ? livePlan.featureAccess : (u.featureAccess || {});

    // Tier visual theme
    let tierIcon = '🌱';
    let cardBg = '#f8fafc';
    let cardBorder = '#cbd5e1';
    let badgeBg = '#e2e8f0';
    let badgeColor = '#1e293b';
    if (planId === 'pro' || /\bpro\b/i.test(planLabel)) {
        tierIcon = '🚀';
        cardBg = 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)';
        cardBorder = '#93c5fd';
        badgeBg = '#1d4ed8';
        badgeColor = '#ffffff';
    } else if (planId === 'customized' || /custom/i.test(planLabel)) {
        tierIcon = '🎛️';
        cardBg = 'linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%)';
        cardBorder = '#86efac';
        badgeBg = '#15803d';
        badgeColor = '#ffffff';
    } else {
        tierIcon = '🌱';
        cardBg = 'linear-gradient(135deg, #f0f9ff 0%, #f8fafc 100%)';
        cardBorder = '#bae6fd';
        badgeBg = '#0369a1';
        badgeColor = '#ffffff';
    }

    // Price / payment pill
    let pricePill = '';
    if (u.lastPaymentId) {
        pricePill = `<span style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">💳 Paid ₹${displayPrice.toLocaleString('en-IN')}</span>`;
    } else if (displayPrice > 0) {
        pricePill = `<span style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">💰 ₹${displayPrice.toLocaleString('en-IN')} / ${durationMonths}m</span>`;
    }

    // Expiry pill
    let expiryPill = '';
    if (u.planExpiryDate) {
        const expDate = new Date(u.planExpiryDate);
        const now = new Date();
        const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
            expiryPill = `<span style="background:#fee2e2; color:#dc2626; border:1px solid #fecaca; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">🚨 Expired ${formatDate(u.planExpiryDate)}</span>`;
        } else if (diffDays <= 10) {
            expiryPill = `<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">⏳ Exp: ${formatDate(u.planExpiryDate)} (${diffDays}d left)</span>`;
        } else {
            expiryPill = `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">📅 Valid till ${formatDate(u.planExpiryDate)} (${diffDays}d)</span>`;
        }
    } else if (u.status === 'pending') {
        expiryPill = `<span style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800;">📅 Auto-Expiry: +${durationMonths} Months on Approve</span>`;
    }

    const addonsHtml = Array.isArray(u.activeAddons) && u.activeAddons.length
        ? `<div style="font-size:10px; color:#4f46e5; font-weight:700; margin-top:4px;">🧩 +${u.activeAddons.length} Add-on${u.activeAddons.length > 1 ? 's' : ''}: ${u.activeAddons.map(a => a.name).join(', ')}</div>`
        : '';

    const staffSelLine = u.requiresStaffSelection
        ? `<div style="font-size:10px; color:#b45309; font-weight:800; margin-top:3px;">⚠️ Awaiting Staff Quota Selection (${u.staffCount || 0}/${maxStaff || 5})</div>`
        : '';

    return `
        <div style="margin-top:6px; background:${cardBg}; border:1.5px solid ${cardBorder}; border-radius:10px; padding:7px 9px; max-width:340px; box-shadow:0 2px 6px rgba(15,23,42,0.04);">
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;">
                <span style="display:inline-block; background:${badgeBg}; color:${badgeColor}; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:800; letter-spacing:0.2px;">${tierIcon} ${planLabel}</span>
                ${pricePill}
                ${expiryPill}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:5px; font-size:10.5px; color:#1e293b; font-weight:700;">
                <span style="background:#ffffff; border:1px solid #e2e8f0; padding:1px 6px; border-radius:5px;">👥 Staff: ${maxStaff === 0 ? '∞' : maxStaff}</span>
                <span style="background:#ffffff; border:1px solid #e2e8f0; padding:1px 6px; border-radius:5px;">📊 Parties: ${maxParties === 0 ? '∞' : maxParties}</span>
                <span style="background:#ffffff; border:1px solid #e2e8f0; padding:1px 6px; border-radius:5px;">💬 Msgs: ${maxMsgs === 0 ? '∞' : maxMsgs}/d</span>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; font-size:9.5px; color:#475569; font-weight:700;">
                <span>☁️ Drive: ${fa.allowGoogleDriveBackup !== false ? '✅' : '🔒'}</span>
                <span>·</span>
                <span>📥 Excel: ${fa.allowExcelImport !== false ? '✅' : '🔒'}</span>
                <span>·</span>
                <span>📄 PDF: ${fa.allowPdfExport !== false ? '✅' : '🔒'}</span>
            </div>
            ${addonsHtml}
            ${staffSelLine}
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
                    <th>ADMIN USER & PLAN DETAILS</th>
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
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=3b82f6&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar" loading="lazy" decoding="async">
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
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}', '${escapeJsStr(u.planId || '')}', '${u.planPrice || 0}', '${u.planDurationMonths || 12}')">⚙️ Assign Plan & Quotas</button>
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
                    <th>ADMIN USER & PLAN DETAILS</th>
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
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=2563eb&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar" loading="lazy" decoding="async">
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
                        <div style="font-weight:800; color:#1e3a8a; margin-bottom:3px;">💎 ${u.planName || 'Basic Plan'}</div>
                        <div><strong>Approved:</strong> ${formatDateLong(u.approvedAt)}</div>
                        <div style="color:${u.planExpiryDate && new Date(u.planExpiryDate) < new Date() ? '#dc2626' : '#059669'}; font-size:11.5px; font-weight:700; margin-top:3px;">
                            <strong>📅 Expires:</strong> ${u.planExpiryDate ? formatDate(u.planExpiryDate) : '(Lifetime)'}
                        </div>
                    </div>
                </td>
                <td>
                    <div class="action-btn-group">
                        <button type="button" class="btn-action-soft btn-action-suspend" style="width:100%;" onclick="actionToggleSuspend('${u._id}', 'suspend', '${escapeJsStr(u.username)}')">⊗ Suspend</button>
                        <button type="button" class="btn-action-soft btn-action-manage"
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}', '${escapeJsStr(u.planId || '')}', '${u.planPrice || 0}', '${u.planDurationMonths || 12}')">⊕ Manage Plan & Access</button>
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
                    <th>ADMIN USER & PLAN DETAILS</th>
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
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=6b21a8&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar" loading="lazy" decoding="async">
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
                        <div>👥 Staff: <strong>${u.staffCount || 0} / ${u.maxStaffLimit || 5}</strong></div>
                        <div>📊 Parties: <strong>${u.partyCount || 0} / ${u.maxCustomersLimit || 500}</strong></div>
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
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}', '${escapeJsStr(u.planId || '')}', '${u.planPrice || 0}', '${u.planDurationMonths || 12}')">⚙️ Plan & Access</button>
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
                    <th>USER & PLAN DETAILS</th>
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

        const rawStaff = encodeURIComponent(JSON.stringify(u.staffList || []));
        const rawFA = encodeURIComponent(JSON.stringify(u.featureAccess || {}));

        html += `
            <tr>
                <td>
                    <div class="admin-user-cell">
                        <div class="avatar-container">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.companyName || u.username)}&background=ef4444&color=fff&rounded=true&bold=true" class="user-avatar" alt="Avatar" loading="lazy" decoding="async">
                        </div>
                        <div>
                            <div class="username-title">${u.username}</div>
                            ${u.companyName ? `<div style="font-size:11px; color:var(--text-muted); font-weight:600;">${u.companyName}</div>` : ''}
                            <span class="status-badge-pill rejected">REJECTED</span>
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
                    <div class="password-pill-container">
                        <span class="pwd-mask-text">Managed securely</span>
                    </div>
                </td>
                <td>
                    <span class="status-badge-pill rejected">Rejected</span>
                </td>
                <td>
                    <div class="action-btn-group">
                        <button type="button" class="btn-action-soft btn-action-approve" style="width:100%;" onclick="actionApprove('${u._id}')">Approve Now ✅</button>
                        <button type="button" class="btn-action-soft btn-action-manage" style="width:100%;"
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}', '${escapeJsStr(u.planName)}', '${rawFA}', '${escapeJsStr(u.planId || '')}', '${u.planPrice || 0}', '${u.planDurationMonths || 12}')">⚙️ Assign Plan & Approve</button>
                    </div>
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
    const saEmailEl = document.getElementById('superadminEmailInput');
    const rzpBadge = document.getElementById('rzpStatusBadge');

    if (rzpKeyIdEl) rzpKeyIdEl.value = config.razorpayKeyId || '';
    if (rzpKeySecretEl) rzpKeySecretEl.value = config.razorpayKeySecret || '';
    if (waSalesEl) waSalesEl.value = config.whatsappSalesNumber || '917021056404';
    if (saEmailEl) saEmailEl.value = config.superadminEmail || '';

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
    renderModalPlanPresetButtons(document.getElementById('modalSelectedPlanId')?.value || 'basic');
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
        const superadminEmail = (document.getElementById('superadminEmailInput')?.value || '').trim();

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
                superadminEmail,
                plans,
                addons
            })
        });

        if (res && res.success) {
            currentPlanConfigState = res.planConfig;
            window.currentPlanConfigState = currentPlanConfigState;
            renderPlansEditor(currentPlanConfigState);
            await loadDashboard();
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

