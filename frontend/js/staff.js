document.addEventListener('DOMContentLoaded', () => {
    // Check URL query parameters for notifications
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('msg')) {
        showMsg(urlParams.get('msg'), true);
    } else if (urlParams.get('error')) {
        showMsg(urlParams.get('error'), false);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                if (typeof apiFetch === 'function') {
                    await apiFetch('/api/logout', { method: 'POST' });
                } else {
                    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
                }
            } catch (err) { console.error(err); }
            window.location.href = 'login.html';
        });
    }

    loadStaff();

    const createStaffForm = document.getElementById('createStaffForm');
    if (createStaffForm) {
        createStaffForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const username = document.getElementById('staffUsername').value.trim();
            const password = document.getElementById('staffPassword').value;
            const confirmPassword = document.getElementById('staffConfirmPassword').value;

            if (password !== confirmPassword) {
                showMsg('Passwords do not match. Please retype carefully.', false);
                return;
            }

            try {
                let response;
                if (typeof apiJson === 'function') {
                    response = await apiJson('/api/staff', {
                        method: 'POST',
                        body: JSON.stringify({ username, password })
                    });
                } else {
                    const res = await fetch('/api/staff', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ username, password })
                    });
                    response = await res.json();
                }

                if (!response.success && (response.message || response.error)) {
                    showMsg(response.message || response.error, false);
                } else {
                    showMsg(response.message || `Staff account "${username}" created successfully.`, true);
                    document.getElementById('staffUsername').value = '';
                    document.getElementById('staffPassword').value = '';
                    document.getElementById('staffConfirmPassword').value = '';
                    loadStaff();
                }
            } catch (err) {
                console.error(err);
                showMsg(err.message || 'Error creating staff account.', false);
            }
        });
    }
});

