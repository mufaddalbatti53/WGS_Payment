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

async function loadStaff() {
    try {
        const data = typeof apiJson === 'function' 
            ? await apiJson('/api/staff') 
            : await (await fetch('/api/staff', { credentials: 'include' })).json();

        if (data && data.subscriptionAlert) {
            const subBox = document.getElementById('subscriptionWarningBox');
            if (subBox) {
                subBox.style.display = 'flex';
                const dLeft = document.getElementById('subDaysLeft');
                const dExp = document.getElementById('subExpiryDate');
                if (dLeft) dLeft.innerText = data.subscriptionAlert.daysLeft + ' day(s)';
                if (dExp) dExp.innerText = data.subscriptionAlert.expiryFormatted || '';
            }
        }
        
        const tbody = document.getElementById('staffTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const staffMembers = data.staffMembers || data;
        
        // Update staff limit badge if returned
        if (data.currentStaffCount !== undefined) {
            const limitBadge = document.getElementById('staffLimitBadge');
            if (limitBadge) {
                const max = data.maxStaffLimit || '∞';
                limitBadge.innerText = `Staff Limit: ${data.currentStaffCount} / ${max}`;
                if (data.maxStaffLimit > 0 && data.currentStaffCount >= data.maxStaffLimit) {
                    limitBadge.style.background = '#fee2e2';
                    limitBadge.style.color = '#991b1b';
                } else {
                    limitBadge.style.background = '#e0e7ff';
                    limitBadge.style.color = '#3730a3';
                }
            }
        }

        (Array.isArray(staffMembers) ? staffMembers : []).forEach(staff => {
            const tr = document.createElement('tr');
            const safeUsername = escapeHtmlStaff(staff.username);
            tr.innerHTML = `
                <td class="desktop-only"><strong style="font-size: 15px; color: var(--text-dark);">${safeUsername}</strong></td>
                <td class="desktop-only"><span class="role-badge">${escapeHtmlStaff((staff.role || 'staff').toUpperCase())}</span></td>
                <td class="desktop-only">
                    <form class="resetStaffForm desktop-reset-form" style="display:flex; gap:8px; align-items: center;" data-id="${staff._id || staff.id}">
                        <div class="input-group">
                            <input type="password" class="reset-new-password input-style" placeholder="New Password" required style="margin-bottom: 0; max-width: 150px;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <div class="input-group">
                            <input type="password" class="reset-confirm-password input-style" placeholder="Retype Password" required style="margin-bottom: 0; max-width: 150px;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <button type="submit" class="btn-blue">Reset</button>
                    </form>
                </td>
                <td class="desktop-only" style="text-align: right; padding-right: 20px;">
                    <button class="btn-red delete-staff-btn" data-id="${staff._id || staff.id}">🗑️</button>
                </td>

                <td class="mobile-only">
                    <div class="staff-card-header">
                        <span>👤 ${staff.username}</span>
                        <span class="role-badge">${(staff.role || 'staff').toUpperCase()}</span>
                    </div>
                    <form class="reset-form resetStaffForm mobile-reset-form" data-id="${staff._id || staff.id}">
                        <div class="input-group" style="margin-bottom:8px;">
                            <input type="password" class="reset-new-password input-style" placeholder="Type new password..." required style="margin-bottom:0; width:100%;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <div class="input-group" style="margin-bottom:15px;">
                            <input type="password" class="reset-confirm-password input-style" placeholder="Retype new password..." required style="margin-bottom:0; width:100%;">
                            <span class="toggle-password" onclick="togglePassword(this)" style="margin-top:0;">👁️</span>
                        </div>
                        <button type="submit" class="btn-blue">Reset</button>
                    </form>
                    <div class="staff-actions">
                        <button class="btn-red delete-staff-btn" style="width:100%; padding: 12px 0; border-radius: 10px;" data-id="${staff._id || staff.id}">🗑️ Delete Account</button>
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
