
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
            const dLeft = data.subscriptionAlert.daysLeft;
            if (dLeft < 0) {
                subBox.style.background = '#fef2f2';
                subBox.style.borderColor = '#ef4444';
                if (document.getElementById('subWarningTitle')) {
                    document.getElementById('subWarningTitle').style.color = '#b91c1c';
                    document.getElementById('subWarningTitle').innerText = '🚨 Yearly Subscription Expired!';
                }
                if (document.getElementById('subWarningDesc')) {
                    document.getElementById('subWarningDesc').style.color = '#7f1d1d';
                    document.getElementById('subWarningDesc').innerHTML = `Your plan expired <u>${Math.abs(dLeft)} day(s) ago</u> (on ${escapeHtml(data.subscriptionAlert.expiryFormatted)}). Please renew your yearly plan now (with or without add-ons) to continue uninterrupted access.`;
                }
            } else {
                subBox.style.background = '#fff7ed';
                subBox.style.borderColor = '#f97316';
                if (document.getElementById('subWarningTitle')) {
                    document.getElementById('subWarningTitle').style.color = '#c2410c';
                    document.getElementById('subWarningTitle').innerText = '⏰ Subscription Expiry Reminder';
                }
                if (document.getElementById('subDaysLeft')) document.getElementById('subDaysLeft').innerText = dLeft + ' day(s)';
                if (document.getElementById('subExpiryDate')) document.getElementById('subExpiryDate').innerText = data.subscriptionAlert.expiryFormatted;
            }
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

    // Populate Top-Right Subscription Details Popup & Auto Renewal Reminder Modal
    if (typeof populateSubscriptionUI === 'function') {
        populateSubscriptionUI(data.subscriptionDetails, role);
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

// =========================================================================
// TOP-RIGHT SUBSCRIPTION DETAILS POPUP & YEARLY RENEWAL MODAL (WITH / WITHOUT ADD-ONS)
// =========================================================================
window.currentSubscriptionDetails = null;
window.selectedRenewalMode = 'with_addons';
window._renewalPopupShownThisLoad = false;

window.populateSubscriptionUI = function(sub, role) {
    const container = document.getElementById('topRightSubContainer');
    if (!container) return;

    if (role !== 'admin' || !sub) {
        container.style.display = 'none';
        return;
    }

    window.currentSubscriptionDetails = sub;
    container.style.display = 'block';

    const btn = document.getElementById('topRightSubBtn');
    const planText = document.getElementById('topRightSubPlanText');
    const daysBadge = document.getElementById('topRightSubDaysBadge');
    const mobileBadge = document.getElementById('mobileHeaderSubBadge');

    if (planText) planText.innerText = sub.planName || 'Yearly Plan';
    if (mobileBadge) mobileBadge.innerText = sub.planName || 'Yearly Plan';

    if (btn) {
        btn.classList.remove('near-expiry', 'expired');
        if (sub.isExpired) btn.classList.add('expired');
        else if (sub.isNearExpiry) btn.classList.add('near-expiry');
    }

    if (daysBadge) {
        if (sub.daysLeft === null || sub.daysLeft === undefined) {
            daysBadge.innerText = 'Active';
            daysBadge.style.background = '#dcfce7';
            daysBadge.style.color = '#166534';
        } else if (sub.isExpired) {
            daysBadge.innerText = '🚨 Expired';
            daysBadge.style.background = '#fee2e2';
            daysBadge.style.color = '#b91c1c';
        } else if (sub.isNearExpiry) {
            daysBadge.innerText = `⚠️ ${sub.daysLeft}d left`;
            daysBadge.style.background = '#ffedd5';
            daysBadge.style.color = '#c2410c';
        } else {
            daysBadge.innerText = `${sub.daysLeft}d left`;
            daysBadge.style.background = '#dcfce7';
            daysBadge.style.color = '#166534';
        }
    }

    // Populate Top-Right Popup Card
    const setElText = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.innerText = txt;
    };

    setElText('subPopupPlanName', sub.planName || 'Basic Plan (Yearly)');
    setElText('subPopupCycleBadge', `📅 Yearly Plan (${sub.planDurationMonths || 12} Months)`);

    const statusBadge = document.getElementById('subPopupStatusBadge');
    if (statusBadge) {
        if (sub.isExpired) {
            statusBadge.innerText = '● Expired';
            statusBadge.style.background = '#fee2e2';
            statusBadge.style.color = '#b91c1c';
        } else if (sub.isNearExpiry) {
            statusBadge.innerText = '● Expiring Soon';
            statusBadge.style.background = '#ffedd5';
            statusBadge.style.color = '#c2410c';
        } else {
            statusBadge.innerText = '● Active';
            statusBadge.style.background = '#dcfce7';
            statusBadge.style.color = '#166534';
        }
    }

    setElText('subPopupExpiryDate', sub.expiryFormatted || 'No Expiry Set');
    const daysLeftEl = document.getElementById('subPopupDaysLeftText');
    const progBar = document.getElementById('subPopupProgressBar');
    if (daysLeftEl && progBar) {
        if (sub.daysLeft === null || sub.daysLeft === undefined) {
            daysLeftEl.innerText = 'Unlimited / Active';
            daysLeftEl.style.color = '#16a34a';
            progBar.style.width = '100%';
            progBar.style.background = '#22c55e';
        } else if (sub.isExpired) {
            daysLeftEl.innerText = `Expired ${Math.abs(sub.daysLeft)}d ago`;
            daysLeftEl.style.color = '#dc2626';
            progBar.style.width = '100%';
            progBar.style.background = '#ef4444';
        } else {
            daysLeftEl.innerText = `${sub.daysLeft} day(s) left`;
            const pct = Math.max(4, Math.min(100, Math.round((sub.daysLeft / 365) * 100)));
            progBar.style.width = pct + '%';
            if (sub.isNearExpiry) {
                daysLeftEl.style.color = '#ea580c';
                progBar.style.background = '#f97316';
            } else {
                daysLeftEl.style.color = '#16a34a';
                progBar.style.background = '#22c55e';
            }
        }
    }

    setElText('subPopupApprovedAt', sub.approvedAt ? new Date(sub.approvedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Active');
    setElText('subPopupLastPaidInfo', sub.lastAmountPaid ? `Last Paid: ₹${Number(sub.lastAmountPaid).toLocaleString('en-IN')}` : 'Yearly Billing');

    // Quotas
    const q = sub.quotas || {};
    setElText('subPopupQuotaParties', `${q.partiesUsed || 0} / ${q.partiesLimit || 0}`);
    setElText('subPopupQuotaStaff', `${q.staffUsed || 0} / ${q.staffLimit || 0}`);
    setElText('subPopupQuotaMsgs', `${q.messagesUsed || 0} / ${q.messagesLimit || 0}`);

    // Active Add-ons inside Top-Right Popup
    const addonsListEl = document.getElementById('subPopupAddonsList');
    if (addonsListEl) {
        const activeAddons = Array.isArray(sub.activeAddons) ? sub.activeAddons : [];
        if (activeAddons.length > 0) {
            addonsListEl.innerHTML = activeAddons.map(a =>
                `<span style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; font-weight:700; font-size:11px; padding:3px 8px; border-radius:8px;">✨ ${escapeHtml(a.name || a.title || a.id || a.addonId || 'Add-on')}</span>`
            ).join('');
        } else {
            addonsListEl.innerHTML = `<span style="font-size:12px; color:#94a3b8;">No active add-ons on current cycle</span>`;
        }
    }

    // Enabled Features inside Top-Right Popup
    const featListEl = document.getElementById('subPopupFeaturesList');
    if (featListEl) {
        const fa = sub.featureAccess || {};
        const gdriveAllowed = fa.allowGoogleDriveBackup !== undefined ? fa.allowGoogleDriveBackup !== false : (fa.allowGoogleDrive !== false);
        const badges = [
            { label: '💬 WhatsApp', on: fa.allowWhatsApp !== false },
            { label: '📱 SMS', on: fa.allowSms !== false },
            { label: '📧 Email', on: fa.allowEmail !== false },
            { label: '☁️ Cloud Backup', on: gdriveAllowed },
            { label: '📥 Excel Import', on: fa.allowExcelImport !== false },
            { label: '📄 PDF Reports', on: fa.allowPdfExport !== false }
        ];
        featListEl.innerHTML = badges.map(b =>
            `<span style="font-size:10px; font-weight:700; padding:3px 7px; border-radius:6px; background:${b.on ? '#eff6ff' : '#f1f5f9'}; color:${b.on ? '#1d4ed8' : '#94a3b8'};">${b.on ? '✓ ' : '✕ '}${b.label}</span>`
        ).join('');
    }

    // Quotes for Renew WITH Add-ons vs WITHOUT Add-ons
    const withQuote = sub.renewWithAddonsQuote || {};
    const withoutQuote = sub.renewWithoutAddonsQuote || {};
    const withTotal = Number(withQuote.totalAmount || 0);
    const withoutTotal = Number(withoutQuote.totalAmount || 0);

    setElText('subPopupPriceWithAddons', `₹${withTotal.toLocaleString('en-IN')} / Yr`);
    setElText('subPopupPriceWithoutAddons', `₹${withoutTotal.toLocaleString('en-IN')} / Yr`);

    // Populate Renewal Reminder Modal (#renewalPopupModal)
    populateRenewalModalContent(sub);

    // Automatically open the Renewal Reminder Modal if subscription is near expiry (<= 15 days) or expired (< 0 days)
    if ((sub.isNearExpiry || sub.isExpired) && !window._renewalPopupShownThisLoad) {
        window._renewalPopupShownThisLoad = true;
        const defaultMode = sub.hasAddons ? 'with_addons' : 'without_addons';
        openRenewalModal(defaultMode);
    }
};

function populateRenewalModalContent(sub) {
    if (!sub) return;
    const withQuote = sub.renewWithAddonsQuote || {};
    const withoutQuote = sub.renewWithoutAddonsQuote || {};
    const activeAddons = Array.isArray(sub.activeAddons) ? sub.activeAddons : [];

    const iconEl = document.getElementById('renewalModalIcon');
    const titleEl = document.getElementById('renewalModalTitle');
    const subEl = document.getElementById('renewalModalSubtitle');
    const bannerEl = document.getElementById('renewalModalAlertBanner');

    if (sub.isExpired) {
        if (iconEl) { iconEl.innerText = '🚨'; iconEl.style.background = '#fee2e2'; }
        if (titleEl) titleEl.innerText = 'Your Yearly Subscription Has Expired!';
        if (subEl) subEl.innerText = 'Renew now with or without your add-ons to restore full access for 1 Year (12 Months).';
        if (bannerEl) {
            bannerEl.style.background = '#fef2f2';
            bannerEl.style.borderColor = '#fca5a5';
            bannerEl.style.color = '#991b1b';
            bannerEl.innerHTML = `🚨 Your <strong>${escapeHtml(sub.planName)}</strong> expired <strong>${Math.abs(sub.daysLeft)} day(s) ago</strong> (on <strong>${escapeHtml(sub.expiryFormatted)}</strong>). Please select a renewal option below.`;
        }
    } else if (sub.isNearExpiry) {
        if (iconEl) { iconEl.innerText = '⏰'; iconEl.style.background = '#fff7ed'; }
        if (titleEl) titleEl.innerText = `Subscription Renewal Reminder (${sub.daysLeft} Day${sub.daysLeft === 1 ? '' : 's'} Left)`;
        if (subEl) subEl.innerText = 'Your yearly subscription is nearing expiry. Renew now to add 1 Full Year (12 Months) seamlessly.';
        if (bannerEl) {
            bannerEl.style.background = '#fff7ed';
            bannerEl.style.borderColor = '#fdba74';
            bannerEl.style.color = '#9a3412';
            bannerEl.innerHTML = `⏰ Your <strong>${escapeHtml(sub.planName)}</strong> expires in <strong>${sub.daysLeft} day(s)</strong> (on <strong>${escapeHtml(sub.expiryFormatted)}</strong>). Renewing early adds 12 Months on top of your current expiry date!`;
        }
    } else {
        if (iconEl) { iconEl.innerText = '💎'; iconEl.style.background = '#f0fdf4'; }
        if (titleEl) titleEl.innerText = 'Renew Yearly Subscription';
        if (subEl) subEl.innerText = 'Extend your subscription by 1 Full Year (12 Months) with or without add-ons.';
        if (bannerEl) {
            bannerEl.style.background = '#f0fdf4';
            bannerEl.style.borderColor = '#bbf7d0';
            bannerEl.style.color = '#166534';
            bannerEl.innerHTML = `✅ Your <strong>${escapeHtml(sub.planName)}</strong> is active until <strong>${escapeHtml(sub.expiryFormatted || 'Active')}</strong> (${sub.daysLeft !== null ? sub.daysLeft + ' days remaining' : 'Active'}). Renewing adds 12 Months to your validity.`;
        }
    }

    // Option 1: Renew WITH Add-ons
    const withTotalEl = document.getElementById('renewWithAddonsTotal');
    const withBreakEl = document.getElementById('renewWithAddonsBreakdown');
    const withQuotasEl = document.getElementById('renewWithAddonsQuotas');
    const withListEl = document.getElementById('renewWithAddonsList');
    const withBadgeEl = document.getElementById('renewWithAddonsBadge');

    const withBaseAmt = Number(withQuote.baseAmount ?? withQuote.planPrice ?? 0);
    const withAddonsAmt = Number(withQuote.addonsAmount ?? withQuote.addonsTotal ?? 0);
    const withLimits = withQuote.limits || {
        partyLimit: withQuote.finalPartiesLimit ?? 250,
        staffLimit: withQuote.finalStaffLimit ?? 2,
        dailyMessageLimit: withQuote.finalMessagesLimit ?? 50
    };

    if (withTotalEl) withTotalEl.innerText = '₹' + Number(withQuote.totalAmount || 0).toLocaleString('en-IN');
    if (withBreakEl) {
        if (activeAddons.length > 0) {
            withBreakEl.innerText = `Base ₹${withBaseAmt.toLocaleString('en-IN')} + Add-ons ₹${withAddonsAmt.toLocaleString('en-IN')}`;
        } else {
            withBreakEl.innerText = `Base Plan ₹${withBaseAmt.toLocaleString('en-IN')} (0 Active Add-ons)`;
        }
    }
    if (withBadgeEl) {
        withBadgeEl.innerText = activeAddons.length > 0 ? `✅ Keep ${activeAddons.length} Active Add-on(s)` : '✅ Current Plan Configuration';
    }
    if (withQuotasEl && withLimits) {
        withQuotasEl.innerHTML = `
            <div>🏢 Up to <strong>${withLimits.partyLimit}</strong> Parties</div>
            <div>👤 Up to <strong>${withLimits.staffLimit}</strong> Staff Accounts</div>
            <div>💬 Up to <strong>${withLimits.dailyMessageLimit}</strong> Msgs / Day</div>
        `;
    }
    if (withListEl) {
        if (activeAddons.length > 0) {
            withListEl.innerHTML = activeAddons.map(a =>
                `<span style="background:#dcfce7; color:#166534; font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px;">+ ${escapeHtml(a.name || a.title || a.id || a.addonId || 'Add-on')}</span>`
            ).join('');
        } else {
            withListEl.innerHTML = `<a href="index.html#pricing" style="font-size:11px; color:#16a34a; font-weight:700; text-decoration:underline;">+ Click here if you want to add new Add-on Boosters</a>`;
        }
    }

    // Option 2: Renew WITHOUT Add-ons
    const withoutTotalEl = document.getElementById('renewWithoutAddonsTotal');
    const withoutBreakEl = document.getElementById('renewWithoutAddonsBreakdown');
    const withoutQuotasEl = document.getElementById('renewWithoutAddonsQuotas');

    const withoutBaseAmt = Number(withoutQuote.baseAmount ?? withoutQuote.planPrice ?? 0);
    const withoutLimits = withoutQuote.limits || {
        partyLimit: withoutQuote.finalPartiesLimit ?? 250,
        staffLimit: withoutQuote.finalStaffLimit ?? 2,
        dailyMessageLimit: withoutQuote.finalMessagesLimit ?? 50
    };

    if (withoutTotalEl) withoutTotalEl.innerText = '₹' + Number(withoutQuote.totalAmount || 0).toLocaleString('en-IN');
    if (withoutBreakEl) {
        withoutBreakEl.innerText = `Base Yearly Plan ₹${withoutBaseAmt.toLocaleString('en-IN')} (₹0 Add-ons)`;
    }
    if (withoutQuotasEl && withoutLimits) {
        withoutQuotasEl.innerHTML = `
            <div>🏢 Up to <strong>${withoutLimits.partyLimit}</strong> Parties</div>
            <div>👤 Up to <strong>${withoutLimits.staffLimit}</strong> Staff Accounts</div>
            <div>💬 Up to <strong>${withoutLimits.dailyMessageLimit}</strong> Msgs / Day</div>
        `;
    }

    selectRenewalMode(window.selectedRenewalMode || (sub.hasAddons ? 'with_addons' : 'without_addons'));
}

window.toggleTopRightSubPopup = function(e) {
    if (e) e.stopPropagation();
    const popup = document.getElementById('topRightSubPopup');
    if (!popup) return;
    popup.classList.toggle('open');
};

window.closeTopRightSubPopup = function() {
    const popup = document.getElementById('topRightSubPopup');
    if (popup) popup.classList.remove('open');
};

document.addEventListener('click', (e) => {
    const container = document.getElementById('topRightSubContainer');
    const popup = document.getElementById('topRightSubPopup');
    if (popup && popup.classList.contains('open') && container && !container.contains(e.target)) {
        popup.classList.remove('open');
    }
});

window.openRenewalModal = function(defaultMode) {
    closeTopRightSubPopup();
    const modal = document.getElementById('renewalPopupModal');
    const errEl = document.getElementById('renewalModalError');
    if (errEl) errEl.style.display = 'none';
    if (defaultMode) {
        selectRenewalMode(defaultMode);
    } else if (window.currentSubscriptionDetails) {
        selectRenewalMode(window.currentSubscriptionDetails.hasAddons ? 'with_addons' : 'without_addons');
    }
    if (modal) modal.style.display = 'block';
};

window.closeRenewalModal = function() {
    const modal = document.getElementById('renewalPopupModal');
    if (modal) modal.style.display = 'none';
};

window.selectRenewalMode = function(mode) {
    window.selectedRenewalMode = mode === 'without_addons' ? 'without_addons' : 'with_addons';
    const cardWith = document.getElementById('renewCardWithAddons');
    const cardWithout = document.getElementById('renewCardWithoutAddons');
    const radioWith = document.getElementById('radioRenewWithAddons');
    const radioWithout = document.getElementById('radioRenewWithoutAddons');
    const payBtn = document.getElementById('payRenewalRazorpayBtn');

    if (cardWith) cardWith.classList.toggle('selected', window.selectedRenewalMode === 'with_addons');
    if (cardWithout) cardWithout.classList.toggle('selected', window.selectedRenewalMode === 'without_addons');
    if (radioWith) radioWith.checked = (window.selectedRenewalMode === 'with_addons');
    if (radioWithout) radioWithout.checked = (window.selectedRenewalMode === 'without_addons');

    const sub = window.currentSubscriptionDetails;
    if (payBtn && sub) {
        const quote = window.selectedRenewalMode === 'without_addons'
            ? (sub.renewWithoutAddonsQuote || {})
            : (sub.renewWithAddonsQuote || {});
        const amt = Number(quote.totalAmount || 0).toLocaleString('en-IN');
        const label = window.selectedRenewalMode === 'without_addons' ? 'WITHOUT Add-ons' : 'WITH Add-ons';
        payBtn.innerText = `💳 Pay ₹${amt} & Renew ${label} (1 Year)`;
    }
};

window.startDashboardRazorpayRenewal = async function() {
    const payBtn = document.getElementById('payRenewalRazorpayBtn');
    const errEl = document.getElementById('renewalModalError');
    if (errEl) errEl.style.display = 'none';

    const renewalMode = window.selectedRenewalMode || 'with_addons';
    const origText = payBtn ? payBtn.innerText : '💳 Pay & Renew Yearly Subscription';
    if (payBtn) {
        payBtn.disabled = true;
        payBtn.innerText = '⏳ Creating Razorpay Renewal Order...';
    }

    try {
        const orderRes = await apiJson('/api/subscriptions/create-renewal-order', {
            method: 'POST',
            body: JSON.stringify({ renewalMode })
        });

        if (!orderRes || !orderRes.success) {
            if (errEl) {
                errEl.innerText = '⚠️ ' + ((orderRes && (orderRes.message || orderRes.error)) || 'Could not initiate Razorpay order.');
                errEl.style.display = 'block';
            }
            if (payBtn) { payBtn.disabled = false; payBtn.innerText = origText; }
            return;
        }

        if (typeof window.Razorpay !== 'function') {
            if (errEl) {
                errEl.innerText = '⚠️ Razorpay SDK failed to load. Please check your internet connection and refresh.';
                errEl.style.display = 'block';
            }
            if (payBtn) { payBtn.disabled = false; payBtn.innerText = origText; }
            return;
        }

        const prefillInfo = orderRes.prefill || orderRes.adminInfo || {};
        const options = {
            key: orderRes.keyId,
            amount: orderRes.amount,
            currency: orderRes.currency || 'INR',
            name: 'WGS Payment Tracker',
            description: `${orderRes.quote.planName} — Yearly Renewal (${renewalMode === 'without_addons' ? 'Without Add-ons' : 'With Add-ons'})`,
            order_id: orderRes.orderId,
            prefill: {
                name: prefillInfo.name || prefillInfo.companyName || '',
                email: prefillInfo.email || '',
                contact: prefillInfo.contact || prefillInfo.phone || ''
            },
            theme: { color: '#27ae60' },
            handler: async function(response) {
                try {
                    if (payBtn) {
                        payBtn.disabled = true;
                        payBtn.innerText = '⏳ Verifying Payment & Extending Yearly Plan...';
                    }
                    const verifyRes = await apiJson('/api/subscriptions/verify-renewal', {
                        method: 'POST',
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            renewalMode: renewalMode
                        })
                    });

                    if (verifyRes && verifyRes.success) {
                        closeRenewalModal();
                        if (typeof showToast === 'function') {
                            showToast('🎉 ' + (verifyRes.message || 'Yearly Subscription Renewed!'));
                        } else {
                            alert('🎉 ' + (verifyRes.message || 'Yearly Subscription Renewed!'));
                        }
                        await loadDashboard();
                    } else {
                        if (errEl) {
                            errEl.innerText = '❌ ' + ((verifyRes && (verifyRes.message || verifyRes.error)) || 'Payment verification failed.');
                            errEl.style.display = 'block';
                        }
                    }
                } catch (verifyErr) {
                    if (errEl) {
                        errEl.innerText = '❌ Verification error: ' + verifyErr.message;
                        errEl.style.display = 'block';
                    }
                } finally {
                    if (payBtn) { payBtn.disabled = false; selectRenewalMode(window.selectedRenewalMode); }
                }
            },
            modal: {
                ondismiss: function() {
                    if (payBtn) { payBtn.disabled = false; selectRenewalMode(window.selectedRenewalMode); }
                }
            }
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function(resp) {
            if (errEl) {
                errEl.innerText = '❌ Payment Failed: ' + ((resp.error && resp.error.description) || 'Transaction declined');
                errEl.style.display = 'block';
            }
            if (payBtn) { payBtn.disabled = false; selectRenewalMode(window.selectedRenewalMode); }
        });
        rzp.open();
    } catch (err) {
        if (errEl) {
            errEl.innerText = '❌ Error: ' + err.message;
            errEl.style.display = 'block';
        }
        if (payBtn) { payBtn.disabled = false; payBtn.innerText = origText; }
    }
};

