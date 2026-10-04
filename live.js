// Live view: camera feed + a three.js scene whose camera is driven by the phone's full orientation
// (gyro for smooth rotation, compass only to keep north true). Objects sit at a fixed world direction,
// so they stay put while the phone moves past them.
// World axes: +X east, +Y up, -Z north. Eye height is y = 0; the ground is at y = -1.5.
window.RivenAR = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rad = (d) => d * Math.PI / 180;
  const norm180 = (a) => ((a + 540) % 360) - 180;
  const FOV_KEY = 'riven_ar_fov';

  let renderer, scene, camera, raf = 0, opts = null, stream = null;
  let ori = null, oriAt = 0, alphaOffset = null, absolute = false, screenAngle = 0;
  let dragYaw = 0, dragPitch = 0, lastPt = null;
  let fov = 63; try { fov = +localStorage.getItem(FOV_KEY) || 63; } catch (e) {}
  const sprites = new Map(); // id -> { sprite, label, smoothB }
  const tex = {};
  let hold = 0, lastT = 0, listening = false;

  // ---------- textures (drawn, no image files) ----------
  function ghoulTexture(kind) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    const body = (cx, top, w, h) => {
      const grd = g.createLinearGradient(0, top, 0, top + h);
      grd.addColorStop(0, 'rgba(18,22,20,0.95)'); grd.addColorStop(0.7, 'rgba(18,22,20,0.75)'); grd.addColorStop(1, 'rgba(18,22,20,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(cx - w * 0.3, top + h * 0.12);
      g.bezierCurveTo(cx - w * 0.6, top + h * 0.4, cx - w * 0.5, top + h * 0.8, cx - w * 0.35, top + h);
      g.lineTo(cx + w * 0.35, top + h);
      g.bezierCurveTo(cx + w * 0.5, top + h * 0.8, cx + w * 0.6, top + h * 0.4, cx + w * 0.3, top + h * 0.12);
      g.closePath(); g.fill();
    };
    const eyes = (cx, cy, s) => {
      g.save(); g.shadowColor = '#ff3b1f'; g.shadowBlur = 18 * s; g.fillStyle = '#ffb199';
      [-1, 1].forEach((k) => { g.beginPath(); g.ellipse(cx + k * 13 * s, cy, 6 * s, 3 * s, k * 0.25, 0, Math.PI * 2); g.fill(); });
      g.restore();
    };
    // ghost-light aura so they read against a dark street
    const aura = g.createRadialGradient(128, 230, 10, 128, 260, 250);
    aura.addColorStop(0, 'rgba(150,210,190,0.38)'); aura.addColorStop(0.5, 'rgba(110,170,150,0.14)'); aura.addColorStop(1, 'rgba(110,170,150,0)');
    g.fillStyle = aura; g.fillRect(0, 0, 256, 512);
    g.shadowColor = 'rgba(170,230,210,0.7)'; g.shadowBlur = 22;
    if (kind === 'devi') { // the many-headed ogre: hulking body, three heads
      body(128, 150, 240, 362);
      [[70, 120, 0.8], [128, 92, 1], [186, 120, 0.8]].forEach(([x, y, s]) => {
        g.fillStyle = 'rgba(14,18,16,0.97)'; g.beginPath(); g.ellipse(x, y, 34 * s, 40 * s, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x - 26 * s, y - 26 * s); g.lineTo(x - 36 * s, y - 62 * s); g.lineTo(x - 12 * s, y - 34 * s); g.fill();
        g.beginPath(); g.moveTo(x + 26 * s, y - 26 * s); g.lineTo(x + 36 * s, y - 62 * s); g.lineTo(x + 12 * s, y - 34 * s); g.fill();
        eyes(x, y, s);
      });
    } else { // Ali: tall, thin, long wet hair hanging past the waist
      body(128, 110, 150, 402);
      g.fillStyle = 'rgba(12,15,14,0.98)'; g.beginPath(); g.ellipse(128, 120, 30, 38, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(10,12,11,0.9)'; g.lineWidth = 5; g.lineCap = 'round';
      for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(128 + i * 4, 90); g.bezierCurveTo(128 + i * 9, 200, 128 + i * 6 + (i % 2) * 10, 300, 128 + i * 8, 330 + Math.abs(i) * 6); g.stroke(); }
      eyes(128, 122, 1);
    }
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
  }
  function sigilTexture(svgInner) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
    const img = new Image();
    img.onload = () => {
      const g = c.getContext('2d');
      const halo = g.createRadialGradient(128, 128, 20, 128, 128, 128);
      halo.addColorStop(0, 'rgba(216,194,90,0.55)'); halo.addColorStop(1, 'rgba(216,194,90,0)');
      g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
      g.shadowColor = '#d8c25a'; g.shadowBlur = 24; g.drawImage(img, 28, 28, 200, 200); g.drawImage(img, 28, 28, 200, 200);
      t.needsUpdate = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${svgInner}</svg>`);
    return t;
  }
  function getTex(key, make) { return tex[key] || (tex[key] = make()); }

  // ---------- orientation ----------
  const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  function onOri(e) {
    if (e.alpha == null) return;
    if (e.type === 'deviceorientationabsolute') absolute = true;
    else if (absolute) return; // Android: prefer the absolute stream once it exists
    let alpha = e.alpha;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: alpha is relative (smooth gyro); heading is absolute (noisy). Keep alpha, drift-correct toward north slowly.
      const target = norm180((360 - e.webkitCompassHeading) - e.alpha);
      alphaOffset = alphaOffset == null ? target : alphaOffset + norm180(target - alphaOffset) * 0.03;
      alpha = e.alpha + alphaOffset;
    }
    ori = { alpha, beta: e.beta || 0, gamma: e.gamma || 0 };
    oriAt = performance.now();
  }
  function listen() {
    if (listening) return; listening = true;
    window.addEventListener('deviceorientationabsolute', onOri);
    window.addEventListener('deviceorientation', onOri);
  }
  async function askPermission() {
    const DOE = window.DeviceOrientationEvent;
    try { if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission(); } catch (e) {}
    listen();
  }
  const hasGyro = () => ori && performance.now() - oriAt < 1500;
  // Compass heading the camera is facing (for map/compass UI), from the same orientation.
  function facing() {
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return (Math.atan2(v.x, -v.z) * 180 / Math.PI + 360) % 360;
  }

  function updateCamera() {
    if (hasGyro()) {
      screenAngle = rad((screen.orientation && screen.orientation.angle) || window.orientation || 0);
      euler.set(rad(ori.beta), rad(ori.alpha), -rad(ori.gamma), 'YXZ');
      camera.quaternion.setFromEuler(euler); camera.quaternion.multiply(q1); camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle));
    } else {
      camera.rotation.set(rad(dragPitch), -rad(dragYaw), 0, 'YXZ');
    }
  }

  // ---------- drag fallback (laptop / no gyro) ----------
  function pDown(e) { lastPt = [e.clientX, e.clientY]; }
  function pMove(e) {
    if (!lastPt) return;
    const k = fov / window.innerHeight;
    dragYaw = (dragYaw - (e.clientX - lastPt[0]) * k + 360) % 360;
    dragPitch = Math.max(-80, Math.min(80, dragPitch + (e.clientY - lastPt[1]) * k));
    lastPt = [e.clientX, e.clientY];
  }
  function pUp() { lastPt = null; }

  // ---------- scene ----------
  function ensure() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    $('liveGL').append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.fov = fov; camera.updateProjectionMatrix();
  }
  function spriteFor(o) {
    let s = sprites.get(o.id);
    if (!s) {
      const map = o.kind === 'seal' || o.kind === 'anchor' ? getTex('sigil:' + o.sigil, () => sigilTexture(o.svg)) : getTex(o.kind, () => ghoulTexture(o.kind));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
      sprite.center.set(0.5, o.kind === 'seal' || o.kind === 'anchor' ? 0.5 : 0);
      scene.add(sprite);
      const label = document.createElement('div'); label.className = 'live-label'; $('liveLabels').append(label);
      s = { sprite, label, smoothB: o.bearing, phase: Math.random() * 6 };
      sprites.set(o.id, s);
    }
    return s;
  }
  function clearSprites() {
    sprites.forEach((s) => { scene.remove(s.sprite); s.sprite.material.dispose(); s.label.remove(); });
    sprites.clear();
  }

  // ---------- frame ----------
  const v3 = new THREE.Vector3();
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0; lastT = t;
    updateCamera();
    const objs = opts.getObjects();
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    let nearestOff = null, inReticle = null;
    for (const o of objs) {
      seen.add(o.id);
      const s = spriteFor(o);
      s.smoothB += norm180(o.bearing - s.smoothB) * (o.fixed ? 1 : 0.08); // GPS jitter → glide, not jump
      const b = rad(s.smoothB), wob = Math.sin(t / 700 + s.phase);
      let r, y, size;
      if (o.kind === 'seal' || o.kind === 'anchor') {
        r = o.fixed ? o.dist : Math.max(4, Math.min(30, o.dist));
        size = o.fixed ? 0.9 : 1.1 * Math.max(1, r / 6);
        y = (o.elev != null ? o.elev : 0.3 * Math.max(1, r / 6)) + wob * 0.06 * size;
        s.sprite.scale.set(size, size, 1);
      } else {
        r = o.fixed ? o.dist : Math.max(5, Math.min(35, o.dist));
        const tall = (o.kind === 'devi' ? 2.8 : 2.2) * Math.max(1, r / 10);
        size = tall;
        y = -1.5 + wob * 0.05 * tall + (o.kind === 'ali' ? 0.15 * tall : 0); // Ali float a little off the ground
        s.sprite.scale.set(tall * 0.5, tall, 1);
        s.sprite.material.opacity = o.hunting ? 0.75 + 0.25 * Math.sin(t / 60) : 0.92;
      }
      s.sprite.position.set(r * Math.sin(b), y, -r * Math.cos(b));
      // label + on-screen test
      const anchorY = o.kind === 'seal' || o.kind === 'anchor' ? y - size * 0.6 : y - 0.1;
      v3.set(r * Math.sin(b), anchorY, -r * Math.cos(b)).project(camera);
      const front = v3.z < 1;
      const sx = (v3.x + 1) / 2 * W, sy = (1 - v3.y) / 2 * H;
      const onScreen = front && sx > -40 && sx < W + 40 && sy > -40 && sy < H + 40;
      s.label.hidden = !onScreen || !o.label;
      if (onScreen && o.label) { s.label.textContent = o.label; s.label.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, 0)`; s.label.classList.toggle('hunt', !!o.hunting); }
      const rel = norm180(o.bearing - facing());
      if (!onScreen && (!nearestOff || o.dist < nearestOff.o.dist)) nearestOff = { o, rel };
      if (o.target) {
        v3.copy(s.sprite.position).project(camera);
        const dx = v3.x * camera.aspect, dy = v3.y;
        if (v3.z < 1 && Math.hypot(dx, dy) < 0.16) inReticle = o;
        if (!onScreen) nearestOff = { o, rel };
      }
    }
    sprites.forEach((s, id) => { if (!seen.has(id)) { scene.remove(s.sprite); s.label.remove(); sprites.delete(id); } });
    // edge arrow toward the nearest thing you can't see
    $('liveArrowL').hidden = !(nearestOff && nearestOff.rel < 0);
    $('liveArrowR').hidden = !(nearestOff && nearestOff.rel >= 0);
    // seek: hold the target in the ring
    if (opts.mode === 'seek') {
      hold = inReticle ? Math.min(2.5, hold + dt) : Math.max(0, hold - dt * 2);
      $('liveFill').style.strokeDashoffset = 276.5 * (1 - hold / 2.5);
      if (hold >= 2.5) { const cb = opts.onFound; hold = 0; opts.onFound = null; cb && cb(); }
    }
    if (opts.onFrame) opts.onFrame({ facing: facing(), gyro: hasGyro(), compass: alphaOffset != null || absolute });
    renderer.render(scene, camera);
  }

  // ---------- open / close ----------
  async function open(o) {
    opts = o; hold = 0; lastT = 0;
    ensure(); listen();
    $('live').hidden = false; resize();
    $('liveReticle').hidden = o.mode !== 'seek';
    $('liveFill').style.strokeDashoffset = 276.5;
    const live = $('live');
    live.addEventListener('pointerdown', pDown); live.addEventListener('pointermove', pMove);
    live.addEventListener('pointerup', pUp); live.addEventListener('pointercancel', pUp);
    if (!stream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        $('liveVideo').srcObject = stream; await $('liveVideo').play().catch(() => {});
      } catch (e) { stream = null; }
    }
    $('liveVideo').hidden = !stream; $('liveShade').classList.toggle('novideo', !stream);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function setMode(o) { Object.assign(opts, o); hold = 0; $('liveReticle').hidden = opts.mode !== 'seek'; clearSprites(); }
  function close() {
    cancelAnimationFrame(raf); raf = 0;
    const live = $('live');
    live.removeEventListener('pointerdown', pDown); live.removeEventListener('pointermove', pMove);
    live.removeEventListener('pointerup', pUp); live.removeEventListener('pointercancel', pUp);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; $('liveVideo').srcObject = null; }
    clearSprites(); live.hidden = true; opts = null;
  }
  function nudgeFov(d) { fov = Math.max(35, Math.min(90, fov + d)); try { localStorage.setItem(FOV_KEY, fov); } catch (e) {} resize(); return fov; }
  // A direction in front of wherever the phone points now (for placing fixed anchors).
  function currentFacing() { if (!camera) return 0; updateCamera(); return facing(); }

  return { open, close, setMode, askPermission, nudgeFov, currentFacing, get fov() { return fov; }, isOpen: () => !!opts };
})();
