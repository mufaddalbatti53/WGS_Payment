
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    setupForms();
});

async function loadDashboard() {
    try {
        const data = await apiJson('/api/dashboard');
        populateDashboard(data);
    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

function populateDashboard(data) {
    if (data && data.redirect) {
        window.location.href = data.redirect;
        return;
    }
    if (!data.success) {
        console.error("Dashboard error:", data.message);
        return;
    }
    
    const role = data.role || 'customer';
    const settings = data.adminUser || {};
    window.adminProfile = settings;
    const stats = data.stats || {};
    
    if(document.getElementById('userRole')) document.getElementById('userRole').innerText = role.toUpperCase();
    if(document.getElementById('sidebarCompanyName')) document.getElementById('sidebarCompanyName').innerText = settings.companyName || 'Setup Your Profile';
    if(document.getElementById('headerCompanyName')) document.getElementById('headerCompanyName').innerText = settings.companyName || 'WGS Payment Manager';
    if(document.getElementById('headerRole')) document.getElementById('headerRole').innerText = role;
    if(document.getElementById('headerGreetingRole')) document.getElementById('headerGreetingRole').innerText = role.charAt(0).toUpperCase() + role.slice(1);
    if(document.getElementById('avatarInitial')) document.getElementById('avatarInitial').innerText = (settings.companyName || role).charAt(0).toUpperCase();

    // Stats
    if(document.getElementById('statTotalParties')) document.getElementById('statTotalParties').innerText = stats.totalParties || 0;
    if(document.getElementById('statTotalPendingFmt')) document.getElementById('statTotalPendingFmt').innerText = stats.totalPendingFmt || '₹ 0';
    if(document.getElementById('statActionRequiredCount')) document.getElementById('statActionRequiredCount').innerText = stats.actionRequiredCount || 0;

    // Buckets
    if (stats.buckets) {
        Object.keys(stats.buckets).forEach(b => {
            const cntEl = document.getElementById(`bucket-${b}-cnt`);
            const fmtEl = document.getElementById(`bucket-${b}-fmt`);
            if(cntEl) cntEl.innerText = stats.buckets[b].cnt;
            if(fmtEl) fmtEl.innerText = stats.buckets[b].fmt;
            
            document.querySelectorAll(`.bucket-${b}-pct`).forEach(el => {
                el.style.width = stats.buckets[b].pct + '%';
            });
        });
    }

    // Populate Settings Modal
    const profileFields = ['companyName', 'addressLine1', 'addressLine2', 'dlNo', 'msmeNo', 'contactNo', 'companyEmail', 'bankName', 'accountName', 'accountNumber', 'ifscCode', 'upiDetails'];
    profileFields.forEach(key => {
        const el = document.getElementById('settings_' + key);
        if (el) el.value = (settings[key] !== undefined && settings[key] !== null) ? settings[key] : '';
    });

    // Handle Alerts
    const subBox = document.getElementById('subscriptionWarningBox');
    if (subBox) {
        if (data.subscriptionAlert) {
            subBox.style.display = 'flex';
            if (document.getElementById('subDaysLeft')) document.getElementById('subDaysLeft').innerText = data.subscriptionAlert.daysLeft + ' day(s)';
            if (document.getElementById('subExpiryDate')) document.getElementById('subExpiryDate').innerText = data.subscriptionAlert.expiryFormatted;
        } else {
            subBox.style.display = 'none';
        }
    }

    const quotaBox = document.getElementById('quotaAlertBox');
    if (quotaBox) {
        if (data.quotaAlert) {
            quotaBox.style.display = 'flex';
            if (document.getElementById('quotaAlertText')) document.getElementById('quotaAlertText').innerText = data.quotaAlert;
        } else {
            quotaBox.style.display = 'none';
        }
    }

    // Handle Google Drive Box
    const gdConnected = document.getElementById('gdriveConnected');
    const gdDisconnected = document.getElementById('gdriveDisconnected');
    if (gdConnected && gdDisconnected) {
        if (settings.isGoogleDriveLinked || settings.googleDriveToken || settings.googleEmail) {
            gdConnected.style.display = 'block';
            gdDisconnected.style.display = 'none';
            if (document.getElementById('googleEmailDisplay')) document.getElementById('googleEmailDisplay').innerText = settings.googleEmail || 'Linked Account';
        } else {
            gdConnected.style.display = 'none';
            gdDisconnected.style.display = 'block';
        }
    }

    if (document.getElementById('autoBackupInterval')) {
        document.getElementById('autoBackupInterval').value = settings.autoBackupInterval || 0;
    }

    // Handle Admin & Customer UI
    if (role !== 'admin' && role !== 'superadmin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
    if (role === 'customer') {
        document.querySelectorAll('.non-customer-only').forEach(el => el.style.display = 'none');
        if (window.innerWidth <= 850) {
            const viewAging = document.getElementById('viewAging');
            const viewParties = document.getElementById('viewParties');
            if (viewAging) viewAging.style.display = 'block';
            if (viewParties) viewParties.style.display = 'block';
        }
    }

    renderCustomers(data.customers || [], role, settings.companyName || 'Our Company');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderCustomers(customers, role, adminCompany) {
    const tbody = document.getElementById('customerTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    window.customerMap = {};
    
    customers.forEach(customer => {
        window.customerMap[customer._id] = customer;
        const due = customer.totalAmount - customer.paidAmount;
        const ag = customer.aging || {};
        const reqAction = (due > 0 && (!customer.nextActionDate || new Date() >= new Date(customer.nextActionDate))) ? 'true' : 'false';
        const nextDateString = customer.nextActionDate ? new Date(customer.nextActionDate).toLocaleDateString('en-IN') : '--';
        
        let diffDays = 0;
        if(customer.nextActionDate && new Date() >= new Date(customer.nextActionDate)) {
            diffDays = Math.floor((new Date() - new Date(customer.nextActionDate)) / (1000 * 60 * 60 * 24));
        }
        
        const tr = document.createElement('tr');
        tr.className = 'customer-row';
        tr.setAttribute('data-action', reqAction);
        tr.setAttribute('data-due', due);
        tr.setAttribute('data-phone', customer.phone ? ('+' + customer.phone + (customer.whatsappNumber ? ', +' + customer.whatsappNumber : '')) : '');
        tr.setAttribute('data-u30', ag.under30 || 0);
        tr.setAttribute('data-d30_60', ag.days30to60 || 0);
        tr.setAttribute('data-d60_90', ag.days60to90 || 0);
        tr.setAttribute('data-d90_120', ag.days90to120 || 0);
        tr.setAttribute('data-d120_150', ag.days120to150 || 0);
        tr.setAttribute('data-d150_180', ag.days150to180 || 0);
        tr.setAttribute('data-a180', ag.above180 || 0);
        
        // ── Desktop Table Cells ──
        let html = '';
        if (role === 'admin') {
            html += `<td class="desktop-only" style="text-align: center;"><input type="checkbox" class="customer-checkbox checkbox-custom" value="${customer._id}"></td>`;
        }
        
        html += `
            <td class="desktop-only">
                <strong style="font-size: 15px;">${escapeHtml(customer.companyName || 'Unknown Party')}</strong><br>
                <span style="color: var(--text-muted); font-size:12px;">${escapeHtml(customer.contactPerson || '')}</span>
            </td>
            <td class="desktop-only" style="font-size: 13px;">
                <strong>P:</strong> <a href="tel:+${customer.phone}" style="color:var(--text-dark); text-decoration:none;">+${customer.phone}</a><br>
                ${customer.whatsappNumber ? `<strong style="color:#15803d;">W:</strong> <a href="https://wa.me/${customer.whatsappNumber}" style="color:#15803d; text-decoration:none;">+${customer.whatsappNumber}</a>` : ''}
            </td>
            <td class="desktop-only">
                <div style="font-size: 12px;">Total: ₹${customer.totalAmount}</div>
                ${due > 0 ? `<div class="dynamic-due" style="color: #b91c1c; font-weight: 800; font-size: 15px; margin-top: 4px;">Due: ₹${due}</div>` 
                          : `<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: bold;">Fully Paid</span>`}
            </td>
        `;
        
        if (role !== 'customer') {
            html += `<td class="desktop-only">`;
            if (due > 0) {
                html += `<div style="font-weight: 600;">${nextDateString}</div>`;
                if (reqAction === 'true') {
                    html += `<span class="req-badge">⚠️ Action Required</span>`;
                }
            } else {
                html += `--`;
            }
            html += `</td><td class="desktop-only" style="text-align: right; padding-right: 20px;">`;
            
            if (due > 0 && reqAction === 'true') {
                html += `
                <div class="action-buttons" style="display:flex; gap:8px; justify-content: flex-end; margin-bottom: 10px;">
                    <a href="javascript:void(0)" onclick="sendMsg(this, 'wa')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" style="width:30px; height:30px; border-radius:50%; background: #dcfce7; display:flex; align-items:center; justify-content:center;"><img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="16" height="16"></a>
                    <a href="javascript:void(0)" onclick="sendMsg(this, 'sms')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" style="width:30px; height:30px; border-radius:50%; background: #f1f5f9; display:flex; align-items:center; justify-content:center; text-decoration:none; font-size:14px;">💬</a>
                    <a href="javascript:void(0)" onclick="sendMsg(this, 'email')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" style="width:30px; height:30px; border-radius:50%; background: #f1f5f9; display:flex; align-items:center; justify-content:center; text-decoration:none; font-size:14px;">📧</a>
                </div>`;
            }
            
            html += `
                <button class="btn-table" onclick="openTransactionModal('${customer._id}')" style="background:#fdf2f8; border-color:#fbcfe8; color:#be185d;">💳 Balance</button>
                ${due > 0 ? `<button class="btn-table" onclick="openActionModal('${customer._id}', '${encodeURIComponent(customer.companyName || '')}')" style="background:#f0fdf4; border-color:#bbf7d0; color:#15803d;">📅 Action Date</button>` : ''}
                ${role === 'admin' ? `
                <button class="btn-table" onclick="openEditModal('${customer._id}')">✏️ Edit</button>
                <button class="btn-table" onclick="deleteCustomer('${customer._id}')" style="background:#fef2f2; border-color:#fecaca; color:#b91c1c;">🗑️ Delete</button>
                ` : ''}
            </td>`;
        }
        
        // ── Mobile Responsive Card Cell ──
        html += `
        <td class="mobile-only">
            <div class="m-top">
                <div class="m-name">
                    ${role === 'admin' ? `<input type="checkbox" class="customer-checkbox checkbox-custom" value="${customer._id}" style="margin-top: 4px;">` : ''}
                    <div>
                        <strong>${escapeHtml(customer.companyName || 'Unknown Party')}</strong><br>
                        <a href="tel:+${customer.phone}" style="color:var(--secondary); text-decoration:none; font-weight:bold; font-size:14px; margin-top:6px; display:block;">📞 +${customer.phone}</a>
                    </div>
                </div>
                <div class="m-fin">
                    <div style="font-size:12px; color:var(--text-muted);">Total ₹${customer.totalAmount}</div>
                    ${due > 0 ? `<div class="dynamic-due-m" style="color:#b91c1c; font-weight:900; font-size:16px;">Due ₹${due}</div>` : `<div style="color:#15803d; font-weight:bold;">Paid 🎉</div>`}
                </div>
            </div>
            ${due > 0 && role !== 'customer' ? `
            <div style="font-size: 13px; color: var(--text-muted); padding-bottom: 15px; margin-bottom: 15px; border-bottom: 1px solid #f1f5f9;">
                📅 Action Date: <strong style="color:var(--text-dark);">${nextDateString}</strong>
                ${reqAction === 'true' ? `<span class="req-badge" style="float:right;">Action Required</span>` : ''}
            </div>` : ''}
            ${due > 0 && reqAction === 'true' && role !== 'customer' ? `
            <div class="m-circles">
                <a href="javascript:void(0)" onclick="sendMsg(this, 'wa')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" class="m-circle" style="background: #dcfce7; border-color: #bbf7d0;"><img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="20" height="20"></a>
                <a href="javascript:void(0)" onclick="sendMsg(this, 'sms')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" class="m-circle">💬</a>
                <a href="javascript:void(0)" onclick="sendMsg(this, 'email')" data-id="${customer._id}" data-phone="${customer.phone}" data-wa="${customer.whatsappNumber || ''}" data-email="${customer.email || ''}" data-cname="${encodeURIComponent(customer.companyName || '')}" data-pname="${encodeURIComponent(customer.contactPerson || '')}" data-total="${customer.totalAmount}" data-paidamount="${customer.paidAmount}" data-lastpaid="${encodeURIComponent(customer.lastPaymentDate || '')}" data-due="${due}" data-diff="${diffDays}" data-admin="${encodeURIComponent(adminCompany)}" class="m-circle">📧</a>
            </div>` : ''}
            ${role !== 'customer' ? `
            <div class="m-tools">
                <button class="m-tool-btn" onclick="openTransactionModal('${customer._id}')">💳 Bal</button>
                ${due > 0 ? `<button class="m-tool-btn" onclick="openActionModal('${customer._id}', '${encodeURIComponent(customer.companyName || '')}')">📅 Action</button>` : ''}
                ${role === 'admin' ? `
                <button class="m-tool-btn" onclick="openEditModal('${customer._id}')">✏️</button>
                <button class="m-tool-btn" style="color:#ef4444;" onclick="deleteCustomer('${customer._id}')">🗑️</button>
                ` : ''}
            </div>` : ''}
        </td>`;
        
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    // Re-apply any active filter and search query so they are never reset
    if (typeof window.runFilters === 'function') {
        window.runFilters();
    }
}

function setupForms() {
    const tbody = document.getElementById('customerTableBody');
    if (tbody) {
        tbody.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('customer-checkbox')) {
                if (typeof window.updateBulk === 'function') window.updateBulk();
            }
        });
    }

    const addForm = document.getElementById('addPartyForm');
    if (addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(addForm);
            const data = Object.fromEntries(fd.entries());
            try {
                const res = await apiJson('/api/customers', { method: 'POST', body: JSON.stringify(data) });
                if (res.success) {
                    if (typeof showToast === 'function') showToast('✅ Party added successfully!');
                    document.getElementById('addModal').style.display = 'none';
                    const dupAlert = document.getElementById('addDupAlert');
                    if (dupAlert) dupAlert.classList.remove('show');
                    addForm.reset();
                    await loadDashboard();
                } else {
                    alert('❌ ' + (res.message || 'Error adding party.'));
                }
            } catch (err) {
                alert('Error adding party: ' + err.message);
            }
        });
    }

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = editForm.getAttribute('data-id');
            const fd = new FormData(editForm);
            const data = Object.fromEntries(fd.entries());
            try {
                const res = await apiJson(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                if (res.success) {
                    if (typeof showToast === 'function') showToast('✅ Party updated successfully!');
                    document.getElementById('editModal').style.display = 'none';
                    await loadDashboard();
                } else {
                    alert('❌ ' + (res.message || 'Error updating party.'));
                }
            } catch (err) {
                alert('Error updating party: ' + err.message);
            }
        });
    }

    const transForm = document.getElementById('transactionForm');
    if (transForm) {
        transForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = transForm.getAttribute('data-id');
            const fd = new FormData(transForm);
            const newPurchase = parseFloat(fd.get('newPurchase')) || 0;
            const payment = parseFloat(fd.get('payment')) || 0;
            if (newPurchase <= 0 && payment <= 0) {
                return alert('Please enter a purchase or payment amount.');
            }
            try {
                const res = await apiJson(`/api/customers/${id}/transaction`, {
                    method: 'PUT',
                    body: JSON.stringify({ newPurchase, payment })
                });
                if (res.success) {
                    if (typeof showToast === 'function') showToast('✅ Balance updated!');
                    document.getElementById('transactionModal').style.display = 'none';
                    transForm.reset();
                    await loadDashboard();
                } else {
                    alert('❌ ' + (res.message || 'Error updating balance.'));
                }
            } catch (err) {
                alert('Error updating balance: ' + err.message);
            }
        });
    }

    const actionForm = document.getElementById('updateDateForm');
    if (actionForm) {
        actionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = actionForm.getAttribute('data-id');
            const fd = new FormData(actionForm);
            const nextDate = fd.get('nextDate');
            try {
                const res = await apiJson(`/api/customers/${id}/update-reminder`, {
                    method: 'PUT',
                    body: JSON.stringify({ nextDate })
                });
                if (res.success) {
                    if (typeof showToast === 'function') showToast('✅ Reminder date updated!');
                    document.getElementById('actionModal').style.display = 'none';
                    actionForm.reset();
                    await loadDashboard();
                } else {
                    alert('Error: ' + res.message);
                }
            } catch (err) {
                alert('Error updating reminder: ' + err.message);
            }
        });
    }

    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm && !settingsForm.getAttribute('onsubmit')) {
        settingsForm.addEventListener('submit', (e) => {
            if (typeof window.handleSettingsSubmit === 'function') {
                return window.handleSettingsSubmit(e);
            }
        });
    }

    const autoBackupForm = document.getElementById('autoBackupForm');
    if (autoBackupForm) {
        autoBackupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = document.getElementById('autoBackupInterval').value;
            try {
                const res = await apiJson('/api/settings/auto-backup', {
                    method: 'PUT',
                    body: JSON.stringify({ autoBackupInterval: val })
                });
                if (res.success) {
                    if (typeof showToast === 'function') showToast('✅ Auto-backup interval saved!');
                    else alert('✅ Auto-backup interval saved!');
                } else {
                    alert('Error: ' + res.message);
                }
            } catch(err) {
                alert('Error saving auto-backup: ' + err.message);
            }
        });
    }
}

// Attach IDs and pre-populate modals
window.openEditModal = function(id, comp, cont, ph, wa, em, tot, paid, oth) {
    const c = window.customerMap && window.customerMap[id] ? window.customerMap[id] : null;
    let compVal = c ? (c.companyName || '') : (comp || '');
    let contVal = c ? (c.contactPerson || '') : (cont || '');
    let phoneVal = c ? (c.phone || '') : (ph || '');
    let waVal = c ? (c.whatsappNumber || '') : (wa || '');
    let emailVal = c ? (c.email || '') : (em || '');
    let totalVal = c ? (c.totalAmount || 0) : (tot || 0);
    let paidVal = c ? (c.paidAmount || 0) : (paid || 0);
    let otherVal = c ? (c.otherNumbers || '') : (oth || '');

    // If 12 digits starting with country code 91, show the familiar 10 digits
    if (phoneVal && phoneVal.length === 12 && phoneVal.startsWith('91')) {
        phoneVal = phoneVal.slice(2);
    }
    if (waVal && waVal.length === 12 && waVal.startsWith('91')) {
        waVal = waVal.slice(2);
    }

    document.getElementById('editComp').value = compVal;
    document.getElementById('editCont').value = contVal;
    document.getElementById('editPhone').value = phoneVal;
    document.getElementById('editWa').value = waVal;
    document.getElementById('editEmail').value = emailVal;
    document.getElementById('editTotal').value = totalVal;
    document.getElementById('editPaid').value = paidVal;
    document.getElementById('editOther').value = otherVal;
    document.getElementById('editForm').setAttribute('data-id', id);
    document.getElementById('editModal').style.display = 'block';
};

window.openActionModal = function(id, cname) {
    const c = window.customerMap && window.customerMap[id] ? window.customerMap[id] : null;
    const name = c ? c.companyName : (cname ? decodeURIComponent(cname) : '');
    const titleEl = document.getElementById('actionModalCompanyName');
    if (titleEl) titleEl.innerText = name;
    const form = document.getElementById('updateDateForm');
    if (form) {
        form.setAttribute('data-id', id);
        const dateInput = form.querySelector('input[name="nextDate"]');
        if (dateInput && c && c.nextActionDate) {
            try {
                dateInput.value = new Date(c.nextActionDate).toISOString().slice(0, 10);
            } catch (e) {}
        }
    }
    document.getElementById('actionModal').style.display = 'block';
};

window.openTransactionModal = function(id) {
    document.getElementById('transactionForm').setAttribute('data-id', id);
    document.getElementById('transactionModal').style.display = 'block';
};

window.deleteCustomer = async function(id) {
    if(confirm('Are you sure you want to delete this party?')) {
        try {
            const res = await apiJson(`/api/customers/${id}`, { method: 'DELETE' });
            if (res && res.success) {
                if (typeof showToast === 'function') showToast('🗑️ Party deleted');
                await loadDashboard();
            } else {
                alert('❌ ' + ((res && res.message) || 'Error deleting party.'));
            }
        } catch (err) {
            alert('Error deleting party: ' + err.message);
        }
    }
};

window.handleLogout = async function() {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = 'index.html';
};

window.linkGoogleDrive = async function() {
    if (window.adminProfile && window.adminProfile.featureAccess && window.adminProfile.featureAccess.allowGoogleDriveBackup === false) {
        alert('☁️ Google Drive Cloud Backup is not enabled on your current subscription plan. Upgrade your plan or purchase the Cloud Backup Add-on.');
        return;
    }
    try {
        const res = await apiJson('/api/backup/google');
        if (res.success && res.url) {
            window.location.href = res.url;
        } else {
            alert('Failed to connect to Google Drive');
        }
    } catch (err) {
        alert('Google Drive connection error: ' + err.message);
    }
};

window.disconnectGoogleDrive = async function() {
    if (confirm('Disconnect Google Drive?')) {
        try {
            const res = await apiJson('/api/backup/google/disconnect', { method: 'POST' });
            if (res.success) {
                if (typeof showToast === 'function') showToast('Google Drive disconnected');
                loadDashboard();
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    }
};

window.exportExcel = async function() {
    try {
        if (typeof showToast === 'function') showToast('⏳ Preparing Excel export...');
        const response = await apiFetch('/api/backup/export', {
            headers: { 'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        });
        if (!response.ok) {
            throw new Error('Failed to export Excel (' + response.status + ')');
        }
        const blob = await response.blob();
        const cd = response.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/i);
        const filename = match ? match[1] : 'WGS_Sundry_Debtors.xlsx';

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('✅ Excel exported successfully!');
    } catch (err) {
        alert('Export error: ' + err.message);
    }
};

window.downloadJsonBackup = async function() {
    try {
        if (typeof showToast === 'function') showToast('⏳ Preparing JSON backup...');
        const response = await apiFetch('/api/backup/backup-data');
        if (!response.ok) {
            throw new Error('Failed to download backup (' + response.status + ')');
        }
        const blob = await response.blob();
        const cd = response.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/i);
        const filename = match ? match[1] : `WGS_Backup_${new Date().toISOString().slice(0, 10)}.json`;

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('✅ JSON backup downloaded!');
    } catch (err) {
        alert('Backup download error: ' + err.message);
    }
};

window.handleQuickImport = async function(fileInput) {
    if (!fileInput || !fileInput.files || !fileInput.files.length) return;
    if (window.adminProfile && window.adminProfile.featureAccess && window.adminProfile.featureAccess.allowExcelImport === false) {
        fileInput.value = '';
        alert('📥 Bulk Excel Import is not enabled on your current subscription plan. Please upgrade your plan or contact Super Admin.');
        return;
    }
    if (typeof showToast === 'function') showToast('⏳ Importing Excel...');
    const fd = new FormData();
    fd.append('excelFile', fileInput.files[0]);
    try {
        const res = await apiJson('/api/backup/import', { method: 'POST', body: fd });
        if (res.success) {
            if (typeof showToast === 'function') showToast('✅ ' + (res.message || 'Import successful!'));
            else alert('✅ ' + (res.message || 'Import successful!'));
            await loadDashboard();
        } else {
            alert('❌ ' + (res.message || 'Import failed.'));
        }
    } catch (err) {
        alert('Import error: ' + err.message);
    } finally {
        fileInput.value = '';
    }
};

window.handleImportSubmit = async function(e) {
    e.preventDefault();
    if (window.adminProfile && window.adminProfile.featureAccess && window.adminProfile.featureAccess.allowExcelImport === false) {
        return alert('📥 Bulk Excel Import is not enabled on your current subscription plan. Please upgrade your plan or contact Super Admin.');
    }
    const fileInput = document.getElementById('excelFileInput');
    if (!fileInput.files.length) return alert('Please choose an Excel file.');
    const btn = document.getElementById('importBtn');
    if (btn) { btn.innerText = '⏳ Importing...'; btn.disabled = true; }
    const fd = new FormData();
    fd.append('excelFile', fileInput.files[0]);
    try {
        const res = await apiJson('/api/backup/import', { method: 'POST', body: fd });
        if (res.success) {
            alert('✅ ' + (res.message || 'Import successful!'));
            loadDashboard();
        } else {
            alert('❌ ' + (res.message || 'Import failed.'));
        }
    } catch(err) {
        alert('Import error: ' + err.message);
    } finally {
        if (btn) { btn.innerText = '📤 Import Excel'; btn.disabled = false; }
    }
};

window.handleRestoreSubmit = async function(e) {
    e.preventDefault();
    const fileInput = document.getElementById('restoreFileInput');
    if (!fileInput.files.length) return alert('Please choose a JSON backup file.');
    if (!confirm('⚠️ WARNING: This will overwrite your current party data with the uploaded file. Proceed?')) return;
    const btn = document.getElementById('restoreBtn');
    if (btn) { btn.innerText = '⏳ Restoring...'; btn.disabled = true; }
    const fd = new FormData();
    fd.append('backupFile', fileInput.files[0]);
    try {
        const res = await apiJson('/api/backup/restore-backup', { method: 'POST', body: fd });
        if (res.success) {
            alert('✅ ' + (res.message || 'Data restored successfully!'));
            loadDashboard();
        } else {
            alert('❌ ' + (res.message || 'Restore failed.'));
        }
    } catch(err) {
        alert('Restore error: ' + err.message);
    } finally {
        if (btn) { btn.innerText = '🔄 Local Restore'; btn.disabled = false; }
    }
};
