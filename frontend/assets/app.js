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

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function showAlert(elId, message, type = 'success') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className   = `alert alert-${type} show`;
  setTimeout(() => el.classList.remove('show'), 5000);
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
  const full  = Math.round(rating);
  const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
  return `<span class="stars">${stars}</span> <span style="font-size:0.8rem;color:#718096">(${count})</span>`;
}

function formatRank(rank) {
  return `<span class="rank-badge rank-${rank}">${rank}</span>`;
}

function statusBadge(status) {
  const labels = { open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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

function showModal(id) { document.getElementById(id)?.classList.add('show'); }
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

async function loadCategories(selectEl) {
  try {
    const data = await apiCall('GET', '/categories', null, false);
    if (selectEl) {
      selectEl.innerHTML = '<option value="">-- Select Category --</option>';
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
  const dist    = w.distance_km !== undefined ? `📍 ${w.distance_km} km away` : '';
  return `
    <div class="worker-card">
      <div class="worker-header">
        <div class="worker-avatar">${initial}</div>
        <div>
          <div class="worker-name">${escHtml(w.name)} ${w.aadhaar_verified ? '✅' : ''}</div>
          <div class="worker-category">${escHtml(w.category)}</div>
          ${formatRank(w.rank_level)}
        </div>
      </div>
      <div>${renderStars(w.avg_rating || 0, w.rating_count || 0)}</div>
      <div class="worker-rate">₹${w.daily_rate}/day</div>
      <div class="worker-distance">
        <span class="availability-dot online"></span>Online
        ${dist ? '&nbsp;·&nbsp;' + dist : ''}
        ${w.total_jobs ? `&nbsp;·&nbsp;${w.total_jobs} jobs done` : ''}
      </div>
      ${w.bio ? `<div style="font-size:0.85rem;color:#718096;margin-top:4px">"${escHtml(w.bio)}"</div>` : ''}
    </div>`;
}

// ─── Job Card Renderer ────────────────────────────────────────────────────────

function renderJobCard(j, role) {
  const urgentTag = j.is_urgent ? '<span class="urgent-tag">🔴 URGENT</span> ' : '';
  return `
    <div class="job-card${j.is_urgent ? ' urgent' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:6px">
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
        <span class="job-badge">📅 ${formatDate(j.created_at)}</span>
      </div>
      ${j.description ? `<div style="font-size:0.85rem;color:#718096;margin-top:8px">${escHtml(j.description)}</div>` : ''}
      ${role === 'worker' && j.status === 'open' ? `
        <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="acceptJobFromCard('${j.id}', this)">
          ✅ Accept Job
        </button>` : ''}
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
    if (userInfo)  userInfo.textContent    = `Hi, ${currentUser.name.split(' ')[0]}`;
  } else {
    if (loginBtn)  loginBtn.style.display  = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userInfo)  userInfo.textContent    = '';
  }
}

// ─── Export to window ─────────────────────────────────────────────────────────

window.KM = {
  API, apiCall, sendOTP, verifyOTP, clearAuth, isLoggedIn,
  currentUser: () => currentUser, currentToken: () => currentToken,
  showAlert, setLoading, renderStars, formatRank, statusBadge, formatDate,
  renderWorkerCard, renderJobCard, escHtml,
  showModal, hideModal, initTabs, loadCategories, getUserLocation, updateNavbar,
  pendingAuth: () => pendingAuth,
};

document.addEventListener('DOMContentLoaded', () => {
  updateNavbar();

  // Logout handler
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    clearAuth();
    window.location.href = '/';
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });
});
