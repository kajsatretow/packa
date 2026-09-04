const STORAGE = {
  rules: 'packa.rules.v1',
  trips: 'packa.trips.v1',
  activeTrip: 'packa.activeTrip.v1'
};

const state = {
  rules: [],
  trips: [],
  activeTripId: null,
  installPrompt: null,
  currentView: 'trip'
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function saveState() {
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
  localStorage.setItem(STORAGE.trips, JSON.stringify(state.trips));
  if (state.activeTripId) localStorage.setItem(STORAGE.activeTrip, state.activeTripId);
  else localStorage.removeItem(STORAGE.activeTrip);
}

async function loadState() {
  const storedRules = localStorage.getItem(STORAGE.rules);
  if (storedRules) {
    state.rules = JSON.parse(storedRules);
  } else {
    const response = await fetch('./default-rules.json');
    state.rules = await response.json();
    localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
  }
  state.trips = JSON.parse(localStorage.getItem(STORAGE.trips) || '[]');
  state.activeTripId = localStorage.getItem(STORAGE.activeTrip);
  if (state.activeTripId && !state.trips.some(t => t.id === state.activeTripId)) state.activeTripId = null;
}

// ----- Expression parser: deliberately small and safe; no eval/new Function. -----
class ExprParser {
  constructor(input, context) {
    this.input = String(input ?? '').trim();
    this.context = context;
    this.tokens = this.tokenize(this.input);
    this.pos = 0;
  }

  tokenize(s) {
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const two = s.slice(i, i + 2);
      if (['>=', '<=', '==', '!='].includes(two)) { tokens.push({type:'op', value:two}); i += 2; continue; }
      if ('><+-*/(),'.includes(ch)) { tokens.push({type: ch === '(' || ch === ')' || ch === ',' ? 'punct' : 'op', value:ch}); i++; continue; }
      if (ch === '"' || ch === "'") {
        const quote = ch; i++;
        let val = '';
        while (i < s.length && s[i] !== quote) {
          if (s[i] === '\\' && i + 1 < s.length) { val += s[i + 1]; i += 2; }
          else { val += s[i++]; }
        }
        if (s[i] !== quote) throw new Error('Oavslutad textsträng');
        i++;
        tokens.push({type:'string', value:val});
        continue;
      }
      if (/\d|\./.test(ch)) {
        const m = s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
        if (!m) throw new Error(`Ogiltigt tal nära "${s.slice(i, i + 8)}"`);
        tokens.push({type:'number', value:Number(m[0])}); i += m[0].length; continue;
      }
      if (/[A-Za-z_ÅÄÖåäö]/.test(ch)) {
        const m = s.slice(i).match(/^[A-Za-z_ÅÄÖåäö][A-Za-z0-9_ÅÄÖåäö]*/);
        const raw = m[0];
        const up = raw.toUpperCase();
        if (['AND','OR','NOT'].includes(up)) tokens.push({type:'op', value:up});
        else if (up === 'TRUE' || up === 'FALSE') tokens.push({type:'boolean', value:up === 'TRUE'});
        else tokens.push({type:'ident', value:raw});
        i += raw.length; continue;
      }
      throw new Error(`Okänt tecken "${ch}"`);
    }
    return tokens;
  }

  peek(value) { const t = this.tokens[this.pos]; return value ? t?.value === value : t; }
  take(value) { const t = this.tokens[this.pos]; if (!t || (value && t.value !== value)) return null; this.pos++; return t; }
  expect(value) { const t = this.take(value); if (!t) throw new Error(`Förväntade "${value}"`); return t; }

  parse() {
    if (!this.tokens.length) throw new Error('Tomt uttryck');
    const value = this.parseOr();
    if (this.pos < this.tokens.length) throw new Error(`Oväntat "${this.tokens[this.pos].value}"`);
    return value;
  }
  parseOr() { let v = this.parseAnd(); while (this.take('OR')) v = Boolean(v) || Boolean(this.parseAnd()); return v; }
  parseAnd() { let v = this.parseCompare(); while (this.take('AND')) v = Boolean(v) && Boolean(this.parseCompare()); return v; }
  parseCompare() {
    let left = this.parseAdd();
    const op = this.peek()?.value;
    if (['==','!=','>','>=','<','<='].includes(op)) {
      this.pos++;
      const right = this.parseAdd();
      return ({'==':()=>left===right,'!=':()=>left!==right,'>':()=>left>right,'>=':()=>left>=right,'<':()=>left<right,'<=':()=>left<=right}[op])();
    }
    return left;
  }
  parseAdd() {
    let v = this.parseMul();
    while (['+','-'].includes(this.peek()?.value)) {
      const op = this.tokens[this.pos++].value, r = this.parseMul();
      v = op === '+' ? Number(v) + Number(r) : Number(v) - Number(r);
    }
    return v;
  }
  parseMul() {
    let v = this.parseUnary();
    while (['*','/'].includes(this.peek()?.value)) {
      const op = this.tokens[this.pos++].value, r = this.parseUnary();
      v = op === '*' ? Number(v) * Number(r) : Number(v) / Number(r);
    }
    return v;
  }
  parseUnary() {
    if (this.take('NOT')) return !Boolean(this.parseUnary());
    if (this.take('-')) return -Number(this.parseUnary());
    return this.parsePrimary();
  }
  parsePrimary() {
    const t = this.peek();
    if (!t) throw new Error('Uttrycket tog slut för tidigt');
    if (this.take('(')) { const v = this.parseOr(); this.expect(')'); return v; }
    if (t.type === 'number' || t.type === 'string' || t.type === 'boolean') { this.pos++; return t.value; }
    if (t.type === 'ident') {
      this.pos++;
      const name = t.value;
      if (this.take('(')) {
        const args = [];
        if (!this.peek(')')) {
          args.push(this.parseOr());
          while (this.take(',')) args.push(this.parseOr());
        }
        this.expect(')');
        const fn = this.context.functions?.[name];
        if (!fn) throw new Error(`Okänd funktion: ${name}`);
        return fn(...args);
      }
      if (!(name in this.context.vars)) throw new Error(`Okänd variabel: ${name}`);
      const v = this.context.vars[name];
      if (v === undefined || v === null) throw new Error(`Saknar värde för ${name}`);
      return v;
    }
    throw new Error(`Oväntat "${t.value}"`);
  }
}

