// client.js — client dashboard logic (async/await, Firebase)

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireRole('client');
  if (!session) return;

  setTopbarUser(session.name, 'client');
  initLogout();
  initTabs();

  // Greeting
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const welcomeEl = document.getElementById('welcome-msg');
  if (welcomeEl) welcomeEl.textContent = greeting + ', ' + session.name.split(' ')[0];

  const client = await getClientByUserId(session.userId);
  if (!client) { document.body.innerHTML = '<p style="padding:40px">Client profile not found.</p>'; return; }

  await renderStats(client);
  await renderMealPlan(client);
  renderCheckInForm(client);
  await renderCheckInHistory(client);
  await renderClientAppointments(client, session);
});

async function renderStats(client) {
  const [checkIns, plan] = await Promise.all([
    getCheckInsByClient(client.id),
    getMealPlanByClient(client.id)
  ]);
  const w  = document.getElementById('stat-weight');
  const ci = document.getElementById('stat-checkins');
  const lc = document.getElementById('stat-last-checkin');
  const pd = document.getElementById('stat-plan-date');
  if (w)  w.textContent  = client.currentWeight ? client.currentWeight + ' kg' : '—';
  if (ci) ci.textContent = checkIns.length;
  if (lc) lc.textContent = checkIns.length ? formatDateShort(checkIns[0].date) : '—';
  if (pd) pd.textContent = plan ? formatDateShort(plan.dateCreated) : '—';
}

// ─── MEAL PLAN WITH CHECKBOXES ────────────────────────────────────────────────

