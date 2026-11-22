/* Wayfarer — travel companion prototype.
   All data comes from free, keyless APIs called straight from the browser:
   Nominatim (geocoding), Overpass (OpenStreetMap POIs), Open-Meteo (weather),
   Wikipedia + Wikidata (facts/history). Ticketmaster is optional (user key). */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Main language spoken by region, used to pull local-language Wikipedia text.
const STATE_LANG = {
  kerala: 'ml', 'tamil nadu': 'ta', karnataka: 'kn', 'andhra pradesh': 'te', telangana: 'te',
  maharashtra: 'mr', goa: 'kn', 'west bengal': 'bn', gujarat: 'gu', punjab: 'pa', odisha: 'or',
  delhi: 'hi', 'uttar pradesh': 'hi', rajasthan: 'hi', 'madhya pradesh': 'hi', bihar: 'hi', assam: 'as',
  puducherry: 'ta', lakshadweep: 'ml',
};
const COUNTRY_LANG = {
  in: 'hi', pt: 'pt', es: 'es', fr: 'fr', de: 'de', it: 'it', jp: 'ja', cn: 'zh', kr: 'ko', th: 'th',
  vn: 'vi', id: 'id', ru: 'ru', nl: 'nl', tr: 'tr', gr: 'el', br: 'pt', mx: 'es', ar: 'es', ae: 'ar',
  sa: 'ar', eg: 'ar', lk: 'si', np: 'ne', bd: 'bn', pk: 'ur', my: 'ms', pl: 'pl', se: 'sv', no: 'no',
  dk: 'da', fi: 'fi', cz: 'cs', hu: 'hu', at: 'de', ch: 'de', be: 'nl',
};
const LANG_NAME = { ml: 'Malayalam', ta: 'Tamil', kn: 'Kannada', te: 'Telugu', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati',
  pa: 'Punjabi', or: 'Odia', hi: 'Hindi', as: 'Assamese', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ru: 'Russian',
  nl: 'Dutch', tr: 'Turkish', el: 'Greek', ar: 'Arabic', si: 'Sinhala', ne: 'Nepali', ur: 'Urdu', ms: 'Malay', pl: 'Polish',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian' };

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Light snow', '🌨️'],
  73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'],
  82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'], 95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};

let map, layer;
let state = { lat: null, lon: null, place: null };

/* ---------- helpers ---------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const walk = (m) => `${Math.max(1, Math.round(m / 80))} min walk`;
const gmaps = (name, lat, lon) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name ? `${name} ${lat},${lon}` : `${lat},${lon}`)}`;
const osmLink = (el) => `https://www.openstreetmap.org/${el.type}/${el.id}`;

async function getJSON(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const setBody = (id, html) => { $(`#${id} .body`).innerHTML = html; };
const loading = (id, what) => setBody(id, `<p class="loading">Loading ${what}…</p>`);
const fail = (id, what, e) => setBody(id, `<p class="err">Couldn't load ${what} (${esc(e.message || e)}). <button onclick="refreshAll()">Retry</button></p>`);

/* ---------- location ---------- */
async function reverseGeocode(lat, lon) {
  const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=en`;
  return getJSON(u);
}
async function searchPlace(q) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=5&addressdetails=1&accept-language=en`;
  return getJSON(u);
}

function placeFromAddress(addr = {}) {
  const locality = addr.suburb || addr.neighbourhood || addr.quarter || addr.village || addr.town || addr.city_district;
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district;
  const cc = (addr.country_code || '').toLowerCase();
  const stateName = (addr.state || '').toLowerCase();
  const lang = (cc === 'in' && STATE_LANG[stateName]) || COUNTRY_LANG[cc] || null;
  return { locality, city, state: addr.state, country: addr.country, cc, lang };
}

async function setLocation(lat, lon, label) {
  state.lat = +lat; state.lon = +lon;
  $('#searchResults').innerHTML = '';
  $('#main').hidden = false; $('#tabs').hidden = false;
  $('#placeLine').textContent = label || `${(+lat).toFixed(4)}, ${(+lon).toFixed(4)}`;
  initMap();
  try {
    const rev = await reverseGeocode(lat, lon);
    state.place = placeFromAddress(rev.address);
    const p = state.place;
    $('#placeLine').textContent = [p.locality, p.city, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  } catch { state.place = { city: label }; }
  store.set('lastLoc', JSON.stringify({ lat, lon }));
  refreshAll();
}

window.refreshAll = function refreshAll() {
  loadWeather();
  loadHistory();
  loadOSM();
};

function useGPS() {
  if (!navigator.geolocation) { alert('Geolocation not available — type a place instead.'); return; }
  $('#gpsBtn').textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { $('#gpsBtn').textContent = '📍 Use my location'; setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { $('#gpsBtn').textContent = '📍 Use my location'; alert(`Couldn't get your location (${err.message}). Type a place instead.`); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

/* ---------- map ---------- */
function initMap() {
  if (typeof L === 'undefined') { $('#map').textContent = 'Map library failed to load.'; return; }
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  layer.clearLayers();
  map.setView([state.lat, state.lon], 14);
  L.circleMarker([state.lat, state.lon], { radius: 8, color: '#0f766e', fillOpacity: 0.9 }).addTo(layer).bindPopup('You are here');
}
function addPin(lat, lon, label, color) {
  if (!layer) return;
  L.circleMarker([lat, lon], { radius: 5, color, weight: 2, fillOpacity: 0.6 }).addTo(layer).bindPopup(esc(label));
}

/* ---------- weather (Open-Meteo) ---------- */
async function loadWeather() {
  loading('weather', 'weather');
  const { lat, lon } = state;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset'
    + '&timezone=auto&forecast_days=4';
  try {
    const w = await getJSON(u);
    const c = w.current, d = w.daily;
    const [desc, icon] = WMO[c.weather_code] || ['—', '🌡️'];
    const tip = travelTip(c, d);
    const days = d.time.map((t, i) => {
      const [dd, ic] = WMO[d.weather_code[i]] || ['', ''];
      const day = i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
      return `<div title="${esc(dd)}">${day}<br><span style="font-size:22px">${ic}</span><br>${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°<br><span class="muted">${d.precipitation_probability_max[i] ?? 0}% rain</span></div>`;
    }).join('');
    const hm = (s) => s.slice(11, 16);
    setBody('weather', `
      <div class="wx-now"><span style="font-size:44px">${icon}</span>
        <div><div class="big">${Math.round(c.temperature_2m)}°C</div>
        <div class="muted">${desc} · feels ${Math.round(c.apparent_temperature)}° · ${c.relative_humidity_2m}% humidity · wind ${Math.round(c.wind_speed_10m)} km/h</div></div></div>
      <p class="small muted">Sunrise ${hm(d.sunrise[0])} · Sunset ${hm(d.sunset[0])} · UV max ${d.uv_index_max[0] ?? '—'} (local time, ${esc(w.timezone)})</p>
      ${tip ? `<p>💡 ${tip}</p>` : ''}
      <div class="wx-days">${days}</div>
      <p><span class="badge real">live</span><span class="small muted">Open-Meteo</span></p>`);
  } catch (e) { fail('weather', 'weather', e); }
}
function travelTip(c, d) {
  const tips = [];
  if ((d.precipitation_probability_max[0] ?? 0) >= 60) tips.push('High chance of rain today — favour museums and covered markets, carry an umbrella.');
  if (c.apparent_temperature >= 34) tips.push('Very hot — do outdoor sights early morning or after 4 pm and stay hydrated.');
  if ((d.uv_index_max[0] ?? 0) >= 8) tips.push('UV is very high; sunscreen and a hat.');
  if (c.apparent_temperature <= 5) tips.push('Cold out — layer up.');
  return tips.join(' ');
}

/* ---------- OpenStreetMap via Overpass: sights, cafés, transport, venues ---------- */
function overpassQuery(lat, lon, r) {
  const a = (rad) => `(around:${rad},${lat},${lon})`;
  return `[out:json][timeout:25];
(
  nwr${a(r)}["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park|aquarium)$"]["name"];
  nwr${a(r)}["historic"~"^(monument|memorial|castle|fort|ruins|archaeological_site|palace|church|temple|city_gate|building|heritage)$"]["name"];
  nwr${a(r)}["amenity"="place_of_worship"]["name"]["wikidata"];
  nwr${a(r)}["natural"="beach"]["name"];
  nwr${a(r)}["leisure"~"^(park|garden|nature_reserve)$"]["name"]["wikidata"];
  nwr${a(2000)}["amenity"="cafe"]["name"];
  nwr${a(2000)}["shop"~"^(tea|coffee|bakery)$"]["name"];
  nwr${a(3000)}["railway"~"^(station|halt)$"]["name"];
  nwr${a(3000)}["station"~"^(subway|light_rail|monorail)$"];
  nwr${a(3000)}["amenity"~"^(bus_station|ferry_terminal|taxi|bicycle_rental|car_rental|boat_rental)$"];
  nwr${a(2000)}["public_transport"="station"];
  node${a(600)}["highway"="bus_stop"];
  nwr${a(3000)}["amenity"~"^(nightclub|bar|pub|arts_centre|theatre|community_centre|cinema|events_venue|music_venue)$"]["name"];
  nwr${a(3000)}["office"="coworking"]["name"];
);
out center tags 600;`;
}

async function runOverpass(q) {
  // Ask both mirrors at once; first good answer wins. Give up after 10 s and fall back.
  return Promise.any(OVERPASS.map((ep) => getJSON(ep, {
    method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, 10000)));
}

/* Fallback when public Overpass servers are overloaded: Photon (komoot) reverse search
   filtered by OSM tag. Fewer tags come back (no hours/brand/wikidata), but it's fast. */
const PHOTON_SETS = [
  [5, ['tourism:attraction', 'tourism:museum', 'tourism:viewpoint', 'tourism:gallery', 'tourism:zoo', 'historic', 'natural:beach']],
  [2, ['amenity:cafe', 'shop:tea', 'shop:coffee', 'shop:bakery']],
  [3, ['railway:station', 'railway:halt', 'amenity:bus_station', 'amenity:ferry_terminal', 'amenity:taxi', 'amenity:bicycle_rental', 'amenity:car_rental', 'public_transport:station']],
  [1, ['highway:bus_stop']],
  [3, ['amenity:nightclub', 'amenity:bar', 'amenity:pub', 'amenity:arts_centre', 'amenity:theatre', 'amenity:community_centre', 'amenity:cinema', 'office:coworking']],
];
async function runPhoton(lat, lon, sightRadiusM) {
  const T = { N: 'node', W: 'way', R: 'relation' };
  // Sequential, with one retry each: Photon throttles bursts of parallel requests.
  const all = [];
  for (const [i, [km, tags]] of PHOTON_SETS.entries()) {
    const radius = i === 0 ? sightRadiusM / 1000 : km;
    const u = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&radius=${radius}&limit=50&lang=en&${tags.map((t) => 'osm_tag=' + encodeURIComponent(t)).join('&')}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { all.push((await getJSON(u, {}, 12000)).features || []); break; } catch { await new Promise((r) => setTimeout(r, 800)); }
    }
  }
  const elements = all.flat().filter((f) => f.properties?.name || f.properties?.osm_key === 'highway').map((f) => ({
    type: T[f.properties.osm_type] || 'node', id: f.properties.osm_id,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    tags: { name: f.properties.name, [f.properties.osm_key]: f.properties.osm_value },
  }));
  if (!elements.length) throw new Error('Photon returned nothing');
  return { elements };
}

async function loadOSM() {
  ['sights', 'cafes', 'transport', 'events'].forEach((id) => loading(id, 'OpenStreetMap data'));
  const r = +store.get('radius', '5000');
  try {
    let data;
    try {
      data = await runOverpass(overpassQuery(state.lat, state.lon, r));
      state.osmSource = 'Overpass';
    } catch {
      ['sights', 'cafes', 'transport', 'events'].forEach((id) => loading(id, 'places (Overpass busy, using Photon)'));
      data = await runPhoton(state.lat, state.lon, r);
      state.osmSource = 'Photon (fallback — fewer details)';
    }
    const els = data.elements.map((el) => {
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      return { ...el, lat, lon, t: el.tags || {}, d: haversine(state.lat, state.lon, lat, lon) };
    }).filter((e) => e.lat != null);
    const seen = new Set();
    const uniq = els.filter((e) => { const k = (e.t.name || '') + e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
    renderSights(uniq);
    renderCafes(uniq);
    renderTransport(uniq);
    renderEvents(uniq);
  } catch (e) {
    ['sights', 'cafes', 'transport', 'events'].forEach((id) => fail(id, 'OpenStreetMap data', e));
  }
}

const isSight = (t) => t.tourism && /^(attraction|museum|viewpoint|gallery|zoo|theme_park|aquarium)$/.test(t.tourism)
  || t.historic || (t.amenity === 'place_of_worship' && t.wikidata) || t.natural === 'beach' || (t.leisure && t.wikidata);

function sightKind(t) {
  if (t.tourism === 'museum') return 'Museum';
  if (t.tourism === 'gallery') return 'Gallery';
  if (t.tourism === 'viewpoint') return 'Viewpoint';
  if (t.historic) return 'Historic · ' + t.historic.replace(/_/g, ' ');
  if (t.amenity === 'place_of_worship') return `Place of worship${t.religion ? ' · ' + t.religion : ''}`;
  if (t.natural === 'beach') return 'Beach';
  if (t.leisure) return t.leisure.replace(/_/g, ' ');
  return (t.tourism || 'Attraction').replace(/_/g, ' ');
}

function renderSights(els) {
  const list = els.filter((e) => isSight(e.t) && !e.t.amenity?.match(/cafe|bar|pub/))
    // rank: things with Wikipedia/Wikidata are usually more notable, then by distance
    .map((e) => ({ ...e, score: e.d / 1000 - (e.t.wikipedia || e.t.wikidata ? 3 : 0) - (e.t.tourism === 'attraction' || e.t.tourism === 'museum' ? 1 : 0) }))
    .sort((a, b) => a.score - b.score).slice(0, 25);
  if (!list.length) return setBody('sights', '<p class="muted">No mapped attractions within range. Try a bigger radius in ⚙ Settings.</p>');
  list.forEach((e) => addPin(e.lat, e.lon, e.t.name, '#7c3aed'));
  setBody('sights', `<ul class="list">${list.map((e) => {
    const wp = e.t.wikipedia ? e.t.wikipedia.split(':') : null;
    const wpLink = wp ? `<a href="https://${wp[0]}.wikipedia.org/wiki/${encodeURIComponent(wp.slice(1).join(':'))}" target="_blank" rel="noopener">Wikipedia</a> · ` : '';
    const extra = [e.t.opening_hours && `🕒 ${esc(e.t.opening_hours)}`, e.t.fee && `fee: ${esc(e.t.fee)}`].filter(Boolean).join(' · ');
    const local = e.t[`name:${state.place?.lang}`] && e.t[`name:${state.place.lang}`] !== e.t.name ? ` <span class="muted">(${esc(e.t[`name:${state.place.lang}`])})</span>` : '';
    return `<li><div class="main"><div class="name">${esc(e.t['name:en'] || e.t.name)}${local}</div>
      <div class="meta">${esc(sightKind(e.t))}${extra ? ' · ' + extra : ''}</div>
      <div class="meta">${wpLink}<a href="${gmaps(e.t.name, e.lat, e.lon)}" target="_blank" rel="noopener">Directions</a> · <a href="${osmLink(e)}" target="_blank" rel="noopener">OSM</a></div></div>
      <div class="dist">${fmtDist(e.d)}</div></li>`;
  }).join('')}</ul><p><span class="badge real">live</span><span class="small muted">OpenStreetMap via ${esc(state.osmSource)} — notable (Wikipedia-linked) places ranked higher</span></p>`);
}

function renderCafes(els) {
  const list = els.filter((e) => e.t.amenity === 'cafe' || /^(tea|coffee|bakery)$/.test(e.t.shop || ''))
    .map((e) => {
      const chain = !!(e.t.brand || e.t['brand:wikidata']);
      // "cheaper" heuristic: independent spots, tea/bakery shops, no "premium" hints, tend to be cheaper than chains.
      let cheap = 0;
      if (!chain) cheap += 2;
      if (/tea|bakery/.test(e.t.shop || '') || /tea|indian|kerala|regional|local|snack/i.test(e.t.cuisine || '')) cheap += 1;
      if (/starbucks|costa|third wave|blue tokai|tim hortons/i.test(e.t.name)) cheap -= 2;
      return { ...e, chain, cheap };
    })
    // each "budget" point is worth ~250 m of extra walking
    .sort((a, b) => (a.d - a.cheap * 250) - (b.d - b.cheap * 250)).slice(0, 20);
  if (!list.length) return setBody('cafes', '<p class="muted">No cafés mapped within 2 km.</p>');
  list.forEach((e) => addPin(e.lat, e.lon, e.t.name, '#b45309'));
  setBody('cafes', `<ul class="list">${list.map((e) => {
    const tags = [
      e.chain ? `<span class="badge">chain: ${esc(e.t.brand || 'yes')}</span>` : '<span class="badge real">independent</span>',
      e.cheap >= 3 ? '<span class="badge">likely budget</span>' : '',
      e.t.cuisine ? `<span class="badge">${esc(e.t.cuisine.replace(/_/g, ' ').replace(/;/g, ', '))}</span>` : '',
      e.t.shop ? `<span class="badge">${esc(e.t.shop)} shop</span>` : '',
    ].join('');
    const reviewQ = encodeURIComponent(`${e.t.name} ${state.place?.city || ''} reviews`);
    const localQ = state.place?.lang ? `<a href="https://www.google.com/search?q=${reviewQ}&hl=${state.place.lang}" target="_blank" rel="noopener">${LANG_NAME[state.place.lang] || state.place.lang} reviews</a> · ` : '';
    return `<li><div class="main"><div class="name">${esc(e.t.name)}</div>
      <div class="meta">${tags}</div>
      <div class="meta">${e.t.opening_hours ? '🕒 ' + esc(e.t.opening_hours) + ' · ' : ''}${walk(e.d)}</div>
      <div class="meta"><a href="${gmaps(e.t.name, e.lat, e.lon)}" target="_blank" rel="noopener">Reviews &amp; map</a> · ${localQ}<a href="https://www.google.com/search?q=${reviewQ}" target="_blank" rel="noopener">Search reviews</a></div></div>
      <div class="dist">${fmtDist(e.d)}</div></li>`;
  }).join('')}</ul>
  <p><span class="badge real">live</span><span class="small muted">Café list from OpenStreetMap.</span>
  <span class="badge ph">placeholder</span><span class="small muted">Prices &amp; ratings: OSM has none, so "budget" is a heuristic (independent / tea shop / local cuisine) and reviews are links out. Real ratings need Google Places or Foursquare (keys).</span></p>`);
}

function transportKind(t) {
  if (t.station === 'subway' || t.station === 'light_rail' || t.station === 'monorail') return ['Metro', '🚇'];
  if (t.railway === 'station' || t.railway === 'halt') return ['Train', '🚆'];
  if (t.amenity === 'bus_station') return ['Bus station', '🚌'];
  if (t.highway === 'bus_stop') return ['Bus stop', '🚏'];
  if (t.amenity === 'ferry_terminal') return ['Ferry / water metro', '⛴️'];
  if (t.amenity === 'taxi') return ['Taxi / auto stand', '🚕'];
  if (t.amenity === 'bicycle_rental') return ['Bike rental', '🚲'];
  if (t.amenity === 'car_rental') return ['Car rental', '🚗'];
  if (t.amenity === 'boat_rental') return ['Boat rental', '🛶'];
  if (t.public_transport === 'station') return ['Station', '🚉'];
  return null;
}

function renderTransport(els) {
  const groups = {};
  for (const e of els) {
    const k = transportKind(e.t);
    if (!k) continue;
    (groups[k[0]] ||= { icon: k[1], items: [] }).items.push(e);
  }
  const order = ['Metro', 'Train', 'Ferry / water metro', 'Bus station', 'Bus stop', 'Station', 'Taxi / auto stand', 'Bike rental', 'Car rental', 'Boat rental'];
  const keys = order.filter((k) => groups[k]);
  const { lat, lon } = state;
  const links = `<div class="links">
    <a href="https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=15&layer=transit" target="_blank" rel="noopener">Transit map</a>
    <a href="https://moovitapp.com/" target="_blank" rel="noopener">Moovit</a>
    <a href="https://m.uber.com/" target="_blank" rel="noopener">Uber</a>
    ${state.place?.cc === 'in' ? '<a href="https://www.olacabs.com/" target="_blank" rel="noopener">Ola</a><a href="https://www.rapido.bike/" target="_blank" rel="noopener">Rapido</a>' : ''}
  </div>`;
  if (!keys.length) return setBody('transport', `<p class="muted">No transit stops mapped nearby.</p>${links}`);
  setBody('transport', keys.map((k) => {
    const g = groups[k];
    const items = g.items.sort((a, b) => a.d - b.d).slice(0, k === 'Bus stop' ? 5 : 4);
    items.forEach((e) => addPin(e.lat, e.lon, `${k}: ${e.t.name || ''}`, '#2563eb'));
    return `<div class="group">${g.icon} ${k}</div><ul class="list">${items.map((e) => {
      const routes = e.t.route_ref || e.t.ref || e.t.network || e.t.operator || '';
      return `<li><div class="main"><div class="name">${esc(e.t['name:en'] || e.t.name || k)}</div>
        <div class="meta">${routes ? esc(routes) + ' · ' : ''}${walk(e.d)} · <a href="${gmaps(e.t.name, e.lat, e.lon)}" target="_blank" rel="noopener">Directions</a></div></div>
        <div class="dist">${fmtDist(e.d)}</div></li>`;
    }).join('')}</ul>`;
  }).join('') + links + `<p><span class="badge real">live</span><span class="small muted">Stops/stations from OpenStreetMap.</span>
  <span class="badge ph">placeholder</span><span class="small muted">No live timetables or fares yet — needs GTFS / GTFS-Realtime per city (e.g. via Transitland).</span></p>`);
}

/* ---------- events ---------- */
async function renderEvents(els) {
  const venues = els.filter((e) => /^(nightclub|bar|pub|arts_centre|theatre|community_centre|cinema|events_venue|music_venue)$/.test(e.t.amenity || '') || e.t.office === 'coworking')
    .sort((a, b) => a.d - b.d);
  const night = venues.filter((e) => /nightclub|bar|pub/.test(e.t.amenity || '')).slice(0, 6);
  const learn = venues.filter((e) => /arts_centre|community_centre|theatre|events_venue|music_venue/.test(e.t.amenity || '') || e.t.office === 'coworking').slice(0, 6);
  const city = state.place?.city || '';
  const cc = state.place?.cc || '';
  const slug = city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  const searchLinks = `<div class="links">
    <a href="https://allevents.in/${slug}/all" target="_blank" rel="noopener">AllEvents: ${esc(city)}</a>
    <a href="https://www.meetup.com/find/?location=${encodeURIComponent(city)}&source=EVENTS" target="_blank" rel="noopener">Meetup</a>
    <a href="https://www.eventbrite.com/d/${encodeURIComponent(cc)}--${slug}/all-events/" target="_blank" rel="noopener">Eventbrite</a>
    <a href="https://www.eventbrite.com/d/${encodeURIComponent(cc)}--${slug}/classes/" target="_blank" rel="noopener">Workshops &amp; classes</a>
    ${cc === 'in' ? `<a href="https://in.bookmyshow.com/explore/events-${slug}" target="_blank" rel="noopener">BookMyShow</a><a href="https://www.district.in/events/" target="_blank" rel="noopener">District</a>` : ''}
  </div>`;
  const venueList = (arr, color) => arr.length ? `<ul class="list">${arr.map((e) => {
    addPin(e.lat, e.lon, e.t.name, color);
    return `<li><div class="main"><div class="name">${esc(e.t.name)}</div>
      <div class="meta">${esc((e.t.amenity || e.t.office || '').replace(/_/g, ' '))}${e.t.opening_hours ? ' · 🕒 ' + esc(e.t.opening_hours) : ''}${e.t.website ? ` · <a href="${esc(e.t.website)}" target="_blank" rel="noopener">website</a>` : ''}</div></div>
      <div class="dist">${fmtDist(e.d)}</div></li>`;
  }).join('')}</ul>` : '<p class="muted small">None mapped nearby.</p>';

  let live = '';
  const key = store.get('tmKey', '');
  if (key) {
    try {
      const u = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&latlong=${state.lat},${state.lon}&radius=30&unit=km&size=15&sort=date,asc`;
      const j = await getJSON(u);
      const evs = j._embedded?.events || [];
      live = `<div class="group">🎫 Upcoming (Ticketmaster)</div>` + (evs.length ? `<ul class="list">${evs.map((ev) => `<li><div class="main"><div class="name"><a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.name)}</a></div>
        <div class="meta">${esc(ev.dates?.start?.localDate || '')} ${esc(ev.dates?.start?.localTime?.slice(0, 5) || '')} · ${esc(ev._embedded?.venues?.[0]?.name || '')} · ${esc(ev.classifications?.[0]?.segment?.name || '')}</div></div></li>`).join('')}</ul>` : '<p class="muted small">Ticketmaster has no events listed here (its coverage is mostly US/EU/AU).</p>');
    } catch (e) { live = `<p class="err small">Ticketmaster request failed: ${esc(e.message)}</p>`; }
  }
  setBody('events', `${live}
    <div class="group">🌙 Night spots nearby</div>${venueList(night, '#db2777')}
    <div class="group">🎨 Workshop &amp; culture venues</div>${venueList(learn, '#0891b2')}
    <div class="group">🔎 Find dated events</div>${searchLinks}
    <p><span class="badge real">live</span><span class="small muted">Venues from OpenStreetMap.</span>
    <span class="badge ph">placeholder</span><span class="small muted">${key ? 'Ticketmaster live list above; ' : ''}workshops/trainings/parties with dates need an events feed — ${key ? '' : 'add a free Ticketmaster key in ⚙ for US/EU cities; '}Meetup &amp; AllEvents need partner/paid access, so they're links for now.</span></p>`);
}

/* ---------- history & facts (Wikipedia + Wikidata) ---------- */
async function wikiSummary(lang, title) {
  return getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
}

function claimVal(ent, p) {
  const c = ent.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
  if (c == null) return null;
  if (c.time) {
    const y = parseInt(c.time.slice(0, 5), 10);
    return y < 0 ? `${-y} BCE` : `${y}`;
  }
  if (c.amount) return Number(c.amount).toLocaleString();
  if (c.text) return c.text;
  return null;
}

async function loadHistory() {
  loading('history', 'facts & history');
  const p = state.place || {};
  const city = p.city || p.locality;
  let html = '';
  try {
    // 1. The town/city itself
    let summary = null;
    if (city) {
      for (const t of [`${city}`, `${city}, ${p.state || ''}`]) {
        try { summary = await wikiSummary('en', t); if (summary.type !== 'disambiguation') break; summary = null; } catch {}
      }
    }
    if (summary) {
      html += `<div style="display:flex;gap:12px">${summary.thumbnail ? `<img class="thumb" src="${esc(summary.thumbnail.source)}" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:10px">` : ''}
        <div><b>${esc(summary.title)}</b>${summary.description ? ` <span class="muted">— ${esc(summary.description)}</span>` : ''}
        <p style="margin:4px 0">${esc(summary.extract)}</p>
        <a href="${esc(summary.content_urls?.desktop?.page)}" target="_blank" rel="noopener">Read more on Wikipedia</a></div></div>`;
      if (summary.wikibase_item) html += await wikidataFacts(summary.wikibase_item, p.lang);
    }
    // 2. Notable articles geotagged around you
    const nearby = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${state.lat}|${state.lon}&ggsradius=10000&ggslimit=15&prop=extracts|pageimages|coordinates&exintro=1&explaintext=1&exsentences=2&exlimit=max&piprop=thumbnail&pithumbsize=160`);
    const pages = Object.values(nearby.query?.pages || {})
      .map((pg) => ({ ...pg, d: pg.coordinates ? haversine(state.lat, state.lon, pg.coordinates[0].lat, pg.coordinates[0].lon) : 1e9 }))
      .filter((pg) => !summary || pg.title !== summary.title)
      .sort((a, b) => a.d - b.d).slice(0, 10);
    if (pages.length) {
      html += `<div class="group">📜 Stories around you</div><ul class="list">${pages.map((pg) => `<li>
        ${pg.thumbnail ? `<img class="thumb" src="${esc(pg.thumbnail.source)}" alt="" loading="lazy">` : ''}
        <div class="main"><div class="name"><a href="https://en.wikipedia.org/?curid=${pg.pageid}" target="_blank" rel="noopener">${esc(pg.title)}</a></div>
        <div class="meta">${esc(pg.extract || '')}</div></div><div class="dist">${fmtDist(pg.d)}</div></li>`).join('')}</ul>`;
    }
    if (!html) html = '<p class="muted">No Wikipedia coverage found for this spot.</p>';
    html += `<p><span class="badge real">live</span><span class="small muted">Wikipedia (text CC BY-SA) + Wikidata</span></p>`;
    setBody('history', html);
  } catch (e) { fail('history', 'facts & history', e); }
}

async function wikidataFacts(qid, lang) {
  try {
    const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const ent = j.entities[qid];
    const facts = [
      ['Founded', claimVal(ent, 'P571')],
      ['Population', claimVal(ent, 'P1082')],
      ['Elevation', claimVal(ent, 'P2044') && `${claimVal(ent, 'P2044')} m`],
      ['Nickname', claimVal(ent, 'P1449')],
      ['Area', claimVal(ent, 'P2046') && `${claimVal(ent, 'P2046')} km²`],
    ].filter(([, v]) => v);
    let out = facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div>${k}<b>${esc(v)}</b></div>`).join('')}</div>` : '';
    // Local-language view (e.g. Malayalam in Kerala)
    if (lang && lang !== 'en') {
      const label = ent.labels?.[lang]?.value;
      const site = ent.sitelinks?.[`${lang}wiki`]?.title;
      if (site) {
        try {
          const s = await wikiSummary(lang, site);
          out += `<div class="local" lang="${lang}"><div class="small muted">In ${LANG_NAME[lang] || lang}</div>
            <b>${esc(label || s.title)}</b><p style="margin:4px 0">${esc((s.extract || '').slice(0, 420))}${(s.extract || '').length > 420 ? '…' : ''}</p>
            <a href="${esc(s.content_urls?.desktop?.page)}" target="_blank" rel="noopener">${LANG_NAME[lang] || lang} Wikipedia</a></div>`;
        } catch {}
      } else if (label) {
        out += `<p class="small">${LANG_NAME[lang] || lang} name: <b lang="${lang}">${esc(label)}</b></p>`;
      }
    }
    return out;
  } catch { return ''; }
}

/* ---------- wiring ---------- */
$('#gpsBtn').addEventListener('click', useGPS);
async function doSearch(q) {
  const box = $('#searchResults');
  box.innerHTML = '<p class="loading">Searching…</p>';
  try {
    const res = await searchPlace(q);
    if (!res.length) { box.innerHTML = '<p class="muted">No match. Try adding the country.</p>'; return; }
    if (res.length === 1) return setLocation(res[0].lat, res[0].lon, res[0].display_name);
    box.innerHTML = res.map((r, i) => `<button data-i="${i}">${esc(r.display_name)}</button>`).join('');
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const r = res[+b.dataset.i]; setLocation(r.lat, r.lon, r.display_name);
    }));
  } catch (e) { box.innerHTML = `<p class="err">Search failed: ${esc(e.message)}</p>`; }
}
$('#searchForm').addEventListener('submit', (ev) => { ev.preventDefault(); const q = $('#searchInput').value.trim(); if (q) doSearch(q); });
document.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => { $('#searchInput').value = b.dataset.q; doSearch(b.dataset.q); }));

$('#settingsBtn').addEventListener('click', () => {
  $('#radiusSel').value = store.get('radius', '5000');
  $('#tmKey').value = store.get('tmKey', '');
  $('#settings').showModal();
});
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  store.set('radius', $('#radiusSel').value);
  store.set('tmKey', $('#tmKey').value.trim());
  if (state.lat != null) refreshAll();
});

// Deep link support: ?lat=..&lon=.. or ?q=Place
const params = new URLSearchParams(location.search);
if (params.get('lat') && params.get('lon')) setLocation(params.get('lat'), params.get('lon'));
else if (params.get('q')) { $('#searchInput').value = params.get('q'); doSearch(params.get('q')); }

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
