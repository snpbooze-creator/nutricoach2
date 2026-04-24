// nutritionist.js — nutritionist dashboard + client-profile logic

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (page === 'dashboard') await initDashboard();
  if (page === 'profile')   await initProfile();
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

async function initDashboard() {
  const session = await requireRole('nutritionist');
  if (!session) return;
  setTopbarUser(session.name, 'nutritionist');
  initLogout();
  initTabs();
  document.getElementById('account-btn')?.addEventListener('click', () => showAccountModal(session));

  const today = new Date().toISOString().split('T')[0];
  const [clients, allAppts] = await Promise.all([
    getClientsByNutritionist(session.userId),
    getAppointmentsByNutritionist(session.userId)
  ]);

  const upcomingCount = allAppts.filter(a => a.status !== 'cancelled' && a.status !== 'completed' && a.date >= today).length;
  document.getElementById('stat-upcoming-appts').textContent = upcomingCount;

  const allCheckIns = await Promise.all(clients.map(c => getCheckInsByClient(c.id)));
  const todayCount  = allCheckIns.flat().filter(ci => ci.date === today).length;
  document.getElementById('stat-today-checkins').textContent = todayCount;

  await renderClientList(session);
  await renderAppointmentsTab(session);
  await renderTemplateManager(session.userId);
  await renderRecipeManager(session.userId);  // NEW FEATURE
}

async function renderClientList(session) {
  const el = document.getElementById('client-list');
  el.innerHTML = '<div class="empty-state"><p style="color:var(--text-muted)">Loading clients…</p></div>';

  async function render() {
    const [assigned, unassigned] = await Promise.all([
      getClientsByNutritionist(session.userId),
      getUnassignedClients()
    ]);

    document.getElementById('stat-clients').textContent = assigned.length;

    const assignedRows = assigned.length
      ? await Promise.all(assigned.map(async c => {
          const [checkIns, plan] = await Promise.all([
            getCheckInsByClient(c.id),
            getMealPlanByClient(c.id)
          ]);
          const last = checkIns[0];
          return `
            <a class="client-row" href="client-profile.html?clientId=${c.id}">
              <div class="client-row-info">
                <div class="avatar">${getInitials(c.name)}</div>
                <div>
                  <div class="client-row-name">${escapeHtml(c.name)}</div>
                  <div class="client-row-meta">${escapeHtml(c.goal) || 'No goal set'} · ${c.currentWeight ? c.currentWeight + ' kg' : '—'}</div>
                </div>
              </div>
              <div class="client-row-right">
                ${last ? `<span class="badge badge-green badge-hide-mobile">Last check-in ${formatDateShort(last.date)}</span>` : '<span class="badge badge-yellow">No check-ins</span>'}
                ${plan ? '' : '<span class="badge badge-red">No plan</span>'}
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--text-light);flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
              </div>
            </a>`;
        }))
      : ['<div class="empty-state"><p>No clients assigned yet.</p></div>'];

    const unassignedSection = unassigned.length ? `
      <div style="margin-top:28px">
        <div class="section-header" style="margin-bottom:12px">
          <span class="section-title">Unassigned Clients</span>
          <span class="badge badge-yellow">${unassigned.length}</span>
        </div>
        ${unassigned.map(c => `
          <div class="card card-sm" style="margin-bottom:10px;display:flex;align-items:center;gap:12px">
            <div class="avatar" style="flex-shrink:0">${getInitials(c.name)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${escapeHtml(c.name)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.goal) || 'No goal set'}</div>
            </div>
            <button class="btn btn-sm btn-primary assign-btn" data-id="${c.id}" style="flex-shrink:0">Assign to me</button>
          </div>`).join('')}
      </div>` : '';

    el.innerHTML = assignedRows.join('') + unassignedSection;

    el.querySelectorAll('.assign-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Assigning…';
        await assignClientToNutritionist(btn.dataset.id, session.userId);
        showToast('Client assigned!', 'success');
        await render();
      });
    });
  }

  await render();
}

// ─── TEMPLATE MANAGER ────────────────────────────────────────────────────────