function escapeHtmlStaff(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.staffPageData = null;

async function loadStaff() {
    try {
        const data = typeof apiJson === 'function' 
            ? await apiJson('/api/staff') 
            : await (await fetch('/api/staff', { credentials: 'include' })).json();

        window.staffPageData = data || {};
        const isExpired = Boolean(data && data.isExpired);

        if (data && (data.subscriptionAlert || isExpired)) {
            const subBox = document.getElementById('subscriptionWarningBox');
            if (subBox) {
                subBox.style.display = 'flex';
                const iconEl = document.getElementById('staffSubWarnIcon');
                const titleEl = document.getElementById('staffSubWarnTitle');
                const descEl = document.getElementById('staffSubWarnDesc');
                if (isExpired) {
                    subBox.style.background = '#fef2f2';
                    subBox.style.borderColor = '#ef4444';
                    if (iconEl) iconEl.innerText = '🚨';
                    if (titleEl) {
                        titleEl.style.color = '#b91c1c';
                        titleEl.innerText = '🚨 Subscription Expired — View-Only Mode Active!';
                    }
                    if (descEl) {
                        descEl.style.color = '#7f1d1d';
                        descEl.innerHTML = 'Your subscription has ended. Staff members <strong>cannot sign in</strong> and staff changes are disabled until you renew your plan or buy an add-on on the Dashboard.';
                    }
                } else if (data.subscriptionAlert) {
                    subBox.style.background = '#fff7ed';
                    subBox.style.borderColor = '#f97316';
                    if (iconEl) iconEl.innerText = '⏰';
                    if (titleEl) {
                        titleEl.style.color = '#c2410c';
                        titleEl.innerText = '⏰ Subscription Expiry Reminder';
                    }
                    if (descEl) {
                        descEl.style.color = '#9a3412';
                        descEl.innerHTML = `Your plan expires in <u style="font-weight:800; font-size:14px;">${data.subscriptionAlert.daysLeft} day(s)</u> (on ${escapeHtmlStaff(data.subscriptionAlert.expiryFormatted || '')}).`;
                    }
                }
            }
        }

        // Disable Create Staff form if expired
        const createBtn = document.getElementById('createStaffSubmitBtn');
        if (createBtn) {
            createBtn.disabled = isExpired;
            createBtn.style.opacity = isExpired ? '0.5' : '1';
            createBtn.innerText = isExpired ? '🔒 Locked — Renew Plan or Buy Add-on on Dashboard' : 'Create Account';
        }
        
        const tbody = document.getElementById('staffTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const staffMembers = Array.isArray(data.staffMembers) ? data.staffMembers : (Array.isArray(data) ? data : []);
        const maxStaffLimit = Number(data.maxStaffLimit || 0);
        const totalStaffCount = staffMembers.length;

        // Populate Staff Quota Selection Card if totalStaffCount > maxStaffLimit
        const quotaCard = document.getElementById('staffQuotaSelectionCard');
        if (quotaCard) {
            if (data.hasExcessStaff || data.requiresStaffSelection || (maxStaffLimit > 0 && totalStaffCount > maxStaffLimit)) {
                quotaCard.style.display = 'block';
                const maxTxt = document.getElementById('staffQuotaMaxText');
                const totTxt = document.getElementById('staffQuotaTotalText');
                const maxAll = document.getElementById('staffPageMaxAllowed');
                const cardTitle = document.getElementById('staffQuotaCardTitle');
                if (maxTxt) maxTxt.innerText = maxStaffLimit;
                if (totTxt) totTxt.innerText = totalStaffCount;
                if (maxAll) maxAll.innerText = maxStaffLimit;
                if (cardTitle) {
                    cardTitle.innerText = data.requiresStaffSelection
                        ? `🚨 Action Required: Select Which ${maxStaffLimit} of ${totalStaffCount} Staff Get Active Login Access`
                        : `👥 Active Staff Selection (${data.activeStaffCount || maxStaffLimit} Active / ${data.pausedStaffCount || (totalStaffCount - maxStaffLimit)} Paused)`;
                }

                const checklist = document.getElementById('staffPageQuotaChecklist');
                if (checklist) {
                    let preCount = 0;
                    checklist.innerHTML = staffMembers.map(st => {
                        const checked = !st.isQuotaLocked && preCount < maxStaffLimit;
                        if (checked) preCount++;
                        return `
                            <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border:1.5px solid ${checked ? '#2563eb' : '#cbd5e1'}; background:${checked ? '#eff6ff' : '#ffffff'}; border-radius:12px; cursor:pointer;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <input type="checkbox" class="staff-page-quota-cb" value="${escapeHtmlStaff(st._id || st.id)}" ${checked ? 'checked' : ''} onchange="onStaffPageQuotaCbChange(this)" style="width:17px; height:17px; accent-color:#2563eb;">
                                    <strong style="font-size:14px; color:#0f172a;">👤 ${escapeHtmlStaff(st.username)}</strong>
                                </div>
                                <span class="staff-page-cb-badge" style="font-size:11px; font-weight:800; padding:2px 8px; border-radius:20px; background:${checked ? '#dcfce7' : '#f1f5f9'}; color:${checked ? '#166534' : '#64748b'};">
                                    ${checked ? '✅ Active' : '🔒 Paused'}
                                </span>
                            </label>
                        `;
                    }).join('');
                    const selCnt = document.getElementById('staffPageSelectedCount');
                    if (selCnt) selCnt.innerText = preCount;
                }
            } else {
                quotaCard.style.display = 'none';
            }
        }
        
        // Update staff limit badge if returned
        if (data.currentStaffCount !== undefined) {
            const limitBadge = document.getElementById('staffLimitBadge');
            if (limitBadge) {
                const max = data.maxStaffLimit !== undefined ? data.maxStaffLimit : '∞';
                const activeCnt = data.activeStaffCount !== undefined ? data.activeStaffCount : data.currentStaffCount;
                limitBadge.innerText = `Active Staff: ${activeCnt} / ${max} (Total Saved: ${data.currentStaffCount})`;
                if (data.maxStaffLimit >= 0 && data.currentStaffCount >= data.maxStaffLimit) {
                    limitBadge.style.background = '#fee2e2';
                    limitBadge.style.color = '#991b1b';
                } else {
                    limitBadge.style.background = '#e0e7ff';
                    limitBadge.style.color = '#3730a3';
                }
            }
        }

        staffMembers.forEach(staff => {
            const tr = document.createElement('tr');
            const safeUsername = escapeHtmlStaff(staff.username);
            let accessBadgeHtml = '';
            if (isExpired) {
                accessBadgeHtml = `<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:4px 10px; border-radius:8px; font-size:12px; font-weight:800; display:inline-block;">🚨 Blocked (Plan Expired)</span>`;
            } else if (staff.isQuotaLocked) {
                accessBadgeHtml = `<span style="background:#fff7ed; color:#c2410c; border:1px solid #fdba74; padding:4px 10px; border-radius:8px; font-size:12px; font-weight:800; display:inline-block;">🔒 Paused (Quota Limit)</span>`;
            } else {
                accessBadgeHtml = `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:4px 10px; border-radius:8px; font-size:12px; font-weight:800; display:inline-block;">✅ Active Access</span>`;
            }

            tr.innerHTML = `
                <td class="desktop-only"><strong style="font-size: 15px; color: var(--text-dark);">${safeUsername}</strong></td>
                <td class="desktop-only">${accessBadgeHtml}</td>
                <td class="desktop-only">
                    <form class="resetStaffForm desktop-reset-form" style="display:flex; gap:8px; align-items: center;" data-id="${staff._id || staff.id}">
                        <div class="input-group">
                            <input type="password" class="reset-new-password input-style" placeholder="New Password" required ${isExpired ? 'disabled' : ''} style="margin-bottom: 0; max-width: 150px;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <div class="input-group">
                            <input type="password" class="reset-confirm-password input-style" placeholder="Retype Password" required ${isExpired ? 'disabled' : ''} style="margin-bottom: 0; max-width: 150px;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <button type="submit" class="btn-blue" ${isExpired ? 'disabled style="opacity:0.5;"' : ''}>Reset</button>
                    </form>
                </td>
                <td class="desktop-only" style="text-align: right; padding-right: 20px;">
                    <button class="btn-red delete-staff-btn" data-id="${staff._id || staff.id}" ${isExpired ? 'disabled style="opacity:0.5;"' : ''}>🗑️</button>
                </td>

                <td class="mobile-only">
                    <div class="staff-card-header">
                        <span>👤 ${safeUsername}</span>
                        ${accessBadgeHtml}
                    </div>
                    <form class="reset-form resetStaffForm mobile-reset-form" data-id="${staff._id || staff.id}">
                        <div class="input-group" style="margin-bottom:8px;">
                            <input type="password" class="reset-new-password input-style" placeholder="Type new password..." required ${isExpired ? 'disabled' : ''} style="margin-bottom:0; width:100%;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <div class="input-group" style="margin-bottom:15px;">
                            <input type="password" class="reset-confirm-password input-style" placeholder="Retype new password..." required ${isExpired ? 'disabled' : ''} style="margin-bottom:0; width:100%;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <button type="submit" class="btn-blue" ${isExpired ? 'disabled style="opacity:0.5;"' : ''}>Reset</button>
                    </form>
                    <div class="staff-actions">
                        <button class="btn-red delete-staff-btn" style="width:100%; padding: 12px 0; border-radius: 10px; ${isExpired ? 'opacity:0.5;' : ''}" data-id="${staff._id || staff.id}" ${isExpired ? 'disabled' : ''}>🗑️ Delete Account</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Add event listeners for reset and delete
        document.querySelectorAll('.resetStaffForm').forEach(form => {
            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                const password = this.querySelector('.reset-new-password').value;
                const confirmPassword = this.querySelector('.reset-confirm-password').value;
                if (password !== confirmPassword) {
                    showMsg('Passwords do not match. Please retype carefully.', false);
                    return;
                }
                const staffId = this.getAttribute('data-id');
                
                try {
                    let response;
                    if (typeof apiJson === 'function') {
                        response = await apiJson('/api/staff/reset-password', {
                            method: 'POST',
                            body: JSON.stringify({ staffId, newPassword: password })
                        });
                    } else {
                        const res = await fetch('/api/staff/reset-password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ staffId, newPassword: password })
                        });
                        response = await res.json();
                    }
                    
                    if (response.success) {
                        showMsg(response.message || 'Staff password reset successfully.', true);
                        this.querySelector('.reset-new-password').value = '';
                        this.querySelector('.reset-confirm-password').value = '';
                    } else {
                        showMsg(response.message || response.error || 'Failed to reset password.', false);
                    }
                } catch (err) {
                    console.error(err);
                    showMsg(err.message || 'Error resetting password.', false);
                }
            });
        });

        document.querySelectorAll('.delete-staff-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (confirm('Delete this staff member permanently?')) {
                    const staffId = this.getAttribute('data-id');
                    try {
                        let response;
                        if (typeof apiJson === 'function') {
                            response = await apiJson(`/api/staff/${staffId}`, {
                                method: 'DELETE'
                            });
                        } else {
                            const res = await fetch(`/api/staff/${staffId}`, {
                                method: 'DELETE',
                                credentials: 'include'
                            });
                            response = await res.json();
                        }
                        
                        if (response.success) {
                            showMsg(response.message || 'Staff member deleted successfully.', true);
                            loadStaff();
                        } else {
                            showMsg(response.message || response.error || 'Failed to delete staff.', false);
                        }
                    } catch (err) {
                        console.error(err);
                        showMsg(err.message || 'Error deleting staff.', false);
                    }
                }
            });
        });

    } catch (err) {
        console.error('Failed to load staff', err);
    }
}

window.onStaffPageQuotaCbChange = function(cb) {
    const maxLimit = window.staffPageData ? Number(window.staffPageData.maxStaffLimit || 0) : 0;
    const checked = document.querySelectorAll('.staff-page-quota-cb:checked');
    if (checked.length > maxLimit) {
        cb.checked = false;
        showMsg(`Your current plan allows a maximum of ${maxLimit} active staff member(s). Uncheck another staff member first or buy a Staff Add-on on the Dashboard.`, false);
    }
    const finalChecked = document.querySelectorAll('.staff-page-quota-cb:checked');
    const selCnt = document.getElementById('staffPageSelectedCount');
    if (selCnt) selCnt.innerText = finalChecked.length;

    document.querySelectorAll('.staff-page-quota-cb').forEach(box => {
        const lbl = box.closest('label');
        const badge = lbl ? lbl.querySelector('.staff-page-cb-badge') : null;
        if (lbl) {
            lbl.style.borderColor = box.checked ? '#2563eb' : '#cbd5e1';
            lbl.style.background = box.checked ? '#eff6ff' : '#ffffff';
        }
        if (badge) {
            badge.style.background = box.checked ? '#dcfce7' : '#f1f5f9';
            badge.style.color = box.checked ? '#166534' : '#64748b';
            badge.innerText = box.checked ? '✅ Active' : '🔒 Paused';
        }
    });
};

window.saveStaffPageQuotaSelection = async function() {
    const btn = document.getElementById('saveStaffPageQuotaBtn');
    const checked = document.querySelectorAll('.staff-page-quota-cb:checked');
    const activeStaffIds = Array.from(checked).map(cb => cb.value);

    const origText = btn ? btn.innerText : '✅ Save Active Staff Access';
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Saving...';
    }
    try {
        const res = await apiJson('/api/staff/select-active', {
            method: 'POST',
            body: JSON.stringify({ activeStaffIds })
        });
        if (res && res.success) {
            showMsg(res.message || 'Active staff access saved!', true);
            await loadStaff();
        } else {
            showMsg((res && res.message) || 'Failed to save staff selection.', false);
        }
    } catch (err) {
        showMsg(err.message || 'Error saving staff selection.', false);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = origText;
        }
    }
};

function showMsg(msg, isSuccess = false) {
    const msgContainer = document.getElementById('msgContainer');
    if (msgContainer) {
        if (isSuccess) {
            msgContainer.style.background = '#dcfce7';
            msgContainer.style.border = '2px solid #22c55e';
            msgContainer.style.color = '#15803d';
            msgContainer.innerHTML = '✅ ' + msg;
        } else {
            msgContainer.style.background = '#fee2e2';
            msgContainer.style.border = '2px solid #ef4444';
            msgContainer.style.color = '#991b1b';
            msgContainer.innerHTML = '🚫 ' + msg;
        }
        msgContainer.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => {
            msgContainer.style.display = 'none';
        }, 5000);
    } else {
        alert((isSuccess ? '✅ ' : '🚫 ') + msg);
    }
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
