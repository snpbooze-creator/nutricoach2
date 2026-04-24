// client.js — client dashboard logic (async/await, Firebase)

// NEW FEATURE — image compression helper for meal photo upload
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireRole('client');
  if (!session) return;

  setTopbarUser(session.name, 'client');
  initLogout();
  initTabs();
  document.getElementById('account-btn')?.addEventListener('click', () => showAccountModal(session));

  // Greeting
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const welcomeEl = document.getElementById('welcome-msg');
  if (welcomeEl) welcomeEl.textContent = greeting + ', ' + session.name.split(' ')[0];

  // Show loading state while profile loads
  const mealEl = document.getElementById('meal-plan-content');
  if (mealEl) mealEl.innerHTML = '<div class="empty-state"><p style="color:var(--text-muted)">Loading…</p></div>';

  const client = await getClientByUserId(session.userId);
  if (!client) { document.body.innerHTML = '<p style="padding:40px">Client profile not found.</p>'; return; }

  await renderStats(client);
  await renderMealPlan(client);
  renderCheckInForm(client);
  await renderCheckInHistory(client);
  await renderClientAppointments(client, session);
  await renderShoppingList(client);       // NEW FEATURE
  await checkFridayPrompt(client);        // NEW FEATURE
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

  const totalItems = plan.meals.reduce((sum, m) => sum + m.items.length, 0);

  async function getCheckedCount() {
    const checks = await getMealChecks(client.id, today);
    return checks.length;
  }

  async function syncAdherence() {
    if (!totalItems) return;
    const count = await getCheckedCount();
    const score = Math.round((count / totalItems) * 10);
    const slider  = document.getElementById('ci-adherence');
    const display = document.getElementById('ci-adherence-val');
    if (slider)  slider.value = score;
    if (display) display.textContent = score;
  }

  async function render() {
    // NEW FEATURE — also load today's meal photos
    const [checks, photos] = await Promise.all([
      getMealChecks(client.id, today),
      getMealPhotosByClientDate(client.id, today)
    ]);

    el.innerHTML = plan.meals.map((meal, mi) => `
      <div class="meal-section">
        <div class="meal-section-header">
          <span class="meal-type-label">${meal.type}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge badge-blue">${meal.items.length} item${meal.items.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-sm btn-ghost upload-photo-btn" data-meal-type="${meal.type}"
              style="padding:2px 6px;line-height:1;font-size:15px" title="Upload meal photo">📷</button>
          </div>
        </div>
        ${photos[meal.type]
          ? `<img src="${photos[meal.type]}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-bottom:10px" alt="${meal.type} photo">`
          : ''}
        <div class="meal-items">
          ${meal.items.length
            ? meal.items.map((item, ii) => {
                const key     = `${mi}-${ii}`;
                const checked = checks.includes(key);
                return `
                  <label class="meal-item meal-item-check" style="cursor:pointer;user-select:none;${checked ? 'opacity:0.6' : ''}">
                    <input type="checkbox" class="meal-checkbox" data-key="${key}"
                      ${checked ? 'checked' : ''}
                      style="width:18px;height:18px;accent-color:var(--teal);flex-shrink:0;cursor:pointer;margin-right:10px">
                    <span class="meal-item-name" style="${checked ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${escapeHtml(item)}</span>
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
        ${escapeHtml(plan.notes)}
      </div>` : '');

    // NEW FEATURE — meal photo upload handlers (re-attached each render, safe since innerHTML replaces old nodes)
    el.querySelectorAll('.upload-photo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = async () => {
          const file = fileInput.files[0];
          if (!file) return;
          btn.textContent = '⏳';
          btn.disabled = true;
          try {
            const dataUrl = await compressImage(file, 400, 0.65);
            await saveMealPhoto(client.id, today, btn.dataset.mealType, dataUrl);
            showToast('Photo uploaded!', 'success');
          } catch (err) {
            showToast('Could not upload photo.', 'error');
          }
          await render();
          await updateSummary();
        };
        fileInput.click();
      });
    });

    await syncAdherence();
  }

  // Progress summary bar
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

  // Delegated listener for meal checkboxes — guarded to prevent duplicate registration
  if (!el._mealListenerAttached) {
    el._mealListenerAttached = true;
    el.addEventListener('change', async e => {
      const cb = e.target.closest('.meal-checkbox');
      if (!cb) return;
      let currentChecks = await getMealChecks(client.id, today);
      if (cb.checked) {
        if (!currentChecks.includes(cb.dataset.key)) currentChecks.push(cb.dataset.key);
      } else {
        currentChecks = currentChecks.filter(k => k !== cb.dataset.key);
      }
      await saveMealChecks(client.id, today, currentChecks);
      await syncAdherence();
      await render();
      await updateSummary();
    });
  }

  await render();
  await updateSummary();
}

// ─── CHECK-IN FORM ────────────────────────────────────────────────────────────

function renderCheckInForm(client) {
  const form  = document.getElementById('checkin-form');
  const today = new Date().toISOString().split('T')[0];

  ['adherence', 'hunger', 'energy'].forEach(field => {
    const slider  = document.getElementById(`ci-${field}`);
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
      clientId:    client.id,
      date:        today,
      adherence:   parseInt(document.getElementById('ci-adherence').value),
      hunger:      parseInt(document.getElementById('ci-hunger').value),
      energy:      parseInt(document.getElementById('ci-energy').value),
      weight,
      waterIntake: parseFloat(document.getElementById('ci-water')?.value) || null, // NEW FEATURE
      bodyFat:     null,
      muscleMass:  null,
      comments:    document.getElementById('ci-comments').value.trim()
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

  if (!client.nutritionistId) {
    el.innerHTML = `<div class="card" style="max-width:560px">
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <p>You don't have a nutritionist assigned yet. Once assigned, you'll be able to request and view appointments here.</p>
      </div>
    </div>`;
    return;
  }

  const TYPE_LABELS = {
    consultation:   'Initial Consultation',
    'follow-up':    'Follow-up',
    review:         'Progress Review',
    'goal-setting': 'Goal Setting',
    other:          'Other'
  };

  async function render() {
    const today     = new Date().toISOString().split('T')[0];
    const all       = await getAppointmentsByClient(client.id);
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
              ${a.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;font-style:italic">${escapeHtml(a.notes)}</div>` : ''}
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

      ${upcoming.length  ? `<div style="margin-bottom:16px"><div class="section-title" style="margin-bottom:10px">Upcoming</div>${upcoming.map(apptCard).join('')}</div>` : ''}
      ${past.length      ? `<div style="margin-bottom:16px"><div class="section-title" style="margin-bottom:10px">Past</div>${past.map(apptCard).join('')}</div>` : ''}
      ${cancelled.length ? `<div style="margin-bottom:16px"><div class="section-title" style="margin-bottom:10px">Cancelled</div>${cancelled.map(apptCard).join('')}</div>` : ''}
      ${!all.length      ? `<div class="empty-state"><div class="empty-icon">📅</div><p>No appointments yet. Request one above!</p></div>` : ''}
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
        clientId: client.id, nutritionistId: client.nutritionistId || '',
        clientName: session.name, date, time, type, notes,
        status: 'requested', createdBy: 'client'
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
            <th>Date</th><th>Adh.</th><th>Hunger</th><th>Energy</th>
            <th>Weight</th><th>Water</th><th>Comments</th><th>Feedback</th>
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
              <td>${ci.waterIntake != null ? ci.waterIntake + ' L' : '—'}</td>
              <td style="max-width:160px;color:var(--text-muted)">${escapeHtml(ci.comments) || '—'}</td>
              <td style="max-width:180px;color:var(--teal);font-style:italic;font-size:12px">
                ${ci.feedback ? escapeHtml(ci.feedback) : '<span style="color:var(--text-light)">—</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── SHOPPING LIST (NEW FEATURE) ─────────────────────────────────────────────

async function renderShoppingList(client) {
  const el = document.getElementById('shopping-list-content');
  if (!el) return;

  const plan = await getMealPlanByClient(client.id);
  if (!plan) {
    el.innerHTML = `<div class="card" style="max-width:560px">
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <p>No meal plan yet. Your shopping list will appear here once your nutritionist creates one.</p>
      </div>
    </div>`;
    return;
  }

  // Collect all items across all meals, deduplicated (case-insensitive)
  const seen = new Set();
  const allItems = [];
  plan.meals.forEach(meal => {
    meal.items.forEach(item => {
      const key = item.toLowerCase().trim();
      if (!seen.has(key)) { seen.add(key); allItems.push(item); }
    });
  });

  if (!allItems.length) {
    el.innerHTML = `<div class="card" style="max-width:560px">
      <div class="empty-state"><div class="empty-icon">🛒</div><p>Your meal plan has no items yet.</p></div>
    </div>`;
    return;
  }

  const storageKey = `shopping_${client.id}`;

  function getChecked() { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
  function setChecked(arr) { localStorage.setItem(storageKey, JSON.stringify(arr)); }

  function render() {
    const checked   = getChecked();
    const remaining = allItems.filter(i => !checked.includes(i)).length;

    el.innerHTML = `
      <div class="card" style="max-width:560px">
        <div class="card-header">
          <div>
            <div class="card-title">Shopping List</div>
            <div class="card-subtitle">${remaining} of ${allItems.length} items remaining</div>
          </div>
          <button class="btn btn-sm btn-ghost" id="clear-shopping-btn" style="font-size:12px">Reset</button>
        </div>
        <div>
          ${allItems.map(item => {
            const isDone = checked.includes(item);
            return `
              <label class="meal-item meal-item-check" style="cursor:pointer;user-select:none;${isDone ? 'opacity:0.5' : ''}">
                <input type="checkbox" class="shopping-cb" data-item="${escapeHtml(item)}"
                  ${isDone ? 'checked' : ''}
                  style="width:18px;height:18px;accent-color:var(--teal);flex-shrink:0;cursor:pointer;margin-right:10px">
                <span style="${isDone ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${escapeHtml(item)}</span>
              </label>`;
          }).join('')}
        </div>
      </div>`;

    document.getElementById('clear-shopping-btn').addEventListener('click', () => {
      setChecked([]);
      render();
    });

    el.querySelectorAll('.shopping-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const current = getChecked();
        const item    = cb.dataset.item;
        if (cb.checked) { if (!current.includes(item)) current.push(item); }
        else { const idx = current.indexOf(item); if (idx > -1) current.splice(idx, 1); }
        setChecked(current);
        render();
      });
    });
  }

  render();
}

