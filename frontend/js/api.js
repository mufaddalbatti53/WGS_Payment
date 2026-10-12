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
        if (token) {
            localStorage.setItem(AUTH_TOKEN_KEY, token);
        }
    } catch (e) {}
}

function clearStoredAuthToken() {
    try {
        localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch (e) {}
}

window.getStoredAuthToken = getStoredAuthToken;
window.setStoredAuthToken = setStoredAuthToken;
window.clearStoredAuthToken = clearStoredAuthToken;

async function apiFetch(path, options = {}) {
    const url = API_BASE + path;
    const storedToken = getStoredAuthToken();
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

    if (path === '/logout' || path === '/api/logout') {
        clearStoredAuthToken();
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
            if (errData && errData.message) errMsg = errData.message;
        } catch (e) {}
        window.location.href = '/login.html?error=' + encodeURIComponent(errMsg);
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

