(() => {
  'use strict';
  const A = App;
  const { $, $$, esc, hrs, pad, statusWord } = A;
  if (!A.guard('admin')) return;

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const REQUIRED = ['serverNow', 'schedules', 'interns', 'duty', 'pendingAbsent', 'pendingSchedule', 'reviewed'];
  let data = null;
  let current = 'monitoring';
  let logFilter = '';
  let lastAdded = null; // { name, internId } shown after adding an intern

  async function load(fresh, only) {
    data = A.requireShape(fresh || await A.api('adminDashboard'), REQUIRED, 'adminDashboard');
    render(only);
  }

  /* ---------------- Rendering ---------------- */
  function render(only) {
    const pending = data.pendingAbsent.length + data.pendingSchedule.length;
    const rc = $('#req-count'); rc.hidden = !pending; rc.textContent = pending;
    $('#admin-meta').textContent = `${data.interns.filter(i => i.active).length} active interns, ${data.schedules.length} schedule types, ${pending} pending requests`;

    const sections = { monitoring: monitoringHTML, add: addHTML, schedules: schedulesHTML, requests: requestsHTML, log: logShellHTML };
    Object.keys(sections).forEach(k => {
      if (only && !only.includes(k)) return;
      $('#sec-' + k).innerHTML = sections[k]();
    });
    bind();
    if (!only && week.plan && !week.edits.size && current !== 'weekly') week.plan = null; // reload next time it opens
    if (current === 'log' && (!only || only.includes('log'))) loadLog();
  }

  const scheduleOptions = (selected) => data.schedules.map(s =>
    `<option value="${esc(s.scheduleId)}" ${s.scheduleId === selected ? 'selected' : ''}>${esc(s.name)} (${esc(s.startText)} to ${esc(s.endText)})</option>`).join('');

  const dayChips = (name, selected = []) => `<div class="chips">${DAYS.map(d =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>`;

  function monitoringHTML() {
    const list = data.duty.list;
    const count = t => list.filter(p => p.tone === t).length;

    const duty = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Intern</th><th>Schedule</th><th>Status</th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.scheduleName)}<span class="sub">${esc(p.timeText)}</span></td>
        <td><span class="pill ${esc(p.tone)}">${esc(p.status)}</span> ${p.late && p.tone === 'present' ? '<span class="pill late">Late</span>' : ''}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">Nobody is scheduled today.</p>';

    const rows = data.interns.map(i => {
      const pct = i.hoursRequired ? Math.min(100, i.renderedHours / i.hoursRequired * 100) : 0;
      const login = i.hasLogin ? '@' + esc(i.username) + (i.loginActive ? '' : ' (login disabled)')
        : '<span class="pill late">No login yet</span>';
      return `<tr class="${i.active ? '' : 'inactive'}">
        <td><strong>${esc(i.name)}</strong><span class="sub">${esc(i.school)}</span><span class="sub">${login}</span>
          <span class="sub">ID: <button class="btn-link id-link" data-copy="${esc(i.internId)}" title="Copy intern ID">${esc(i.internId)}</button></span></td>
        <td><select class="assign" data-assign="${esc(i.internId)}" aria-label="Schedule for ${esc(i.name)}" ${i.active ? '' : 'disabled'}>${scheduleOptions(i.scheduleId)}</select>
          <span class="sub">Day off: ${esc(i.dayOffs.join(', ') || 'none')}</span></td>
        <td>${hrs(i.renderedHours)} / ${hrs(i.hoursRequired)}<div class="progress"><div style="width:${pct}%"></div></div>
          <span class="sub">${hrs(i.remainingHours)} left</span></td>
        <td class="num">${i.lateCount}</td>
        <td class="num">${i.absentCount}</td>
        <td>${i.active ? `<span class="pill ${esc(i.todayTone)}">${esc(i.today)}</span>` : '<span class="pill off">Inactive</span>'}</td>
        <td class="actions">
          <button class="btn-link" data-edit="${esc(i.internId)}">Edit</button>
          <button class="btn-link" data-log="${esc(i.internId)}">Log</button>
          <button class="btn-link ${i.active ? 'danger' : ''}" data-active="${esc(i.internId)}" data-to="${i.active ? '1' : '0'}">${i.active ? 'Deactivate' : 'Activate'}</button>
        </td></tr>`;
    }).join('');

    return `
      <div class="stats">
        <div class="stat"><div class="stat-value">${list.length}</div><div class="stat-label">Scheduled today</div></div>
        <div class="stat"><div class="stat-value">${count('present')}</div><div class="stat-label">Present</div></div>
        <div class="stat ${count('late') ? 'warn' : ''}"><div class="stat-value">${count('late')}</div><div class="stat-label">Not in yet</div></div>
        <div class="stat ${count('absent') ? 'bad' : ''}"><div class="stat-value">${count('absent')}</div><div class="stat-label">Absent</div></div>
        <div class="stat"><div class="stat-value">${count('leave')}</div><div class="stat-label">On leave</div></div>
      </div>
      <section class="panel">
        <h2>On duty today, ${esc(data.duty.dateText)}</h2>
        <p class="lead">Sorted by schedule start time.</p>${duty}
      </section>
      <section class="panel">
        <h2>All interns</h2>
        <p class="lead">Change the schedule dropdown to assign a new schedule. Late and absence counts come from attendance and can't be edited.</p>
        ${data.interns.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Intern</th><th>Schedule</th><th>Hours rendered</th><th>Late</th><th>Absences</th><th>Today</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
          : '<p class="empty">No interns yet. <button class="btn-link" data-goto="add">Add your first intern</button></p>'}
      </section>`;
  }

  function addHTML() {
    const noSched = !data.schedules.length;
    const done = lastAdded ? `
      <div class="success-box">
        <strong>${esc(lastAdded.name)} was added.</strong>
        <p>To give them a login, add a row in the <b>Users</b> sheet: username, password, role <b>intern</b>, and this intern ID:</p>
        <div class="id-box"><code>${esc(lastAdded.internId)}</code><button class="btn btn-ghost btn-sm" data-copy="${esc(lastAdded.internId)}">Copy ID</button></div>
      </div>` : '';
    return `
      <section class="panel narrow">
        <h2>Add a new intern</h2>
        <p class="lead">Logins are managed in the Users sheet. You'll get the intern ID to use there.</p>
        ${done}
        ${noSched ? `<div class="notice">You need at least one schedule type before adding interns.
          <button class="btn-link" data-goto="schedules">Create a schedule type</button></div>` : ''}
        <form id="add-intern" novalidate>
          <fieldset ${noSched ? 'disabled' : ''}>
            <label class="field"><span>Full name</span><input name="name" maxlength="80" required></label>
            <label class="field"><span>School</span><input name="school" maxlength="120" required></label>
            <div class="row">
              <label class="field"><span>Hours required to render</span><input name="hoursRequired" type="number" min="1" max="5000" step="0.5" required></label>
              <label class="field"><span>Hours already rendered</span><input name="initialRenderedHours" type="number" min="0" step="0.5" value="0">
                <span class="hint">Leave 0 for a new intern.</span></label>
            </div>
            <label class="field"><span>Schedule</span><select name="scheduleId" required>
              <option value="">Choose a schedule</option>${scheduleOptions()}</select></label>
            <div class="field"><span>Day off (choose one or more)</span>${dayChips('dayOffs')}</div>
            <p class="form-error" id="add-error"></p>
            <button class="btn btn-primary" type="submit">Add intern</button>
          </fieldset>
        </form>
      </section>`;
  }

  function time12(name, hhmm) {
    const [H, M] = hhmm.split(':').map(Number);
    const ap = H >= 12 ? 'PM' : 'AM', h = H % 12 || 12;
    return `<div class="time12">
      <select name="${name}_h" aria-label="Hour">${Array.from({ length: 12 }, (_, i) => i + 1).map(x => `<option ${x === h ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <select name="${name}_m" aria-label="Minute">${Array.from({ length: 12 }, (_, i) => i * 5).map(x => `<option value="${x}" ${x === M ? 'selected' : ''}>${pad(x)}</option>`).join('')}</select>
      <select name="${name}_ap" aria-label="AM or PM"><option ${ap === 'AM' ? 'selected' : ''}>AM</option><option ${ap === 'PM' ? 'selected' : ''}>PM</option></select>
    </div>`;
  }
  const read12 = (fd, n) => pad((Number(fd.get(n + '_h')) % 12) + (fd.get(n + '_ap') === 'PM' ? 12 : 0)) + ':' + pad(Number(fd.get(n + '_m')));

  function schedulesHTML() {
    return `
      <div class="two-col">
        <section class="panel">
          <h2>Create a schedule type</h2>
          <p class="lead">A schedule that ends before it starts runs overnight.</p>
          <form id="add-schedule" novalidate>
            <label class="field"><span>Schedule name</span><input name="name" maxlength="40" required placeholder="e.g. Shift D"></label>
            <div class="field"><span>Time in</span>${time12('start', '09:00')}</div>
            <div class="field"><span>Time out</span>${time12('end', '17:00')}</div>
            <label class="field"><span>Break (hours deducted)</span><input name="breakHours" type="number" min="0" max="4" step="0.5" value="1"></label>
            <p class="form-error" id="sched-error"></p>
            <button class="btn btn-primary btn-block" type="submit">Create schedule type</button>
          </form>
        </section>
        <section class="panel">
          <h2>Schedule types</h2>
          <p class="lead">A schedule type in use can't be deleted.</p>
          ${data.schedules.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Time in to time out</th><th>Paid hours</th><th>Interns</th><th></th></tr></thead>
            <tbody>${data.schedules.map(s => `<tr><td><strong>${esc(s.name)}</strong></td>
              <td>${esc(s.startText)} to ${esc(s.endText)}<span class="sub">${hrs(s.breakHours)} hr break</span></td>
              <td class="num">${hrs(s.paidHours)}</td><td class="num">${s.internCount}</td>
              <td><button class="btn-link danger" data-del-sched="${esc(s.scheduleId)}" data-name="${esc(s.name)}">Delete</button></td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="empty">No schedule types yet.</p>'}
        </section>
      </div>`;
  }

  function reqCard(r, kind) {
    return `<div class="req">
      <div class="req-top"><span class="req-date">${esc(r.internName)}</span><span class="pill PENDING">Pending</span></div>
      <div class="small muted">For ${esc(r.dateText)}${kind === 'schedule' ? '. Current schedule: ' + esc(r.currentSchedule) : ''}</div>
      <p class="req-reason">${esc(r.reason)}</p>
      <div class="small muted" style="margin-top:6px">Filed ${esc(r.createdText)}</div>
      <div class="req-actions">
        <button class="btn btn-success btn-sm" data-approve="${esc(r.requestId)}" data-kind="${kind}">Accept</button>
        <button class="btn btn-ghost btn-sm" data-decline="${esc(r.requestId)}" data-kind="${kind}">Decline</button>
      </div></div>`;
  }

  function requestsHTML() {
    return `
      <div class="two-col even">
        <section class="panel"><h2>Absence requests</h2><p class="lead">${data.pendingAbsent.length} pending</p>
          <div class="req-list">${data.pendingAbsent.map(r => reqCard(r, 'absent')).join('') || '<p class="empty">No pending absence requests.</p>'}</div></section>
        <section class="panel"><h2>Schedule change requests</h2><p class="lead">${data.pendingSchedule.length} pending</p>
          <div class="req-list">${data.pendingSchedule.map(r => reqCard(r, 'schedule')).join('') || '<p class="empty">No pending schedule change requests.</p>'}</div></section>
      </div>
      <section class="panel"><h2>Recently reviewed</h2><p class="lead">Your last 30 decisions.</p>
        ${data.reviewed.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Intern</th><th>Request</th><th>For date</th><th>Decision</th><th>Note</th></tr></thead>
          <tbody>${data.reviewed.map(r => `<tr><td>${esc(r.internName)}</td><td>${esc(r.kind)}</td><td>${esc(r.dateText)}</td>
            <td><span class="pill ${esc(r.status)}">${esc(r.status === 'APPROVED' ? 'Accepted' : statusWord[r.status] || r.status)}</span></td>
            <td>${r.newSchedule ? 'New schedule: ' + esc(r.newSchedule) + (r.adminRemark ? '. ' : '') : ''}${esc(r.adminRemark)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">Nothing reviewed yet.</p>'}
      </section>`;
  }

  function logShellHTML() {
    return `<section class="panel">
      <div class="panel-head">
        <div><h2>Attendance log</h2><p class="lead" style="margin:0">Latest 200 records.</p></div>
        <label class="field" style="margin:0;min-width:220px"><span>Intern</span>
          <select id="log-filter"><option value="">All interns</option>
            ${data.interns.map(i => `<option value="${esc(i.internId)}" ${logFilter === i.internId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}
          </select></label>
      </div>
      <div id="log-body"><p class="empty">Loading…</p></div>
    </section>`;
  }

  async function loadLog() {
    const body = $('#log-body'); if (!body) return;
    try {
      const rows = await A.api('attendanceLog', { internId: logFilter });
      const tone = c => ({ COMPLETED: 'present', ONGOING: 'present', ABSENT_FILED: 'leave', LATE_ACK: 'late' }[c] || 'absent');
      body.innerHTML = rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Intern</th><th>Date</th><th>Time in</th><th>Counted from</th><th>Time out</th><th>Hours</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.internName)}</td><td>${esc(r.dateText)}<span class="sub">${esc(r.scheduleName)}</span></td>
          <td>${esc(r.timeInText || '–')}${r.late ? `<span class="sub">Late ${r.lateMinutes} min</span>` : ''}</td>
          <td>${esc(r.countStartText || '–')}</td><td>${esc(r.timeOutText || '–')}</td><td class="num">${hrs(r.hours)}</td>
          <td><span class="pill ${tone(r.statusCode)}">${esc(r.status)}</span>${r.remarks ? `<span class="sub">${esc(r.remarks)}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No attendance records yet.</p>';
    } catch (e) { body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }

  /* ---------------- Events ---------------- */
  const checked = (root, name) => $$(`input[name="${name}"]:checked`, root).map(x => x.value);
  const find = (id) => data.interns.find(x => x.internId === id);
  const go = (page) => { history.replaceState(null, '', '#' + page); showPage(page); };

  function confirmAction({ title, body, label, kind = 'btn-primary', action, payload, ok }) {
    A.modal({
      title, body,
      actions: [{ label: 'Cancel' }, {
        label, kind, onClick: async (b) => {
          const fresh = await A.run(b, () => A.api(action, typeof payload === 'function' ? payload() : payload), 'Saving…', true);
          A.closeModal(); await load(fresh); if (ok) A.toast(ok, 'success');
        }
      }]
    });
  }

  function bind() {
    $$('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
    $$('[data-copy]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); A.toast('Intern ID copied. Paste it in the Users sheet.'); }
      catch (e) { A.toast('Copy failed. Select the ID and copy it manually.', 'error'); }
    });

    // Assign schedule from the monitoring list
    $$('[data-assign]').forEach(sel => sel.onchange = () => {
      const i = find(sel.dataset.assign);
      const s = data.schedules.find(x => x.scheduleId === sel.value);
      A.modal({
        dismissible: false,
        title: 'Assign new schedule?',
        body: `<p>${esc(i.name)} will move to <strong>${esc(s.name)} (${esc(s.startText)} to ${esc(s.endText)})</strong> starting now.</p>`,
        actions: [{ label: 'Cancel', onClick: async () => { sel.value = i.scheduleId; A.closeModal(); } }, {
          label: 'Assign schedule', kind: 'btn-primary', onClick: async (b) => {
            const fresh = await A.run(b, () => A.api('updateIntern', { internId: i.internId, scheduleId: s.scheduleId }), 'Saving…', true);
            A.closeModal(); await load(fresh); A.toast('Schedule assigned.', 'success');
          }
        }]
      });
    });

    $$('[data-edit]').forEach(b => b.onclick = () => {
      const i = find(b.dataset.edit);
      const root = A.modal({
        title: 'Edit ' + i.name,
        body: `<form id="edit-form">
          <label class="field"><span>Full name</span><input name="name" value="${esc(i.name)}" maxlength="80"></label>
          <label class="field"><span>School</span><input name="school" value="${esc(i.school)}" maxlength="120"></label>
          <label class="field"><span>Hours required to render</span><input name="hoursRequired" type="number" min="1" step="0.5" value="${esc(i.hoursRequired)}"></label>
          <label class="field"><span>Schedule</span><select name="scheduleId">${scheduleOptions(i.scheduleId)}</select></label>
          <div class="field"><span>Day off</span>${dayChips('dayOffs', i.dayOffs)}</div>
          <p class="hint muted small">Schedule and day off changes apply from now on.</p>
        </form>`,
        actions: [{ label: 'Cancel' }, {
          label: 'Save changes', kind: 'btn-primary', onClick: async (btn) => {
            const f = $('#edit-form', root), fd = new FormData(f);
            const fresh = await A.run(btn, () => A.api('updateIntern', {
              internId: i.internId, name: fd.get('name'), school: fd.get('school'), hoursRequired: fd.get('hoursRequired'),
              scheduleId: fd.get('scheduleId'), dayOffs: checked(f, 'dayOffs')
            }), 'Saving…', true);
            A.closeModal(); await load(fresh); A.toast('Changes saved.', 'success');
          }
        }]
      });
    });

    $$('[data-active]').forEach(b => b.onclick = () => {
      const i = find(b.dataset.active), deactivate = b.dataset.to === '1';
      confirmAction({
        title: (deactivate ? 'Deactivate ' : 'Activate ') + i.name + '?',
        body: `<p>${deactivate ? "They won't be able to log in or appear on the duty list. Their records are kept." : 'They can log in and will be scheduled again.'}</p>`,
        label: deactivate ? 'Deactivate' : 'Activate', kind: deactivate ? 'btn-danger' : 'btn-primary',
        action: 'setInternActive', payload: { internId: i.internId, active: !deactivate }
      });
    });

    $$('[data-log]').forEach(b => b.onclick = () => { logFilter = b.dataset.log; go('log'); });
    const lf = $('#log-filter');
    if (lf) lf.onchange = () => { logFilter = lf.value; $('#log-body').innerHTML = '<p class="empty">Loading…</p>'; loadLog(); };

    const addForm = $('#add-intern');
    if (addForm) addForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(addForm), err = $('#add-error');
      err.textContent = '';
      const payload = {
        name: String(fd.get('name') || '').trim(), school: fd.get('school'),
        hoursRequired: fd.get('hoursRequired'), initialRenderedHours: fd.get('initialRenderedHours') || 0,
        scheduleId: fd.get('scheduleId'), dayOffs: checked(addForm, 'dayOffs')
      };
      if (!payload.scheduleId) { err.textContent = 'Choose a schedule.'; return; }
      if (!payload.dayOffs.length) { err.textContent = 'Choose at least one day off.'; return; }
      try {
        const before = new Set(data.interns.map(i => i.internId));
        const fresh = await A.run($('button[type=submit]', addForm), () => A.api('addIntern', payload), 'Adding…', true);
        const added = fresh.interns.find(i => !before.has(i.internId));
        lastAdded = added ? { name: added.name, internId: added.internId } : null;
        await load(fresh);
        A.toast(payload.name + ' added.', 'success');
      } catch (ex) { err.textContent = ex.message; }
    };

    const schedForm = $('#add-schedule');
    if (schedForm) schedForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(schedForm), err = $('#sched-error');
      err.textContent = '';
      const payload = { name: fd.get('name'), startTime: read12(fd, 'start'), endTime: read12(fd, 'end'), breakHours: fd.get('breakHours') };
      try {
        const fresh = await A.run($('button[type=submit]', schedForm), () => A.api('createSchedule', payload), 'Creating…', true);
        await load(fresh);
        A.toast(`Schedule type "${payload.name}" created.`, 'success');
      } catch (ex) { err.textContent = ex.message; }
    };

    $$('[data-del-sched]').forEach(b => b.onclick = () => confirmAction({
      title: `Delete ${b.dataset.name}?`, body: '<p>This schedule type will be removed.</p>',
      label: 'Delete', kind: 'btn-danger', action: 'deleteSchedule', payload: { scheduleId: b.dataset.delSched }, ok: 'Schedule type deleted.'
    }));

    $$('[data-approve]').forEach(b => b.onclick = () => {
      const kind = b.dataset.kind;
      const r = (kind === 'absent' ? data.pendingAbsent : data.pendingSchedule).find(x => x.requestId === b.dataset.approve);
      if (kind === 'absent') {
        const root = A.modal({
          title: 'Accept absence?',
          body: `<p>${esc(r.internName)} will be marked on approved leave for ${esc(r.dateText)}.</p>
                 <label class="field"><span>Note (optional)</span><input id="rv-note" maxlength="300"></label>`,
          actions: [{ label: 'Cancel' }, {
            label: 'Accept', kind: 'btn-success', onClick: async (btn) => {
              const fresh = await A.run(btn, () => A.api('reviewAbsent', { requestId: r.requestId, decision: 'APPROVE', remark: $('#rv-note', root).value }), 'Saving…', true);
              A.closeModal(); await load(fresh); A.toast('Absence accepted.', 'success');
            }
          }]
        });
      } else {
        const root = A.modal({
          title: 'Accept schedule change',
          body: `<p>${esc(r.internName)}, ${esc(r.dateText)}.<br><span class="muted small">Current: ${esc(r.currentSchedule)}</span></p>
                 <label class="field"><span>New schedule for this date</span>
                   <select id="rv-sched"><option value="">Choose a schedule</option>${scheduleOptions()}</select></label>
                 <label class="field"><span>Note (optional)</span><input id="rv-note" maxlength="300"></label>`,
          actions: [{ label: 'Cancel' }, {
            label: 'Accept and assign', kind: 'btn-success', onClick: async (btn) => {
              const sid = $('#rv-sched', root).value;
              if (!sid) throw new Error('Choose the new schedule.');
              const fresh = await A.run(btn, () => A.api('reviewScheduleChange', { requestId: r.requestId, decision: 'APPROVE', newScheduleId: sid, remark: $('#rv-note', root).value }), 'Saving…', true);
              A.closeModal(); await load(fresh); A.toast('Schedule change accepted.', 'success');
            }
          }]
        });
      }
    });

    $$('[data-decline]').forEach(b => b.onclick = () => {
      const kind = b.dataset.kind;
      const r = (kind === 'absent' ? data.pendingAbsent : data.pendingSchedule).find(x => x.requestId === b.dataset.decline);
      const root = A.modal({
        title: 'Decline request',
        body: `<p>${esc(r.internName)}, ${esc(r.dateText)}.</p>
               <label class="field"><span>Reason for declining</span><textarea id="rv-reason" maxlength="300" placeholder="The intern will see this"></textarea></label>`,
        actions: [{ label: 'Cancel' }, {
          label: 'Decline', kind: 'btn-danger', onClick: async (btn) => {
            const reason = $('#rv-reason', root).value.trim();
            if (reason.length < 3) throw new Error('Enter a reason so the intern knows why.');
            const fresh = await A.run(btn, () => A.api(kind === 'absent' ? 'reviewAbsent' : 'reviewScheduleChange',
              { requestId: r.requestId, decision: 'DECLINE', remark: reason }), 'Saving…', true);
            A.closeModal(); await load(fresh); A.toast('Request declined.');
          }
        }]
      });
    });
  }


  /* ---------------- Weekly schedule ---------------- */
  const week = { plan: null, edits: new Map(), loading: false };
  const cellKey = (internId, date) => internId + '|' + date;

  async function loadWeek(weekStart, fresh) {
    week.loading = true;
    try {
      week.plan = A.requireShape(fresh || await A.api('weekPlan', { weekStart: weekStart || '' }),
        ['weekStart', 'days', 'interns', 'schedules'], 'weekPlan');
      week.edits.clear();
      renderWeek();
    } finally { week.loading = false; }
  }

  const cellValue = (i, c) => week.edits.has(cellKey(i.internId, c.date)) ? week.edits.get(cellKey(i.internId, c.date)) : c.value;

  function valueText(v) {
    if (v === 'OFF') return 'Day off';
    const s = week.plan.schedules.find(x => x.scheduleId === v);
    return s ? `${s.name} (${s.startText} – ${s.endText})` : '';
  }

  // First option is the intern's default for that day (value ""), the rest are alternatives.
  function cellOptions(c, current) {
    const defName = c.defaultValue === 'OFF' ? 'Day off' : c.defaultLabel.split(' (')[0];
    let html = `<option value="" ${current === '' ? 'selected' : ''}>${esc(defName)}</option>`;
    week.plan.schedules.forEach(s => {
      if (s.scheduleId === c.defaultValue) return;
      html += `<option value="${esc(s.scheduleId)}" ${current === s.scheduleId ? 'selected' : ''}>${esc(s.name)}</option>`;
    });
    if (c.defaultValue !== 'OFF') html += `<option value="OFF" ${current === 'OFF' ? 'selected' : ''}>Day off</option>`;
    return html;
  }

  // Line under each dropdown: the shift time, and whether it's the default.
  function cellTime(c, current) {
    const v = current || c.defaultValue;
    const s = week.plan.schedules.find(x => x.scheduleId === v);
    const time = v === 'OFF' ? 'No shift' : s ? `${s.startText} – ${s.endText}` : '';
    return current ? time : time + ' (default)';
  }

  function renderWeek() {
    const el = $('#sec-weekly');
    const p = week.plan;
    if (!p) { el.innerHTML = '<div class="panel"><p class="empty">Loading…</p></div>'; return; }
    const dirty = week.edits.size;
    const isThisWeek = p.days.some(d => d.isToday);

    const head = p.days.map(d => `<th class="${d.isToday ? 'today' : ''}">${esc(d.day)}<span class="sub">${esc(d.dateText)}${d.isToday ? ', today' : ''}</span></th>`).join('');
    const fillOpts = `<option value="">Fill week with…</option><option value="__default">Default schedule</option>` +
      p.schedules.map(s => `<option value="${esc(s.scheduleId)}">${esc(s.name)}</option>`).join('') + `<option value="OFF">Day off</option>`;

    const rows = p.interns.map(i => `<tr>
      <th class="who"><strong>${esc(i.name)}</strong><span class="sub">Default: ${esc(i.defaultText)}</span>
        <select class="fill" data-fill="${esc(i.internId)}" aria-label="Fill ${esc(i.name)}'s week">${fillOpts}</select></th>
      ${i.cells.map(c => {
        const v = cellValue(i, c);
        const isDirty = week.edits.has(cellKey(i.internId, c.date));
        if (c.locked) {
          const t = (c.effectiveLabel.match(/\((.*)\)/) || [])[1] || '';
          return `<td class="locked ${c.value ? 'ov' : ''}"><span class="cell-text">${esc(c.effectiveLabel.split(' (')[0])}</span>${t ? `<span class="sub">${esc(t)}</span>` : ''}<span class="sub lock-tag">${esc(c.locked)}</span></td>`;
        }
        return `<td class="${v ? 'ov' : ''} ${isDirty ? 'dirty' : ''}">
          <select class="cell" data-intern="${esc(i.internId)}" data-date="${esc(c.date)}" aria-label="${esc(i.name)}, ${esc(c.date)}">${cellOptions(c, v)}</select>
          <span class="sub">${esc(cellTime(c, v))}</span>
          ${c.fromRequest && !isDirty ? '<span class="sub">From approved request</span>' : ''}</td>`;
      }).join('')}
    </tr>`).join('');

    el.innerHTML = `
      <section class="panel">
        <div class="week-bar">
          <div class="week-nav">
            <button class="btn btn-ghost btn-sm" data-week="-7" aria-label="Previous week">◀ Prev</button>
            <button class="btn btn-ghost btn-sm" data-week="0" ${isThisWeek ? 'disabled' : ''}>This week</button>
            <button class="btn btn-ghost btn-sm" data-week="7" aria-label="Next week">Next ▶</button>
            <h2 class="week-title">${esc(p.weekText)}</h2>
          </div>
          <div class="week-actions">
            <button class="btn btn-ghost btn-sm" id="week-copy">Copy previous week</button>
            <button class="btn btn-ghost btn-sm" id="week-reset">Reset week to default</button>
            ${dirty ? '<button class="btn btn-ghost btn-sm" id="week-discard">Discard</button>' : ''}
            <button class="btn btn-primary btn-sm" id="week-save" ${dirty ? '' : 'disabled'}>Save changes${dirty ? ' (' + dirty + ')' : ''}</button>
          </div>
        </div>
        <p class="lead">Pick a schedule for each day. <span class="legend ov">Tinted</span> days differ from the intern's default schedule.
          Days with attendance, and past days, are locked.</p>
        ${p.interns.length ? `<div class="table-wrap week-wrap"><table class="week-grid">
          <thead><tr><th class="who">Intern</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
          : '<p class="empty">No active interns yet.</p>'}
      </section>`;
    bindWeek();
  }

  function setEdit(i, c, value) {
    if (c.locked) return;
    const k = cellKey(i.internId, c.date);
    if (value === c.value) week.edits.delete(k); else week.edits.set(k, value);
  }

  function guardUnsaved(next) {
    if (!week.edits.size) return next();
    A.modal({
      title: 'Discard unsaved changes?',
      body: `<p>You have ${week.edits.size} unsaved change${week.edits.size === 1 ? '' : 's'} this week.</p>`,
      actions: [{ label: 'Keep editing' }, { label: 'Discard', kind: 'btn-danger', onClick: async () => { A.closeModal(); week.edits.clear(); await next(); } }]
    });
  }

  function shiftWeek(days) {
    const d = new Date(week.plan.weekStart + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function bindWeek() {
    const p = week.plan;
    $$('[data-week]').forEach(b => b.onclick = () => guardUnsaved(async () => {
      const delta = Number(b.dataset.week);
      await A.run(b, () => loadWeek(delta === 0 ? '' : shiftWeek(delta)), '…').catch(() => {});
    }));

    $$('select.cell').forEach(sel => sel.onchange = () => {
      const i = p.interns.find(x => x.internId === sel.dataset.intern);
      setEdit(i, i.cells.find(c => c.date === sel.dataset.date), sel.value);
      renderWeek();
    });

    $$('select.fill').forEach(sel => sel.onchange = () => {
      const i = p.interns.find(x => x.internId === sel.dataset.fill);
      i.cells.forEach(c => setEdit(i, c, sel.value === '__default' ? '' : (sel.value === c.defaultValue ? '' : sel.value)));
      renderWeek();
    });

    const reset = $('#week-reset');
    if (reset) reset.onclick = () => {
      p.interns.forEach(i => i.cells.forEach(c => setEdit(i, c, '')));
      renderWeek();
      A.toast('All days set back to default. Save to apply.');
    };

    const copy = $('#week-copy');
    if (copy) copy.onclick = async () => {
      try {
        const prev = await A.run(copy, () => A.api('weekPlan', { weekStart: shiftWeek(-7) }), 'Copying…');
        let n = 0;
        p.interns.forEach(i => {
          const pi = prev.interns.find(x => x.internId === i.internId);
          if (!pi) return;
          i.cells.forEach((c, idx) => {
            if (c.locked) return;
            const pc = pi.cells[idx];
            const effective = pc.value || pc.defaultValue;
            const next = effective === c.defaultValue ? '' : effective;
            if (next !== cellValue(i, c)) { setEdit(i, c, next); n++; }
          });
        });
        renderWeek();
        A.toast(n ? `Copied last week's pattern (${n} day${n === 1 ? '' : 's'} changed). Save to apply.` : 'This week already matches last week.');
      } catch (e) { /* toast shown */ }
    };

    const discard = $('#week-discard');
    if (discard) discard.onclick = () => { week.edits.clear(); renderWeek(); };

    const save = $('#week-save');
    if (save) save.onclick = async () => {
      const changes = Array.from(week.edits.entries()).map(([k, value]) => {
        const [internId, date] = k.split('|');
        return { internId, date, value };
      });
      try {
        const fresh = await A.run(save, () => A.api('saveWeekPlan', { weekStart: p.weekStart, changes }), 'Saving…');
        await loadWeek(null, fresh);
        A.toast('Weekly schedule saved.', 'success');
        load(null, ['monitoring']).catch(() => {});
      } catch (e) { /* toast shown */ }
    };
  }

  window.addEventListener('beforeunload', (e) => { if (week.edits.size) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- Start ---------------- */
  const showPage = A.initTabs((name) => {
    current = name;
    if (name !== 'add') lastAdded = null;
    if (data && name === 'log') loadLog();
    if (name === 'weekly' && !week.plan && !week.loading) {
      renderWeek();
      loadWeek().catch(e => { $('#sec-weekly').innerHTML = `<div class="panel"><p class="form-error">${esc(e.message)}</p></div>`; });
    }
  });

  $('#refresh').addEventListener('click', (e) => A.run(e.currentTarget, () => load(), 'Refreshing…').catch(() => {}));

  load().catch(e => {
    $('#sec-monitoring').innerHTML = `<div class="panel"><h2>Couldn't load the dashboard</h2><p class="lead">${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
  });

  setInterval(async () => {
    if (document.hidden || A.state.busy || A.modalOpen() || !['monitoring', 'requests'].includes(current)) return;
    try { await load(null, ['monitoring', 'requests']); } catch (e) { /* ignore */ }
  }, 60000);
})();
