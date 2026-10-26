/* L'Essentiel — logique applicative. Tout en local, sans dépendance. */
'use strict';

/* ---------- Utilitaires ---------- */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dstr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function money(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', '.') + '.-';
}

function fmtAmt(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/* ---------- État ---------- */

const KEY = 'lessentiel.v2';
const PALETTE = ['#e2a75b', '#6ea8dc', '#7cc98d', '#c98d7c', '#b08adc', '#7cc4c9', '#dc9ac4', '#a3b06b'];

function sanitizeState(s) {
  s.profiles.forEach((p, i) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(p.color))) {
      p.color = PALETTE[i % PALETTE.length];
    }
    p.name = String(p.name).slice(0, 20);
  });
  return s;
}

function defaultState() {
  return {
    v: 2,
    city: 'Delémont', lat: 47.35, lon: 7.33,
    profiles: [{ id: 'p1', name: 'Moi', color: '#e2a75b' }],
    active: 'p1',
    events: {},   // date -> [{id,time,label,done}]
    meals: {},    // date -> {midi, soir}
    chores: [],   // [{id,label}]
    choreDone: {},// date -> [choreIds]
    budget: { limit: 500, entries: [] }, // entries: [{id,date,label,amount}]
    health: {},   // date -> {profileId -> {water, sleep}}
    weather: null // {t, cur, min, max, code, label, icon}
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!s || s.v !== 2 || !Array.isArray(s.profiles) || !s.profiles.length) return defaultState();
    const d = defaultState();
    Object.assign(d, s);
    return sanitizeState(d);
  } catch (e) {
    return defaultState();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Impossible d’enregistrer (stockage plein ?)'); }
}

/* ---------- Toast ---------- */

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Date / horloge ---------- */

function todayStr() { return dstr(new Date()); }

function greetText() {
  const h = new Date().getHours();
  const name = activeProfile().name;
  const nm = name && name !== 'Moi' ? ', ' + name : '';
  if (h < 6) return 'Bonne nuit' + nm;
  if (h < 12) return 'Bonjour' + nm;
  if (h < 18) return 'Bon après-midi' + nm;
  return 'Bonsoir' + nm;
}

