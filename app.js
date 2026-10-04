(() => {
'use strict';
let C = window.CASE;
const $ = (id) => document.getElementById(id);
let SAVE_KEY = 'riven_cold_springs_v1';
const saveKeyFor = (c) => c.type === 'trial' ? 'riven_' + c.id : 'riven_cold_springs_v1';

// ---------- tuning ----------
const T = {
  reach: 35,            // m: close enough to open a reliquary
  sight: 170,           // m: denizens drawn on the map inside this range
  hear: 230,            // m: denizens audible inside this range
  linger: 300,          // s in one 40 m spot before something comes looking
  lingerRadius: 40,
  catchDwell: 3,        // s inside catch radius before you lose a candle
  ward: 30,             // s of protection after losing a candle
  banish: 90,           // s a denizen is gone after catching you
  recover: 120,         // s to relight candles after losing all three
  hereScale: 0.55,      // "Around me": the case folded to this fraction of its real size
  walk: 1.4,            // m/s desk-mode walking pace
};
const KIND = {
  ali:  { perceive: 50, catch: 12, patrol: 0.9, hunt: 2.0, giveUp: 110, label: 'Ali' },
  devi: { perceive: 80, catch: 14, patrol: 0.6, hunt: 1.3, giveUp: 170, label: 'Devi' },
};
const LINES = {
  ali: ['tbili... tbili...', 'I can smell the sulfur on you', 'come down to the water', 'the springs are cold, little one'],
  devi: ['who climbs my hill', 'I hear your little heart', 'run then'],
};

// ---------- geo ----------
const R = 6371000, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
function dist(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function offset(p, north, east) {
  return [p[0] + deg(north / R), p[1] + deg(east / (R * Math.cos(rad(p[0]))))];
}
function enu(origin, p) { // metres north/east of origin
  return [rad(p[0] - origin[0]) * R, rad(p[1] - origin[1]) * R * Math.cos(rad(origin[0]))];
}
function moveToward(p, target, metres) {
  const d = dist(p, target);
  if (d <= metres || d === 0) return target.slice();
  const [n, e] = enu(p, target);
  return offset(p, n * metres / d, e * metres / d);
}
const norm180 = (a) => ((a + 540) % 360) - 180;
const fmtDist = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- state ----------
let S = null; // persisted
const live = { player: null, heading: null, gpsOK: false, target: null, speed: 1, map: null, layers: {}, dens: [], audio: null, sound: true, huntedBy: new Set(), lastTick: 0, wakeLock: null, overlayOpen: false, linger: null, shrine: null, recoverUntil: 0, wardUntil: 0, toastTimer: 0 };

function freshState(where, move) {
  return { where, move, anchor: null, status: {}, evidence: [], candles: 3, marks: {}, solvedOrder: [], ended: null, started: Date.now(), wrongAccusations: 0, siteNudge: {} };
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }

// World geometry: either real Tbilisi or the case folded around an anchor point.
function centroidOf(c) {
  const pts = c.route || c.sites.map((s) => s.pos);
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
let caseCentroid = centroidOf(C);
function chooseCase(id) {
  C = window.CASES[id] || window.CASE; caseCentroid = centroidOf(C); SAVE_KEY = saveKeyFor(C); routeCum = null;
  T.reach = C.type === 'trial' ? 60 : 35; // the plaza is a big building; GPS indoors is loose
}
const isTrial = () => C.type === 'trial';
function W(p) {
  if (S.where === 'city' || !S.anchor) return p;
  const [n, e] = enu(caseCentroid, p);
  return offset(S.anchor, n * T.hereScale, e * T.hereScale);
}
const scaleR = (r) => S.where === 'city' ? r : r * Math.max(T.hereScale, 0.7);
function sitePos(site) {
  const nudge = S.siteNudge[site.id];
  const p = (S.snap && S.snap.sites[site.id]) || W(site.pos);
  return nudge ? offset(p, nudge[0], nudge[1]) : p;
}
function sanctPos(i) { const sa = C.sanctuaries[i]; return (S.snap && S.snap.sanct[i]) || W([sa[0], sa[1]]); }
// "Around me": move each folded site onto the nearest walkable street (so nothing lands in a reservoir).
async function snapToStreets() {
  if (S.where !== 'here' || !S.anchor || S.snap) return;
  const [la, ln] = S.anchor, dLat = 0.012, dLng = 0.012 / Math.cos(rad(la));
  const q = `[out:json][timeout:25];way[highway~"^(footway|pedestrian|path|living_street|residential|service|unclassified|tertiary|steps|secondary)$"][access!=private](${la - dLat},${ln - dLng},${la + dLat},${ln + dLng});node(w);out skel;`;
  try {
    let json = null;
    for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (r.ok) { json = await r.json(); break; } } catch (e) {}
    }
    if (!json) return;
    const nodes = (json.elements || []).filter((e) => e.type === 'node').map((e) => [e.lat, e.lon]);
    if (nodes.length < 20) return;
    const nearest = (p) => { let best = null, bd = Infinity; for (const n of nodes) { const d = dist(p, n); if (d < bd) { bd = d; best = n; } } return best; };
    S.snap = { sites: {}, sanct: {} };
    C.sites.forEach((site) => { S.snap.sites[site.id] = nearest(W(site.pos)); });
    C.sanctuaries.forEach((sa, i) => { S.snap.sanct[i] = nearest(W([sa[0], sa[1]])); });
    S.siteNudge = {}; save(); buildWorld();
    toast('The case has settled onto your streets. Every seal is on a path you can walk.');
  } catch (e) {}
}
function siteState(site) {
  if (S.status[site.id] === 'solved') return 'solved';
  if (site.opensAtStart) return 'open';
  return (site.requires || []).every((r) => S.status[r] === 'solved') ? 'open' : 'locked';
}
const solvedCount = () => C.sites.filter((s) => S.status[s.id] === 'solved').length;

// ---------- UI helpers ----------
function toast(msg, ms = 4200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(live.toastTimer); live.toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
function renderCandles() {
  const c = $('candles'); c.innerHTML = '';
  for (let i = 0; i < 3; i++) c.append(el('div', { class: 'candle' + (i < S.candles ? '' : ' out') }));
}
function renderHud() {
  renderCandles();
  $('hudCase').textContent = C.title;
  $('hudProg').textContent = isTrial() ? (S.ended ? 'Made it' : `Spotted ${S.spotted || 0}× · get to the plaza`) : `${solvedCount()} / ${C.sites.length} seals broken`;
}

// ---------- audio (procedural; no files) ----------
function initAudio() {
  if (live.audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  live.audio = { ctx, master, noiseBuf, nextBeat: 0 };
  // iOS: unlock speech inside the gesture
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
}
function denVoice(den) {
  const A = live.audio; if (!A || den.voice) return;
  const { ctx } = A;
  const out = ctx.createGain(); out.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (den.kind === 'ali' || den.kind === 'volto') { // breathy whisper: band-passed noise, wobbling
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rnd(0.25, 0.6);
    const lfoG = ctx.createGain(); lfoG.gain.value = 900; lfo.connect(lfoG); lfoG.connect(bp.frequency);
    src.connect(bp); bp.connect(out); src.start(); lfo.start();
  } else { // devi: low growl
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const trem = ctx.createOscillator(); trem.frequency.value = 3.2;
    const tremG = ctx.createGain(); tremG.gain.value = 0.5; trem.connect(tremG);
    const vca = ctx.createGain(); vca.gain.value = 0.5; tremG.connect(vca.gain);
    o.connect(lp); lp.connect(vca); vca.connect(out); o.start(); trem.start();
  }
  if (pan) { out.connect(pan); pan.connect(A.master); } else out.connect(A.master);
  den.voice = { out, pan };
}
function beat() {
  const A = live.audio; if (!A || !live.sound) return;
  const { ctx } = A, t = ctx.currentTime;
  [0, 0.22].forEach((dt, i) => {
    const o = ctx.createOscillator(); o.frequency.value = 55;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(i ? 0.5 : 0.8, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.25);
    o.connect(g); g.connect(A.master); o.start(t + dt); o.stop(t + dt + 0.3);
  });
}
function chime(up = true) {
  const A = live.audio; if (!A || !live.sound) return;
  const { ctx } = A, t = ctx.currentTime;
  (up ? [523, 659, 784, 1046] : [392, 311, 233]).forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.25, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 1.2);
    o.connect(g); g.connect(A.master); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1.3);
  });
}
function say(text, kind) {
  if (!live.sound || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = kind === 'devi' ? 0.6 : 0.75; u.pitch = kind === 'devi' ? 0.1 : 0.4; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function readAloud(text) {
  if (!window.speechSynthesis) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.92; u.pitch = 0.9; speechSynthesis.speak(u); } catch (e) {}
}

// ---------- sensors ----------
async function askCompass() {
  const DOE = window.DeviceOrientationEvent;
  try { if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission(); } catch (e) {}
  const onOri = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h != null) live.heading = h;
  };
  window.addEventListener('deviceorientationabsolute', onOri);
  window.addEventListener('deviceorientation', onOri);
}
function startGPS() {
  if (!navigator.geolocation) { toast('This browser has no location. Switching to desk mode.'); setDesk(); return; }
  navigator.geolocation.watchPosition((p) => {
    const pos = [p.coords.latitude, p.coords.longitude];
    if (!live.gpsOK) {
      live.gpsOK = true;
      if (S.where === 'here' && !S.anchor) { S.anchor = pos; save(); buildWorld(); snapToStreets(); }
      if (S.move === 'gps' || !live.player) { live.player = pos; live.map.setView(pos, isTrial() ? 18 : 17); }
      if (S.move === 'gps' && S.where === 'city' && dist(pos, caseCentroid) > 5000) toast(isTrial() ? 'You are far from the trial route. Pick Desk mode on the title screen to walk it from here.' : 'You are far from Old Tbilisi. Pick Desk mode on the title screen to walk its streets from here.', 7000);
    }
    if (S.move === 'gps') live.player = pos;
  }, (err) => {
    if (S.move === 'gps') toast('Location is blocked, so desk mode is on. Allow location in Settings › Safari to play on foot.', 7000);
    if (!live.player) { live.player = S.anchor || [1.2868, 103.8545]; if (S.where === 'here' && !S.anchor) { S.anchor = live.player.slice(); save(); buildWorld(); snapToStreets(); } live.map.setView(live.player, 17); }
    if (S.move === 'gps') setDesk();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
async function wake() { try { live.wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S) wake(); });

function setDesk() {
  S.move = 'desk'; save();
  if (!live.player) {
    if (isTrial()) live.player = C.start.slice();
    else if (S.where === 'city') live.player = [41.68935, 44.80930]; // Meidan square, between the first two leads
    else if (S.anchor) live.player = S.anchor.slice();
    // else: wait for the first GPS fix to fold the case around you
  }
  $('btnSpeed').hidden = false; $('deskHint').hidden = false;
}

// ---------- map ----------
function initMap() {
  const map = L.map('map', { zoomControl: false, attributionControl: true, tap: true }).setView(caseCentroid, 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  map.on('dragstart', () => { live.follow = false; });
  map.on('click', (e) => {
    if (S?.move !== 'desk' || live.overlayOpen) return;
    live.target = [e.latlng.lat, e.latlng.lng];
    if (live.layers.target) live.layers.target.setLatLngs([live.player, live.target]);
  });
  live.map = map;
}
function buildWorld() {
  const map = live.map, Ls = live.layers;
  Object.values(Ls).forEach((l) => { if (l && l.remove) l.remove(); });
  live.layers = {};
  const sanct = L.layerGroup().addTo(map);
  C.sanctuaries.forEach(([la, ln, r, name], i) => {
    L.circle(sanctPos(i), { radius: scaleR(r), color: '#5fa08d', weight: 1, dashArray: '4 4', fillColor: '#5fa08d', fillOpacity: 0.12 }).bindTooltip(`${name} · sanctuary`).addTo(sanct);
  });
  live.layers.sanct = sanct;
  live.layers.sites = L.layerGroup().addTo(map);
  live.layers.dens = L.layerGroup().addTo(map);
  live.layers.target = L.polyline([], { color: '#f0a54a', weight: 2, dashArray: '2 8', opacity: 0.7 }).addTo(map);
  live.layers.player = L.marker(live.player || caseCentroid, { icon: L.divIcon({ className: '', html: '<div class="mk-player"><div class="cone" id="cone"></div></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
  drawSites();
  if (isTrial()) { drawRoute(); spawnTrial(); } else spawnDens();
}
function drawSites() {
  const g = live.layers.sites; g.clearLayers();
  C.sites.forEach((s) => {
    const st = siteState(s);
    if (st === 'locked') return;
    const m = L.marker(sitePos(s), { icon: L.divIcon({ className: '', html: `<div class="mk-site ${st}"><div class="seal">${s.num}</div></div>`, iconSize: [46, 46], iconAnchor: [23, 23] }) });
    m.on('click', () => showSiteCard(s));
    if (st !== 'solved') L.circle(sitePos(s), { radius: T.reach, color: '#d8c25a', weight: 1, opacity: 0.5, fillOpacity: 0.05, interactive: false }).addTo(g);
    m.addTo(g);
  });
}

// ---------- denizens ----------
function spawnDens() {
  live.dens.forEach((d) => { try { d.voice?.out.disconnect(); } catch (e) {} });
  live.dens = C.denizens.map((d) => makeDen(d.kind, d.name, W(d.home), scaleR(d.patrol)));
}
function makeDen(kind, name, home, patrol) {
  const pos = offset(home, rnd(-patrol, patrol) * 0.5, rnd(-patrol, patrol) * 0.5);
  const den = { kind, name, home, patrol, pos, wp: null, mode: 'patrol', huntT: 0, inCatch: 0, banishedUntil: 0, marker: null, spokeAt: 0 };
  den.marker = L.marker(pos, { icon: L.divIcon({ className: '', html: `<div class="mk-den ${kind}"><div class="eye"></div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false });
  if (live.audio) denVoice(den);
  return den;
}
function inSanctuary(p) {
  if (C.sanctuaries.some(([la, ln, r], i) => dist(p, sanctPos(i)) < scaleR(r))) return true;
  if (live.shrine && dist(p, live.shrine) < T.reach + 10) return true;
  return C.sites.some((s) => S.status[s.id] === 'solved' && dist(p, sitePos(s)) < 20);
}
function stepDens(dt, now) {
  const P = live.player; if (!P) return;
  const safe = inSanctuary(P) || now < live.wardUntil || now < live.recoverUntil;
  live.huntedBy.clear();
  for (const d of live.dens) {
    const K = KIND[d.kind];
    if (now < d.banishedUntil) { d.marker.remove(); continue; }
    const dp = dist(d.pos, P);
    // perception
    if (d.mode === 'patrol' && !safe && dp < K.perceive) {
      d.mode = 'hunt'; d.huntT = 0;
      if (now - d.spokeAt > 20000) { d.spokeAt = now; say(pick(LINES[d.kind]), d.kind); }
      toast(`${d.name} has your scent. Get to a church or outrun it.`);
    }
    if (d.mode === 'hunt') {
      d.huntT += dt;
      if (safe || d.huntT > K.giveUp || dp > K.perceive * 2.5) { d.mode = 'patrol'; d.wp = null; if (safe && dp < K.perceive) toast('It will not cross holy ground. It waits.'); }
    }
    if (d.mode === 'hunt') {
      live.huntedBy.add(d);
      d.pos = moveToward(d.pos, P, K.hunt * dt);
      if (dp < K.catch) {
        d.inCatch += dt;
        if (d.inCatch >= T.catchDwell) caught(d, now);
      } else d.inCatch = Math.max(0, d.inCatch - dt);
    } else {
      if (!d.wp || dist(d.pos, d.wp) < 4) d.wp = offset(d.home, rnd(-d.patrol, d.patrol), rnd(-d.patrol, d.patrol));
      let next = moveToward(d.pos, d.wp, K.patrol * dt);
      if (inSanctuary(next) && !inSanctuary(d.pos)) d.wp = null; else d.pos = next;
    }
    // draw if in sight
    if (dp < T.sight) { d.marker.setLatLng(d.pos); if (!live.map.hasLayer(d.marker)) d.marker.addTo(live.layers.dens); const n = d.marker.getElement()?.firstChild; if (n) n.className = `mk-den ${d.kind}${d.mode === 'hunt' ? ' hunting' : ''}`; }
    else d.marker.remove();
    // audio
    if (d.voice && live.audio) {
      const vol = live.sound && dp < T.hear ? Math.pow(1 - dp / T.hear, 2) * (d.kind === 'devi' ? 0.9 : 0.55) * (d.mode === 'hunt' ? 1.4 : 1) : 0;
      d.voice.out.gain.setTargetAtTime(vol, live.audio.ctx.currentTime, 0.4);
      if (d.voice.pan) {
        const rel = norm180(bearing(P, d.pos) - (live.heading ?? 0));
        d.voice.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(rad(rel)))), live.audio.ctx.currentTime, 0.3);
      }
    }
  }
  $('hunted').hidden = live.huntedBy.size === 0 || live.overlayOpen;
  if (live.huntedBy.size && live.audio && now > live.audio.nextBeat) { beat(); live.audio.nextBeat = now + 850; }
}
function caught(d, now) {
  d.inCatch = 0; d.mode = 'patrol'; d.banishedUntil = now + T.banish * 1000; d.pos = offset(d.home, 0, 0);
  S.candles = Math.max(0, S.candles - 1); save(); renderCandles(); chime(false);
  if (navigator.vibrate) navigator.vibrate([200, 80, 400]);
  if (S.candles === 0) {
    live.recoverUntil = now + T.recover * 1000;
    showOverlay([
      el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'ALL CANDLES OUT'), el('h2', { class: 'ov-title' }, `${d.name} took the last light`)),
      el('p', { class: 'ov-text' }, 'You come to on a bench with the taste of sulfur in your mouth. Your casebook is still in your pocket. Nothing you found is lost.\n\nSit for two minutes while the candles relight. Nothing can touch you until they do.'),
      el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Back to the map')),
    ]);
    setTimeout(() => { if (S.candles === 0) { S.candles = 3; save(); renderCandles(); toast('Your candles are lit again.'); } }, T.recover * 1000);
  } else {
    live.wardUntil = now + T.ward * 1000;
    toast(`${d.name} caught you. One candle out. You have ${T.ward} seconds of grace.`, 6000);
  }
}
function lingerCheck(now) {
  const P = live.player; if (!P || live.overlayOpen) return;
  if (!live.linger || dist(live.linger.p, P) > T.lingerRadius) { live.linger = { p: P.slice(), t: now }; return; }
  if (inSanctuary(P)) { live.linger.t = now; return; }
  if ((now - live.linger.t) / 1000 > T.linger) {
    const b = rnd(0, 360), p = offset(P, Math.cos(rad(b)) * 75, Math.sin(rad(b)) * 75);
    const d = makeDen('ali', 'A drawn Ali', p, 60);
    d.mode = 'hunt'; live.dens.push(d);
    say('you stayed too long', 'ali');
    toast('You stayed too long in one place. Something came up from the water to look.', 6000);
    live.linger = { p: P.slice(), t: now };
  }
}

// ---------- lead / sheet ----------
let leadIdx = 0;
function openSites() { return C.sites.filter((s) => siteState(s) === 'open'); }
function currentLead() {
  const open = openSites(); if (!open.length || !live.player) return null;
  open.sort((a, b) => dist(live.player, sitePos(a)) - dist(live.player, sitePos(b)));
  return open[leadIdx % open.length];
}
function updateSheet() {
  const s = currentLead();
  if (!s) { $('leadName').textContent = S.ended ? 'Case closed' : 'No open leads'; $('leadDist').textContent = ''; $('btnOpen').hidden = true; return; }
  const d = dist(live.player, sitePos(s)), b = bearing(live.player, sitePos(s));
  $('leadLabel').textContent = `Lead ${s.num}${openSites().length > 1 ? ` · ${openSites().length} open` : ''}`;
  $('leadName').textContent = s.name;
  $('leadDist').textContent = d <= T.reach ? 'You are here' : `${fmtDist(d)} · ${Math.round(b)}°`;
  const rot = b - (S.move === 'gps' && live.heading != null ? live.heading : 0);
  $('leadArrow').firstChild.style.transform = `rotate(${rot}deg)`;
  $('btnOpen').hidden = d > T.reach;
  $('btnOpen').onclick = () => beginSite(s);
}
function showSiteCard(s) {
  const st = siteState(s), d = live.player ? dist(live.player, sitePos(s)) : Infinity;
  const kids = [
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, `SEAL ${s.num}`), el('h2', { class: 'ov-title' }, s.name), el('div', { class: 'ov-place' }, s.place)),
  ];
  if (st === 'solved') {
    kids.push(el('p', { class: 'ov-text' }, s.lore), el('div', { class: 'section-label' }, 'Evidence'), el('ul', { class: 'evidence' }, s.evidence.map((e) => el('li', {}, e.text))));
  } else {
    kids.push(el('p', { class: 'ov-text' }, s.approach), el('p', { class: 'ov-text', style: 'color:var(--sulfur)' }, d <= T.reach ? 'You are close enough to open it.' : `${fmtDist(d)} away. Get within ${T.reach} m.`));
  }
  const btns = el('div', { class: 'ov-btns' });
  if (st === 'open' && d <= T.reach) btns.append(el('button', { class: 'primary', onclick: () => { hideOverlay(); beginSite(s); } }, 'Open the reliquary'));
  if (st === 'open' && S.where === 'here') btns.append(el('button', { class: 'ghost', onclick: () => { const b = rnd(0, 360); S.siteNudge[s.id] = [Math.cos(rad(b)) * 70, Math.sin(rad(b)) * 70]; save(); drawSites(); hideOverlay(); toast(`${s.name} moved. It sits somewhere you can reach now, hopefully.`); } }, 'I can\'t reach this spot. Move it.'));
  btns.append(el('button', { class: 'ghost', onclick: hideOverlay }, 'Close'));
  kids.push(btns);
  showOverlay(kids);
}

// ---------- overlays ----------
function showOverlay(kids) {
  const inner = $('ovInner'); inner.innerHTML = ''; kids.forEach((k) => inner.append(k));
  $('overlay').hidden = false; $('overlay').scrollTop = 0; live.overlayOpen = true;
}
function hideOverlay() { $('overlay').hidden = true; live.overlayOpen = false; live.shrine = null; }

// ---------- AR seek ----------
const SIGILS = {
  spring: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M22 58 q7-8 14 0 t14 0 t14 0 t14 0" fill="none" stroke="#d8c25a" stroke-width="5"/><path d="M50 22 v20 M42 30 l8 -8 8 8" fill="none" stroke="#d8c25a" stroke-width="5"/>',
  horse: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M30 70 L38 46 L34 32 L46 36 L58 28 L64 40 L70 70" fill="none" stroke="#d8c25a" stroke-width="5" stroke-linejoin="round"/>',
  fig: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M50 28 C30 40 32 72 50 72 C68 72 70 40 50 28 Z M50 28 v-8" fill="none" stroke="#d8c25a" stroke-width="5"/>',
  vine: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M50 20 V80 M34 40 H66 M34 40 l-4 8 M66 40 l4 8" fill="none" stroke="#d8c25a" stroke-width="6" stroke-linecap="round"/>',
  clock: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><circle cx="50" cy="50" r="26" fill="none" stroke="#d8c25a" stroke-width="3"/><path d="M50 50 V32 M50 50 L62 56" stroke="#d8c25a" stroke-width="5" stroke-linecap="round"/>',
  tower: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M34 74 V36 h6 v-8 h6 v8 h8 v-8 h6 v8 h6 V74 Z" fill="none" stroke="#d8c25a" stroke-width="5" stroke-linejoin="round"/>',
  card: '<rect x="26" y="16" width="48" height="68" rx="4" fill="#0d1311" stroke="#d8c25a" stroke-width="4"/><text x="50" y="62" text-anchor="middle" font-family="Georgia,serif" font-size="34" font-weight="700" fill="#d8c25a">7</text>',
  sword: '<circle cx="50" cy="50" r="40" fill="none" stroke="#d8c25a" stroke-width="4"/><path d="M50 18 V70 M38 62 H62 M50 70 v10" stroke="#d8c25a" stroke-width="6" stroke-linecap="round"/>',
};
// ---------- live view (camera + world-pinned 3D) ----------
// look: ghouls and seals appear where they really are around you; seek: a seal is pinned
// somewhere beside or behind you and you turn to find it.
let LV = null;
function denObjects() {
  const P = live.player; if (!P) return [];
  if (isTrial()) return trialObjects(P);
  const now = Date.now();
  return live.dens.map((d, i) => ({ d, i, m: dist(P, d.pos) })).filter(({ d, m }) => now >= d.banishedUntil && m < T.sight).map(({ d, i, m }) => ({
    id: 'den' + i, kind: d.kind, bearing: bearing(P, d.pos), dist: m, hunting: d.mode === 'hunt',
    label: `${d.mode === 'hunt' ? 'HUNTING · ' : ''}${KIND[d.kind].label} · ${Math.round(m)} m`,
  }));
}
function sealObjects() {
  const P = live.player; if (!P) return [];
  return openSites().map((s) => ({ s, m: dist(P, sitePos(s)) })).filter(({ m }) => m < 400).map(({ s, m }) => ({
    id: 'seal' + s.id, kind: 'seal', sigil: s.sigil, svg: SIGILS[s.sigil], bearing: bearing(P, sitePos(s)), dist: m, label: `Seal ${s.num} · ${fmtDist(m)}`,
  }));
}
function liveObjects() {
  if (!LV) return [];
  if (LV.mode === 'seek') return LV.target ? [LV.target] : [];
  return [...denObjects(), ...sealObjects(), ...LV.tests];
}
function reachableSeal() {
  const P = live.player; if (!P) return null;
  return openSites().find((s) => dist(P, sitePos(s)) <= T.reach) || null;
}
function openLive(mode, site) {
  LV = { mode, site: site || null, tests: [], target: null, t0: performance.now(), uiKey: '', gyro: false, facing: 0 };
  if (mode === 'seek') { live.overlayOpen = true; live.shrine = sitePos(site); }
  $('fovVal').textContent = `${RivenAR.fov}°`;
  renderLiveUI(true);
  RivenAR.open({ mode, getObjects: liveObjects, onFound: liveFound, onFrame: liveFrame });
}
function closeLive() {
  if (!LV) return;
  const wasSeek = LV.mode === 'seek';
  RivenAR.close(); LV = null;
  if (wasSeek) { live.overlayOpen = false; live.shrine = null; }
}
function seekWithinLive(site) { // already looking: switch to finding this seal without restarting the camera
  LV.mode = 'seek'; LV.site = site; LV.target = null; LV.t0 = performance.now();
  live.overlayOpen = true; live.shrine = sitePos(site);
  RivenAR.setMode({ mode: 'seek' }); renderLiveUI(true);
}
function liveFound() {
  const site = LV && LV.site;
  chime(true); if (navigator.vibrate) navigator.vibrate(60);
  setTimeout(() => { closeLive(); if (site) { live.shrine = sitePos(site); showPuzzle(site); } }, 250);
}
function liveFrame(info) {
  if (!LV) return;
  LV.gyro = info.gyro; LV.facing = info.facing;
  if (LV.mode === 'seek' && !LV.target && (info.gyro || performance.now() - LV.t0 > 900)) {
    const side = Math.random() < 0.5 ? -1 : 1;
    LV.target = { id: 'target', kind: 'anchor', sigil: LV.site.sigil, svg: SIGILS[LV.site.sigil], bearing: (info.facing + side * rnd(70, 150) + 360) % 360, dist: 3, elev: rnd(-0.3, 0.8), fixed: true, target: true };
  }
  $('live').classList.toggle('hunted', LV.mode === 'look' && live.huntedBy.size > 0);
  renderLiveUI(false);
}
function renderLiveUI(force) {
  const reach = LV.mode === 'look' ? reachableSeal() : null;
  const dens = LV.mode === 'look' ? denObjects() : [];
  const key = [LV.mode, LV.gyro, reach && reach.id, LV.tests.length, dens.length, dens.filter((d) => d.hunting).length].join('|');
  if (!force && key === LV.uiKey) return;
  LV.uiKey = key;
  $('liveStatus').textContent = LV.gyro ? 'Gyro on · pinned to the world' : 'No gyro · swipe to look';
  const btns = $('liveBtns'); btns.innerHTML = '';
  if (LV.mode === 'seek') {
    $('liveTitle').textContent = `Find seal ${LV.site.num}`;
    $('liveSub').textContent = LV.gyro ? 'It is pinned somewhere beside or behind you. Turn slowly, tilt up and down. Hold it in the ring.' : 'Swipe to look around. Hold the seal in the ring.';
    return;
  }
  const hunting = dens.filter((d) => d.hunting).length;
  $('liveTitle').textContent = hunting ? 'Something is hunting you' : dens.length ? `${dens.length} in sight` : 'Nothing in sight';
  $('liveSub').textContent = dens.length ? 'They stand where they really are. Watch them move.' : `Ghouls show up here inside ${T.sight} m. Summon a test one to try it in your room.`;
  if (reach) btns.append(el('button', { class: 'primary', onclick: () => seekWithinLive(reach) }, `Open seal ${reach.num}`));
  btns.append(el('button', { onclick: () => {
    const n = LV.tests.length, side = Math.random() < 0.5 ? -1 : 1;
    LV.tests.push({ id: 'test' + n, kind: n % 2 ? 'devi' : 'ali', fixed: true, dist: rnd(3, 5), bearing: (LV.facing + side * rnd(60, 150) + 360) % 360, label: 'Test · pinned here' });
    toast(`A test ${n % 2 ? 'Devi' : 'Ali'} is standing somewhere ${side < 0 ? 'to your left' : 'to your right'}. Turn to find it.`);
    renderLiveUI(true);
  } }, 'Summon a test ghoul'));
  if (LV.tests.length) btns.append(el('button', { onclick: () => { LV.tests = []; renderLiveUI(true); } }, 'Clear tests'));
}

// ---------- site flow ----------
function beginSite(site) {
  if (siteState(site) !== 'open') return;
  openLive('seek', site); // working a reliquary lights the spot; denizens keep off
}
function puzzleShell(site, body) {
  return [
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, `SEAL ${site.num} · ${site.place.toUpperCase()}`), el('h2', { class: 'ov-title' }, site.name)),
    el('p', { class: 'ov-text' }, site.puzzle.prompt),
    body,
    el('div', { class: 'ov-btns' }, el('button', { class: 'ghost', onclick: hideOverlay }, 'Step away (the seal stays found)')),
  ];
}
function showPuzzle(site) {
  const P = PUZZLES[site.puzzle.type];
  live.shrine = sitePos(site);
  showOverlay(puzzleShell(site, P(site, () => solveSite(site))));
  live.shrine = sitePos(site);
}
function solveSite(site) {
  if (isTrial()) return trialEnd();
  S.status[site.id] = 'solved';
  S.solvedOrder.push(site.id);
  site.evidence.forEach((e) => { if (!S.evidence.includes(e.text)) S.evidence.push(e.text); (e.strikes || []).forEach((k) => (S.marks[k] = 'auto')); });
  save(); chime(true); renderHud(); drawSites();
  const newly = C.sites.filter((s) => (s.requires || []).includes(site.id) && siteState(s) === 'open');
  showOverlay([
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, `SEAL ${site.num} BROKEN`), el('h2', { class: 'ov-title' }, site.name)),
    el('p', { class: 'ov-text' }, site.lore),
    site.evidence.length ? el('div', { class: 'section-label' }, 'Added to your casebook') : null,
    site.evidence.length ? el('ul', { class: 'evidence' }, site.evidence.map((e) => el('li', {}, e.text))) : null,
    newly.length ? el('p', { class: 'ov-text', style: 'color:var(--sulfur)' }, `New lead: ${newly.map((s) => s.name).join(', ')}.`) : null,
    el('div', { class: 'ov-btns' },
      el('button', { class: 'ghost', onclick: () => readAloud(site.lore) }, 'Read it to me'),
      el('button', { class: 'primary', onclick: () => { window.speechSynthesis?.cancel(); hideOverlay(); leadIdx = 0; } }, newly.length ? 'Follow the lead' : 'Back to the map')),
  ]);
}

// ---------- puzzles ----------
const PUZZLES = {
  finish(site, win) { setTimeout(win, 0); return el('div', {}); },
  rings(site, win) {
    const marks = ['F', 'P', 'S'], names = ['falcon', 'pheasant', 'spring'];
    const rot = [rnd(1, 7) | 0, rnd(1, 7) | 0, rnd(1, 7) | 0]; // 8 steps of 45°
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 -18 200 218');
    const draw = () => {
      svg.innerHTML = '';
      [86, 62, 38].forEach((r, i) => {
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('transform', `rotate(${rot[i] * 45} 100 100)`);
        g.innerHTML = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#22302a" stroke-width="20"/>` +
          Array.from({ length: 8 }, (_, k) => `<circle cx="${100 + r * Math.sin(rad(k * 45))}" cy="${100 - r * Math.cos(rad(k * 45))}" r="2" fill="#a9a58f"/>`).join('') +
          `<circle cx="100" cy="${100 - r}" r="9" fill="#d8c25a"/><text x="100" y="${104 - r}" text-anchor="middle" font-family="Spectral SC,serif" font-weight="700" font-size="11" fill="#0d1311" transform="rotate(${-rot[i] * 45} 100 ${100 - r})">${marks[i]}</text>`;
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => turn(i, 1));
        svg.append(g);
      });
      const mark = document.createElementNS(svgNS, 'g');
      mark.innerHTML = '<path d="M100 -2 l9 -14 h-18z" fill="#d8c25a"/><line x1="100" y1="2" x2="100" y2="68" stroke="#d8c25a" stroke-width="1.5" stroke-dasharray="3 4" opacity=".7"/>';
      svg.append(mark);
    };
    const turn = (i, dir) => { rot[i] = (rot[i] + dir + 8) % 8; if (navigator.vibrate) navigator.vibrate(8); draw(); if (rot.every((r) => r === 0)) setTimeout(win, 500); };
    draw();
    return el('div', { class: 'pz' }, svg,
      el('div', { class: 'pz-row' }, names.map((n, i) => el('button', { onclick: () => turn(i, 1) }, `Turn ${n}`))),
      el('div', { class: 'fine' }, 'F falcon · P pheasant · S spring. Tap a ring or its button.'));
  },
  cipher(site, win) {
    const pz = site.puzzle; let shift = 0;
    const plain = el('div', { class: 'cipher-text plain' }), n = el('div', { class: 'shift' }, '0');
    const dec = (s, k) => s.replace(/[A-Z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 65 - k + 26) % 26 + 65));
    const upd = () => { n.textContent = shift; plain.textContent = dec(pz.cipher, shift); };
    const lock = el('button', { class: 'primary', onclick: () => { if (dec(pz.cipher, shift) === pz.answer) win(); else { lock.classList.add('shake'); setTimeout(() => lock.classList.remove('shake'), 400); toast('The plinth stays silent. That is not words.'); } } }, 'Read it aloud to the king');
    upd();
    return el('div', { class: 'pz' },
      el('div', { class: 'section-label' }, 'Scratched on the plinth'), el('div', { class: 'cipher-text' }, pz.cipher),
      el('div', { class: 'section-label' }, 'Shift each letter back by'),
      el('div', { class: 'pz-row' }, el('button', { onclick: () => { shift = (shift + 25) % 26; upd(); } }, '−'), n, el('button', { onclick: () => { shift = (shift + 1) % 26; upd(); } }, '+')),
      plain, lock);
  },
  order(site, win) {
    const items = site.puzzle.items.map((it, i) => ({ ...it, i })).sort(() => Math.random() - 0.5);
    let next = 0; const list = el('div', { class: 'order-list' });
    items.forEach((it) => {
      const b = el('button', {}, el('span', {}, it.label), el('span', { class: 'yr' }, '·'));
      b.onclick = () => {
        if (b.classList.contains('done')) return;
        if (it.i === next) { b.classList.add('done'); b.lastChild.textContent = `${next + 1} · ${it.year}`; next++; if (navigator.vibrate) navigator.vibrate(10); if (next === items.length) setTimeout(win, 700); }
        else { list.classList.add('shake'); setTimeout(() => list.classList.remove('shake'), 400); next = 0; list.querySelectorAll('button').forEach((x) => { x.classList.remove('done'); x.lastChild.textContent = '·'; }); toast('The stones grind back. Start again from the oldest.'); }
      };
      list.append(b);
    });
    return el('div', { class: 'pz' }, el('div', { class: 'fine' }, 'Tap them oldest first. One wrong stone resets the row.'), list);
  },
  lights(site, win) {
    const target = site.puzzle.target; const state = target.slice();
    const press = (st, i) => { const r = (i / 3) | 0, c = i % 3; [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => { if (y >= 0 && y < 3 && x >= 0 && x < 3) st[y * 3 + x] ^= 1; }); };
    do { for (let k = 0; k < 6; k++) press(state, (Math.random() * 9) | 0); } while (state.every((v, i) => v === target[i]));
    const grid = el('div', { class: 'grid3' });
    const draw = () => { grid.innerHTML = ''; state.forEach((v, i) => grid.append(el('button', { class: v ? 'lit' : '', 'aria-label': `Knot ${i + 1}`, onclick: () => { press(state, i); draw(); if (state.every((s, j) => s === target[j])) setTimeout(win, 500); } }))); };
    draw();
    return el('div', { class: 'pz' }, el('div', { class: 'section-label' }, 'The shape to make'), el('div', { class: 'mini3' }, target.map((v) => el('i', { class: v ? 'lit' : '' }))), grid);
  },
  clock(site, win) {
    let h = 12, m = 0; const pz = site.puzzle;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 200');
    const lbl = el('div', { class: 'shift' });
    const draw = () => {
      const ha = (h % 12) * 30 + m / 2, ma = m * 6;
      svg.innerHTML = '<circle cx="100" cy="100" r="90" fill="#16201c" stroke="#d8c25a" stroke-width="3"/>' +
        Array.from({ length: 12 }, (_, k) => `<text x="${100 + 72 * Math.sin(rad(k * 30 + 30))}" y="${106 - 72 * Math.cos(rad(k * 30 + 30))}" text-anchor="middle" font-family="Spectral SC,serif" font-size="15" fill="#e9e2cc">${['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][k]}</text>`).join('') +
        `<line x1="100" y1="100" x2="${100 + 45 * Math.sin(rad(ha))}" y2="${100 - 45 * Math.cos(rad(ha))}" stroke="#e9e2cc" stroke-width="7" stroke-linecap="round"/>` +
        `<line x1="100" y1="100" x2="${100 + 66 * Math.sin(rad(ma))}" y2="${100 - 66 * Math.cos(rad(ma))}" stroke="#d8c25a" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="100" r="6" fill="#d8c25a"/>`;
      lbl.textContent = `${h}:${String(m).padStart(2, '0')}`;
    };
    draw();
    const go = el('button', { class: 'primary', onclick: () => { if (h % 12 === pz.hour % 12 && m === pz.minute) win(); else { go.classList.add('shake'); setTimeout(() => go.classList.remove('shake'), 400); toast('The gears catch and stop. Wrong moment. Check your evidence.'); } } }, 'Wind the clock');
    return el('div', { class: 'pz' }, svg, lbl,
      el('div', { class: 'pz-row' }, el('button', { onclick: () => { h = h % 12 + 1; draw(); } }, 'Hour +'), el('button', { onclick: () => { m = (m + 5) % 60; draw(); } }, 'Minute +5'), el('button', { onclick: () => { m = (m + 55) % 60; draw(); } }, 'Minute −5')),
      go);
  },
  riddle(site, win) {
    const pz = site.puzzle; let wrong = 0;
    const input = el('input', { type: 'text', id: 'riddleInput', placeholder: 'Your answer', autocomplete: 'off', autocapitalize: 'off' });
    const choices = el('div', { class: 'choices' }); choices.hidden = true;
    pz.choices.forEach((c) => choices.append(el('button', { onclick: (e) => { if (c === pz.correct) win(); else { e.target.classList.add('shake'); e.target.disabled = true; } } }, c)));
    const check = () => {
      const v = input.value.trim().toLowerCase().replace(/^the\s+/, '');
      if (pz.answers.includes(v)) win(); else { wrong++; input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); if (wrong >= 1) { choices.hidden = false; toast('The stone softens. Four words are scratched beneath it.'); } }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    return el('div', { class: 'pz' }, el('div', { class: 'riddle' }, pz.prompt), input, el('button', { class: 'primary', style: 'width:100%', onclick: check }, 'Speak it into the well'), choices);
  },
  deduce(site, win) {
    const pickd = { who: null, what: null, where: null };
    const col = (key, label, list) => {
      const chips = el('div', { class: 'chips' });
      const draw = () => {
        chips.innerHTML = '';
        list.forEach((it) => {
          const k = `${key}:${it.id}`;
          chips.append(el('button', { class: (S.marks[k] ? 'struck ' : '') + (pickd[key] === it.id ? 'pick' : ''), title: it.role || '', onclick: () => { pickd[key] = pickd[key] === it.id ? null : it.id; draw(); acc.disabled = !(pickd.who && pickd.what && pickd.where); } }, it.name));
        });
      };
      draw();
      return el('div', { class: 'board-col' }, el('div', { class: 'section-label' }, label), chips);
    };
    const acc = el('button', { class: 'primary', disabled: true, onclick: () => {
      const s = C.solution;
      if (pickd.who === s.who && pickd.what === s.what && pickd.where === s.where) ending();
      else {
        S.wrongAccusations++; S.candles = Math.max(0, S.candles - 1); save(); renderCandles(); chime(false);
        toast(S.candles ? 'Davit... no. Mother Georgia\'s sword dips toward you. Wrong. One candle out.' : 'The last candle gutters. Rest, then accuse again.', 6000);
        if (!S.candles) setTimeout(() => { S.candles = 3; save(); renderCandles(); }, 30000);
      }
    } }, 'Make the accusation');
    acc.disabled = true;
    return el('div', { class: 'pz' }, el('div', { class: 'deduce' },
      el('div', { class: 'fine' }, 'Struck-through names were ruled out by your evidence. Open the casebook if you need to check why.'),
      col('who', 'Who', C.suspects), col('what', 'With what', C.means), col('where', 'Where', C.places)), acc);
  },
};

function ending() {
  const site = C.sites.find((s) => s.final);
  S.status[site.id] = 'solved'; save(); renderHud(); drawSites(); chime(true);
  const mins = Math.round((Date.now() - S.started) / 60000);
  const choose = (wine) => {
    S.ended = wine ? 'wine' : 'sword'; save();
    showOverlay([
      el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'CASE CLOSED'), el('h2', { class: 'ov-title' }, wine ? 'Wine, for a friend' : 'The sword, for an enemy')),
      el('p', { class: 'ov-text' }, wine
        ? 'Davit drinks. He walks back to Narikala with you and rings the bell the other way, three strokes, then a quarter more. Down in Abanotubani the domes start to steam. In the morning the guidebooks still say it\'s a story about soup. Davit says that\'s fine now; somebody remembered.'
        : 'Mother Georgia\'s sword comes down across the bell and it cracks with a sound the whole old town hears. The springs warm by dawn. Davit is never seen at the market again, and on cold nights the bath-keepers swear they hear a falcon\'s bell somewhere under the floor.'),
      el('div', { class: 'section-label' }, 'Your night'),
      el('ul', { class: 'evidence' },
        el('li', {}, `${C.sites.length} seals broken in ${mins} minutes`),
        el('li', {}, `${S.candles} of 3 candles still lit`),
        el('li', {}, S.wrongAccusations ? `${S.wrongAccusations} wrong accusation${S.wrongAccusations > 1 ? 's' : ''}` : 'Named him first time')),
      el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Walk the town'), el('button', { class: 'ghost', onclick: resetCase }, 'Start the case again')),
    ]);
  };
  showOverlay([
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'SEAL VII'), el('h2', { class: 'ov-title' }, 'Davit, with the falconer\'s bell, at the Narikala well')),
    el('p', { class: 'ov-text' }, site.lore),
    el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: () => choose(true) }, 'Offer him the wine'), el('button', { class: 'ghost', onclick: () => choose(false) }, 'Give him the sword')),
  ]);
}

