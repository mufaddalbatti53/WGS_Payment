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
            const maxStaffLimit = document.getElementById('modalMaxStaff').value;
            const maxCustomersLimit = document.getElementById('modalMaxCustomers').value;
            const dailyMessageLimit = document.getElementById('modalDailyMessages').value;
            const planExpiryDate = document.getElementById('modalPlanExpiry').value;
            const status = document.getElementById('modalStatus').value;

            try {
                const res = await apiJson(`/api/superadmin/update-limits/${id}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        maxStaffLimit, maxCustomersLimit, dailyMessageLimit, planExpiryDate, status
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
});

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

    } catch (error) {
        console.error('Error loading dashboard:', error);
        if (error.message.includes('Session expired') || error.message.includes('Super Admin access required') || error.message.includes('401') || error.message.includes('403')) {
            window.location.href = 'login.html';
        } else {
            alert('Error loading dashboard: ' + error.message);
        }
    }
}

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

function openLimitsModalFromData(id, username, maxStaff, maxParties, dailyMsgs, planExpiry, status, rawStaff) {
    document.getElementById('modalAdminId').value = id;
    document.getElementById('limitAdminName').innerText = username;
    document.getElementById('modalMaxStaff').value = (maxStaff !== undefined && maxStaff !== null && maxStaff !== 'undefined' && maxStaff !== 'null') ? maxStaff : 5;
    document.getElementById('modalMaxCustomers').value = (maxParties !== undefined && maxParties !== null && maxParties !== 'undefined' && maxParties !== 'null') ? maxParties : 500;
    document.getElementById('modalDailyMessages').value = (dailyMsgs !== undefined && dailyMsgs !== null && dailyMsgs !== 'undefined' && dailyMsgs !== 'null') ? dailyMsgs : 100;
    document.getElementById('modalStatus').value = status || 'approved';
    
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

function renderPending(users) {
    const tbody = document.getElementById('pendingTbody');
    if (!users.length) {
        document.getElementById('pendingWrapper').innerHTML = '<div class="empty-state">🎉 No pending registration requests. All clear!</div>';
        return;
    }
    
    // reset wrapper innerHTML back to table structure if it was empty state before
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
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}')">⊕ Manage Admin & Staff</button>
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
                            onclick="openLimitsModalFromData('${u._id}', '${escapeJsStr(u.username)}', '${u.maxStaffLimit}', '${u.maxCustomersLimit}', '${u.dailyMessageLimit}', '${u.planExpiryDate}', '${u.status}', '${rawStaff}')">⚙️ Credentials</button>
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