function refreshClock() {
  const now = new Date();
  $('clock').textContent =
    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  $('dateLine').textContent = new Intl.DateTimeFormat('fr-CH', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(now);
  $('greet').textContent = greetText();
  renderNextEvent();
}

/* ---------- Profils ---------- */

function activeProfile() {
  return state.profiles.find((p) => p.id === state.active) || state.profiles[0];
}

function renderProfiles() {
  const box = $('profilesChips');
  box.innerHTML = '';
  state.profiles.forEach((p) => {
    const el = document.createElement('span');
    el.className = 'chip' + (p.id === state.active ? ' on' : '');
    el.innerHTML =
      '<span class="sw" style="background:' + p.color + '"></span>' + esc(p.name) +
      '<span class="x" data-del="' + p.id + '" title="Supprimer">×</span>';
    el.addEventListener('click', (e) => {
      if (e.target.dataset.del) {
        deleteProfile(e.target.dataset.del);
      } else {
        state.active = p.id;
        save(); render();
      }
    });
    box.appendChild(el);
  });
}

function deleteProfile(id) {
  if (state.profiles.length <= 1) { toast('Il faut au moins une personne.'); return; }
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return;
  if (!confirm('Supprimer « ' + p.name + ' » ? Ses données de forme seront conservées.')) return;
  state.profiles = state.profiles.filter((x) => x.id !== id);
  if (state.active === id) state.active = state.profiles[0].id;
  save(); render();
}

/* ---------- Plan du jour ---------- */

function dayEvents(date) {
  const list = state.events[date] || [];
  return list.slice().sort((a, b) => a.time.localeCompare(b.time));
}

function renderNextEvent() {
  const now = new Date();
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const local = dayEvents(todayStr()).filter((e) => !e.done && e.time > hm).map((e) => ({ time: e.time, label: e.label }));
  const gcal = gcalCached().filter((e) => !e.allDay && e.time && e.time > hm).map((e) => ({ time: e.time, label: e.label }));
  const upcoming = local.concat(gcal).sort((a, b) => a.time.localeCompare(b.time));
  const box = $('nextEventBox');
  if (upcoming.length) {
    box.innerHTML = 'Prochain : <b>' + esc(upcoming[0].time) + '</b> — ' + esc(upcoming[0].label);
  } else {
    const pending = dayEvents(todayStr()).filter((e) => !e.done).length;
    box.textContent = pending
      ? 'Tout est passé pour aujourd’hui. Bravo.'
      : 'Rien de prévu aujourd’hui. Profitez-en.';
  }
}

function renderEvents() {
  const list = $('eventsList');
  list.innerHTML = '';
  const evs = dayEvents(todayStr());
  evs.forEach((e) => {
    const li = document.createElement('li');
    li.className = e.done ? 'done' : '';
    li.innerHTML =
      '<span class="tag">' + esc(e.time) + '</span>' +
      '<span class="lab">' + esc(e.label) + '</span>' +
      '<button class="check' + (e.done ? ' on' : '') + '" data-check="' + e.id + '" title="Fait">✓</button>' +
      '<button class="del" data-del="' + e.id + '" title="Supprimer">✕</button>';
    li.querySelector('[data-check]').addEventListener('click', () => {
      e.done = !e.done; save(); renderEvents(); renderNextEvent();
    });
    li.querySelector('[data-del]').addEventListener('click', () => {
      state.events[todayStr()] = evs.filter((x) => x.id !== e.id);
      save(); renderEvents(); renderNextEvent();
    });
    list.appendChild(li);
  });

  // Événements Google Agenda (lecture seule)
  gcalCached().forEach((g) => {
    const li = document.createElement('li');
    li.className = 'gcal';
    li.title = 'Google Agenda';
    li.innerHTML =
      '<span class="tag">' + (g.allDay ? 'jour' : esc(g.time)) + '</span>' +
      '<span class="lab">' + esc(g.label) + '</span>' +
      '<span class="gcal-badge">G</span>';
    if (g.link) li.addEventListener('click', () => window.open(g.link, '_blank'));
    list.appendChild(li);
  });

  $('planHint').textContent = evs.length
    ? evs.filter((x) => !x.done).length + ' restant(s) — cochez pour ranger.'
    : 'Ajoutez ce qui compte vraiment aujourd’hui. Le reste peut attendre.';
}

/* ---------- Repas ---------- */

const MEAL_IDEAS = [
  'Pâtes au pesto et tomates cerises', 'Omelette aux herbes et salade verte',
  'Risotto aux champignons', 'Poulet rôti et légumes de saison',
  'Soupe de courge et pain grillé', 'Raclette — on est dans le Jura',
  'Fondue — il fait froid, assumez', 'Tartiflette maison',
  'Lentilles aux lardons', 'Gratin dauphinois et jambon',
  'Poisson en papillote et riz', 'Crêpes salées complètes',
  'Bolognaise express', 'Curry de pois chiches',
  'Salade composée du frigo', 'Quiche lorraine maison',
  'Gratin de pâtes au fromage', 'Wraps poulet et crudités',
  'Soupe de légumes et croûtons', 'Couscous rapide'
];

function renderMeals() {
  const t = todayStr();
  const m = state.meals[t] || { midi: '', soir: '' };
  $('mealMidi').value = m.midi || '';
  $('mealSoir').value = m.soir || '';
  const tm = state.meals[dstr(addDays(new Date(), 1))] || { midi: '', soir: '' };
  $('mealTomorrow').value = tm.midi || '';
}

function saveMeal(field, value) {
  const t = todayStr();
  if (!state.meals[t]) state.meals[t] = { midi: '', soir: '' };
  state.meals[t][field] = value.trim();
  save();
}

function saveTomorrowMidi(value) {
  const t = dstr(addDays(new Date(), 1));
  if (!state.meals[t]) state.meals[t] = { midi: '', soir: '' };
  state.meals[t].midi = value.trim();
  save();
}

/* ---------- Tâches ---------- */

function choreAssignee(chore, date) {
  const n = Math.max(state.profiles.length, 1);
  const base = Math.floor(date.getTime() / 86400000);
  const idx = ((base % n) + state.chores.indexOf(chore)) % n;
  return state.profiles[idx];
}

function renderChores() {
  const t = todayStr();
  const doneIds = state.choreDone[t] || [];
  const list = $('choresList');
  list.innerHTML = '';
  $('choreDay').innerHTML = state.chores.length
    ? 'Aujourd’hui : ' + state.chores.map((c) => {
        const who = choreAssignee(c, new Date());
        return '<b>' + esc(who.name) + '</b> → ' + esc(c.label);
      }).join(' · ')
    : '';
  state.chores.forEach((c) => {
    const done = doneIds.includes(c.id);
    const who = choreAssignee(c, new Date());
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    li.innerHTML =
      '<button class="check' + (done ? ' on' : '') + '" data-check="' + c.id + '" title="Fait">✓</button>' +
      '<span class="lab">' + esc(c.label) + '</span>' +
      '<span class="tag" style="color:' + who.color + '">' + esc(who.name) + '</span>' +
      '<button class="del" data-del="' + c.id + '" title="Supprimer la tâche">✕</button>';
    li.querySelector('[data-check]').addEventListener('click', () => {
      const cur = state.choreDone[t] || [];
      if (cur.includes(c.id)) state.choreDone[t] = cur.filter((x) => x !== c.id);
      else state.choreDone[t] = cur.concat([c.id]);
      save(); renderChores();
    });
    li.querySelector('[data-del]').addEventListener('click', () => {
      state.chores = state.chores.filter((x) => x.id !== c.id);
      save(); renderChores();
    });
    list.appendChild(li);
  });
}

/* ---------- Budget ---------- */

function weekRange() {
  const m = mondayOf(new Date());
  const start = dstr(m);
  const end = dstr(addDays(m, 6));
  return { start, end };
}

function weekTotal() {
  const { start, end } = weekRange();
  return state.budget.entries
    .filter((e) => e.date >= start && e.date <= end)
    .reduce((s, e) => s + e.amount, 0);
}

function renderBudget() {
  const limit = Number(state.budget.limit) || 0;
  const total = weekTotal();
  $('budgetLimit').value = state.budget.limit;
  $('budgetWeek').textContent = money(total);
  const day = state.budget.entries
    .filter((e) => e.date === todayStr())
    .reduce((s, e) => s + e.amount, 0);
  $('budgetToday').textContent = 'Aujourd’hui : ' + money(day);
  const bar = $('budgetBar');
  if (limit > 0) {
    const r = Math.min(total / limit, 1);
    bar.style.width = (r * 100).toFixed(1) + '%';
    bar.style.background = r < 0.6 ? 'var(--good)' : r < 0.85 ? 'var(--warn)' : 'var(--bad)';
  } else {
    bar.style.width = '0%';
  }
  const list = $('expensesList');
  list.innerHTML = '';
  const todays = state.budget.entries.filter((e) => e.date === todayStr());
  todays.slice().reverse().forEach((e) => {
    const li = document.createElement('li');
    li.innerHTML =
      '<span class="lab">' + esc(e.label) + '</span>' +
      '<span class="tag">' + money(e.amount) + '</span>' +
      '<button class="del" data-del="' + e.id + '" title="Supprimer">✕</button>';
    li.querySelector('[data-del]').addEventListener('click', () => {
      state.budget.entries = state.budget.entries.filter((x) => x.id !== e.id);
      save(); renderBudget();
    });
    list.appendChild(li);
  });
}

/* ---------- Forme ---------- */

function healthOf(date, profileId) {
  const h = state.health[date] || (state.health[date] = {});
  if (!h[profileId]) h[profileId] = { water: 0, sleep: 0 };
  return h[profileId];
}

function renderHealth() {
  const h = healthOf(todayStr(), state.active);
  $('waterCount').textContent = h.water;
  $('sleepCount').textContent = (Math.round(h.sleep * 2) / 2).toFixed(1).replace('.0', '');
  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const d = dstr(addDays(new Date(), -i));
    const rec = state.health[d] && state.health[d][state.active];
    if (rec && rec.sleep > 0) last7.push(rec.sleep);
  }
  $('sleepAvg').textContent = last7.length
    ? 'Moyenne sur 7 jours : ' + (last7.reduce((a, b) => a + b, 0) / last7.length).toFixed(1) + ' h — ' +
      (last7.length >= 7 ? 'semaine complète, bien joué.' : last7.length + ' nuit(s) suivie(s).')
    : 'Notez vos heures de sommeil : la moyenne apparaît ici.';
}