async function renderTemplateManager(nutritionistId) {
  const el = document.getElementById('template-list');
  if (!el) return;

  async function render() {
    const templates = await getAllTemplatesVisibleTo(nutritionistId);
    if (!templates.length) {
      el.innerHTML = '<div class="empty-state"><p>No templates yet. Create one below.</p></div>';
      return;
    }
    el.innerHTML = templates.map(t => `
      <div class="card card-sm" style="margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <div style="font-weight:600;font-size:14px">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHtml(t.description) || ''}</div>
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
              ${t.meals.map(m => `<span class="badge badge-blue">${escapeHtml(m.type)} · ${m.items.length}</span>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary edit-tpl-btn" data-id="${t.id}">Edit</button>
            <button class="btn btn-sm btn-ghost delete-tpl-btn" data-id="${t.id}" style="color:var(--danger)">Delete</button>
          </div>
        </div>
      </div>`).join('');

    el.querySelectorAll('.delete-tpl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this template?')) return;
        await deleteTemplate(btn.dataset.id);
        await render();
        showToast('Template deleted.');
      });
    });

    el.querySelectorAll('.edit-tpl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const templates = await getAllTemplatesVisibleTo(nutritionistId);
        const tpl = templates.find(t => t.id === btn.dataset.id);
        openTemplateEditor(tpl, nutritionistId, render);
      });
    });
  }

  await render();

  document.getElementById('new-template-btn')?.addEventListener('click', () => {
    openTemplateEditor(null, nutritionistId, render);
  });
}

function openTemplateEditor(existing, nutritionistId, onSave) {
  const modal = document.getElementById('template-modal');
  const form  = document.getElementById('template-form');
  if (!modal || !form) return;

  const tpl = existing || {
    id: 'tpl_' + Math.random().toString(36).slice(2, 9),
    name: '', description: '', createdBy: nutritionistId,
    meals: [
      { type: 'breakfast', items: [] }, { type: 'lunch',   items: [] },
      { type: 'dinner',    items: [] }, { type: 'snacks',  items: [] }
    ],
    notes: ''
  };

  document.getElementById('tpl-name').value  = tpl.name;
  document.getElementById('tpl-desc').value  = tpl.description || '';
  document.getElementById('tpl-notes').value = tpl.notes || '';

  function renderMeals() {
    document.getElementById('tpl-meals').innerHTML = tpl.meals.map((meal, mi) => `
      <div style="margin-bottom:16px">
        <div class="meal-type-label" style="margin-bottom:8px">${meal.type}</div>
        <div style="display:flex;flex-direction:column;gap:6px" id="tpl-items-${mi}">
          ${meal.items.map((item, ii) => `
            <div class="meal-item">
              <span class="meal-item-name">${escapeHtml(item)}</span>
              <div class="meal-item-actions">
                <button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="(function(){
                  tpl_meals_ref[${mi}].items.splice(${ii},1);
                  renderTplMeals();
                })()">✕</button>
              </div>
            </div>`).join('')}
        </div>
        <div class="add-item-row" style="margin-top:8px">
          <input type="text" id="tpl-item-input-${mi}" placeholder="Add item…">
          <button class="btn btn-sm btn-secondary" id="tpl-add-${mi}">Add</button>
        </div>
      </div>
    `).join('<hr class="divider">');

    tpl.meals.forEach((meal, mi) => {
      document.getElementById(`tpl-add-${mi}`)?.addEventListener('click', () => {
        const inp = document.getElementById(`tpl-item-input-${mi}`);
        const val = inp.value.trim(); if (!val) return;
        meal.items.push(val); inp.value = ''; renderMeals();
      });
      document.getElementById(`tpl-item-input-${mi}`)?.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return; e.preventDefault();
        const val = e.target.value.trim(); if (!val) return;
        meal.items.push(val); e.target.value = ''; renderMeals();
      });
    });
  }

  window.tpl_meals_ref  = tpl.meals;
  window.renderTplMeals = renderMeals;
  renderMeals();
  modal.style.display = 'flex';

  form.onsubmit = async e => {
    e.preventDefault();
    tpl.name        = document.getElementById('tpl-name').value.trim();
    tpl.description = document.getElementById('tpl-desc').value.trim();
    tpl.notes       = document.getElementById('tpl-notes').value.trim();
    if (!tpl.name) { showToast('Please enter a template name.', 'error'); return; }
    await saveTemplate(tpl);
    modal.style.display = 'none';
    await onSave();
    showToast('Template saved!', 'success');
  };

  document.getElementById('close-modal-btn').onclick = () => { modal.style.display = 'none'; };
}

// ─── RECIPE MANAGER (NEW FEATURE) ────────────────────────────────────────────

async function renderRecipeManager(nutritionistId) {
  const el = document.getElementById('recipe-list');
  if (!el) return;

  async function render() {
    const recipes = await getRecipes();
    if (!recipes.length) {
      el.innerHTML = '<div class="empty-state"><p>No recipes yet. Create one to build your library.</p></div>';
      return;
    }
    el.innerHTML = recipes.map(r => `
      <div class="card card-sm" style="margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <div style="font-weight:600;font-size:14px">${escapeHtml(r.name)}</div>
            ${r.ingredients?.length
              ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">${r.ingredients.length} ingredient${r.ingredients.length !== 1 ? 's' : ''}</div>`
              : ''}
            ${r.instructions
              ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;font-style:italic">${escapeHtml(r.instructions.slice(0, 80))}${r.instructions.length > 80 ? '…' : ''}</div>`
              : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary edit-recipe-btn" data-id="${r.id}">Edit</button>
            <button class="btn btn-sm btn-ghost delete-recipe-btn" data-id="${r.id}" style="color:var(--danger)">Delete</button>
          </div>
        </div>
      </div>`).join('');

    el.querySelectorAll('.delete-recipe-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this recipe?')) return;
        await deleteRecipe(btn.dataset.id);
        await render();
        showToast('Recipe deleted.');
      });
    });

    el.querySelectorAll('.edit-recipe-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const recipes = await getRecipes();
        const recipe  = recipes.find(r => r.id === btn.dataset.id);
        openRecipeEditor(recipe, render);
      });
    });
  }

  await render();

  document.getElementById('new-recipe-btn')?.addEventListener('click', () => {
    openRecipeEditor(null, render);
  });
}

function openRecipeEditor(existing, onSave) {
  const modal = document.getElementById('recipe-modal');
  const form  = document.getElementById('recipe-form');
  if (!modal || !form) return;

  const recipe = existing || {
    id: 'rcp_' + Math.random().toString(36).slice(2, 9),
    name: '', ingredients: [], instructions: ''
  };

  document.getElementById('rcp-name').value         = recipe.name;
  document.getElementById('rcp-instructions').value = recipe.instructions || '';

  function renderIngredients() {
    const listEl = document.getElementById('rcp-ingredients-list');
    listEl.innerHTML = recipe.ingredients.length
      ? recipe.ingredients.map((ing, i) => `
          <div class="meal-item">
            <span class="meal-item-name">${escapeHtml(ing)}</span>
            <div class="meal-item-actions">
              <button type="button" class="btn btn-sm btn-ghost remove-ing-btn" data-idx="${i}" style="color:var(--danger)">✕</button>
            </div>
          </div>`).join('')
      : '<div style="font-size:13px;color:var(--text-muted);padding:4px 0">No ingredients yet.</div>';

    listEl.querySelectorAll('.remove-ing-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        recipe.ingredients.splice(parseInt(btn.dataset.idx), 1);
        renderIngredients();
      });
    });
  }

  renderIngredients();
  modal.style.display = 'flex';

  document.getElementById('rcp-add-ing-btn').onclick = () => {
    const inp = document.getElementById('rcp-ing-input');
    const val = inp.value.trim(); if (!val) return;
    recipe.ingredients.push(val); inp.value = ''; renderIngredients();
  };

  document.getElementById('rcp-ing-input').onkeydown = e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const val = e.target.value.trim(); if (!val) return;
    recipe.ingredients.push(val); e.target.value = ''; renderIngredients();
  };

  form.onsubmit = async e => {
    e.preventDefault();
    recipe.name         = document.getElementById('rcp-name').value.trim();
    recipe.instructions = document.getElementById('rcp-instructions').value.trim();
    if (!recipe.name) { showToast('Please enter a recipe name.', 'error'); return; }
    await saveRecipe(recipe);
    modal.style.display = 'none';
    await onSave();
    showToast('Recipe saved!', 'success');
  };

  document.getElementById('close-recipe-modal-btn').onclick = () => { modal.style.display = 'none'; };
}

// NEW FEATURE — recipe picker used from the meal plan editor
function showRecipePickerForMeal(recipes, onSelect) {
  const picker = document.getElementById('recipe-picker-modal');
  const list   = document.getElementById('recipe-picker-list');
  if (!picker || !list) return;

  list.innerHTML = recipes.map(r => `
    <div class="card card-sm" style="margin-bottom:8px;cursor:pointer" data-id="${r.id}">
      <div style="font-weight:600;font-size:14px">${escapeHtml(r.name)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
        ${r.ingredients?.length ? r.ingredients.length + ' ingredient' + (r.ingredients.length !== 1 ? 's' : '') : 'No ingredients'}
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const recipe = recipes.find(r => r.id === card.dataset.id);
      picker.style.display = 'none';
      onSelect(recipe);
    });
  });

  picker.style.display = 'flex';
  document.getElementById('close-recipe-picker-btn').onclick = () => { picker.style.display = 'none'; };
}

