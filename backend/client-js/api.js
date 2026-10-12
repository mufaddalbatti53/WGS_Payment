const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = (window.API_BASE && (!window.API_BASE.includes('localhost') || isLocalHost))
    ? window.API_BASE.replace(/\/+$/, '')
    : (isLocalHost ? 'http://localhost:3000' : 'https://wgs-payment.vercel.app');

const AUTH_TOKEN_KEY = 'wgs_auth_token';

function getStoredAuthToken() {
    try {
        return localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch (e) {
        return '';
    }
}

function setStoredAuthToken(token) {
    try {
        if (token && localStorage.getItem(AUTH_TOKEN_KEY) !== token) {
            localStorage.setItem(AUTH_TOKEN_KEY, token);
        }
    } catch (e) {}
}

function clearStoredAuthToken() {
    try {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem('token');
    } catch (e) {}
}

async function performFastLogout(redirectUrl = 'login.html') {
    clearStoredAuthToken();
    try { sessionStorage.clear(); } catch (e) {}
    try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 350) : null;
        await fetch(API_BASE + '/api/logout', {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            signal: controller ? controller.signal : undefined
        }).catch(() => {});
        if (timer) clearTimeout(timer);
    } catch (e) {}
    window.location.replace(redirectUrl);
}

window.getStoredAuthToken = getStoredAuthToken;
window.setStoredAuthToken = setStoredAuthToken;
window.clearStoredAuthToken = clearStoredAuthToken;
window.performFastLogout = performFastLogout;

// Ensure any outdated service worker caches do not serve stale JS/HTML
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const reg of registrations) {
            reg.update().catch(() => {});
        }
    }).catch(() => {});
}

async function apiFetch(path, options = {}) {
    const url = API_BASE + path;
    const isLogout = (path === '/logout' || path === '/api/logout');
    const storedToken = isLogout ? '' : getStoredAuthToken();
    const defaults = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    if (storedToken) {
        defaults.headers['Authorization'] = 'Bearer ' + storedToken;
        defaults.headers['X-Auth-Token'] = storedToken;
    }
    const merged = { ...defaults, ...options };
    if (options.headers) merged.headers = { ...defaults.headers, ...options.headers };
    if (options.body instanceof FormData) delete merged.headers['Content-Type'];

    if (isLogout) {
        clearStoredAuthToken();
        merged.keepalive = true;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 400) : null;
        if (controller && !merged.signal) merged.signal = controller.signal;
        try {
            const res = await fetch(url, merged);
            if (timer) clearTimeout(timer);
            return res;
        } catch (e) {
            if (timer) clearTimeout(timer);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
    }

    const response = await fetch(url, merged);

    const refreshedToken = response.headers.get('X-Auth-Token');
    if (refreshedToken) {
        setStoredAuthToken(refreshedToken);
    }
    if (response.headers.get('X-Clear-Auth-Token') === '1') {
        clearStoredAuthToken();
    }

    if (response.status === 401) {
        clearStoredAuthToken();
        let errMsg = 'Session expired. Please log in again.';
        try {
            const errData = await response.clone().json();
            if (errData && (errData.message || errData.error)) errMsg = errData.message || errData.error;
        } catch (e) {}
        if (!window.location.pathname.endsWith('login.html') && path !== '/api/login') {
            window.location.href = '/login.html?error=' + encodeURIComponent(errMsg);
        }
        throw new Error(errMsg);
    }
    return response;
}

async function apiJson(path, options = {}) {
    const response = await apiFetch(path, options);
    const data = await response.json();
    if (data && data.token) {
        setStoredAuthToken(data.token);
    }
    if (response.status === 403 && data) {
        if (data.code === 'PLAN_EXPIRED' && typeof window.openRenewalModal === 'function') {
            setTimeout(() => window.openRenewalModal(), 100);
        } else if (data.code === 'STAFF_SELECTION_REQUIRED' && typeof window.openStaffQuotaSelectModal === 'function') {
            setTimeout(() => window.openStaffQuotaSelectModal(), 100);
        }
    }
    return data;
}