/* ---------- Météo ---------- */

const WEATHER_CODES = [
  [0, 'Ciel dégagé', '☀️'], [1, 'Peu nuageux', '🌤️'], [2, 'Peu nuageux', '🌤️'],
  [3, 'Couvert', '☁️'], [45, 'Brouillard', '🌫️'], [48, 'Brouillard', '🌫️'],
  [51, 'Bruine', '🌦️'], [53, 'Bruine', '🌦️'], [55, 'Bruine', '🌦️'],
  [61, 'Pluie', '🌧️'], [63, 'Pluie', '🌧️'], [65, 'Pluie forte', '🌧️'],
  [71, 'Neige', '❄️'], [73, 'Neige', '❄️'], [75, 'Neige forte', '❄️'],
  [77, 'Grésil', '🌨️'], [80, 'Averses', '🌦️'], [81, 'Averses', '🌦️'],
  [82, 'Averses fortes', '🌧️'], [85, 'Averses de neige', '🌨️'],
  [86, 'Averses de neige', '🌨️'], [95, 'Orage', '⛈️'], [96, 'Orage et grêle', '⛈️'],
  [99, 'Orage violent', '⛈️']
];

function weatherMeta(code) {
  for (const [c, label, icon] of WEATHER_CODES) {
    if (code <= c) return { label, icon };
  }
  return { label: 'Inconnu', icon: '🌡️' };
}