// ---------- casebook ----------
function casebook() {
  if (isTrial()) {
    const mins = Math.round((Date.now() - S.started) / 60000);
    return showOverlay([
      el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'TRIAL WALK'), el('h2', { class: 'ov-title' }, C.title), el('div', { class: 'ov-place' }, C.city)),
      el('p', { class: 'ov-text' }, C.premise),
      el('div', { class: 'section-label' }, 'So far'),
      el('ul', { class: 'evidence' },
        el('li', {}, `${mins} min on the street`),
        el('li', {}, `Spotted by sentries: ${S.spotted || 0}`),
        el('li', {}, `Caught by Schneebley: ${S.bossCatches || 0}`),
        el('li', {}, `Sentries on the streets now: ${live.dens.filter((d) => d.kind === 'volto').length}`)),
      el('div', { class: 'section-label' }, 'How the hunters work'),
      el('ul', { class: 'evidence' },
        el('li', {}, 'White-masked sentries guard parts of the route. Their lantern beam is the amber cone. Walk into it and you lose a flame.'),
        el('li', {}, 'Some walk back and forth, some stand and sweep. Wait for the beam to swing away, or go round another street.'),
        el('li', {}, 'A new sentry appears ahead of you every few minutes.'),
        el('li', {}, 'Schneebley, the beaked one, heads for wherever you were last seen. Getting spotted tells him exactly where you are. Every few minutes he hears a rough rumour too.')),
      el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Back to the street'), el('button', { class: 'ghost', onclick: confirmReset }, 'Restart the walk')),
    ]);
  }
  const kids = [el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'CASEBOOK'), el('h2', { class: 'ov-title' }, C.title), el('div', { class: 'ov-place' }, C.city))];
  kids.push(el('p', { class: 'ov-text' }, C.premise));
  kids.push(el('div', { class: 'section-label' }, 'Seals'));
  C.sites.forEach((s) => {
    const st = siteState(s);
    const b = el('button', { class: `chapter ${st}`, onclick: () => { if (st !== 'locked') showSiteCard(s); } },
      el('div', { class: 'ch-num' }, `SEAL ${s.num}`), el('div', { class: 'ch-name' }, st === 'locked' ? 'Unknown' : s.name),
      el('div', { class: 'ch-state' }, st === 'solved' ? 'Broken' : st === 'open' ? `Open lead · ${live.player ? fmtDist(dist(live.player, sitePos(s))) : ''}` : 'Not yet found'));
    kids.push(b);
  });
  kids.push(el('div', { class: 'section-label' }, 'Evidence'));
  kids.push(S.evidence.length ? el('ul', { class: 'evidence' }, S.evidence.map((e) => el('li', {}, e))) : el('p', { class: 'fine' }, 'Nothing yet. Break a seal.'));
  kids.push(el('div', { class: 'section-label' }, 'Suspects (tap to cross out your own hunches)'));
  const board = el('div', { class: 'deduce' });
  const drawBoard = () => {
    board.innerHTML = '';
    [['who', C.suspects], ['what', C.means], ['where', C.places]].forEach(([key, list]) => {
      const chips = el('div', { class: 'chips' });
      list.forEach((it) => { const k = `${key}:${it.id}`; chips.append(el('button', { class: S.marks[k] ? 'struck' : '', onclick: () => { if (S.marks[k] === 'auto') return toast('Your evidence already rules this out.'); S.marks[k] = S.marks[k] ? undefined : 'me'; save(); drawBoard(); } }, it.name + (it.role ? ` · ${it.role}` : ''))); });
      board.append(chips);
    });
  };
  drawBoard(); kids.push(board);
  kids.push(el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Close the casebook'), el('button', { class: 'ghost', onclick: confirmReset }, 'Abandon this case')));
  showOverlay(kids);
}
function confirmReset() {
  showOverlay([el('h2', { class: 'ov-title' }, 'Abandon the case?'), el('p', { class: 'ov-text' }, 'Every broken seal and every piece of evidence goes. You start again at the bath-house.'),
    el('div', { class: 'ov-btns' }, el('button', { class: 'primary', style: 'background:var(--blood);color:var(--paper)', onclick: resetCase }, 'Abandon it'), el('button', { class: 'ghost', onclick: casebook }, 'Keep going'))]);
}
function resetCase() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} location.reload(); }

