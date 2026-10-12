function escapeHtmlActivity(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
    const tableBody = document.getElementById('activityTableBody');
    const searchInput = document.getElementById('activitySearch');
    const filterType = document.getElementById('filterType');
    const customDateBoxes = document.getElementById('customDateBoxes');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (typeof window.performFastLogout === 'function') {
                return window.performFastLogout('login.html');
            }
            try {
                localStorage.removeItem('wgs_auth_token');
                localStorage.removeItem('token');
                if (typeof apiFetch === 'function') {
                    await apiFetch('/api/logout', { method: 'POST' });
                } else {
                    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
                }
            } catch (err) { console.error(err); }
            window.location.href = 'login.html';
        });
    }

    if (filterType) {
        filterType.addEventListener('change', () => {
            customDateBoxes.style.display = (filterType.value === 'custom') ? 'flex' : 'none';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keyup', function () {
            let filter = this.value.toLowerCase();
            document.querySelectorAll('tbody tr').forEach(row => { 
                row.style.display = row.innerText.toLowerCase().includes(filter) ? '' : 'none'; 
            });
        });
    }

    try {
        const response = await apiJson('/api/activity');
        const activities = Array.isArray(response) ? response : (response.activities || []);

        if (response.role === 'admin' || (response.user && response.user.role === 'admin')) {
            const adminControls = document.getElementById('adminControls');
            if (adminControls) adminControls.style.display = 'block';
        }

        renderActivities(activities);
    } catch (err) {
        console.error('Failed to fetch activities:', err);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Failed to load activity logs</td></tr>`;
    }

    function renderActivities(activities) {
        tableBody.innerHTML = '';
        if (!activities || activities.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px;">No activities found</td></tr>`;
            return;
        }

        activities.forEach(log => {
            const rawDate = log.createdAt || log.date || log.timestamp;
            const hasValidDate = rawDate ? true : false;
            const validDate = hasValidDate ? new Date(rawDate) : null;
            
            let dateStr = '<span style="color:#cbd5e1;">Unknown</span>';
            let mobileDateStr = '<span style="color:#cbd5e1;">Date Unknown</span>';
            if (hasValidDate) {
                dateStr = `${validDate.toLocaleDateString('en-IN')}<br><span style="font-weight: bold; color: var(--text-dark);">${validDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>`;
                mobileDateStr = `${validDate.toLocaleDateString('en-IN')}<br><strong style="color: var(--text-dark);">${validDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong>`;
            }

            const username = escapeHtmlActivity(log.username || 'Admin');
            const action = escapeHtmlActivity(log.action || '');
            const details = escapeHtmlActivity(log.details || '');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="desktop-only" style="white-space: nowrap; color: var(--text-muted); font-size: 13px;">
                    ${dateStr}
                </td>
                <td class="desktop-only" style="font-weight: 600; color: var(--text-dark);">
                    ${username}
                </td>
                <td class="desktop-only action-text">
                    ${action}
                </td>
                <td class="desktop-only" style="color: var(--text-muted); line-height: 1.4;">
                    ${details}
                </td>
                <td class="mobile-only">
                    <div class="log-header">
                        <div class="log-action">${action}</div>
                        <div class="log-date">${mobileDateStr}</div>
                    </div>
                    <div class="log-user">👤 <strong>${username}</strong></div>
                    <div class="log-details">${details}</div>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    const bulkClearForm = document.getElementById('bulkClearForm');
    if (bulkClearForm) {
        bulkClearForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!confirm('Are you sure you want to delete these logs permanently?')) return;
            
            const formData = new FormData(bulkClearForm);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const result = await apiJson('/api/activity/delete-bulk', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                if (result && result.success === false) {
                    alert('Failed to clear logs: ' + (result.message || 'Unknown error'));
                    return;
                }
                alert('Logs cleared successfully');
                window.location.reload();
            } catch (err) {
                console.error('Failed to clear logs:', err);
                alert('Failed to clear logs: ' + err.message);
            }
        });
    }
});
