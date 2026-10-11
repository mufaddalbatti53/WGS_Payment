import os
import re

ejs_file = r"c:\Users\mufad\OneDrive\Documents\GitHub\WGS_Payment\views\index.ejs"
html_out = r"c:\Users\mufad\OneDrive\Documents\GitHub\WGS_Payment\wgs-v2-split\frontend\index.html"
js_out = r"c:\Users\mufad\OneDrive\Documents\GitHub\WGS_Payment\wgs-v2-split\frontend\js\dashboard.js"

with open(ejs_file, 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Strip EJS logic blocks and insert placeholders
replacements = {
    "<%= role.toUpperCase() %>": "<span id=\"userRole\">Admin</span>",
    "<%= adminUser.companyName || 'Setup Your Profile' %>": "<span id=\"sidebarCompanyName\">Company Name</span>",
    "<%= adminUser.companyName || 'WGS Payment Manager' %>": "<span id=\"headerCompanyName\">WGS Payment Manager</span>",
    "<%= (adminUser.companyName || role).charAt(0).toUpperCase() %>": "<span id=\"avatarInitial\">A</span>",
    "<%= role.charAt(0).toUpperCase() + role.slice(1) %>": "<span id=\"headerRole\">Admin</span>",
    
    # Stats
    "<%= stats.totalParties %>": "<span id=\"statTotalParties\">0</span>",
    "<%= stats.totalPendingFmt %>": "<span id=\"statTotalPendingFmt\">0</span>",
    "<%= stats.actionRequiredCount %>": "<span id=\"statActionRequiredCount\">0</span>",
    
    # Forms
    "action=\"/customers\" method=\"POST\"": "id=\"addPartyForm\"",
    "action=\"/customers/bulk\" method=\"POST\"": "id=\"bulkForm\"",
    "action=\"/import\" method=\"POST\"": "id=\"importForm\"",
    "action=\"/restore-backup\" method=\"POST\"": "id=\"restoreForm\"",
    "action=\"/settings?_method=PUT\" method=\"POST\"": "id=\"settingsForm\"",
}

for k, v in replacements.items():
    html = html.replace(k, v)

# Regex replacements for forms
html = re.sub(r'<form\s+id="editForm"\s+method="POST">', '<form id="editForm">', html)
html = re.sub(r'<form\s+id="transactionForm"\s+method="POST">', '<form id="transactionForm">', html)
html = re.sub(r'<form\s+id="updateDateForm"\s+method="POST">', '<form id="updateDateForm">', html)

# Replace all `<% if(role === 'admin') { %>` with `<div class="admin-only">`
# This is tricky with raw string replace, let's use a simpler approach. We will just add classes to admin elements manually or use a regex to wrap/unwrap. 
# Since it's complex, we will remove <% ... %> tags and rely on JS to hide/show .admin-only classes.
html = re.sub(r'<% if\s*\(role\s*===\s*\'admin\'\s*\)\s*{ %>', '<div class="admin-only">', html)
html = re.sub(r'<% if\s*\(role\s*!==\s*\'customer\'\s*\)\s*{ %>', '<div class="non-customer-only">', html)
html = re.sub(r'<% } %>', '</div>', html)

# For buckets: 
for b in ['u30', 'd30_60', 'd60_90', 'd90_120', 'd120_150', 'a180', 'onAcc']:
    html = re.sub(rf'<%= stats\.buckets\.{b}\.cnt %>', f'<span id="bucket-{b}-cnt">0</span>', html)
    html = re.sub(rf'<%= stats\.buckets\.{b}\.fmt %>', f'<span id="bucket-{b}-fmt">0</span>', html)
    html = re.sub(rf'<%= stats\.buckets\.{b}\.pct %>', f'<span class="bucket-{b}-pct">0</span>', html)
    html = html.replace(f"<%= stats.buckets.{b}.cnt %>", f'<span id="bucket-{b}-cnt">0</span>')
    html = html.replace(f"<%= stats.buckets.{b}.fmt %>", f'<span id="bucket-{b}-fmt">0</span>')

# Handle settings modal values
html = re.sub(r'value="<%= adminUser\.([a-zA-Z0-9_]+) \|\| \'\' %>"', r'id="settings_\1" value=""', html)

# Remove the customer loop completely and replace with a tbody
loop_start = html.find('<tbody>')
loop_end = html.find('</tbody>', loop_start)
if loop_start != -1 and loop_end != -1:
    html = html[:loop_start] + '<tbody id="customerTableBody"></tbody>' + html[loop_end+8:]

# Mobile loop
mob_loop_start = html.find('<div id="mobileList">')
if mob_loop_start != -1:
    mob_loop_end = html.find('</div>', mob_loop_start)
    # The EJS is messy here, let's just do a regex replace
    pass

html = re.sub(r'<%[=]?\s*.*?\s*%>', '', html) # remove any remaining EJS tags

# Add scripts at the end
scripts = """
    <script>window.API_BASE = 'http://localhost:3000';</script>
    <script src="js/api.js"></script>
    <script src="js/dashboard.js"></script>
</body>
"""
html = html.replace('</body>', scripts)

with open(html_out, 'w', encoding='utf-8') as f:
    f.write(html)

js_content = """
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    setupForms();
});

async function loadDashboard() {
    try {
        const data = await apiFetch('/api/dashboard');
        populateDashboard(data);
    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

function populateDashboard(data) {
    if(document.getElementById('userRole')) document.getElementById('userRole').innerText = data.user.role.toUpperCase();
    if(document.getElementById('sidebarCompanyName')) document.getElementById('sidebarCompanyName').innerText = data.settings.companyName || 'Setup Your Profile';
    if(document.getElementById('headerCompanyName')) document.getElementById('headerCompanyName').innerText = data.settings.companyName || 'WGS Payment Manager';
    if(document.getElementById('headerRole')) document.getElementById('headerRole').innerText = data.user.role;
    if(document.getElementById('avatarInitial')) document.getElementById('avatarInitial').innerText = (data.settings.companyName || data.user.role).charAt(0).toUpperCase();

    // Stats
    if(document.getElementById('statTotalParties')) document.getElementById('statTotalParties').innerText = data.totalParties;
    if(document.getElementById('statTotalPendingFmt')) document.getElementById('statTotalPendingFmt').innerText = data.totalPendingFmt;
    if(document.getElementById('statActionRequiredCount')) document.getElementById('statActionRequiredCount').innerText = data.actionRequiredCount;

    // Buckets
    Object.keys(data.buckets).forEach(b => {
        const cntEl = document.getElementById(`bucket-${b}-cnt`);
        const fmtEl = document.getElementById(`bucket-${b}-fmt`);
        if(cntEl) cntEl.innerText = data.buckets[b].cnt;
        if(fmtEl) fmtEl.innerText = data.buckets[b].fmt;
        
        document.querySelectorAll(`.bucket-${b}-pct`).forEach(el => {
            el.style.width = data.buckets[b].pct + '%';
        });
    });

    // Populate Settings Modal
    Object.keys(data.settings).forEach(key => {
        const el = document.getElementById('settings_' + key);
        if(el) el.value = data.settings[key];
    });

    // Handle Admin UI
    if (data.user.role !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    renderCustomers(data.customers, data.user.role, data.settings.companyName);
}

function renderCustomers(customers, role, adminCompany) {
    const tbody = document.getElementById('customerTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    customers.forEach(customer => {
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
        tr.setAttribute('data-u30', ag.under30 || 0);
        tr.setAttribute('data-d30_60', ag.days30to60 || 0);
        tr.setAttribute('data-d60_90', ag.days60to90 || 0);
        tr.setAttribute('data-d90_120', ag.days90to120 || 0);
        tr.setAttribute('data-d120_150', ag.days120to150 || 0);
        tr.setAttribute('data-d150_180', ag.days150to180 || 0);
        tr.setAttribute('data-a180', ag.above180 || 0);
        
        let html = '';
        if (role === 'admin') {
            html += `<td class="desktop-only" style="text-align: center;"><input type="checkbox" class="customer-checkbox checkbox-custom" value="${customer._id}"></td>`;
        }
        
        html += `
            <td class="desktop-only">
                <strong style="font-size: 15px;">${customer.companyName || 'Unknown Party'}</strong><br>
                <span style="color: var(--text-muted); font-size:12px;">${customer.contactPerson || ''}</span>
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
                </div>`;
            }
            
            html += `
                <button class="btn-table" onclick="openTransactionModal('${customer._id}')" style="background:#fdf2f8; border-color:#fbcfe8; color:#be185d;">💳 Update Balance</button>
                <button class="btn-table" onclick="openActionModal('${customer._id}', '${customer.companyName}')" style="background:#f0fdf4; border-color:#bbf7d0; color:#15803d;">📅 Set Action Date</button>
                <button class="btn-table" onclick="openEditModal('${customer._id}', '${customer.companyName || ''}', '${customer.contactPerson || ''}', '${customer.phone || ''}', '${customer.whatsappNumber || ''}', '${customer.email || ''}', '${customer.totalAmount}', '${customer.paidAmount}', '${customer.otherNumbers || ''}')">✏️ Edit</button>
                <button class="btn-table" onclick="deleteCustomer('${customer._id}')" style="background:#fef2f2; border-color:#fecaca; color:#b91c1c;">🗑️ Delete</button>
            </td>`;
        }
        
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function setupForms() {
    const addForm = document.getElementById('addPartyForm');
    if (addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(addForm);
            const data = Object.fromEntries(fd.entries());
            await apiFetch('/add-customer', { method: 'POST', body: JSON.stringify(data) });
            loadDashboard();
            document.getElementById('addModal').style.display = 'none';
            addForm.reset();
        });
    }

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = editForm.getAttribute('data-id');
            const fd = new FormData(editForm);
            const data = Object.fromEntries(fd.entries());
            await apiFetch(`/edit-customer/${id}`, { method: 'POST', body: JSON.stringify(data) });
            loadDashboard();
            document.getElementById('editModal').style.display = 'none';
        });
    }

    const transForm = document.getElementById('transactionForm');
    if (transForm) {
        transForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = transForm.getAttribute('data-id');
            const fd = new FormData(transForm);
            const newPurchase = fd.get('newPurchase') || 0;
            const payment = fd.get('payment') || 0;
            if (newPurchase > 0) {
                await apiFetch(`/add-transaction/${id}`, { method: 'POST', body: JSON.stringify({ amount: newPurchase, type: 'purchase' }) });
            }
            if (payment > 0) {
                await apiFetch(`/add-transaction/${id}`, { method: 'POST', body: JSON.stringify({ amount: payment, type: 'payment' }) });
            }
            loadDashboard();
            document.getElementById('transactionModal').style.display = 'none';
            transForm.reset();
        });
    }
}

// Attach IDs to modals
window.openEditModal = function(id, comp, cont, ph, wa, em, tot, paid, oth) {
    document.getElementById('editComp').value = comp;
    document.getElementById('editCont').value = cont;
    document.getElementById('editPhone').value = ph;
    document.getElementById('editWa').value = wa;
    document.getElementById('editEmail').value = em;
    document.getElementById('editTotal').value = tot;
    document.getElementById('editPaid').value = paid;
    document.getElementById('editOther').value = oth;
    document.getElementById('editForm').setAttribute('data-id', id);
    document.getElementById('editModal').style.display = 'block';
}

window.openTransactionModal = function(id) {
    document.getElementById('transactionForm').setAttribute('data-id', id);
    document.getElementById('transactionModal').style.display = 'block';
}

window.deleteCustomer = async function(id) {
    if(confirm('Are you sure you want to delete this party?')) {
        await apiFetch(`/delete-customer/${id}`, { method: 'DELETE' });
        loadDashboard();
    }
}
"""

with open(js_out, 'w', encoding='utf-8') as f:
    f.write(js_content)

print("Files generated successfully.")