// ---------- trial walk: sentries with lantern cones + Schneebley ----------
let routeCum = null;
function routeTables() {
  if (routeCum) return routeCum;
  const r = C.route, cum = [0];
  for (let i = 1; i < r.length; i++) cum.push(cum[i - 1] + dist(r[i - 1], r[i]));
  return (routeCum = cum);
}
function along(d) { // -> [pos, bearing of the route there]
  const r = C.route, cum = routeTables(), total = cum[cum.length - 1];
  d = Math.max(0, Math.min(total, d));
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, k = (d - cum[i - 1]) / seg;
  const a = r[i - 1], b = r[i];
  return [[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], bearing(a, b)];
}
function progressOf(P) { // metres along the route of the nearest route point
  const r = C.route, cum = routeTables(); let best = 0, bd = Infinity;
  for (let i = 0; i < r.length; i++) { const d = dist(P, r[i]); if (d < bd) { bd = d; best = cum[i]; } }
  return best;
}
const ICON_VOLTO = '<svg viewBox="0 0 40 48" width="22" height="26"><path d="M20 2C8 2 4 14 6 26c2 12 8 20 14 20s12-8 14-20C36 14 32 2 20 2z" fill="#f2ede0" stroke="#c9a04a" stroke-width="2.5"/><ellipse cx="13" cy="20" rx="4.5" ry="2.4" fill="#0d1311"/><ellipse cx="27" cy="20" rx="4.5" ry="2.4" fill="#0d1311"/><path d="M15 34q5 2 10 0" stroke="#8a857a" stroke-width="1.5" fill="none"/></svg>';
const ICON_MEDICO = '<svg viewBox="0 0 52 52" width="44" height="44"><ellipse cx="22" cy="12" rx="20" ry="5" fill="#0d1311" stroke="#c2452f" stroke-width="1.5"/><rect x="11" y="2" width="22" height="10" rx="2" fill="#0d1311"/><path d="M8 16q12-4 22 2l20 20-22-7q-14 2-20-7z" fill="#f2ede0" stroke="#c9a04a" stroke-width="2"/><circle cx="17" cy="20" r="3.4" fill="#c2452f"/></svg>';
function hunterIcon(kind, chasing) {
  return L.divIcon({ className: '', html: `<div class="mk-hunter ${kind}${chasing ? ' chasing' : ''}">${kind === 'medico' ? ICON_MEDICO : ICON_VOLTO}</div>`, iconSize: kind === 'medico' ? [44, 44] : [22, 26], iconAnchor: kind === 'medico' ? [22, 22] : [11, 13] });
}
function conePoints(d) {
  const pts = [d.pos];
  for (let k = -d.half; k <= d.half; k += d.half / 6) { const b = rad(d.heading + k); pts.push(offset(d.pos, Math.cos(b) * d.range, Math.sin(b) * d.range)); }
  return pts;
}
function makeSentry(cfg) {
  const d = { kind: 'volto', name: 'Sentry', mode: cfg.mode, range: 28, half: 35, speed: 0.8, dir: 1, banishedUntil: 0, voice: null };
  if (cfg.mode === 'pace') { d.a = cfg.from; d.b = cfg.to; d.s = rnd(cfg.from, cfg.to); }
  else { d.at = cfg.at; d.sweep = cfg.sweep || 150; d.period = cfg.period || 9; d.phase = rnd(0, 6); const [p, b] = along(cfg.at); d.pos = p; d.base = b + 90; }
  if (cfg.mode === 'pace') { const [p, b] = along(d.s); d.pos = p; d.heading = b; } else d.heading = d.base;
  d.cone = L.polygon(conePoints(d), { color: '#f0a54a', weight: 1, opacity: 0.8, fillColor: '#f0a54a', fillOpacity: 0.38, interactive: false }).addTo(live.layers.dens);
  d.marker = L.marker(d.pos, { icon: hunterIcon('volto'), interactive: false, zIndexOffset: 500 }).addTo(live.layers.dens);
  if (live.audio) denVoice(d);
  return d;
}
function spawnTrial() {
  live.dens.forEach((d) => { try { d.voice?.out.disconnect(); } catch (e) {} });
  live.dens = C.patrols.map(makeSentry);
  const b = offset(C.start, C.boss.from[0], C.boss.from[1]);
  const boss = { kind: 'medico', name: C.boss.name, pos: b, mode: 'track', lastKnown: C.start.slice(), wp: null, inCatch: 0, banishedUntil: 0, voice: null };
  boss.marker = L.marker(b, { icon: hunterIcon('medico'), interactive: false, zIndexOffset: 900 }).addTo(live.layers.dens);
  if (live.audio) denVoice(boss);
  live.dens.push(boss); live.boss = boss;
  live.nextRumour = Date.now() + 150000;
  live.nextSentry = Date.now() + C.escalate.every * 1000;
}
function drawRoute() {
  live.layers.route = L.layerGroup().addTo(live.map);
  L.polyline(C.route, { color: '#d8c25a', weight: 3, opacity: 0.55, dashArray: '2 9', interactive: false }).addTo(live.layers.route);
  const s = C.start;
  L.circleMarker(s, { radius: 6, color: '#5fa08d', weight: 2, fillOpacity: 0.3 }).bindTooltip('Start · 55 Havelock Rd').addTo(live.layers.route);
}
function spotted(by, now) {
  live.wardUntil = now + 20000; // 20 s of grace to get clear
  S.spotted = (S.spotted || 0) + 1; S.candles = Math.max(0, S.candles - 1); save(); renderCandles(); renderHud(); chime(false);
  if (navigator.vibrate) navigator.vibrate([150, 60, 150, 60, 300]);
  if (live.boss) { live.boss.lastKnown = live.player.slice(); live.boss.mode = 'track'; }
  if (S.candles === 0) return outOfFlames(now, 'A sentry\'s lantern found you one time too many');
  toast(`A sentry saw you. One flame out. Schneebley knows exactly where you are now. 20 seconds to get clear.`, 6500);
}
function outOfFlames(now, why) {
  live.recoverUntil = now + 60000;
  showOverlay([
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'ALL FLAMES OUT'), el('h2', { class: 'ov-title' }, why)),
    el('p', { class: 'ov-text' }, 'Your lantern is dark. Stand still for a minute while it relights. Nothing can see you until it does.\n\nThe walk carries on from where you are.'),
    el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Back to the street')),
  ]);
  setTimeout(() => { S.candles = 3; save(); renderCandles(); toast('Your lantern is lit again.'); }, 60000);
}
function stepTrial(dt, now) {
  const P = live.player; if (!P) return;
  const t = now / 1000, safe = now < live.wardUntil || now < live.recoverUntil;
  const elapsedMin = (now - S.started) / 60000;
  // escalation: a new sentry somewhere ahead of you
  if (now > live.nextSentry) {
    live.nextSentry = now + C.escalate.every * 1000;
    const sentries = live.dens.filter((d) => d.kind === 'volto').length;
    const total = routeTables()[routeTables().length - 1];
    if (sentries < C.escalate.cap) {
      const s0 = Math.min(total - 40, progressOf(P) + rnd(70, 220));
      if (s0 > 40) {
        const d = makeSentry(Math.random() < 0.5 ? { mode: 'pace', from: s0 - 30, to: s0 + 30 } : { mode: 'sweep', at: s0, sweep: 150, period: rnd(7, 11) });
        live.dens.splice(live.dens.length - 1, 0, d);
        toast('Another masked sentry has taken up a post on the streets ahead.', 5000);
      }
    }
  }
  let hunted = false;
  for (const d of live.dens) {
    if (d.kind === 'volto') {
      if (d.mode === 'pace') {
        d.s += d.dir * d.speed * dt;
        if (d.s > d.b) { d.s = d.b; d.dir = -1; } if (d.s < d.a) { d.s = d.a; d.dir = 1; }
        const [p, b] = along(d.s); d.pos = p; d.heading = d.dir > 0 ? b : (b + 180) % 360;
      } else d.heading = (d.base + (d.sweep / 2) * Math.sin(2 * Math.PI * (t / d.period) + d.phase) + 360) % 360;
      d.marker.setLatLng(d.pos); d.cone.setLatLngs(conePoints(d));
      if (!safe && !live.overlayOpen) {
        const m = dist(d.pos, P);
        if (m < d.range && Math.abs(norm180(bearing(d.pos, P) - d.heading)) < d.half) { spotted(d, now); return; }
      }
    } else { // Schneebley
      const speed = Math.min(2.0, 0.9 + 0.1 * elapsedMin);
      if (now < d.banishedUntil) { d.marker.setLatLng(d.pos); continue; }
      const m = dist(d.pos, P);
      if (!safe && m < 30) { d.lastKnown = P.slice(); d.mode = 'chase'; }       // close enough to see you: direct pursuit
      else if (d.mode === 'chase') d.mode = 'track';
      if (now > live.nextRumour) {                                               // a rough rumour of where you are
        live.nextRumour = now + 150000;
        const b = rnd(0, 360); d.lastKnown = offset(P, Math.cos(rad(b)) * rnd(20, 60), Math.sin(rad(b)) * rnd(20, 60)); d.mode = 'track';
        toast('Schneebley has heard a rumour of where you are. He is coming this way.', 5000);
      }
      let target = d.lastKnown || d.wp;
      if (!target || dist(d.pos, target) < 5) {
        if (d.lastKnown) { d.searchAround = d.lastKnown; d.lastKnown = null; }
        const c = d.searchAround || d.pos, b = rnd(0, 360), r = rnd(15, 60);
        d.wp = offset(c, Math.cos(rad(b)) * r, Math.sin(rad(b)) * r); target = d.wp;
      }
      d.pos = moveToward(d.pos, target, (d.lastKnown ? speed : speed * 0.6) * dt);
      d.marker.setLatLng(d.pos);
      const el2 = d.marker.getElement()?.firstChild; if (el2) el2.classList.toggle('chasing', d.mode === 'chase');
      if (d.mode === 'chase') hunted = true;
      if (!safe && !live.overlayOpen && m < 10) {
        d.inCatch += dt;
        if (d.inCatch >= 2) {
          d.inCatch = 0; S.bossCatches = (S.bossCatches || 0) + 1;
          const b = rnd(0, 360); d.pos = offset(P, Math.cos(rad(b)) * 250, Math.sin(rad(b)) * 250); d.lastKnown = null; d.searchAround = null; d.mode = 'track';
          d.banishedUntil = now + 15000; live.wardUntil = now + 25000;
          S.candles = Math.max(0, S.candles - 1); save(); renderCandles(); renderHud(); chime(false);
          if (navigator.vibrate) navigator.vibrate([400, 100, 400]);
          if (S.candles === 0) outOfFlames(now, 'Schneebley caught you');
          else toast('Schneebley caught you. One flame out. He has been driven off for now, but he will be back.', 6500);
        }
      } else d.inCatch = Math.max(0, d.inCatch - dt);
    }
    // proximity audio
    if (d.voice && live.audio) {
      const dp = dist(d.pos, P), hear = d.kind === 'medico' ? 260 : 120;
      const vol = live.sound && dp < hear ? Math.pow(1 - dp / hear, 2) * (d.kind === 'medico' ? 0.9 : 0.35) * (d.mode === 'chase' ? 1.4 : 1) : 0;
      d.voice.out.gain.setTargetAtTime(vol, live.audio.ctx.currentTime, 0.4);
      if (d.voice.pan) d.voice.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(rad(norm180(bearing(P, d.pos) - (live.heading ?? 0)))))), live.audio.ctx.currentTime, 0.3);
    }
  }
  live.huntedBy = new Set(hunted ? [live.boss] : []);
  $('hunted').hidden = !hunted || live.overlayOpen;
  if (hunted && live.audio && now > live.audio.nextBeat) { beat(); live.audio.nextBeat = now + 850; }
}
function trialObjects(P) {
  return live.dens.map((d, i) => ({ d, i, m: dist(P, d.pos) })).filter(({ m }) => m < 600).map(({ d, i, m }) => ({
    id: 'den' + i, kind: d.kind, bearing: bearing(P, d.pos), dist: m, hunting: d.kind === 'medico' && d.mode === 'chase',
    label: d.kind === 'medico' ? `${d.mode === 'chase' ? 'HUNTING · ' : ''}Schneebley · ${Math.round(m)} m` : `Sentry · ${Math.round(m)} m`,
  }));
}
function trialEnd() {
  S.ended = 'made-it'; S.endedAt = Date.now(); save(); renderHud(); chime(true);
  const mins = Math.round((Date.now() - S.started) / 60000);
  showOverlay([
    el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'YOU MADE IT'), el('h2', { class: 'ov-title' }, 'Le Chiffre\'s last card')),
    el('p', { class: 'ov-text' }, 'Tucked behind the gym\'s front desk: a small black card with a single number on it. 7. The Masque lower their lanterns and melt back into the side streets. Schneebley is nowhere to be seen. For now.'),
    el('div', { class: 'section-label' }, 'Your walk'),
    el('ul', { class: 'evidence' },
      el('li', {}, `${mins} minutes from Havelock Road`),
      el('li', {}, `${S.candles} of 3 flames still lit`),
      el('li', {}, `Spotted by sentries: ${S.spotted || 0}`),
      el('li', {}, `Caught by Schneebley: ${S.bossCatches || 0}`)),
    el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Back to the street'), el('button', { class: 'ghost', onclick: resetCase }, 'Walk it again')),
  ]);
}

