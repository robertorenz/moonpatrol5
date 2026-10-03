'use strict';
/* Classic mode — a pixel-art recreation of the 1982 coin-op.
   Sprites are hand-made pixel maps. They are drawn with nearest-neighbour scaling straight onto the
   full-resolution canvas, so every pixel stays crisp while scrolling and motion stay smooth. */
const Classic = (() => {
  const H = 224, HUD_H = 40, GROUND_Y = 184;
  let W = 256;
  const SEG = 600, LEAD = 220;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const CHECKPOINTS = [0, 4, 9, 14, 19, 25];
  const JUMP_V = 2.55, GRAV = 0.1;
  const SPEED_MIN = 0.7, SPEED_MAX = 2.0, SPEED_BASE = 1.15;
  const EXTRA_LIVES = [10000, 30000, 50000];
  const WHEEL_DX = [1, 12, 23];          // wheel sprite left edges relative to the buggy
  const ENGAGE = 248;                    // hazards act at arcade-screen distance in any view width
  const FONT = '"Press Start 2P", monospace';
  const letterX = i => LEAD + i * SEG;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  let SX = 4, SY = 4, active = false;

  // ---------------------------------------------------------------- utilities
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const pad = n => String(n).padStart(6, '0');
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  const Store = {
    load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const DEFAULT_SCORES = [
    { name: 'IRM', score: 20000 }, { name: 'MPT', score: 15000 }, { name: 'BUG', score: 10000 },
    { name: 'LUN', score: 7500 }, { name: 'AZ ', score: 5000 },
  ];

  // ---------------------------------------------------------------- sprite sheets
  // Each sprite is a list of rows; every character maps to a palette colour ('.' is transparent).
  function sprite(rows, pal) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, j, 1, 1); }
    }));
    return c;
  }
  // Procedural pixel sprite: fn(i, j) returns a colour or null.
  function pixels(w, h, fn) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const col = fn(i, j);
      if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); }
    }
    return c;
  }

  const BUGGY_PAL = {
    k: '#2a0a22', P: '#f04fb8', L: '#ffa8e2', D: '#a3247a', C: '#7ff0ff', c: '#1f9fd0',
    w: '#ffffff', G: '#d6dde6', g: '#7b8592', Y: '#ffd23f',
  };
  const BUGGY = sprite([
    '...G............................',
    '...G............................',
    '..kGk.........kkkkk.............',
    '..kGk........kCCwCck............',
    '..kPk.......kCCwCCcck...........',
    '.kPPPkkkkkkkPPPPPPPPPkkkkkk.....',
    'kLLLLLLLLLLLLLLLLLLLLLLLLLLLk...',
    'kPPPPPPPPPPPPPPPPPPPPPPPPPPPPk..',
    'kPPYPPPPPPPPPPPPPPPPPPPPPPPPPk..',
    'kDDDDDDDDDDDDDDDDDDDDDDDDDDDDkkk',
    '.kDDkkkDDDkkkkDDDDkkkkDDDkkDGGGG',
    '..kk...kkk....kkkk....kkk..k....',
  ], BUGGY_PAL);

  const WHEEL_PAL = { k: '#1d2026', W: '#d8dde4', d: '#6d7682', H: '#ffd23f' };
  const WHEELS = [
    sprite(['..kkkk..', '.kWWWWk.', 'kWdWWdWk', 'kWWHHWWk', 'kWWHHWWk', 'kWdWWdWk', '.kWWWWk.', '..kkkk..'], WHEEL_PAL),
    sprite(['..kkkk..', '.kWddWk.', 'kWWddWWk', 'kddHHddk', 'kddHHddk', 'kWWddWWk', '.kWddWk.', '..kkkk..'], WHEEL_PAL),
  ];
  const MINI_BUGGY = sprite([
    '.k..............',
    '.k.....kkk......',
    'kPkkkkkPCCkkkk..',
    'kLLLLLLLLLLLLLkk',
    'kPPPPPPPPPPPPPPG',
    '.kWk..kWk..kWk..',
  ], { ...BUGGY_PAL, W: '#d8dde4' });

  // Saucer (type 1): drops bombs.
  const UFO1 = [0, 1].map(f => sprite([
    '......kkkk......',
    '....kkCCwCkk....',
    '...kCCCCwCCCk...',
    '.kkkkkkkkkkkkkk.',
    f ? 'kWRWWWYWWWRWWWYk' : 'kWYWWWRWWWYWWWRk',
    '.kSSSSSSSSSSSSk.',
    '...kkkkkkkkkk...',
  ], { k: '#14161c', C: '#5fd6ff', w: '#ffffff', W: '#eef1f5', S: '#8c96a3', R: '#ff3b30', Y: '#ffd23f' }));

  // Bomber (type 2): its bombs blast new craters.
  const UFO2 = [0, 1].map(f => sprite([
    '.....kkkkkk.....',
    '....kYYwwYYk....',
    '...kYYYYYYYYk...',
    '.kkkkkkkkkkkkkk.',
    'kOOOOOOOOOOOOOOk',
    f ? 'kOrOOOOrOOOOrOOk' : 'kOOOrOOOOrOOOOrk',
    '.kOOOOOOOOOOOOk.',
    '..kk..kkkk..kk..',
    f ? '..r....rr....r..' : '..Y....YY....Y..',
  ], { k: '#1a0d04', Y: '#ffe066', w: '#ffffff', O: '#ff8a1f', r: '#ff3b30' }));

  // Darter (type 3): small, fast, dives low.
  const UFO3 = [0, 1].map(f => sprite([
    '.....kk.....',
    '....kGGk....',
    '..kkGwwGkk..',
    '.kGGGGGGGGk.',
    f ? 'kGgGGgGGgGGk' : 'kGGgGGgGGgGk',
    '.kkGGGGGGkk.',
    '...k.kk.k...',
  ], { k: '#062012', G: '#3ee87a', g: '#0f8a3c', w: '#e9fff0' }));

  const TANK = sprite([
    '........kkkkk.......',
    '.......kTTlTTk......',
    'GGGGGGGkTTTTTTk.....',
    'gggggggkTTTTTTk.....',
    '...kkkkkkkkkkkkkkk..',
    '..kTlTTTTTTTTTTTTTk.',
    '.kTTTTTTTTTTTTTTTTTk',
    'kddddddddddddddddddk',
    'kdWdkdWdkdWdkdWdkdWk',
    '.kkkkkkkkkkkkkkkkkk.',
  ], { k: '#0d1a08', T: '#5f9e2f', l: '#a8dd6b', G: '#c6ccd4', g: '#6e7681', d: '#33421f', W: '#9aa38f' });

  const MINE = [0, 1].map(f => sprite([
    '..kkkk..',
    '.kMMMMk.',
    f ? 'kMRMMRMk' : 'kMWMMWMk',
    'kkkkkkkk',
  ], { k: '#1a1a1a', M: '#9aa3ad', R: '#ff3b30', W: '#fff3a0' }));

  // Rocks: lumpy piles shaded from the upper left.
  const ROCK_PAL = ['#ffd9a3', '#e0a35c', '#b87332', '#7a4419', '#3d1f0a'];
  function rockSprite(w, h, seed) {
    const r = mulberry32(seed);
    const bumps = Array.from({ length: 3 }, () => ({ c: 0.2 + r() * 0.6, s: 0.25 + r() * 0.25, a: 0.55 + r() * 0.45 }));
    const top = i => {
      const t = (i + 0.5) / w;
      let v = 0;
      for (const b of bumps) v = Math.max(v, b.a * Math.max(0, 1 - ((t - b.c) / b.s) ** 2));
      return h - Math.round(v * h);
    };
    return pixels(w, h, (i, j) => {
      const t = top(i);
      if (j < t) return null;
      if (j === t || (i === 0 || i === w - 1)) return ROCK_PAL[4];
      const lit = (top(i - 1) > t ? 1 : 0) + (j - t < 2 ? 1 : 0) + (i < w * 0.4 ? 1 : 0) - (j > h - 3 ? 1 : 0);
      const n = (i * 7 + j * 13 + seed) % 11 === 0;
      return ROCK_PAL[clamp(3 - lit + (n ? 1 : 0), 0, 3)];
    });
  }
  const ROCK_S = rockSprite(10, 8, 3), ROCK_L = rockSprite(16, 13, 11);

  // Rolling boulder: a round rock with crack marks that turn as it rolls.
  const BOULDER = [0, 1, 2, 3].map(f => pixels(14, 14, (i, j) => {
    const cx = i - 6.5, cy = j - 6.5, d = Math.hypot(cx, cy);
    if (d > 6.9) return null;
    if (d > 6) return ROCK_PAL[4];
    const a = Math.atan2(cy, cx) + f * Math.PI / 8;
    const crack = Math.abs(Math.sin(a * 2)) < 0.12 && d > 2 && d < 5.5;
    if (crack) return ROCK_PAL[4];
    const lit = -cx * 0.6 - cy * 0.8;
    return ROCK_PAL[lit > 3 ? 0 : lit > 0 ? 1 : lit > -3 ? 2 : 3];
  }));

  const SHELL = sprite(['.YYw', 'rOYY'], { Y: '#ffd23f', w: '#ffffff', r: '#ff3b30', O: '#ff8a1f' });
  const BOMB = [0, 1].map(f => sprite(['.w.', 'wRw', f ? 'RYR' : 'YRY', '.R.'], { w: '#ffffff', R: '#ff3b30', Y: '#ffd23f' }));
  const FWD_SHOT = sprite(['YYYYww', 'OYYYYw'], { Y: '#ffd23f', w: '#ffffff', O: '#ff8a1f' });
  const UP_SHOT = sprite(['.w.', 'wYw', 'YYY', '.O.', '.O.'], { w: '#ffffff', Y: '#ffd23f', O: '#ff8a1f' });

  // Explosion: four growing frames of a pixel fireball.
  const BOOM_COLS = ['#ffffff', '#fff3a0', '#ffd23f', '#ff8a1f', '#ff3b30', '#8c1d12'];
  const BOOM = [3, 5, 7, 8].map((rad, f) => {
    const r = mulberry32(700 + f);
    return pixels(18, 18, (i, j) => {
      const d = Math.hypot(i - 8.5, j - 8.5) + r() * 2.2 - 1.1;
      if (d > rad) return null;
      if (f === 3 && r() < 0.45) return null;
      const k = Math.floor(d / rad * 4 + f * 0.6);
      return BOOM_COLS[clamp(k, 0, 5)];
    });
  });

  // ---------------------------------------------------------------- background layers (pixel art)
  const BG = { stars: [], mountains: null, hills: null, city: null, ground: null };
  const MOUNT_H = 92, MID_H = 40, GROUND_H = H - GROUND_Y;

  function ridge(seed, n, base, amp, rough) {
    const r = mulberry32(seed), a = new Float32Array(n);
    let step = n / 4;
    for (let i = 0; i < n; i += step) a[i] = base + (r() - 0.5) * amp;
    let sc = amp * 0.55;
    while (step > 1) {
      const half = step / 2;
      for (let i = 0; i < n; i += step) a[i + half] = (a[i] + a[(i + step) % n]) / 2 + (r() - 0.5) * sc;
      sc *= rough; step = half;
    }
    return a;
  }

  function paintMountains() {
    const w = 512, h = MOUNT_H;
    const far = ridge(17, w, 40, 46, 0.58), near = ridge(51, w, 22, 22, 0.55);
    const ht = (p, i) => Math.round(clamp(p[(i + w) % w], 6, h - 2));
    return pixels(w, h, (i, j) => {
      const y = h - j;
      const n = ht(near, i);
      if (y <= n) {
        const slope = ht(near, i + 1) - ht(near, i - 1);
        if (y >= n - 1) return '#bfe3ff';
        if (slope > 0 && y > n - 5) return '#6fb0f2';
        return y < 8 ? '#123a7a' : '#1f57b0';
      }
      const f = ht(far, i);
      if (y <= f) {
        const slope = ht(far, i + 1) - ht(far, i - 1);
        if (y >= f - 1) return '#ffffff';
        if (y > f - 5 && f > 48) return '#e6f4ff';      // snow caps on the tallest peaks
        if (slope > 0 && y > f - 7) return '#a8d4ff';
        if (slope < 0 && y > f - 4) return '#3c7ed6';
        return (i * 5 + j * 3) % 29 === 0 ? '#78b6f5' : '#4f95e6';
      }
      return null;
    });
  }

  function paintHills() {
    const w = 512, h = MID_H;
    const hb = i => 12 + 8 * Math.abs(Math.sin(i * Math.PI / 128 + 1.7)) + 5 * Math.abs(Math.sin(i * Math.PI / 41 + 2.2));
    const hf = i => 6 + 14 * Math.abs(Math.sin(i * Math.PI / 96 + 0.4)) ** 1.3 + 6 * Math.abs(Math.sin(i * Math.PI / 37 + 0.8));
    return pixels(w, h, (i, j) => {
      const y = h - j, f = Math.round(hf(i)), b = Math.round(hb(i));
      if (y <= f) {
        if (y >= f - 1) return '#9cff8a';
        const slope = hf(i + 1) - hf(i - 1);
        if (slope > 0.15 && y > f - 4) return '#4fd65a';
        return (i * 3 + j * 5) % 23 === 0 ? '#0b5a25' : '#1f9a3f';
      }
      if (y <= b) return y >= b - 1 ? '#3bb85a' : '#106b2e';
      return null;
    });
  }

  function paintCity() {
    const w = 512, h = MID_H, r = mulberry32(4242);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const box = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    for (let t = 0; t < w; t += 5 + Math.floor(r() * 8)) box(t, h - 12 - Math.floor(r() * 14), 4 + Math.floor(r() * 5), 40, '#16346b');
    let t = 2;
    while (t < w - 16) {
      const k = r();
      if (k < 0.35) {                                    // dome
        const rad = 6 + Math.floor(r() * 6);
        for (let i = -rad; i <= rad; i++) {
          const hh = Math.round(Math.sqrt(rad * rad - i * i) * 0.9);
          box(t + rad + i, h - 4 - hh, 1, hh, i < -rad / 3 ? '#e8f4ff' : i < rad / 3 ? '#9cc7ef' : '#5a86c0');
          box(t + rad + i, h - 4 - hh, 1, 1, '#ffffff');
        }
        for (let i = -rad + 2; i < rad - 1; i += 3) box(t + rad + i, h - 6, 1, 1, '#ffd23f');
        t += rad * 2 + 3;
      } else if (k < 0.75) {                             // block tower
        const bw = 8 + Math.floor(r() * 10), bh = 10 + Math.floor(r() * 18);
        box(t, h - 4 - bh, bw, bh, '#3f6fb8');
        box(t, h - 4 - bh, 2, bh, '#7fb0f0');
        box(t, h - 4 - bh, bw, 1, '#cfe6ff');
        for (let wy = h - bh; wy < h - 6; wy += 3) for (let wx = t + 3; wx < t + bw - 1; wx += 3) if (r() < 0.6) box(wx, wy, 1, 1, r() < 0.8 ? '#ffd23f' : '#7ff0ff');
        t += bw + 2 + Math.floor(r() * 4);
      } else {                                           // antenna mast
        const th = 18 + Math.floor(r() * 14);
        box(t + 1, h - 4 - th, 2, th, '#c9d6e6');
        box(t - 1, h - 4 - th, 6, 2, '#e8f4ff');
        box(t + 1, h - 6 - th, 2, 2, '#ff3b30');
        t += 8;
      }
    }
    box(0, h - 4, w, 4, '#2a4f8f');
    for (let i = 0; i < w; i += 9) box(i, h - 4, 4, 1, '#7fb0f0');
    return c;
  }

  function paintGround() {
    const w = 256, h = GROUND_H, r = mulberry32(77);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const box = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    box(0, 0, w, h, '#c47a35');
    box(0, 0, w, 1, '#ffd29a');
    box(0, 1, w, 2, '#e8a45a');
    for (let y = 5; y < h; y += 3 + Math.floor(r() * 3)) {
      let sx = Math.floor(r() * 24);
      while (sx < w) {
        const len = 6 + Math.floor(r() * 28);
        for (let i = 0; i < len; i++) box((sx + i) % w, y, 1, 1, '#8a4a1c');
        for (let i = 2; i < len * 0.6; i++) box((sx + i) % w, y - 1, 1, 1, '#dc9a52');
        sx += len + 8 + Math.floor(r() * 26);
      }
    }
    for (let i = 0; i < 90; i++) {
      const px = Math.floor(r() * w), py = 4 + Math.floor(r() * (h - 5));
      box(px, py, 2, 1, '#5e2f10'); box(px, py - 1, 1, 1, '#ffd29a');
    }
    return c;
  }

  function buildLayers() {
    BG.mountains = paintMountains();
    BG.hills = paintHills();
    BG.city = paintCity();
    BG.ground = paintGround();
    const r = mulberry32(99);
    for (let i = 0; i < 70; i++) {
      BG.stars.push({ x: Math.floor(r() * 1024), y: HUD_H + 3 + Math.floor(r() * 70), c: pick(r, ['#ffffff', '#9fd6ff', '#ffe08a', '#ff9f9f']), tw: Math.floor(r() * 64) });
    }
  }

  // ---------------------------------------------------------------- state
  const G = {
    mode: 'attract', state: 'title', timer: 600, frame: 0, paused: false, demo: false,
    score: 0, hi: 0, lives: 3, nextExtra: 0, course: 0, cp: 0,
    dist: 0, speed: SPEED_BASE, segFrames: 0, genSeg: 0, nextFree: 0, fireHold: 0,
    theme: 0, prevTheme: 0, themeT: 0, lastDeath: '',
    buggy: null, craters: [], obs: [], shells: [], triggers: [], ufos: [], bombs: [], ups: [], fwd: null,
    parts: [], texts: [], debris: [], booms: [], wave: null, panel: null,
  };
  let scores = Store.load('lp_classic_scores', DEFAULT_SCORES.slice());
  const records = Store.load('lp_classic_records', {});
  G.hi = scores[0].score;

  const Input = { held: {}, hit: {} };
  function press(a) { if (!Input.held[a]) Input.hit[a] = true; Input.held[a] = true; }
  function release(a) { Input.held[a] = false; }
  function releaseAll() { Input.held = {}; }

  const newBuggy = () => ({ x: 52, y: 0, vy: 0, air: false, wb: [0, 0, 0], wv: [0, 0, 0], spin: 0 });
  const themeFor = cp => CHECKPOINTS.indexOf(cp) % 2;

  function clearField() {
    G.buggy = newBuggy();
    G.craters = []; G.obs = []; G.shells = []; G.triggers = []; G.ufos = []; G.bombs = [];
    G.ups = []; G.fwd = null; G.parts = []; G.texts = []; G.debris = []; G.booms = [];
    G.wave = null; G.panel = null; G.segFrames = 0;
  }

  function resetField(cp) {
    clearField();
    G.cp = cp; G.speed = SPEED_BASE;
    G.dist = letterX(cp) - 30 - G.buggy.x;
    G.genSeg = cp; G.nextFree = 0;
    G.theme = G.prevTheme = themeFor(cp); G.themeT = 0;
    ensureGenerated();
  }

  const worldBuggy = () => G.dist + G.buggy.x + 16;
  function currentLetter() {
    if (!G.buggy) return 0;
    return clamp(Math.floor((worldBuggy() - letterX(0)) / SEG), 0, 25);
  }

  function difficulty(s) {
    const c = Math.min(G.course, 2);
    return Math.min(1, [0, 0.4, 0.6][c] + (c === 0 ? 0.65 : 0.45) * s / 24 + Math.max(0, G.course - 2) * 0.1);
  }

  // ---------------------------------------------------------------- course generation
  function weighted(r, list) {
    let tot = 0;
    for (const [, w] of list) tot += w;
    let v = r() * tot;
    for (const [k, w] of list) if ((v -= w) < 0) return k;
    return list[0][0];
  }
  const addCrater = (x, w) => { G.craters.push({ x, w, depth: Math.min(14, 5 + Math.floor(w / 3)), passed: false }); return w; };

  function genSegment(s) {
    if (s > 24) return;
    const r = mulberry32(5150 + G.course * 777 + s * 131);
    const d = difficulty(s);
    const x1 = letterX(s + 1);
    let x = Math.max(letterX(s) + (CHECKPOINTS.includes(s) ? 200 : 50), G.nextFree);
    let tanks = 0;
    while (x < x1 - 50) {
      const kind = weighted(r, [
        ['craterS', 3], ['craterL', 0.6 + 2 * d], ['rockS', 3], ['rockL', d > 0.15 ? 0.6 + 2 * d : 0],
        ['mine', d > 0.35 ? 2.2 * d : 0], ['boulder', d > 0.3 ? 1.2 : 0],
        ['tank', d > 0.5 && tanks < (d > 0.8 ? 2 : 1) ? 1.4 : 0],
        ['craterRock', d > 0.25 ? 1.3 * d : 0],
      ]);
      let used = 0;
      switch (kind) {
        case 'craterS': used = addCrater(x, 12 + Math.floor(r() * 6)); break;
        case 'craterL': used = addCrater(x, 20 + Math.floor(r() * 8)); break;
        case 'rockS': G.obs.push({ type: 'rock', x, big: false }); used = 10; break;
        case 'rockL': G.obs.push({ type: 'rock', x, big: true }); used = 16; break;
        case 'mine': G.obs.push({ type: 'mine', x }); used = 8; break;
        case 'boulder': G.obs.push({ type: 'boulder', x: x + 40, rot: 0 }); used = 54; break;
        case 'tank': G.obs.push({ type: 'tank', x, cd: 50 }); tanks++; used = 20; break;
        case 'craterRock': {
          G.obs.push({ type: 'rock', x, big: false });
          const off = 112 + Math.floor(r() * 24);
          used = off + addCrater(x + off, 12 + Math.floor(r() * 6));
          break;
        }
      }
      const gap = 150 - 50 * d;
      G.nextFree = x + used + gap;
      x += used + gap + r() * 100;
    }
    if (s >= 1 && (s % 2 === 1 || (d > 0.5 && r() < 0.6))) {
      let type;
      if (G.course === 0) type = s < 7 ? 1 : s < 15 ? (r() < 0.55 ? 1 : 2) : weighted(r, [[1, 1], [2, 1.2], [3, 1.2]]);
      else type = 1 + Math.floor(r() * 3);
      G.triggers.push({ x: letterX(s) + SEG * (0.15 + r() * 0.3), type, n: 3 + (d > 0.5 ? 1 : 0) + (d > 0.85 ? 1 : 0), used: false });
    }
  }

  function ensureGenerated() {
    while (G.genSeg <= 24 && letterX(G.genSeg) < G.dist + W + 120) genSegment(G.genSeg++);
  }

  // ---------------------------------------------------------------- geometry
  const wheelBottom = i => GROUND_Y + G.buggy.y + G.buggy.wb[i];
  const bodyTop = () => GROUND_Y + G.buggy.y - 18 + (G.buggy.wb[0] + G.buggy.wb[2]) / 2;
  function buggyBox() {
    const b = G.buggy, t = bodyTop();
    return { x: b.x + 2, y: t + 6, w: 28, h: GROUND_Y + b.y - (t + 6) };
  }
  const OBS_SIZE = { rock: [10, 8], rockBig: [16, 13], mine: [8, 4], tank: [20, 10], boulder: [14, 14] };
  const obsSize = o => OBS_SIZE[o.type === 'rock' && o.big ? 'rockBig' : o.type];
  function obsBox(o) {
    const [w, h] = obsSize(o);
    return { x: o.x - G.dist, y: GROUND_Y - h, w, h };
  }
  const ufoBox = u => ({ x: u.x - u.w / 2, y: u.y - u.h / 2, w: u.w, h: u.h });

  // ---------------------------------------------------------------- effects
  function boom(x, y, ground = false, big = false) {
    G.booms.push({ x, y, t: 0, ground, big });
  }
  function spark(x, y, n, cols, spd, ground = false, grav = 0.06) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.3 + Math.random() * spd;
      G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.4, g: grav, life: 20 + Math.random() * 25, c: pick(Math.random, cols), ground });
    }
  }

  function addScore(n, x, y, ground = false) {
    if (G.demo) return;
    G.score += n;
    if (G.score > G.hi) G.hi = G.score;
    if (G.nextExtra < EXTRA_LIVES.length && G.score >= EXTRA_LIVES[G.nextExtra]) {
      G.nextExtra++; G.lives++; AudioSys.sfx.extra();
    }
    if (x !== undefined) G.texts.push({ x, y, text: String(n), life: 50, ground });
  }

  // ---------------------------------------------------------------- game flow
  function startGame() {
    AudioSys.init();
    AudioSys.stopMusic();
    G.mode = 'game'; G.demo = false; G.score = 0; G.lives = 3; G.nextExtra = 0; G.course = 0;
    G.hi = scores[0].score;
    resetField(0);
    G.state = 'ready'; G.timer = 150;
    AudioSys.sfx.start();
  }

  function startDemo() {
    G.mode = 'attract'; G.demo = true; G.score = 0; G.lives = 1; G.course = 0;
    resetField(Math.random() < 0.5 ? 0 : 4);
    G.state = 'play';
  }

  function toAttract(state) {
    G.mode = 'attract'; G.demo = false;
    clearField();
    G.state = state; G.timer = state === 'scores' ? 360 : 600;
  }

  function quitToTitle() {
    AudioSys.stopMusic();
    toAttract('title');
  }

  function nextCourse() {
    G.course++;
    AudioSys.stopMusic();
    resetField(0);
    G.state = 'ready'; G.timer = 200;
    AudioSys.sfx.start();
  }

  function reachCheckpoint(n) {
    const secs = Math.floor(G.segFrames / 60);
    const avg = Math.round((n - G.cp) * SEG / (SPEED_BASE * 60) * 1.1);
    const key = G.course + '-' + n;
    if (!G.demo && (records[key] === undefined || secs < records[key])) { records[key] = secs; Store.save('lp_classic_records', records); }
    const bonus = 1000 + Math.max(0, avg - secs) * 100;
    addScore(bonus);
    G.panel = { letter: LETTERS[n], secs, avg, rec: records[key] ?? secs, bonus, t: 0, final: n === 25 };
    G.cp = n; G.segFrames = 0;
    if (n < 25) { G.prevTheme = G.theme; G.theme = themeFor(n); G.themeT = 120; }
    for (const u of G.ufos) u.leaving = true;
    for (const bm of G.bombs) boom(bm.x - 8, bm.y - 8);
    G.bombs = []; G.shells = []; G.wave = null;
    AudioSys.sfx.checkpoint();
  }

  function die(cause) {
    if (G.state !== 'play') return;
    G.lastDeath = cause;
    G.state = 'dying'; G.timer = 170;
    AudioSys.stopMusic(); AudioSys.sfx.bigBoom();
    const b = G.buggy, t = bodyTop();
    boom(b.x + 7, t - 4, false, true);
    boom(b.x + 16, t - 2, false, true);
    spark(b.x + 16, t + 4, 30, BOOM_COLS, 2.2);
    G.debris = WHEEL_DX.map((wx, i) => ({ x: b.x + wx, y: wheelBottom(i) - 8, vx: (i - 1) * 0.8 + (Math.random() - 0.5) * 0.5, vy: -2.4 - Math.random() * 1.5, f: 0 }));
    G.fwd = null; G.ups = [];
    for (const u of G.ufos) u.leaving = true;
    G.wave = null;
  }

  // ---------------------------------------------------------------- input / autopilot
  function readInput() {
    const h = Input.held, k = Input.hit;
    let fire = !!k.fire;
    if (h.fire) { if (++G.fireHold > 14) { G.fireHold = 0; fire = true; } } else G.fireHold = 0;
    return { left: !!h.left, right: !!h.right, jump: !!k.jump, fire };
  }

  function autopilot() {
    const b = G.buggy, inp = { left: false, right: false, jump: false, fire: false };
    const front = G.dist + b.x + WHEEL_DX[2] + 6;
    for (const c of G.craters) { const d = c.x - front; if (d > -1 && d < 4) inp.jump = true; }
    for (const o of G.obs) {
      const d = obsBox(o).x - (b.x + 31);
      if (o.type === 'mine') { if (d > -1 && d < 4) inp.jump = true; }
      else {
        if (d > 0 && d < 90 && G.frame % 6 === 0) inp.fire = true;
        if (d > 1 && d < (o.big ? 9 : 6)) inp.jump = true;
      }
    }
    for (const s of G.shells) {
      const d = s.x - G.dist - (b.x + 31);
      if (d > 0 && d < 100 && G.frame % 6 === 0) inp.fire = true;
      if (d > 2 && d < 14) inp.jump = true;
    }
    if (G.ufos.length && G.frame % 14 === 0) inp.fire = true;
    for (const bm of G.bombs) {
      const t = (GROUND_Y - bm.y) / Math.max(0.4, bm.vy + 0.5);
      if (bm.x > b.x - 4 && bm.x < b.x + 36 && t < 70) { if (bm.x > b.x + 18) inp.left = true; else inp.right = true; }
    }
    return inp;
  }

  // ---------------------------------------------------------------- update
  function step() {
    if (G.paused) { Input.hit = {}; return; }
    G.frame++;
    if (G.themeT > 0) G.themeT--;
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
    G.dist += 0.7;
    if (G.buggy) updateWheels(G.buggy, 0.7);
    if (--G.timer <= 0) {
      if (G.state === 'title') { G.state = 'points'; G.timer = 480; }
      else if (G.state === 'points') startDemo();
      else { G.state = 'title'; G.timer = 600; }
    }
  }

  function updateReady() {
    updateWheels(G.buggy, 0);
    if (--G.timer <= 0) { G.state = 'play'; AudioSys.startMusic('classic'); }
  }

  // Each wheel rides its own little spring, so the buggy jostles over the surface like the original.
  function updateWheels(b, speed) {
    for (let i = 0; i < 3; i++) {
      const target = b.air ? 1.5 : 0;
      b.wv[i] += (target - b.wb[i]) * 0.3;
      b.wv[i] *= 0.7;
      b.wb[i] += b.wv[i];
      if (!b.air && speed > 0 && Math.random() < 0.02 * speed) b.wv[i] -= 0.6 + Math.random() * 0.5;
    }
    b.spin += speed * 0.25;
  }

  function updatePlay(inp) {
    const b = G.buggy;
    G.segFrames++;
    if (!b.air) {
      if (inp.right) G.speed = Math.min(SPEED_MAX, G.speed + 0.018);
      else if (inp.left) G.speed = Math.max(SPEED_MIN, G.speed - 0.03);
      else G.speed += (SPEED_BASE - G.speed) * 0.015;
    }
    const tx = 36 + (G.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 64;
    b.x += clamp(tx - b.x, -0.35, 0.35);
    G.dist += G.speed;
    ensureGenerated();

    if (inp.jump && !b.air) {
      b.air = true; b.vy = -JUMP_V; AudioSys.sfx.jump();
      for (let i = 0; i < 3; i++) b.wv[i] += 0.6;
    }
    if (b.air) {
      b.vy += GRAV; b.y += b.vy;
      if (b.y >= 0) {
        b.y = 0; b.vy = 0; b.air = false; AudioSys.sfx.land();
        for (let i = 0; i < 3; i++) b.wv[i] += 1.1;
      }
    }
    updateWheels(b, G.speed);
    if (inp.fire) fire();

    updateShots();
    updateObstacles();
    updateShells();
    updateWaves();
    updateUfos();
    updateBombs();
    updateEffects();
    collide();
    if (G.state !== 'play') return;
    checkPasses();
    if (G.panel && ++G.panel.t > 300) G.panel = null;

    const cur = currentLetter();
    if (cur > G.cp && CHECKPOINTS.includes(cur)) reachCheckpoint(cur);
    if (G.cp === 25 && G.panel && G.panel.t > 260) { G.panel = null; nextCourse(); return; }
    if (G.demo && worldBuggy() > letterX(G.cp + 5) + 100) toAttract('scores');
    cleanup();
  }

  function fire() {
    const b = G.buggy, t = bodyTop();
    let shot = false;
    if (!G.fwd) { G.fwd = { x: b.x + 31, y: t + 10, x0: b.x + 31 }; shot = true; }
    if (G.ups.length < 3) { G.ups.push({ x: b.x + 2, y: t - 4 }); shot = true; }
    if (shot) AudioSys.sfx.fire();
  }

  function updateShots() {
    const f = G.fwd;
    if (f) {
      f.x += 4.2;
      if (f.x - f.x0 > 118 || f.x > W) { G.fwd = null; spark(f.x, f.y, 3, ['#ffd23f', '#ff8a1f'], 0.6); }
    }
    for (const u of G.ups) u.y -= 4;
    G.ups = G.ups.filter(u => u.y > HUD_H);
  }

  function updateObstacles() {
    const bx = G.buggy.x;
    for (const o of G.obs) {
      const sx = o.x - G.dist;
      if (o.type === 'boulder' && sx < ENGAGE) { o.x -= 0.45; o.rot = (o.rot || 0) + 0.12; }
      if (o.type === 'tank' && sx < ENGAGE && sx > bx + 36) {
        if (--o.cd <= 0) {
          G.shells.push({ x: o.x - 4, y: GROUND_Y - 8 });
          o.cd = 100 + Math.floor(Math.random() * 60);
          AudioSys.sfx.tank();
        }
      }
    }
  }

  function updateShells() {
    for (const s of G.shells) s.x -= 1.5;
    G.shells = G.shells.filter(s => s.x - G.dist > -10);
  }

  function updateWaves() {
    const ahead = G.dist + W * 0.5;
    for (const t of G.triggers) {
      if (!t.used && t.x < ahead && !G.wave && !G.ufos.length) {
        t.used = true;
        G.wave = { type: t.type, left: t.n, cd: 0 };
        AudioSys.sfx.alarm();
      }
    }
    const w = G.wave;
    if (!w) return;
    if (--w.cd <= 0) {
      spawnUfo(w.type, w.left);
      w.left--; w.cd = 40;
      if (w.left <= 0) G.wave = null;
    }
  }

  function spawnUfo(type, i) {
    const [w, h] = type === 3 ? [12, 7] : type === 2 ? [16, 9] : [16, 7];
    G.ufos.push({
      type, w, h, x: -10 - i * 6, y: HUD_H + 14 + (i % 3) * 10, vx: 1.6, vy: 0.2,
      tx: 60 + Math.random() * (ENGAGE - 80), ty: HUD_H + 14 + Math.random() * 46,
      cd: 60 + Math.floor(Math.random() * 60), life: 1000 + Math.floor(Math.random() * 200), leaving: false, f: Math.random() * 40,
    });
  }

  function updateUfos() {
    const b = G.buggy;
    for (const u of G.ufos) {
      u.f++;
      if (u.leaving || --u.life <= 0) { u.leaving = true; u.vy -= 0.06; u.vx *= 0.98; }
      else {
        // Jerky arcade movement: pick a new point near the buggy, dart to it, repeat.
        if (Math.hypot(u.tx - u.x, u.ty - u.y) < 4 || u.f % 90 === 0) {
          const spread = u.type === 3 ? 60 : 110;
          u.tx = clamp(b.x + 16 + (Math.random() - 0.4) * spread * 2, 14, Math.min(W, ENGAGE + 20) - 14);
          u.ty = u.type === 3 ? HUD_H + 30 + Math.random() * 70 : HUD_H + 12 + Math.random() * 50;
        }
        const sp = u.type === 3 ? 2.1 : u.type === 2 ? 1.1 : 1.4;
        u.vx += clamp(u.tx - u.x, -sp, sp) * 0.06; u.vy += clamp(u.ty - u.y, -sp, sp) * 0.06;
        u.vx *= 0.9; u.vy *= 0.9;
        if (--u.cd <= 0 && G.state === 'play' && u.y < GROUND_Y - 50) {
          G.bombs.push({ x: u.x, y: u.y + u.h / 2, vx: u.vx * 0.3, vy: 0.4, crater: u.type === 2 });
          u.cd = (u.type === 3 ? 55 : 80) + Math.floor(Math.random() * 70);
          AudioSys.sfx.bomb();
        }
      }
      u.x += u.vx; u.y += u.vy;
    }
    G.ufos = G.ufos.filter(u => u.y > HUD_H - 20 && u.x > -40 && u.x < W + 40);
  }

  function updateBombs() {
    for (const bm of G.bombs) {
      bm.vy = Math.min(1.6, bm.vy + 0.02); bm.y += bm.vy; bm.x += bm.vx;
      if (bm.y >= GROUND_Y - 2) {
        bm.dead = true;
        boom(bm.x - 8.5, GROUND_Y - 14, true);
        AudioSys.sfx.boom();
        if (bm.crater) addBombCrater(G.dist + bm.x);
      }
    }
    G.bombs = G.bombs.filter(bm => !bm.dead);
  }

  function addBombCrater(wx) {
    const w = 11, x = Math.round(wx - w / 2);
    if (G.craters.some(c => x < c.x + c.w + 4 && x + w + 4 > c.x)) return;
    if (G.obs.some(o => x < o.x + 20 && x + w > o.x - 4)) return;
    G.craters.push({ x, w, depth: 8, passed: false, fresh: 30 });
  }

  function updateEffects(scroll = G.speed) {
    for (const p of G.parts) { p.vy += p.g; p.x += p.vx - (p.ground ? scroll : 0); p.y += p.vy; p.life--; }
    G.parts = G.parts.filter(p => p.life > 0 && p.y < H);
    for (const bm of G.booms) { bm.t++; if (bm.ground) bm.x -= scroll; }
    G.booms = G.booms.filter(bm => bm.t < 24);
    for (const t of G.texts) { t.life--; t.y -= 0.25; if (t.ground) t.x -= scroll; }
    G.texts = G.texts.filter(t => t.life > 0);
    for (const c of G.craters) if (c.fresh) c.fresh--;
  }

  function hitObstacle(o) {
    const box = obsBox(o), cx = box.x + box.w / 2 - 9, cy = box.y + box.h / 2 - 9;
    if (o.type === 'rock' && o.big) { o.big = false; boom(cx, cy + 2, true); spark(cx + 9, cy + 9, 8, ROCK_PAL, 1.2, true); addScore(50, cx + 9, cy, true); AudioSys.sfx.hit(); return; }
    o.dead = true;
    boom(cx, cy, true); spark(cx + 9, cy + 9, 10, o.type === 'tank' ? ['#5f9e2f', '#a8dd6b', '#ffd23f'] : ROCK_PAL, 1.3, true);
    addScore(o.type === 'tank' ? 200 : 100, cx + 9, cy, true);
    AudioSys.sfx.boom();
  }

  function killUfo(u) {
    u.dead = true;
    boom(u.x - 9, u.y - 9);
    spark(u.x, u.y, 12, BOOM_COLS, 1.4, false, 0.04);
    addScore({ 1: 100, 2: 200, 3: 300 }[u.type], u.x, u.y);
    AudioSys.sfx.ufoKill();
  }

  function collide() {
    const b = G.buggy, bb = buggyBox();
    // Forward shot vs ground targets and shells.
    if (G.fwd) {
      const fb = { x: G.fwd.x, y: G.fwd.y, w: 6, h: 2 };
      for (const o of G.obs) {
        if (o.dead || o.type === 'mine') continue;
        if (overlap(fb, obsBox(o))) { hitObstacle(o); G.fwd = null; break; }
      }
      if (G.fwd) for (const s of G.shells) {
        if (overlap(fb, { x: s.x - G.dist, y: s.y, w: 4, h: 2 })) { s.dead = true; G.fwd = null; boom(s.x - G.dist - 7, s.y - 8, true); addScore(50, s.x - G.dist, s.y - 4, true); AudioSys.sfx.hit(); break; }
      }
    }
    // Upward shots vs saucers and bombs.
    for (const sh of G.ups) {
      const sb = { x: sh.x, y: sh.y, w: 3, h: 5 };
      for (const u of G.ufos) if (!u.dead && !u.leaving && overlap(sb, ufoBox(u))) { killUfo(u); sh.dead = true; break; }
      if (sh.dead) continue;
      for (const bm of G.bombs) if (!bm.dead && overlap(sb, { x: bm.x - 2, y: bm.y - 2, w: 5, h: 6 })) { bm.dead = true; sh.dead = true; boom(bm.x - 9, bm.y - 9); addScore(50, bm.x, bm.y); AudioSys.sfx.hit(); break; }
    }
    G.ups = G.ups.filter(s => !s.dead);
    G.ufos = G.ufos.filter(u => !u.dead);
    G.bombs = G.bombs.filter(bm => !bm.dead);
    G.shells = G.shells.filter(s => !s.dead);
    G.obs = G.obs.filter(o => !o.dead);

    // A wheel that rolls over a crater drops in.
    if (!b.air) {
      for (const c of G.craters) {
        for (let i = 0; i < 3; i++) {
          const wx = G.dist + b.x + WHEEL_DX[i] + 4;
          if (wx > c.x + 2.5 && wx < c.x + c.w - 2.5) { die('crater'); return; }
        }
      }
    }
    for (const o of G.obs) if (overlap(bb, obsBox(o))) { die(o.type); return; }
    for (const s of G.shells) if (overlap(bb, { x: s.x - G.dist, y: s.y, w: 4, h: 2 })) { die('shell'); return; }
    for (const bm of G.bombs) if (overlap(bb, { x: bm.x - 1, y: bm.y, w: 3, h: 4 })) { die('bomb'); return; }
  }

  function checkPasses() {
    const rear = G.dist + G.buggy.x;
    for (const c of G.craters) if (!c.passed && c.x + c.w < rear) { c.passed = true; addScore(50, c.x + c.w / 2 - G.dist, GROUND_Y - 30, true); }
    for (const o of G.obs) {
      if (o.passed || o.type === 'tank') continue;
      const [w] = obsSize(o);
      if (o.x + w < rear) { o.passed = true; addScore(o.type === 'mine' ? 100 : 80, o.x + w / 2 - G.dist, GROUND_Y - 30, true); }
    }
  }

  function cleanup() {
    const cut = G.dist - 40;
    G.craters = G.craters.filter(c => c.x + c.w > cut);
    G.obs = G.obs.filter(o => o.x + 24 > cut);
  }

  function updateDying() {
    for (const d of G.debris) {
      d.vy += 0.12; d.x += d.vx; d.y += d.vy; d.f += d.vx * 0.5;
      if (d.y > GROUND_Y - 8) { d.y = GROUND_Y - 8; d.vy *= -0.45; d.vx *= 0.7; if (Math.abs(d.vy) < 0.4) d.vy = 0; }
    }
    if (G.timer > 120 && G.timer % 10 === 0) boom(G.buggy.x + Math.random() * 24 - 4, bodyTop() - 6 + Math.random() * 6, false, true);
    updateUfos(); updateBombs(); updateShells(); updateEffects(0);
    if (--G.timer <= 0) {
      if (G.demo) { toAttract('scores'); return; }
      G.lives--;
      if (G.lives <= 0) { G.state = 'gameover'; G.timer = 220; AudioSys.sfx.gameover(); }
      else { resetField(G.cp); G.state = 'ready'; G.timer = 130; }
    }
  }

  function updateGameOver() {
    updateEffects(0);
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
    Store.save('lp_classic_scores', scores);
    G.hi = Math.max(G.hi, scores[0].score);
  }

  // ---------------------------------------------------------------- pixel renderer
  // Logical coordinates are snapped to whole device pixels, so sprites keep hard edges at any scale.
  const DX = x => Math.round(x * SX), DY = y => Math.round(y * SY);
  function rect(x, y, w, h, col) {
    const X = DX(x), Y = DY(y);
    ctx.fillStyle = col; ctx.fillRect(X, Y, Math.max(1, DX(x + w) - X), Math.max(1, DY(y + h) - Y));
  }
  function blit(img, x, y, alpha = 1) {
    const X = DX(x), Y = DY(y);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(img, X, Y, DX(x + img.width) - X, DY(y + img.height) - Y);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }
  function text(str, x, y, col, align = 'left', size = 8, outline = y > HUD_H) {
    ctx.font = `${Math.round(size * SY)}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    if (outline) {
      const o = Math.max(1, Math.round(SY));
      ctx.fillStyle = '#000000';
      for (const [ox, oy] of [[-o, 0], [o, 0], [0, -o], [0, o], [o, o]]) ctx.fillText(str, DX(x) + ox, DY(y) + oy);
    }
    ctx.fillStyle = col;
    ctx.fillText(str, DX(x), DY(y));
  }
  function strip(img, scroll, y, alpha = 1) {
    const w = img.width;
    const off = -(((scroll % w) + w) % w);
    for (let x = off; x < W; x += w) blit(img, x, y, alpha);
  }

  function drawSky() {
    rect(0, 0, W, H, '#000000');
    for (const s of BG.stars) {
      const x = ((s.x - G.dist * 0.04) % 1024 + 1024) % 1024;
      if (x > W) continue;
      if (((G.frame + s.tw) >> 5) % 6 === 0) continue;
      rect(x, s.y, 1, 1, s.c);
    }
  }

  function drawBackdrop() {
    strip(BG.mountains, G.dist * 0.08, GROUND_Y - 30 - MOUNT_H);
    rect(0, GROUND_Y - 30, W, 30, '#123a7a');
    const midY = GROUND_Y - MID_H;
    const layer = th => th ? BG.city : BG.hills;
    if (G.themeT > 0) {
      const k = G.themeT / 120;
      strip(layer(G.prevTheme), G.dist * 0.3, midY, k);
      strip(layer(G.theme), G.dist * 0.3, midY, 1 - k);
    } else strip(layer(G.theme), G.dist * 0.3, midY);
    strip(BG.ground, G.dist, GROUND_Y);
  }

  function drawCraters() {
    for (const c of G.craters) {
      const sx = c.x - G.dist;
      if (sx > W || sx + c.w < 0) continue;
      for (let i = 0; i < c.w; i++) {
        const t = (i + 0.5) / c.w;
        const d = Math.max(2, Math.round(c.depth * Math.pow(Math.sin(Math.PI * t), 0.55)));
        rect(sx + i, GROUND_Y, 1, d, '#000000');
        rect(sx + i, GROUND_Y + d, 1, 1, '#5e2f10');
        if (t > 0.55) rect(sx + i, GROUND_Y + d - 1, 1, 1, '#2a1406');
      }
      rect(sx - 1, GROUND_Y - 1, 2, 1, '#ffd29a');
      rect(sx + c.w - 1, GROUND_Y - 1, 2, 1, '#8a4a1c');
      if (c.fresh) for (let i = 0; i < 4; i++) rect(sx + Math.random() * c.w, GROUND_Y - 2 - Math.random() * 4, 1, 1, '#e8a45a');
    }
  }

  function drawSigns() {
    for (let i = 0; i < 26; i++) {
      const sx = letterX(i) - G.dist;
      if (sx < -12 || sx > W + 2) continue;
      const cp = CHECKPOINTS.includes(i);
      rect(sx + 4, GROUND_Y - 22, 1, 22, '#d6dde6');
      rect(sx, GROUND_Y - 31, 10, 10, cp ? '#ff3b30' : '#ffd23f');
      rect(sx + 1, GROUND_Y - 30, 8, 8, cp ? '#ffd23f' : '#1d2026');
      text(LETTERS[i], sx + 1, GROUND_Y - 30, cp ? '#1d2026' : '#ffd23f', 'left', 8);
    }
  }

  function drawObstacles() {
    for (const o of G.obs) {
      const box = obsBox(o);
      if (box.x > W + 4 || box.x + box.w < -4) continue;
      if (o.type === 'rock') blit(o.big ? ROCK_L : ROCK_S, box.x, box.y);
      else if (o.type === 'mine') blit(MINE[(G.frame >> 4) & 1], box.x, box.y);
      else if (o.type === 'tank') blit(TANK, box.x, box.y);
      else if (o.type === 'boulder') blit(BOULDER[Math.floor((o.rot || 0) * 2) & 3 ^ 3], box.x, box.y);
    }
    for (const s of G.shells) blit(SHELL, s.x - G.dist, s.y);
  }

  function drawBuggyAt(bx, top, wb, spin) {
    const wf = Math.floor(spin) & 1;
    for (let i = 0; i < 3; i++) {
      const wy = top + 18 + wb[i] - 8;
      rect(bx + WHEEL_DX[i] + 3.5, top + 10, 1, wy - top - 9, '#7b8592');
      blit(WHEELS[wf], bx + WHEEL_DX[i], wy);
    }
    blit(BUGGY, bx, top);
  }

  function drawBuggy() {
    const b = G.buggy;
    drawBuggyAt(b.x, bodyTop(), b.wb.map(v => v - (b.wb[0] + b.wb[2]) / 2), b.spin);
  }

  function drawAir() {
    for (const u of G.ufos) {
      const img = (u.type === 1 ? UFO1 : u.type === 2 ? UFO2 : UFO3)[(u.f >> 3) & 1];
      blit(img, u.x - img.width / 2, u.y - img.height / 2);
    }
    for (const bm of G.bombs) blit(BOMB[(G.frame >> 2) & 1], bm.x - 1.5, bm.y);
    for (const s of G.ups) blit(UP_SHOT, s.x, s.y);
    if (G.fwd) blit(FWD_SHOT, G.fwd.x, G.fwd.y);
  }

  function drawEffects() {
    for (const bm of G.booms) {
      const f = Math.min(3, bm.t >> 2);
      if (bm.big) blit(BOOM[f], bm.x - 4, bm.y - 4);
      blit(BOOM[f], bm.x, bm.y, bm.t > 18 ? 0.5 : 1);
    }
    for (const p of G.parts) rect(p.x, p.y, 1, 1, p.c);
    for (const t of G.texts) if ((t.life >> 2) & 1 || t.life > 30) text(t.text, t.x, t.y, '#ffffff', 'center', 6);
  }

  function drawDebris() {
    for (const d of G.debris) blit(WHEELS[Math.floor(d.f) & 1], d.x, d.y);
  }

  function lamp(x, y, on, col) {
    rect(x, y, 8, 8, '#2a2e36');
    rect(x + 1, y + 1, 6, 6, on ? col : '#0e1014');
    if (on) rect(x + 2, y + 2, 2, 2, '#ffffff');
  }

  function drawHUD(field) {
    rect(0, 0, W, HUD_H, '#000000');
    rect(0, HUD_H - 1, W, 1, '#1f57b0');
    const L = Math.max(4, Math.floor((W - 256) / 2) + 4), R = W - L;
    text('1UP', L + 4, 3, '#ff3b30');
    text(pad(G.score), L + 36, 3, '#ffffff');
    text('HI', R - 76, 3, '#ff3b30');
    text(pad(G.hi), R - 4, 3, '#ffffff', 'right');

    const cur = field ? currentLetter() : 0;
    text('POINT', L + 4, 13, '#7ff0ff');
    text(LETTERS[cur], L + 50, 13, '#ffd23f');
    text('TIME', R - 76, 13, '#7ff0ff');
    text(String(Math.floor(G.segFrames / 60)).padStart(3, '0'), R - 4, 13, '#ffffff', 'right');

    const blink = (G.frame >> 3) & 1;
    const ahead = G.dist + (G.buggy ? G.buggy.x : 0);
    const air = field && (G.wave || G.ufos.length > 0);
    const gnd = field && (G.shells.length > 0 || G.obs.some(o => (o.type === 'tank' || o.type === 'boulder') && o.x > ahead && o.x - ahead < 300));
    const mines = field && G.obs.some(o => o.type === 'mine' && o.x > ahead && o.x - ahead < 300);
    lamp(L + 68, 13, air && blink, '#ff3b30');
    lamp(L + 78, 13, gnd && blink, '#ffd23f');
    lamp(L + 88, 13, mines && blink, '#3ee87a');

    // Course progress bar with the checkpoint letters.
    const x0 = L + 4, x1 = R - 4, bw = x1 - x0, y = 32;
    rect(x0, y, bw, 3, '#123a7a');
    const p = field ? clamp((worldBuggy() - letterX(0)) / (25 * SEG), 0, 1) : 0;
    if (p > 0) rect(x0, y, bw * p, 3, '#7ff0ff');
    for (const i of CHECKPOINTS) {
      const x = x0 + bw * i / 25;
      rect(x - 0.5, y - 2, 1, 7, '#ffd23f');
      if (i) text(LETTERS[i], Math.min(x1 - 6, x - 3), y - 9, i <= G.cp && field ? '#ffd23f' : '#8a7426', 'left', 6);
    }
    blit(MINI_BUGGY, x0 + bw * p - 8, y - 5);
  }

  function drawGroundHUD() {
    for (let i = 0; i < Math.min(G.lives - 1, 6); i++) blit(MINI_BUGGY, 6 + i * 18, H - 9);
    text(G.course === 0 ? 'BEGINNER' : 'CHAMPION', W - 4, H - 9, '#ffd29a', 'right', 6);
  }

  function centerBox(y, h, w = 208) {
    const x = Math.round(W / 2 - w / 2);
    rect(x, y, w, h, '#1f57b0');
    rect(x + 1, y + 1, w - 2, h - 2, '#000000');
  }

  function drawPanel(p) {
    const cx = W / 2, y = HUD_H + 8;
    if (p.t > 240 && (p.t >> 2) & 1) return;
    centerBox(y, 60, 224);
    text(p.final ? 'CONGRATULATIONS!' : `TIME TO REACH POINT "${p.letter}"`, cx, y + 5, '#ffd23f', 'center');
    const row = (label, val, yy, col) => { text(label, cx - 100, yy, col); text(String(val), cx + 100, yy, '#ffffff', 'right'); };
    row('YOUR TIME', p.secs, y + 17, '#7ff0ff');
    row('THE AVERAGE TIME', p.avg, y + 27, '#7ff0ff');
    row('TOP RECORD', p.rec, y + 37, '#7ff0ff');
    row(p.secs <= p.avg ? 'GOOD BONUS POINTS' : 'BONUS POINTS', p.bonus, y + 48, '#ff3b30');
  }

  function drawOverlays() {
    const cx = W / 2, blink = (G.frame >> 4) & 1;
    if (G.state === 'ready') {
      centerBox(HUD_H + 26, 36, 176);
      text(G.course === 0 ? 'BEGINNER COURSE' : 'CHAMPION COURSE', cx, HUD_H + 31, '#7ff0ff', 'center');
      text(`POINT "${LETTERS[G.cp]}"`, cx, HUD_H + 42, '#ffd23f', 'center');
      if (blink) text('GET READY', cx, HUD_H + 52, '#ffffff', 'center', 6);
    }
    if (G.panel) drawPanel(G.panel);
    if (G.state === 'gameover') {
      centerBox(HUD_H + 40, 22, 112);
      text('GAME OVER', cx, HUD_H + 47, '#ff3b30', 'center');
    }
    if (G.demo) {
      text('DEMONSTRATION', cx, HUD_H + 4, '#7ff0ff', 'center');
      if (blink) text('PUSH START BUTTON', cx, HUD_H + 16, '#ffd23f', 'center', 6);
    }
  }

  // Title logo: chunky two-tone letters with a hard drop shadow, in the spirit of 1980s cabinets.
  function logo(str, y, size) {
    ctx.font = `${Math.round(size * SY)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const X = DX(W / 2), Y = DY(y), o = Math.max(2, Math.round(SY * 2));
    ctx.fillStyle = '#8c1d12'; ctx.fillText(str, X + o, Y + o);
    const g = ctx.createLinearGradient(0, Y, 0, Y + size * SY);
    g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(0.51, '#ff8a1f'); g.addColorStop(1, '#ff3b30');
    ctx.fillStyle = g; ctx.fillText(str, X, Y);
  }

  function drawTitle() {
    const cx = W / 2;
    logo('LUNAR', HUD_H + 8, 24);
    logo('PATROL', HUD_H + 36, 24);
    if ((G.frame >> 5) & 1) text('PUSH START BUTTON', cx, HUD_H + 68, '#ffffff', 'center', 8, true);
    text('1 PLAYER  3 BUGGIES', cx, HUD_H + 82, '#7ff0ff', 'center', 6, true);
    text('CLASSIC MODE', cx, HUD_H + 94, '#ffd23f', 'center', 6, true);
    const t = GROUND_Y - 18;
    drawBuggyAt(cx - 16, t, G.buggy ? G.buggy.wb : [0, 0, 0], G.dist / 4);
  }

  function drawPoints() {
    const cx = W / 2;
    text('SCORE ADVANCE TABLE', cx, HUD_H + 4, '#ffd23f', 'center');
    const items = [
      [UFO1[(G.frame >> 3) & 1], '100 PTS'], [UFO2[(G.frame >> 3) & 1], '200 PTS'], [UFO3[(G.frame >> 3) & 1], '300 PTS'],
      [TANK, '200 PTS'], [BOULDER[(G.frame >> 3) & 3], '100 PTS'], [ROCK_L, '50+100 PTS'], [MINE[(G.frame >> 4) & 1], 'JUMP 100'],
    ];
    items.forEach(([img, label], i) => {
      const y = HUD_H + 18 + i * 15;
      blit(img, cx - 54 - img.width / 2, y + 4 - img.height / 2);
      text('= ' + label, cx - 30, y, '#ffffff', 'left');
    });
  }

  function drawScores() {
    const cx = W / 2;
    text('BEST PATROLS', cx, HUD_H + 8, '#ffd23f', 'center');
    scores.forEach((s, i) => {
      const y = HUD_H + 28 + i * 14, col = i === 0 ? '#ffd23f' : '#ffffff';
      text(['1ST', '2ND', '3RD', '4TH', '5TH'][i], cx - 80, y, '#7ff0ff');
      text(s.name, cx - 24, y, col);
      text(pad(s.score), cx + 80, y, col, 'right');
    });
    if ((G.frame >> 5) & 1) text('PUSH START BUTTON', cx, HUD_H + 104, '#ffffff', 'center', 6);
  }

  function render() {
    if (!active || !BG.ground) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const field = ['ready', 'play', 'dying', 'gameover'].includes(G.state);
    drawSky();
    drawBackdrop();
    if (field) {
      drawCraters();
      drawSigns();
      drawObstacles();
      if (G.state === 'dying') drawDebris();
      else if (G.state !== 'gameover') drawBuggy();
      drawAir();
      drawGroundHUD();
    }
    drawEffects();
    drawHUD(field);
    if (G.state === 'title') drawTitle();
    else if (G.state === 'points') drawPoints();
    else if (G.state === 'scores') drawScores();
    drawOverlays();
    if (G.paused) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, DY(HUD_H), canvas.width, canvas.height); }
  }

  // Backing-store size in device pixels; 'fill' widens the logical view to the window's shape.
  function resize(cw, ch, view) {
    canvas.width = cw; canvas.height = ch;
    W = view === 'arcade' ? 256 : clamp(Math.round(224 * cw / ch), 256, 460);
    SX = cw / W; SY = ch / H;
    render();
  }

  // ---------------------------------------------------------------- loop
  let last = 0, acc = 0;
  const DT = 1000 / 60;
  function loop(t) {
    requestAnimationFrame(loop);
    if (!active) { last = 0; return; }
    if (!last) last = t;
    acc += Math.min(100, t - last);
    last = t;
    while (acc >= DT) { step(); acc -= DT; }
    render();
  }

  buildLayers();
  clearField();
  requestAnimationFrame(loop);
  if (document.fonts) document.fonts.load(`8px "Press Start 2P"`).then(render, () => {});

  const api = {
    press, release, releaseAll, startGame, quitToTitle, qualifies, saveScore, resize,
    getScores: () => scores.slice(),
    setPaused(p) { G.paused = p; AudioSys.setPaused(p); if (p) releaseAll(); },
    isPaused: () => G.paused,
    inGame: () => G.mode === 'game' && G.state !== 'gameover',
    setActive(a) { active = a; if (!a) { releaseAll(); G.paused = false; } },
    onGameOver: null,
    // Test hooks: inspect state / advance the simulation n frames synchronously.
    _state: () => G,
    _tick(n = 1, auto = false) {
      for (let i = 0; i < n; i++) {
        if (auto && G.state === 'play') { G.frame++; if (G.themeT > 0) G.themeT--; updatePlay(autopilot()); } else step();
      }
      render();
      return { death: G.lastDeath, state: G.state, letter: LETTERS[currentLetter()], score: G.score, lives: G.lives, cp: LETTERS[G.cp], course: G.course };
    },
  };
  return api;
})();
