/**
 * KaamMitra – Frontend Application JavaScript
 * Handles API calls, UI state, authentication flow
 */

const API = '/api';

// ─── Auth State ──────────────────────────────────────────────────────────────

let currentUser  = JSON.parse(localStorage.getItem('km_user')  || 'null');
let currentToken = localStorage.getItem('km_token') || null;

function saveAuth(user, token) {
  currentUser  = user;
  currentToken = token;
  localStorage.setItem('km_user',  JSON.stringify(user));
  localStorage.setItem('km_token', token);
}

function clearAuth() {
  currentUser  = null;
  currentToken = null;
  localStorage.removeItem('km_user');
  localStorage.removeItem('km_token');
}

function isLoggedIn() { return !!currentToken; }

// ─── API Helper ──────────────────────────────────────────────────────────────

async function apiCall(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  try {
    const res  = await fetch(API + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    throw err;
  }
}

// ─── Toast Notifications ─────────────────────────────────────────────────────

function getToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = getToastContainer();
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span>${message}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('toast-hide'); setTimeout(() => toast.remove(), 300); }, duration);
  return toast;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function showAlert(elId, message, type = 'success') {
  const el = document.getElementById(elId);
  if (!el) { showToast(message, type); return; }
  el.innerHTML = `<span>${message}</span>`;
  el.className = `alert alert-${type} show`;
  setTimeout(() => { if (el) { el.classList.remove('show'); el.innerHTML = ''; } }, 6000);
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Please wait...';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.original || btn.innerHTML;
    btn.disabled  = false;
  }
}

function renderStars(rating, count = 0) {
  const val   = parseFloat(rating) || 0;
  const full  = Math.round(val);
  const stars = '★'.repeat(Math.max(0, full)) + '☆'.repeat(Math.max(0, 5 - full));
  const countStr = count > 0 ? `(${count})` : '';
  return `<span class="stars">${stars}</span> <span style="font-size:0.8rem;color:var(--text-light)">${val > 0 ? val.toFixed(1) : ''} ${countStr}</span>`;
}

function formatRank(rank) {
  return `<span class="rank-badge rank-${rank || 'Bronze'}">${rank || 'Bronze'}</span>`;
}

