// Shared helpers for every page: API calls, session, clock, modal, toast.
window.App = (() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const TOKEN_KEY = 'ita_session';
  const st = { offset: 0, tz: 'Asia/Manila', busy: false, tickers: [] };

  /* ---------- Formatting ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowMs = () => Date.now() + st.offset;
  const fmt = (ms, opts) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: st.tz }, opts)).format(new Date(ms));
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: st.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs()));
  const hrs = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US');
  const pad = (n) => String(n).padStart(2, '0');
  const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60); };
  const statusWord = { PENDING: 'Pending', APPROVED: 'Approved', DECLINED: 'Declined', SUPERSEDED: 'Replaced' };

  /* ---------- Session ---------- */
  const getSession = () => { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; } };
  const saveSession = (s) => localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
  const clearSession = () => localStorage.removeItem(TOKEN_KEY);

  function goLogin(message) {
    clearSession();
    const q = message ? '?msg=' + encodeURIComponent(message) : '';
    location.replace('index.html' + q);
  }

  // Dashboard pages call this first; it sends people to the right page for their role.
  function guard(role) {
    const s = getSession();
    if (!s || !s.token) { goLogin(); return null; }
    if (s.role !== role) { location.replace(s.role === 'admin' ? 'admin.html' : 'intern.html'); return null; }
    return s;
  }

  /* ---------- API ---------- */
  function apiUrlProblem() {
    const u = String(CFG.API_URL || '');
    if (!u || u.includes('PASTE_')) return 'The API URL is not set. Paste your Web App URL into js/config.js.';
    if (u.includes('googleusercontent.com')) return 'js/config.js has a temporary googleusercontent.com link. Use the Web App URL that ends in /exec.';
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) return 'The API URL in js/config.js must look like https://script.google.com/macros/s/.../exec';
    return '';
  }

  function diagnose(status, text) {
    const t = (text || '').toLowerCase();
    if (t.includes('accounts.google.com') || t.includes('signin')) {
      return 'Google asked for a sign-in. The deployment must have "Who has access: Anyone".';
    }
    if (t.includes('authorization is required')) {
      return 'The script is not authorized yet. In Apps Script, run "setup" once and approve the permissions, then deploy a new version.';
    }
    if (t.includes('script function not found')) {
      return 'The deployed script has no doPost. Paste the full Code.gs, save, and deploy a new version.';
    }
    if (status === 404) {
      return 'Google refused the request (404). The Web App is not open to the public: set "Who has access" to "Anyone" using a personal Gmail account, or the URL is from a deleted deployment.';
    }
    return 'The API returned a web page instead of data (HTTP ' + status + ').';
  }

  async function api(action, payload = {}) {
    const bad = apiUrlProblem();
    if (bad) throw Object.assign(new Error(bad), { code: 'CONFIG' });
    const s = getSession();
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // plain text avoids a CORS preflight
        body: JSON.stringify(Object.assign({ action, token: s && s.token }, payload))
      });
    } catch (e) {
      throw Object.assign(new Error('Cannot reach the API. If this keeps happening, the Web App is not public (see setup step 9).'), { code: 'NETWORK' });
    }
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      console.error('Non-JSON response from API (HTTP ' + res.status + '):', text.slice(0, 1500));
      throw Object.assign(new Error(diagnose(res.status, text)), { code: 'HTTP' });
    }
    if (j.data && j.data.serverNow) { st.offset = j.data.serverNow - Date.now(); st.tz = j.data.timezone || st.tz; }
    if (!j.ok) {
      const err = Object.assign(new Error(j.error || 'Request failed.'), { code: j.code });
      if (j.code === 'AUTH' && action !== 'login') goLogin(j.error);
      throw err;
    }
    return j.data;
  }

  function requireShape(data, keys, action) {
    const missing = !data || typeof data !== 'object' ? keys : keys.filter(k => data[k] === undefined);
    if (!missing.length) return data;
    console.error('Unexpected ' + action + ' response:', data);
    throw Object.assign(new Error('The API is running an old Code.gs (missing ' + missing.join(', ') +
      '). Paste the latest Code.gs, save, then Deploy > Manage deployments > Edit > New version.'), { code: 'SHAPE' });
  }

  /* ---------- UI helpers ---------- */
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // Runs an API action with a busy button; errors are shown as a toast unless `quiet`.
  async function run(btn, fn, busyLabel, quiet) {
    if (st.busy) return;
    st.busy = true; setBusy(btn, true, busyLabel);
    try { return await fn(); }
    catch (e) { if (!quiet && e.code !== 'AUTH') toast(e.message, 'error'); throw e; }
    finally { st.busy = false; if (btn && btn.isConnected) setBusy(btn, false); }
  }

  function modal({ title, body, actions = [], dismissible = true, className = '' }) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title">${esc(title)}</h3>
          <div class="modal-body">${body}</div>
          <p class="form-error" id="modal-error" role="alert"></p>
          <div class="modal-actions"></div>
        </div>
      </div>`;
    const bar = $('.modal-actions', root);
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        if (!a.onClick) return closeModal();
        $('#modal-error').textContent = '';
        try { await a.onClick(b); } catch (e) { if (e.code !== 'AUTH') $('#modal-error').textContent = e.message; }
      });
      bar.appendChild(b);
    });
    const backdrop = $('.modal-backdrop', root);
    if (dismissible) {
      backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
      });
    }
    const first = $('input, select, textarea', root) || $('.modal-actions .btn:last-child', root);
    if (first) first.focus();
    return root;
  }
  const closeModal = () => { const r = $('#modal-root'); if (r) r.innerHTML = ''; };
  const modalOpen = () => !!($('#modal-root') && $('#modal-root').children.length);

  /* ---------- Clock ---------- */
  function onTick(fn) { st.tickers.push(fn); }
  function tick() {
    const n = nowMs();
    $$('[data-clock-time]').forEach(el => { el.textContent = fmt(n, { hour: 'numeric', minute: '2-digit', second: '2-digit' }); });
    $$('[data-clock-date]').forEach(el => { el.textContent = fmt(n, { month: 'long', day: 'numeric', year: 'numeric' }); });
    $$('[data-clock-weekday]').forEach(el => { el.textContent = fmt(n, { weekday: 'long' }); });
    st.tickers.forEach(f => { try { f(n); } catch (e) { console.error(e); } });
  }
  setInterval(tick, 1000);
  document.addEventListener('DOMContentLoaded', tick);

  /* ---------- Logout ---------- */
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    try { await api('logout'); } catch (err) { /* ignore */ }
    goLogin();
  });

  /* ---------- Page tabs (data-page buttons show matching data-section) ---------- */
  function initTabs(onChange) {
    const show = (name) => {
      $$('[data-page]').forEach(b => b.setAttribute('aria-current', b.dataset.page === name ? 'page' : 'false'));
      $$('[data-section]').forEach(s => { s.hidden = s.dataset.section !== name; });
      if (onChange) onChange(name);
    };
    $$('[data-page]').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#' + b.dataset.page); show(b.dataset.page); }));
    const first = (location.hash || '').slice(1);
    show($$('[data-page]').some(b => b.dataset.page === first) ? first : $('[data-page]').dataset.page);
    return show;
  }

  return {
    $, $$, esc, nowMs, fmt, todayISO, hrs, pad, hms, statusWord,
    getSession, saveSession, clearSession, goLogin, guard,
    api, requireShape, apiUrlProblem, toast, run, setBusy, modal, closeModal, modalOpen,
    onTick, tick, initTabs, state: st
  };
})();