// ---------- walk view (3D, over the shoulder) ----------
function walkData() {
  const P = live.player, now = Date.now();
  return {
    player: P,
    heading: S.move === 'gps' ? live.heading : null,
    route: isTrial() ? C.route : null,
    dens: !P ? [] : isTrial()
      ? live.dens.map((d, i) => ({ id: i, kind: d.kind, pos: d.pos, hunting: d.kind === 'medico' && d.mode === 'chase', cone: d.kind === 'volto' ? { heading: d.heading, range: d.range, half: d.half } : null }))
      : live.dens.map((d, i) => ({ d, i })).filter(({ d }) => now >= d.banishedUntil && dist(P, d.pos) < T.sight).map(({ d, i }) => ({ id: i, kind: d.kind, pos: d.pos, hunting: d.mode === 'hunt' })),
    seals: C.sites.filter((s) => siteState(s) !== 'locked').map((s) => ({ id: s.id, sigil: s.sigil, svg: SIGILS[s.sigil], pos: sitePos(s), state: siteState(s) })),
    sanctuaries: C.sanctuaries.map((sa, i) => ({ pos: sanctPos(i), r: scaleR(sa[2]) })),
  };
}
function footstep() {
  const A = live.audio; if (!A || !live.sound) return;
  const { ctx } = A, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = A.noiseBuf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rnd(700, 1300);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rnd(0.18, 0.26), t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  src.connect(lp); lp.connect(g); g.connect(A.master); src.start(t, rnd(0, 1.5), 0.13);
}
function setView(v) {
  live.view = v;
  $('btnView').textContent = v === 'walk' ? 'MAP VIEW' : '3D VIEW';
  if (v === 'walk') {
    RivenWalk.show({ getData: walkData, onStep: footstep, onTap: (p) => { if (S.move === 'desk' && !live.overlayOpen) live.target = p; } });
  } else {
    RivenWalk.hide(); setTimeout(() => live.map.invalidateSize(), 50);
  }
  try { localStorage.setItem('riven_view', v); } catch (e) {}
}