function evaluateExpression(expr, context) { return new ExprParser(expr, context).parse(); }

function weekdayNamesBetween(start, end) {
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const set = new Set();
  const d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`);
  while (d <= last) { set.add(names[d.getDay()]); d.setDate(d.getDate() + 1); }
  return set;
}
function nightsBetween(start, end) {
  const a = new Date(`${start}T12:00:00`), b = new Date(`${end}T12:00:00`);
  return Math.round((b - a) / 86400000);
}
function seasonFor(dateStr) {
  const m = Number(dateStr.slice(5,7));
  if ([6,7,8].includes(m)) return 'summer';
  if ([9,10,11].includes(m)) return 'autumn';
  if ([12,1,2].includes(m)) return 'winter';
  return 'spring';
}

function contextForTrip(trip) {
  const weekdays = weekdayNamesBetween(trip.departureDate, trip.returnDate);
  const weather = trip.weather || {};
  return {
    vars: {
      always: true,
      nights: trip.nights,
      destination: trip.destination,
      abroad: trip.abroad,
      season: seasonFor(trip.departureDate),
      transport_mode: trip.transportMode,
      travel_hours: trip.travelHours,
      accommodation: trip.accommodation,
      accommodation_type: trip.accommodation,
      linens_provided: trip.linensProvided,
      period: trip.period,
      fertile_days: trip.fertileDays,
      min_day_temp: weather.available ? weather.minDayTemp : null,
      max_day_temp: weather.available ? weather.maxDayTemp : null,
      // Backwards-compatible aliases: both are based on daily daytime highs, never nightly lows.
      min_temp: weather.available ? weather.minDayTemp : null,
      max_temp: weather.available ? weather.maxDayTemp : null,
      rainy: weather.available ? weather.rainy : null,
      sunny: weather.available ? weather.sunny : null
    },
    functions: {
      activity: name => trip.activities.includes(String(name)),
      traveler: name => trip.travelers.includes(String(name)),
      trip_has_weekday: day => weekdays.has(String(day)),
      ceil: n => Math.ceil(Number(n)),
      floor: n => Math.floor(Number(n)),
      round: n => Math.round(Number(n)),
      min: (...xs) => Math.min(...xs.map(Number)),
      max: (...xs) => Math.max(...xs.map(Number))
    }
  };
}

function conditionNeedsWeather(expr) { return /\b(min_day_temp|max_day_temp|min_temp|max_temp|rainy|sunny)\b/.test(expr); }

async function resolveDestinationAndWeather(destination, startDate, endDate) {
  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.search = new URLSearchParams({name: destination, count: '5', language: 'sv', format: 'json'});
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error('Kunde inte slå upp destinationen.');
  const geo = await geoRes.json();
  if (!geo.results?.length) throw new Error('Hittade inte destinationen. Prova t.ex. ort + land.');
  const place = geo.results[0];
  const abroad = place.country_code ? place.country_code !== 'SE' : false;
  const resolvedName = [place.name, place.admin1, place.country].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(', ');

  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(`${startDate}T00:00:00`);
  const daysAhead = Math.floor((start - today) / 86400000);
  let weather = {available:false, reason:''};

  if (daysAhead > 15) {
    weather.reason = 'Resan ligger utanför väderprognosens räckvidd.';
  } else if (daysAhead < -92) {
    weather.reason = 'Resan ligger för långt bak i tiden för den här vyn.';
  } else {
    try {
      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
      forecastUrl.search = new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        daily: 'temperature_2m_max,precipitation_sum,precipitation_probability_max,weather_code',
        timezone: 'auto',
        start_date: startDate,
        end_date: endDate
      });
      const wr = await fetch(forecastUrl);
      if (!wr.ok) throw new Error('Väderprognosen gick inte att hämta.');
      const w = await wr.json();
      const dailyMaxes = (w.daily?.temperature_2m_max || []).filter(Number.isFinite);
      const precip = (w.daily?.precipitation_sum || []).filter(Number.isFinite);
      const probs = (w.daily?.precipitation_probability_max || []).filter(Number.isFinite);
      const codes = (w.daily?.weather_code || []).filter(Number.isFinite);
      if (dailyMaxes.length) {
        weather = {
          available: true,
          // Temperature rules use each day's forecast high, so nighttime lows never affect packing.
          minDayTemp: Math.min(...dailyMaxes),
          maxDayTemp: Math.max(...dailyMaxes),
          rainy: precip.some(v => v >= 0.5) || probs.some(v => v >= 50),
          sunny: codes.some(c => [0,1,2].includes(c)),
          days: w.daily?.time || []
        };
      } else weather.reason = 'Ingen prognos fanns för resans datum.';
    } catch (err) {
      weather = {available:false, reason: err.message || 'Väderprognosen gick inte att hämta.'};
    }
  }

  return {place, resolvedName, abroad, weather};
}

function generateItems(trip) {
  const ctx = contextForTrip(trip);
  const items = [];
  const skippedWeather = [];
  const errors = [];

  for (const rule of state.rules) {
    if (rule.person === 'Isolde' && !trip.travelers.includes('Isolde')) continue;
    if (!trip.weather?.available && conditionNeedsWeather(rule.when)) { skippedWeather.push(rule); continue; }
    try {
      const include = Boolean(evaluateExpression(rule.when || 'always', ctx));
      if (!include) continue;
      const qtyRaw = evaluateExpression(rule.quantity || '1', ctx);
      const quantity = Math.max(0, Number(qtyRaw));
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      items.push({
        id: `rule:${rule.id}`,
        ruleId: rule.id,
        item: rule.item,
        person: rule.person,
        where: rule.where || 'Övrigt',
        quantity,
        checked: false,
        extra: false
      });
    } catch (err) {
      errors.push(`${rule.item}: ${err.message}`);
    }
  }
  return {items, skippedWeather, errors};
}

function activeTrip() { return state.trips.find(t => t.id === state.activeTripId) || null; }
function upsertTrip(trip) {
  const i = state.trips.findIndex(t => t.id === trip.id);
  if (i >= 0) state.trips[i] = trip; else state.trips.unshift(trip);
  state.activeTripId = trip.id;
  saveState();
}

function showView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.nav-button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'list') renderPackingList();
  if (view === 'settings') renderRules();
  if (view === 'trip') renderRecentTrips();
  window.scrollTo({top:0, behavior:'instant'});
}

function formatAccommodation(v) { return ({hotel:'Hotell', cabin_airbnb:'Stuga/Airbnb', home:'Hemma hos'})[v] || v; }
function formatDateRange(a,b) {
  const f = new Intl.DateTimeFormat('sv-SE', {day:'numeric', month:'short'});
  return `${f.format(new Date(`${a}T12:00:00`))}–${f.format(new Date(`${b}T12:00:00`))}`;
}

function fillFormFromTrip(trip) {
  if (!trip) return;
  $('#destination').value = trip.destination || '';
  $('#departureDate').value = trip.departureDate || '';
  $('#returnDate').value = trip.returnDate || '';
  $$('input[name=travelers]').forEach(x => x.checked = trip.travelers?.includes(x.value));
  $('#accommodation').value = trip.accommodation || '';
  updateLinensVisibility();
  if (trip.accommodation === 'cabin_airbnb') $('#linensProvided').value = String(Boolean(trip.linensProvided));
  $('#transportMode').value = trip.transportMode || '';
  $('#travelHours').value = trip.travelHours ?? '';
  $$('input[name=activities]').forEach(x => x.checked = trip.activities?.includes(x.value));
  $('#period').checked = Boolean(trip.period);
  $('#fertileDays').checked = Boolean(trip.fertileDays);
  $('#destinationHint').textContent = trip.resolvedDestination || '';
}

function updateLinensVisibility() {
  const cabin = $('#accommodation').value === 'cabin_airbnb';
  $('#linensField').classList.toggle('hidden', !cabin);
  $('#linensProvided').required = cabin;
  if (!cabin) $('#linensProvided').value = '';
}

async function handleTripSubmit(event) {
  event.preventDefault();
  $('#formError').classList.add('hidden');
  const button = $('#generateButton');
  const status = $('#generateStatus');
  const start = $('#departureDate').value, end = $('#returnDate').value;
  const nights = nightsBetween(start, end);
  if (nights < 0) return showFormError('Hemkomst kan inte vara före avresa.');
  if ($('#accommodation').value === 'cabin_airbnb' && $('#linensProvided').value === '') return showFormError('Ange om lakan och handdukar ingår.');

  button.disabled = true;
  status.textContent = 'Slår upp destination och väder…';
  try {
    const destination = $('#destination').value.trim();
    const resolved = await resolveDestinationAndWeather(destination, start, end);
    const previous = activeTrip();
    const editingSame = previous && $('#tripForm').dataset.editingId === previous.id;
    const trip = {
      id: editingSame ? previous.id : uid(),
      createdAt: editingSame ? previous.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      destination,
      resolvedDestination: resolved.resolvedName,
      countryCode: resolved.place.country_code || null,
      abroad: resolved.abroad,
      departureDate: start,
      returnDate: end,
      nights,
      travelers: $$('input[name=travelers]:checked').map(x => x.value),
      accommodation: $('#accommodation').value,
      linensProvided: $('#accommodation').value === 'cabin_airbnb' ? $('#linensProvided').value === 'true' : true,
      transportMode: $('#transportMode').value,
      travelHours: Number($('#travelHours').value),
      activities: $$('input[name=activities]:checked').map(x => x.value),
      period: $('#period').checked,
      fertileDays: $('#fertileDays').checked,
      weather: resolved.weather,
      items: [],
      manualItems: editingSame ? (previous.manualItems || []) : []
    };
    const generated = generateItems(trip);
    const oldChecks = editingSame ? Object.fromEntries((previous.items || []).map(i => [i.id, i.checked])) : {};
    trip.items = generated.items.map(i => ({...i, checked: Boolean(oldChecks[i.id])}));
    trip.ruleErrors = generated.errors;
    trip.weatherSkippedCount = generated.skippedWeather.length;
    upsertTrip(trip);
    $('#tripForm').dataset.editingId = '';
    showView('list');
  } catch (err) {
    showFormError(err.message || 'Något gick fel.');
  } finally {
    button.disabled = false;
    status.textContent = '';
  }
}
function showFormError(msg) { const el=$('#formError'); el.textContent=msg; el.classList.remove('hidden'); }

function renderPackingList() {
  const trip = activeTrip();
  const list = $('#packingList');
  if (!trip) {
    $('#tripMeta').textContent = '';
    list.innerHTML = '<div class="card" style="padding:18px">Skapa en resa först.</div>';
    $('#weatherSummary').classList.add('hidden');
    $('#packingProgress').classList.add('hidden');
    return;
  }
  $('#tripMeta').textContent = `${trip.destination.toUpperCase()} · ${formatDateRange(trip.departureDate, trip.returnDate)} · ${trip.nights} ${trip.nights === 1 ? 'natt' : 'nätter'}`;
  renderWeather(trip);

  const allItems = [...(trip.items || []), ...(trip.manualItems || [])];
  const groups = new Map();
  allItems.forEach(item => {
    const key = item.where || 'Övrigt';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const preferredOrder = ['Garderoben','Byrån','Badrummet','Sovrummet','Isoldes rum','Köket','Hallen','Övrigt'];
  const ordered = [...groups.entries()].sort(([a],[b]) => {
    const ia = preferredOrder.indexOf(a), ib = preferredOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'sv');
  });

  list.innerHTML = ordered.map(([where, items]) => `
    <section class="pack-group">
      <h3>${escapeHtml(where)}</h3>
      ${items.map(item => `
        <label class="pack-item ${item.checked ? 'checked' : ''}" data-item-id="${escapeHtml(item.id)}">
          <input type="checkbox" ${item.checked ? 'checked' : ''} />
          <span class="item-main">
            <span class="item-name">${escapeHtml(item.item)}</span>
            <span class="item-meta"><span class="badge">${escapeHtml(item.person)}</span>${item.extra ? '<span class="badge">Extra</span>' : ''}</span>
          </span>
          ${item.extra ? '<button class="remove-extra" type="button" aria-label="Ta bort">×</button>' : `<span class="quantity">${item.quantity > 1 ? `×${escapeHtml(formatQuantity(item.quantity))}` : ''}</span>`}
        </label>`).join('')}
    </section>`).join('');

  $$('.pack-item input[type=checkbox]', list).forEach(cb => cb.addEventListener('change', e => {
    const row = e.target.closest('.pack-item');
    setItemChecked(trip, row.dataset.itemId, e.target.checked);
    row.classList.toggle('checked', e.target.checked);
    renderProgress(trip);
  }));
  $$('.remove-extra', list).forEach(btn => btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const id = e.target.closest('.pack-item').dataset.itemId;
    trip.manualItems = (trip.manualItems || []).filter(i => i.id !== id);
    upsertTrip(trip); renderPackingList();
  }));
  renderProgress(trip);
  populateWhereOptions();
}

function formatQuantity(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace('.', ','); }
function setItemChecked(trip, id, checked) {
  let item = (trip.items || []).find(i => i.id === id);
  if (!item) item = (trip.manualItems || []).find(i => i.id === id);
  if (item) { item.checked = checked; trip.updatedAt = new Date().toISOString(); upsertTrip(trip); }
}
function renderProgress(trip) {
  const all = [...(trip.items || []), ...(trip.manualItems || [])];
  const done = all.filter(i => i.checked).length;
  const el = $('#packingProgress');
  el.classList.toggle('hidden', !all.length);
  el.textContent = all.length ? (done === all.length ? `Klart! ${done} av ${all.length} packade.` : `${done} av ${all.length} packade`) : '';
}
function renderWeather(trip) {
  const el = $('#weatherSummary');
  if (trip.weather?.available) {
    const minDay = trip.weather.minDayTemp ?? trip.weather.minTemp;
    const maxDay = trip.weather.maxDayTemp ?? trip.weather.maxTemp;
    el.innerHTML = `<span class="weather-pill">${Math.round(minDay)}–${Math.round(maxDay)}°C dagshögsta</span><span class="weather-pill">${trip.weather.rainy ? 'Regn möjligt' : 'Ingen tydlig regnsignal'}</span><span class="weather-pill">${escapeHtml(formatAccommodation(trip.accommodation))}</span>${trip.abroad ? '<span class="weather-pill">Utomlands</span>' : ''}`;
    el.classList.remove('hidden');
  } else {
    const skipped = trip.weatherSkippedCount || 0;
    el.innerHTML = `<span class="weather-pill">Väder saknas${skipped ? ` · ${skipped} väderregler väntar` : ''}</span><span class="weather-pill">${escapeHtml(formatAccommodation(trip.accommodation))}</span>`;
    el.classList.remove('hidden');
  }
}

function handleExtraItem(event) {
  event.preventDefault();
  const trip = activeTrip(); if (!trip) return;
  const name = $('#extraItemName').value.trim(); if (!name) return;
  trip.manualItems ||= [];
  trip.manualItems.push({id:`extra:${uid()}`, item:name, person:$('#extraItemPerson').value, where:$('#extraItemWhere').value || 'Övrigt', quantity:1, checked:false, extra:true});
  upsertTrip(trip); event.target.reset(); populateWhereOptions(); renderPackingList();
}

function populateWhereOptions() {
  const select = $('#extraItemWhere');
  const values = [...new Set(state.rules.map(r => r.where).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'sv'));
  if (!values.includes('Övrigt')) values.push('Övrigt');
  const current = select.value;
  select.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}

function renderRecentTrips() {
  const container = $('#recentTrips'), section = $('#recentTripsSection');
  if (!state.trips.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  container.innerHTML = [...state.trips].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,8).map(t => `
    <article class="recent-trip" data-id="${t.id}">
      <button class="open-trip" type="button"><strong>${escapeHtml(t.destination)}</strong><small>${escapeHtml(formatDateRange(t.departureDate,t.returnDate))} · ${t.nights} ${t.nights===1?'natt':'nätter'}</small></button>
      <button class="icon-button delete-trip" type="button" aria-label="Ta bort resa">×</button>
    </article>`).join('');
  $$('.open-trip', container).forEach(b => b.addEventListener('click', e => { state.activeTripId=e.target.closest('.recent-trip').dataset.id; saveState(); showView('list'); }));
  $$('.delete-trip', container).forEach(b => b.addEventListener('click', e => {
    const id=e.target.closest('.recent-trip').dataset.id;
    if (!confirm('Ta bort den sparade resan?')) return;
    state.trips=state.trips.filter(t=>t.id!==id); if(state.activeTripId===id) state.activeTripId=null; saveState(); renderRecentTrips();
  }));
}

function editActiveTrip() {
  const trip=activeTrip(); if(!trip) return showView('trip');
  fillFormFromTrip(trip); $('#tripForm').dataset.editingId=trip.id; showView('trip');
}

// ----- Settings -----
function renderRules() {
  const list = $('#rulesList');
  const q = $('#ruleSearch').value.trim().toLowerCase();
  const filtered = state.rules.filter(r => !q || [r.item,r.person,r.when,r.quantity,r.where].some(v => String(v||'').toLowerCase().includes(q)));
  list.innerHTML='';
  const tpl=$('#ruleTemplate');
  for(const rule of filtered){
    const node=tpl.content.firstElementChild.cloneNode(true); node.dataset.id=rule.id;
    $('.rule-item',node).value=rule.item; $('.rule-person',node).value=rule.person; $('.rule-where',node).value=rule.where; $('.rule-when',node).value=rule.when; $('.rule-quantity',node).value=rule.quantity;
    ['.rule-item','.rule-person','.rule-where','.rule-when','.rule-quantity'].forEach(sel => $(sel,node).addEventListener('change',()=>updateRuleFromCard(node)));
    $('.rule-when',node).addEventListener('input',()=>validateRuleCard(node));
    $('.rule-quantity',node).addEventListener('input',()=>validateRuleCard(node));
    $('.delete-rule',node).addEventListener('click',()=>{ if(confirm(`Ta bort ${rule.item}?`)){ state.rules=state.rules.filter(r=>r.id!==rule.id); saveState(); renderRules(); }});
    list.appendChild(node); validateRuleCard(node);
  }
  validateAllRules();
}
function updateRuleFromCard(card){
  const r=state.rules.find(x=>x.id===card.dataset.id); if(!r)return;
  r.item=$('.rule-item',card).value.trim(); r.person=$('.rule-person',card).value; r.where=$('.rule-where',card).value.trim()||'Övrigt'; r.when=$('.rule-when',card).value.trim()||'always'; r.quantity=$('.rule-quantity',card).value.trim()||'1'; saveState(); validateRuleCard(card); validateAllRules();
}
function validationContext(){
  return {vars:{always:true,nights:3,destination:'Lund',abroad:false,season:'summer',transport_mode:'car',travel_hours:4,accommodation:'hotel',accommodation_type:'hotel',linens_provided:true,period:false,fertile_days:false,min_day_temp:10,max_day_temp:22,min_temp:10,max_temp:22,rainy:false,sunny:true},functions:{activity:()=>false,traveler:()=>false,trip_has_weekday:()=>false,ceil:Math.ceil,floor:Math.floor,round:Math.round,min:Math.min,max:Math.max}};
}
function validateRule(rule){
  const errors=[]; try{ evaluateExpression(rule.when||'always',validationContext()); }catch(e){ errors.push(`When: ${e.message}`); }
  try{ const q=evaluateExpression(rule.quantity||'1',validationContext()); if(!Number.isFinite(Number(q))) errors.push('Quantity måste ge ett tal'); }catch(e){ errors.push(`Quantity: ${e.message}`); }
  return errors;
}
function validateRuleCard(card){
  const rule={when:$('.rule-when',card).value,quantity:$('.rule-quantity',card).value}; const errors=validateRule(rule); const el=$('.rule-error',card); el.textContent=errors.join(' · '); el.classList.toggle('hidden',!errors.length); card.style.borderColor=errors.length?'#d69a94':''; return errors;
}
function validateAllRules(){
  const bad=state.rules.map(r=>({r,e:validateRule(r)})).filter(x=>x.e.length); const el=$('#ruleValidationSummary');
  if(bad.length){ el.textContent=`${bad.length} ${bad.length===1?'regel har':'regler har'} fel. De hoppas över när en packlista genereras.`; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}
function addRule(){
  const rule={id:`custom:${uid()}`,item:'Ny sak',person:'Kajsa',when:'always',quantity:'1',where:'Övrigt'}; state.rules.unshift(rule); saveState(); $('#ruleSearch').value=''; renderRules(); $('#rulesList .rule-item')?.focus();
}
async function resetRules(){
  if(!confirm('Återställa hela masterlistan till standard? Dina regeländringar försvinner.'))return;
  const response=await fetch('./default-rules.json',{cache:'no-store'}); state.rules=await response.json(); saveState(); renderRules();
}

function registerInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt=e; $('#installButton').classList.remove('hidden'); });
  $('#installButton').addEventListener('click', async()=>{ if(!state.installPrompt)return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt=null; $('#installButton').classList.add('hidden'); });
}

function bindEvents(){
  $$('.nav-button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('#accommodation').addEventListener('change',updateLinensVisibility);
  $('#tripForm').addEventListener('submit',handleTripSubmit);
  $('#extraItemForm').addEventListener('submit',handleExtraItem);
  $('#editTripButton').addEventListener('click',editActiveTrip);
  $('#addRuleButton').addEventListener('click',addRule);
  $('#ruleSearch').addEventListener('input',renderRules);
  $('#resetRulesButton').addEventListener('click',resetRules);
}

async function init(){
  await loadState(); bindEvents(); registerInstall(); populateWhereOptions(); renderRecentTrips();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

document.addEventListener('DOMContentLoaded',init);
