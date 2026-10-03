'use strict';
/* Classic mode — a recreation of the 1982 coin-op, redrawn as high-resolution pixel art.
   Shapes and colours follow the arcade original (magenta buggy with gear wheels, yellow saucers,
   teal-and-blue peaks, green hills, peach ground). Every sprite is built at three pixels per
   arcade pixel, so it keeps the original look with finer detail, and is drawn with
   nearest-neighbour scaling at the display's native resolution. */
const Classic = (() => {
  const H = 224, HUD_H = 40, GROUND_Y = 190;
  let W = 256;
  const D = 3;                           // sprite pixels per arcade pixel
  const DB = 2;                          // backdrop pixels per arcade pixel
  const SEG = 600, LEAD = 220;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const CHECKPOINTS = [0, 4, 9, 14, 19, 25];
  const JUMP_V = 2.55, GRAV = 0.1;
  const SPEED_MIN = 0.7, SPEED_MAX = 2.0, SPEED_BASE = 1.15;
  const EXTRA_LIVES = [10000, 30000, 50000];
  const WX = [5.5, 15, 27];              // wheel centres, relative to the buggy's left edge
  const WR = 3.6;                        // wheel radius
  const ENGAGE = 248;                    // hazards act at arcade-screen distance in any view width
  const FONT = '"Press Start 2P", monospace';
  const TAU = Math.PI * 2;
  const letterX = i => LEAD + i * SEG;

  // Colours sampled from the arcade screen.
  const C = {
    sky: '#000000', ink: '#0c0a22',
    mag: '#c804bc', magHi: '#f25cf0', magLo: '#8a0084',
    cab: '#08bad6', cabHi: '#9ef2ff', cyan: '#22cdec',
    teal: '#00a4b8', tealHi: '#5fd6e6', blue: '#0a22ee',
    green: '#02e162', greenLo: '#02a30a', greenHi: '#9dffb0',
    peach: '#ffa463', peachHi: '#ffc896', peachLo: '#e48a4c', dirt: '#b8642e',
    yellow: '#ece418', yellowHi: '#fffaa0', yellowLo: '#b8a800', red: '#e8141c', dome: '#4da1d0', domeHi: '#a8d8f4',
    white: '#ffffff', smoke: '#c9cfdd',
  };

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
  function hash2(i, j) {
    let n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) | 0;
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  }
  const smooth = f => f * f * (3 - 2 * f);
  // Value noise; with period p it wraps seamlessly (used for tiled backdrops).
  function noise1(x, seed, p = 0) {
    const i = Math.floor(x), f = x - i, a = p ? ((i % p) + p) % p : i, b = p ? (((i + 1) % p) + p) % p : i + 1;
    return hash2(a, seed) + (hash2(b, seed) - hash2(a, seed)) * smooth(f);
  }
  function noise2(x, y, seed, p = 0) {
    const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
    const w = k => p ? ((k % p) + p) % p : k;
    const a = hash2(w(i) + seed * 131, j), b = hash2(w(i + 1) + seed * 131, j);
    const c = hash2(w(i) + seed * 131, j + 1), d = hash2(w(i + 1) + seed * 131, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const pad = n => String(n).padStart(6, '0');
  const box = (u, v, x0, y0, x1, y1) => u >= x0 && u < x1 && v >= y0 && v < y1;
  function inPoly(p, x, y) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const Store = {
    load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const DEFAULT_SCORES = [
    { name: 'IRM', score: 20000 }, { name: 'MPT', score: 15000 }, { name: 'BUG', score: 10000 },
    { name: 'LUN', score: 7500 }, { name: 'AZ ', score: 5000 },
  ];

  // ---------------------------------------------------------------- pixel-art builder
  const RGB = {};
  function rgb(hex) {
    if (!RGB[hex]) RGB[hex] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return RGB[hex];
  }
  // art(w, h, fn): a sprite of w×h arcade pixels at `dens` pixels each. fn(x, y) gets arcade
  // coordinates of each fine pixel's centre and returns a colour or null (transparent).
  function art(w, h, fn, dens = D) {
    const pw = Math.ceil(w * dens), ph = Math.ceil(h * dens);
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const x = c.getContext('2d'), img = x.createImageData(pw, ph), d = img.data;
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      const col = fn((i + 0.5) / dens, (j + 0.5) / dens);
      if (!col) continue;
      const [r, g, b] = rgb(col), k = (j * pw + i) * 4;
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    c.lw = w; c.lh = h;
    return c;
  }

  // ---------------------------------------------------------------- sprites
  // Moon buggy, traced from the arcade sprite (units are half arcade pixels).
  const BODY = [[2, 22], [4, 19.5], [8, 18.5], [28, 18], [31, 15], [34, 12], [37, 10], [47, 10], [50, 12], [53, 15],
    [56, 16.5], [63, 17], [65, 18.5], [65, 21.5], [62, 22.5], [62, 27], [60, 29.5], [6, 29.5], [3, 28], [2, 26]];
  const CAB = [[34.6, 12.6], [37.6, 11.2], [46.8, 11.2], [49.6, 13], [52.4, 16.2], [32.8, 16.8]];
  const BUGGY = art(33, 17, (x, y) => {
    const u = x * 2, v = y * 2;
    if (box(u, v, 19.6, 1.5, 21.4, 17)) return u < 20.3 || v < 3 ? C.magHi : C.mag;           // anti-air barrel
    if (box(u, v, 17.6, 6.5, 23.4, 10.2) || box(u, v, 17.8, 10, 19.4, 16) || box(u, v, 21.6, 10, 23.2, 16) || box(u, v, 14, 15.4, 28, 18.4)) return C.ink;
    if (box(u, v, 63.4, 17.4, 65.6, 21.6)) return C.magHi;                                      // cannon muzzle
    if (box(u, v, 56, 18.6, 62.6, 20.4)) return C.mag;
    if (box(u, v, 46, 17.4, 63.4, 21.6)) return box(u, v, 46, 17.4, 48.6, 18.8) ? C.cyan : C.ink;
    if (inPoly(CAB, u, v)) return v < 12.4 + (u - 36) * 0.04 || (u > 47.5 && v < 14.2) ? C.cabHi : C.cab;
    if (inPoly(BODY, u, v)) {
      if (!inPoly(BODY, u, v - 1.3)) return C.magHi;
      if (v > 27.2 || !inPoly(BODY, u + 1.5, v)) return C.magLo;
      if (box(u, v, 19, 18.4, 21.6, 19.9)) return C.cyan;
      if (box(u, v, 6, 23, 60, 23.8)) return C.magLo;                                          // panel seam
      return C.mag;
    }
    return null;
  });

  // Gear wheels: dark rim with eight teeth, cyan studs and hub. Eight frames cover one tooth step.
  const WHEEL = Array.from({ length: 8 }, (_, f) => art(8, 8, (x, y) => {
    const dx = x - 4, dy = y - 4, r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx) - f * Math.PI / 32;
    const k = ((a / (Math.PI / 4)) % 1 + 1) % 1;
    const tooth = Math.abs(k - 0.5) < 0.2;
    if (r > (tooth ? 3.95 : 3.35)) return null;
    if (Math.abs(dx) < 1.0 && Math.abs(dy) < 1.25) return dx < -0.3 && dy < -0.5 ? C.cabHi : C.cyan;
    if (r > 2.35 && r < 3.15 && (k < 0.1 || k > 0.9)) return C.cyan;
    return r > 3.3 ? '#1d1a44' : C.ink;
  }));

  const MINI_BUGGY = art(16, 8, (x, y) => {
    const u = x * 4.1, v = y * 4.1 + 2;
    if (inPoly(BODY, u, v) || box(u, v, 19.6, 4, 21.4, 17)) return inPoly(CAB, u, v) ? C.cab : C.mag;
    for (const cx of WX) if (Math.hypot(x - cx / 2, y - 6.9) < 1.25) return C.ink;
    return null;
  });

  // Saucers: domed craft with wide split wings and red landing feet.
  function saucer(wing, wingHi, wingLo, dome, domeHi, eye, feet, blink) {
    return art(19, 9, (x, y) => {
      const dx = x - 9.5;
      if (y < 4.8 && dx * dx / 13.7 + (y - 4.8) ** 2 / 17.6 < 1) {
        if (Math.abs(Math.abs(dx) - 1.15) < 0.5 && Math.abs(y - 2.9) < 0.55) return eye;
        return y < 1.8 || dx < -2 ? domeHi : dome;
      }
      if (y >= 4.4 && y < 6.9 && Math.abs(dx) < 9.2 - (y - 4.4) * 1.3) {
        if (y > 5.7 && Math.abs(dx) < 1.4) return null;
        return y < 5.1 ? wingHi : y > 6.2 ? wingLo : wing;
      }
      if (y >= 6.9 && y < 8.2 && Math.abs(dx) > 3.2 && Math.abs(dx) < 6.4) return blink && Math.abs(dx) > 4.8 ? '#ffb000' : feet;
      return null;
    });
  }
  const UFO1 = [0, 1].map(f => saucer(C.yellow, C.yellowHi, C.yellowLo, C.dome, C.domeHi, C.red, C.red, f));
  const UFO2 = [0, 1].map(f => saucer('#e4ecf6', '#ffffff', '#9aa8bc', '#f04898', '#ffa0d0', C.yellow, '#ff7a10', f));
  // Tri-orb craft: three glowing spheres; it lobs crater-making grenades.
  const UFO3 = [0, 1].map(f => art(15, 12, (x, y) => {
    const orbs = [[7.5, 3], [3, 8.6], [12, 8.6]];
    for (const [ox, oy] of orbs) {
      const d = Math.hypot(x - ox, y - oy);
      if (d < 2.9) return d < 1 && x < ox && y < oy ? '#ffffff' : (x - ox) + (y - oy) < -1 ? '#ff9ad8' : f ? '#ff2a7a' : '#e01060';
    }
    if (inPoly(orbs, x, y)) return Math.hypot(x - 7.5, y - 6.7) < 1.2 ? (f ? C.yellow : '#ff7a10') : '#3a1050';
    return null;
  }));

  // Falling bomb (magenta dart with fins) and the tri-orb's flashing grenade.
  const BOMB = [0, 1].map(f => art(5, 7, (x, y) => {
    const dx = Math.abs(x - 2.5);
    if (y < 5.6 && dx < 0.75) return y < 1.2 ? '#ff9ad0' : f ? '#e8108c' : '#c80078';
    if (y >= 1 && y < 3.4 && dx < 2.5 - (y - 1) * 0.6) return f ? '#c80078' : '#e8108c';
    if (y >= 5.6 && y < 6.8 && dx < 0.5) return C.red;
    return null;
  }));
  const GRENADE = [0, 1].map(f => art(3, 3, (x, y) => Math.hypot(x - 1.5, y - 1.5) < 1.45 ? (f ? '#ffffff' : C.yellow) : null));

  const UP_SHOT = art(1.4, 5, (x, y) => (y < 1 ? C.white : '#e8f4ff'));
  const FWD_SHOT = art(9, 3, (x, y) => {
    if (Math.hypot(x - 7.3, y - 1.5) < 1.45) return x > 7.6 && y < 1.4 ? '#ffd0a0' : C.red;
    if (y > 1 && y < 2 && ((x > 4 && x < 5.4) || (x > 1 && x < 2.2))) return x > 4 ? C.yellow : '#9a9a10';
    return null;
  });

  // Rocks: stepped cones in ochre with an olive peak, a pale lit edge and dark specks.
  function rockArt(w, h, seed) {
    return art(w, h, (x, y) => {
      const t = (h - y) / h, tier = Math.floor((h - y) / 1.9), tq = tier * 1.9 / h;
      const half = w / 2 * Math.pow(Math.max(0, 1 - tq), 0.8) * (0.93 + 0.12 * hash2(tier, seed));
      const cx = w / 2 + (hash2(tier * 7, seed) - 0.5) * 0.9, rel = (x - cx) / Math.max(0.5, half);
      if (Math.abs(rel) > 1 || t > 0.96) return null;
      if (hash2(Math.floor(x * 3), Math.floor(y * 3) + seed * 77) < 0.06 && Math.abs(rel) < 0.7) return '#5a3c0e';
      if (rel > 0.8) return '#f4d47c';
      if (rel > 0.6) return '#8a6418';
      if (((h - y) % 1.9) < 0.38) return t > 0.6 ? '#b4a034' : '#e4ac40';
      if (t > 0.62) return rel < 0 ? '#8c7c20' : '#a8962c';
      return rel < -0.35 ? '#b47e20' : '#cc922a';
    });
  }
  const ROCK_S = rockArt(9, 9, 3), ROCK_L = rockArt(13, 14, 11);

  const BOULDER = Array.from({ length: 8 }, (_, f) => art(11, 11, (x, y) => {
    const dx = x - 5.5, dy = y - 5.5, d = Math.hypot(dx, dy) + (noise1(Math.atan2(dy, dx) * 2.2 + 9, 5, 14) - 0.5) * 0.9;
    if (d > 5.3) return null;
    const a = Math.atan2(dy, dx) + f * Math.PI / 4;
    if (Math.abs(Math.sin(a * 1.5)) < 0.09 && d > 1.6 && d < 4.6) return '#4e3410';
    const lit = -dx * 0.55 - dy * 0.8;
    if (d > 4.6) return lit > 0 ? '#e8b850' : '#6e4a14';
    return lit > 2.4 ? '#f4d47c' : lit > 0 ? '#cc922a' : lit > -2.4 ? '#a87420' : '#7e5418';
  }));

  const MINE = [0, 1].map(f => art(8, 4, (x, y) => {
    const dx = x - 4;
    if (y > 1.4 && Math.abs(dx) < 3.9) return y > 3.2 ? '#3a3e48' : dx < -1 ? '#c0c6d0' : '#8a92a0';
    if (Math.hypot(dx, y - 1.6) < 1.3) return f ? '#ff3020' : '#701010';
    return null;
  }));

  // Tank (faces left, towards the buggy).
  const TANK = art(19, 11, (x, y) => {
    if (box(x, y, 0, 3, 7, 4.4)) return y < 3.5 ? '#e8eef6' : '#8a96a8';                         // barrel
    if (inPoly([[7, 1.2], [9, 0.4], [13.5, 0.4], [15, 2], [15, 5.2], [6.8, 5.2]], x, y)) return y < 1.4 ? '#9ec4ff' : x < 9 ? '#5c8ef0' : '#2c5ad8';
    if (inPoly([[2.5, 5.2], [17.5, 5.2], [18.6, 7], [1.6, 7]], x, y)) return y < 5.8 ? '#9ec4ff' : '#3a66e0';
    if (y >= 7 && y < 10.8 && x > 1.4 && x < 17.8) {
      const wx = ((x - 1.4) % 3.3) - 1.65, wy = y - 8.9;
      if (Math.hypot(wx, wy) < 1.2) return Math.hypot(wx, wy) < 0.5 ? '#c0c6d0' : '#6a7080';
      return '#22242c';
    }
    return null;
  });

  // Rocket car that charges in from behind.
  const ROCKET = [0, 1].map(f => art(26, 9, (x, y) => {
    if (x < 5 && Math.abs(y - 4.6) < (f ? 2.2 : 1.6) - x * 0.25) return x < 2.5 ? '#fff3a0' : C.red;          // exhaust
    if (inPoly([[5, 2.4], [16, 2.4], [22, 4], [25.6, 5.6], [25.6, 6.6], [5, 6.6]], x, y)) {
      if (box(x, y, 11, 2.4, 15.6, 4.2)) return C.cab;
      return y < 3.2 ? '#ffffff' : y > 5.8 ? '#a8aebc' : '#e4e8f0';
    }
    if (box(x, y, 7, 4.6, 22, 5.4)) return C.red;
    for (const cx of [8, 20]) if (Math.hypot(x - cx, y - 7) < 1.8) return Math.hypot(x - cx, y - 7) < 0.7 ? '#c0c6d0' : C.ink;
    return null;
  }));

  // Explosions: spiky red/yellow bursts; ground blasts add a cloud of grey smoke.
  function blastFrames(seed, ground) {
    const r = mulberry32(seed);
    const rays = Array.from({ length: ground ? 11 : 16 }, (_, i) => ground
      ? { a: -Math.PI * (0.1 + (i + r() * 0.6) / 11 * 0.8), l: 0.5 + r() * 0.5, w: 0.1 + r() * 0.08 }
      : { a: r() * TAU, l: 0.55 + r() * 0.45, w: 0.12 + r() * 0.12 });
    const dots = Array.from({ length: 40 }, () => ({ a: r() * TAU, d: r(), c: ['#ffffff', C.yellow, C.red, '#9a0c0c', '#f25cf0'][Math.floor(r() * 5)] }));
    return Array.from({ length: 7 }, (_, f) => {
      const k = (f + 1) / 7, R = (ground ? 14 : 10) * Math.min(1, k * 1.6), fade = f > 3;
      return art(22, 22, (x, y) => {
        const dx = x - 11, dy = y - (ground ? 15 : 11), d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (ground) {
          const puffs = [[-4.5, 4.4], [-1.5, 3.4], [1.8, 3.6], [4.6, 4.6], [0, 5.2]];
          const rad = (1.4 + 2.2 * k) * (fade ? 1 - (f - 3) * 0.1 : 1);
          for (const [cx, cy] of puffs) {
            const pd = Math.hypot(dx - cx * (0.6 + k * 0.6), (dy - cy + 1.6) * 1.15);
            if (pd < rad && dy > -1.5) return dx - cx < -rad * 0.3 && dy - cy < 0 ? '#eef0f6' : pd > rad * 0.75 ? '#9aa2b4' : C.smoke;
          }
        }
        for (const ray of rays) {
          let da = Math.abs(a - ray.a); da = Math.min(da, TAU - da);
          if (da < ray.w * (1 - (ground ? 0.65 : 1) * d / (R * ray.l + 0.01)) && d < R * ray.l && !(fade && d < R * 0.35 * (f - 3))) {
            if (ground) return d < R * ray.l * 0.55 ? (f < 2 ? '#fffaa0' : C.yellow) : d < R * ray.l * 0.8 ? '#c81010' : '#7a0808';
            return d < R * ray.l * 0.4 ? (f < 2 ? '#ffffff' : C.yellow) : d < R * ray.l * 0.75 ? '#e05010' : '#9a0c0c';
          }
        }
        if (!ground && !fade) for (const p of dots) {
          const px = Math.cos(p.a) * p.d * R, py = Math.sin(p.a) * p.d * R;
          if (Math.abs(dx - px) < 0.6 && Math.abs(dy - py) < 0.6) return p.c;
        }
        if (d < R * 0.3 && f < 3) return f ? C.yellow : '#ffffff';
        return null;
      });
    });
  }
  const BLAST_AIR = blastFrames(41, false), BLAST_GROUND = blastFrames(77, true);

  // ---------------------------------------------------------------- backdrops (2 px per arcade pixel)
  const BG = {};
  const MOUNT_H = 112, HILL_H = 84;

  // Teal peaks with jagged deep-blue shading on their faces and in blotches near the summits.
  function paintMountains() {
    const w = 512, h = MOUNT_H, r = mulberry32(17), n = w * DB;
    const spikes = Array.from({ length: 34 }, () => {
      const hh = 20 + Math.pow(r(), 1.6) * 74;
      return { c: r() * w, h: hh, hw: hh * (0.22 + r() * 0.3) };
    });
    const prof = new Float32Array(n + 2);
    for (let i = 0; i <= n + 1; i++) {
      const x = i / DB;
      let p = 18 + 8 * noise1(x / 21, 3, w / 21);
      for (const s of spikes) {
        let d = Math.abs(x - s.c); d = Math.min(d, w - d);
        p = Math.max(p, s.h - d * s.h / s.hw);
      }
      prof[i] = p + (noise1(x * 0.7, 9, w * 0.7) - 0.5) * 5 + (noise1(x * 2.1, 4, Math.round(w * 2.1)) - 0.5) * 2;
    }
    return art(w, h, (x, y) => {
      const i = Math.min(n, Math.floor(x * DB)), p = prof[i], yb = h - y;
      if (yb > p) return null;
      const depth = p - yb, slope = prof[Math.min(n + 1, i + 2)] - prof[Math.max(0, i - 2)];
      const nz = noise2(x / 2.6, y / 3.2, 5, Math.round(w / 2.6));
      if (depth < 0.9 && slope > 0) return C.tealHi;
      if (slope < -0.2 && depth < 2.5 + nz * 9) return C.blue;
      if (yb > 40 && nz > 0.78 && noise2(x / 1.6, y / 2, 8, Math.round(w / 1.6)) > 0.5) return C.blue;
      if (depth < 1.2 + nz * 2.5 && slope < 0.1) return C.blue;
      return C.teal;
    }, DB);
  }

  // Rolling green hills, with dark ridge lines and streaks on the slopes facing away from the sun.
  function paintHills() {
    const w = 512, h = HILL_H, n = w * DB;
    const P = x => TAU * x / w;
    const back = new Float32Array(n + 2), front = new Float32Array(n + 2);
    for (let i = 0; i <= n + 1; i++) {
      const x = i / DB;
      back[i] = 50 + 16 * Math.sin(P(x) * 3 + 1) + 9 * Math.sin(P(x) * 7 + 2.2) + 4 * (noise1(x / 9, 6, w / 9) - 0.5);
      front[i] = 26 + 15 * Math.sin(P(x) * 2 + 0.3) + 9 * Math.sin(P(x) * 5 + 4) + 5 * Math.sin(P(x) * 11 + 1) + 2 * (noise1(x / 6, 2, w / 6) - 0.5);
    }
    const shade = (prof, i, yb, x, y, seed) => {
      const slope = prof[Math.min(n + 1, i + 2)] - prof[Math.max(0, i - 2)], depth = prof[i] - yb;
      const streak = ((x * 0.5 + y + 6 * noise1(x / 7, seed + 4, w / 7)) % 9) < 1.3 && noise2(x / 3, y / 3, seed, Math.round(w / 3)) > 0.62;
      if (slope < -0.25 && depth < 3 + 10 * noise2(x / 6, y / 5, seed + 1, Math.round(w / 6))) return C.greenLo;
      if (depth < 22 && streak) return C.greenLo;
      if (depth < 0.8 && slope > 0.1) return C.greenHi;
      return C.green;
    };
    return art(w, h, (x, y) => {
      const i = Math.min(n, Math.floor(x * DB)), yb = h - y;
      if (yb <= front[i]) return Math.abs(front[i] - yb) < 0.9 && front[i] < back[i] - 1 ? C.greenLo : shade(front, i, yb, x, y, 3);
      if (yb <= back[i]) return shade(back, i, yb, x, y, 11);
      return null;
    }, DB);
  }

  // The alien city: bulbous green towers with yellow lit edges and rows of dark windows.
  function paintCity() {
    const w = 512, h = HILL_H, r = mulberry32(4242), towers = [];
    for (let x = 8; x < w - 8; x += 22 + r() * 22) {
      const H = 34 + r() * 42, bulbs = [];
      let y = 0, rad = 9 + r() * 5;
      while (y < H - 4) {
        const rr = Math.max(3.4, rad * (0.7 + r() * 0.45));
        bulbs.push({ y: y + rr * 0.9, rx: rr, ry: rr * (0.8 + r() * 0.5) });
        y += rr * 1.5; rad *= 0.82;
      }
      towers.push({ x, H: y, bulbs, stem: 2.4 + r() * 1.6, ant: r() < 0.6 });
    }
    return art(w, h, (x, y) => {
      const yb = h - y, base = 7 + 3 * Math.sin(TAU * x / w * 9);
      if (yb < base) return yb > base - 1.4 ? C.greenHi : C.green;
      for (const t of towers) {
        const dx = x - t.x;
        if (Math.abs(dx) > 18) continue;
        if (t.ant && Math.abs(dx) < 0.45 && yb > t.H && yb < t.H + 8) return '#c8f0c8';
        if (t.ant && Math.hypot(dx, yb - t.H - 8.5) < 1.1) return C.red;
        for (const b of t.bulbs) {
          const ex = dx / b.rx, ey = (yb - b.y) / b.ry;
          if (ex * ex + ey * ey <= 1) {
            if (ex < -0.72 + ey * ey * 0.3) return C.yellow;
            if (ex > 0.76) return C.greenLo;
            if (Math.abs(ey) < 0.55 && Math.abs(ex) < 0.62 && (yb - b.y + 30) % 2.2 < 0.75 && (dx + 40) % 1.8 < 1.1) return '#06301a';
            return C.green;
          }
        }
        if (Math.abs(dx) < t.stem && yb < t.H) return dx < -t.stem + 0.8 ? C.yellow : C.green;
      }
      return null;
    }, DB);
  }

  // Ground texture: the arcade's flat peach, with faint strata, grit and pebbles.
  function paintGround() {
    const w = 256, h = H - GROUND_Y + 14, r = mulberry32(77);
    const pebbles = Array.from({ length: 90 }, () => ({ x: r() * w, y: 3 + r() * (h - 4), r: 0.35 + r() * r() * 1.3 }));
    return art(w, h, (x, y) => {
      for (const p of pebbles) {
        let dx = x - p.x; if (dx > w / 2) dx -= w; if (dx < -w / 2) dx += w;
        const dy = y - p.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) continue;
        const d = Math.hypot(dx, dy * 1.4);
        if (d < p.r) return dx + dy < -p.r * 0.4 ? C.peachHi : dx + dy > p.r * 0.5 ? C.dirt : C.peachLo;
        if (d < p.r + 0.45 && dy > 0) return '#e88f52';
      }
      const g = hash2(Math.floor(x * D), Math.floor(y * D) + 999);
      if (g < 0.018) return C.peachLo;
      if (g > 0.988) return C.peachHi;
      const strata = noise2(x / 26, y / 2.2, 4, Math.round(w / 26));
      return strata > 0.68 ? '#fb9e5c' : strata < 0.18 ? '#ffac6c' : C.peach;
    });
  }

  function buildLayers() {
    BG.mountains = paintMountains();
    BG.hills = paintHills();
    BG.city = paintCity();
    BG.ground = paintGround();
  }

  // ---------------------------------------------------------------- terrain
  // Rolling, lumpy lunar road: long swells, medium undulation and small bumps.
  function surfRaw(wx) {
    const swell = 6 * Math.sin(wx * 0.0093 + 0.7) * Math.max(0, Math.sin(wx * 0.0019 + 1.2));
    return GROUND_Y - swell - 2.2 * Math.sin(wx * 0.029 + 1.1) - 1.2 * Math.sin(wx * 0.077 + 0.3)
      - 1.3 * (noise1(wx / 4.5, 21) - 0.5) - 0.6 * (noise1(wx / 1.6, 22) - 0.5);
  }
  // Craters throw up a lip of ejecta on each side; wheels bounce over it.
  function rim(wx) {
    let v = 0;
    for (const c of G.craters) {
      if (wx < c.x - 8 || wx > c.x + c.w + 8) continue;
      const k = c.small ? 1.3 : 2.4;
      v += k * Math.exp(-(((wx - c.x + 1.6) / 2.6) ** 2)) + k * Math.exp(-(((wx - c.x - c.w - 1.6) / 2.6) ** 2));
    }
    return v;
  }
  const groundAt = wx => surfRaw(wx) - rim(wx);

  // Steep, broken walls and a rubble-strewn floor.
  function craterDepth(c, t) {
    const bowl = Math.pow(Math.max(0, 1 - Math.abs(2 * t - 1) ** 1.8), 0.6);
    return Math.max(0.6, c.depth * bowl + (noise1(t * c.w * 0.8, c.seed) - 0.5) * 2.2 * bowl);
  }

  // The visible surface: the road with every pit cut into it.
  function surfaceVis(wx) {
    let y = groundAt(wx);
    for (const c of G.craters) if (wx > c.x && wx < c.x + c.w) y += craterDepth(c, (wx - c.x) / c.w);
    return y;
  }

  // ---------------------------------------------------------------- state
  const G = {
    mode: 'attract', state: 'title', timer: 600, frame: 0, paused: false, demo: false,
    score: 0, hi: 0, lives: 3, nextExtra: 0, course: 0, cp: 0,
    dist: 0, speed: SPEED_BASE, segFrames: 0, genSeg: 0, nextFree: 0, fireHold: 0,
    theme: 0, prevTheme: 0, themeT: 0, lastDeath: '', sink: 0,
    buggy: null, craters: [], obs: [], shells: [], triggers: [], ufos: [], bombs: [], ups: [], fwd: null,
    parts: [], texts: [], debris: [], booms: [], wave: null, squad: null, panel: null, rocket: null,
  };
  let scores = Store.load('lp_classic_scores', DEFAULT_SCORES.slice());
  const records = Store.load('lp_classic_records', {});
  G.hi = scores[0].score;

  const Input = { held: {}, hit: {} };
  function press(a) { if (!Input.held[a]) Input.hit[a] = true; Input.held[a] = true; }
  function release(a) { Input.held[a] = false; }
  function releaseAll() { Input.held = {}; }

  const newBuggy = () => ({ x: 52, air: false, cy: 0, vy: 0, wy: [0, 0, 0], wv: [0, 0, 0], spin: 0 });
  function settleBuggy() {
    const b = G.buggy;
    for (let i = 0; i < 3; i++) { b.wy[i] = groundAt(G.dist + b.x + WX[i]) - WR; b.wv[i] = 0; }
  }
  const themeFor = cp => CHECKPOINTS.indexOf(cp) % 2;

  function clearField() {
    G.buggy = newBuggy();
    G.craters = []; G.obs = []; G.shells = []; G.triggers = []; G.ufos = []; G.bombs = [];
    G.ups = []; G.fwd = null; G.parts = []; G.texts = []; G.debris = []; G.booms = [];
    G.wave = null; G.squad = null; G.panel = null; G.rocket = null; G.segFrames = 0; G.sink = 0;
    settleBuggy();
  }

  function resetField(cp) {
    clearField();
    G.cp = cp; G.speed = SPEED_BASE;
    G.dist = letterX(cp) - 30 - G.buggy.x;
    G.genSeg = cp; G.nextFree = 0;
    G.theme = G.prevTheme = themeFor(cp); G.themeT = 0;
    ensureGenerated();
    settleBuggy();
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
  let craterSeed = 1;
  const addCrater = (x, w, small = false) => {
    G.craters.push({ x, w, depth: small ? 6 : Math.min(13, 6 + w / 3.2), passed: false, small, seed: craterSeed++ });
    return w;
  };

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
        case 'craterS': used = addCrater(x, 12 + Math.floor(r() * 5)); break;
        case 'craterL': used = addCrater(x, 19 + Math.floor(r() * 7)); break;
        case 'rockS': G.obs.push({ type: 'rock', x, big: false }); used = 10; break;
        case 'rockL': G.obs.push({ type: 'rock', x, big: true }); used = 14; break;
        case 'mine': G.obs.push({ type: 'mine', x }); used = 8; break;
        case 'boulder': G.obs.push({ type: 'boulder', x: x + 40, rot: 0 }); used = 54; break;
        case 'tank': G.obs.push({ type: 'tank', x, cd: 50 }); tanks++; used = 20; break;
        case 'craterRock': {
          G.obs.push({ type: 'rock', x, big: false });
          const off = 112 + Math.floor(r() * 24);
          used = off + addCrater(x + off, 12 + Math.floor(r() * 5));
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
      G.triggers.push({ kind: 'wave', x: letterX(s) + SEG * (0.15 + r() * 0.3), type, n: 2 + Math.floor(r() * 2) + (d > 0.5 ? 1 : 0) + (d > 0.85 ? 1 : 0), used: false });
    }
    // The rocket car charges from behind a few times on later stretches.
    if ((G.course > 0 ? s >= 2 : s >= 10) && s % 5 === 2) G.triggers.push({ kind: 'rocket', x: letterX(s) + SEG * 0.55, used: false });
  }

  function ensureGenerated() {
    while (G.genSeg <= 24 && letterX(G.genSeg) < G.dist + W + 120) genSegment(G.genSeg++);
  }

  // ---------------------------------------------------------------- geometry
  const bodyY = () => (G.buggy.wy[0] + G.buggy.wy[2]) / 2;
  const bodyAngle = () => clamp(Math.atan2(G.buggy.wy[2] - G.buggy.wy[0], WX[2] - WX[0]), -0.4, 0.4);
  function buggyBox() {
    const b = G.buggy, y = bodyY();
    return { x: b.x + 2.5, y: y - 9, w: 27.5, h: Math.max(...b.wy) + WR - 1.2 - (y - 9) };
  }
  const OBS_SIZE = { rock: [9, 9], rockBig: [13, 14], mine: [8, 4], tank: [19, 11], boulder: [11, 11] };
  const obsSize = o => OBS_SIZE[o.type === 'rock' && o.big ? 'rockBig' : o.type];
  function obsBox(o) {
    const [w, h] = obsSize(o);
    return { x: o.x - G.dist, y: groundAt(o.x + w / 2) + 1 - h, w, h };
  }
  const ufoBox = u => ({ x: u.x - u.w / 2, y: u.y - u.h / 2, w: u.w, h: u.h });

  // ---------------------------------------------------------------- effects
  function boom(x, y, ground = false) { G.booms.push({ x, y, t: 0, ground }); }
  function spark(x, y, n, cols, spd, ground = false, grav = 0.06) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 0.3 + Math.random() * spd;
      G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.4, g: grav, life: 18 + Math.random() * 22, c: cols[Math.floor(Math.random() * cols.length)], ground });
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

  // Arcade rules: 1,000 points for beating the average time plus 100 per second under it,
  // and 5,000 more for completing the course at Z.
  function reachCheckpoint(n) {
    const secs = Math.floor(G.segFrames / 60);
    const avg = Math.round((n - G.cp) * SEG / (SPEED_BASE * 60) * 1.1);
    const key = G.course + '-' + n;
    if (!G.demo && (records[key] === undefined || secs < records[key])) { records[key] = secs; Store.save('lp_classic_records', records); }
    const bonus = (secs <= avg ? 1000 + (avg - secs) * 100 : 0) + (n === 25 ? 5000 : 0);
    addScore(bonus);
    G.panel = { letter: LETTERS[n], secs, avg, rec: records[key] ?? secs, bonus, t: 0, final: n === 25 };
    G.cp = n; G.segFrames = 0;
    if (n < 25) { G.prevTheme = G.theme; G.theme = themeFor(n); G.themeT = 120; }
    for (const u of G.ufos) u.leaving = true;
    for (const bm of G.bombs) boom(bm.x, bm.y);
    G.bombs = []; G.shells = []; G.wave = null; G.squad = null; G.rocket = null;
    AudioSys.sfx.checkpoint();
  }

  function die(cause) {
    if (G.state !== 'play') return;
    G.lastDeath = cause;
    G.state = 'dying'; G.timer = 180;
    AudioSys.stopMusic();
    G.fwd = null; G.ups = [];
    for (const u of G.ufos) u.leaving = true;
    G.wave = null; G.rocket = null;
    if (cause === 'crater') { G.sink = 24; AudioSys.sfx.land(); } else explodeBuggy();
  }

  function explodeBuggy() {
    const b = G.buggy, y = bodyY();
    AudioSys.sfx.bigBoom();
    boom(b.x + 8, y - 2, true); boom(b.x + 22, y, true);
    spark(b.x + 16, y - 4, 30, ['#ffffff', C.yellow, C.red, C.mag, C.magHi], 2.2);
    G.debris = WX.map((wx, i) => ({ x: b.x + wx, y: b.wy[i], vx: (i - 1) * 0.8 + (Math.random() - 0.5) * 0.5, vy: -2.4 - Math.random() * 1.5, f: 0 }));
    G.debris.push({ body: true, x: b.x + 16, y: y - 4, vx: 0.3, vy: -1.8, a: 0, va: 0.08 });
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
    const front = G.dist + b.x + WX[2] + 2;
    for (const c of G.craters) { const d = c.x - front; if (d > -1 && d < 4) inp.jump = true; }
    for (const o of G.obs) {
      const d = obsBox(o).x - (b.x + 32);
      if (o.type === 'mine') { if (d > 3 && d < 9) inp.jump = true; }
      else {
        if (d > 0 && d < 90 && G.frame % 6 === 0) inp.fire = true;
        if (d > 1 && d < (o.big ? 9 : 6)) inp.jump = true;
      }
    }
    for (const s of G.shells) {
      const d = s.x - G.dist - (b.x + 32);
      if (d > 0 && d < 100 && G.frame % 6 === 0) inp.fire = true;
      if (d > 2 && d < 14) inp.jump = true;
    }
    if (G.rocket && G.rocket.phase === 'dash' && b.x - (G.rocket.x + 26) < 26) inp.jump = true;
    if (G.ufos.length && G.frame % 14 === 0) inp.fire = true;
    const wide = G.craters.some(c => c.w > 16 && c.x - front > -c.w && c.x - front < 140);
    for (const bm of G.bombs) {
      const t = (GROUND_Y - bm.y) / Math.max(0.4, bm.vy + 0.5);
      if (bm.x > b.x - 4 && bm.x < b.x + 36 && t < 70) { if (bm.x > b.x + 18 && !wide) inp.left = true; else inp.right = true; }
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
    updateBuggy(G.buggy, 0.7);
    if (--G.timer <= 0) {
      if (G.state === 'title') { G.state = 'points'; G.timer = 480; }
      else if (G.state === 'points') startDemo();
      else { G.state = 'title'; G.timer = 600; }
    }
  }

  function updateReady() {
    updateBuggy(G.buggy, 0);
    if (--G.timer <= 0) { G.state = 'play'; AudioSys.startMusic('classic'); }
  }

  // Each wheel rides its own shock absorber and follows the bumps; the body pitches with them.
  function updateBuggy(b, speed) {
    for (let i = 0; i < 3; i++) {
      const g = groundAt(G.dist + b.x + WX[i]) - WR;
      if (b.air) {
        b.wv[i] += (b.cy + 1.8 - b.wy[i]) * 0.35; b.wv[i] *= 0.6; b.wy[i] += b.wv[i];
        if (b.wy[i] > g) { b.wy[i] = g; b.wv[i] = 0; }
      } else {
        b.wv[i] += (g - b.wy[i]) * 0.42; b.wv[i] *= 0.64; b.wy[i] += b.wv[i];
        if (b.wy[i] > g + 0.5) { b.wy[i] = g + 0.5; b.wv[i] = Math.min(0, b.wv[i]); }
        if (speed > 0 && Math.random() < 0.01 * speed) b.wv[i] -= 0.4 + Math.random() * 0.4;
      }
    }
    b.spin += speed / WR;
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
      b.air = true; b.cy = (b.wy[0] + b.wy[1] + b.wy[2]) / 3; b.vy = -JUMP_V; AudioSys.sfx.jump();
      for (let i = 0; i < 3; i++) b.wv[i] = -JUMP_V * (0.85 + i * 0.05);
    }
    if (b.air) {
      b.vy += GRAV; b.cy += b.vy;
      const g = WX.reduce((s, x) => s + groundAt(G.dist + b.x + x), 0) / 3 - WR;
      if (b.vy > 0 && b.cy >= g) {
        b.air = false; AudioSys.sfx.land();
        for (let i = 0; i < 3; i++) b.wv[i] += 1.3;
      }
    }
    updateBuggy(b, G.speed);
    if (inp.fire) fire();

    updateShots();
    updateObstacles();
    updateShells();
    updateWaves();
    updateRocket();
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
    const b = G.buggy, y = bodyY(), a = bodyAngle();
    let shot = false;
    if (!G.fwd) { G.fwd = { x: b.x + 33, x0: b.x + 33, y: y - 6 + a * 17 }; shot = true; }
    if (G.ups.length < 4) { G.ups.push({ x: b.x + 9.8, y: y - 16 - a * 6 }); shot = true; }
    if (shot) AudioSys.sfx.fire();
  }

  function updateShots() {
    const f = G.fwd;
    if (f) {
      // The cannon shell skims the surface at a fixed height, so it climbs and dips with the road.
      f.x += 3.4;
      f.y += (groundAt(G.dist + f.x + 7) - 6.5 - f.y) * 0.35;
      if (f.x - f.x0 > 120 || f.x > W) { G.fwd = null; boom(f.x + 7, f.y + 1); }
    }
    for (const u of G.ups) u.y -= 4.2;
    G.ups = G.ups.filter(u => u.y > HUD_H);
  }

  function updateObstacles() {
    const bx = G.buggy.x;
    for (const o of G.obs) {
      const sx = o.x - G.dist;
      if (o.type === 'boulder' && sx < ENGAGE) { o.x -= 0.45; o.rot = (o.rot || 0) + 0.09; }
      if (o.type === 'tank' && sx < ENGAGE && sx > bx + 36) {
        if (--o.cd <= 0) {
          G.shells.push({ x: o.x - 2 });
          o.cd = 100 + Math.floor(Math.random() * 60);
          AudioSys.sfx.tank();
        }
      }
    }
  }

  const shellBox = s => ({ x: s.x - G.dist, y: groundAt(s.x) - 7.5, w: 4, h: 2 });
  function updateShells() {
    for (const s of G.shells) s.x -= 1.5;
    G.shells = G.shells.filter(s => s.x - G.dist > -10);
  }

  function updateWaves() {
    const ahead = G.dist + W * 0.5;
    for (const t of G.triggers) {
      if (t.used || t.x > ahead) continue;
      if (t.kind === 'rocket') {
        if (G.rocket) continue;
        t.used = true;
        G.rocket = { x: -28, phase: 'wait', t: 0 };
        AudioSys.sfx.alarm();
      } else if (!G.wave && !G.ufos.length) {
        t.used = true;
        G.wave = { type: t.type, left: t.n, cd: 0 };
        G.squad = { size: t.n, killed: 0 };
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

  // Rocket car: waits behind the buggy, then charges along the ground. Jump it.
  function updateRocket() {
    const r = G.rocket;
    if (!r) return;
    r.t++;
    if (r.phase === 'wait') { r.x += (2 - r.x) * 0.05; if (r.t > 70) { r.phase = 'dash'; AudioSys.sfx.go(); } }
    else r.x += 3.6;
    if (r.x > W + 30) G.rocket = null;
  }
  const rocketBox = r => ({ x: r.x + 6, y: groundAt(G.dist + r.x + 14) - 8, w: 19, h: 7 });

  function spawnUfo(type, i) {
    const [w, h] = type === 3 ? [15, 12] : [19, 9];
    G.ufos.push({
      type, w, h, x: -12 - i * 6, y: HUD_H + 14 + (i % 3) * 10, vx: 1.6, vy: 0.2,
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
        // Weaving arcade flight: pick a point near the buggy, dart to it, repeat.
        if (Math.hypot(u.tx - u.x, u.ty - u.y) < 4 || u.f % 90 === 0) {
          const spread = u.type === 3 ? 70 : 110;
          u.tx = clamp(b.x + 16 + (Math.random() - 0.35) * spread * 2, 14, Math.min(W, ENGAGE + 20) - 14);
          u.ty = HUD_H + 10 + Math.random() * (u.type === 2 ? 64 : 50);
        }
        const sp = u.type === 3 ? 1.2 : u.type === 2 ? 1.6 : 1.4;
        u.vx += clamp(u.tx - u.x, -sp, sp) * 0.06; u.vy += clamp(u.ty - u.y, -sp, sp) * 0.06;
        u.vx *= 0.9; u.vy *= 0.9;
        if (--u.cd <= 0 && G.state === 'play' && u.y < GROUND_Y - 60) dropBomb(u);
      }
      u.x += u.vx; u.y += u.vy;
    }
    G.ufos = G.ufos.filter(u => u.y > HUD_H - 20 && u.x > -40 && u.x < W + 40);
  }

  function dropBomb(u) {
    const b = G.buggy;
    if (u.type === 3) {
      // Grenade lobbed onto the road ahead of the buggy; it blasts a fresh crater.
      const target = b.x + 50 + Math.random() * 60, t = Math.sqrt(2 * (GROUND_Y - u.y) / 0.03);
      G.bombs.push({ x: u.x, y: u.y + 4, vx: clamp((target - u.x) / t, -1.2, 1.4), vy: -0.4, g: 0.03, grenade: true });
      u.cd = 110 + Math.floor(Math.random() * 60);
    } else {
      // Bombs fall towards where the buggy is heading; the second saucer aims better.
      const lead = u.type === 2 ? 1 : 0.4, t = (GROUND_Y - u.y) / 1.2;
      const aim = b.x + 16 + (G.speed - SPEED_BASE) * t * lead * 0.5;
      G.bombs.push({ x: u.x, y: u.y + 4, vx: clamp((aim - u.x) / t * lead, -0.6, 0.6), vy: 0.4, g: 0.02 });
      u.cd = (u.type === 2 ? 60 : 85) + Math.floor(Math.random() * 70);
    }
    AudioSys.sfx.bomb();
  }

  function updateBombs() {
    for (const bm of G.bombs) {
      bm.vy = Math.min(1.7, bm.vy + bm.g); bm.y += bm.vy; bm.x += bm.vx;
      const g = groundAt(G.dist + bm.x);
      if (bm.y >= g - 2) {
        bm.dead = true;
        boom(bm.x, g - 1, true);
        AudioSys.sfx.boom();
        if (bm.grenade) addBombCrater(G.dist + bm.x);
      }
    }
    G.bombs = G.bombs.filter(bm => !bm.dead);
  }

  function addBombCrater(wx) {
    const w = 10, x = Math.round(wx - w / 2);
    // Keep a clear landing strip between pits, and keep clear of rocks and mines.
    if (G.craters.some(c => x < c.x + c.w + 72 && x + w + 72 > c.x)) return;
    if (G.obs.some(o => x < o.x + 60 && x + w + 60 > o.x)) return;
    // Never open a pit under the buggy or too close in front of it to react.
    const bx = G.dist + G.buggy.x;
    if (x < bx + 33 + 28 && x + w > bx - 4) return;
    G.craters.push({ x, w, depth: 6, passed: false, small: true, seed: craterSeed++, fresh: 40 });
  }

  function updateEffects(scroll = G.speed) {
    for (const p of G.parts) { p.vy += p.g; p.x += p.vx - (p.ground ? scroll : 0); p.y += p.vy; p.life--; }
    G.parts = G.parts.filter(p => p.life > 0 && p.y < H);
    for (const bm of G.booms) { bm.t++; if (bm.ground) bm.x -= scroll; }
    G.booms = G.booms.filter(bm => bm.t < 28);
    for (const t of G.texts) { t.life--; t.y -= 0.25; if (t.ground) t.x -= scroll; }
    G.texts = G.texts.filter(t => t.life > 0);
    for (const c of G.craters) if (c.fresh) c.fresh--;
  }

  function hitObstacle(o) {
    const bx = obsBox(o), cx = bx.x + bx.w / 2, cy = bx.y + bx.h;
    if (o.type === 'rock' && o.big) { o.big = false; boom(cx, cy, true); spark(cx, cy - 6, 8, ['#cc922a', '#f4d47c', '#8c7c20'], 1.2, true); addScore(50, cx, cy - 16, true); AudioSys.sfx.hit(); return; }
    o.dead = true;
    boom(cx, cy, true); spark(cx, cy - 5, 10, o.type === 'tank' ? ['#5c8ef0', '#9ec4ff', C.yellow] : ['#cc922a', '#f4d47c', '#8c7c20'], 1.3, true);
    addScore({ tank: 200, boulder: 50 }[o.type] || 100, cx, cy - 16, true);
    AudioSys.sfx.boom();
  }

  function killUfo(u) {
    u.dead = true;
    boom(u.x, u.y);
    addScore(u.type === 3 ? 200 : 100, u.x, u.y);
    AudioSys.sfx.ufoKill();
    const sq = G.squad;
    if (sq && ++sq.killed === sq.size && sq.size >= 3) {
      addScore({ 3: 500, 4: 800, 5: 1000 }[Math.min(5, sq.size)], u.x, u.y + 10);
      G.squad = null;
    }
  }

  function collide() {
    const b = G.buggy, bb = buggyBox();
    // Cannon shell vs ground targets and tank shells (shells cancel each other out).
    if (G.fwd) {
      const fb = { x: G.fwd.x, y: G.fwd.y, w: 9, h: 3 };
      for (const o of G.obs) {
        if (o.dead || o.type === 'mine') continue;
        if (overlap(fb, obsBox(o))) { hitObstacle(o); G.fwd = null; break; }
      }
      if (G.fwd) for (const s of G.shells) {
        if (overlap(fb, shellBox(s))) { s.dead = true; G.fwd = null; boom(s.x - G.dist, groundAt(s.x) - 4, true); AudioSys.sfx.hit(); break; }
      }
    }
    // Anti-air shots vs saucers, bombs and grenades.
    for (const sh of G.ups) {
      const sb = { x: sh.x, y: sh.y, w: 1.4, h: 5 };
      for (const u of G.ufos) if (!u.dead && !u.leaving && overlap(sb, ufoBox(u))) { killUfo(u); sh.dead = true; break; }
      if (sh.dead) continue;
      for (const bm of G.bombs) if (!bm.dead && overlap(sb, { x: bm.x - 2.5, y: bm.y - 1, w: 5, h: 7 })) { bm.dead = true; sh.dead = true; boom(bm.x, bm.y); addScore(100, bm.x, bm.y); AudioSys.sfx.hit(); break; }
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
          const wx = G.dist + b.x + WX[i];
          if (wx > c.x + 2.5 && wx < c.x + c.w - 2.5) { die('crater'); return; }
        }
      }
    }
    for (const o of G.obs) if (overlap(bb, obsBox(o))) { die(o.type); return; }
    for (const s of G.shells) if (overlap(bb, shellBox(s))) { die('shell'); return; }
    for (const bm of G.bombs) if (overlap(bb, { x: bm.x - 1.5, y: bm.y, w: 3, h: 6 })) { die('bomb'); return; }
    if (G.rocket && G.rocket.phase === 'dash' && overlap(bb, rocketBox(G.rocket))) die('rocket');
  }

  function checkPasses() {
    const rear = G.dist + G.buggy.x;
    for (const c of G.craters) if (!c.passed && c.x + c.w < rear) { c.passed = true; addScore(50, c.x + c.w / 2 - G.dist, GROUND_Y - 30, true); }
    for (const o of G.obs) {
      if (o.passed || o.type === 'tank' || o.type === 'boulder') continue;
      const [w] = obsSize(o);
      if (o.x + w < rear) { o.passed = true; addScore(50, o.x + w / 2 - G.dist, GROUND_Y - 30, true); }
    }
  }

  function cleanup() {
    const cut = G.dist - 40;
    G.craters = G.craters.filter(c => c.x + c.w > cut);
    G.obs = G.obs.filter(o => o.x + 24 > cut);
  }

  function updateDying() {
    const b = G.buggy;
    if (G.sink > 0) {
      // Nose-dive into the pit before the blast.
      G.sink--;
      for (let i = 0; i < 3; i++) b.wy[i] += 0.3 + i * 0.12;
      if (G.sink === 0) explodeBuggy();
    }
    for (const d of G.debris) {
      d.vy += 0.12; d.x += d.vx; d.y += d.vy;
      if (d.body) {
        d.a += d.va;
        const fl = groundAt(G.dist + d.x) - 5;
        if (d.y > fl) { d.y = fl; d.vy *= -0.3; d.vx *= 0.6; d.va *= 0.5; }
        continue;
      }
      d.f += d.vx * 0.5;
      const floor = groundAt(G.dist + d.x) - WR;
      if (d.y > floor) { d.y = floor; d.vy *= -0.45; d.vx *= 0.7; if (Math.abs(d.vy) < 0.4) d.vy = 0; }
    }
    if (!G.sink && G.timer > 130 && G.timer % 12 === 0) boom(b.x + 4 + Math.random() * 24, bodyY() + Math.random() * 3, true);
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

  // ---------------------------------------------------------------- renderer
  // Logical coordinates are snapped to whole device pixels, so sprites keep hard edges at any scale.
  const DX = x => Math.round(x * SX), DY = y => Math.round(y * SY);
  function rect(x, y, w, h, col) {
    const X = DX(x), Y = DY(y);
    ctx.fillStyle = col; ctx.fillRect(X, Y, Math.max(1, DX(x + w) - X), Math.max(1, DY(y + h) - Y));
  }
  function blit(img, x, y, alpha = 1, scale = 1) {
    const X = DX(x), Y = DY(y);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(img, X, Y, DX(x + img.lw * scale) - X, DY(y + img.lh * scale) - Y);
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
    const w = img.lw;
    const off = -(((scroll % w) + w) % w);
    for (let x = off; x < W; x += w) blit(img, x, y, alpha);
  }

  function drawBackdrop() {
    rect(0, HUD_H, W, H - HUD_H, C.sky);
    const mY = GROUND_Y - 40 - MOUNT_H;
    strip(BG.mountains, G.dist * 0.1, mY);
    rect(0, mY + MOUNT_H - 0.5, W, 40, C.teal);
    const hY = GROUND_Y + 6 - HILL_H;
    const layer = th => th ? BG.city : BG.hills;
    if (G.themeT > 0) {
      const k = G.themeT / 120;
      strip(layer(G.prevTheme), G.dist * 0.32, hY, k);
      strip(layer(G.theme), G.dist * 0.32, hY, 1 - k);
    } else strip(layer(G.theme), G.dist * 0.32, hY);
    rect(0, hY + HILL_H - 0.5, W, H - hY - HILL_H + 1, C.green);   // behind dips in the road
  }

  // The road: a lumpy surface traced at fine resolution, filled with the ground texture.
  function drawGround() {
    const step = 1 / D;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(DX(-1), DY(H));
    for (let x = -1; x <= W + 1; x += step) ctx.lineTo(DX(x), DY(surfaceVis(G.dist + x)));
    ctx.lineTo(DX(W + 1), DY(H));
    ctx.closePath();
    ctx.clip();
    strip(BG.ground, G.dist, GROUND_Y - 12);
    ctx.restore();
    // Sunlit lip along the crest, and a little loose grit on the surface.
    for (let x = 0; x < W; x += step) {
      const wx = G.dist + x, g = surfaceVis(wx), s = groundAt(wx + 0.6) - groundAt(wx - 0.6);
      if (g - groundAt(wx) < 0.5) rect(x, g, step, step, s <= 0 ? C.peachHi : '#ffb67c');
    }
    const first = Math.floor(G.dist);
    for (let wx = first; wx < first + W + 2; wx++) {
      const hsh = hash2(wx, 7);
      if (hsh > 0.06) continue;
      const g = groundAt(wx + 0.5), sz = hsh < 0.02 ? 1.4 : 0.8;
      rect(wx - G.dist, g - sz + 0.3, sz, sz, C.peachLo);
      rect(wx - G.dist, g - sz + 0.3, sz * 0.5, step, C.peachHi);
    }
  }

  // Craters: the road drops into a ragged bowl, so the scenery shows through the pit. The near
  // slope is in shadow, the far slope catches the sun, loose rubble lies on the floor and clods of
  // ejecta sit on both lips. Fresh craters from grenades still smoke.
  function drawCraters() {
    const step = 1 / D;
    for (const c of G.craters) {
      const sx = c.x - G.dist;
      if (sx > W + 6 || sx + c.w < -6) continue;
      const n = Math.round(c.w * D);
      // Far inner wall, seen through the pit: sunlit at the rim, darker towards the floor, with the
      // near lip's shadow falling across its left side.
      const FAR = ['#e8955a', '#cf7a42', '#b0602e', '#8a4620', '#6a3214'];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = sx + i * step, wx = c.x + t * c.w;
        const top = groundAt(wx) - 0.6 - (noise1(wx * 1.3, c.seed + 3) - 0.3) * 1.1, bot = surfaceVis(wx);
        const h = bot - top;
        if (h <= 0) continue;
        const shadow = t < 0.55 ? Math.round((0.55 - t) * 6) : 0;
        for (let k = 0; k < FAR.length; k++) {
          const y0 = top + h * k / FAR.length;
          rect(x, y0, step, h / FAR.length + step, FAR[Math.min(FAR.length - 1, k + shadow)]);
        }
        if (t > 0.3) rect(x, top, step, step, '#ffd2a2');
        // Strata lines in the wall.
        for (let k = 1; k < 3; k++) {
          const y = top + h * (0.22 * k) + (noise1(wx * 0.7, c.seed + k * 9) - 0.5) * 1.2;
          if (y < bot - 1 && hash2(Math.floor(wx * 3), k + c.seed) > 0.25) rect(x, y, step, step, shadow ? '#7a3a18' : '#f0a466');
        }
      }
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = sx + i * step, wx = c.x + t * c.w;
        const y = surfaceVis(wx), slope = surfaceVis(wx + 0.5) - surfaceVis(wx - 0.5);
        if (slope > 0.05) {                               // near slope, facing away from the light
          rect(x, y, step, 1.6, '#a85628');
          rect(x, y + 1.6, step, 1.6, '#c86e38');
        } else if (slope < -0.05) {                       // far slope, sunlit
          rect(x, y, step, step, '#fff0d0');
          rect(x, y + step, step, 1.2, C.peachHi);
          rect(x, y + 1.2 + step, step, 1.4, '#ffb47a');
        } else {
          rect(x, y, step, 1.2, '#b86030');
        }
        // Shadow cast by the near lip across the floor.
        const shade = clamp(1 - t * 2.2, 0, 1);
        if (shade > 0) rect(x, y, step, 3 * shade + 0.6, 'rgba(70,24,4,0.55)');
      }
      // Rubble on the floor.
      for (let k = 0; k < c.w / 2.2; k++) {
        const t = 0.25 + hash2(k, c.seed) * 0.5, wx = c.x + t * c.w;
        const y = surfaceVis(wx), s = 0.6 + hash2(k + 9, c.seed) * 1.1;
        rect(sx + t * c.w, y - s * 0.7, s, s * 0.8, '#9a4c22');
        rect(sx + t * c.w, y - s * 0.7, s * 0.5, step, '#ffc896');
      }
      // Ejecta clods on the lips.
      for (const [edge, dir] of [[c.x, -1], [c.x + c.w, 1]]) {
        for (let k = 0; k < 6; k++) {
          const wx = edge + dir * (0.4 + hash2(k, c.seed + 50) * 5), g = groundAt(wx), s = 0.6 + hash2(k, c.seed + 60) * 0.9;
          rect(wx - G.dist, g - s * 0.6, s, s * 0.8, k % 2 ? '#d07a40' : '#e8935a');
          rect(wx - G.dist, g - s * 0.6, s * 0.5, step, C.peachHi);
        }
      }
      if (c.fresh) for (let k = 0; k < 6; k++) rect(sx + Math.random() * c.w, surfaceVis(c.x + c.w / 2) - 2 - Math.random() * (c.fresh / 4), 0.8, 0.8, C.smoke);
    }
  }

  function drawObstacles() {
    for (const o of G.obs) {
      const bx = obsBox(o);
      if (bx.x > W + 4 || bx.x + bx.w < -4) continue;
      if (o.type === 'rock') blit(o.big ? ROCK_L : ROCK_S, bx.x, bx.y);
      else if (o.type === 'mine') blit(MINE[(G.frame >> 4) & 1], bx.x, bx.y);
      else if (o.type === 'tank') blit(TANK, bx.x, bx.y);
      else if (o.type === 'boulder') blit(BOULDER[(8 - (Math.floor((o.rot || 0) * 4) & 7)) & 7], bx.x, bx.y);
    }
    for (const s of G.shells) {
      const sb = shellBox(s);
      rect(sb.x, sb.y, 2.4, 2, C.red); rect(sb.x + 2.4, sb.y + 0.5, 2.6, 1, C.yellow);
    }
    const r = G.rocket;
    if (r && (r.phase === 'dash' || (r.t >> 3) & 1)) blit(ROCKET[(G.frame >> 2) & 1], r.x, groundAt(G.dist + r.x + 14) - 9);
  }

  function drawBuggyAt(bx, wy, angle, spin) {
    const cy = (wy[0] + wy[2]) / 2;
    ctx.save();
    ctx.translate(DX(bx + 16), DY(cy));
    ctx.rotate(angle);
    ctx.drawImage(BUGGY, Math.round(-16 * SX), Math.round(-16 * SY), Math.round(33 * SX), Math.round(17 * SY));
    ctx.restore();
    const wf = Math.floor(spin / (Math.PI / 4) * 8) & 7;
    for (let i = 0; i < 3; i++) blit(WHEEL[wf], bx + WX[i] - 4, wy[i] - 4);
  }

  function drawBuggy() {
    const b = G.buggy;
    drawBuggyAt(b.x, b.wy, bodyAngle() + (G.state === 'dying' ? (24 - G.sink) * 0.02 : 0), b.spin);
  }

  function drawAir() {
    for (const u of G.ufos) {
      const img = (u.type === 1 ? UFO1 : u.type === 2 ? UFO2 : UFO3)[(u.f >> 3) & 1];
      blit(img, u.x - img.lw / 2, u.y - img.lh / 2);
    }
    for (const bm of G.bombs) {
      if (bm.grenade) blit(GRENADE[(G.frame >> 2) & 1], bm.x - 1.5, bm.y);
      else blit(BOMB[(G.frame >> 3) & 1], bm.x - 2.5, bm.y);
    }
    for (const s of G.ups) blit(UP_SHOT, s.x - 0.7, s.y);
    if (G.fwd) blit(FWD_SHOT, G.fwd.x, G.fwd.y);
  }

  function drawEffects() {
    for (const bm of G.booms) {
      const fr = (bm.ground ? BLAST_GROUND : BLAST_AIR)[clamp(bm.t >> 2, 0, 6)];
      blit(fr, bm.x - 11, bm.y - (bm.ground ? 19 : 11), bm.t > 24 ? 0.5 : 1);
    }
    for (const p of G.parts) rect(p.x, p.y, 0.8, 0.8, p.c);
    for (const t of G.texts) if ((t.life >> 2) & 1 || t.life > 30) text(t.text, t.x, t.y, '#ffffff', 'center', 6);
  }

  function drawDebris() {
    for (const d of G.debris) {
      if (!d.body) { blit(WHEEL[Math.floor(d.f) & 7], d.x - 4, d.y - 4); continue; }
      ctx.save();
      ctx.translate(DX(d.x), DY(d.y)); ctx.rotate(d.a);
      ctx.drawImage(BUGGY, Math.round(-16 * SX), Math.round(-12 * SY), Math.round(33 * SX), Math.round(17 * SY));
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- HUD (arcade layout)
  // Deep-blue band: high score and player score on the left; a cyan panel with POINT, TIME and
  // three warning lamps; the course map with the major checkpoints underneath.
  function drawHUD(field) {
    rect(0, 0, W, HUD_H, '#0618d4');
    const L = Math.max(0, Math.floor((W - 256) / 2));
    for (const [x, y, w, h] of [[4, 4, 9, 4], [4, 1, 1.6, 3], [7.7, 1, 1.6, 3], [11.4, 1, 1.6, 3]]) rect(L + x, y + 1.5, w, h, C.yellow);
    text(pad(G.hi), L + 16, 3, '#ff3030', 'left', 8, false);
    text('1P', L + 4, 15, C.yellow, 'left', 8, false);
    text('-', L + 20, 15, '#ff3030', 'left', 8, false);
    text(pad(G.score), L + 28, 15, C.yellow, 'left', 8, false);
    for (let i = 0; i < Math.min(G.lives - (field ? 1 : 0), 4); i++) blit(MINI_BUGGY, L + 4 + i * 18, 28);

    const px = L + 86, pw = 134;
    rect(px, 2, pw, 23, '#08b6e6');
    const cur = field ? currentLetter() : 0;
    text('POINT', px + 4, 4, '#000000', 'left', 8, false);
    text(LETTERS[cur], px + 52, 4, '#000000', 'left', 8, false);
    text('TIME', px + 4, 15, '#e8141c', 'left', 8, false);
    text(String(Math.floor(G.segFrames / 60)).padStart(3, '0'), px + 38, 15, '#e8141c', 'left', 8, false);

    const blink = (G.frame >> 3) & 1;
    const ahead = G.dist + (G.buggy ? G.buggy.x : 0);
    const air = field && (G.wave || G.ufos.length > 0);
    const mines = field && G.obs.some(o => o.type === 'mine' && o.x > ahead && o.x - ahead < 300);
    const behind = field && (!!G.rocket || G.obs.some(o => (o.type === 'tank' || o.type === 'boulder') && o.x > ahead && o.x - ahead < 300));
    [[air, '#ff3030'], [mines, C.yellow], [behind, '#30ff60']].forEach(([on, col], i) => {
      const lx = px + pw - 12, ly = 3 + i * 7.2;
      rect(lx, ly, 6, 6, '#000000');
      if (on && blink) { rect(lx + 1, ly + 1, 4, 4, col); rect(lx + 1.5, ly + 1.5, 1.4, 1.4, '#ffffff'); }
    });

    // Course map.
    const x0 = px + 4, x1 = px + pw - 2, bw = x1 - x0, y = 33;
    rect(x0, y, bw, 3, '#08b6e6');
    const p = field ? clamp((worldBuggy() - letterX(0)) / (25 * SEG), 0, 1) : 0;
    if (p > 0) rect(x0, y, bw * p, 3, '#e8141c');
    for (const i of CHECKPOINTS) {
      const x = x0 + bw * i / 25;
      rect(x - 0.5, y - 1.5, 1, 4.5, '#ffffff');
      if (i) text(LETTERS[i], Math.min(x1 - 5, x - 2.5), y - 7, i <= G.cp && field ? C.yellow : '#e8141c', 'left', 5, false);
    }
    text('>', x0 - 1, y - 7, '#e8141c', 'left', 5, false);
  }

  function centerBox(y, h, w = 208) {
    const x = Math.round(W / 2 - w / 2);
    rect(x, y, w, h, '#0618d4');
    rect(x + 1, y + 1, w - 2, h - 2, '#000000');
  }

  function drawPanel(p) {
    const cx = W / 2, y = HUD_H + 8;
    if (p.t > 240 && (p.t >> 2) & 1) return;
    centerBox(y, 60, 224);
    text(p.final ? 'CONGRATULATIONS!' : `TIME TO REACH POINT "${p.letter}"`, cx, y + 5, C.yellow, 'center');
    const row = (label, val, yy, col) => { text(label, cx - 100, yy, col); text(String(val), cx + 100, yy, '#ffffff', 'right'); };
    row('YOUR TIME', p.secs, y + 17, '#08b6e6');
    row('THE AVERAGE TIME', p.avg, y + 27, '#08b6e6');
    row('TOP RECORD', p.rec, y + 37, '#08b6e6');
    row(p.bonus ? 'GOOD BONUS POINTS' : 'NO BONUS', p.bonus, y + 48, '#ff3030');
  }

  function drawOverlays() {
    const cx = W / 2, blink = (G.frame >> 4) & 1;
    if (G.state === 'ready') {
      centerBox(HUD_H + 26, 36, 176);
      text(G.course === 0 ? 'BEGINNER COURSE' : 'CHAMPION COURSE', cx, HUD_H + 31, '#08b6e6', 'center');
      text(`POINT "${LETTERS[G.cp]}"`, cx, HUD_H + 42, C.yellow, 'center');
      if (blink) text('GET READY', cx, HUD_H + 52, '#ffffff', 'center', 6);
    }
    if (G.panel) drawPanel(G.panel);
    if (G.state === 'gameover') {
      centerBox(HUD_H + 40, 22, 112);
      text('GAME OVER', cx, HUD_H + 47, '#ff3030', 'center');
    }
    if (G.demo) {
      text('DEMONSTRATION', cx, HUD_H + 4, '#08b6e6', 'center');
      if (blink) text('PUSH START BUTTON', cx, HUD_H + 16, C.yellow, 'center', 6);
    }
  }

  // Title logo: chunky two-tone letters with a hard drop shadow, in the spirit of 1980s cabinets.
  function logo(str, y, size) {
    ctx.font = `${Math.round(size * SY)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const X = DX(W / 2), Y = DY(y), o = Math.max(2, Math.round(SY * 2));
    ctx.fillStyle = '#0618d4'; ctx.fillText(str, X + o, Y + o);
    const g = ctx.createLinearGradient(0, Y, 0, Y + size * SY);
    g.addColorStop(0, '#fffaa0'); g.addColorStop(0.5, C.yellow); g.addColorStop(0.51, '#ff9a20'); g.addColorStop(1, '#e8141c');
    ctx.fillStyle = g; ctx.fillText(str, X, Y);
  }

  function drawTitle() {
    const cx = W / 2;
    logo('LUNAR', HUD_H + 6, 24);
    logo('PATROL', HUD_H + 33, 24);
    if ((G.frame >> 5) & 1) text('PUSH START BUTTON', cx, HUD_H + 64, '#ffffff', 'center', 8, true);
    text('1 PLAYER  3 BUGGIES', cx, HUD_H + 78, '#08b6e6', 'center', 6, true);
    text('CLASSIC MODE', cx, HUD_H + 90, C.yellow, 'center', 6, true);
    drawBuggy();
  }

  function drawPoints() {
    const cx = W / 2;
    text('SCORE ADVANCE TABLE', cx, HUD_H + 3, C.yellow, 'center');
    const items = [
      [UFO1[(G.frame >> 3) & 1], '100 PTS'], [UFO2[(G.frame >> 3) & 1], '100 PTS'], [UFO3[(G.frame >> 3) & 1], '200 PTS'],
      [TANK, '200 PTS'], [ROCK_L, '100 PTS'], [BOULDER[(G.frame >> 3) & 7], '50 PTS'], [BOMB[0], '100 PTS'],
    ];
    items.forEach(([img, label], i) => {
      const y = HUD_H + 15 + i * 15;
      blit(img, cx - 50 - img.lw * 0.7, y + 4 - img.lh * 0.7, 1, 1.4);
      text('= ' + label, cx - 28, y, '#ffffff', 'left');
    });
    text('SQUAD BONUS 500-1000', cx, HUD_H + 122, '#08b6e6', 'center', 6);
  }

  function drawScores() {
    const cx = W / 2;
    text('BEST PATROLS', cx, HUD_H + 8, C.yellow, 'center');
    scores.forEach((s, i) => {
      const y = HUD_H + 28 + i * 14, col = i === 0 ? C.yellow : '#ffffff';
      text(['1ST', '2ND', '3RD', '4TH', '5TH'][i], cx - 80, y, '#08b6e6');
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
    drawBackdrop();
    drawGround();
    if (field) {
      drawCraters();
      drawObstacles();
      if (G.state === 'dying' && !G.sink) drawDebris();
      else if (G.state !== 'gameover') drawBuggy();
      drawAir();
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