// ─── APPOINTMENTS TAB ────────────────────────────────────────────────────────

async function renderAppointmentsTab(session) {
  const el = document.getElementById('appointments-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><p style="color:var(--text-muted)">Loading appointments…</p></div>';

  const TYPE_LABELS = {
    consultation:   'Initial Consultation',
    'follow-up':    'Follow-up',
    review:         'Progress Review',
    'goal-setting': 'Goal Setting',
    other:          'Other'
  };

  let activeFilter = 'upcoming';

  async function render() {
    const today = new Date().toISOString().split('T')[0];
    const all   = await getAppointmentsByNutritionist(session.userId);

    let list;
    if (activeFilter === 'upcoming') {
      list = all.filter(a => a.status !== 'cancelled' && a.status !== 'completed' && a.date >= today);
    } else if (activeFilter === 'past') {
      list = all.filter(a => a.status === 'completed' || a.date < today)
                .sort((a, b) => b.date.localeCompare(a.date));
    } else {
      list = [...all].sort((a, b) => b.date.localeCompare(a.date));
    }

    document.querySelectorAll('.appt-filter-btn').forEach(btn => {
      const isActive = btn.dataset.filter === activeFilter;
      btn.className = `btn btn-sm ${isActive ? 'btn-secondary' : 'btn-ghost'} appt-filter-btn`;
    });

    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>${activeFilter === 'upcoming' ? 'No upcoming appointments. Schedule one!' : 'No appointments found.'}</p></div>`;
      return;
    }

    el.innerHTML = list.map(a => {
      const statusBadge = ({
        upcoming:  `<span class="badge badge-blue">Upcoming</span>`,
        completed: `<span class="badge badge-green">Completed</span>`,
        cancelled: `<span class="badge" style="background:var(--border);color:var(--text-muted)">Cancelled</span>`,
        requested: `<span class="badge badge-yellow">Requested</span>`
      })[a.status] || `<span class="badge">${a.status}</span>`;
      const canAct = a.status === 'upcoming' || a.status === 'requested';
      return `
        <div class="card card-sm" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div class="avatar" style="width:38px;height:38px;font-size:13px;flex-shrink:0">${getInitials(a.clientName || '?')}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${escapeHtml(a.clientName) || 'Unknown'}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                ${formatDate(a.date)} · ${formatTime(a.time)} · ${TYPE_LABELS[a.type] || a.type}
              </div>
              ${a.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;font-style:italic">${escapeHtml(a.notes)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              ${statusBadge}
              ${canAct ? `
                <button class="btn btn-sm btn-secondary complete-btn" data-id="${a.id}">Done</button>
                <button class="btn btn-sm btn-ghost cancel-btn" data-id="${a.id}" style="color:var(--danger)">✕</button>
              ` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.complete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateAppointment(btn.dataset.id, { status: 'completed' });
        showToast('Marked as completed.', 'success');
        await render();
      });
    });

    el.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this appointment?')) return;
        await updateAppointment(btn.dataset.id, { status: 'cancelled' });
        showToast('Appointment cancelled.');
        await render();
      });
    });
  }

  document.querySelectorAll('.appt-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; render(); });
  });

  await render();

  const modal = document.getElementById('appointment-modal');
  const form  = document.getElementById('appointment-form');

  document.getElementById('new-appt-btn')?.addEventListener('click', async () => {
    const clients = await getClientsByNutritionist(session.userId);
    const sel = document.getElementById('appt-client');
    sel.innerHTML = `<option value="">Select a client…</option>` +
      clients.map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    document.getElementById('appt-date').min   = new Date().toISOString().split('T')[0];
    document.getElementById('appt-date').value = new Date().toISOString().split('T')[0];
    modal.style.display = 'flex';
  });

  document.getElementById('close-appt-modal-btn')?.addEventListener('click', () => {
    modal.style.display = 'none';
    form.reset();
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const sel        = document.getElementById('appt-client');
    const clientId   = sel.value;
    const clientName = sel.options[sel.selectedIndex]?.dataset.name || '';
    const date       = document.getElementById('appt-date').value;
    const time       = document.getElementById('appt-time').value;
    const type       = document.getElementById('appt-type').value;
    const notes      = document.getElementById('appt-notes').value.trim();

    if (!clientId) { showToast('Please select a client.', 'error'); return; }
    if (!date)     { showToast('Please choose a date.', 'error'); return; }
    if (!time)     { showToast('Please choose a time.', 'error'); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Scheduling…';
    await scheduleAppointment({ clientId, nutritionistId: session.userId, clientName, date, time, type, notes, status: 'upcoming', createdBy: 'nutritionist' });
    btn.disabled = false; btn.textContent = 'Schedule Appointment';
    modal.style.display = 'none';
    form.reset();
    showToast('Appointment scheduled!', 'success');
    activeFilter = 'upcoming';
    await render();
  });
}