async function renderMealPlan(client) {
  const plan = await getMealPlanByClient(client.id);
  const el = document.getElementById('meal-plan-content');
  const today = new Date().toISOString().split('T')[0];

  if (!plan) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🥗</div><p>No meal plan assigned yet. Your nutritionist will add one soon.</p></div>';
    return;
  }

  document.getElementById('plan-date').textContent = 'Updated ' + formatDate(plan.dateCreated);

  // Count total items for adherence calculation
  const totalItems = plan.meals.reduce((sum, m) => sum + m.items.length, 0);

  async function getCheckedCount() {
    const checks = await getMealChecks(client.id, today);
    return checks.length;
  }

  async function syncAdherence() {
    if (!totalItems) return;
    const count = await getCheckedCount();
    const pct = count / totalItems;
    const score = Math.round(pct * 10);
    const slider = document.getElementById('ci-adherence');
    const display = document.getElementById('ci-adherence-val');
    if (slider) { slider.value = score; }
    if (display) { display.textContent = score; }
  }

  async function render() {
    const checks = await getMealChecks(client.id, today);

    el.innerHTML = plan.meals.map((meal, mi) => `
      <div class="meal-section">
        <div class="meal-section-header">
          <span class="meal-type-label">${meal.type}</span>
          <span class="badge badge-blue">${meal.items.length} item${meal.items.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="meal-items">
          ${meal.items.length
            ? meal.items.map((item, ii) => {
                const key = `${mi}-${ii}`;
                const checked = checks.includes(key);
                return `
                  <label class="meal-item meal-item-check" style="cursor:pointer;user-select:none;${checked ? 'opacity:0.6' : ''}">
                    <input type="checkbox" class="meal-checkbox" data-key="${key}"
                      ${checked ? 'checked' : ''}
                      style="width:18px;height:18px;accent-color:var(--teal);flex-shrink:0;cursor:pointer;margin-right:10px">
                    <span class="meal-item-name" style="${checked ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${item}</span>
                  </label>`;
              }).join('')
            : '<div class="meal-empty">No items yet</div>'
          }
        </div>
      </div>
      ${mi < plan.meals.length - 1 ? '<hr class="divider">' : ''}`
    ).join('') + (plan.notes ? `
      <div style="margin-top:16px;padding:12px 14px;background:var(--teal-light);border-radius:var(--radius);font-size:13px;color:var(--teal-darker)">
        <strong style="display:block;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Nutritionist Notes</strong>
        ${plan.notes}
      </div>` : '');

    // Wire checkboxes
    el.querySelectorAll('.meal-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        let currentChecks = await getMealChecks(client.id, today);
        if (cb.checked) {
          if (!currentChecks.includes(cb.dataset.key)) currentChecks.push(cb.dataset.key);
        } else {
          currentChecks = currentChecks.filter(k => k !== cb.dataset.key);
        }
        await saveMealChecks(client.id, today, currentChecks);
        await syncAdherence();
        await render(); // re-render to update strikethrough
      });
    });

    await syncAdherence();
  }

  await render();

  // Progress summary bar below the plan
  // Remove existing bar if present to avoid duplicates
  const existingBar = document.getElementById('meal-progress-bar');
  if (existingBar) existingBar.remove();

  const summary = document.createElement('div');
  summary.id = 'meal-progress-bar';
  el.parentElement.appendChild(summary);

  async function updateSummary() {
    const checked = await getCheckedCount();
    const pct = totalItems ? Math.round((checked / totalItems) * 100) : 0;
    const bar = document.getElementById('meal-progress-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div style="margin-top:16px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:8px">
          <span style="color:var(--text-muted)">Today's progress</span>
          <span style="color:var(--teal)">${checked}/${totalItems} meals</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--teal);border-radius:99px;transition:width 0.3s ease"></div>
        </div>
      </div>`;
  }

  // Observe meal checkbox changes to update summary
  el.addEventListener('change', updateSummary);
  await updateSummary();
}

// ─── CHECK-IN FORM ────────────────────────────────────────────────────────────

function renderCheckInForm(client) {
  const form = document.getElementById('checkin-form');
  const today = new Date().toISOString().split('T')[0];

  ['adherence', 'hunger', 'energy'].forEach(field => {
    const slider = document.getElementById(`ci-${field}`);
    const display = document.getElementById(`ci-${field}-val`);
    if (slider && display) {
      display.textContent = slider.value;
      slider.addEventListener('input', () => { display.textContent = slider.value; });
    }
  });

  const weightInput = document.getElementById('ci-weight');
  if (weightInput && client.currentWeight) weightInput.value = client.currentWeight;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const weight = parseFloat(document.getElementById('ci-weight').value);
    if (!weight || weight < 20 || weight > 400) {
      showToast('Please enter a valid weight.', 'error'); return;
    }
    const checkIn = {
      clientId:   client.id,
      date:       today,
      adherence:  parseInt(document.getElementById('ci-adherence').value),
      hunger:     parseInt(document.getElementById('ci-hunger').value),
      energy:     parseInt(document.getElementById('ci-energy').value),
      weight,
      bodyFat:    null,
      muscleMass: null,
      comments:   document.getElementById('ci-comments').value.trim()
    };

    await addCheckIn(checkIn);
    showToast('Check-in submitted!', 'success');

    form.reset();
    ['adherence', 'hunger', 'energy'].forEach(f => {
      document.getElementById(`ci-${f}`).value = 5;
      document.getElementById(`ci-${f}-val`).textContent = '5';
    });
    if (weightInput) weightInput.value = weight;

    await renderCheckInHistory(client);
    await renderStats({ ...client, currentWeight: weight });

    // Clear today's meal checks after submitting
    await saveMealChecks(client.id, today, []);
    await renderMealPlan(client);
  });
}

// ─── APPOINTMENTS ────────────────────────────────────────────────────────────

async function renderClientAppointments(client, session) {
  const el = document.getElementById('appointments-content');
  if (!el) return;

  const TYPE_LABELS = {
    consultation:   'Initial Consultation',
    'follow-up':    'Follow-up',
    review:         'Progress Review',
    'goal-setting': 'Goal Setting',
    other:          'Other'
  };

  async function render() {
    const today = new Date().toISOString().split('T')[0];
    const all   = await getAppointmentsByClient(client.id);

    const upcoming  = all.filter(a => (a.status === 'upcoming' || a.status === 'requested') && a.date >= today);
    const past      = all.filter(a => a.status === 'completed' || (a.date < today && a.status !== 'cancelled'))
                        .sort((a, b) => b.date.localeCompare(a.date));
    const cancelled = all.filter(a => a.status === 'cancelled');

    function apptCard(a) {
      const statusBadge = ({
        upcoming:  `<span class="badge badge-blue">Confirmed</span>`,
        completed: `<span class="badge badge-green">Completed</span>`,
        cancelled: `<span class="badge" style="background:var(--border);color:var(--text-muted)">Cancelled</span>`,
        requested: `<span class="badge badge-yellow">Requested</span>`
      })[a.status] || `<span class="badge">${a.status}</span>`;

      const canCancel = a.status === 'upcoming' || a.status === 'requested';
      return `
        <div class="card card-sm" style="margin-bottom:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="min-width:0">
              <div style="font-weight:600;font-size:14px">${TYPE_LABELS[a.type] || a.type}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${formatDate(a.date)} · ${formatTime(a.time)}</div>
              ${a.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;font-style:italic">${a.notes}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              ${statusBadge}
              ${canCancel ? `<button class="btn btn-sm btn-ghost cancel-appt-btn" data-id="${a.id}" style="color:var(--danger)">Cancel</button>` : ''}
            </div>
          </div>
        </div>`;
    }

    el.innerHTML = `
      <div class="card" style="max-width:560px;margin-bottom:20px">
        <div class="card-header">
          <div>
            <div class="card-title">Request Appointment</div>
            <div class="card-subtitle">Your nutritionist will confirm the time</div>
          </div>
        </div>
        <form id="request-appt-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group" style="margin-bottom:0">
              <label for="req-date">Preferred date</label>
              <input type="date" id="req-date" min="${today}" required>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label for="req-time">Preferred time</label>
              <input type="time" id="req-time" required>
            </div>
          </div>
          <div class="form-group" style="margin-top:22px">
            <label for="req-type">Type</label>
            <select id="req-type">
              <option value="follow-up">Follow-up</option>
              <option value="consultation">Initial Consultation</option>
              <option value="review">Progress Review</option>
              <option value="goal-setting">Goal Setting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="req-notes">Notes (optional)</label>
            <textarea id="req-notes" rows="2" placeholder="What would you like to discuss?"></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Send Request</button>
        </form>
      </div>

      ${upcoming.length ? `
        <div style="margin-bottom:16px">
          <div class="section-title" style="margin-bottom:10px">Upcoming</div>
          ${upcoming.map(apptCard).join('')}
        </div>` : ''}

      ${past.length ? `
        <div style="margin-bottom:16px">
          <div class="section-title" style="margin-bottom:10px">Past</div>
          ${past.map(apptCard).join('')}
        </div>` : ''}

      ${cancelled.length ? `
        <div style="margin-bottom:16px">
          <div class="section-title" style="margin-bottom:10px">Cancelled</div>
          ${cancelled.map(apptCard).join('')}
        </div>` : ''}

      ${!all.length ? `<div class="empty-state"><div class="empty-icon">📅</div><p>No appointments yet. Request one above!</p></div>` : ''}
    `;

    document.getElementById('request-appt-form').addEventListener('submit', async e => {
      e.preventDefault();
      const date  = document.getElementById('req-date').value;
      const time  = document.getElementById('req-time').value;
      const type  = document.getElementById('req-type').value;
      const notes = document.getElementById('req-notes').value.trim();
      const btn   = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending…';
      await scheduleAppointment({
        clientId:       client.id,
        nutritionistId: client.nutritionistId || '',
        clientName:     session.name,
        date, time, type, notes,
        status:    'requested',
        createdBy: 'client'
      });
      btn.disabled = false; btn.textContent = 'Send Request';
      showToast('Appointment requested!', 'success');
      e.target.reset();
      await render();
    });

    el.querySelectorAll('.cancel-appt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this appointment?')) return;
        await updateAppointment(btn.dataset.id, { status: 'cancelled' });
        showToast('Appointment cancelled.');
        await render();
      });
    });
  }

  await render();
}

// ─── CHECK-IN HISTORY ────────────────────────────────────────────────────────

async function renderCheckInHistory(client) {
  const checkIns = await getCheckInsByClient(client.id);
  const el = document.getElementById('checkin-history');
  if (!checkIns.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No check-ins yet. Submit your first one!</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Adherence</th><th>Hunger</th><th>Energy</th>
            <th>Weight</th><th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${checkIns.map(ci => `
            <tr>
              <td>${formatDate(ci.date)}</td>
              <td><span class="score ${scoreClass(ci.adherence)}">${ci.adherence}</span></td>
              <td><span class="score ${scoreClass(ci.hunger)}">${ci.hunger}</span></td>
              <td><span class="score ${scoreClass(ci.energy)}">${ci.energy}</span></td>
              <td><strong>${ci.weight} kg</strong></td>
              <td style="max-width:200px;color:var(--text-muted)">${ci.comments || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