async function fetchWeather(force) {
  const cached = state.weather;
  if (!force && cached && cached.t && (Date.now() - cached.t < 30 * 60 * 1000)) {
    renderWeather();
    return;
  }
  $('weatherIcon').textContent = '···';
  $('weatherText').textContent = 'météo…';
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=' + state.lat + '&longitude=' + state.lon +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=1';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const cur = data.current.temperature_2m;
    const min = data.daily.temperature_2m_min[0];
    const max = data.daily.temperature_2m_max[0];
    const meta = weatherMeta(data.current.weather_code);
    state.weather = { t: Date.now(), cur, min, max, code: data.current.weather_code, label: meta.label, icon: meta.icon };
    save();
    renderWeather();
  } catch (e) {
    $('weatherIcon').textContent = '🌡️';
    $('weatherText').textContent = 'météo indisponible';
  }
}

function renderWeather() {
  const w = state.weather;
  if (!w) return;
  $('weatherIcon').textContent = w.icon;
  $('weatherText').textContent =
    Math.round(w.cur) + '°C ' + w.label + ' · ' + Math.round(w.min) + '°/' + Math.round(w.max) + '°';
}

/* ---------- Google Agenda (lecture seule) ---------- */

const GOOGLE_CLIENT_ID = 'PASTE_CLIENT_ID_HERE';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_KEY = 'lessentiel.google';
const GCAL_CACHE_KEY = 'lessentiel.gcal';

