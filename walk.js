// Walk view: a pitched 3D night street (MapLibre + OpenFreeMap, no key, no billing) with a three.js
// lantern-bearer walking it, seen from just behind. Footprints stay on the ground and fade.
// Local scene frame: metres from an origin point, +X east, +Y up, -Z north.
window.RivenWalk = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rad = (d) => d * Math.PI / 180, R = 6371000;
  const norm180 = (a) => ((a + 540) % 360) - 180;
  const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const MODEL = 'assets/HoodedAdventurer.glb';
  const AV_SCALE = 6.5;           // Pokémon-Go-style giant: the walker reads clearly at street zoom
  const STRIDE = 0.42 * AV_SCALE; // footprints spaced for the drawn size of the walker
  const STEP_SOUND = 0.75;        // metres of real movement per footstep sound
  const PRINT_LIFE = 40;          // seconds a footprint lasts
  const NIGHT = {
    background: '#0a0f0d', land: '#111814', park: '#13241a', water: '#06161a', road: '#4a4627', roadMinor: '#2b2e22',
    casing: '#050806', building: '#1a211c', rail: '#23271f',
  };

  let map = null, opts = null, raf = 0, lastT = 0, visible = false, ready = false;
  let renderer, scene, camera, originLL = null, modelMat = null;
  const av = { pos: null, heading: 0, speed: 0, group: null, model: null, mixer: null, actions: {}, active: null, lantern: null, pool: null };
  let camBearing = 0, followPausedUntil = 0, strideAcc = 0, soundAcc = 0, side = 1;
  const prints = [];
  const things = new Map(); // id -> mesh/group for ghouls, seals, sanctuaries
  const texCache = {};

  // ---------- geo ----------
  function enu(o, p) { return [rad(p[0] - o[0]) * R, rad(p[1] - o[1]) * R * Math.cos(rad(o[0]))]; }
  function local(p) { const [n, e] = enu(originLL, p); return [e, -n]; } // -> [x, z]
  function distM(a, b) { const [n, e] = enu(a, b); return Math.hypot(n, e); }
  function bearingTo(a, b) { const [n, e] = enu(a, b); return (Math.atan2(e, n) * 180 / Math.PI + 360) % 360; }
  function moveToward(p, t, m) { const d = distM(p, t); if (d <= m || !d) return t.slice(); const k = m / d; return [p[0] + (t[0] - p[0]) * k, p[1] + (t[1] - p[1]) * k]; }

  // ---------- style: recolour to night ----------
  function pick(id, key) {
    id = id.toLowerCase(); key = key.toLowerCase();
    if (/water|river|lake|ocean|sea/.test(id)) return NIGHT.water;
    if (/park|wood|forest|grass|green|scrub|meadow|crop|landcover|landuse_park|cemetery|pitch/.test(id)) return NIGHT.park;
    if (/casing|outline/.test(id)) return NIGHT.casing;
    if (/motorway|trunk|primary|secondary/.test(id)) return NIGHT.road;
    if (/rail|transit/.test(id)) return NIGHT.rail;
    if (/road|street|path|track|bridge|tunnel|highway|minor|service|pedestrian|aeroway/.test(id)) return NIGHT.roadMinor;
    if (/background/.test(id)) return NIGHT.background;
    if (/building/.test(id)) return NIGHT.building;
    return NIGHT.land;
  }
  function recolor() {
    const style = map.getStyle(); if (!style) return;
    for (const l of style.layers) {
      if (l.id.startsWith('riven-')) continue;
      try {
        if (l.type === 'symbol') { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
        if (l.type === 'fill-extrusion') { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
        if (l.type === 'background') { map.setPaintProperty(l.id, 'background-color', NIGHT.background); continue; }
        if (l.type === 'raster' || l.type === 'hillshade') { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
        for (const key of Object.keys(l.paint || {})) if (key.includes('color')) map.setPaintProperty(l.id, key, pick(l.id, key));
      } catch (e) {}
    }
    if (!map.getLayer('riven-buildings') && map.getSource('openmaptiles')) {
      map.addLayer({ id: 'riven-buildings', source: 'openmaptiles', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14, paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#252e28', 30, '#1c241f', 90, '#141a16', 200, '#0f1411'],
        // Pokémon-Go-style low blocks: real towers would wall off an over-the-shoulder camera
        'fill-extrusion-height': ['min', ['*', ['coalesce', ['get', 'render_height'], 8], 0.3], 14],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.88,
      } });
    }
    const rt = opts && opts.getData().route;
    if (rt && !map.getSource('riven-route')) {
      map.addSource('riven-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: rt.map((p) => [p[1], p[0]]) } } });
      map.addLayer({ id: 'riven-route', type: 'line', source: 'riven-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d8c25a', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 2, 20, 7], 'line-opacity': 0.75, 'line-dasharray': [0.6, 1.6] } });
    }
    try { map.setSky({ 'sky-color': '#0b1512', 'horizon-color': '#2b3a30', 'fog-color': '#0d1311', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.55, 'atmosphere-blend': 0 }); } catch (e) {}
    if (!map.getLayer('riven-3d')) map.addLayer(customLayer);
  }

  // ---------- textures ----------
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; }
  const footTex = () => texCache.foot || (texCache.foot = canvasTex(64, 128, (g) => {
    g.fillStyle = '#f2dc95'; g.shadowColor = '#f0a54a'; g.shadowBlur = 8;
    g.beginPath(); g.ellipse(32, 48, 17, 30, 0, 0, Math.PI * 2); g.fill();      // sole, toe at top (= forward)
    g.beginPath(); g.ellipse(32, 102, 13, 16, 0, 0, Math.PI * 2); g.fill();     // heel
  }));
  const poolTex = () => texCache.pool || (texCache.pool = canvasTex(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,190,110,0.55)'); r.addColorStop(0.35, 'rgba(240,165,74,0.22)'); r.addColorStop(1, 'rgba(240,165,74,0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  }));
  const ringTex = () => texCache.ring || (texCache.ring = canvasTex(256, 256, (g) => {
    g.strokeStyle = 'rgba(95,160,141,0.9)'; g.lineWidth = 6; g.setLineDash([14, 10]);
    g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.stroke();
    const r = g.createRadialGradient(128, 128, 60, 128, 128, 124); r.addColorStop(0, 'rgba(95,160,141,0)'); r.addColorStop(1, 'rgba(95,160,141,0.22)');
    g.fillStyle = r; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  }));

  // ---------- three scene in a MapLibre custom layer ----------
  const customLayer = {
    id: 'riven-3d', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      if (!originLL || !renderer) return;
      const mm = args && args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
      camera.projectionMatrix = new THREE.Matrix4().fromArray(mm).multiply(modelMat);
      renderer.resetState();
      renderer.clearDepth(); // walker, ghouls and seals stay visible through buildings (x-ray, like Pokémon Go)
      renderer.render(scene, camera);
    },
  };
  function setOrigin(ll) {
    originLL = ll.slice();
    const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng: ll[1], lat: ll[0] }, 0);
    const s = merc.meterInMercatorCoordinateUnits();
    modelMat = new THREE.Matrix4().makeTranslation(merc.x, merc.y, merc.z).scale(new THREE.Vector3(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    prints.splice(0).forEach((p) => scene.remove(p.mesh)); // footprints are in the old frame
  }
  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(new THREE.HemisphereLight(0xb5d4c6, 0x1a221d, 1.35));
    const moon = new THREE.DirectionalLight(0xb8c8ff, 0.7); moon.position.set(-1, 2, 1); scene.add(moon);
    av.group = new THREE.Group(); scene.add(av.group);
    // blob shadow + lantern light pool
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55 * AV_SCALE * 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; av.group.add(shadow);
    av.pool = new THREE.Mesh(new THREE.PlaneGeometry(6 * AV_SCALE, 6 * AV_SCALE), new THREE.MeshBasicMaterial({ map: poolTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    av.pool.rotation.x = -Math.PI / 2; av.pool.position.y = 0.05; scene.add(av.pool);
    // lantern: carried at the right side; real point light so the body and street catch it
    const lantern = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.11 * AV_SCALE, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd08a }));
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * AV_SCALE, 0.12 * AV_SCALE, 0.28 * AV_SCALE, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x2b1d10, wireframe: true }));
    const light = new THREE.PointLight(0xffb45c, 2.4, 9 * AV_SCALE * 0.6, 2);
    lantern.add(glass, cage, light);
    lantern.position.set(0.42 * AV_SCALE, 0.78 * AV_SCALE, -0.12 * AV_SCALE);
    av.group.add(lantern); av.lantern = lantern; av.light = light;
    loadModel();
  }
  function loadModel() {
    if (!THREE.GLTFLoader) return;
    new THREE.GLTFLoader().load(MODEL, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        o.frustumCulled = false;
        if (/^Sword$/i.test(o.name)) o.visible = false;
        if (o.isMesh && o.material) { const m = o.material; if (m.map && m.color && m.color.getHex() < 0x101010) m.color.setHex(0xffffff); }
      });
      const box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y || 1, s = 1.8 * AV_SCALE / h;
      root.scale.setScalar(s); root.position.y = -box.min.y * s; root.rotation.y = Math.PI; // Quaternius faces +Z; turn to face -Z (north at heading 0)
      av.group.add(root); av.model = root;
      av.mixer = new THREE.AnimationMixer(root);
      const clip = (re) => gltf.animations.find((a) => re.test(a.name));
      [['Idle', /\|Idle$/], ['Walk', /\|Walk$/], ['Run', /\|Run$/]].forEach(([k, re]) => { const c = clip(re); if (c) av.actions[k] = av.mixer.clipAction(c); });
      play('Idle');
    }, undefined, () => {});
  }
  function play(name) {
    const next = av.actions[name]; if (!next || next === av.active) return;
    next.reset().fadeIn(0.25).play(); if (av.active) av.active.fadeOut(0.25); av.active = next;
  }

  // ---------- world things: ghouls, seals, sanctuaries ----------
  function ghoulMesh(kind) {
    const t = texCache['g' + kind] || (texCache['g' + kind] = window.RivenAR.textures.ghoul(kind));
    const h = (kind === 'devi' ? 3.0 : kind === 'medico' ? 2.7 : 2.4) * AV_SCALE * 0.85, w = h / 2;
    const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const grp = new THREE.Group(); grp.add(mesh); grp.userData.face = mesh; return grp;
  }
  function sealMesh(sigil, svg) {
    const grp = new THREE.Group();
    const t = texCache['s' + sigil] || (texCache['s' + sigil] = window.RivenAR.textures.sigil(svg));
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * AV_SCALE, 1.6 * AV_SCALE), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.y = 2.2 * AV_SCALE; grp.add(disc); grp.userData.face = disc;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * AV_SCALE, 0.55 * AV_SCALE, 160, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8c25a, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 80; grp.add(beam); grp.userData.beam = beam;
    return grp;
  }
  function coneMesh(range, half) {
    const g = new THREE.CircleGeometry(range, 28, rad(90 - half), rad(2 * half));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf0a54a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    const grp = new THREE.Group(); grp.add(m); return grp; // no userData.face: cones are not billboards
  }
  function sanctMesh(r) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: ringTex(), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.06; return m;
  }
  function syncThings(data, t) {
    const seen = new Set();
    const put = (id, make, p, y = 0) => {
      let o = things.get(id); if (!o) { o = make(); scene.add(o); things.set(id, o); }
      const [x, z] = local(p); o.position.set(x, y, z); seen.add(id); return o;
    };
    (data.sanctuaries || []).forEach((s, i) => put('sa' + i + ':' + Math.round(s.r), () => sanctMesh(s.r), s.pos));
    (data.seals || []).forEach((s) => {
      const o = put('se' + s.id + s.state, () => sealMesh(s.sigil, s.svg), s.pos);
      o.userData.face.position.y = 2.2 * AV_SCALE + Math.sin(t / 600) * 0.15 * AV_SCALE;
      o.userData.beam.visible = s.state === 'open';
      o.userData.face.material.opacity = s.state === 'open' ? 1 : 0.35;
    });
    (data.dens || []).forEach((d) => {
      const o = put('de' + d.id + d.kind, () => ghoulMesh(d.kind), d.pos, (d.kind === 'ali' ? 0.4 : 0) + Math.sin(t / 500 + d.id) * 0.15);
      o.userData.face.material.opacity = d.hunting ? 0.7 + 0.3 * Math.sin(t / 60) : 0.95;
      if (d.cone) { // a sentry's lantern beam on the ground
        const c = put('co' + d.id + ':' + d.cone.range + ':' + d.cone.half, () => coneMesh(d.cone.range, d.cone.half), d.pos, 0.09);
        c.rotation.y = -rad(d.cone.heading);
      }
    });
    things.forEach((o, id) => {
      if (!seen.has(id)) { scene.remove(o); things.delete(id); return; }
      if (o.userData.face) o.rotation.y = -rad(camBearing); // billboards face the camera
    });
  }

  // ---------- footprints ----------
  function addPrint() {
    const [x, z] = local(av.pos);
    const sideOff = 0.13 * AV_SCALE * side; side = -side;
    const h = rad(av.heading);
    const px = x + Math.cos(h) * sideOff, pz = z + Math.sin(h) * sideOff; // perpendicular to heading
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.68), new THREE.MeshBasicMaterial({ map: footTex(), transparent: true, opacity: 0.6, depthWrite: false }));
    const grp = new THREE.Group(); mesh.rotation.x = -Math.PI / 2; grp.add(mesh);
    grp.position.set(px, 0.04, pz); grp.rotation.y = -h; grp.scale.setScalar(0.75 * AV_SCALE);
    scene.add(grp); prints.push({ mesh: grp, born: performance.now() });
    while (prints.length > 90) scene.remove(prints.shift().mesh);
  }

  // ---------- frame ----------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0; lastT = t;
    if (!ready || !opts) return;
    const d = opts.getData();
    if (!d.player) return;
    if (!av.pos) { av.pos = d.player.slice(); setOrigin(av.pos); camBearing = d.heading || 0; }
    if (distM(originLL, av.pos) > 800) setOrigin(av.pos);
    // glide toward the latest GPS/desk position instead of teleporting on each fix
    const gap = distM(av.pos, d.player);
    let moved = 0;
    if (gap > 60) { av.pos = d.player.slice(); }
    else if (gap > 0.05) {
      const step = Math.min(gap, Math.max(1.0, gap * 2.5) * dt);
      const before = av.pos; av.pos = moveToward(av.pos, d.player, step); moved = distM(before, av.pos);
      if (moved > 0.01) av.heading += norm180(bearingTo(before, av.pos) - av.heading) * Math.min(1, dt * 8); // turn into the direction of travel
    }
    const inst = dt ? moved / dt : 0;
    av.speed += (inst - av.speed) * Math.min(1, dt * 4);
    if (av.speed < 0.25 && d.heading != null) av.heading += norm180(d.heading - av.heading) * Math.min(1, dt * 3); // standing: face where the phone faces
    av.heading = (av.heading + 360) % 360;
    // gait from real speed
    if (av.speed > 2.6) play('Run'); else if (av.speed > 0.3) play('Walk'); else play('Idle');
    if (av.active && av.mixer) {
      const k = av.active === av.actions.Run ? av.speed / 4.2 : av.active === av.actions.Walk ? av.speed / 1.4 : 1;
      av.active.timeScale = Math.max(0.6, Math.min(1.8, k));
      av.mixer.update(dt);
    }
    // footprints by distance walked
    strideAcc += moved; while (strideAcc >= STRIDE) { strideAcc -= STRIDE; addPrint(); }
    soundAcc += moved; while (soundAcc >= STEP_SOUND) { soundAcc -= STEP_SOUND; if (opts.onStep) opts.onStep(); }
    const now = performance.now();
    for (let i = prints.length - 1; i >= 0; i--) {
      const age = (now - prints[i].born) / 1000;
      if (age > PRINT_LIFE) { scene.remove(prints[i].mesh); prints.splice(i, 1); continue; }
      prints[i].mesh.children[0].material.opacity = 0.6 * (1 - age / PRINT_LIFE);
    }
    // avatar transform + lantern swing / flicker
    const [x, z] = local(av.pos);
    av.group.position.set(x, 0, z); av.group.rotation.y = -rad(av.heading);
    av.pool.position.set(x, 0.05, z);
    const swing = av.speed > 0.3 ? Math.sin(t / (av.speed > 2.6 ? 110 : 190)) * 0.35 : Math.sin(t / 900) * 0.08;
    av.lantern.rotation.x = swing;
    const flick = 0.85 + Math.sin(t / 73) * 0.08 + Math.sin(t / 31) * 0.05;
    av.light.intensity = 2.4 * flick; av.pool.material.opacity = flick;
    syncThings(d, t);
    // camera trails the character's heading a beat behind
    if (now > followPausedUntil) {
      camBearing += norm180(av.heading - camBearing) * Math.min(dt * 1.8, 1);
      map.jumpTo({ center: [av.pos[1], av.pos[0]], bearing: camBearing });
    } else camBearing = map.getBearing();
    map.triggerRepaint();
  }

  // ---------- lifecycle ----------
  function init(o) {
    opts = o;
    if (map) return;
    const P = o.getData().player || [1.2868, 103.8545];
    map = new maplibregl.Map({
      container: 'walk', style: STYLE, center: [P[1], P[0]], zoom: 19.6, pitch: 60, bearing: 0, maxPitch: 80,
      attributionControl: { compact: true }, dragRotate: true, touchPitch: true, pitchWithRotate: true,
    });
    buildScene();
    map.on('style.load', recolor);
    map.on('load', () => { recolor(); ready = true; padding(); });
    const pause = (e) => { if (e && e.originalEvent) followPausedUntil = performance.now() + 5000; };
    map.on('dragstart', pause); map.on('rotatestart', pause); map.on('pitchstart', pause);
    map.on('click', (e) => { if (opts && opts.onTap) opts.onTap([e.lngLat.lat, e.lngLat.lng]); });
    window.addEventListener('resize', () => { if (map) { map.resize(); padding(); } });
  }
  function padding() { const h = map.getContainer().clientHeight; map.setPadding({ top: Math.round(h * 0.34), bottom: Math.round(h * 0.12), left: 0, right: 0 }); } // walker sits ~60% down, clear of the bottom panel
  function show(o) {
    init(o); visible = true; $('walk').hidden = false;
    requestAnimationFrame(() => { map.resize(); padding(); });
    cancelAnimationFrame(raf); lastT = 0; raf = requestAnimationFrame(frame);
  }
  function hide() { visible = false; $('walk').hidden = true; cancelAnimationFrame(raf); raf = 0; }
  function recenter() { followPausedUntil = 0; if (map) { map.easeTo({ zoom: 19.6, pitch: 60, duration: 600 }); } }
  return { show, hide, recenter, isVisible: () => visible, get state() { return { av, prints: prints.length, ready, things: things.size }; } };
})();