// ─── CLIENT PROFILE ──────────────────────────────────────────────────────────

async function initProfile() {
  const session = await requireRole('nutritionist');
  if (!session) return;
  setTopbarUser(session.name, 'nutritionist');
  initLogout();
  initTabs();
  document.getElementById('account-btn')?.addEventListener('click', () => showAccountModal(session));

  const params   = new URLSearchParams(window.location.search);
  const clientId = params.get('clientId');
  if (!clientId) { window.location.href = 'nutritionist.html'; return; }

  const client = await getClientById(clientId);
  if (!client || client.nutritionistId !== session.userId) {
    window.location.href = 'nutritionist.html'; return;
  }

  renderProfile(client, session);
  await renderMealPlanEditor(client, session.userId);
  await renderCheckInHistoryN(client);
  renderProgressionSection(client);
  initNotesEditor(client);
}

function renderProfile(client, session) {
  document.title = client.name + ' — NutriCoach';
  document.getElementById('client-name').textContent = client.name;
  document.getElementById('client-goal').textContent = client.goal || '';
  const av = document.getElementById('client-avatar');
  if (av) av.textContent = getInitials(client.name);

  document.getElementById('profile-details').innerHTML = `
    <div class="info-grid">
      <div class="info-item"><label>Age</label><div class="value">${client.age ? client.age + ' years' : '—'}</div></div>
      <div class="info-item"><label>Height</label><div class="value">${escapeHtml(client.height) || '—'}</div></div>
      <div class="info-item"><label>Current Weight</label><div class="value">${client.currentWeight ? client.currentWeight + ' kg' : '—'}</div></div>
      <div class="info-item"><label>Goal</label><div class="value">${escapeHtml(client.goal) || '—'}</div></div>
      <div class="info-item"><label>Allergies</label><div class="value">${escapeHtml(client.allergies) || 'None'}</div></div>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-sm btn-ghost" id="remove-client-btn" style="color:var(--danger)">Remove from my clients</button>
    </div>`;

  document.getElementById('remove-client-btn').addEventListener('click', async () => {
    if (!confirm(`Remove ${client.name} from your clients? They will become unassigned.`)) return;
    await updateClient(client.id, { nutritionistId: null });
    showToast('Client removed.', 'success');
    setTimeout(() => { window.location.href = 'nutritionist.html'; }, 800);
  });
}

