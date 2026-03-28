// ============================================================
// App — auth, routing, PWA setup
// ============================================================

let currentUser  = null;
let userModules  = [];
let currentModule = null;

window.app = {
  showLogin,
  setUser(user, modules) { currentUser = user; userModules = modules; }
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Service Worker kayıt
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // iOS Home Screen banner kontrolü
  maybeShowIOSBanner();

  // Auth durumu kontrol
  try {
    const res = await API.me();
    if (res.ok) {
      currentUser  = res.data.user;
      userModules  = res.data.modules;
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// ── Login ──
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
}

async function doLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Giriş yapılıyor…';

  try {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const res = await API.login(u, p);
    if (res.ok) {
      currentUser = res.data.user;
      userModules = res.data.modules;
      showApp();
    } else {
      showToast(res.error ?? 'Giriş başarısız', 'danger');
    }
  } catch {
    showToast('Sunucuya bağlanılamadı', 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Giriş Yap';
  }
}

// ── App ──
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  buildNav();
  // İlk modülü yükle
  if (userModules.length > 0) {
    loadModule(userModules[0]);
  }
  // Push izni iste
  requestPushPermission();
}

function buildNav() {
  const nav = document.getElementById('bottom-nav');
  const icons = {
    ef_stok:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>`,
    ef_yem:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 8v8M8 12h8"/></svg>`,
    ef_gubre: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>`,
  };
  const labels = { ef_stok: 'Stok', ef_yem: 'Yem', ef_gubre: 'Gübre' };

  let html = '';
  userModules.forEach(mod => {
    html += `<a href="#" data-module="${mod}" onclick="loadModule('${mod}');return false">
      ${icons[mod] ?? ''}<span>${labels[mod] ?? mod}</span>
    </a>`;
  });
  // Bildirimler
  html += `<a href="#" onclick="loadNotifications();return false">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
    <span>Bildirim</span>
  </a>`;

  nav.innerHTML = html;
}

function loadModule(mod) {
  currentModule = mod;
  // Nav active
  document.querySelectorAll('#bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.module === mod);
  });

  const content = document.getElementById('module-content');
  content.innerHTML = '<div class="loading">Yükleniyor…</div>';

  if (mod === 'ef_stok') {
    const isEmployee = currentUser.role === 'employee';
    if (isEmployee) {
      StokEmployee.render(content);
    } else {
      StokManager.render(content);
    }
  } else if (mod === 'ef_yem') {
    const isEmployee = currentUser.role === 'employee';
    if (isEmployee) {
      YemEmployee.render(content);
    } else {
      YemManager.render(content);
    }
  } else if (mod === 'ef_gubre') {
    const isEmployee = currentUser.role === 'employee';
    if (isEmployee) {
      GubreEmployee.render(content);
    } else {
      GubreManager.render(content);
    }
  }
}

function loadNotifications() {
  document.querySelectorAll('#bottom-nav a').forEach(a => a.classList.remove('active'));
  const content = document.getElementById('module-content');
  content.innerHTML = '<div class="loading">Yükleniyor…</div>';
  NotifPage.render(content, currentUser);
}

// ── Push Permission ──
async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'granted') {
    await subscribePush();
  } else if (Notification.permission !== 'denied') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') await subscribePush();
  }
}

async function subscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    await API.push.subscribe({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    });
  } catch {
    // Push desteklenmiyorsa in-app fallback devreye girer
  }
}

// VAPID public key — wrangler.toml'dan inject edilecek
const VAPID_PUBLIC_KEY = document.querySelector('meta[name=vapid-key]')?.content ?? '';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// ── iOS Home Screen banner ──
function maybeShowIOSBanner() {
  const isIOS       = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  if (!isIOS || isStandalone) return;
  if (sessionStorage.getItem('ios-banner-closed')) return;

  const banner = document.getElementById('ios-banner');
  if (banner) banner.style.display = 'flex';
}

function closeIOSBanner() {
  sessionStorage.setItem('ios-banner-closed', '1');
  const banner = document.getElementById('ios-banner');
  if (banner) banner.style.display = 'none';
}

// ── Logout ──
async function doLogout() {
  await API.logout();
  currentUser = null;
  userModules = [];
  showLogin();
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
