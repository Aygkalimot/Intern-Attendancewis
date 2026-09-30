(() => {
  'use strict';
  const A = App;
  const { $, $$, esc, fmt, hrs, hms, statusWord } = A;
  if (!A.guard('intern')) return;

  let data = null;
  let current = 'dashboard';
  let lateOpen = false;

  const REQUIRED = ['serverNow', 'profile', 'stats', 'shift', 'duty', 'absentRequests', 'scheduleRequests', 'missed'];

  async function load(fresh) {
    data = A.requireShape(fresh || await A.api('internDashboard'), REQUIRED, 'internDashboard');
    render();
  }

  /* ---------------- Rendering ---------------- */
  function render() {
    $('#intern-name').textContent = data.profile.name;
    $('#intern-meta').textContent = [data.profile.school, data.profile.schedule,
      data.profile.dayOffs.length ? 'Day off: ' + data.profile.dayOffs.join(', ') : ''].filter(Boolean).join('  |  ');
    renderRoster();
    $('#sec-dashboard').innerHTML = dashboardHTML();
    $('#sec-absence').innerHTML = requestPageHTML('absence');
    $('#sec-schedule').innerHTML = requestPageHTML('schedule');
    $('#sec-missed').innerHTML = missedHTML();
    bind();
    A.tick();

    if (data.shift.state === 'NEEDS_LATE_ACK' && !lateOpen) showLateModal();
    if (data.shift.state !== 'NEEDS_LATE_ACK' && lateOpen) { lateOpen = false; A.closeModal(); }
  }

  function rosterLabel(p) {
    if (p.tone === 'present') return p.late ? 'Present (late)' : 'Present';
    if (p.tone === 'leave') return 'On leave';
    if (p.tone === 'absent') return 'Absent';
    if (p.tone === 'late') return 'Not in yet';
    return 'Expected';
  }

  function renderRoster() {
    const list = data.duty.list;
    $('#roster').innerHTML = list.length ? list.map(p => `
      <li class="${p.name === data.profile.name ? 'me' : ''}">
        <span class="r-name">${esc(p.name)}</span>
        <span class="r-shift">${esc(p.scheduleName)}, ${esc(p.timeText)}</span>
        <span class="pill ${esc(p.tone)}">${esc(rosterLabel(p))}</span>
      </li>`).join('') : '<li class="roster-empty">Nobody is scheduled today.</li>';
  }

  function dashboardHTML() {
    const s = data.stats;
    const pct = s.hoursRequired ? Math.min(100, s.renderedHours / s.hoursRequired * 100) : 0;
    return `
      ${shiftCardHTML(data.shift)}
      <div class="stats stats-4">
        <div class="stat"><div class="stat-value">${hrs(s.hoursRequired)}</div><div class="stat-label">Hours required to render</div></div>
        <div class="stat"><div class="stat-value">${hrs(s.renderedHours)}</div><div class="stat-label">Total hours rendered</div>
          <div class="progress" title="${pct.toFixed(0)}% complete"><div style="width:${pct}%"></div></div>
          <div class="stat-note">${hrs(s.remainingHours)} hours to go</div></div>
        <div class="stat ${s.lateCount ? 'warn' : ''}"><div class="stat-value">${s.lateCount}</div><div class="stat-label">Number of lates</div></div>
        <div class="stat ${s.absentCount ? 'bad' : ''}"><div class="stat-value">${s.absentCount}</div><div class="stat-label">Number of absences</div></div>
      </div>`;
  }

  function shiftCardHTML(sh) {
    const hasShift = !!sh.start;
    const info = hasShift ? `${esc(sh.scheduleName)}${sh.isOverride ? ' (changed schedule)' : ''}, ${esc(sh.dateText)}, ${esc(sh.startText)} to ${esc(sh.endText)}` : '';
    let title, sub = info, body = '', inLabel = 'Time in', inDisabled = true, inDone = false, note = '';

    switch (sh.state) {
      case 'READY':
        title = 'Ready to time in';
        inDisabled = false;
        note = `Timing in early is fine. Your hours count from ${esc(sh.startText)}.`;
        break;
      case 'NEEDS_LATE_ACK':
        title = 'You are late';
        inDisabled = false;
        note = 'Acknowledge that you are late to unlock Time in.';
        break;
      case 'ONGOING':
        title = '<span class="live">Timed in, counting hours</span>';
        inLabel = 'Timed in at ' + esc(sh.timeInText); inDone = true;
        body = `<div class="counter" id="counter">00:00:00</div><div class="counter-label" id="counter-label"></div>`;
        break;
      case 'DONE':
        title = 'End of shift recorded';
        sub = `${info}. In ${esc(sh.timeInText)}, out ${esc(sh.timeOutText)}. ${hrs(sh.hoursCredited)} hours added to your rendered hours.`;
        break;
      case 'ON_LEAVE':
        title = 'Approved absence';
        sub = 'Your absence for this shift was approved.';
        break;
      case 'ABSENT':
        title = 'Marked absent';
        sub = esc(sh.remarks || 'No time in was recorded for this shift.');
        break;
      default:
        title = 'No shift right now';
        sub = sh.nextText ? 'Next shift: ' + esc(sh.nextText) : 'You have no upcoming shift. Ask your admin about your schedule.';
    }

    const rail = hasShift && ['READY', 'NEEDS_LATE_ACK', 'ONGOING'].includes(sh.state) ? `
      <div class="rail" aria-hidden="true">
        <div class="rail-track"><div class="rail-fill" id="rail-fill"></div><div class="rail-needle" id="rail-needle"><span>Now</span></div></div>
        <div class="rail-ends"><span>${esc(sh.startText)}</span><span>${esc(sh.endText)}</span></div>
      </div>` : '';

    return `
      <section class="shift" aria-live="polite">
        <div class="shift-state">${title}</div>
        <div class="shift-sub">${sub}</div>
        ${body}${rail}
        <div class="punch">
          <button class="btn btn-in ${inDone ? 'done' : ''}" id="btn-in" ${inDisabled ? 'disabled' : ''}>${inLabel}</button>
          <button class="btn btn-out" id="btn-out" disabled>Time out (end of shift)</button>
        </div>
        <p class="punch-note" id="punch-note">${note}</p>
      </section>`;
  }

  function requestPageHTML(kind) {
    const isAbs = kind === 'absence';
    const list = isAbs ? data.absentRequests : data.scheduleRequests;
    const items = list.length ? list.map(r => `
      <div class="req">
        <div class="req-top"><span class="req-date">${esc(r.dateText)}</span>
          <span class="pill ${esc(r.status)}">${esc(statusWord[r.status] || r.status)}</span></div>
        <p class="req-reason">${esc(r.reason)}</p>
        ${r.newSchedule ? `<div class="req-remark"><strong>New schedule:</strong> ${esc(r.newSchedule)}</div>` : ''}
        ${r.adminRemark ? `<div class="req-remark"><strong>${r.status === 'DECLINED' ? 'Reason for decline' : 'Admin note'}:</strong> ${esc(r.adminRemark)}</div>` : ''}
        <div class="small muted" style="margin-top:6px">Filed ${esc(r.createdText)}</div>
      </div>`).join('') : `<p class="empty">No ${isAbs ? 'absence' : 'schedule change'} requests yet.</p>`;

    return `
      <div class="two-col">
        <section class="panel">
          <h2>${isAbs ? 'File an absence' : 'Request a schedule change'}</h2>
          <p class="lead">${isAbs ? 'Your admin will accept or decline it.' : 'If accepted, your admin assigns your new schedule for that date.'}</p>
          <form class="req-form" data-kind="${kind}" novalidate>
            <label class="field"><span>Date</span><input type="date" name="date" min="${A.todayISO()}" required></label>
            <label class="field"><span>Reason</span>
              <textarea name="reason" maxlength="500" required placeholder="${isAbs ? 'Reason for your absence' : 'Reason for changing your schedule'}"></textarea>
              <span class="hint">5 to 500 characters.</span></label>
            <p class="form-error"></p>
            <button class="btn btn-primary btn-block" type="submit">${isAbs ? 'Submit absence' : 'Submit request'}</button>
          </form>
        </section>
        <section class="panel">
          <h2>${isAbs ? 'My absence requests' : 'My schedule change requests'}</h2>
          <p class="lead">Pending, accepted and declined requests.</p>
          <div class="req-list">${items}</div>
        </section>
      </div>`;
  }

  function missedHTML() {
    const rows = data.missed;
    return `
      <section class="panel">
        <h2>Missed time in and time out</h2>
        <p class="lead">Each of these was recorded as an absence.</p>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>What happened</th><th>Reason</th></tr></thead>
          <tbody>${rows.map(m => `<tr><td>${esc(m.dateText)}</td>
            <td><span class="pill ${m.type === 'Filed absence' ? 'leave' : 'absent'}">${esc(m.type)}</span></td>
            <td>${esc(m.reason)}${m.timeInText ? `<span class="sub">Timed in at ${esc(m.timeInText)}, never timed out</span>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No missed time ins or time outs.</p>'}
      </section>`;
  }

  /* ---------------- Live updates every second ---------------- */
  A.onTick((n) => {
    if (!data || current !== 'dashboard') return;
    const sh = data.shift;
    if (!sh.start) return;
    const span = sh.end - sh.start;
    const needle = $('#rail-needle'), fill = $('#rail-fill');
    if (needle) needle.style.left = (Math.max(0, Math.min(1, (n - sh.start) / span)) * 100) + '%';
    if (sh.state !== 'ONGOING') return;

    const countTo = Math.min(n, sh.end);
    const counter = $('#counter');
    if (counter) counter.textContent = hms(Math.max(0, countTo - sh.countStart));
    if (fill) {
      const a = Math.max(0, (sh.countStart - sh.start) / span);
      const b = Math.max(a, Math.min(1, (countTo - sh.start) / span));
      fill.style.left = (a * 100) + '%'; fill.style.width = ((b - a) * 100) + '%';
    }
    const label = $('#counter-label'), out = $('#btn-out'), note = $('#punch-note');
    const brk = sh.breakHours ? ` ${hrs(sh.breakHours)} hr break is deducted at time out.` : '';
    if (label) {
      label.textContent = n < sh.countStart ? 'Counting starts at ' + sh.countStartText + '.'
        : n < sh.end ? 'Counting since ' + sh.countStartText + '.' + brk
        : 'Counting stopped at ' + sh.endText + ', your scheduled end.' + brk;
    }
    if (out && !A.state.busy) {
      const open = n >= sh.end;
      out.disabled = !open;
      const deadline = fmt(sh.end + data.forgotTimeoutHours * 3600000, { hour: 'numeric', minute: '2-digit' });
      note.textContent = open
        ? `You can time out now. If you don't time out by ${deadline}, this shift is voided and marked absent.`
        : `Time out unlocks at ${sh.endText}.`;
    }
  });

  /* ---------------- Actions ---------------- */
  function showLateModal() {
    const sh = data.shift;
    A.modal({
      title: 'You are late',
      className: 'late',
      dismissible: false,
      body: `<p>Your ${esc(sh.scheduleName)} shift started at ${esc(sh.startText)}. You are late by</p>
             <div class="late-amount">${esc(sh.lateText)}</div>
             <p class="muted small">This adds 1 to your number of lates. Your hours count from the next half hour after you time in.</p>`,
      actions: [{
        label: 'I acknowledge', kind: 'btn-primary',
        onClick: async (b) => {
          const fresh = await A.run(b, () => A.api('acknowledgeLate'), 'Saving…', true);
          lateOpen = false; A.closeModal();
          await load(fresh);
          A.toast('Late acknowledged. You can time in now.');
        }
      }]
    });
    lateOpen = true;
  }

  function bind() {
    const bin = $('#btn-in'), bout = $('#btn-out');
    if (bin) bin.addEventListener('click', async () => {
      if (data.shift.state === 'NEEDS_LATE_ACK') return showLateModal();
      try {
        await load(await A.run(bin, () => A.api('timeIn'), 'Timing in…'));
        A.toast('Timed in. Your hours are now counting.', 'success');
      } catch (e) { if (e.code === 'LATE_ACK_REQUIRED') await load(); }
    });
    if (bout) bout.addEventListener('click', () => {
      A.modal({
        title: 'End your shift?',
        body: '<p>Your hours for this shift will be added to your rendered hours.</p>',
        actions: [{ label: 'Cancel' }, {
          label: 'Time out', kind: 'btn-primary', onClick: async (b) => {
            const fresh = await A.run(b, () => A.api('timeOut'), 'Timing out…', true);
            A.closeModal(); await load(fresh);
            A.toast(`Timed out. ${hrs(fresh.shift.hoursCredited || 0)} hours added.`, 'success');
          }
        }]
      });
    });

    $$('.req-form').forEach(form => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const date = fd.get('date'), reason = String(fd.get('reason') || '').trim();
      const err = $('.form-error', form); err.textContent = '';
      if (!date) { err.textContent = 'Choose a date.'; return; }
      if (reason.length < 5) { err.textContent = 'Reason must be at least 5 characters.'; return; }
      const isAbs = form.dataset.kind === 'absence';
      try {
        const fresh = await A.run($('button[type=submit]', form), () => A.api(isAbs ? 'fileAbsent' : 'fileScheduleChange', { date, reason }), 'Submitting…', true);
        await load(fresh);
        A.toast(isAbs ? 'Absence submitted. Waiting for admin.' : 'Request submitted. Waiting for admin.', 'success');
      } catch (ex) { err.textContent = ex.message; }
    }));
  }

  /* ---------------- Start ---------------- */
  A.initTabs((name) => { current = name; A.tick(); });

  async function refresh() {
    if (document.hidden || A.state.busy) return;
    if (A.modalOpen() && !lateOpen) return;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (typing) return;
    try { await load(); } catch (e) { /* shown on next action */ }
  }

  load().catch(e => {
    $('#sec-dashboard').innerHTML = `<div class="panel"><h2>Couldn't load your dashboard</h2><p class="lead">${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
  });
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
