'use strict';
/* Lunar Patrol — game core: simulation, level generation and rendering. */
const Game = (() => {
  const W = 256, H = 224, HUD_H = 40, GROUND_Y = 186;
  const SEG = 560, LEAD = 380;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const CHECKPOINTS = [0, 4, 9, 14, 19, 25];
  const JUMP_V = 3.1, GRAV = 0.115;
  const SPEED_MIN = 0.8, SPEED_MAX = 2.4, SPEED_BASE = 1.4;
  const EXTRA_LIVES = [10000, 30000, 50000];
  const WHEEL_X = [1, 11, 21];
  const UFO_POINTS = { 1: 100, 2: 200, 3: 300 };
  const MOUNT_Y = GROUND_Y - 116, HILL_Y = GROUND_Y - 56;
  const FIRE = ['#fff6d5', '#ffd166', '#ff9f1c', '#ff5a36', '#c81d25'];
  const DUST = ['#e39a58', '#c9783e', '#8a4520', '#f0c090'];
  const letterX = i => LEAD + i * SEG;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------- utilities
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
    return n >>> 0;
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = n => String(n).padStart(6, '0');

  const Store = {
    load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const DEFAULT_SCORES = [
    { name: 'ACE', score: 30000 }, { name: 'RVR', score: 20000 }, { name: 'LUN', score: 15000 },
    { name: 'MPT', score: 10000 }, { name: 'CRT', score: 5000 },
  ];

  // ---------------------------------------------------------------- backgrounds
  const BG = { stars: [], mountains: null, hills: null, ground: null };

  function buildBackgrounds() {
    const r = mulberry32(1234);
    for (let i = 0; i < 70; i++) {
      BG.stars.push({ x: r() * 512, y: HUD_H + 2 + r() * 100, c: ['#ffffff', '#9fd3ff', '#ffe9a8', '#ffb4a8'][Math.floor(r() * 4)], tw: Math.floor(r() * 97) });
    }

    // Far mountains — blue, lit from the left.
    const MW = 512, MH = 80;
    const mc = document.createElement('canvas'); mc.width = MW; mc.height = MH;
    const m = mc.getContext('2d');
    const mh = x => { const t = x / MW * Math.PI * 2; return 38 + 14 * Math.sin(2 * t + 0.5) + 11 * Math.sin(5 * t + 1.3) + 6 * Math.sin(9 * t + 2.1) + 3 * Math.sin(17 * t + 0.7); };
    for (let x = 0; x < MW; x++) {
      const h = Math.round(mh(x)), top = MH - h, slope = mh(x + 1) - mh(x - 1);
      m.fillStyle = '#26436f'; m.fillRect(x, top, 1, h);
      if (slope > 0) { m.fillStyle = '#4c7cc0'; m.fillRect(x, top, 1, Math.min(h, 3 + Math.round(slope * 7))); }
      else { m.fillStyle = '#37598f'; m.fillRect(x, top, 1, 2); }
      if (h > 58) { m.fillStyle = '#9dc0ee'; m.fillRect(x, top, 1, Math.min(3, h - 58)); }
      for (let y = top + 6; y < MH; y += 5) if (hash(x * 131 + y) % 6 === 0) { m.fillStyle = '#1d375d'; m.fillRect(x, y, 2, 1); }
    }
    BG.mountains = mc;

    // Near hills — green, with a lunar colony along the ridge.
    const HW = 512, HH = 56;
    const hc = document.createElement('canvas'); hc.width = HW; hc.height = HH;
    const h = hc.getContext('2d');
    const hh = x => { const t = x / HW * Math.PI * 2; return 20 + 7 * Math.sin(3 * t + 0.2) + 5 * Math.sin(7 * t + 1.1) + 3 * Math.sin(13 * t + 2.4) + 1.5 * Math.sin(29 * t); };
    for (let x = 0; x < HW; x++) {
      const ht = Math.round(hh(x)), top = HH - ht, slope = hh(x + 1) - hh(x - 1);
      h.fillStyle = '#1d6a3e'; h.fillRect(x, top, 1, ht);
      h.fillStyle = slope > 0 ? '#36a863' : '#2a8750'; h.fillRect(x, top, 1, slope > 0 ? 4 : 2);
      h.fillStyle = '#5fd08a'; h.fillRect(x, top, 1, 1);
      for (let y = top + 5; y < HH; y += 4) if (hash(x * 71 + y * 3) % 7 === 0) { h.fillStyle = '#165331'; h.fillRect(x, y, 1, 1); }
    }
    const dome = (cx, r) => {
      const base = HH - Math.round(hh(cx)) + 3;
      for (let dx = -r; dx <= r; dx++) {
        const dh = Math.round(Math.sqrt(r * r - dx * dx));
        h.fillStyle = dx < -r / 3 ? '#e4ebf2' : dx < r / 3 ? '#c3ceda' : '#8492a3';
        h.fillRect(cx + dx, base - dh, 1, dh + 3);
      }
      h.fillStyle = '#ffd166';
      for (let dx = -r + 3; dx < r - 2; dx += 3) h.fillRect(cx + dx, base - 3, 1, 1);
    };
    const tower = (cx, ht) => {
      const base = HH - Math.round(hh(cx)) + 2;
      h.fillStyle = '#9aa8b8'; h.fillRect(cx, base - ht, 3, ht);
      h.fillStyle = '#dfe6ee'; h.fillRect(cx, base - ht, 1, ht);
      h.fillStyle = '#ff3b30'; h.fillRect(cx + 1, base - ht - 1, 1, 1);
    };
    dome(58, 9); tower(72, 14); dome(84, 5);
    dome(210, 7); tower(222, 10);
    dome(330, 10); dome(348, 6); tower(360, 17);
    dome(455, 8);
    BG.hills = hc;

    // Ground texture tile.
    const gc = document.createElement('canvas'); gc.width = 256; gc.height = H - GROUND_Y;
    const g = gc.getContext('2d');
    g.fillStyle = '#a4582a'; g.fillRect(0, 0, 256, gc.height);
    g.fillStyle = '#e39a58'; g.fillRect(0, 0, 256, 1);
    g.fillStyle = '#c9783e'; g.fillRect(0, 1, 256, 2);
    const gr = mulberry32(77);
    for (let i = 0; i < 700; i++) {
      const y = 4 + Math.floor(gr() * (gc.height - 4));
      g.fillStyle = ['#8a4520', '#b8683a', '#7a3b1a', '#c47a45'][Math.floor(gr() * 4)];
      g.fillRect(Math.floor(gr() * 256), y, gr() < 0.3 ? 2 : 1, 1);
    }
    for (let y = 10; y < gc.height; y += 9) {
      for (let x = 0; x < 256; x++) if (hash(x * 13 + y) % 5 === 0) { g.fillStyle = '#93502a'; g.fillRect(x, y, 1, 1); }
    }
    BG.ground = gc;
  }

  // ---------------------------------------------------------------- state
  const G = {
    mode: 'attract', state: 'title', timer: 480, frame: 0, paused: false, demo: false, demoFrames: 0,
    score: 0, hi: 0, lives: 3, nextExtra: 0, course: 0, cp: 0,
    dist: 0, speed: SPEED_BASE, segFrames: 0, genSeg: 0, fireAuto: 0, flash: 0, readyMsg: null,
    buggy: null, craters: [], obs: [], shells: [], triggers: [], ufos: [], bombs: [], upshots: [], fshot: null,
    parts: [], texts: [], debris: [], wave: null, panel: null,
  };
  let scores = Store.load('lp_scores', DEFAULT_SCORES.slice());
  const records = Store.load('lp_records', {});
  G.hi = scores[0].score;

  const Input = { held: {}, hit: {} };
  function press(a) { if (!Input.held[a]) Input.hit[a] = true; Input.held[a] = true; }
  function release(a) { Input.held[a] = false; }
  function releaseAll() { Input.held = {}; }

  const newBuggy = x => ({ x, y: 0, vy: 0, air: false, wy: [0, 0, 0], wv: [0, 0, 0], rot: 0 });

  function clearField() {
    G.buggy = newBuggy(56);
    G.craters = []; G.obs = []; G.shells = []; G.triggers = []; G.ufos = []; G.bombs = [];
    G.upshots = []; G.fshot = null; G.parts = []; G.texts = []; G.debris = [];
    G.wave = null; G.panel = null; G.segFrames = 0;
  }

  function resetField(cp) {
    clearField();
    G.cp = cp; G.speed = SPEED_BASE;
    G.dist = letterX(cp) - 20 - G.buggy.x;
    G.genSeg = cp; G.nextFree = 0;
    ensureGenerated();
  }

  function currentLetter() {
    if (!G.buggy) return 0;
    return clamp(Math.floor((G.dist + G.buggy.x + 16 - letterX(0)) / SEG), 0, 25);
  }

  function difficulty(s) {
    const c = Math.min(G.course, 2);
    const base = [0.05, 0.4, 0.55][c];
    return Math.min(1, base + (c === 0 ? 0.6 : 0.5) * s / 24 + Math.max(0, G.course - 2) * 0.1);
  }

  // ---------------------------------------------------------------- level generation
  function weighted(r, list) {
    let tot = 0;
    for (const [, w] of list) tot += w;
    let v = r() * tot;
    for (const [k, w] of list) if ((v -= w) < 0) return k;
    return list[0][0];
  }

  const addCrater = (x, w) => { G.craters.push({ x, w, depth: Math.min(12, 6 + Math.floor(w / 4)), passed: false }); return w; };

  function genSegment(s) {
    if (s > 24) return;
    const r = mulberry32(9001 + G.course * 1000 + s * 37);
    const d = difficulty(s);
    const x1 = letterX(s + 1);
    let x = Math.max(letterX(s) + (CHECKPOINTS.includes(s) ? 190 : 70), G.nextFree);
    let tanks = 0;
    while (x < x1 - 60) {
      const pick = weighted(r, [
        ['craterS', 3], ['craterL', 1 + 2 * d], ['rockS', 3], ['rockL', 0.8 + 2 * d],
        ['mine', d > 0.4 ? 2 * d : 0], ['boulder', d > 0.25 ? 1.2 : 0],
        ['tank', d > 0.35 && tanks < (d > 0.7 ? 2 : 1) ? 1.3 : 0],
        ['pair', d > 0.2 ? 2 * d : 0], ['rockCrater', d > 0.3 ? 1.2 * d : 0],
      ]);
      let used = 0;
      switch (pick) {
        case 'craterS': used = addCrater(x, 12 + Math.floor(r() * 6)); break;
        case 'craterL': used = addCrater(x, 22 + Math.floor(r() * 8)); break;
        case 'rockS': G.obs.push({ type: 'rock', x, big: false }); used = 10; break;
        case 'rockL': G.obs.push({ type: 'rock', x, big: true }); used = 16; break;
        case 'mine': G.obs.push({ type: 'mine', x }); used = 9; break;
        case 'boulder': G.obs.push({ type: 'boulder', x: x + 40 }); used = 54; break;
        case 'tank': G.obs.push({ type: 'tank', x, cd: 40 }); tanks++; used = 20; break;
        case 'pair': {
          addCrater(x, 12 + Math.floor(r() * 5));
          const off = 100 + Math.floor(r() * 16);
          used = off + addCrater(x + off, 12 + Math.floor(r() * 6));
          break;
        }
        case 'rockCrater': {
          G.obs.push({ type: 'rock', x, big: false });
          const off = 105 + Math.floor(r() * 20);
          used = off + addCrater(x + off, 12 + Math.floor(r() * 8));
          break;
        }
      }
      G.nextFree = x + used + (150 - 55 * d);
      x += used + (150 - 55 * d) + r() * 90;
    }
    if (s >= 2 && (s % 2 === 0 || (d > 0.55 && r() < 0.6))) {
      let type;
      if (G.course === 0) type = s < 9 ? 1 : s < 17 ? (r() < 0.5 ? 1 : 2) : (r() < 0.5 ? 2 : 3);
      else type = 1 + Math.floor(r() * 3);
      G.triggers.push({ x: letterX(s) + SEG * (0.2 + r() * 0.3), type, n: 3 + (d > 0.5 ? 1 : 0) + (d > 0.85 ? 1 : 0), used: false });
    }
  }

  function ensureGenerated() {
    while (G.genSeg <= 24 && letterX(G.genSeg) < G.dist + W + 100) genSegment(G.genSeg++);
  }

  // ---------------------------------------------------------------- geometry
  function bodyY() {
    const b = G.buggy;
    const avg = (b.wy[0] + b.wy[1] + b.wy[2]) / 3;
    return Math.round(GROUND_Y - 15 + b.y + avg);
  }
  function buggyBox() {
    const b = G.buggy, by = bodyY();
    return { x: b.x + 2, y: by + 2, w: 27, h: GROUND_Y + b.y - by - 2 };
  }
  function obsBox(o) {
    const sx = o.x - G.dist;
    switch (o.type) {
      case 'rock': return o.big ? { x: sx, y: GROUND_Y - 13, w: 16, h: 13 } : { x: sx, y: GROUND_Y - 8, w: 10, h: 8 };
      case 'mine': return { x: sx, y: GROUND_Y - 5, w: 9, h: 5 };
      case 'tank': return { x: sx, y: GROUND_Y - 10, w: 20, h: 10 };
      default: return { x: sx, y: GROUND_Y - 14, w: 14, h: 14 };
    }
  }
  const ufoBox = u => ({ x: u.x - u.w / 2, y: u.y - u.h / 2, w: u.w, h: u.h });
  const groundBump = wx => (hash(Math.floor(wx / 6)) % 9 === 0 ? -1.5 : 0);

  // ---------------------------------------------------------------- effects
  function burst(x, y, n, colors, spd, ground, grav = 0.05, life = 24, floor = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * spd;
      G.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.4,
        g: grav, life: life * (0.5 + Math.random() * 0.7), max: life,
        c: colors[Math.floor(Math.random() * colors.length)], ground, floor,
      });
    }
  }

  function addScore(n, x, y, ground) {
    G.score += n;
    if (!G.demo) {
      if (G.score > G.hi) G.hi = G.score;
      if (G.nextExtra < EXTRA_LIVES.length && G.score >= EXTRA_LIVES[G.nextExtra]) {
        G.nextExtra++; G.lives++;
        AudioSys.sfx.extra();
        G.texts.push({ x: 128, y: HUD_H + 30, text: 'EXTRA BUGGY', life: 120, ground: false, c: '#ffb020' });
      }
    }
    if (x !== undefined) G.texts.push({ x, y, text: String(n), life: 50, ground, c: '#f5f7fa' });
  }

  // ---------------------------------------------------------------- game flow
  function startGame() {
    AudioSys.init();
    AudioSys.stopMusic();
    G.mode = 'game'; G.demo = false; G.score = 0; G.lives = 3; G.nextExtra = 0; G.course = 0;
    G.hi = scores[0].score;
    resetField(0);
    G.state = 'ready'; G.timer = 170; G.readyMsg = null;
    AudioSys.sfx.start();
  }

  function startDemo() {
    G.mode = 'attract'; G.demo = true; G.demoFrames = 0; G.score = 0; G.lives = 1; G.course = 0;
    resetField(Math.random() < 0.5 ? 0 : 4);
    G.state = 'play';
  }

  function toAttract(state) {
    G.mode = 'attract'; G.demo = false;
    clearField();
    G.state = state; G.timer = state === 'scores' ? 360 : 480;
  }

  function quitToTitle() {
    AudioSys.stopMusic();
    toAttract('title');
  }

  function nextCourse() {
    G.course++;
    AudioSys.stopMusic();
    resetField(0);
    G.state = 'ready'; G.timer = 220; G.readyMsg = 'CHAMPION COURSE';
    AudioSys.sfx.start();
  }

  function reachCheckpoint(n) {
    const secs = Math.floor(G.segFrames / 60);
    const avg = Math.round((n - G.cp) * SEG / (SPEED_BASE * 60) * 1.08);
    const key = G.course + '-' + n;
    if (!G.demo && (records[key] === undefined || secs < records[key])) { records[key] = secs; Store.save('lp_records', records); }
    const bonus = 500 + Math.max(0, avg - secs) * 100;
    addScore(bonus);
    G.panel = { letter: LETTERS[n], secs, avg, rec: records[key] ?? secs, bonus, t: 270, final: n === 25 };
    G.cp = n; G.segFrames = 0;
    AudioSys.sfx.checkpoint();
  }

  function die(cause = '') {
    if (G.state !== 'play') return;
    G.lastDeath = cause;
    G.state = 'dying'; G.timer = 170; G.flash = 4;
    AudioSys.stopMusic(); AudioSys.sfx.bigBoom();
    const b = G.buggy, by = bodyY(), bx = Math.round(b.x);
    burst(bx + 16, by + 6, 60, FIRE, 2.4, false, 0.04, 55);
    burst(bx + 16, by + 10, 20, DUST, 1.5, false, 0.1, 40, true);
    G.debris = WHEEL_X.map((wx, i) => ({ kind: 'wheel', x: bx + wx, y: by + 7, vx: (i - 1) * 0.9 + (Math.random() - 0.5) * 0.6, vy: -2.2 - Math.random() * 1.8, f: 0 }));
    G.debris.push({ kind: 'body', x: bx, y: by, vx: 0.4, vy: -1.6 });
    G.fshot = null; G.upshots = [];
    for (const u of G.ufos) if (!u.leaving) { u.leaving = true; u.vy = -0.4; }
    G.wave = null;
  }

  // ---------------------------------------------------------------- input
  function readInput() {
    const h = Input.held, k = Input.hit;
    return { left: !!h.left, right: !!h.right, jump: !!k.jump, fire: !!k.fire || (!!h.fire && G.fireAuto <= 0) };
  }

  function autopilot() {
    const b = G.buggy, inp = { left: false, right: false, jump: false, fire: false };
    const front = G.dist + b.x + 25;
    for (const c of G.craters) { const d = c.x - front; if (d > -1 && d < 6) inp.jump = true; }
    for (const o of G.obs) {
      const d = obsBox(o).x - (b.x + 30);
      if (o.type === 'mine') { if (d > -2 && d < 5) inp.jump = true; }
      else {
        if (d > 0 && d < 80 && G.frame % 5 === 0) inp.fire = true;
        if (d > -2 && d < 3) inp.jump = true;
      }
    }
    for (const s of G.shells) {
      const d = s.x - G.dist - (b.x + 30);
      if (d > 0 && d < 50) inp.fire = true;
      if (d > 4 && d < 22) inp.jump = true;
    }
    if (G.ufos.length && G.frame % 16 === 0) inp.fire = true;
    const gun = b.x + 11;
    for (const bm of G.bombs) {
      const dx = bm.x - gun;
      if (Math.abs(dx) < 6 && bm.y < GROUND_Y - 40) inp.fire = true;
      // Predict the landing point and steer out of the way.
      const t = (GROUND_Y - bm.y) / Math.max(0.5, bm.vy + 1);
      const land = bm.x + bm.vx * t;
      if (land > b.x - 4 && land < b.x + 34 && t < 50) {
        if (land > b.x + 15 && !G.craters.some(c => c.w > 18 && c.x - G.dist - b.x < 160 && c.x > G.dist + b.x)) inp.left = true; else inp.right = true;
      }
    }
    return inp;
  }

  // ---------------------------------------------------------------- update
  function step() {
    if (G.paused) { Input.hit = {}; return; }
    G.frame++;
    if (G.flash > 0) G.flash--;
    const k = Input.hit;
    if (G.mode === 'attract' && (k.start || k.jump || k.fire)) { Input.hit = {}; startGame(); return; }
    switch (G.state) {
      case 'title': case 'points': case 'scores': updateAttract(); break;
      case 'ready': updateReady(); break;
      case 'play': updatePlay(G.demo ? autopilot() : readInput()); break;
      case 'dying': updateDying(); break;
      case 'gameover': updateGameOver(); break;
    }
    Input.hit = {};
  }

  function updateAttract() {
    G.dist += 0.8;
    if (--G.timer <= 0) {
      if (G.state === 'title') { G.state = 'points'; G.timer = 420; }
      else if (G.state === 'points') startDemo();
      else { G.state = 'title'; G.timer = 480; }
    }
  }

  function updateReady() {
    updateWheels(G.buggy, 0);
    if (--G.timer <= 0) {
      G.state = 'play'; G.readyMsg = null;
      AudioSys.startMusic();
    }
  }

  function updateWheels(b, speed) {
    for (let i = 0; i < 3; i++) {
      const wx = G.dist + b.x + WHEEL_X[i] + 4;
      const target = b.air ? 1 : groundBump(wx);
      b.wv[i] += (target - b.wy[i]) * 0.25;
      b.wv[i] *= 0.72;
      b.wy[i] += b.wv[i];
      if (!b.air && speed > 0 && Math.random() < 0.012 * speed) b.wv[i] -= 0.9;
    }
    b.rot += speed * 0.22;
  }

  function updatePlay(inp) {
    const b = G.buggy;
    if (inp.right) G.speed = Math.min(SPEED_MAX, G.speed + 0.02);
    else if (inp.left) G.speed = Math.max(SPEED_MIN, G.speed - 0.02);
    else G.speed += (SPEED_BASE - G.speed) * 0.02;
    const tx = 40 + (G.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 72;
    b.x += (tx - b.x) * 0.05;
    G.dist += G.speed;
    G.segFrames++;
    ensureGenerated();

    if (inp.jump && !b.air) { b.air = true; b.vy = -JUMP_V; AudioSys.sfx.jump(); }
    if (b.air) {
      b.vy += GRAV; b.y += b.vy;
      if (b.y >= 0) {
        b.y = 0; b.vy = 0; b.air = false;
        for (let i = 0; i < 3; i++) b.wv[i] += 1.1;
        AudioSys.sfx.land();
        burst(b.x + 6, GROUND_Y - 1, 5, DUST, 0.7, true, 0.04, 16);
      }
    }
    updateWheels(b, G.speed);
    if (!b.air && G.frame % 5 === 0) {
      G.parts.push({ x: b.x + 2, y: GROUND_Y - 2, vx: -0.3 - Math.random() * 0.3, vy: -0.3 - Math.random() * 0.3, g: 0.02, life: 14, max: 14, c: DUST[Math.floor(Math.random() * 4)], ground: true, floor: false });
    }

    if (G.fireAuto > 0) G.fireAuto--;
    if (inp.fire) fire();

    updateShots();
    updateObstacles();
    updateWaves();
    updateUfos();
    updateBombs();
    updateShells();
    updateParticles(G.speed);
    collide();
    if (G.state !== 'play') return;
    checkPasses();
    const next = CHECKPOINTS.find(c => c > G.cp);
    if (next !== undefined && G.dist + b.x + 16 >= letterX(next)) reachCheckpoint(next);
    cleanup();
    if (G.panel && --G.panel.t <= 0) {
      const fin = G.panel.final;
      G.panel = null;
      if (fin) nextCourse();
    }
    if (G.demo && ++G.demoFrames > 60 * 45) toAttract('scores');
  }

  function fire() {
    const b = G.buggy, by = bodyY();
    let shot = false;
    if (!G.fshot) { G.fshot = { x: b.x + 30, y: by + 4, x0: b.x + 30 }; shot = true; }
    if (G.upshots.length < 3) { G.upshots.push({ x: Math.round(b.x) + 10, y: by - 3 }); shot = true; }
    if (shot) { AudioSys.sfx.fire(); G.fireAuto = 14; }
  }

  function updateShots() {
    const f = G.fshot;
    if (f) {
      f.x += 5;
      if (f.x - f.x0 > 110 || f.x > W) { burst(f.x, f.y, 3, ['#ffd166', '#ff9f1c'], 0.6, false, 0, 8); G.fshot = null; }
    }
    for (const s of G.upshots) {
      s.y -= 4.5;
      if (s.y < HUD_H + 4) { s.dead = true; burst(s.x + 1, s.y, 4, ['#ffe066', '#ffffff'], 0.8, false, 0, 10); }
    }
    G.upshots = G.upshots.filter(s => !s.dead);
  }

  function updateObstacles() {
    for (const o of G.obs) {
      const sx = o.x - G.dist;
      if (o.type === 'boulder' && sx < W + 8) {
        o.x -= 0.35;
        for (const c of G.craters) {
          if (o.x + 7 > c.x + 2 && o.x + 7 < c.x + c.w - 2) { o.dead = true; burst(sx + 7, GROUND_Y - 4, 12, DUST, 1, true, 0.08, 22); break; }
        }
      }
      if (o.type === 'tank' && sx < W - 16 && sx > G.buggy.x + 44) {
        if (--o.cd <= 0) {
          G.shells.push({ x: o.x - 3, y: GROUND_Y - 9 });
          o.cd = 110 + Math.random() * 70 - 30 * difficulty(currentLetter());
          AudioSys.sfx.tank();
          burst(sx - 2, GROUND_Y - 8, 5, FIRE, 0.6, true, 0, 10);
        }
      }
    }
  }

  function updateShells() {
    for (const s of G.shells) { s.x -= 1.5; if (s.x < G.dist - 10) s.dead = true; }
    G.shells = G.shells.filter(s => !s.dead);
  }

  function updateWaves() {
    const bw = G.dist + G.buggy.x;
    if (!G.wave) {
      const t = G.triggers.find(tr => !tr.used && bw >= tr.x);
      if (t) {
        t.used = true;
        if (bw - t.x < 300) { G.wave = { type: t.type, n: t.n, spawned: 0, timer: 0 }; AudioSys.sfx.alarm(); }
      }
    }
    const w = G.wave;
    if (!w) return;
    if (w.spawned < w.n && --w.timer <= 0) { spawnUfo(w.type, w.spawned); w.spawned++; w.timer = 28; }
    if (w.spawned >= w.n && G.ufos.length === 0) G.wave = null;
  }

  function spawnUfo(type, i) {
    const fromLeft = type === 3 && i % 2 === 0;
    const [w, h] = { 1: [16, 7], 2: [14, 8], 3: [12, 8] }[type];
    G.ufos.push({
      type, w, h, x: fromLeft ? -10 : W + 10, y: HUD_H + 12 + Math.random() * 20,
      vx: fromLeft ? 1.5 : -1.5, vy: 0.3, tx: 60 + Math.random() * 150, ty: HUD_H + 25 + Math.random() * 40,
      retarget: 60, bombCd: 60 + i * 20 + Math.random() * 40, life: 60 * 14 + i * 30, t: Math.random() * 100, leaving: false,
    });
  }

  function updateUfos() {
    const dd = difficulty(currentLetter());
    const maxBombs = 2 + (dd > 0.5 ? 1 : 0) + Math.min(G.course, 2);
    for (const u of G.ufos) {
      u.t++;
      if (u.leaving) {
        u.vy -= 0.06; u.x += u.vx; u.y += u.vy;
        if (u.y < HUD_H - 12 || u.x < -30 || u.x > W + 30) u.dead = true;
        continue;
      }
      if (--u.retarget <= 0) {
        u.tx = 24 + Math.random() * (W - 48);
        if (u.type === 1) { u.ty = HUD_H + 18 + Math.random() * 45; u.retarget = 60 + Math.random() * 60; }
        else if (u.type === 2) { u.ty = HUD_H + 30 + Math.random() * 55; u.retarget = 50 + Math.random() * 50; }
        else {
          if (Math.random() < 0.35) { u.ty = GROUND_Y - 48; u.tx = G.buggy.x + 16 + (Math.random() - 0.5) * 60; }
          else u.ty = HUD_H + 16 + Math.random() * 50;
          u.retarget = 30 + Math.random() * 35;
        }
      }
      const acc = u.type === 3 ? 0.004 : 0.0015, damp = u.type === 3 ? 0.92 : 0.94, vmax = u.type === 3 ? 3.5 : 2.5;
      u.vx = clamp((u.vx + (u.tx - u.x) * acc) * damp, -vmax, vmax);
      u.vy = clamp((u.vy + (u.ty - u.y) * acc) * damp, -vmax, vmax);
      u.x += u.vx; u.y += u.vy + Math.sin(u.t * 0.12) * 0.25;
      if (--u.bombCd <= 0) {
        if (Math.abs(u.x - (G.buggy.x + 16)) < 70 && G.bombs.length < maxBombs && G.state === 'play') {
          const scatter = (Math.random() - 0.5) * (1 - dd) * 0.8;
          G.bombs.push({ x: u.x, y: u.y + u.h / 2, vx: u.vx * 0.35 + scatter, vy: 0.5, crater: u.type === 2 });
          AudioSys.sfx.bomb();
          u.bombCd = (u.type === 3 ? 45 : 70) + Math.random() * (120 - 60 * dd);
        } else u.bombCd = 8;
      }
      if (--u.life <= 0) { u.leaving = true; u.vy = -0.4; }
    }
    G.ufos = G.ufos.filter(u => !u.dead);
  }

  function updateBombs() {
    for (const bm of G.bombs) {
      bm.vy = Math.min(2.4, bm.vy + 0.04);
      bm.x += bm.vx; bm.y += bm.vy;
      if (bm.y >= GROUND_Y - 1) {
        bm.dead = true;
        burst(bm.x, GROUND_Y - 2, 12, FIRE.concat(DUST), 1.2, true, 0.06, 22);
        AudioSys.sfx.boom();
        if (bm.crater && G.state === 'play') addBombCrater(bm.x + G.dist);
      }
    }
    G.bombs = G.bombs.filter(b => !b.dead);
  }

  function addBombCrater(wx) {
    const x = Math.round(wx - 7), w = 14;
    // Keep bomb craters fair: never right under the buggy's nose, and always
    // leave a landing zone between them and any other hazard.
    if (x - (G.dist + G.buggy.x + 30) < 50 && x + w > G.dist + G.buggy.x - 4) return;
    const LAND = 70;
    if (G.craters.some(c => x < c.x + c.w + LAND && x + w + LAND > c.x)) return;
    if (G.obs.some(o => { const bx = obsBox(o); const ox = bx.x + G.dist; return x < ox + bx.w + LAND && x + w + LAND > ox; })) return;
    G.craters.push({ x, w, depth: 8, passed: false, bomb: true });
  }

  function updateParticles(scroll) {
    for (const p of G.parts) {
      p.vy += p.g; p.x += p.vx - (p.ground ? scroll : 0); p.y += p.vy;
      if (p.floor && p.y > GROUND_Y - 1) { p.y = GROUND_Y - 1; p.vy *= -0.35; p.vx *= 0.6; }
      p.life--;
    }
    G.parts = G.parts.filter(p => p.life > 0);
    for (const t of G.texts) { t.y -= 0.3; if (t.ground) t.x -= scroll; t.life--; }
    G.texts = G.texts.filter(t => t.life > 0);
  }

  function hitObstacle(o) {
    const box = obsBox(o), cx = box.x + box.w / 2;
    if (o.type === 'rock' && o.big) {
      o.big = false; o.x += 3;
      addScore(50, cx, GROUND_Y - 22, true);
      burst(cx, GROUND_Y - 9, 10, DUST, 1.1, true, 0.08, 24, true);
      AudioSys.sfx.hit();
      return;
    }
    o.dead = true;
    if (o.type === 'rock') { addScore(100, cx, GROUND_Y - 18, true); burst(cx, GROUND_Y - 5, 16, DUST, 1.3, true, 0.08, 26, true); AudioSys.sfx.hit(); }
    else if (o.type === 'boulder') { addScore(200, cx, GROUND_Y - 22, true); burst(cx, GROUND_Y - 7, 20, DUST, 1.5, true, 0.08, 28, true); AudioSys.sfx.boom(); }
    else { addScore(300, cx, GROUND_Y - 20, true); burst(cx, GROUND_Y - 6, 26, FIRE, 1.6, true, 0.06, 30, true); AudioSys.sfx.boom(); }
  }

  function killUfo(u) {
    u.dead = true;
    addScore(UFO_POINTS[u.type], u.x, u.y - 8, false);
    burst(u.x, u.y, 20, FIRE.concat(['#ffffff']), 1.6, false, 0.03, 26);
    AudioSys.sfx.ufoKill();
  }

  function collide() {
    const b = G.buggy, bb = buggyBox();
    if (!b.air) {
      for (const c of G.craters) {
        for (let i = 0; i < 3; i++) {
          const wx = G.dist + b.x + WHEEL_X[i] + 4;
          if (wx > c.x + 1.5 && wx < c.x + c.w - 1.5) return die(c.bomb ? 'bombcrater' : 'crater');
        }
      }
    }
    for (const o of G.obs) {
      const box = obsBox(o);
      if (overlap(bb, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 1 })) return die(o.type);
    }
    for (const s of G.shells) if (overlap(bb, { x: s.x - G.dist, y: s.y, w: 4, h: 2 })) return die('shell');
    for (const bm of G.bombs) if (overlap(bb, { x: bm.x - 1, y: bm.y - 2, w: 3, h: 4 })) { bm.dead = true; return die('bomb'); }
    for (const u of G.ufos) if (overlap(bb, ufoBox(u))) return die('ufo');

    const f = G.fshot;
    if (f) {
      const fb = { x: f.x, y: f.y - 1, w: 6, h: 3 };
      let hit = false;
      for (const o of G.obs) {
        if (o.type === 'mine' || o.dead) continue;
        if (overlap(fb, obsBox(o))) { hitObstacle(o); hit = true; break; }
      }
      if (!hit) {
        for (const s of G.shells) {
          if (overlap(fb, { x: s.x - G.dist - 1, y: s.y - 1, w: 6, h: 4 })) {
            s.dead = true; hit = true;
            addScore(50, s.x - G.dist, s.y - 8, true);
            burst(s.x - G.dist, s.y, 8, FIRE, 0.9, true, 0.02, 14);
            AudioSys.sfx.hit();
            break;
          }
        }
      }
      if (!hit) for (const u of G.ufos) if (!u.dead && overlap(fb, ufoBox(u))) { killUfo(u); hit = true; break; }
      if (hit) G.fshot = null;
    }
    for (const s of G.upshots) {
      const sb = { x: s.x, y: s.y, w: 2, h: 5 };
      for (const u of G.ufos) if (!u.dead && overlap(sb, ufoBox(u))) { killUfo(u); s.dead = true; break; }
      if (s.dead) continue;
      for (const bm of G.bombs) {
        if (!bm.dead && overlap(sb, { x: bm.x - 2, y: bm.y - 3, w: 5, h: 6 })) {
          bm.dead = true; s.dead = true;
          addScore(50, bm.x, bm.y - 6, false);
          burst(bm.x, bm.y, 8, FIRE, 1, false, 0.02, 16);
          AudioSys.sfx.hit();
          break;
        }
      }
    }
    G.upshots = G.upshots.filter(s => !s.dead);
    G.bombs = G.bombs.filter(x => !x.dead);
    G.ufos = G.ufos.filter(x => !x.dead);
    G.shells = G.shells.filter(x => !x.dead);
    G.obs = G.obs.filter(x => !x.dead);
  }

  function checkPasses() {
    const rear = G.dist + G.buggy.x + 2;
    for (const c of G.craters) {
      if (!c.passed && c.x + c.w < rear) { c.passed = true; addScore(c.w >= 22 ? 100 : 50, c.x + c.w / 2 - G.dist, GROUND_Y - 30, true); }
    }
    for (const o of G.obs) {
      const box = obsBox(o);
      if (!o.passed && box.x + box.w < G.buggy.x + 2) { o.passed = true; addScore(o.type === 'mine' ? 100 : 80, box.x + box.w / 2, GROUND_Y - 30, true); }
    }
  }

  function cleanup() {
    const cut = G.dist - 40;
    G.craters = G.craters.filter(c => c.x + c.w > cut);
    G.obs = G.obs.filter(o => o.x + 24 > cut);
    G.triggers = G.triggers.filter(t => !t.used);
  }

  function updateDying() {
    for (const d of G.debris) {
      d.vy += 0.12; d.x += d.vx; d.y += d.vy;
      const floor = GROUND_Y - (d.kind === 'wheel' ? 8 : 9);
      if (d.y > floor) { d.y = floor; d.vy *= -0.45; d.vx *= 0.7; if (Math.abs(d.vy) < 0.4) d.vy = 0; }
      if (d.kind === 'wheel') d.f += d.vx * 0.6;
    }
    if (G.frame % 7 === 0 && G.timer > 70) {
      const body = G.debris[3];
      G.parts.push({ x: body.x + 12 + Math.random() * 8, y: body.y, vx: (Math.random() - 0.5) * 0.3, vy: -0.4 - Math.random() * 0.4, g: -0.005, life: 40, max: 40, c: ['#6b7280', '#9ca3af', '#4b5563'][Math.floor(Math.random() * 3)], ground: false, floor: false });
    }
    updateUfos(); updateBombs(); updateShells(); updateParticles(0);
    if (--G.timer <= 0) {
      if (G.demo) { toAttract('scores'); return; }
      G.lives--;
      if (G.lives <= 0) { G.state = 'gameover'; G.timer = 210; AudioSys.sfx.gameover(); }
      else { resetField(G.cp); G.state = 'ready'; G.timer = 150; }
    }
  }

  function updateGameOver() {
    updateParticles(0);
    if (--G.timer <= 0) {
      const final = G.score;
      toAttract('scores');
      if (api.onGameOver) api.onGameOver(final);
    }
  }

  // ---------------------------------------------------------------- scores
  const qualifies = score => score > 0 && score > scores[scores.length - 1].score;
  function saveScore(name, score) {
    scores.push({ name: (name || '---').toUpperCase().slice(0, 3), score });
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 5);
    Store.save('lp_scores', scores);
    G.hi = Math.max(G.hi, scores[0].score);
  }

  // ---------------------------------------------------------------- rendering
  function drawSky() {
    for (const s of BG.stars) {
      const sx = ((s.x - G.dist * 0.04) % 512 + 512) % 512;
      if (sx >= W) continue;
      if (((G.frame + s.tw * 7) >> 4) % 9 === 0) continue;
      ctx.fillStyle = s.c;
      ctx.fillRect(Math.floor(sx), Math.floor(s.y), 1, 1);
    }
  }

  function drawLayer(img, factor, y) {
    const off = -(Math.floor(G.dist * factor) % 512);
    ctx.drawImage(img, off, y);
    ctx.drawImage(img, off + 512, y);
  }

  function drawGround(field) {
    const off = -(Math.floor(G.dist) % 256);
    ctx.drawImage(BG.ground, off, GROUND_Y);
    ctx.drawImage(BG.ground, off + 256, GROUND_Y);
    const d0 = Math.floor(G.dist);
    ctx.fillStyle = '#e39a58';
    for (let sx = 0; sx < W; sx++) {
      const wx = d0 + sx;
      if (wx % 6 === 0 && groundBump(wx) < 0) ctx.fillRect(sx, GROUND_Y - 1, 3, 1);
    }
    if (!field) return;
    for (const c of G.craters) {
      const cx = Math.round(c.x - G.dist);
      if (cx > W || cx + c.w < 0) continue;
      ctx.fillStyle = '#e39a58';
      ctx.fillRect(cx - 2, GROUND_Y - 1, 2, 1);
      ctx.fillRect(cx + c.w, GROUND_Y - 1, 2, 1);
      for (let i = 0; i < c.w; i++) {
        const t = (i + 0.5) / c.w * 2 - 1;
        const dep = Math.max(2, Math.round(Math.sqrt(1 - t * t) * c.depth));
        ctx.fillStyle = '#000';
        ctx.fillRect(cx + i, GROUND_Y, 1, dep);
        ctx.fillStyle = i < c.w / 2 ? '#5b2e12' : '#7a3b1a';
        ctx.fillRect(cx + i, GROUND_Y + dep, 1, 2);
      }
    }
  }

  function drawSigns() {
    for (let i = 0; i < 26; i++) {
      const sx = Math.round(letterX(i) - G.dist);
      if (sx < -12 || sx > W + 12) continue;
      const cp = CHECKPOINTS.includes(i);
      ctx.fillStyle = '#9aa8b8'; ctx.fillRect(sx, GROUND_Y - 20, 1, 20);
      ctx.fillStyle = cp ? '#ffb020' : '#2f80ed'; ctx.fillRect(sx - 5, GROUND_Y - 30, 11, 10);
      ctx.fillStyle = cp ? '#b36b00' : '#1b4f99'; ctx.fillRect(sx - 5, GROUND_Y - 21, 11, 1);
      FONT.draw(ctx, LETTERS[i], sx - 2, GROUND_Y - 29, cp ? '#1a1206' : '#ffffff');
    }
    // Patrol base at the start of the course.
    const bx = Math.round(letterX(0) - 110 - G.dist);
    if (bx > -60 && bx < W) {
      const r = 22, cx = bx + 26;
      for (let dx = -r; dx <= r; dx++) {
        const dh = Math.round(Math.sqrt(r * r - dx * dx) * 0.8);
        ctx.fillStyle = dx < -8 ? '#e4ebf2' : dx < 8 ? '#c3ceda' : '#8492a3';
        ctx.fillRect(cx + dx, GROUND_Y - dh, 1, dh);
      }
      ctx.fillStyle = '#2f80ed'; ctx.fillRect(cx - r + 2, GROUND_Y - 9, r * 2 - 3, 2);
      ctx.fillStyle = '#10151d'; ctx.fillRect(cx + 4, GROUND_Y - 11, 14, 11);
      ctx.fillStyle = '#9aa8b8'; ctx.fillRect(cx - 2, GROUND_Y - 26, 1, 9);
      ctx.fillStyle = (G.frame >> 4) & 1 ? '#ff3b30' : '#5a1a16'; ctx.fillRect(cx - 3, GROUND_Y - 27, 3, 2);
    }
  }

  function drawObstacles() {
    for (const o of G.obs) {
      const sx = Math.round(o.x - G.dist);
      if (sx < -24 || sx > W + 4) continue;
      switch (o.type) {
        case 'rock': ctx.drawImage(o.big ? SPR.rockL : SPR.rockS, sx, GROUND_Y - (o.big ? 13 : 8)); break;
        case 'mine': ctx.drawImage(SPR.mine[(G.frame >> 4) & 1], sx, GROUND_Y - 5); break;
        case 'tank': ctx.drawImage(SPR.tank, sx, GROUND_Y - 10); break;
        case 'boulder': ctx.drawImage(SPR.boulder[((Math.floor(-o.x / 3) % 4) + 4) % 4], sx, GROUND_Y - 14); break;
      }
    }
    for (const s of G.shells) {
      const sx = Math.round(s.x - G.dist);
      ctx.fillStyle = '#ff9f1c'; ctx.fillRect(sx, s.y, 4, 2);
      ctx.fillStyle = '#fff6d5'; ctx.fillRect(sx, s.y, 1, 2);
    }
  }

  function drawBuggy() {
    const b = G.buggy, by = bodyY(), bx = Math.round(b.x);
    const avg = (b.wy[0] + b.wy[1] + b.wy[2]) / 3;
    const wf = SPR.wheels[Math.floor(b.rot) % 4];
    for (let i = 0; i < 3; i++) {
      const rel = clamp(Math.round(b.wy[i] - avg), -2, 2);
      ctx.drawImage(wf, bx + WHEEL_X[i], by + 7 + rel);
    }
    ctx.drawImage(SPR.buggy, bx, by);
  }

  function drawDebris() {
    for (const d of G.debris) {
      if (d.kind === 'wheel') ctx.drawImage(SPR.wheels[((Math.floor(d.f) % 4) + 4) % 4], Math.round(d.x), Math.round(d.y));
      else if (G.timer > 60 || (G.frame >> 2) & 1) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(SPR.buggy, Math.round(d.x), Math.round(d.y));
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawAir() {
    const f = G.fshot;
    if (f) {
      ctx.fillStyle = '#ff9f1c'; ctx.fillRect(Math.round(f.x) - 3, f.y - 1, 3, 2);
      ctx.fillStyle = '#ffe066'; ctx.fillRect(Math.round(f.x), f.y - 1, 6, 2);
    }
    for (const s of G.upshots) {
      ctx.fillStyle = '#ffe066'; ctx.fillRect(s.x, Math.round(s.y), 2, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, Math.round(s.y), 2, 1);
    }
    const blink = (G.frame >> 3) & 1;
    for (const u of G.ufos) {
      const img = (u.type === 1 ? SPR.ufo1 : u.type === 2 ? SPR.ufo2 : SPR.ufo3)[blink];
      ctx.drawImage(img, Math.round(u.x - u.w / 2), Math.round(u.y - u.h / 2));
    }
    for (const bm of G.bombs) {
      const x = Math.round(bm.x) - 1, y = Math.round(bm.y) - 2;
      ctx.fillStyle = bm.crater ? '#ffb020' : '#ff5a36'; ctx.fillRect(x, y, 3, 4);
      ctx.fillStyle = (G.frame >> 2) & 1 ? '#ffffff' : '#ffd166'; ctx.fillRect(x + 1, y + 3, 1, 1);
    }
  }

  function drawParticles() {
    for (const p of G.parts) {
      ctx.globalAlpha = clamp(p.life / (p.max * 0.5), 0, 1);
      ctx.fillStyle = p.c;
      const s = p.life > p.max * 0.6 ? 2 : 1;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    ctx.globalAlpha = 1;
    for (const t of G.texts) FONT.draw(ctx, t.text, Math.round(t.x - FONT.width(t.text) / 2), Math.round(t.y), t.c);
  }

  function lamp(x, y, on, onCol, offCol) {
    ctx.fillStyle = on ? onCol : offCol;
    ctx.fillRect(x + 1, y, 5, 7); ctx.fillRect(x, y + 1, 7, 5);
    if (on) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 2, y + 2, 1, 1); }
  }

  function drawHUD(field) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, HUD_H);
    FONT.draw(ctx, '1UP', 8, 3, '#ff4d4d');
    FONT.draw(ctx, pad(G.score), 8, 12, '#f5f7fa');
    FONT.draw(ctx, 'HI-SCORE', 76, 3, '#ffb020');
    FONT.draw(ctx, pad(G.hi), 82, 12, '#f5f7fa');
    FONT.draw(ctx, 'TIME', 164, 3, '#39c6f0');
    FONT.draw(ctx, String(Math.floor(G.segFrames / 60)).padStart(3, '0'), 168, 12, '#f5f7fa');

    const blink = (G.frame >> 3) & 1;
    const ahead = G.dist + G.buggy.x;
    const air = field && (G.wave || G.ufos.length > 0);
    const gnd = field && (G.shells.length > 0 || G.obs.some(o => (o.type === 'tank' || o.type === 'boulder') && o.x > ahead && o.x - ahead < 320));
    const mines = field && G.obs.some(o => o.type === 'mine' && o.x > ahead && o.x - ahead < 320);
    lamp(212, 4, air && blink, '#ff3b30', '#3a1210');
    lamp(224, 4, gnd && blink, '#ffb020', '#3a2a08');
    lamp(236, 4, mines && blink, '#34d399', '#0f3326');

    const cur = currentLetter();
    ctx.fillStyle = '#2f80ed';
    ctx.fillRect(7, 21, 18, 1); ctx.fillRect(7, 38, 18, 1); ctx.fillRect(7, 21, 1, 18); ctx.fillRect(24, 21, 1, 18);
    FONT.draw(ctx, field ? LETTERS[cur] : 'A', 11, 23, '#ffb020', 2);

    const x0 = 36, x1 = 246, bw = x1 - x0;
    const p = field ? clamp((G.dist + G.buggy.x + 16 - letterX(0)) / (25 * SEG), 0, 1) : 0;
    ctx.fillStyle = '#1d3b66'; ctx.fillRect(x0, 27, bw, 3);
    ctx.fillStyle = '#39c6f0'; ctx.fillRect(x0, 27, Math.round(bw * p), 3);
    for (let i = 0; i < 26; i++) {
      const x = Math.round(x0 + bw * i / 25);
      const cp = CHECKPOINTS.includes(i);
      ctx.fillStyle = cp ? '#ffb020' : '#5b7fb3';
      ctx.fillRect(x, cp ? 25 : 26, 1, cp ? 6 : 4);
      if (cp) FONT.draw(ctx, LETTERS[i], x - 2, 32, i <= G.cp && field ? '#ffb020' : '#8a6a2a');
    }
    ctx.drawImage(SPR.life, Math.round(x0 + bw * p) - 6, 19);
  }

  function drawGroundHUD() {
    for (let i = 0; i < Math.min(G.lives - 1, 8); i++) ctx.drawImage(SPR.life, 6 + i * 14, GROUND_Y + 29);
    const name = G.course === 0 ? 'BEGINNER' : 'CHAMPION';
    FONT.draw(ctx, name, W - FONT.width(name) - 6, GROUND_Y + 28, '#ffd9a8');
  }

  function box(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2f80ed';
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  }

  function row(label, value, y, lc, vc) {
    FONT.draw(ctx, label, 52, y, lc);
    FONT.draw(ctx, value, 204 - FONT.width(value), y, vc);
  }

  function drawOverlays() {
    const blink = (G.frame >> 4) & 1;
    if (G.state === 'ready') {
      box(48, 78, 160, 50);
      FONT.center(ctx, G.readyMsg || (G.course === 0 ? 'BEGINNER COURSE' : 'CHAMPION COURSE'), 86, '#39c6f0');
      FONT.center(ctx, 'POINT ' + LETTERS[G.cp], 99, '#ffb020', 1);
      if (blink) FONT.center(ctx, 'GET READY', 112, '#f5f7fa');
    }
    if (G.panel) {
      const p = G.panel;
      box(44, 58, 168, p.final ? 84 : 74);
      FONT.center(ctx, 'POINT ' + p.letter, 64, '#ffb020', 2);
      row('YOUR TIME', String(p.secs), 84, '#39c6f0', '#f5f7fa');
      row('AVERAGE TIME', String(p.avg), 94, '#39c6f0', '#f5f7fa');
      row('TOP RECORD', String(p.rec), 104, '#39c6f0', '#f5f7fa');
      row(p.secs <= p.avg ? 'GOOD BONUS' : 'BONUS', String(p.bonus), 116, '#ff4d4d', '#ffb020');
      if (p.final && blink) FONT.center(ctx, 'COURSE COMPLETE!', 130, '#34d399');
    }
    if (G.state === 'gameover') {
      box(64, 88, 128, 32);
      FONT.center(ctx, 'GAME OVER', 97, '#ff4d4d', 2);
    }
    if (G.demo) {
      FONT.center(ctx, 'DEMO PLAY', HUD_H + 6, '#39c6f0');
      if (blink) FONT.center(ctx, 'PRESS ENTER TO START', HUD_H + 18, '#ffb020');
    }
  }

  function drawTitle() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(20, HUD_H + 8, 216, 124);
    FONT.shadow(ctx, 'LUNAR', HUD_H + 16, '#ffb020', '#b3261e', 3);
    FONT.shadow(ctx, 'PATROL', HUD_H + 42, '#ffb020', '#b3261e', 3);
    if ((G.frame >> 5) & 1) FONT.center(ctx, 'PRESS ENTER TO START', HUD_H + 76, '#f5f7fa');
    FONT.center(ctx, '1 PLAYER  -  3 BUGGIES', HUD_H + 92, '#39c6f0');
    FONT.center(ctx, 'EXTRA BUGGY AT 10000 30000 50000', HUD_H + 104, '#9aa8b8');
    FONT.center(ctx, 'AN ARCADE TRIBUTE', HUD_H + 118, '#5b7fb3');
  }

  function drawPoints() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(20, HUD_H + 6, 216, 136);
    FONT.center(ctx, 'SCORE ADVANCE TABLE', HUD_H + 12, '#ffb020');
    const items = [
      [SPR.ufo1[0], '100 PTS', '#f5f7fa'], [SPR.ufo2[0], '200 PTS', '#f5f7fa'], [SPR.ufo3[0], '300 PTS', '#f5f7fa'],
      [SPR.tank, '300 PTS', '#f5f7fa'], [SPR.boulder[0], '200 PTS', '#f5f7fa'], [SPR.rockL, '50 + 100 PTS', '#f5f7fa'],
      [SPR.mine[0], 'JUMP 100 PTS', '#f5f7fa'],
    ];
    items.forEach(([img, txt], i) => {
      const y = HUD_H + 28 + i * 15;
      ctx.drawImage(img, 76 - Math.floor(img.width / 2), y + 3 - Math.floor(img.height / 2));
      FONT.draw(ctx, '= ' + txt, 100, y, '#f5f7fa');
    });
  }

  function drawScores() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(40, HUD_H + 8, 176, 112);
    FONT.center(ctx, 'BEST PATROLS', HUD_H + 16, '#ffb020', 1);
    const cols = ['#ffb020', '#f5f7fa', '#f5f7fa', '#f5f7fa', '#f5f7fa'];
    scores.forEach((s, i) => {
      const y = HUD_H + 36 + i * 14;
      FONT.draw(ctx, ['1ST', '2ND', '3RD', '4TH', '5TH'][i], 64, y, '#39c6f0');
      FONT.draw(ctx, s.name, 104, y, cols[i]);
      FONT.draw(ctx, pad(s.score), 148, y, cols[i]);
    });
    if ((G.frame >> 5) & 1) FONT.center(ctx, 'PRESS ENTER TO START', HUD_H + 108, '#f5f7fa');
  }

  function render() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const field = ['ready', 'play', 'dying', 'gameover'].includes(G.state);
    drawSky();
    drawLayer(BG.mountains, 0.12, MOUNT_Y);
    drawLayer(BG.hills, 0.35, HILL_Y);
    drawGround(field);
    if (field) {
      drawSigns();
      drawObstacles();
      if (G.state === 'dying') drawDebris();
      else if (G.state !== 'gameover') drawBuggy();
      drawAir();
      drawGroundHUD();
    }
    drawParticles();
    drawHUD(field);
    if (G.state === 'title') drawTitle();
    else if (G.state === 'points') drawPoints();
    else if (G.state === 'scores') drawScores();
    drawOverlays();
    if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(0, HUD_H, W, H - HUD_H); }
    if (G.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, HUD_H, W, H - HUD_H);
    }
  }

  // ---------------------------------------------------------------- loop
  let last = 0, acc = 0;
  const DT = 1000 / 60;
  function loop(t) {
    requestAnimationFrame(loop);
    if (!last) last = t;
    acc += Math.min(100, t - last);
    last = t;
    while (acc >= DT) { step(); acc -= DT; }
    render();
  }

  buildBackgrounds();
  clearField();
  requestAnimationFrame(loop);

  const api = {
    press, release, releaseAll, startGame, quitToTitle, qualifies, saveScore,
    getScores: () => scores.slice(),
    setPaused(p) { G.paused = p; AudioSys.setPaused(p); if (p) releaseAll(); },
    isPaused: () => G.paused,
    inGame: () => G.mode === 'game' && G.state !== 'gameover',
    onGameOver: null,
    _state: () => G,
    // Test hook: advance the simulation n frames synchronously and redraw.
    _tick(n = 1, auto = false) {
      for (let i = 0; i < n; i++) {
        if (auto && G.state === 'play') { G.frame++; updatePlay(autopilot()); } else step();
      }
      render();
      return { death: G.lastDeath, state: G.state, letter: LETTERS[currentLetter()], score: G.score, lives: G.lives, cp: LETTERS[G.cp], course: G.course, ufos: G.ufos.length };
    },
  };
  return api;
})();