function googleConfigured() {
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.indexOf('PASTE') !== 0;
}

function gload() {
  try { return JSON.parse(localStorage.getItem(GOOGLE_KEY)); } catch (e) { return null; }
}
function gsave(t) { localStorage.setItem(GOOGLE_KEY, JSON.stringify(t)); }
function gclear() { localStorage.removeItem(GOOGLE_KEY); localStorage.removeItem(GCAL_CACHE_KEY); }
function gcalCached() {
  try { const c = JSON.parse(localStorage.getItem(GCAL_CACHE_KEY)); return (c && c.events) || []; }
  catch (e) { return []; }
}
function googleConnected() {
  const t = gload();
  return !!(t && t.token && t.exp && t.exp > Date.now() + 30000);
}

let tokenClient = null;

function ensureGoogleSdk(cb) {
  if (window.google && google.accounts && google.accounts.oauth2) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = cb;
  s.onerror = () => toast('Impossible de charger Google.');
  document.head.appendChild(s);
}

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GCAL_SCOPE,
    callback: (resp) => {
      if (resp.error !== undefined) { toast('Connexion Google annulée.'); return; }
      gsave({ token: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 });
      toast('Google Agenda connecté.');
      fetchGoogleEvents();
    },
  });
}

function connectGoogle() {
  if (!googleConfigured()) { toast('Clé Google non configurée.'); return; }
  ensureGoogleSdk(() => {
    if (!tokenClient) initTokenClient();
    tokenClient.requestAccessToken();
  });
}

function disconnectGoogle() {
  if (!confirm('Déconnecter Google Agenda ?')) return;
  gclear();
  renderGcal(); renderEvents(); renderNextEvent();
  toast('Google Agenda déconnecté.');
}

function mapGcalEvent(ev) {
  if (ev.status === 'cancelled') return null;
  if (ev.start.dateTime) {
    const d = new Date(ev.start.dateTime);
    return { id: ev.id, time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), allDay: false, label: ev.summary || '(sans titre)', link: ev.htmlLink || '' };
  }
  if (ev.start.date) {
    return { id: ev.id, time: '', allDay: true, label: ev.summary || '(sans titre)', link: ev.htmlLink || '' };
  }
  return null;
}

async function fetchGoogleEvents() {
  const t = gload();
  if (!t || !t.token) return;
  $('gcalStatus').textContent = 'synchronisation…';
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich';
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
    '?timeMin=' + encodeURIComponent(start.toISOString()) +
    '&timeMax=' + encodeURIComponent(end.toISOString()) +
    '&singleEvents=true&orderBy=startTime&timeZone=' + encodeURIComponent(tz);
  try {
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + t.token } });
    if (res.status === 401) { gclear(); renderGcal(); renderEvents(); toast('Session Google expirée, reconnecte-toi.'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const events = (data.items || []).map(mapGcalEvent).filter(Boolean);
    localStorage.setItem(GCAL_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), events }));
    renderGcal(); renderEvents(); renderNextEvent();
  } catch (e) {
    $('gcalStatus').textContent = 'échec';
    toast('Synchronisation Google impossible.');
  }
}

function renderGcal() {
  const toggle = $('gcalToggle');
  const status = $('gcalStatus');
  const connected = googleConnected();
  toggle.textContent = connected ? '🔗 Google Agenda · déconnecter' : '🔗 Google Agenda';
  status.textContent = connected ? 'connecté' : (googleConfigured() ? 'non connecté' : 'clé requise');
  status.className = 'gcal-status' + (connected ? ' on' : '');
}

/* ---------- Rendu global ---------- */

function render() {
  renderProfiles();
  renderEvents();
  renderGcal();
  renderMeals();
  renderChores();
  renderBudget();
  renderHealth();
  renderNextEvent();
  refreshClock();
}

/* ---------- Écouteurs ---------- */

