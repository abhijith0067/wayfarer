/* Wayfarer — phone-first travel companion (prototype).
   Free, keyless sources called from the browser:
   Nominatim (geocoding) · Overpass / Photon + OSM API (places, tags, bus routes)
   Open-Meteo (weather) · Wikipedia / Wikidata / Wikimedia Commons (history, photos).
   Ticketmaster is optional (user-supplied free key). */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OSM_API = 'https://api.openstreetmap.org/api/0.6';

const STATE_LANG = {
  kerala: 'ml', lakshadweep: 'ml', 'tamil nadu': 'ta', puducherry: 'ta', karnataka: 'kn', 'andhra pradesh': 'te', telangana: 'te',
  maharashtra: 'mr', goa: 'kn', 'west bengal': 'bn', gujarat: 'gu', punjab: 'pa', odisha: 'or', assam: 'as',
  delhi: 'hi', 'uttar pradesh': 'hi', rajasthan: 'hi', 'madhya pradesh': 'hi', bihar: 'hi', uttarakhand: 'hi', 'himachal pradesh': 'hi',
};
const COUNTRY_LANG = {
  in: 'hi', pt: 'pt', es: 'es', fr: 'fr', de: 'de', it: 'it', jp: 'ja', cn: 'zh', kr: 'ko', th: 'th', vn: 'vi', id: 'id',
  ru: 'ru', nl: 'nl', tr: 'tr', gr: 'el', br: 'pt', mx: 'es', ar: 'es', ae: 'ar', sa: 'ar', eg: 'ar', lk: 'si', np: 'ne',
  bd: 'bn', pk: 'ur', my: 'ms', pl: 'pl', se: 'sv', no: 'no', dk: 'da', fi: 'fi', cz: 'cs', hu: 'hu', at: 'de', ch: 'de', be: 'nl',
};
const LANG_NAME = { ml: 'Malayalam', ta: 'Tamil', kn: 'Kannada', te: 'Telugu', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati',
  pa: 'Punjabi', or: 'Odia', hi: 'Hindi', as: 'Assamese', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ru: 'Russian',
  nl: 'Dutch', tr: 'Turkish', el: 'Greek', ar: 'Arabic', si: 'Sinhala', ne: 'Nepali', ur: 'Urdu', ms: 'Malay', pl: 'Polish',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian' };
const COUNTRY_CUISINE = { in: 'indian|kerala|south_indian|north_indian|regional|thali|biryani|dosa', pt: 'portuguese', es: 'spanish|tapas',
  it: 'italian|pizza', fr: 'french', jp: 'japanese|ramen|sushi|udon', th: 'thai', vn: 'vietnamese|pho', gr: 'greek', tr: 'turkish|kebab',
  mx: 'mexican', cn: 'chinese', kr: 'korean', id: 'indonesian', my: 'malaysian', lk: 'sri_lankan' };

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'],
  81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'],
};

const state = {
  lat: null, lon: null, place: {}, tab: 'welcome',
  sights: [], eats: [], transit: [], venues: [], wiki: [], photos: [],
  osmSource: '', loadingPlaces: false,
  seeCat: 'all',
  eat: { type: 'all', cuisine: null, moods: new Set(), sort: 'near' },
};
const maps = {};

/* ---------------- helpers ---------------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const walkMin = (m) => Math.max(1, Math.round(m / 80));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const nameOf = (t) => t['name:en'] || t.name || '';
const localNameOf = (t) => { const l = state.place.lang; const n = l && t[`name:${l}`]; return n && n !== t.name && n !== t['name:en'] ? n : ''; };

/** Google Maps directions: walking if close, otherwise public transport. */
function directions(lat, lon, name, d) {
  const mode = d != null && d < 1200 ? 'walking' : 'transit';
  return `https://www.google.com/maps/dir/?api=1&origin=${state.lat},${state.lon}&destination=${lat},${lon}&travelmode=${mode}`;
}
const mapsSearch = (name, lat, lon) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat},${lon}`)}`;

async function getJSON(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');

/* ---------- photos ---------- */
function commonsUrl(file, w = 480) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/^File:/i, ''))}?width=${w}`;
}
function imageFromTags(t) {
  if (t.wikimedia_commons && /^File:/i.test(t.wikimedia_commons)) return commonsUrl(t.wikimedia_commons);
  const im = t.image;
  if (im && /^https:\/\//.test(im)) {
    const m = im.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i);
    if (m) return commonsUrl(decodeURIComponent(m[1]));
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(im)) return im;
  }
  return null;
}
const GENERIC = new Set(['cafe', 'restaurant', 'hotel', 'the', 'and', 'of', 'de', 'da', 'del', 'la', 'le', 'st', 'saint', 'shop', 'house',
  'kitchen', 'bakery', 'coffee', 'tea', 'bar', 'pub', 'bus', 'stop', 'station', 'new', 'old', 'park', 'road', 'street', 'india', 'kerala',
  'temple', 'church', 'mosque', 'museum', 'beach', 'fort']);
const PLACE_WORDS = /church|temple|tomb|basilica|mosque|synagogue|cathedral|museum|palace|fort\b|beach|altar|interior|bridge/;
/** Find a Commons photo taken near this place whose file name mentions it. */
function matchPhoto(name, lat, lon, maxD) {
  const n = norm(name);
  const city = norm(state.place.city);
  let tokens = n.split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w) && w !== city);
  // all-generic names like "Fort Kochi Beach": require the whole phrase instead
  if (!tokens.length && n.length >= 8 && n.includes(' ')) tokens = [n];
  if (!tokens.length || tokens.join('').length < 5) return null;
  let best = null;
  for (const p of state.photos) {
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d > maxD || (best && d >= best.d)) continue;
    if (!tokens.every((w) => p.norm.includes(w))) continue;
    // don't give a café the church photo just because they share a name
    const extra = (p.norm.match(PLACE_WORDS) || [])[0];
    if (extra && !n.includes(extra)) continue;
    best = { ...p, d };
  }
  return best ? commonsUrl(best.title, 480) : null;
}
const PH = { cafe: '☕', restaurant: '🍛', fast: '🥙', bakery: '🥐', tea: '🍵', museum: '🏛️', history: '🏰', worship: '🛕', nature: '🌴', view: '🌅', attraction: '📍', bar: '🍸', culture: '🎭' };
function imgHTML(url, kind, cls = 'img') {
  const ph = `<div class="${cls} ph-img">${PH[kind] || '📍'}</div>`;
  if (!url) return ph;
  return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.ph" data-ph="${esc(ph)}">`;
}

/* ---------------- location ---------------- */
const reverseGeocode = (lat, lon) => getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=en`);
const searchPlace = (q) => getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=5&addressdetails=1&accept-language=en`);

function placeFromAddress(addr = {}) {
  const locality = addr.suburb || addr.neighbourhood || addr.quarter || addr.village || addr.town || addr.city_district;
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district;
  const cc = (addr.country_code || '').toLowerCase();
  const lang = (cc === 'in' && STATE_LANG[(addr.state || '').toLowerCase()]) || COUNTRY_LANG[cc] || null;
  return { locality, city, state: addr.state, country: addr.country, cc, lang };
}