// ---------- loop ----------
function tick(now) {
  const dt = live.lastTick ? Math.min(1, (now - live.lastTick) / 1000) : 0; live.lastTick = now;
  if (S.move === 'desk' && live.player && live.target) {
    live.player = moveToward(live.player, live.target, T.walk * live.speed * dt);
    if (dist(live.player, live.target) < 1) { live.target = null; live.layers.target.setLatLngs([]); }
    else live.layers.target.setLatLngs([live.player, live.target]);
  }
  if (live.player) {
    live.layers.player.setLatLng(live.player);
    if (live.follow !== false && !live.overlayOpen) {
      const c = live.map.getCenter();
      if (dist([c.lat, c.lng], live.player) > 3) live.map.panTo(live.player, { animate: S.move === 'gps', duration: 0.5 });
    }
    const cone = document.getElementById('cone');
    if (cone) { const h = S.move === 'gps' ? live.heading : (live.target ? bearing(live.player, live.target) : null); cone.style.display = h == null ? 'none' : ''; if (h != null) cone.style.transform = `rotate(${h}deg)`; }
    if (isTrial()) { if (!live.overlayOpen) stepTrial(dt, Date.now()); }
    else { if (!live.overlayOpen) stepDens(dt, Date.now()); lingerCheck(Date.now()); }
    updateSheet();
  }
}
function start(resume) {
  $('title').hidden = true; $('hud').hidden = false; $('sheet').hidden = false;
  initAudio(); askCompass(); wake();
  if (S.move === 'desk') setDesk();
  startGPS();
  if (S.where === 'here' && S.anchor) live.player = live.player || S.anchor.slice();
  buildWorld(); renderHud();
  if (isTrial() && !live.player) live.map.fitBounds(L.latLngBounds(C.route), { padding: [40, 40] });
  else live.map.setView(live.player || W(caseCentroid), isTrial() ? 18 : 17);
  live.dens.forEach(denVoice);
  live.wardUntil = Date.now() + 60000; // a minute's grace while you get your bearings
  snapToStreets();
  let v = 'walk'; try { v = localStorage.getItem('riven_view') || 'walk'; } catch (e) {}
  if (v === 'walk') setView('walk');
  setInterval(() => tick(performance.now()), 200);
  if (!resume && isTrial()) {
    showOverlay([
      el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'TRIAL WALK'), el('h2', { class: 'ov-title' }, 'Get to Tiong Bahru Plaza unseen')),
      el('p', { class: 'ov-text' }, `Follow the dotted line, or find your own way.\n\nWhite masks are sentries. Their lantern beam is the amber cone on the map and on the street. Step into it and you lose a flame, and Schneebley learns exactly where you are. Some sentries pace back and forth; some stand and sweep. Time it, or go round.\n\nThe red beaked mask is Schneebley. He heads for wherever you were last seen and gets faster the longer you're out. If he gets within about 10 m for two seconds, he takes a flame.\n\nA new sentry appears ahead of you every few minutes. You have three flames and one minute of grace to start. Keep the screen on.`),
      el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Go')),
    ]);
  } else if (!resume) {
    showOverlay([
      el('div', { class: 'ov-head' }, el('div', { class: 'ov-num' }, 'NIGHTFALL'), el('h2', { class: 'ov-title' }, 'Two leads to start')),
      el('p', { class: 'ov-text' }, `The bath-keeper at ${C.sites[0].name} saw it happen. Someone scratched a message onto the king's statue at ${C.sites[1].name}.\n\nWalk to a glowing seal. Within ${T.reach} m you can open its reliquary: find it through your camera, then break it.\n\nRed eyes are Ali and the Devi. You hear them first; earphones help, and the sound comes from the side they're on. If one hunts you, run or get onto holy ground (the green rings). Don't idle in one spot for long. Three candles. Lose them all and you sit out two minutes.`),
      el('div', { class: 'ov-btns' }, el('button', { class: 'primary', onclick: hideOverlay }, 'Go')),
    ]);
  }
}