// ─── FRIDAY ADHERENCE PROMPT (NEW FEATURE) ───────────────────────────────────

async function checkFridayPrompt(client) {
  if (new Date().getDay() !== 5) return; // only on Fridays
  const weekKey  = getWeekMonday();
  const existing = await getWeekendRisk(client.id, weekKey);
  if (existing) return; // already answered this week
  showFridayModal(client, weekKey);
}

function showFridayModal(client, weekKey) {
  const modal = document.getElementById('friday-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  // Replace buttons to clear any stale listeners
  ['friday-submit-btn', 'friday-skip-btn'].forEach(id => {
    const old = document.getElementById(id);
    const neo = old.cloneNode(true);
    old.replaceWith(neo);
  });

  document.getElementById('friday-submit-btn').addEventListener('click', async () => {
    const hasEvent = document.getElementById('friday-has-event').checked;
    const note     = document.getElementById('friday-note').value.trim();
    await saveWeekendRisk(client.id, weekKey, hasEvent, note);
    modal.style.display = 'none';
    showToast('Weekend plan saved! Stay on track 💪', 'success');
  });

  document.getElementById('friday-skip-btn').addEventListener('click', async () => {
    await saveWeekendRisk(client.id, weekKey, false, '');
    modal.style.display = 'none';
  });
}