// ─── MEAL PLAN EDITOR ────────────────────────────────────────────────────────

async function renderMealPlanEditor(client, nutritionistId) {
  let plan = await getMealPlanByClient(client.id);
  const el = document.getElementById('meal-plan-editor');

  async function renderEditor() {
    if (!plan) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🥗</div>
          <p style="margin-bottom:16px">No meal plan yet.</p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="create-plan-btn">Create Blank Plan</button>
            <button class="btn btn-secondary" id="from-template-btn">Use Template</button>
          </div>
        </div>`;
      document.getElementById('create-plan-btn').addEventListener('click', async () => {
        plan = await createMealPlan(client.id); await renderEditor();
      });
      document.getElementById('from-template-btn').addEventListener('click', () => {
        showTemplatePickerForClient(client.id, nutritionistId, async newPlan => { plan = newPlan; await renderEditor(); });
      });
      return;
    }

    el.innerHTML = `
      <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span style="font-size:12px;color:var(--text-muted)">Last updated ${formatDate(plan.dateCreated)}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" id="apply-template-btn">Apply Template</button>
          <button class="btn btn-sm btn-primary" id="save-plan-btn">Save Plan</button>
        </div>
      </div>
      ${plan.meals.map((meal, mi) => `
        <div class="meal-section">
          <div class="meal-section-header">
            <span class="meal-type-label">${meal.type}</span>
          </div>
          <div class="meal-items">
            ${meal.items.length
              ? meal.items.map((item, ii) => `
                  <div class="meal-item">
                    <span class="meal-item-name">${escapeHtml(item)}</span>
                    <div class="meal-item-actions">
                      <button class="btn btn-sm btn-ghost remove-item" data-meal="${mi}" data-item="${ii}" style="color:var(--danger)">✕</button>
                    </div>
                  </div>`).join('')
              : '<div class="meal-empty">No items added</div>'
            }
          </div>
          <div class="add-item-row">
            <input type="text" placeholder="Add food item…" class="add-item-input" data-meal="${mi}" id="item-input-${mi}">
            <button class="btn btn-sm btn-secondary add-item-btn" data-meal="${mi}">Add</button>
            <button class="btn btn-sm btn-ghost from-recipe-btn" data-meal="${mi}" title="Add from recipe" type="button">📖</button>
          </div>
        </div>
        ${mi < plan.meals.length - 1 ? '<hr class="divider">' : ''}`).join('')}
      <hr class="divider">
      <div class="form-group">
        <label>Plan Notes</label>
        <textarea id="plan-notes" rows="3" placeholder="Calorie targets, timing, special instructions…">${plan.notes || ''}</textarea>
      </div>`;

    function saveNotesFromDom() {
      const notesEl = document.getElementById('plan-notes');
      if (notesEl) plan.notes = notesEl.value;
    }

    el.querySelectorAll('.add-item-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mi  = parseInt(btn.dataset.meal);
        const inp = document.getElementById(`item-input-${mi}`);
        const val = inp.value.trim(); if (!val) return;
        saveNotesFromDom();
        plan.meals[mi].items.push(val); inp.value = ''; await renderEditor();
      });
    });

    el.querySelectorAll('.add-item-input').forEach(input => {
      input.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return; e.preventDefault();
        const mi  = parseInt(input.dataset.meal);
        const val = input.value.trim(); if (!val) return;
        saveNotesFromDom();
        plan.meals[mi].items.push(val); input.value = ''; await renderEditor();
      });
    });

    el.querySelectorAll('.remove-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        saveNotesFromDom();
        plan.meals[parseInt(btn.dataset.meal)].items.splice(parseInt(btn.dataset.item), 1);
        await renderEditor();
      });
    });

    // NEW FEATURE — add from recipe
    el.querySelectorAll('.from-recipe-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mi      = parseInt(btn.dataset.meal);
        const recipes = await getRecipes();
        if (!recipes.length) {
          showToast('No recipes yet. Add some from the Recipes tab.', 'error'); return;
        }
        saveNotesFromDom();
        showRecipePickerForMeal(recipes, recipe => {
          const added = [];
          recipe.ingredients.forEach(ing => {
            if (!plan.meals[mi].items.includes(ing)) {
              plan.meals[mi].items.push(ing);
              added.push(ing);
            }
          });
          renderEditor();
          if (added.length) showToast(`Added ${added.length} ingredient${added.length !== 1 ? 's' : ''} from "${recipe.name}".`, 'success');
          else showToast('All ingredients already in this meal.', 'default');
        });
      });
    });

    document.getElementById('save-plan-btn').addEventListener('click', async () => {
      plan.notes       = document.getElementById('plan-notes').value.trim();
      plan.dateCreated = new Date().toISOString().split('T')[0];
      await saveMealPlan(plan);
      showToast('Meal plan saved!', 'success');
    });

    document.getElementById('apply-template-btn').addEventListener('click', () => {
      showTemplatePickerForClient(client.id, nutritionistId, async newPlan => { plan = newPlan; await renderEditor(); });
    });
  }

  await renderEditor();
}

async function showTemplatePickerForClient(clientId, nutritionistId, onApply) {
  const templates = await getAllTemplatesVisibleTo(nutritionistId);
  if (!templates.length) { showToast('No templates available. Create one from the dashboard.', 'error'); return; }

  const modal = document.getElementById('template-picker-modal');
  const list  = document.getElementById('template-picker-list');
  if (!modal || !list) return;

  list.innerHTML = templates.map(t => `
    <div class="card card-sm" style="margin-bottom:10px;cursor:pointer" data-id="${t.id}">
      <div style="font-weight:600;font-size:14px">${escapeHtml(t.name)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHtml(t.description) || ''}</div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
        ${t.meals.map(m => `<span class="badge badge-blue">${escapeHtml(m.type)} · ${m.items.length}</span>`).join('')}
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', async () => {
      const newPlan = await applyTemplateToClient(card.dataset.id, clientId);
      modal.style.display = 'none';
      await onApply(newPlan);
      showToast('Template applied!', 'success');
    });
  });

  modal.style.display = 'flex';
  document.getElementById('close-picker-btn').onclick = () => { modal.style.display = 'none'; };
}