// ---------- boot ----------
function boot() {
  initMap();
  const choice = { caseId: 'trial', where: 'city', move: 'gps' };
  let saved = null;
  const applyCase = () => {
    chooseCase(choice.caseId);
    $('premise').textContent = C.premise;
    $('caseTitle').textContent = isTrial() ? 'Trial walk · Havelock to Tiong Bahru' : 'Case I · The Cold Springs of Tbili';
    $('whereBlock').hidden = isTrial();
    if (isTrial()) choice.where = 'city';
    saved = load();
    const ok = saved && saved.status && !saved.ended;
    $('btnContinue').hidden = !ok;
    if (ok) $('btnContinue').textContent = isTrial() ? 'Continue the walk' : `Continue: ${Object.values(saved.status).filter((v) => v === 'solved').length} seals broken`;
    $('btnBegin').textContent = isTrial() ? 'Start the walk' : 'Begin the night';
  };
  [['segCase', 'caseId'], ['segWhere', 'where'], ['segMove', 'move']].forEach(([id, key]) => {
    $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      choice[key] = b.dataset.v; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (key === 'caseId') applyCase();
    }));
  });
  applyCase();
  $('btnBegin').onclick = () => { S = freshState(choice.where, choice.move); S.caseId = choice.caseId; save(); start(false); };
  $('btnContinue').onclick = () => { S = saved; start(true); };
  $('btnCase').onclick = casebook;
  $('btnLook').onclick = () => { RivenAR.askPermission(); openLive('look'); };
  $('liveClose').onclick = closeLive;
  $('fovMinus').onclick = () => { $('fovVal').textContent = `${RivenAR.nudgeFov(-2)}°`; };
  $('fovPlus').onclick = () => { $('fovVal').textContent = `${RivenAR.nudgeFov(2)}°`; };
  $('btnCenter').onclick = () => { live.follow = true; if (live.view === 'walk') RivenWalk.recenter(); else if (live.player) live.map.setView(live.player, 18); };
  $('btnView').onclick = () => setView(live.view === 'walk' ? 'map' : 'walk');
  $('btnLead').onclick = () => { leadIdx++; const s = currentLead(); if (s) { live.follow = false; live.map.flyTo(sitePos(s), 17); } };
  $('btnSpeed').onclick = () => { live.speed = live.speed === 1 ? 4 : live.speed === 4 ? 12 : 1; $('btnSpeed').textContent = `Walk ${live.speed}×`; };
  $('btnSound').onclick = () => { live.sound = !live.sound; $('btnSound').classList.toggle('off', !live.sound); if (!live.sound) live.dens.forEach((d) => d.voice?.out.gain.setTargetAtTime(0, live.audio.ctx.currentTime, 0.1)); if (live.audio?.ctx.state === 'suspended') live.audio.ctx.resume(); };
  // debug hook for QA
  window.__riven = { live, get S() { return S; }, solve: (id) => solveSite(C.sites.find((s) => s.id === id)), puzzle: (id) => showPuzzle(C.sites.find((s) => s.id === id)), look: () => openLive('look'), view: (v) => setView(v), walk: () => RivenWalk.state, get L() { return LV; }, C };
}
boot();
})();
