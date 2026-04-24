// data.js — Firestore data access (async/await, no localStorage, no SEED)

// ─── CLIENTS ─────────────────────────────────────────────────────────────────

async function getClientByUserId(userId) {
  const snap = await db.collection('clients').where('userId', '==', userId).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getClientById(clientId) {
  const doc = await db.collection('clients').doc(clientId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function getClientsByNutritionist(nutritionistId) {
  const snap = await db.collection('clients').where('nutritionistId', '==', nutritionistId).get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateClient(clientId, fields) {
  await db.collection('clients').doc(clientId).update(fields);
}

async function getUnassignedClients() {
  const snap = await db.collection('clients').where('nutritionistId', '==', null).get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function assignClientToNutritionist(clientId, nutritionistId) {
  await db.collection('clients').doc(clientId).update({ nutritionistId });
}

// ─── MEAL PLANS ──────────────────────────────────────────────────────────────

async function getMealPlanByClient(clientId) {
  const snap = await db.collection('mealPlans').where('clientId', '==', clientId).get();
  if (snap.empty) return null;
  const plans = snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated));
  return plans[0];
}

async function saveMealPlan(plan) {
  const { id, ...data } = plan;
  await db.collection('mealPlans').doc(id).set(data);
}

async function createMealPlan(clientId) {
  const existing = await getMealPlanByClient(clientId);
  if (existing) return existing;
  const data = {
    clientId,
    dateCreated: new Date().toISOString().split('T')[0],
    meals: [
      { type: 'breakfast', items: [] },
      { type: 'lunch',     items: [] },
      { type: 'dinner',    items: [] },
      { type: 'snacks',    items: [] }
    ],
    notes: ''
  };
  const ref = await db.collection('mealPlans').add(data);
  return { id: ref.id, ...data };
}

// ─── MEAL PLAN TEMPLATES ─────────────────────────────────────────────────────

async function getAllTemplatesVisibleTo(nutritionistId) {
  const snap = await db.collection('mealPlanTemplates').get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function saveTemplate(template) {
  const { id, ...data } = template;
  await db.collection('mealPlanTemplates').doc(id).set(data);
}

async function deleteTemplate(templateId) {
  await db.collection('mealPlanTemplates').doc(templateId).delete();
}

async function applyTemplateToClient(templateId, clientId) {
  const tplDoc = await db.collection('mealPlanTemplates').doc(templateId).get();
  if (!tplDoc.exists) return null;
  const tpl = tplDoc.data();
  const data = {
    clientId,
    dateCreated: new Date().toISOString().split('T')[0],
    meals: tpl.meals.map(m => ({ type: m.type, items: [...m.items] })),
    notes: tpl.notes || ''
  };
  const existing = await getMealPlanByClient(clientId);
  if (existing) {
    await db.collection('mealPlans').doc(existing.id).set(data);
    return { id: existing.id, ...data };
  }
  const ref = await db.collection('mealPlans').add(data);
  return { id: ref.id, ...data };
}

// ─── CHECK-INS ───────────────────────────────────────────────────────────────

async function getCheckInsByClient(clientId) {
  const snap = await db.collection('checkIns').where('clientId', '==', clientId).get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function addCheckIn(checkIn) {
  const docId = `${checkIn.clientId}_${checkIn.date}`;
  await db.collection('checkIns').doc(docId).set(checkIn);
  await updateClient(checkIn.clientId, { currentWeight: checkIn.weight });
  return { id: docId, ...checkIn };
}

// ─── MEASUREMENTS ─────────────────────────────────────────────────────────────

async function getMeasurementsByClient(clientId) {
  const snap = await db.collection('measurements').where('clientId', '==', clientId).get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function saveMeasurement({ clientId, date, bodyFat, muscleMass }) {
  const docId = `${clientId}_${date}`;
  const data = { clientId, date };
  if (bodyFat    != null) data.bodyFat    = bodyFat;
  if (muscleMass != null) data.muscleMass = muscleMass;
  await db.collection('measurements').doc(docId).set(data, { merge: true });
}

// ─── MEAL CHECKS ─────────────────────────────────────────────────────────────

async function getMealChecks(clientId, date) {
  const docId = `${clientId}_${date}`;
  const doc = await db.collection('mealChecks').doc(docId).get();
  if (!doc.exists) return [];
  return doc.data().checks || [];
}

async function saveMealChecks(clientId, date, checks) {
  const docId = `${clientId}_${date}`;
  await db.collection('mealChecks').doc(docId).set({ clientId, date, checks });
}

// ─── APPOINTMENTS ────────────────────────────────────────────────────────────

async function getAppointmentsByClient(clientId) {
  const snap = await db.collection('appointments').where('clientId', '==', clientId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

async function getAppointmentsByNutritionist(nutritionistId) {
  const snap = await db.collection('appointments').where('nutritionistId', '==', nutritionistId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

async function scheduleAppointment({ clientId, nutritionistId, clientName, date, time, type, notes, status, createdBy }) {
  const ref = db.collection('appointments').doc();
  await ref.set({
    clientId,
    nutritionistId,
    clientName: clientName || '',
    date,
    time,
    type: type || 'consultation',
    notes: notes || '',
    status: status || 'upcoming',
    createdBy: createdBy || 'nutritionist',
    createdAt: new Date().toISOString()
  });
  return { id: ref.id };
}

async function updateAppointment(appointmentId, fields) {
  await db.collection('appointments').doc(appointmentId).update(fields);
}

async function deleteAppointment(appointmentId) {
  await db.collection('appointments').doc(appointmentId).delete();
}

// ─── CHECK-IN FEEDBACK (NEW FEATURE) ─────────────────────────────────────────

async function updateCheckIn(checkInId, fields) {
  await db.collection('checkIns').doc(checkInId).update(fields);
}

// ─── RECIPES (NEW FEATURE) ───────────────────────────────────────────────────

async function getRecipes() {
  const snap = await db.collection('recipes').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function saveRecipe(recipe) {
  const { id, ...data } = recipe;
  await db.collection('recipes').doc(id).set(data);
}

async function deleteRecipe(recipeId) {
  await db.collection('recipes').doc(recipeId).delete();
}

// ─── WEEKEND RISK (NEW FEATURE) ──────────────────────────────────────────────

function getWeekMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

async function getWeekendRisk(clientId, weekKey) {
  const doc = await db.collection('weekendRisks').doc(`${clientId}_${weekKey}`).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function saveWeekendRisk(clientId, weekKey, hasEvent, note) {
  await db.collection('weekendRisks').doc(`${clientId}_${weekKey}`).set({
    clientId, weekKey, hasEvent, note: note || '',
    savedAt: new Date().toISOString()
  });
}

// ─── MEAL PHOTOS (NEW FEATURE) ───────────────────────────────────────────────

async function saveMealPhoto(clientId, date, mealType, photoDataUrl) {
  await db.collection('mealPhotos').doc(`${clientId}_${date}_${mealType}`).set({
    clientId, date, mealType, photo: photoDataUrl,
    uploadedAt: new Date().toISOString()
  });
}

async function getMealPhotosByClientDate(clientId, date) {
  const snap = await db.collection('mealPhotos')
    .where('clientId', '==', clientId).where('date', '==', date).get();
  const result = {};
  snap.docs.forEach(d => { result[d.data().mealType] = d.data().photo; });
  return result;
}

async function getMealPhotosByClient(clientId) {
  const snap = await db.collection('mealPhotos').where('clientId', '==', clientId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ─── UTILITIES (sync) ────────────────────────────────────────────────────────

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function scoreClass(val) {
  if (val == null) return 'score-low';
  if (val >= 8) return 'score-high';
  if (val >= 5) return 'score-mid';
  return 'score-low';
}