function bind() {
  // Plan du jour
  $('eventForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = todayStr();
    if (!state.events[t]) state.events[t] = [];
    state.events[t].push({ id: uid(), time: $('evTime').value, label: $('evLabel').value.trim(), done: false });
    $('evLabel').value = '';
    save(); renderEvents(); renderNextEvent();
  });

  // Repas
  $('mealMidi').addEventListener('input', (e) => saveMeal('midi', e.target.value));
  $('mealSoir').addEventListener('input', (e) => saveMeal('soir', e.target.value));
  $('mealTomorrow').addEventListener('input', (e) => saveTomorrowMidi(e.target.value));
  $('mealInspire').addEventListener('click', () => {
    const idea = MEAL_IDEAS[Math.floor(Math.random() * MEAL_IDEAS.length)];
    if (!$('mealSoir').value) { $('mealSoir').value = idea; saveMeal('soir', idea); }
    else if (!$('mealMidi').value) { $('mealMidi').value = idea; saveMeal('midi', idea); }
    toast(idea);
  });

  // Tâches
  $('choreForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.chores.push({ id: uid(), label: $('choreLabel').value.trim() });
    $('choreLabel').value = '';
    save(); renderChores();
  });

  // Budget
  $('budgetLimit').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v >= 0) { state.budget.limit = v; save(); renderBudget(); }
    else renderBudget();
  });
  $('budgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat($('expAmount').value.replace(',', '.'));
    const label = $('expLabel').value.trim();
    if (!label) { toast('Quelle dépense ?'); return; }
    if (!isFinite(amount) || amount < 0) { toast('Montant invalide'); return; }
    state.budget.entries.push({ id: uid(), date: todayStr(), label, amount });
    $('expLabel').value = ''; $('expAmount').value = '';
    save(); renderBudget();
  });

  // Forme
  $('waterPlus').addEventListener('click', () => bumpHealth('water', 1));
  $('waterMinus').addEventListener('click', () => bumpHealth('water', -1));
  $('sleepPlus').addEventListener('click', () => bumpHealth('sleep', 0.5));
  $('sleepMinus').addEventListener('click', () => bumpHealth('sleep', -0.5));

  // Famille
  $('profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('profName').value.trim();
    if (!name) return;
    const color = PALETTE[state.profiles.length % PALETTE.length];
    const p = { id: uid(), name, color };
    state.profiles.push(p);
    state.active = p.id;
    $('profName').value = '';
    save(); render();
  });

  // Météo
  $('weatherChip').addEventListener('click', () => fetchWeather(true));

  // Google Agenda
  $('gcalToggle').addEventListener('click', () => {
    if (googleConnected()) disconnectGoogle();
    else connectGoogle();
  });
  $('gcalStatus').addEventListener('click', () => {
    if (googleConnected()) fetchGoogleEvents();
  });

  // Export / import / reset
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lessentiel-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Données exportées.');
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || s.v !== 2 || !Array.isArray(s.profiles) || !s.profiles.length) {
          toast('Fichier invalide.'); return;
        }
        if (!confirm('Remplacer les données actuelles par celles du fichier ?')) return;
        state = sanitizeState(Object.assign(defaultState(), s));
        save(); render();
        toast('Import réussi.');
      } catch (err) {
        toast('Fichier illisible.');
      }
      e.target.value = '';
    };
    reader.readAsText(f);
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Effacer TOUTES les données de cet appareil ?')) return;
    state = defaultState();
    save(); render();
    toast('Repart de zéro.');
  });
}

function bumpHealth(field, delta) {
  const h = healthOf(todayStr(), state.active);
  const min = field === 'water' ? 0 : 0;
  const max = field === 'water' ? 15 : 16;
  h[field] = Math.min(max, Math.max(min, h[field] + delta));
  save(); renderHealth();
}

/* ---------- Démarrage ---------- */

function start() {
  bind();
  render();
  setInterval(refreshClock, 30000);
  fetchWeather(false);
  if (googleConnected()) fetchGoogleEvents();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', start);