function statusBadge(status) {
  const labels = {
    open: '🟢 Open',
    assigned: '🟡 Assigned',
    in_progress: '🔵 In Progress',
    completed: '✅ Completed',
    cancelled: '🔴 Cancelled',
    pending: '🔔 Pending',
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return formatDate(ts);
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

function initTabs(container) {
  if (!container) return;
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = container.querySelector(`#${tab.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function showModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('show'); el.querySelector('input')?.focus(); }
}
function hideModal(id) { document.getElementById(id)?.classList.remove('show'); }

// ─── Geolocation ─────────────────────────────────────────────────────────────

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { timeout: 8000 }
    );
  });
}

// ─── Auth Flow ────────────────────────────────────────────────────────────────

let pendingAuth = {};

async function sendOTP(phone, name, role) {
  const data = await apiCall('POST', '/auth/send-otp', { phone, name, role }, false);
  pendingAuth = { phone, name, role, demo_otp: data.demo_otp };
  return data;
}

async function verifyOTP(phone, otp) {
  const data = await apiCall('POST', '/auth/verify-otp', { phone, otp }, false);
  saveAuth(data.user, data.token);
  return data;
}

// ─── Load Categories ──────────────────────────────────────────────────────────

async function loadCategories(selectEl, placeholder = '-- Select Category --') {
  try {
    const data = await apiCall('GET', '/categories', null, false);
    if (selectEl) {
      selectEl.innerHTML = `<option value="">${placeholder}</option>`;
      data.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        selectEl.appendChild(opt);
      });
    }
    return data.categories;
  } catch { return []; }
}

// ─── Worker Card Renderer ──────────────────────────────────────────────────

function renderWorkerCard(w) {
  const initial = (w.name || '?')[0].toUpperCase();
  const dist    = w.distance_km !== undefined ? `📍 ${w.distance_km} km` : '';
  const rating  = parseFloat(w.avg_rating) || 0;
  return `
    <div class="worker-card animate-fadeInUp">
      <div class="worker-header">
        <div class="worker-avatar">${initial}</div>
        <div>
          <div class="worker-name">${escHtml(w.name)} ${w.aadhaar_verified ? '<span title="Aadhaar Verified">✅</span>' : ''}</div>
          <div class="worker-category">🔧 ${escHtml(w.category)}</div>
          <div style="margin-top:4px">${formatRank(w.rank_level)}</div>
        </div>
      </div>
      <div>${renderStars(rating, w.rating_count || 0)}</div>
      <div class="worker-rate">₹${w.daily_rate}<span style="font-weight:400;font-size:0.82rem;color:var(--text-light)">/day</span></div>
      <div class="worker-distance">
        <span class="availability-dot online"></span>
        <span>Online</span>
        ${dist ? `· ${dist}` : ''}
        ${w.total_jobs ? `· ${w.total_jobs} jobs done` : ''}
      </div>
      ${w.bio ? `<div style="font-size:0.84rem;color:var(--text-light);font-style:italic;border-top:1px solid var(--border);padding-top:10px;margin-top:2px">"${escHtml(w.bio)}"</div>` : ''}
    </div>`;
}

// ─── Job Card Renderer ────────────────────────────────────────────────────────

function renderJobCard(j, role) {
  const urgentTag = j.is_urgent ? '<span class="urgent-tag">🔴 URGENT</span>' : '';
  return `
    <div class="job-card${j.is_urgent ? ' urgent' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div>
          ${urgentTag}
          <div class="job-title">${escHtml(j.title)}</div>
          <span class="job-category">${escHtml(j.category)}</span>
        </div>
        ${statusBadge(j.status)}
      </div>
      <div class="job-meta">
        ${j.job_type ? `<span class="job-badge">⏱ ${j.job_type.replace('_', ' ')}</span>` : ''}
        ${j.address  ? `<span class="job-badge">📍 ${escHtml(j.address)}</span>` : ''}
        ${j.budget_max ? `<span class="job-badge">💰 ₹${j.budget_min || 0}–${j.budget_max}</span>` : ''}
        ${j.distance_km !== undefined ? `<span class="job-badge">📍 ${j.distance_km} km</span>` : ''}
        <span class="job-badge">🕐 ${formatRelative(j.created_at)}</span>
      </div>
      ${j.description ? `<div style="font-size:0.85rem;color:var(--text-light);margin-top:10px;line-height:1.5">${escHtml(j.description)}</div>` : ''}
    </div>`;
}

// ─── Security helper ──────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function updateNavbar() {
  const loginBtn  = document.getElementById('nav-login');
  const logoutBtn = document.getElementById('nav-logout');
  const userInfo  = document.getElementById('nav-user');

  if (isLoggedIn() && currentUser) {
    if (loginBtn)  loginBtn.style.display  = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (userInfo)  userInfo.textContent    = `👋 ${currentUser.name.split(' ')[0]}`;
  } else {
    if (loginBtn)  loginBtn.style.display  = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userInfo)  userInfo.textContent    = '';
  }
}

// ─── Intersection Observer for Scroll Animations ─────────────────────────────

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.animate-on-scroll').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ─── Export to window ─────────────────────────────────────────────────────────

window.KM = {
  API, apiCall, sendOTP, verifyOTP, clearAuth, isLoggedIn,
  currentUser: () => currentUser, currentToken: () => currentToken,
  showAlert, showToast, setLoading,
  renderStars, formatRank, statusBadge, formatDate, formatRelative,
  renderWorkerCard, renderJobCard, escHtml,
  showModal, hideModal, initTabs, loadCategories, getUserLocation,
  updateNavbar, initScrollAnimations,
  pendingAuth: () => pendingAuth,
};

document.addEventListener('DOMContentLoaded', () => {
  updateNavbar();
  initScrollAnimations();

  // Logout handler
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    clearAuth();
    showToast('You have been logged out', 'info', 2500);
    setTimeout(() => { window.location.href = '/'; }, 800);
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });
});