// ─── CHECK-IN HISTORY (NUTRITIONIST VIEW) ─────────────────────────────────────

async function renderCheckInHistoryN(client) {
  // NEW FEATURE — also load meal photos for gallery
  const [checkIns, allPhotos] = await Promise.all([
    getCheckInsByClient(client.id),
    getMealPhotosByClient(client.id)
  ]);
  const el = document.getElementById('checkin-history');
  if (!checkIns.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No check-ins submitted yet.</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Adh.</th><th>Hunger</th><th>Energy</th>
            <th>Weight</th><th>Water</th><th>Body Fat</th><th>Muscle</th>
            <th>Comments</th><th>Feedback</th>
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
              <td>${ci.bodyFat    != null ? ci.bodyFat    + '%'  : '—'}</td>
              <td>${ci.muscleMass != null ? ci.muscleMass + ' kg' : '—'}</td>
              <td style="max-width:140px;color:var(--text-muted)">${escapeHtml(ci.comments) || '—'}</td>
              <td style="min-width:160px">
                <div class="feedback-cell" data-id="${ci.id}">
                  ${ci.feedback
                    ? `<span class="feedback-text" style="font-size:12px;color:var(--teal);display:block;margin-bottom:2px">${escapeHtml(ci.feedback)}</span>
                       <button class="btn btn-sm btn-ghost edit-feedback-btn" data-id="${ci.id}" style="font-size:11px;padding:2px 6px">Edit</button>`
                    : `<button class="btn btn-sm btn-ghost add-feedback-btn" data-id="${ci.id}" style="font-size:11px;padding:2px 6px;color:var(--teal)">+ Add feedback</button>`}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${allPhotos.length ? `
      <div style="margin-top:24px">
        <div class="section-title" style="margin-bottom:12px">Meal Photos</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${allPhotos.map(p => `
            <div style="text-align:center">
              <img src="${p.photo}" style="width:100px;height:80px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" alt="${p.mealType} photo">
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${formatDateShort(p.date)} · ${p.mealType}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}`;

  // NEW FEATURE — inline feedback editing
  function attachFeedbackHandlers() {
    el.querySelectorAll('.add-feedback-btn, .edit-feedback-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id   = btn.dataset.id;
        const cell = el.querySelector(`.feedback-cell[data-id="${id}"]`);
        const ci   = checkIns.find(c => c.id === id);
        cell.innerHTML = `
          <textarea class="feedback-input" style="width:100%;font-size:12px;border:1px solid var(--border);border-radius:6px;padding:6px;resize:vertical;min-height:60px">${escapeHtml(ci.feedback || '')}</textarea>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button class="btn btn-sm btn-primary save-feedback-btn" data-id="${id}" style="font-size:11px;padding:3px 8px">Save</button>
            <button class="btn btn-sm btn-ghost cancel-feedback-btn" data-id="${id}" style="font-size:11px;padding:3px 8px">Cancel</button>
          </div>`;

        cell.querySelector('.save-feedback-btn').addEventListener('click', async () => {
          const text = cell.querySelector('.feedback-input').value.trim();
          await updateCheckIn(id, { feedback: text });
          ci.feedback = text;
          cell.innerHTML = text
            ? `<span class="feedback-text" style="font-size:12px;color:var(--teal);display:block;margin-bottom:2px">${escapeHtml(text)}</span>
               <button class="btn btn-sm btn-ghost edit-feedback-btn" data-id="${id}" style="font-size:11px;padding:2px 6px">Edit</button>`
            : `<button class="btn btn-sm btn-ghost add-feedback-btn" data-id="${id}" style="font-size:11px;padding:2px 6px;color:var(--teal)">+ Add feedback</button>`;
          attachFeedbackHandlers();
          showToast('Feedback saved!', 'success');
        });

        cell.querySelector('.cancel-feedback-btn').addEventListener('click', () => {
          cell.innerHTML = ci.feedback
            ? `<span class="feedback-text" style="font-size:12px;color:var(--teal);display:block;margin-bottom:2px">${escapeHtml(ci.feedback)}</span>
               <button class="btn btn-sm btn-ghost edit-feedback-btn" data-id="${id}" style="font-size:11px;padding:2px 6px">Edit</button>`
            : `<button class="btn btn-sm btn-ghost add-feedback-btn" data-id="${id}" style="font-size:11px;padding:2px 6px;color:var(--teal)">+ Add feedback</button>`;
          attachFeedbackHandlers();
        });
      });
    });
  }

  attachFeedbackHandlers();
}

// ─── PROGRESSION SECTION ─────────────────────────────────────────────────────

function renderProgressionSection(client) {
  const el = document.getElementById('progression-section');
  if (!el) return;

  async function render() {
    const [checkIns, measurements] = await Promise.all([
      getCheckInsByClient(client.id),
      getMeasurementsByClient(client.id)
    ]);
    const sortedCI = [...checkIns].sort((a, b) => a.date.localeCompare(b.date));
    const latestCI = sortedCI[sortedCI.length - 1];
    const latestM  = measurements[measurements.length - 1];
    const hasBF    = measurements.some(m => m.bodyFat    != null);
    const hasMM    = measurements.some(m => m.muscleMass != null);

    el.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header"><div class="card-title">Log Measurements</div></div>
        <form id="log-measurements-form">
          <div class="form-row">
            <div class="form-group">
              <label for="m-date">Date</label>
              <input type="date" id="m-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
              <label for="m-bodyfat">Body fat %</label>
              <input type="number" id="m-bodyfat" step="0.1" min="1" max="60" placeholder="e.g. 22.5">
            </div>
            <div class="form-group">
              <label for="m-muscle">Muscle mass (kg)</label>
              <input type="number" id="m-muscle" step="0.1" min="10" max="120" placeholder="e.g. 47.0">
            </div>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Enter at least one of body fat or muscle mass.</p>
          <button type="submit" class="btn btn-primary">Save Measurement</button>
        </form>
      </div>

      <div class="grid-3" style="margin-bottom:16px">
        <div class="stat-card">
          <div class="stat-label">Current Weight</div>
          <div class="stat-value">${latestCI ? latestCI.weight : '—'}</div>
          <div class="stat-sub">${latestCI ? 'kg · ' + _delta(sortedCI, 'weight') + ' vs first' : 'No check-ins yet'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Body Fat</div>
          <div class="stat-value">${latestM?.bodyFat != null ? latestM.bodyFat + '%' : '—'}</div>
          <div class="stat-sub">${hasBF ? _delta(measurements.filter(m => m.bodyFat != null), 'bodyFat') + '% vs first' : 'Not recorded'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Muscle Mass</div>
          <div class="stat-value">${latestM?.muscleMass != null ? latestM.muscleMass + ' kg' : '—'}</div>
          <div class="stat-sub">${hasMM ? _delta(measurements.filter(m => m.muscleMass != null), 'muscleMass') + ' kg vs first' : 'Not recorded'}</div>
        </div>
      </div>

      ${sortedCI.length ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header"><div class="card-title">Weight</div></div>
        <div id="chart-weight" style="padding-bottom:8px"></div>
      </div>` : ''}

      ${hasBF ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header"><div class="card-title">Body Fat %</div></div>
        <div id="chart-bodyfat" style="padding-bottom:8px"></div>
      </div>` : ''}

      ${hasMM ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header"><div class="card-title">Muscle Mass</div></div>
        <div id="chart-muscle" style="padding-bottom:8px"></div>
      </div>` : ''}
    `;

    if (sortedCI.length) renderWeightChart(sortedCI, 'chart-weight', 'weight', 'kg');
    if (hasBF) renderWeightChart(measurements.filter(m => m.bodyFat    != null), 'chart-bodyfat', 'bodyFat',    '%');
    if (hasMM) renderWeightChart(measurements.filter(m => m.muscleMass != null), 'chart-muscle',  'muscleMass', 'kg');

    document.getElementById('log-measurements-form').addEventListener('submit', async e => {
      e.preventDefault();
      const date       = document.getElementById('m-date').value;
      const bodyFat    = parseFloat(document.getElementById('m-bodyfat').value) || null;
      const muscleMass = parseFloat(document.getElementById('m-muscle').value)  || null;
      if (!bodyFat && !muscleMass) { showToast('Enter at least one measurement.', 'error'); return; }
      await saveMeasurement({ clientId: client.id, date, bodyFat, muscleMass });
      showToast('Measurement saved!', 'success');
      await render();
    });
  }

  render();
}

function _delta(sorted, field) {
  const first = sorted.find(c => c[field] != null)?.[field];
  const last  = [...sorted].reverse().find(c => c[field] != null)?.[field];
  if (first == null || last == null || first === last) return '0';
  const diff = (last - first).toFixed(1);
  return (diff > 0 ? '+' : '') + diff;
}

// ─── NOTES EDITOR ────────────────────────────────────────────────────────────

function initNotesEditor(client) {
  const textarea = document.getElementById('client-notes');
  const btn      = document.getElementById('save-notes-btn');
  if (!textarea || !btn) return;
  textarea.value = client.notes || '';
  btn.addEventListener('click', async () => {
    await updateClient(client.id, { notes: textarea.value.trim() });
    showToast('Notes saved!', 'success');
  });
}
