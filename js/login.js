(() => {
  'use strict';
  const { $, api, requireShape, saveSession, getSession, setBusy } = App;

  // Already logged in? Go straight to the right dashboard.
  const existing = getSession();
  if (existing && existing.token) {
    location.replace(existing.role === 'admin' ? 'admin.html' : 'intern.html');
    return;
  }

  const msg = new URLSearchParams(location.search).get('msg');
  if (msg) $('#login-error').textContent = msg;
  $('#login-username').focus();

  // Connection check: tells you right away if the API is unreachable.
  (async () => {
    const box = $('#conn'), text = $('#conn-text');
    try {
      const r = await api('ping');
      if (!r || !r.pong) throw new Error('The API is running an old Code.gs. Paste the latest one and deploy a new version.');
      if (!r.sheetsOk) {
        box.className = 'conn warn';
        text.textContent = 'Connected, but the sheets are not set up. Run Intern System > 1. Set up sheets in the spreadsheet.';
      } else {
        box.className = 'conn ok';
        text.textContent = 'Connected';
      }
    } catch (e) {
      box.className = 'conn bad';
      text.textContent = e.message;
    }
  })();

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    const err = $('#login-error');
    err.textContent = '';
    if (!username || !password) { err.textContent = 'Enter your username and password.'; return; }
    const btn = $('#login-btn');
    setBusy(btn, true, 'Logging in…');
    try {
      const r = requireShape(await api('login', { username, password }), ['token', 'role'], 'login');
      saveSession(r);
      location.replace(r.role === 'admin' ? 'admin.html' : 'intern.html');
    } catch (ex) {
      err.textContent = ex.message;
      $('#login-password').value = '';
      setBusy(btn, false);
    }
  });
})();