async function setLocation(lat, lon, label) {
  state.lat = +lat; state.lon = +lon;
  $$('.search-results').forEach((b) => { b.innerHTML = ''; });
  if ($('#locSheet').open) $('#locSheet').close();
  $('#bottomNav').hidden = false;
  $('#placeName').textContent = label ? label.split(',')[0] : 'Your location';
  $('#placeSub').textContent = 'Finding where you are…';
  Object.values(maps).forEach((m) => m.remove());
  Object.keys(maps).forEach((k) => delete maps[k]);
  $$('.map-slot').forEach((s) => { s.innerHTML = ''; });
  switchTab(state.tab === 'welcome' ? 'today' : state.tab);
  try {
    state.place = placeFromAddress((await reverseGeocode(lat, lon)).address);
  } catch { state.place = { city: label } }
  const p = state.place;
  $('#placeName').textContent = p.locality || p.city || $('#placeName').textContent;
  $('#placeSub').textContent = [p.locality && p.city !== p.locality ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
  store.set('lastLoc', JSON.stringify({ lat, lon }));
  refreshAll();
}

function refreshAll() {
  loadWeather();
  loadAbout();
  loadPlaces();
}

function useGPS() {
  if (!navigator.geolocation) { alert('Location not available — search a place instead.'); return; }
  $$('.gps-btn').forEach((b) => { b.textContent = '📍 Locating…'; });
  navigator.geolocation.getCurrentPosition(
    (pos) => { $$('.gps-btn').forEach((b) => { b.textContent = '📍 Use my location'; }); setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { $$('.gps-btn').forEach((b) => { b.textContent = '📍 Use my location'; }); alert(`Couldn't get your location (${err.message}). Search a place instead.`); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

/* ---------------- tabs & maps ---------------- */
function switchTab(tab) {
  state.tab = tab;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.tab === tab));
  $$('#bottomNav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view').scrollTop = 0;
  if (maps[tab]) setTimeout(() => maps[tab].invalidateSize(), 50);
}

function toggleMap(which) {
  const slot = $(`.map-slot[data-slot="${which}"]`);
  if (slot.innerHTML) { maps[which]?.remove(); delete maps[which]; slot.innerHTML = ''; return; }
  if (typeof L === 'undefined') { slot.innerHTML = '<p class="err small">Map library failed to load.</p>'; return; }
  slot.innerHTML = `<div class="map" id="map-${which}"></div>`;
  const m = L.map(`map-${which}`, { zoomControl: false }).setView([state.lat, state.lon], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  L.circleMarker([state.lat, state.lon], { radius: 8, color: '#0f766e', fillOpacity: 0.9 }).addTo(m).bindPopup('You are here');
  const items = which === 'see' ? filteredSights() : which === 'eat' ? filteredEats() : state.transit.filter((e) => e.mode);
  const color = which === 'see' ? '#7c3aed' : which === 'eat' ? '#c2410c' : '#2563eb';
  const pts = [[state.lat, state.lon]];
  items.slice(0, 60).forEach((e) => {
    L.circleMarker([e.lat, e.lon], { radius: 6, color, weight: 2, fillOpacity: 0.7 }).addTo(m).bindPopup(esc(nameOf(e.t) || e.mode?.label || ''));
    pts.push([e.lat, e.lon]);
  });
  if (pts.length > 1) m.fitBounds(pts.slice(0, 25), { padding: [20, 20], maxZoom: 16 });
  maps[which] = m;
}

/* ---------------- weather (Open-Meteo) ---------------- */
async function loadWeather() {
  const box = $('#weatherBox');
  box.innerHTML = '<div class="card wx"><div class="loading" style="color:#fff">Checking the sky…</div></div>';
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset'
    + '&timezone=auto&forecast_days=4';
  try {
    const w = await getJSON(u);
    const c = w.current, d = w.daily;
    const [desc, icon] = WMO[c.weather_code] || ['—', '🌡️'];
    const tips = [];
    if ((d.precipitation_probability_max[0] ?? 0) >= 60) tips.push('Rain likely — museums & covered markets today; carry an umbrella.');
    if (c.apparent_temperature >= 34) tips.push('Very hot — sightsee early or after 4 pm, stay hydrated.');
    if ((d.uv_index_max[0] ?? 0) >= 8) tips.push('UV very high — sunscreen & hat.');
    if (c.apparent_temperature <= 5) tips.push('Cold — layer up.');
    const hm = (s) => s.slice(11, 16);
    box.innerHTML = `<div class="card wx">
      <div class="now"><span style="font-size:48px">${icon}</span>
        <div><div class="big">${Math.round(c.temperature_2m)}°</div>
        <div class="desc">${desc} · feels ${Math.round(c.apparent_temperature)}° · ${c.relative_humidity_2m}% humid · wind ${Math.round(c.wind_speed_10m)} km/h</div></div></div>
      ${tips.length ? `<div class="tip">💡 ${tips.join(' ')}</div>` : ''}
      <div class="days">${d.time.map((t, i) => {
        const day = i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
        return `<div>${day}<br><span style="font-size:20px">${(WMO[d.weather_code[i]] || ['', ''])[1]}</span><br>${Math.round(d.temperature_2m_max[i])}°/${Math.round(d.temperature_2m_min[i])}°<br><span style="opacity:.8">💧${d.precipitation_probability_max[i] ?? 0}%</span></div>`;
      }).join('')}</div>
      <div class="sun">🌅 ${hm(d.sunrise[0])} · 🌇 ${hm(d.sunset[0])} · UV ${d.uv_index_max[0] ?? '—'}</div>
    </div>`;
  } catch (e) { box.innerHTML = `<div class="card"><p class="err">Weather unavailable (${esc(e.message)}).</p></div>`; }
}

/* ---------------- about & stories (Wikipedia / Wikidata) ---------------- */
const wikiSummary = (lang, title) => getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
function claimVal(ent, p) {
  const c = ent.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
  if (c == null) return null;
  if (c.time) { const y = parseInt(c.time.slice(0, 5), 10); return y < 0 ? `${-y} BCE` : `${y}`; }
  if (c.amount) return Number(c.amount).toLocaleString();
  if (c.text) return c.text;
  return null;
}

async function loadAbout() {
  const box = $('#aboutBox');
  box.innerHTML = `<div class="card">${skeleton(2)}</div>`;
  const p = state.place;
  const city = p.city || p.locality;
  let s = null;
  for (const t of [city, `${city}, ${p.state || ''}`].filter(Boolean)) {
    try { s = await wikiSummary('en', t); if (s.type !== 'disambiguation') break; s = null; } catch {}
  }
  if (!s) { box.innerHTML = '<div class="card"><p class="muted">No Wikipedia article found for this town.</p></div>'; return; }
  let html = `<div class="card"><div class="section-title" style="margin-top:0">About ${esc(s.title)}</div>
    ${s.originalimage || s.thumbnail ? `<img class="about-img" src="${esc((s.thumbnail || s.originalimage).source.replace(/\/\d+px-/, '/640px-'))}" alt="" onerror="this.remove()">` : ''}
    ${s.description ? `<div class="muted small">${esc(s.description)}</div>` : ''}
    <p class="clamp" id="aboutText">${esc(s.extract)}</p>
    <a href="#" onclick="document.getElementById('aboutText').classList.toggle('clamp');return false">More / less</a> ·
    <a href="${esc(s.content_urls?.desktop?.page)}" target="_blank" rel="noopener">Wikipedia</a>`;
  if (s.wikibase_item) {
    try {
      const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${s.wikibase_item}.json`);
      const ent = j.entities[s.wikibase_item];
      const facts = [['Founded', claimVal(ent, 'P571')], ['Population', claimVal(ent, 'P1082')],
        ['Elevation', claimVal(ent, 'P2044') && `${claimVal(ent, 'P2044')} m`], ['Area', claimVal(ent, 'P2046') && `${claimVal(ent, 'P2046')} km²`],
        ['Nickname', claimVal(ent, 'P1449')]].filter(([, v]) => v).slice(0, 3);
      if (facts.length) html += `<div class="facts">${facts.map(([k, v]) => `<div>${k}<b>${esc(v)}</b></div>`).join('')}</div>`;
      const lang = p.lang;
      const site = lang && lang !== 'en' && ent.sitelinks?.[`${lang}wiki`]?.title;
      if (site) {
        try {
          const ls = await wikiSummary(lang, site);
          html += `<div class="local" lang="${lang}"><div class="small muted">In ${LANG_NAME[lang] || lang}</div><b>${esc(ent.labels?.[lang]?.value || ls.title)}</b>
            <p class="clamp" style="-webkit-line-clamp:4;margin:4px 0">${esc(ls.extract || '')}</p>
            <a href="${esc(ls.content_urls?.desktop?.page)}" target="_blank" rel="noopener">${LANG_NAME[lang] || lang} Wikipedia</a></div>`;
        } catch {}
      }
    } catch {}
  }
  box.innerHTML = html + '</div>';
}

async function loadWikiNearby() {
  try {
    const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${state.lat}|${state.lon}&ggsradius=10000&ggslimit=30&prop=extracts|pageimages|coordinates&exintro=1&explaintext=1&exsentences=3&exlimit=max&piprop=thumbnail&pithumbsize=480`);
    state.wiki = Object.values(j.query?.pages || {}).filter((pg) => pg.coordinates)
      .map((pg) => ({ ...pg, lat: pg.coordinates[0].lat, lon: pg.coordinates[0].lon, d: haversine(state.lat, state.lon, pg.coordinates[0].lat, pg.coordinates[0].lon), norm: norm(pg.title) }))
      .sort((a, b) => a.d - b.d);
  } catch { state.wiki = []; }
}
async function loadCommonsPhotos() {
  try {
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gsnamespace=6&gscoord=${state.lat}|${state.lon}&gsradius=3000&gslimit=500`);
    state.photos = (j.query?.geosearch || []).map((g) => ({ title: g.title, lat: g.lat, lon: g.lon, norm: norm(g.title) }));
  } catch { state.photos = []; }
}

/* ---------------- places: Overpass → (fallback) Photon + OSM API ---------------- */
function overpassQuery(lat, lon, r) {
  const a = (rad) => `(around:${rad},${lat},${lon})`;
  return `[out:json][timeout:25];
(
  nwr${a(r)}["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park|aquarium)$"]["name"];
  nwr${a(r)}["historic"~"^(monument|memorial|castle|fort|ruins|archaeological_site|palace|church|temple|city_gate|building|heritage)$"]["name"];
  nwr${a(r)}["amenity"="place_of_worship"]["name"]["wikidata"];
  nwr${a(r)}["natural"="beach"]["name"];
  nwr${a(r)}["leisure"~"^(park|garden|nature_reserve)$"]["name"]["wikidata"];
  nwr${a(1500)}["amenity"~"^(cafe|restaurant|fast_food|food_court|ice_cream)$"]["name"];
  nwr${a(1500)}["shop"~"^(tea|coffee|bakery|pastry)$"]["name"];
  nwr${a(4000)}["railway"~"^(station|halt)$"]["name"];
  nwr${a(4000)}["station"~"^(subway|light_rail|monorail)$"];
  nwr${a(3000)}["amenity"~"^(bus_station|ferry_terminal|taxi|bicycle_rental|car_rental|boat_rental)$"];
  nwr${a(2000)}["public_transport"="station"];
  node${a(700)}["highway"="bus_stop"];
  nwr${a(3000)}["amenity"~"^(nightclub|bar|pub|arts_centre|theatre|community_centre|cinema|events_venue|music_venue)$"]["name"];
  nwr${a(3000)}["office"="coworking"]["name"];
);
out center tags 900;`;
}
const runOverpass = (q) => Promise.any(OVERPASS.map((ep) => getJSON(ep, {
  method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
}, 10000)));

const PHOTON_SETS = [
  [null, ['tourism:attraction', 'tourism:museum', 'tourism:viewpoint', 'tourism:gallery', 'tourism:zoo', 'historic', 'natural:beach']],
  [1.5, ['amenity:cafe', 'shop:tea', 'shop:coffee', 'shop:bakery', 'shop:pastry', 'amenity:ice_cream']],
  [1.5, ['amenity:restaurant', 'amenity:fast_food', 'amenity:food_court']],
  [4, ['railway:station', 'railway:halt', 'amenity:bus_station', 'amenity:ferry_terminal', 'public_transport:station']],
  [0.7, ['highway:bus_stop']],
  [3, ['amenity:taxi', 'amenity:bicycle_rental', 'amenity:car_rental', 'amenity:boat_rental']],
  [3, ['amenity:nightclub', 'amenity:bar', 'amenity:pub', 'amenity:arts_centre', 'amenity:theatre', 'amenity:community_centre', 'amenity:cinema', 'office:coworking']],
];
async function runPhoton(lat, lon, sightKm) {
  const T = { N: 'node', W: 'way', R: 'relation' };
  const all = [];
  for (const [km, tags] of PHOTON_SETS) {
    const u = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&radius=${km ?? sightKm}&limit=50&lang=en&${tags.map((t) => 'osm_tag=' + encodeURIComponent(t)).join('&')}`;
    for (let i = 0; i < 2; i++) {
      try { all.push(...((await getJSON(u, {}, 12000)).features || [])); break; } catch { await sleep(700); }
    }
  }
  const elements = all.filter((f) => f.properties?.name || f.properties?.osm_key === 'highway').map((f) => ({
    type: T[f.properties.osm_type] || 'node', id: f.properties.osm_id,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    tags: { name: f.properties.name, [f.properties.osm_key]: f.properties.osm_value },
  }));
  if (!elements.length) throw new Error('no places found');
  await enrichFromOSM(elements);
  return { elements };
}
/** Photon only returns the main tag; fetch full OSM tags (cuisine, hours, wifi, wikidata…) in batches. */
async function enrichFromOSM(elements) {
  for (const type of ['node', 'way']) {
    const ids = [...new Set(elements.filter((e) => e.type === type).map((e) => e.id))];
    for (let i = 0; i < ids.length; i += 100) {
      try {
        const j = await getJSON(`${OSM_API}/${type}s.json?${type}s=${ids.slice(i, i + 100).join(',')}`, {}, 15000);
        const byId = new Map(j.elements.map((x) => [x.id, x.tags || {}]));
        elements.forEach((e) => { if (e.type === type && byId.has(e.id)) e.tags = { ...byId.get(e.id), ...e.tags, name: byId.get(e.id).name || e.tags.name }; });
      } catch {}
    }
  }
}

async function loadPlaces() {
  state.loadingPlaces = true;
  ['#seeList', '#eatList', '#goList'].forEach((s) => { $(s).innerHTML = skeleton(4); });
  $('#seeChips').innerHTML = ''; $('#eatFilters').innerHTML = ''; $('#storiesBox').innerHTML = '';
  $('#eventsBox').innerHTML = skeleton(3);
  renderTrip();
  renderGlance();
  const r = +store.get('radius', '5000');
  const extras = Promise.all([loadWikiNearby(), loadCommonsPhotos()]);
  let data;
  try {
    data = await runOverpass(overpassQuery(state.lat, state.lon, r));
    state.osmSource = 'OpenStreetMap (Overpass)';
  } catch {
    try {
      data = await runPhoton(state.lat, state.lon, r / 1000);
      state.osmSource = 'OpenStreetMap (Photon + OSM API — Overpass was busy)';
    } catch (e) {
      ['#seeList', '#eatList', '#goList', '#eventsBox'].forEach((s) => { $(s).innerHTML = `<p class="err">Couldn't load places (${esc(e.message)}). <button onclick="refreshAll()">Retry</button></p>`; });
      state.loadingPlaces = false;
      return;
    }
  }
  const seen = new Set();
  const els = data.elements.map((el) => {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    return { type: el.type, id: el.id, lat, lon, t: el.tags || {}, d: haversine(state.lat, state.lon, lat, lon) };
  }).filter((e) => e.lat != null && !seen.has(e.type + e.id) && seen.add(e.type + e.id));

  state.sights = els.filter((e) => sightCat(e.t)).map((e) => ({ ...e, cat: sightCat(e.t) }));
  state.eats = els.filter((e) => eatType(e.t)).map(classifyEat);
  state.transit = els.map((e) => ({ ...e, mode: transitMode(e.t) })).filter((e) => e.mode);
  state.venues = els.filter((e) => /^(nightclub|bar|pub|arts_centre|theatre|community_centre|cinema|events_venue|music_venue)$/.test(e.t.amenity || '') || e.t.office === 'coworking');
  state.loadingPlaces = false;

  renderSee(); renderEat(); renderGo(); renderEvents(); renderGlance();
  await extras;
  await attachPhotos();
  renderSee(); renderEat(); renderStories();
  loadRoutes();
}

/* ---------------- photos for sights & eats ---------------- */
async function attachPhotos() {
  // Wikidata main image (P18) for anything with a wikidata tag
  const withQ = [...state.sights, ...state.eats].filter((e) => /^Q\d+$/.test(e.t.wikidata || ''));
  const qids = [...new Set(withQ.map((e) => e.t.wikidata))];
  const p18 = {}, wikiTitle = {};
  for (let i = 0; i < qids.length; i += 40) {
    try {
      const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|sitelinks&sitefilter=enwiki&ids=${qids.slice(i, i + 40).join('|')}`);
      for (const [q, ent] of Object.entries(j.entities || {})) {
        const f = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (f) p18[q] = commonsUrl(f);
        if (ent.sitelinks?.enwiki) wikiTitle[q] = ent.sitelinks.enwiki.title;
      }
    } catch {}
  }
  for (const e of state.sights) {
    const wp = state.wiki.find((w) => (wikiTitle[e.t.wikidata] && w.title === wikiTitle[e.t.wikidata])
      || (w.d < 1e9 && haversine(e.lat, e.lon, w.lat, w.lon) < 400 && norm(nameOf(e.t)).length > 4 && w.norm.includes(norm(nameOf(e.t)))));
    e.wiki = wp || null;
    e.img = imageFromTags(e.t) || p18[e.t.wikidata] || (wp?.thumbnail?.source) || matchPhoto(nameOf(e.t), e.lat, e.lon, 400);
  }
  for (const e of state.eats) {
    e.img = imageFromTags(e.t) || p18[e.t.wikidata] || matchPhoto(e.t.name, e.lat, e.lon, 150);
  }
  // Still no photo? Search Commons by name for the most relevant sights (shown after a re-render).
  renderSee();
  const order = new Map(filteredSights().map((e, i) => [e.type + e.id, i]));
  const missing = state.sights.filter((e) => !e.img).sort((a, b) => order.get(a.type + a.id) - order.get(b.type + b.id)).slice(0, 20);
  for (const e of missing) {
    e.img = await searchCommons(nameOf(e.t));
    await sleep(80);
  }
}

/** Commons file search by place name (+ city), accepting only files whose title contains the place's distinctive words. */
async function searchCommons(name) {
  const city = state.place.city || '';
  const n = norm(name);
  const generic = new Set([...GENERIC, 'centre', 'center', 'complex', 'kochi', 'district']);
  const tokens = n.split(' ').filter((w) => w.length >= 3 && !generic.has(w) && w !== norm(city));
  if (!tokens.length || tokens.join('').length < 5) return null;
  try {
    const q = encodeURIComponent(`${name} ${city}`);
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=5&gsrsearch=${q}&prop=imageinfo&iiprop=url|mime&iiurlwidth=480`, {}, 8000);
    const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
    const hit = pages.find((p) => /image\/(jpeg|png|webp)/.test(p.imageinfo?.[0]?.mime || '') && tokens.every((w) => norm(p.title).includes(w)));
    return hit?.imageinfo?.[0]?.thumburl || null;
  } catch { return null; }
}

/* ---------------- SEE ---------------- */
function sightCat(t) {
  if (/^(cafe|restaurant|fast_food|bar|pub)$/.test(t.amenity || '')) return null;
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
  if (t.historic) return 'history';
  if (t.amenity === 'place_of_worship') return t.wikidata ? 'worship' : null;
  if (t.natural === 'beach' || /park|garden|nature_reserve/.test(t.leisure || '') || t.tourism === 'zoo') return 'nature';
  if (t.tourism === 'viewpoint') return 'view';
  if (/attraction|theme_park|aquarium/.test(t.tourism || '')) return 'attraction';
  return null;
}
const SEE_CATS = [['all', 'All'], ['attraction', '⭐ Highlights'], ['museum', '🏛️ Museums'], ['history', '🏰 Heritage'], ['worship', '🛕 Sacred'], ['nature', '🌴 Nature & beaches'], ['view', '🌅 Viewpoints']];
const CAT_LABEL = { attraction: 'Attraction', museum: 'Museum / gallery', history: 'Heritage', worship: 'Place of worship', nature: 'Nature', view: 'Viewpoint' };

function filteredSights() {
  return state.sights.filter((e) => state.seeCat === 'all' || e.cat === state.seeCat)
    .map((e) => ({ ...e, score: e.d / 1000 - (e.t.wikipedia || e.t.wikidata || e.wiki ? 2.5 : 0) - (e.img ? 0.7 : 0) - (e.cat === 'attraction' || e.cat === 'museum' ? 0.6 : 0) }))
    .sort((a, b) => a.score - b.score);
}
function renderSee() {
  const counts = {}; state.sights.forEach((e) => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
  $('#seeChips').innerHTML = SEE_CATS.filter(([k]) => k === 'all' || counts[k])
    .map(([k, l]) => `<button class="chip ${state.seeCat === k ? 'on' : ''}" data-see="${k}">${l}${k !== 'all' ? ` ${counts[k]}` : ''}</button>`).join('');
  const list = filteredSights().slice(0, 30);
  if (!list.length) { $('#seeList').innerHTML = '<p class="muted">Nothing mapped here yet. Try a bigger radius in settings (tap the place name).</p>'; return; }
  $('#seeList').innerHTML = `<div class="grid">${list.map((e) => `
    <button class="pcard" data-detail="sight:${e.type}:${e.id}">
      ${imgHTML(e.img, e.cat)}
      <div class="txt"><div class="name">${esc(nameOf(e.t))}</div>
      <div class="meta">${CAT_LABEL[e.cat]} · ${fmtDist(e.d)}</div></div>
    </button>`).join('')}</div>
    <div class="source">📷 Photos: Wikimedia Commons / Wikipedia where available · ${esc(state.osmSource)}</div>`;
}
function renderStories() {
  const sightTitles = new Set(state.sights.map((s) => s.wiki?.title).filter(Boolean));
  const list = state.wiki.filter((w) => !sightTitles.has(w.title)).slice(0, 8);
  if (!list.length) { $('#storiesBox').innerHTML = ''; return; }
  $('#storiesBox').innerHTML = `<div class="section-title">📜 Stories around you</div>${list.map((w) => `
    <a class="row" href="https://en.wikipedia.org/?curid=${w.pageid}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
      ${imgHTML(w.thumbnail?.source, 'history')}
      <div class="body"><div class="name">${esc(w.title)}</div><div class="meta clamp" style="-webkit-line-clamp:3">${esc(w.extract || '')}</div></div>
      <div class="dist">${fmtDist(w.d)}</div></a>`).join('')}
    <div class="source">Wikipedia (CC BY-SA)</div>`;
}

/* ---------------- EAT ---------------- */
function eatType(t) {
  if (t.amenity === 'cafe' || t.shop === 'coffee') return 'cafe';
  if (t.amenity === 'restaurant') return 'restaurant';
  if (/^(fast_food|food_court|ice_cream)$/.test(t.amenity || '')) return 'fast';
  if (t.shop === 'bakery' || t.shop === 'pastry') return 'bakery';
  if (t.shop === 'tea') return 'tea';
  return null;
}
const EAT_TYPES = [['all', 'All'], ['cafe', '☕ Cafés'], ['restaurant', '🍛 Restaurants'], ['fast', '🥙 Quick bites'], ['bakery', '🥐 Bakery & tea']];
const MOODS = [
  ['budget', '💸 Budget'], ['local', '🌶️ Local flavours'], ['work', '💻 Work & Wi-Fi'], ['outdoor', '🌿 Outdoor seating'],
  ['veg', '🥗 Veg-friendly'], ['late', '🌙 Open late'],
];
function lateNight(oh = '') {
  if (/24\/7/.test(oh)) return true;
  return [...oh.matchAll(/-(\d{1,2}):(\d{2})/g)].some((m) => { const h = +m[1]; return h >= 22 || h <= 4; });
}
function classifyEat(e) {
  const t = e.t, type = eatType(t);
  const cuisines = (t.cuisine || '').split(/[;,]/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  const localRe = new RegExp(`(${COUNTRY_CUISINE[state.place.cc] || 'regional'}|regional|local)`);
  const localNameRe = /kerala|malabar|nadan|thattukada|chaya|chai|dosa|appam|biryani|udupi|saravana|meals|tiffin/i;
  const chain = !!(t.brand || t['brand:wikidata']);
  const local = cuisines.some((c) => localRe.test(c)) || (state.place.cc === 'in' && localNameRe.test(t.name || ''));
  const budget = !chain && (type === 'fast' || type === 'bakery' || type === 'tea' || local || /tea|chai|juice|snack|meals|tiffin/i.test(t.name || ''));
  const moods = new Set();
  if (budget) moods.add('budget');
  if (local) moods.add('local');
  if (/^(wlan|yes|wifi|free)$/.test(t.internet_access || '') || t['internet_access:fee'] === 'no') moods.add('work');
  if (t.outdoor_seating === 'yes') moods.add('outdoor');
  if (/^(yes|only)$/.test(t['diet:vegetarian'] || '') || /^(yes|only)$/.test(t['diet:vegan'] || '') || cuisines.includes('vegetarian')) moods.add('veg');
  if (lateNight(t.opening_hours)) moods.add('late');
  return { ...e, type, cuisines, chain, moods };
}
const prettyCuisine = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());

function filteredEats() {
  const f = state.eat;
  const list = state.eats.filter((e) => (f.type === 'all' || e.type === f.type || (f.type === 'bakery' && e.type === 'tea'))
    && (!f.cuisine || e.cuisines.includes(f.cuisine))
    && [...f.moods].every((m) => e.moods.has(m)));
  return list.sort(f.sort === 'budget'
    ? (a, b) => (b.moods.has('budget') - a.moods.has('budget')) || a.d - b.d
    : f.sort === 'photos' ? (a, b) => (!!b.img - !!a.img) || a.d - b.d : (a, b) => a.d - b.d);
}
function renderEat() {
  const f = state.eat;
  const cc = {}; state.eats.forEach((e) => e.cuisines.forEach((c) => { cc[c] = (cc[c] || 0) + 1; }));
  const topCuisines = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const moodCount = (m) => state.eats.filter((e) => e.moods.has(m)).length;
  $('#eatFilters').innerHTML = `
    <div class="chips">${EAT_TYPES.map(([k, l]) => `<button class="chip ${f.type === k ? 'on' : ''}" data-eat-type="${k}">${l}</button>`).join('')}</div>
    <div class="filter-label">Mood</div>
    <div class="chips">${MOODS.map(([k, l]) => `<button class="chip ${f.moods.has(k) ? 'on' : ''}" data-mood="${k}" ${moodCount(k) ? '' : 'disabled'}>${l}</button>`).join('')}
      <button class="chip" disabled title="Needs a ratings source (Google Places / Foursquare)">⭐ 4+ rating · soon</button></div>
    ${topCuisines.length ? `<div class="filter-label">Cuisine</div>
    <div class="chips">${topCuisines.map(([c, n]) => `<button class="chip ${f.cuisine === c ? 'on' : ''}" data-cuisine="${esc(c)}">${esc(prettyCuisine(c))} ${n}</button>`).join('')}</div>` : ''}`;
  const list = filteredEats();
  const bar = `<div class="filter-bar"><span>${list.length} place${list.length === 1 ? '' : 's'}${f.moods.size || f.cuisine || f.type !== 'all' ? ' · <a href="#" data-clear-eat>clear filters</a>' : ''}</span>
    <select id="eatSort"><option value="near">Nearest</option><option value="budget">Budget first</option><option value="photos">With photos</option></select></div>`;
  if (!list.length) { $('#eatList').innerHTML = bar + '<p class="muted">No matches — try removing a filter.</p>'; $('#eatSort').value = f.sort; return; }
  const lang = state.place.lang;
  $('#eatList').innerHTML = bar + list.slice(0, 40).map((e) => {
    const t = e.t, ln = localNameOf(t);
    const q = encodeURIComponent(`${t.name} ${state.place.city || ''} reviews`);
    const badges = [
      e.chain ? `<span class="badge">chain</span>` : '<span class="badge good">independent</span>',
      e.moods.has('budget') ? '<span class="badge good">likely budget</span>' : '',
      ...e.cuisines.slice(0, 2).map((c) => `<span class="badge">${esc(prettyCuisine(c))}</span>`),
      e.moods.has('work') ? '<span class="badge">Wi-Fi</span>' : '',
      e.moods.has('outdoor') ? '<span class="badge">outdoor</span>' : '',
      e.moods.has('veg') ? '<span class="badge">veg</span>' : '',
    ].join('');
    return `<div class="row">
      ${imgHTML(e.img, e.type)}
      <div class="body">
        <div class="name">${esc(t.name)}${ln ? ` <span class="muted small" lang="${lang}">${esc(ln)}</span>` : ''}</div>
        <div>${badges}</div>
        <div class="meta">${t.opening_hours ? '🕒 ' + esc(t.opening_hours) + ' · ' : ''}🚶 ${walkMin(e.d)} min · ${fmtDist(e.d)}</div>
        <div class="acts">
          <a href="${mapsSearch(t.name, e.lat, e.lon)}" target="_blank" rel="noopener">⭐ Reviews</a>
          ${lang && lang !== 'en' ? `<a href="https://www.google.com/search?q=${q}&hl=${lang}" target="_blank" rel="noopener">${LANG_NAME[lang] || lang} reviews</a>` : ''}
          <a href="${directions(e.lat, e.lon, t.name, e.d)}" target="_blank" rel="noopener">➜ Go</a>
        </div>
      </div></div>`;
  }).join('') + `<div class="source">${esc(state.osmSource)} · photos from Wikimedia Commons when one exists ·
    <span class="badge ph">heuristic</span> "budget" & moods come from map tags; star ratings need a paid reviews API.</div>`;
  $('#eatSort').value = f.sort;
}

/* ---------------- GO (public transport first) ---------------- */
function transitMode(t) {
  if (t.amenity === 'taxi') return { key: 'taxi', label: 'Auto / taxi stands', icon: '🛺', rank: 10, lastMile: true };
  if (/^(subway|light_rail|monorail)$/.test(t.station || '') || /metro/i.test(t.network || '') && t.railway === 'station') return { key: 'metro', label: 'Metro', icon: '🚇', rank: 1 };
  if (t.amenity === 'ferry_terminal') return /water metro/i.test(t.name || '') ? { key: 'ferry', label: 'Water metro & ferry', icon: '⛴️', rank: 2 } : { key: 'ferry', label: 'Water metro & ferry', icon: '⛴️', rank: 2 };
  if (t.railway === 'station' || t.railway === 'halt') return { key: 'train', label: 'Train', icon: '🚆', rank: 3 };
  if (t.amenity === 'bus_station') return { key: 'busstation', label: 'Bus stations', icon: '🚌', rank: 4 };
  if (t.highway === 'bus_stop') return { key: 'bus', label: 'Bus stops', icon: '🚏', rank: 5 };
  if (t.public_transport === 'station') return { key: 'station', label: 'Stations', icon: '🚉', rank: 6 };
  if (t.amenity === 'taxi') return { key: 'taxi', label: 'Auto / taxi stands', icon: '🛺', rank: 10, lastMile: true };
  if (t.amenity === 'bicycle_rental') return { key: 'bike', label: 'Bike rental', icon: '🚲', rank: 11, lastMile: true };
  if (t.amenity === 'car_rental') return { key: 'car', label: 'Car rental', icon: '🚗', rank: 12, lastMile: true };
  if (t.amenity === 'boat_rental') return { key: 'boat', label: 'Boat rental', icon: '🛶', rank: 13, lastMile: true };
  return null;
}

function renderTrip() {
  const city = state.place.city || '';
  $('#tripBox').innerHTML = `<div class="card trip">
    <h3>🧭 Where to? <span class="small">by public transport</span></h3>
    <form class="search" id="tripForm"><input id="tripInput" type="search" placeholder="Destination, e.g. Marine Drive" autocomplete="off"><button>Route</button></form>
    <div class="chips" style="margin-top:8px;padding-bottom:2px" id="tripChips">
      ${city ? `<button class="chip" data-trip="${esc(city)} railway station">🚆 Railway station</button>
      <button class="chip" data-trip="${esc(city)} airport">✈️ Airport</button>
      <button class="chip" data-trip="${esc(city)} bus stand">🚌 Main bus stand</button>` : ''}
    </div>
    <div class="small" style="margin-top:6px">Opens step-by-step bus / metro / ferry directions from where you are.</div>
  </div>`;
}
function openTrip(dest) {
  if (!dest) return;
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${state.lat},${state.lon}&destination=${encodeURIComponent(dest)}&travelmode=transit`, '_blank', 'noopener');
}

function renderGo() {
  const groups = {};
  state.transit.forEach((e) => { (groups[e.mode.key] ||= { ...e.mode, items: [] }).items.push(e); });
  const main = Object.values(groups).filter((g) => !g.lastMile).sort((a, b) => a.rank - b.rank);
  const last = Object.values(groups).filter((g) => g.lastMile).sort((a, b) => a.rank - b.rank);
  const cc = state.place.cc;
  const links = `<div class="links">
    <a href="https://www.google.com/maps/@?api=1&map_action=map&center=${state.lat},${state.lon}&zoom=14&layer=transit" target="_blank" rel="noopener">🗺 Transit map</a>
    <a href="https://moovitapp.com/" target="_blank" rel="noopener">Moovit</a>
    ${cc === 'in' ? '<a href="https://www.rapido.bike/" target="_blank" rel="noopener">Rapido (auto/bike)</a><a href="https://www.olacabs.com/" target="_blank" rel="noopener">Ola</a>' : ''}
    <a href="https://m.uber.com/" target="_blank" rel="noopener">Uber</a></div>`;
  if (!main.length && !last.length) { $('#goList').innerHTML = '<p class="muted">No public transport mapped nearby.</p>' + links; return; }
  let html = main.map((g) => {
    const items = g.items.sort((a, b) => a.d - b.d).slice(0, g.key === 'bus' ? 5 : 3);
    return `<div class="section-title">${g.icon} ${g.label}</div>` + items.map((e) => `
      <div class="stop" id="stop-${e.type}-${e.id}">
        <div class="stop-head"><div class="stop-icon">${g.icon}</div>
          <div style="flex:1;min-width:0"><div class="name">${esc(nameOf(e.t) || g.label)}</div>
          <div class="meta">🚶 ${walkMin(e.d)} min · ${fmtDist(e.d)}${e.t.operator ? ' · ' + esc(e.t.operator) : ''}${e.t.network && e.t.network !== e.t.operator ? ' · ' + esc(e.t.network) : ''}</div></div></div>
        <div class="routes" data-routes="${e.type}:${e.id}">${e.type === 'relation' ? '' : '<span class="muted small">Checking routes…</span>'}</div>
        <div class="acts">
          <a href="https://www.google.com/maps/dir/?api=1&origin=${state.lat},${state.lon}&destination=${e.lat},${e.lon}&travelmode=walking" target="_blank" rel="noopener">🚶 Walk there</a>
          <a href="${mapsSearch(nameOf(e.t) || g.label, e.lat, e.lon)}" target="_blank" rel="noopener">🕒 Departures</a>
        </div></div>`).join('');
  }).join('');
  if (last.length) {
    html += '<div class="section-title">🛺 Last mile</div><div class="card" style="padding:6px 12px">' + last.map((g) => {
      const e = g.items.sort((a, b) => a.d - b.d)[0];
      return `<div class="mini"><span>${g.icon} ${g.label}${e.t.name ? ` · <span class="muted">${esc(e.t.name)}</span>` : ''}</span><a href="${directions(e.lat, e.lon, e.t.name, e.d)}" target="_blank" rel="noopener">${fmtDist(e.d)}</a></div>`;
    }).join('') + '</div>';
  }
  html += links + `<div class="source">${esc(state.osmSource)} · routes from OSM route relations ·
    <span class="badge ph">not live</span> exact timetables & live arrivals need each city's GTFS feed.</div>`;
  $('#goList').innerHTML = html;
}

/** For the nearest stops, ask OSM which bus/ferry/metro routes serve them. */
async function loadRoutes() {
  const groups = {};
  state.transit.filter((e) => !e.mode.lastMile).forEach((e) => { (groups[e.mode.key] ||= []).push(e); });
  const targets = Object.values(groups).flatMap((arr) => arr.sort((a, b) => a.d - b.d).slice(0, arr[0].mode.key === 'bus' ? 5 : 3));
  for (const e of targets) {
    const box = $(`[data-routes="${e.type}:${e.id}"]`);
    if (!box || e.type === 'relation') continue;
    try {
      const j = await getJSON(`${OSM_API}/${e.type}/${e.id}/relations.json`, {}, 12000);
      const routes = (j.elements || []).filter((r) => r.tags?.type === 'route' || r.tags?.type === 'route_master').map((r) => r.tags);
      box.innerHTML = routeSummary(routes, e);
    } catch { box.innerHTML = ''; }
    await sleep(150);
  }
}
function routeSummary(routes, e) {
  if (!routes.length) {
    return e.mode?.key === 'bus' ? '<span class="muted small">No routes mapped for this stop yet.</span>' : '';
  }
  const here = norm(nameOf(e.t)); const loc = norm(state.place.locality); const city = norm(state.place.city);
  const dests = new Map();
  const refs = new Set();
  routes.forEach((r) => {
    if (r.ref) refs.add(r.ref);
    let ends = [r.from, r.to].filter(Boolean);
    if (!ends.length && r.name) {
      const m = r.name.split(/:\s*/).pop().split(/\s*(?:→|=>|->|–|—| - | to )\s*/i);
      if (m.length >= 2) ends = [m[0], m[m.length - 1]];
    }
    ends.forEach((x) => {
      const n = norm(x);
      if (!n || n === here || n === loc || (loc && n.includes(loc)) || (n === city)) return;
      dests.set(n, { label: x.trim(), count: (dests.get(n)?.count || 0) + 1 });
    });
  });
  const list = [...dests.values()].sort((a, b) => b.count - a.count);
  const modes = [...new Set(routes.map((r) => r.route).filter(Boolean))];
  const icon = modes.includes('subway') || modes.includes('light_rail') ? '🚇' : modes.includes('ferry') ? '⛴️' : modes.includes('train') ? '🚆' : (e.mode?.icon || '🚌');
  const shown = list.slice(0, 10).map((d) => `<span>${esc(d.label)}</span>`).join('');
  const more = list.length > 10 ? `<span class="muted">+${list.length - 10} more</span>` : '';
  return `<div><b>${icon} ${routes.length} route${routes.length > 1 ? 's' : ''}</b>${refs.size ? ` · <span class="muted">${esc([...refs].slice(0, 8).join(', '))}</span>` : ''}</div>
    ${list.length ? `<div class="muted small" style="margin-top:4px">Goes to / comes from</div><div class="to">${shown}${more}</div>` : ''}`;
}

/* ---------------- EVENTS ---------------- */
async function renderEvents() {
  const venues = state.venues.slice().sort((a, b) => a.d - b.d);
  const night = venues.filter((e) => /nightclub|bar|pub/.test(e.t.amenity || '')).slice(0, 6);
  const learn = venues.filter((e) => !/nightclub|bar|pub/.test(e.t.amenity || '')).slice(0, 8);
  const city = state.place.city || '', cc = state.place.cc || '';
  const slug = norm(city).replace(/ /g, '-');
  const vlist = (arr, kind) => arr.length ? arr.map((e) => `<div class="row">
      ${imgHTML(imageFromTags(e.t) || matchPhoto(e.t.name, e.lat, e.lon, 150), kind)}
      <div class="body"><div class="name">${esc(e.t.name)}</div>
      <div class="meta">${esc((e.t.amenity || e.t.office || '').replace(/_/g, ' '))}${e.t.opening_hours ? ' · 🕒 ' + esc(e.t.opening_hours) : ''}</div>
      <div class="acts">${e.t.website ? `<a href="${esc(e.t.website)}" target="_blank" rel="noopener">Website</a>` : ''}
        <a href="${mapsSearch(e.t.name, e.lat, e.lon)}" target="_blank" rel="noopener">What's on</a>
        <a href="${directions(e.lat, e.lon, e.t.name, e.d)}" target="_blank" rel="noopener">➜ Go</a></div></div>
      <div class="dist">${fmtDist(e.d)}</div></div>`).join('') : '<p class="muted small">None mapped nearby.</p>';
  let live = '';
  const key = store.get('tmKey', '');
  if (key) {
    try {
      const j = await getJSON(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&latlong=${state.lat},${state.lon}&radius=30&unit=km&size=15&sort=date,asc`);
      const evs = j._embedded?.events || [];
      live = '<div class="section-title">🎫 Upcoming (Ticketmaster)</div>' + (evs.length ? evs.map((ev) => `<a class="row" href="${esc(ev.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        ${imgHTML(ev.images?.[0]?.url, 'culture')}<div class="body"><div class="name">${esc(ev.name)}</div>
        <div class="meta">${esc(ev.dates?.start?.localDate || '')} ${esc(ev.dates?.start?.localTime?.slice(0, 5) || '')} · ${esc(ev._embedded?.venues?.[0]?.name || '')}</div></div></a>`).join('')
        : '<p class="muted small">No Ticketmaster events here (coverage is mostly US/EU/AU).</p>');
    } catch (e) { live = `<p class="err small">Ticketmaster failed: ${esc(e.message)}</p>`; }
  }
  $('#eventsBox').innerHTML = `${live}
    <div class="card"><h3>🔎 What's on in ${esc(city || 'town')}</h3>
    <div class="links" style="margin:0">
      <a href="https://allevents.in/${slug}/all" target="_blank" rel="noopener">All events</a>
      <a href="https://allevents.in/${slug}/workshops" target="_blank" rel="noopener">Workshops</a>
      <a href="https://allevents.in/${slug}/parties" target="_blank" rel="noopener">Parties</a>
      <a href="https://www.meetup.com/find/?location=${encodeURIComponent(city)}&source=EVENTS" target="_blank" rel="noopener">Meetup</a>
      <a href="https://www.eventbrite.com/d/${encodeURIComponent(cc)}--${slug}/classes/" target="_blank" rel="noopener">Classes</a>
      ${cc === 'in' ? `<a href="https://in.bookmyshow.com/explore/events-${slug}" target="_blank" rel="noopener">BookMyShow</a><a href="https://www.district.in/events/" target="_blank" rel="noopener">District</a>` : ''}
    </div></div>
    <div class="section-title">🌙 Night spots</div>${vlist(night, 'bar')}
    <div class="section-title">🎨 Workshops, culture & coworking</div>${vlist(learn, 'culture')}
    <div class="source">${esc(state.osmSource)} · <span class="badge ph">links</span> dated events need an events feed (AllEvents / Meetup partner access).</div>`;
}

/* ---------------- TODAY glance ---------------- */
function renderGlance() {
  if (state.loadingPlaces || !state.transit.length && !state.sights.length) {
    $('#glance').innerHTML = state.loadingPlaces ? '<div class="glance"><div class="skeleton"></div><div class="skeleton"></div></div>' : '';
    return;
  }
  const stop = state.transit.filter((e) => !e.mode.lastMile).sort((a, b) => a.d - b.d)[0];
  const sight = filteredSights()[0];
  const budget = state.eats.filter((e) => e.moods.has('budget')).length;
  $('#glance').innerHTML = `<div class="glance">
    ${stop ? `<button class="tile" data-goto="go"><span class="small muted">${stop.mode.icon} Nearest ${esc(stop.mode.label.toLowerCase())}</span><b>${esc(nameOf(stop.t) || stop.mode.label)}</b><span class="small muted">🚶 ${walkMin(stop.d)} min</span></button>` : ''}
    ${sight ? `<button class="tile" data-goto="see"><span class="small muted">🏛️ Must-see nearby</span><b>${esc(nameOf(sight.t))}</b><span class="small muted">${fmtDist(sight.d)} · ${state.sights.length} sights</span></button>` : ''}
    <button class="tile" data-goto="eat"><span class="small muted">🍽️ Places to eat</span><b>${state.eats.length} nearby</b><span class="small muted">${budget} likely budget</span></button>
    <button class="tile" data-goto="events"><span class="small muted">🎉 Tonight</span><b>${state.venues.length} venues</b><span class="small muted">bars, arts & culture</span></button>
  </div>`;
}

/* ---------------- detail sheet ---------------- */
function openDetail(kind, type, id) {
  const e = state.sights.find((x) => x.type === type && String(x.id) === id);
  if (!e) return;
  const t = e.t, ln = localNameOf(t);
  const wp = e.wiki;
  const wpLink = wp ? `https://en.wikipedia.org/?curid=${wp.pageid}` : t.wikipedia ? `https://${t.wikipedia.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(t.wikipedia.split(':').slice(1).join(':'))}` : null;
  $('#detailBody').innerHTML = `
    ${e.img ? `<img class="detail-img" src="${esc(e.img.replace(/width=\d+/, 'width=800'))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <h2 style="margin-top:12px">${esc(nameOf(t))}</h2>
    ${ln ? `<div class="muted" lang="${state.place.lang}">${esc(ln)}</div>` : ''}
    <div class="muted small">${CAT_LABEL[e.cat]} · ${fmtDist(e.d)} away · 🚶 ${walkMin(e.d)} min</div>
    ${wp?.extract ? `<p>${esc(wp.extract)}</p>` : t.description ? `<p>${esc(t.description)}</p>` : ''}
    ${t.opening_hours ? `<p class="small">🕒 ${esc(t.opening_hours)}</p>` : ''}
    ${t.fee ? `<p class="small">🎟️ Fee: ${esc(t.fee)}</p>` : ''}
    <div class="detail-actions">
      <a class="primary" href="${directions(e.lat, e.lon, nameOf(t), e.d)}" target="_blank" rel="noopener">${e.d < 1200 ? '🚶 Walk' : '🚌 Transit'} there</a>
      <a href="${mapsSearch(nameOf(t), e.lat, e.lon)}" target="_blank" rel="noopener">⭐ Reviews & photos</a>
      ${wpLink ? `<a href="${esc(wpLink)}" target="_blank" rel="noopener">📖 Wikipedia</a>` : ''}
      <a href="https://www.openstreetmap.org/${e.type}/${e.id}" target="_blank" rel="noopener">🗺 OSM</a>
    </div>`;
  $('#detailSheet').showModal();
}

/* ---------------- wiring ---------------- */
async function doSearch(q, box) {
  box.innerHTML = '<p class="loading">Searching…</p>';
  try {
    const res = await searchPlace(q);
    if (!res.length) { box.innerHTML = '<p class="muted">No match — try adding the country.</p>'; return; }
    if (res.length === 1) { setLocation(res[0].lat, res[0].lon, res[0].display_name); return; }
    box.innerHTML = res.map((r, i) => `<button data-i="${i}">${esc(r.display_name)}</button>`).join('');
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const r = res[+b.dataset.i]; setLocation(r.lat, r.lon, r.display_name); }));
  } catch (e) { box.innerHTML = `<p class="err">Search failed: ${esc(e.message)}</p>`; }
}
$$('.search-form').forEach((f) => f.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = f.querySelector('input').value.trim();
  if (q) doSearch(q, f.nextElementSibling);
}));
$$('.gps-btn').forEach((b) => b.addEventListener('click', useGPS));
$('#gpsTop').addEventListener('click', useGPS);
$$('.quick button').forEach((b) => b.addEventListener('click', () => doSearch(b.dataset.q, $('.welcome .search-results'))));
$('#placeBtn').addEventListener('click', () => {
  $('#radiusSel').value = store.get('radius', '5000');
  $('#tmKey').value = store.get('tmKey', '');
  $('#locSheet').showModal();
});
$('#locSheet').addEventListener('close', () => {
  const changed = $('#radiusSel').value !== store.get('radius', '5000') || $('#tmKey').value.trim() !== store.get('tmKey', '');
  store.set('radius', $('#radiusSel').value);
  store.set('tmKey', $('#tmKey').value.trim());
  if (changed && state.lat != null) refreshAll();
});
$$('#bottomNav button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$$('.map-toggle').forEach((b) => b.addEventListener('click', () => toggleMap(b.dataset.map)));
$$('dialog.sheet').forEach((d) => d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }));

// Delegated clicks for dynamic content
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-see],[data-eat-type],[data-mood],[data-cuisine],[data-clear-eat],[data-detail],[data-goto],[data-trip]');
  if (!el) return;
  const f = state.eat;
  if (el.dataset.see) { state.seeCat = el.dataset.see; renderSee(); if (maps.see) { toggleMap('see'); toggleMap('see'); } }
  else if (el.dataset.eatType) { f.type = el.dataset.eatType; renderEat(); }
  else if (el.dataset.mood) { f.moods.has(el.dataset.mood) ? f.moods.delete(el.dataset.mood) : f.moods.add(el.dataset.mood); renderEat(); }
  else if (el.dataset.cuisine) { f.cuisine = f.cuisine === el.dataset.cuisine ? null : el.dataset.cuisine; renderEat(); }
  else if ('clearEat' in el.dataset) { ev.preventDefault(); f.type = 'all'; f.cuisine = null; f.moods.clear(); renderEat(); }
  else if (el.dataset.detail) { const [k, type, id] = el.dataset.detail.split(':'); openDetail(k, type, id); }
  else if (el.dataset.goto) switchTab(el.dataset.goto);
  else if (el.dataset.trip) openTrip(el.dataset.trip);
  if (maps.eat && (el.dataset.eatType || el.dataset.mood || el.dataset.cuisine || 'clearEat' in el.dataset)) { toggleMap('eat'); toggleMap('eat'); }
});
document.addEventListener('change', (ev) => { if (ev.target.id === 'eatSort') { state.eat.sort = ev.target.value; renderEat(); } });
document.addEventListener('submit', (ev) => { if (ev.target.id === 'tripForm') { ev.preventDefault(); openTrip($('#tripInput').value.trim()); } });

// Deep links (?lat=&lon= or ?q=) or resume last location
const params = new URLSearchParams(location.search);
if (params.get('lat') && params.get('lon')) setLocation(params.get('lat'), params.get('lon'));
else if (params.get('q')) doSearch(params.get('q'), $('.welcome .search-results'));
else {
  try { const last = JSON.parse(store.get('lastLoc', 'null')); if (last) setLocation(last.lat, last.lon); } catch {}
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
