'use strict';
/* Lunar Patrol — game core: simulation, level generation and high-resolution vector rendering. */
const Game = (() => {
  const H = 224, HUD_H = 40, GROUND_Y = 178;
  let W = 256;                           // logical view width; widens to fill wide screens
  const SEG = 560, LEAD = 380;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const CHECKPOINTS = [0, 4, 9, 14, 19, 25];
  const JUMP_V = 3.1, GRAV = 0.115;
  const SPEED_MIN = 0.8, SPEED_MAX = 2.4, SPEED_BASE = 1.4;
  const EXTRA_LIVES = [10000, 30000, 50000];
  const WHEEL_X = [0, 13, 26];           // wheel left edges relative to the buggy; centres at +5
  const BODY_W = 36;
  const UFO_POINTS = { 1: 100, 2: 200, 3: 300 };
  const MH = 104, MOUNT_Y = GROUND_Y - 16 - MH;
  const HH = 64, HILL_Y = GROUND_Y - HH + 3;
  const GH = H - GROUND_Y + 6;
  const FIRE = ['#fff6d5', '#ffd166', '#ff9f1c', '#ff5a36', '#c81d25'];
  const DUST = ['#e8a660', '#c9783e', '#8a4520', '#f0c090'];
  const TAU = Math.PI * 2;
  const ENGAGE = 248;                    // hazards activate at arcade-screen distance regardless of view width
  const letterX = i => LEAD + i * SEG;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  let SX = 4, SY = 4;                    // device pixels per logical unit

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
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad = n => String(n).padStart(6, '0');

  // Rolling lunar surface: y of the ground top at world x.
  const surfaceAt = wx => GROUND_Y + 1.5 * Math.sin(wx * 0.029) + 1.1 * Math.sin(wx * 0.071 + 1.3) + 0.5 * Math.sin(wx * 0.19 + 0.4);
  const pebble = wx => (hash(Math.floor(wx / 7)) % 9 === 0 ? -1 : 0);

  const Store = {
    load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const DEFAULT_SCORES = [
    { name: 'ACE', score: 30000 }, { name: 'RVR', score: 20000 }, { name: 'LUN', score: 15000 },
    { name: 'MPT', score: 10000 }, { name: 'CRT', score: 5000 },
  ];

  // ---------------------------------------------------------------- background layers
  // Layers are painted once at the current screen resolution and cached as tiles.
  const BG = { stars: [], mountains: null, hills: null, city: null, ground: null, groundPat: null, L: 0 };

  function paintLayer(w, h, L, fn) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * L); c.height = Math.round(h * L);
    const x = c.getContext('2d');
    x.scale(L, L);
    fn(x, w, h);
    return c;
  }

  // Periodic midpoint-displacement ridge line (wraps seamlessly at n).
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

  function paintRange(x, w, h, prof, cols) {
    const n = prof.length, px = i => i * w / n, top = i => h - clamp(prof[i % n], 8, h - 2);
    x.beginPath(); x.moveTo(0, h);
    for (let i = 0; i <= n; i++) x.lineTo(px(i), top(i));
    x.lineTo(w, h); x.closePath();
    const g = x.createLinearGradient(0, h - cols.span, 0, h);
    cols.grad.forEach(([o, c]) => g.addColorStop(o, c));
    x.fillStyle = g; x.fill();
    // Sun-lit (rising) faces and shadowed (falling) faces.
    for (let i = 0; i < n; i++) {
      const d = prof[(i + 1) % n] - prof[i];
      const depth = d > 0 ? 5 + d * cols.litDepth : 8 + -d * 10;
      x.fillStyle = d > 0 ? cols.lit : cols.shade;
      x.beginPath();
      x.moveTo(px(i), top(i)); x.lineTo(px(i + 1), top(i + 1));
      x.lineTo(px(i + 1), top(i + 1) + depth); x.lineTo(px(i), top(i) + depth);
      x.closePath(); x.fill();
    }
    x.lineWidth = 0.45;
    for (let i = 0; i < n; i += 4) {
      if (hash(i * 97 + cols.seed) % 6) continue;
      const len = 5 + hash(i + cols.seed) % 18;
      x.strokeStyle = cols.streak;
      x.beginPath(); x.moveTo(px(i), top(i) + 1); x.lineTo(px(i) + (hash(i) % 3 - 1) * 0.8, top(i) + len); x.stroke();
    }
    x.strokeStyle = cols.ridge; x.lineWidth = 0.5;
    x.beginPath();
    for (let i = 0; i <= n; i++) i ? x.lineTo(px(i), top(i)) : x.moveTo(px(i), top(i));
    x.stroke();
  }

  function paintMountains(x, w, h) {
    paintRange(x, w, h, ridge(21, 1024, 70, 70, 0.56), {
      span: 100, seed: 3, litDepth: 16,
      grad: [[0, '#e3f0fd'], [0.28, '#98c2f0'], [0.6, '#5387cf'], [1, '#2b5494']],
      lit: 'rgba(240,248,255,0.2)', shade: 'rgba(16,40,92,0.16)', streak: 'rgba(225,238,255,0.22)', ridge: 'rgba(246,251,255,0.8)',
    });
    paintRange(x, w, h, ridge(58, 1024, 40, 34, 0.5), {
      span: 60, seed: 9, litDepth: 10,
      grad: [[0, '#7fa9e0'], [0.4, '#3d6db3'], [1, '#1c3a6e']],
      lit: 'rgba(190,220,255,0.16)', shade: 'rgba(10,28,70,0.2)', streak: 'rgba(170,205,245,0.16)', ridge: 'rgba(170,205,245,0.7)',
    });
    const haze = x.createLinearGradient(0, h - 34, 0, h);
    haze.addColorStop(0, 'rgba(10,24,56,0)'); haze.addColorStop(1, 'rgba(10,24,56,0.6)');
    x.fillStyle = haze; x.fillRect(0, h - 34, w, 34);
  }

  function paintHills(x, w, h) {
    const back = t => 22 + 10 * Math.pow(Math.abs(Math.sin(t * Math.PI / 256 + 1.7)), 1.2) + 6 * Math.abs(Math.sin(t * Math.PI / 64 + 2.2));
    const front = t => 14 + 14 * Math.pow(Math.abs(Math.sin(t * Math.PI / 256 + 0.4)), 1.4)
      + 9 * Math.pow(Math.abs(Math.sin(t * Math.PI / 64 + 0.8)), 0.8)
      + 4 * Math.pow(Math.abs(Math.sin(t * Math.PI / 32 + 2.1)), 0.9)
      + 2 * Math.abs(Math.sin(t * Math.PI / 8 + 0.3));
    const shape = (fn, fill) => {
      x.beginPath(); x.moveTo(0, h);
      for (let t = 0; t <= w; t += 0.5) x.lineTo(t, h - fn(t));
      x.lineTo(w, h); x.closePath();
      x.fillStyle = fill; x.fill();
    };
    const gb = x.createLinearGradient(0, h - 40, 0, h);
    gb.addColorStop(0, '#2c7a4c'); gb.addColorStop(1, '#0f3d24');
    shape(back, gb);
    const gf = x.createLinearGradient(0, h - 44, 0, h);
    gf.addColorStop(0, '#74e07e'); gf.addColorStop(0.25, '#39a855'); gf.addColorStop(0.7, '#1c7236'); gf.addColorStop(1, '#0c4221');
    shape(front, gf);
    const r = mulberry32(88);
    for (let i = 0; i < 260; i++) {
      const t = r() * w, top = h - front(t), y = top + 3 + r() * (h - top);
      x.fillStyle = r() < 0.6 ? 'rgba(8,50,24,0.45)' : 'rgba(150,240,150,0.18)';
      x.beginPath(); x.ellipse(t, y, 0.6 + r() * 1.8, 0.4 + r() * 0.9, 0, 0, TAU); x.fill();
    }
    x.strokeStyle = 'rgba(190,255,180,0.85)'; x.lineWidth = 0.55;
    x.beginPath();
    for (let t = 0; t <= w; t += 0.5) t ? x.lineTo(t, h - front(t)) : x.moveTo(t, h - front(t));
    x.stroke();
  }

  function paintCity(x, w, h) {
    const r = mulberry32(4242);
    const base = h - 8;
    // Back row of distant towers for depth.
    for (let t = 2; t < w - 8; t += 7 + r() * 9) {
      const bh = 10 + r() * 22;
      x.fillStyle = 'rgba(40,58,92,0.9)'; x.fillRect(t, base - bh, 5 + r() * 6, bh);
    }
    let t = 4;
    while (t < w - 12) {
      const kind = r();
      if (kind < 0.3) {
        const rr = 7 + r() * 8, cx = t + rr;
        if (cx + rr > w - 2) break;
        const g = x.createRadialGradient(cx - rr * 0.4, base - rr * 0.8, 1, cx, base, rr * 1.2);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#b9c7d8'); g.addColorStop(1, '#5d6d84');
        x.fillStyle = g;
        x.beginPath(); x.ellipse(cx, base, rr, rr * 0.95, 0, Math.PI, TAU); x.fill();
        x.strokeStyle = 'rgba(80,96,120,0.6)'; x.lineWidth = 0.3;
        for (let k = 1; k < 4; k++) { x.beginPath(); x.ellipse(cx, base, rr * k / 4, rr * 0.95, 0, Math.PI, TAU); x.stroke(); }
        x.fillStyle = '#ffd166';
        for (let dx = -rr + 3; dx < rr - 2; dx += 2.5) x.fillRect(cx + dx, base - 3, 1, 0.8);
        t += rr * 2 + 3;
      } else if (kind < 0.75) {
        const bw = 10 + r() * 14, bh = 14 + r() * 30;
        if (t + bw > w - 2) break;
        const g = x.createLinearGradient(t, 0, t + bw, 0);
        g.addColorStop(0, '#7f98bd'); g.addColorStop(0.2, '#51688c'); g.addColorStop(1, '#2d3d58');
        x.fillStyle = g; x.fillRect(t, base - bh, bw, bh);
        x.fillStyle = '#a9bfdc'; x.fillRect(t, base - bh, bw, 0.7);
        for (let wy = base - bh + 2.5; wy < base - 2; wy += 2.6) {
          for (let wx = t + 2; wx < t + bw - 1.5; wx += 2.4) {
            if (r() < 0.55) { x.fillStyle = r() < 0.8 ? '#ffd679' : '#7fe3ff'; x.fillRect(wx, wy, 1.1, 1.2); }
          }
        }
        t += bw + 1 + r() * 4;
      } else {
        const th = 26 + r() * 22;
        const g = x.createLinearGradient(t, 0, t + 4, 0);
        g.addColorStop(0, '#e8eef5'); g.addColorStop(1, '#7d8ca0');
        x.fillStyle = g; x.fillRect(t + 1, base - th, 2.6, th);
        x.fillStyle = '#c3cfdc'; x.fillRect(t - 1, base - th, 6.6, 2.6);
        x.fillStyle = '#ff5245'; x.beginPath(); x.arc(t + 2.3, base - th - 1.4, 0.9, 0, TAU); x.fill();
        t += 9;
      }
    }
    x.fillStyle = '#9fb0c6';
    for (let tx = 0; tx < w; tx += 37) { x.fillRect(tx, base - 4, 14, 1.6); }
    const g = x.createLinearGradient(0, base, 0, h);
    g.addColorStop(0, '#5a6f8f'); g.addColorStop(1, '#1f2a3d');
    x.fillStyle = g; x.fillRect(0, base, w, 8);
  }

  function paintGround(x, w, h) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#eaa864'); g.addColorStop(0.08, '#c98540'); g.addColorStop(0.4, '#a5602b'); g.addColorStop(1, '#6a3717');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const r = mulberry32(77);
    const wrap = (fn, px) => { fn(px); if (px < 20) fn(px + w); if (px > w - 20) fn(px - w); };
    for (let y = 6; y < h; y += 4 + r() * 3) {
      let sx = r() * 30;
      while (sx < w) {
        const len = 8 + r() * 36, yy = y + r() * 2;
        wrap(p => { x.fillStyle = 'rgba(88,42,14,0.28)'; x.beginPath(); x.ellipse(p + len / 2, yy, len / 2, 0.55, 0, 0, TAU); x.fill(); }, sx);
        wrap(p => { x.fillStyle = 'rgba(255,205,150,0.12)'; x.fillRect(p + 2, yy - 0.9, len * 0.6, 0.35); }, sx);
        sx += len + 10 + r() * 30;
      }
    }
    for (let i = 0; i < 150; i++) {
      const px = r() * w, py = 4 + r() * (h - 4), rx = 0.5 + r() * 1.4, ry = rx * (0.55 + r() * 0.3);
      wrap(p => {
        x.fillStyle = '#6f3918'; x.beginPath(); x.ellipse(p, py, rx, ry, 0, 0, TAU); x.fill();
        x.fillStyle = 'rgba(245,190,125,0.55)'; x.beginPath(); x.ellipse(p - rx * 0.3, py - ry * 0.35, rx * 0.45, ry * 0.4, 0, 0, TAU); x.fill();
      }, px);
    }
    for (let i = 0; i < 1600; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(80,38,12,0.35)' : 'rgba(255,210,160,0.18)';
      x.fillRect(r() * w, 3 + r() * (h - 3), 0.45, 0.45);
    }
  }

  function buildLayers() {
    const L = clamp(Math.ceil(SY), 2, 6);
    if (L === BG.L) return;
    BG.L = L;
    BG.mountains = paintLayer(512, MH, L, paintMountains);
    BG.hills = paintLayer(512, HH, L, paintHills);
    BG.city = paintLayer(512, HH, L, paintCity);
    BG.ground = paintLayer(256, GH, L, paintGround);
    BG.groundPat = ctx.createPattern(BG.ground, 'repeat');
  }

  function buildStars() {
    const r = mulberry32(1234);
    for (let i = 0; i < 130; i++) {
      BG.stars.push({
        x: r() * 1024, y: HUD_H + 2 + r() * 80, s: 0.25 + r() * r() * 0.75,
        c: ['#ffffff', '#cfe6ff', '#ffe9b8', '#ffc9bf'][Math.floor(r() * 4)], tw: r() * TAU, sp: 0.02 + r() * 0.05,
      });
    }
  }

  // ---------------------------------------------------------------- state
  const G = {
    mode: 'attract', state: 'title', timer: 480, frame: 0, paused: false, demo: false, demoFrames: 0,
    score: 0, hi: 0, lives: 3, nextExtra: 0, course: 0, cp: 0,
    dist: 0, speed: SPEED_BASE, segFrames: 0, genSeg: 0, nextFree: 0, fireAuto: 0, flash: 0, readyMsg: null,
    theme: 0, prevTheme: 0, themeT: 0, lastDeath: '',
    buggy: null, craters: [], obs: [], shells: [], triggers: [], ufos: [], bombs: [], upshots: [], fshot: null,
    parts: [], texts: [], debris: [], flashes: [], wave: null, panel: null,
  };
  let scores = Store.load('lp_scores', DEFAULT_SCORES.slice());
  const records = Store.load('lp_records', {});
  G.hi = scores[0].score;

  const Input = { held: {}, hit: {} };
  function press(a) { if (!Input.held[a]) Input.hit[a] = true; Input.held[a] = true; }
  function release(a) { Input.held[a] = false; }
  function releaseAll() { Input.held = {}; }

  const newBuggy = x => ({ x, y: 0, vy: 0, air: false, wy: [0, 0, 0], wv: [0, 0, 0], rot: 0 });
  const themeFor = cp => CHECKPOINTS.indexOf(cp) % 2;

  function clearField() {
    G.buggy = newBuggy(56);
    G.craters = []; G.obs = []; G.shells = []; G.triggers = []; G.ufos = []; G.bombs = [];
    G.upshots = []; G.fshot = null; G.parts = []; G.texts = []; G.debris = []; G.flashes = [];
    G.wave = null; G.panel = null; G.segFrames = 0;
  }

  function resetField(cp) {
    clearField();
    G.cp = cp; G.speed = SPEED_BASE;
    G.dist = letterX(cp) - 20 - G.buggy.x;
    G.genSeg = cp; G.nextFree = 0;
    G.theme = G.prevTheme = themeFor(cp); G.themeT = 0;
    ensureGenerated();
    for (let i = 0; i < 3; i++) G.buggy.wy[i] = surfaceAt(G.dist + G.buggy.x + WHEEL_X[i] + 5) - GROUND_Y;
  }

  function currentLetter() {
    if (!G.buggy) return 0;
    return clamp(Math.floor((G.dist + G.buggy.x + 18 - letterX(0)) / SEG), 0, 25);
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

  const addCrater = (x, w) => { G.craters.push({ x, w, depth: Math.min(13, 6 + Math.floor(w / 4)), passed: false }); return w; };

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
          const off = 104 + Math.floor(r() * 16);
          used = off + addCrater(x + off, 12 + Math.floor(r() * 6));
          break;
        }
        case 'rockCrater': {
          G.obs.push({ type: 'rock', x, big: false });
          const off = 110 + Math.floor(r() * 20);
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
  const wheelBase = i => GROUND_Y + G.buggy.y + G.buggy.wy[i];     // bottom of wheel i
  function bodyY() {
    return (wheelBase(0) + wheelBase(2)) / 2 - 16;
  }
  function buggyBox() {
    const b = G.buggy, by = bodyY();
    const bottom = Math.max(wheelBase(0), wheelBase(1), wheelBase(2));
    return { x: b.x + 2, y: by + 2, w: BODY_W - 4, h: bottom - by - 2 };
  }
  const OBS_SIZE = { rock: [10, 8], rockBig: [16, 13], mine: [9, 5], tank: [20, 10], boulder: [14, 14] };
  function obsSize(o) { return OBS_SIZE[o.type === 'rock' && o.big ? 'rockBig' : o.type]; }
  function obsBox(o) {
    const [w, h] = obsSize(o);
    const gy = surfaceAt(o.x + w / 2) + 1;
    return { x: o.x - G.dist, y: gy - h, w, h };
  }
  const ufoBox = u => ({ x: u.x - u.w / 2, y: u.y - u.h / 2, w: u.w, h: u.h });

  // ---------------------------------------------------------------- effects
  function burst(x, y, n, colors, spd, ground, grav = 0.05, life = 24, floor = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * spd;
      const c = colors[Math.floor(Math.random() * colors.length)];
      G.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.4,
        g: grav, life: life * (0.5 + Math.random() * 0.7), max: life,
        c, ground, floor, glow: FIRE.includes(c), size: 0.5 + Math.random() * 0.9,
      });
    }
    if (n >= 12 && colors.includes(FIRE[1])) G.flashes.push({ x, y, r: 4 + n * 0.35, life: 14, max: 14, ground });
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
    if (n < 25) { G.prevTheme = G.theme; G.theme = themeFor(n); G.themeT = 90; }
    AudioSys.sfx.checkpoint();
  }

  function die(cause = '') {
    if (G.state !== 'play') return;
    G.lastDeath = cause;
    G.state = 'dying'; G.timer = 170; G.flash = 4;
    AudioSys.stopMusic(); AudioSys.sfx.bigBoom();
    const b = G.buggy, by = bodyY(), bx = Math.round(b.x);
    burst(bx + 18, by + 6, 60, FIRE, 2.4, false, 0.04, 55);
    burst(bx + 18, by + 10, 20, DUST, 1.5, false, 0.1, 40, true);
    G.debris = WHEEL_X.map((wx, i) => ({ kind: 'wheel', x: bx + wx, y: by + 6, vx: (i - 1) * 0.9 + (Math.random() - 0.5) * 0.6, vy: -2.2 - Math.random() * 1.8, f: 0 }));
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
    const front = G.dist + b.x + 31;
    for (const c of G.craters) { const d = c.x - front; if (d > -1 && d < 6) inp.jump = true; }
    for (const o of G.obs) {
      const d = obsBox(o).x - (b.x + 34);
      if (o.type === 'mine') { if (d > -2 && d < 5) inp.jump = true; }
      else {
        if (d > 0 && d < 80 && G.frame % 5 === 0) inp.fire = true;
        if (d > -2 && d < 3) inp.jump = true;
      }
    }
    for (const s of G.shells) {
      const d = s.x - G.dist - (b.x + 34);
      if (d > 0 && d < 120) inp.fire = true;
      if (d > 4 && d < 22) inp.jump = true;
    }
    if (G.ufos.length && G.frame % 16 === 0) inp.fire = true;
    const gun = b.x + 12;
    for (const bm of G.bombs) {
      if (Math.abs(bm.x - gun) < 6 && bm.y < GROUND_Y - 40) inp.fire = true;
      // Predict the landing point and steer out of the way.
      const t = (GROUND_Y - bm.y) / Math.max(0.5, bm.vy + 1);
      const land = bm.x + bm.vx * t;
      if (land > b.x - 4 && land < b.x + 38 && t < 50) {
        const wideAhead = G.craters.some(c => c.w > 18 && c.x > G.dist + b.x && c.x - G.dist - b.x < 160);
        if (land > b.x + 17 && !wideAhead) inp.left = true; else inp.right = true;
      }
    }
    return inp;
  }

  // ---------------------------------------------------------------- update
  function step() {
    if (G.paused) { Input.hit = {}; return; }
    G.frame++;
    if (G.flash > 0) G.flash--;
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
      const wx = G.dist + b.x + WHEEL_X[i] + 5;
      const ground = surfaceAt(wx) - GROUND_Y + pebble(wx);
      const target = b.air ? ground + 1.5 : ground;
      b.wv[i] += (target - b.wy[i]) * 0.25;
      b.wv[i] *= 0.72;
      b.wy[i] += b.wv[i];
      if (!b.air && speed > 0 && Math.random() < 0.01 * speed) b.wv[i] -= 0.8;
    }
    b.rot += speed * 0.2;
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

    if (inp.jump && !b.air) {
      b.air = true; b.vy = -JUMP_V;
      b.wv[2] -= 1.2; b.wv[1] -= 0.4;          // nose lifts on take-off
      AudioSys.sfx.jump();
    }
    if (b.air) {
      b.vy += GRAV; b.y += b.vy;
      if (b.y >= 0) {
        b.y = 0; b.vy = 0; b.air = false;
        b.wv[0] += 1.4; b.wv[1] += 1.0; b.wv[2] += 0.7;
        AudioSys.sfx.land();
        burst(b.x + 8, GROUND_Y - 1, 6, DUST, 0.8, true, 0.04, 16);
      }
    }
    updateWheels(b, G.speed);
    if (!b.air && G.frame % 5 === 0) {
      G.parts.push({ x: b.x + 2, y: wheelBase(0) - 2, vx: -0.3 - Math.random() * 0.3, vy: -0.3 - Math.random() * 0.3, g: 0.02, life: 14, max: 14, c: DUST[Math.floor(Math.random() * 4)], ground: true, floor: false });
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
    if (next !== undefined && G.dist + b.x + 18 >= letterX(next)) reachCheckpoint(next);
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
    if (!G.fshot) { G.fshot = { x: b.x + 34, y: by + 11, x0: b.x + 34 }; shot = true; }
    if (G.upshots.length < 3) { G.upshots.push({ x: Math.round(b.x) + 12, y: by - 3 }); shot = true; }
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
      if (o.type === 'boulder' && sx < ENGAGE + 8) {
        o.x -= 0.35;
        for (const c of G.craters) {
          if (o.x + 7 > c.x + 2 && o.x + 7 < c.x + c.w - 2) { o.dead = true; burst(sx + 7, GROUND_Y - 4, 12, DUST, 1, true, 0.08, 22); break; }
        }
      }
      if (o.type === 'tank' && sx < ENGAGE - 16 && sx > G.buggy.x + 48) {
        if (--o.cd <= 0) {
          G.shells.push({ x: o.x - 3, y: obsBox(o).y + 2 });
          o.cd = 110 + Math.random() * 70 - 30 * difficulty(currentLetter());
          AudioSys.sfx.tank();
          burst(sx - 2, obsBox(o).y + 2, 5, FIRE, 0.6, true, 0, 10);
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
          if (Math.random() < 0.35) { u.ty = GROUND_Y - 50; u.tx = G.buggy.x + 18 + (Math.random() - 0.5) * 60; }
          else u.ty = HUD_H + 16 + Math.random() * 50;
          u.retarget = 30 + Math.random() * 35;
        }
      }
      const acc = u.type === 3 ? 0.004 : 0.0015, damp = u.type === 3 ? 0.92 : 0.94, vmax = u.type === 3 ? 3.5 : 2.5;
      u.vx = clamp((u.vx + (u.tx - u.x) * acc) * damp, -vmax, vmax);
      u.vy = clamp((u.vy + (u.ty - u.y) * acc) * damp, -vmax, vmax);
      u.x += u.vx; u.y += u.vy + Math.sin(u.t * 0.12) * 0.25;
      if (--u.bombCd <= 0) {
        if (Math.abs(u.x - (G.buggy.x + 18)) < 70 && G.bombs.length < maxBombs && G.state === 'play') {
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
      const gy = surfaceAt(bm.x + G.dist);
      if (bm.y >= gy - 1) {
        bm.dead = true;
        burst(bm.x, gy - 2, 12, FIRE.concat(DUST), 1.2, true, 0.06, 22);
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
    if (x - (G.dist + G.buggy.x + 34) < 50 && x + w > G.dist + G.buggy.x - 4) return;
    const LAND = 70;
    if (G.craters.some(c => x < c.x + c.w + LAND && x + w + LAND > c.x)) return;
    if (G.obs.some(o => { const [ow] = obsSize(o); return x < o.x + ow + LAND && x + w + LAND > o.x; })) return;
    G.craters.push({ x, w, depth: 8, passed: false, bomb: true });
  }

  function updateParticles(scroll) {
    for (const p of G.parts) {
      p.vy += p.g; p.x += p.vx - (p.ground ? scroll : 0); p.y += p.vy;
      if (p.floor) {
        const gy = surfaceAt(G.dist + p.x) - 1;
        if (p.y > gy) { p.y = gy; p.vy *= -0.35; p.vx *= 0.6; }
      }
      p.life--;
    }
    G.parts = G.parts.filter(p => p.life > 0);
    for (const t of G.texts) { t.y -= 0.3; if (t.ground) t.x -= scroll; t.life--; }
    G.texts = G.texts.filter(t => t.life > 0);
    for (const f of G.flashes) { if (f.ground) f.x -= scroll; f.life--; }
    G.flashes = G.flashes.filter(f => f.life > 0);
  }

  function hitObstacle(o) {
    const box = obsBox(o), cx = box.x + box.w / 2, gy = box.y + box.h;
    if (o.type === 'rock' && o.big) {
      o.big = false; o.x += 3; o.shape = null;
      addScore(50, cx, gy - 22, true);
      burst(cx, gy - 9, 10, DUST, 1.1, true, 0.08, 24, true);
      AudioSys.sfx.hit();
      return;
    }
    o.dead = true;
    if (o.type === 'rock') { addScore(100, cx, gy - 18, true); burst(cx, gy - 5, 16, DUST, 1.3, true, 0.08, 26, true); AudioSys.sfx.hit(); }
    else if (o.type === 'boulder') { addScore(200, cx, gy - 22, true); burst(cx, gy - 7, 20, DUST, 1.5, true, 0.08, 28, true); AudioSys.sfx.boom(); }
    else { addScore(300, cx, gy - 20, true); burst(cx, gy - 6, 26, FIRE, 1.6, true, 0.06, 30, true); AudioSys.sfx.boom(); }
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
          const wx = G.dist + b.x + WHEEL_X[i] + 5;
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
          if (overlap(fb, { x: s.x - G.dist - 2, y: s.y - 3, w: 8, h: 8 })) {
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
      const floor = surfaceAt(G.dist + d.x + 5) - (d.kind === 'wheel' ? 10 : 9);
      if (d.y > floor) { d.y = floor; d.vy *= -0.45; d.vx *= 0.7; if (Math.abs(d.vy) < 0.4) d.vy = 0; }
      if (d.kind === 'wheel') d.f += d.vx * 0.6;
    }
    if (G.frame % 7 === 0 && G.timer > 70) {
      const body = G.debris[3];
      G.parts.push({ x: body.x + 14 + Math.random() * 8, y: body.y, vx: (Math.random() - 0.5) * 0.3, vy: -0.4 - Math.random() * 0.4, g: -0.005, life: 40, max: 40, c: ['#6b7280', '#9ca3af', '#4b5563'][Math.floor(Math.random() * 3)], ground: false, floor: false });
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


  // ---------------------------------------------------------------- rendering helpers
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function circle(x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function glow(x, y, r, color, alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }
  const FONT = "Orbitron, 'Segoe UI', system-ui, sans-serif";
  function text(str, x, y, { size = 7, color = '#fff', align = 'left', weight = 700, shadow = 0, base = 'top' } = {}) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = base;
    if (shadow) { ctx.shadowColor = color; ctx.shadowBlur = shadow * SY; }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
  }

  // ---------------------------------------------------------------- scenery
  function drawSky() {
    const g = ctx.createLinearGradient(0, HUD_H, 0, GROUND_Y);
    g.addColorStop(0, '#02040c'); g.addColorStop(0.55, '#06102a'); g.addColorStop(1, '#10224a');
    ctx.fillStyle = g; ctx.fillRect(0, HUD_H, W, GROUND_Y - HUD_H);
    for (const s of BG.stars) {
      const sx = ((s.x - G.dist * 0.04) % 1024 + 1024) % 1024;
      if (sx > W) continue;
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(G.frame * s.sp + s.tw);
      circle(sx, s.y, s.s, s.c);
    }
    ctx.globalAlpha = 1;
  }

  function drawLayer(img, w, h, factor, y, alpha = 1) {
    let off = -((G.dist * factor) % w);
    off = Math.round(off * SX) / SX;
    ctx.globalAlpha = alpha;
    for (let x = off; x < W; x += w) ctx.drawImage(img, x, y, w + 0.02, h);
    ctx.globalAlpha = 1;
  }

  function drawNear() {
    const layers = [BG.hills, BG.city];
    if (G.themeT > 0) {
      drawLayer(layers[G.prevTheme], 512, HH, 0.35, HILL_Y);
      drawLayer(layers[G.theme], 512, HH, 0.35, HILL_Y, 1 - G.themeT / 90);
    } else drawLayer(layers[G.theme], 512, HH, 0.35, HILL_Y);
  }

  function surfacePath() {
    ctx.beginPath();
    ctx.moveTo(-1, H + 1);
    for (let x = -1; x <= W + 1; x += 0.75) ctx.lineTo(x, surfaceAt(G.dist + x));
    ctx.lineTo(W + 1, H + 1); ctx.closePath();
  }

  function drawGround(field) {
    BG.groundPat.setTransform(new DOMMatrix().translate(-(G.dist % 256), GROUND_Y - 3).scale(1 / BG.L));
    surfacePath();
    ctx.fillStyle = BG.groundPat; ctx.fill();
    // Surface lip highlight.
    ctx.lineWidth = 0.9; ctx.strokeStyle = '#f7c98c';
    ctx.beginPath();
    for (let x = -1; x <= W + 1; x += 0.75) x < 0 ? ctx.moveTo(x, surfaceAt(G.dist + x)) : ctx.lineTo(x, surfaceAt(G.dist + x));
    ctx.stroke();
    const d0 = Math.floor(G.dist);
    for (let sx = 0; sx < W; sx++) {
      const wx = d0 + sx;
      if (wx % 7 === 0 && pebble(wx) < 0) {
        const px = wx - G.dist + 1.5, py = surfaceAt(wx + 1.5);
        ctx.fillStyle = '#8a4a1f'; ctx.beginPath(); ctx.ellipse(px, py - 0.4, 1.4, 0.8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f5c890'; ctx.beginPath(); ctx.ellipse(px - 0.4, py - 0.8, 0.7, 0.35, 0, 0, TAU); ctx.fill();
      }
    }
    if (field) for (const c of G.craters) drawCrater(c);
  }

  function drawCrater(c) {
    const cx = c.x - G.dist;
    if (cx > W + 4 || cx + c.w < -4) return;
    const top = t => surfaceAt(c.x + t);
    ctx.beginPath();
    ctx.moveTo(cx, top(0));
    for (let t = 0; t <= c.w; t += 0.5) {
      const u = t / c.w * 2 - 1;
      ctx.lineTo(cx + t, top(t) + Math.sqrt(Math.max(0, 1 - u * u)) * c.depth);
    }
    for (let t = c.w; t >= 0; t -= 1) ctx.lineTo(cx + t, top(t) - 0.2);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, 0, cx + c.w, 0);
    g.addColorStop(0, '#050201'); g.addColorStop(0.65, '#1c0d05'); g.addColorStop(1, '#5a2c10');
    ctx.fillStyle = g; ctx.fill();
    // Lit far wall.
    ctx.strokeStyle = 'rgba(255,190,120,0.45)'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let t = c.w * 0.55; t <= c.w; t += 0.5) {
      const u = t / c.w * 2 - 1, y = top(t) + Math.sqrt(Math.max(0, 1 - u * u)) * c.depth;
      t === c.w * 0.55 ? ctx.moveTo(cx + t, y) : ctx.lineTo(cx + t, y);
    }
    ctx.stroke();
    // Raised rims.
    for (const [rx, dir] of [[cx, -1], [cx + c.w, 1]]) {
      const ry = surfaceAt(G.dist + rx);
      ctx.fillStyle = '#e8a865';
      ctx.beginPath(); ctx.moveTo(rx + dir * 3.5, ry + 0.3); ctx.quadraticCurveTo(rx + dir * 1.2, ry - 2.2, rx, ry + 0.4); ctx.closePath(); ctx.fill();
    }
  }

  function drawSigns() {
    for (let i = 0; i < 26; i++) {
      const sx = letterX(i) - G.dist;
      if (sx < -12 || sx > W + 12) continue;
      const gy = surfaceAt(letterX(i)), cp = CHECKPOINTS.includes(i);
      const pg = ctx.createLinearGradient(sx - 0.6, 0, sx + 0.6, 0);
      pg.addColorStop(0, '#e1e8f0'); pg.addColorStop(1, '#6b7a8e');
      ctx.fillStyle = pg; ctx.fillRect(sx - 0.6, gy - 21, 1.2, 21);
      rrect(sx - 6, gy - 31, 12, 10.5, 1.6);
      const bg = ctx.createLinearGradient(0, gy - 31, 0, gy - 20.5);
      if (cp) { bg.addColorStop(0, '#ffd37a'); bg.addColorStop(1, '#e08a00'); } else { bg.addColorStop(0, '#5aa2ff'); bg.addColorStop(1, '#1d5fc0'); }
      ctx.fillStyle = bg; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.4; ctx.stroke();
      text(LETTERS[i], sx, gy - 25.6, { size: 7.5, color: cp ? '#2a1600' : '#ffffff', align: 'center', weight: 900, base: 'middle' });
      if (cp) glow(sx, gy - 26, 12, 'rgba(255,190,60,0.35)');
    }
    // Patrol base at the start of the course.
    const wx0 = letterX(0) - 110, bx = wx0 - G.dist;
    if (bx > -60 && bx < W) {
      const cx = bx + 26, gy = surfaceAt(wx0 + 26) + 1;
      const g = ctx.createRadialGradient(cx - 8, gy - 16, 2, cx, gy, 26);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c3cedb'); g.addColorStop(1, '#5d6d84');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, gy, 22, 18, 0, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(70,90,120,0.5)'; ctx.lineWidth = 0.35;
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.ellipse(cx, gy, 22 * k / 5, 18, 0, Math.PI, TAU); ctx.stroke(); }
      ctx.fillStyle = '#2f80ed'; ctx.fillRect(cx - 20, gy - 9, 40, 1.6);
      rrect(cx + 4, gy - 11, 14, 11, 1.5); ctx.fillStyle = '#0b1119'; ctx.fill();
      glow(cx + 11, gy - 3, 9, 'rgba(90,190,255,0.35)');
      ctx.strokeStyle = '#b9c5d3'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(cx - 2, gy - 17.5); ctx.lineTo(cx - 2, gy - 27); ctx.stroke();
      if ((G.frame >> 4) & 1) { circle(cx - 2, gy - 27.5, 1, '#ff4b3e'); glow(cx - 2, gy - 27.5, 5, 'rgba(255,70,50,0.8)'); }
    }
  }

  // ---------------------------------------------------------------- the buggy
  function drawWheel(x, y, ang) {
    const tg = ctx.createRadialGradient(x - 1, y - 1, 1, x, y, 5);
    tg.addColorStop(0, '#4b535f'); tg.addColorStop(0.7, '#262b33'); tg.addColorStop(1, '#14171c');
    circle(x, y, 5, tg);
    ctx.strokeStyle = '#5b6573'; ctx.lineWidth = 0.55;
    for (let k = 0; k < 10; k++) {
      const a = ang + k * TAU / 10;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 4.1, y + Math.sin(a) * 4.1); ctx.lineTo(x + Math.cos(a) * 4.9, y + Math.sin(a) * 4.9); ctx.stroke();
    }
    const rg = ctx.createRadialGradient(x - 1, y - 1.2, 0.3, x, y, 3.2);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#c5ced8'); rg.addColorStop(1, '#6f7b89');
    circle(x, y, 3.1, rg);
    ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 0.55;
    for (let k = 0; k < 3; k++) {
      const a = ang + k * TAU / 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 2.8, y + Math.sin(a) * 2.8); ctx.stroke();
    }
    circle(x, y, 1, '#343c47');
  }

  // Body in local coordinates: x -18..18, y = 0 on the axle line, negative is up.
  function drawBody(blink) {
    ctx.fillStyle = '#353d49'; rrect(-16, -4.6, 32, 2.6, 1); ctx.fill();
    let g = ctx.createLinearGradient(0, -9, 0, -3.5);
    g.addColorStop(0, '#fbfdff'); g.addColorStop(0.6, '#d3dbe5'); g.addColorStop(1, '#8e9bad');
    ctx.beginPath();
    ctx.moveTo(-17.5, -4); ctx.lineTo(-17.5, -7.6); ctx.quadraticCurveTo(-17.5, -9.2, -15.5, -9.2);
    ctx.lineTo(15, -9.2); ctx.quadraticCurveTo(18.6, -9.2, 18.8, -6.6); ctx.lineTo(18.3, -4); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#5e6b7e'; ctx.lineWidth = 0.35; ctx.stroke();
    ctx.fillStyle = '#e2483d'; ctx.fillRect(-17.5, -6.8, 36, 1.4);
    ctx.fillStyle = 'rgba(255,150,140,0.8)'; ctx.fillRect(-17.5, -6.8, 36, 0.35);
    // Cabin.
    g = ctx.createLinearGradient(0, -12.6, 0, -9);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9c5d3');
    ctx.beginPath(); ctx.moveTo(-12.5, -9.2); ctx.lineTo(-10, -12.6); ctx.lineTo(5.5, -12.6); ctx.lineTo(8, -9.2); ctx.closePath();
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#6b788b'; ctx.stroke();
    ctx.strokeStyle = 'rgba(94,107,126,0.7)'; ctx.lineWidth = 0.25;
    for (const px of [-8, -2, 3]) { ctx.beginPath(); ctx.moveTo(px, -12.2); ctx.lineTo(px, -9.4); ctx.stroke(); }
    // Canopy.
    ctx.beginPath(); ctx.moveTo(6, -9.2); ctx.quadraticCurveTo(7, -15.2, 12.5, -14.6); ctx.quadraticCurveTo(17, -13.4, 17, -9.2); ctx.closePath();
    g = ctx.createLinearGradient(8, -15, 14, -9);
    g.addColorStop(0, '#e2fbff'); g.addColorStop(0.45, '#58c6ea'); g.addColorStop(1, '#156e9e');
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#0e4f70'; ctx.lineWidth = 0.35; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.ellipse(10.2, -12.9, 1.9, 0.65, -0.35, 0, TAU); ctx.fill();
    // Anti-air turret.
    ctx.fillStyle = '#5a6576'; ctx.fillRect(-6.7, -18, 1.4, 5.4);
    ctx.fillStyle = '#2a313b'; ctx.fillRect(-6.7, -18.2, 1.4, 0.8);
    g = ctx.createRadialGradient(-6.8, -13.6, 0.3, -6, -12.8, 2.6);
    g.addColorStop(0, '#e6ecf3'); g.addColorStop(1, '#6f7b8b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-6, -12.6, 2.5, Math.PI, TAU); ctx.fill();
    // Antenna.
    ctx.strokeStyle = '#a7b3c2'; ctx.lineWidth = 0.35;
    ctx.beginPath(); ctx.moveTo(-15, -9.2); ctx.lineTo(-17, -18.5); ctx.stroke();
    circle(-17, -18.6, 0.7, blink ? '#ff4b3e' : '#7a211a');
    // Front cannon and headlight.
    ctx.fillStyle = '#4b5563'; rrect(15.5, -4.1, 5.2, 1.7, 0.6); ctx.fill();
    circle(18.4, -7.5, 0.95, '#fff2c2');
  }

  function drawBuggyAt(bx, rearB, midB, frontB, ang, air, t = G.frame) {
    const hang = air ? 1 : 0;
    const ry = rearB - 5, fy = frontB - 5, axle = (ry + fy) / 2;
    const tilt = Math.atan2(fy - ry, 26), cos = Math.cos(tilt), sin = Math.sin(tilt);
    const cx = bx + 18;
    const toW = (lx, ly) => [cx + lx * cos - ly * sin, axle + lx * sin + ly * cos];
    const wheels = [[bx + 5, ry + hang], [bx + 18, clamp(midB - 5, axle - 2, axle + 2) + hang], [bx + 31, fy + hang]];
    // Soft contact shadow.
    ctx.fillStyle = 'rgba(40,18,6,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, Math.max(rearB, frontB) + 0.3, 19, 1.3, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2d343e'; ctx.lineWidth = 1.3;
    [[-13, -3], [0, -3], [13, -3]].forEach(([lx, ly], i) => {
      const [ax, ay] = toW(lx, ly);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(wheels[i][0], wheels[i][1]); ctx.stroke();
    });
    for (const [wx, wy] of wheels) drawWheel(wx, wy, ang);
    ctx.save();
    ctx.translate(cx, axle); ctx.rotate(tilt);
    drawBody((t >> 4) & 1);
    ctx.restore();
    const [hx, hy] = toW(18.4, -7.5);
    glow(hx + 2, hy, 7, 'rgba(255,236,170,0.55)');
    if ((t >> 4) & 1) { const [ax, ay] = toW(-17, -18.6); glow(ax, ay, 3.5, 'rgba(255,80,60,0.9)'); }
  }

  function drawBuggy() {
    const b = G.buggy;
    drawBuggyAt(b.x, wheelBase(0), wheelBase(1), wheelBase(2), (G.dist + b.x) / 5, b.air);
  }

  function drawMiniBuggy(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    drawBuggyAt(-18, 0, 0, 0, 0, false, 0);
    ctx.restore();
  }

  function drawDebris() {
    for (const d of G.debris) {
      if (d.kind === 'wheel') drawWheel(d.x + 5, d.y + 5, d.f);
      else if (G.timer > 60 || (G.frame >> 2) & 1) {
        ctx.save();
        ctx.translate(d.x + 18, d.y + 11); ctx.rotate(Math.sin(G.timer * 0.05) * 0.25);
        ctx.globalAlpha = 0.9; ctx.filter = 'brightness(0.55) sepia(0.4)';
        drawBody(0);
        ctx.restore();
      }
    }
  }

  // ---------------------------------------------------------------- hazards
  function rockShape(seed) {
    const r = mulberry32(seed), pts = [], n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI - i / (n - 1) * Math.PI, rad = 0.78 + r() * 0.22;
      pts.push([0.5 + Math.cos(a) * 0.5 * (0.9 + r() * 0.1), 1 - Math.sin(a) * rad]);
    }
    return { pts, cracks: [[0.3 + r() * 0.2, 0.3 + r() * 0.2, 0.4 + r() * 0.3, 0.8], [0.6 + r() * 0.2, 0.25 + r() * 0.2, 0.7, 0.6 + r() * 0.3]] };
  }

  function drawRock(o, box) {
    if (!o.shape) o.shape = rockShape(hash(Math.floor(o.x) + (o.big ? 7 : 3)));
    const { x, y, w, h } = box, s = o.shape;
    ctx.beginPath();
    s.pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * w, y + py * h));
    ctx.closePath();
    const g = ctx.createRadialGradient(x + w * 0.35, y + h * 0.3, 0.5, x + w * 0.5, y + h * 0.6, w * 0.75);
    g.addColorStop(0, '#f2c089'); g.addColorStop(0.45, '#c07e44'); g.addColorStop(1, '#6d3c18');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#5a2e12'; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(80,38,12,0.7)'; ctx.lineWidth = 0.35;
    for (const [x1, y1, x2, y2] of s.cracks) { ctx.beginPath(); ctx.moveTo(x + x1 * w, y + y1 * h); ctx.lineTo(x + x2 * w, y + y2 * h); ctx.stroke(); }
  }

  function drawBoulder(x, y, ang) {
    const cx = x + 7, cy = y + 7;
    const g = ctx.createRadialGradient(cx - 2.5, cy - 2.5, 0.5, cx, cy, 7.2);
    g.addColorStop(0, '#e6b07c'); g.addColorStop(0.5, '#a86b3a'); g.addColorStop(1, '#5a3218');
    circle(cx, cy, 7, g);
    for (let k = 0; k < 4; k++) {
      const a = ang + k * 1.7, rr = 2.2 + (k % 2) * 1.8;
      ctx.fillStyle = 'rgba(70,36,14,0.6)';
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.3, 0.9, a, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = '#4a2810'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.stroke();
  }

  function drawMine(x, y, on) {
    ctx.fillStyle = '#2d343e'; rrect(x, y + 3.6, 9, 1.6, 0.6); ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + 4);
    g.addColorStop(0, '#e1e7ee'); g.addColorStop(1, '#6f7b8b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + 4.5, y + 3.8, 4.2, 3.2, 0, Math.PI, TAU); ctx.fill();
    circle(x + 4.5, y + 0.8, 0.9, on ? '#ff3b30' : '#6a1a14');
    if (on) glow(x + 4.5, y + 0.8, 5, 'rgba(255,60,40,0.9)');
  }

  function drawTank(x, y) {
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(x - 1, y + 1.8, 10, 1.3);
    ctx.fillStyle = '#23291a'; rrect(x + 1, y + 6, 18.5, 4, 2); ctx.fill();
    for (let i = 0; i < 5; i++) circle(x + 3.3 + i * 3.5, y + 8, 1.25, '#5d6b43');
    const g = ctx.createLinearGradient(0, y + 3, 0, y + 6.5);
    g.addColorStop(0, '#b3cb6b'); g.addColorStop(1, '#4e6526');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x + 1.5, y + 6.4); ctx.lineTo(x + 4, y + 3.4); ctx.lineTo(x + 17, y + 3.4); ctx.lineTo(x + 19.5, y + 6.4); ctx.closePath(); ctx.fill();
    const tg = ctx.createRadialGradient(x + 10, y + 1.5, 0.3, x + 11, y + 3, 3.4);
    tg.addColorStop(0, '#d2e68f'); tg.addColorStop(1, '#5d7a2b');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(x + 11, y + 3.5, 3.2, Math.PI, TAU); ctx.fill();
  }

  function drawUfo(type, x, y, t) {
    const blink = (t >> 3) & 1;
    if (type === 1) {
      glow(x, y + 2.5, 8, 'rgba(110,210,255,0.45)');
      let g = ctx.createLinearGradient(0, y - 2, 0, y + 3);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#b7c3d0'); g.addColorStop(1, '#5d6a7a');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + 0.6, 8, 2.3, 0, 0, TAU); ctx.fill();
      g = ctx.createLinearGradient(0, y - 4, 0, y);
      g.addColorStop(0, '#e6fbff'); g.addColorStop(1, '#2d98c8');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - 0.4, 3.6, 3.2, 0, Math.PI, TAU); ctx.fill();
      for (let k = 0; k < 5; k++) {
        const on = (k + blink) % 2;
        circle(x - 6 + k * 3, y + 1, 0.55, on ? '#ffd166' : '#ff3b30');
      }
    } else if (type === 2) {
      glow(x, y + 4, 5 + Math.random() * 1.5, 'rgba(255,150,40,0.9)');
      ctx.strokeStyle = '#8a3a0c'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x - 4, y + 1); ctx.lineTo(x - 6, y + 4); ctx.moveTo(x + 4, y + 1); ctx.lineTo(x + 6, y + 4); ctx.stroke();
      const g = ctx.createLinearGradient(0, y - 3.5, 0, y + 3);
      g.addColorStop(0, '#ffd08a'); g.addColorStop(0.5, '#f08a24'); g.addColorStop(1, '#8f3d08');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 7, 3.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = blink ? '#fff1b8' : '#ffd166'; rrect(x - 4.2, y - 1.3, 8.4, 1.4, 0.6); ctx.fill();
    } else {
      glow(x, y + 2, 5, 'rgba(120,255,160,0.7)');
      const g = ctx.createLinearGradient(0, y - 4, 0, y + 3);
      g.addColorStop(0, '#b8ffcf'); g.addColorStop(1, '#168a45');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - 6.5, y + 2.5); ctx.lineTo(x, y - 4.2); ctx.lineTo(x + 6.5, y + 2.5); ctx.lineTo(x, y + 0.8); ctx.closePath(); ctx.fill();
      circle(x, y - 1.2, 1.3, blink ? '#fff6a8' : '#ffb347');
    }
  }

  function drawObstacles() {
    for (const o of G.obs) {
      const box = obsBox(o);
      if (box.x < -24 || box.x > W + 4) continue;
      if (o.type === 'rock') drawRock(o, box);
      else if (o.type === 'mine') drawMine(box.x, box.y, (G.frame >> 4) & 1);
      else if (o.type === 'tank') drawTank(box.x, box.y);
      else drawBoulder(box.x, box.y, -o.x / 7);
    }
    for (const s of G.shells) {
      const sx = s.x - G.dist;
      glow(sx + 1, s.y + 1, 5, 'rgba(255,150,40,0.8)');
      ctx.fillStyle = '#fff3cf'; rrect(sx, s.y, 4, 2, 1); ctx.fill();
    }
  }

  function drawAir() {
    const f = G.fshot;
    if (f) {
      const g = ctx.createLinearGradient(f.x - 10, 0, f.x + 6, 0);
      g.addColorStop(0, 'rgba(255,160,40,0)'); g.addColorStop(1, '#fff3b0');
      ctx.fillStyle = g; rrect(f.x - 10, f.y - 0.8, 16, 1.6, 0.8); ctx.fill();
      glow(f.x + 4, f.y, 5, 'rgba(255,200,80,0.8)');
    }
    for (const s of G.upshots) {
      const g = ctx.createLinearGradient(0, s.y, 0, s.y + 9);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,210,80,0)');
      ctx.fillStyle = g; rrect(s.x, s.y, 1.6, 9, 0.8); ctx.fill();
      glow(s.x + 0.8, s.y + 1, 4, 'rgba(255,230,120,0.8)');
    }
    for (const u of G.ufos) drawUfo(u.type, u.x, u.y, G.frame + u.type * 3);
    for (const bm of G.bombs) {
      glow(bm.x, bm.y, 5, bm.crater ? 'rgba(255,170,40,0.9)' : 'rgba(255,80,50,0.9)');
      circle(bm.x, bm.y, 1.4, (G.frame >> 2) & 1 ? '#ffffff' : '#ffe08a');
    }
  }

  function drawParticles() {
    for (const p of G.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = clamp(p.life / (p.max * 0.5), 0, 1);
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      circle(p.x, p.y, (p.size || 0.8) * (0.4 + k * 0.9), p.c);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    for (const fl of G.flashes) {
      const k = fl.life / fl.max;
      glow(fl.x, fl.y, fl.r * (1.4 - k * 0.6), `rgba(255,${Math.round(180 + 60 * k)},120,${0.9 * k})`);
    }
    for (const t of G.texts) {
      ctx.globalAlpha = clamp(t.life / 20, 0, 1);
      text(t.text, t.x, t.y, { size: 6, color: t.c, align: 'center', weight: 700, shadow: 1.5 });
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- HUD and overlays
  function lamp(x, y, on, col, off) {
    circle(x, y, 3.2, '#0b0f18');
    circle(x, y, 2.5, on ? col : off);
    if (on) { glow(x, y, 8, col, 0.8); circle(x - 0.8, y - 0.8, 0.7, 'rgba(255,255,255,0.8)'); }
  }

  function drawHUD(field) {
    const g = ctx.createLinearGradient(0, 0, 0, HUD_H);
    g.addColorStop(0, '#050913'); g.addColorStop(1, '#0a1427');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = 'rgba(56,150,255,0.55)'; ctx.fillRect(0, HUD_H - 0.6, W, 0.6);

    text('1UP', 8, 3, { size: 5, color: '#ff5f57', weight: 900 });
    text(pad(G.score), 8, 9.5, { size: 8.5, color: '#f5f7fa', weight: 700 });
    text('HI-SCORE', W / 2, 3, { size: 5, color: '#ffb020', align: 'center', weight: 900 });
    text(pad(G.hi), W / 2, 9.5, { size: 8.5, color: '#f5f7fa', align: 'center', weight: 700 });
    const tx = W - 70;
    text('TIME', tx, 3, { size: 5, color: '#39c6f0', align: 'center', weight: 900 });
    text(String(Math.floor(G.segFrames / 60)).padStart(3, '0'), tx, 9.5, { size: 8.5, color: '#f5f7fa', align: 'center' });

    const blink = (G.frame >> 3) & 1;
    const ahead = G.dist + G.buggy.x;
    const air = field && (G.wave || G.ufos.length > 0);
    const gnd = field && (G.shells.length > 0 || G.obs.some(o => (o.type === 'tank' || o.type === 'boulder') && o.x > ahead && o.x - ahead < 320));
    const mines = field && G.obs.some(o => o.type === 'mine' && o.x > ahead && o.x - ahead < 320);
    lamp(W - 34, 10, air && blink, '#ff3b30', '#3a1210');
    lamp(W - 23, 10, gnd && blink, '#ffb020', '#3a2a08');
    lamp(W - 12, 10, mines && blink, '#34d399', '#0f3326');

    const cur = currentLetter();
    rrect(6, 21, 19, 17, 2.5);
    ctx.fillStyle = 'rgba(47,128,237,0.14)'; ctx.fill();
    ctx.strokeStyle = '#2f80ed'; ctx.lineWidth = 0.7; ctx.stroke();
    text(field ? LETTERS[cur] : 'A', 15.5, 30, { size: 12, color: '#ffb020', align: 'center', weight: 900, base: 'middle', shadow: 3 });

    const x0 = 34, x1 = W - 10, bw = x1 - x0;
    const p = field ? clamp((G.dist + G.buggy.x + 18 - letterX(0)) / (25 * SEG), 0, 1) : 0;
    rrect(x0, 26.5, bw, 3, 1.5); ctx.fillStyle = '#10243f'; ctx.fill();
    if (p > 0) {
      const pg = ctx.createLinearGradient(x0, 0, x1, 0);
      pg.addColorStop(0, '#1479c9'); pg.addColorStop(1, '#6fe6ff');
      rrect(x0, 26.5, Math.max(3, bw * p), 3, 1.5); ctx.fillStyle = pg; ctx.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = x0 + bw * i / 25, cp = CHECKPOINTS.includes(i);
      ctx.fillStyle = cp ? '#ffb020' : 'rgba(120,160,215,0.6)';
      ctx.fillRect(x - 0.3, cp ? 24.5 : 26, 0.6, cp ? 6.5 : 4);
      if (cp) text(LETTERS[i], x, 32, { size: 5.5, color: i <= G.cp && field ? '#ffb020' : '#8a6a2a', align: 'center', weight: 900 });
    }
    drawMiniBuggy(x0 + bw * p, 25, 0.38);
  }

  function drawGroundHUD() {
    for (let i = 0; i < Math.min(G.lives - 1, 8); i++) drawMiniBuggy(12 + i * 16, H - 3, 0.4);
    text(G.course === 0 ? 'BEGINNER' : 'CHAMPION', W - 6, H - 3, { size: 6, color: 'rgba(255,226,189,0.9)', align: 'right', weight: 900, base: 'bottom' });
  }

  function panel(x, y, w, h) {
    rrect(x, y, w, h, 4);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(8,18,40,0.9)'); g.addColorStop(1, 'rgba(3,8,20,0.9)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(80,160,255,0.85)'; ctx.lineWidth = 0.6; ctx.stroke();
  }

  function row(label, value, y, lc, vc, cx) {
    text(label, cx - 70, y, { size: 6, color: lc, weight: 700 });
    text(value, cx + 70, y, { size: 6.5, color: vc, align: 'right', weight: 700 });
  }

  function drawOverlays() {
    const blink = (G.frame >> 4) & 1, cx = W / 2;
    if (G.state === 'ready') {
      panel(cx - 82, 70, 164, 50);
      text(G.readyMsg || (G.course === 0 ? 'BEGINNER COURSE' : 'CHAMPION COURSE'), cx, 77, { size: 7, color: '#39c6f0', align: 'center', weight: 900 });
      text('POINT ' + LETTERS[G.cp], cx, 89, { size: 8, color: '#ffb020', align: 'center', weight: 900, shadow: 2 });
      if (blink) text('GET READY', cx, 104, { size: 6.5, color: '#f5f7fa', align: 'center' });
    }
    if (G.panel) {
      const p = G.panel;
      panel(cx - 86, 50, 172, p.final ? 86 : 76);
      text('POINT ' + p.letter, cx, 56, { size: 12, color: '#ffb020', align: 'center', weight: 900, shadow: 3 });
      row('YOUR TIME', String(p.secs), 76, '#39c6f0', '#f5f7fa', cx);
      row('AVERAGE TIME', String(p.avg), 86, '#39c6f0', '#f5f7fa', cx);
      row('TOP RECORD', String(p.rec), 96, '#39c6f0', '#f5f7fa', cx);
      row(p.secs <= p.avg ? 'GOOD BONUS' : 'BONUS', String(p.bonus), 109, '#ff5f57', '#ffb020', cx);
      if (p.final && blink) text('COURSE COMPLETE!', cx, 123, { size: 7, color: '#34d399', align: 'center', weight: 900 });
    }
    if (G.state === 'gameover') {
      panel(cx - 66, 82, 132, 32);
      text('GAME OVER', cx, 98, { size: 13, color: '#ff5f57', align: 'center', weight: 900, base: 'middle', shadow: 4 });
    }
    if (G.demo) {
      text('DEMO PLAY', cx, HUD_H + 5, { size: 6.5, color: '#39c6f0', align: 'center', weight: 900 });
      if (blink) text('PRESS ENTER TO START', cx, HUD_H + 15, { size: 6, color: '#ffb020', align: 'center' });
    }
  }

  function logo(str, y) {
    ctx.font = `900 27px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#7a1d0e'; ctx.fillText(str, W / 2 + 1.2, y + 1.4);
    const g = ctx.createLinearGradient(0, y, 0, y + 24);
    g.addColorStop(0, '#fff1b8'); g.addColorStop(0.45, '#ffb020'); g.addColorStop(1, '#e0541a');
    ctx.shadowColor = 'rgba(255,150,40,0.7)'; ctx.shadowBlur = 10 * SY;
    ctx.fillStyle = g; ctx.fillText(str, W / 2, y);
    ctx.shadowBlur = 0;
  }

  function drawTitle() {
    const cx = W / 2;
    panel(cx - 112, HUD_H + 4, 224, 108);
    logo('LUNAR', HUD_H + 8);
    logo('PATROL', HUD_H + 35);
    if ((G.frame >> 5) & 1) text('PRESS ENTER TO START', cx, HUD_H + 67, { size: 7, color: '#f5f7fa', align: 'center', shadow: 2 });
    text('1 PLAYER  —  3 BUGGIES', cx, HUD_H + 80, { size: 6, color: '#39c6f0', align: 'center' });
    text('EXTRA BUGGY AT 10000  30000  50000', cx, HUD_H + 90, { size: 5.5, color: '#9aa8b8', align: 'center', weight: 500 });
    text('AN ARCADE TRIBUTE', cx, HUD_H + 100, { size: 5.5, color: '#5b8fd6', align: 'center', weight: 500 });
    const wx = G.dist + 110, s = o => surfaceAt(wx + o + 5);
    drawBuggyAt(cx - 18, s(0), s(13), s(26), G.dist / 5, false);
  }

  function drawPoints() {
    const cx = W / 2;
    panel(cx - 108, HUD_H + 3, 216, 130);
    text('SCORE ADVANCE TABLE', cx, HUD_H + 9, { size: 7, color: '#ffb020', align: 'center', weight: 900, shadow: 2 });
    const items = [
      [x => drawUfo(1, x, 0, G.frame), '100 PTS'], [x => drawUfo(2, x, 0, G.frame), '200 PTS'], [x => drawUfo(3, x, 0, G.frame), '300 PTS'],
      [x => drawTank(x - 10, -5), '300 PTS'], [x => drawBoulder(x - 7, -7, G.frame * 0.05), '200 PTS'],
      [x => drawRock({ x: 11, big: true }, { x: x - 8, y: -6.5, w: 16, h: 13 }), '50 + 100 PTS'],
      [x => drawMine(x - 4.5, -2.5, (G.frame >> 4) & 1), 'JUMP  100 PTS'],
    ];
    items.forEach(([draw, label], i) => {
      const y = HUD_H + 27 + i * 14.5;
      ctx.save(); ctx.translate(0, y); draw(cx - 48); ctx.restore();
      text('=  ' + label, cx - 26, y, { size: 6.5, color: '#f5f7fa', base: 'middle' });
    });
  }

  function drawScores() {
    const cx = W / 2;
    panel(cx - 90, HUD_H + 6, 180, 112);
    text('BEST PATROLS', cx, HUD_H + 13, { size: 8, color: '#ffb020', align: 'center', weight: 900, shadow: 2 });
    scores.forEach((s, i) => {
      const y = HUD_H + 33 + i * 13, col = i === 0 ? '#ffb020' : '#f5f7fa';
      text(['1ST', '2ND', '3RD', '4TH', '5TH'][i], cx - 64, y, { size: 6.5, color: '#39c6f0' });
      text(s.name, cx - 20, y, { size: 6.5, color: col });
      text(pad(s.score), cx + 64, y, { size: 6.5, color: col, align: 'right' });
    });
    if ((G.frame >> 5) & 1) text('PRESS ENTER TO START', cx, HUD_H + 104, { size: 6.5, color: '#f5f7fa', align: 'center' });
  }

  function render() {
    if (!BG.groundPat) return;
    ctx.setTransform(SX, 0, 0, SY, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const field = ['ready', 'play', 'dying', 'gameover'].includes(G.state);
    drawSky();
    drawLayer(BG.mountains, 512, MH, 0.12, MOUNT_Y);
    drawNear();
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
    if (G.flash > 0) { ctx.fillStyle = `rgba(255,245,220,${G.flash * 0.12})`; ctx.fillRect(0, HUD_H, W, H - HUD_H); }
    if (G.paused) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, HUD_H, W, H - HUD_H); }
  }

  // Backing-store size in device pixels; 'fill' widens the logical view to the window's shape.
  function resize(cw, ch, view) {
    canvas.width = cw; canvas.height = ch;
    W = view === 'arcade' ? 256 : clamp(Math.round(224 * cw / ch), 256, 460);
    SX = cw / W; SY = ch / H;
    buildLayers();
    render();
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

  buildStars();
  clearField();
  requestAnimationFrame(loop);
  if (document.fonts) document.fonts.load(`700 10px Orbitron`).then(render, () => {});

  const api = {
    press, release, releaseAll, startGame, quitToTitle, qualifies, saveScore, resize,
    getScores: () => scores.slice(),
    setPaused(p) { G.paused = p; AudioSys.setPaused(p); if (p) releaseAll(); },
    isPaused: () => G.paused,
    inGame: () => G.mode === 'game' && G.state !== 'gameover',
    onGameOver: null,
    // Test hooks: inspect state / advance the simulation n frames synchronously.
    _state: () => G,
    _tick(n = 1, auto = false) {
      for (let i = 0; i < n; i++) {
        if (auto && G.state === 'play') { G.frame++; if (G.themeT > 0) G.themeT--; if (G.flash > 0) G.flash--; updatePlay(autopilot()); } else step();
      }
      render();
      return { death: G.lastDeath, state: G.state, letter: LETTERS[currentLetter()], score: G.score, lives: G.lives, cp: LETTERS[G.cp], course: G.course, ufos: G.ufos.length };
    },
  };
  return api;
})();
