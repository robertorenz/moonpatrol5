'use strict';
/* WebAudio synthesizer: sound effects plus an original chiptune loop. */
const AudioSys = (() => {
  let ac = null, master, sfxBus, musicBus, noiseBuf;
  let muted = false, musicPlaying = false, timerId = null, nextT = 0, step = 0;
  const STEP = 60 / 150 / 2; // eighth notes at 150 BPM

  function init() {
    if (ac) { if (ac.state === 'suspended' && !paused) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = 0.3; musicBus.connect(master);
    const len = ac.sampleRate * 1.6;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function tone({ type = 'square', f0 = 440, f1 = null, dur = 0.1, vol = 0.2, t = null, bus = null, attack = 0.004 }) {
    if (!ac) return;
    t = t ?? ac.currentTime;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.2, vol = 0.3, f0 = 3000, f1 = 200, t = null, bus = null, q = 0.7, type = 'lowpass' }) {
    if (!ac) return;
    t = t ?? ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || sfxBus);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }

  function arp(notes, gap, vol = 0.1, type = 'square', len = 1.6) {
    if (!ac) return;
    const t = ac.currentTime;
    notes.forEach((n, i) => { if (n > 0) tone({ type, f0: midi(n), dur: gap * len, vol, t: t + i * gap }); });
  }

  const ok = () => ac && !muted;
  const sfx = {
    fire() { if (!ok()) return; tone({ f0: 1500, f1: 300, dur: 0.08, vol: 0.1 }); tone({ f0: 500, f1: 1600, dur: 0.09, vol: 0.06 }); },
    jump() { if (!ok()) return; tone({ f0: 180, f1: 540, dur: 0.22, vol: 0.09 }); },
    land() { if (!ok()) return; noise({ dur: 0.07, vol: 0.2, f0: 500, f1: 90 }); },
    boom() { if (!ok()) return; noise({ dur: 0.35, vol: 0.45, f0: 2500, f1: 80 }); },
    hit() { if (!ok()) return; noise({ dur: 0.14, vol: 0.35, f0: 4000, f1: 500, type: 'bandpass', q: 1 }); },
    bigBoom() { if (!ok()) return; noise({ dur: 1.2, vol: 0.7, f0: 3000, f1: 40 }); tone({ type: 'sawtooth', f0: 220, f1: 30, dur: 0.9, vol: 0.16 }); },
    alarm() { if (!ok()) return; const t = ac.currentTime; for (let i = 0; i < 6; i++) tone({ f0: i % 2 ? 660 : 990, dur: 0.08, vol: 0.06, t: t + i * 0.1 }); },
    bomb() { if (!ok()) return; tone({ type: 'sine', f0: 1500, f1: 450, dur: 0.4, vol: 0.05 }); },
    tank() { if (!ok()) return; noise({ dur: 0.15, vol: 0.25, f0: 1200, f1: 150 }); tone({ f0: 160, f1: 70, dur: 0.12, vol: 0.07 }); },
    ufoKill() { if (!ok()) return; tone({ f0: 900, f1: 110, dur: 0.28, vol: 0.09 }); noise({ dur: 0.28, vol: 0.25, f0: 3500, f1: 300 }); },
    checkpoint() { if (!ok()) return; arp([72, 76, 79, 84, 0, 79, 84], 0.09, 0.09); },
    extra() { if (!ok()) return; arp([79, 83, 86, 91, 86, 91], 0.06, 0.08); },
    start() { if (!ok()) return; arp([67, 72, 76, 79, 0, 76, 79, 79], 0.13, 0.09, 'square', 1.1); },
    gameover() { if (!ok()) return; arp([72, 0, 67, 0, 64, 60], 0.18, 0.09, 'triangle', 1.4); },
    tick() { if (!ok()) return; tone({ f0: 1760, dur: 0.035, vol: 0.035 }); },
    pop() { if (!ok()) return; noise({ dur: 0.25, vol: 0.18, f0: 3000, f1: 400, type: 'bandpass', q: 0.6 }); tone({ type: 'sine', f0: 1200 + Math.random() * 800, f1: 300, dur: 0.3, vol: 0.03 }); },
    go() { if (!ok()) return; tone({ f0: 400, f1: 1300, dur: 0.22, vol: 0.08 }); tone({ type: 'triangle', f0: 200, f1: 650, dur: 0.22, vol: 0.12 }); },
    // Original victory fanfare: [midi, start step, length in steps].
    fanfare(final) {
      if (!ok()) return;
      const S = 0.12, t0 = ac.currentTime + 0.02;
      const lead = [[67, 0, 1], [72, 1, 1], [76, 2, 1], [79, 3, 2], [76, 5, 1], [79, 6, 1], [84, 7, 5]];
      const harm = [[64, 3, 2], [72, 7, 5], [76, 7, 5]];
      const bass = [[48, 0, 3], [43, 3, 2], [48, 5, 2], [36, 7, 5]];
      if (final) {
        lead.push([81, 13, 1], [79, 14, 1], [77, 15, 1], [76, 16, 1], [74, 17, 1], [76, 18, 1], [79, 19, 2], [84, 21, 7]);
        harm.push([72, 19, 2], [76, 21, 7], [79, 21, 7]);
        bass.push([41, 13, 3], [43, 16, 3], [48, 19, 2], [36, 21, 7]);
      }
      for (const [n, st, len] of lead) tone({ f0: midi(n), dur: len * S * 0.95, vol: 0.1, t: t0 + st * S, attack: 0.01 });
      for (const [n, st, len] of harm) tone({ type: 'triangle', f0: midi(n), dur: len * S * 0.95, vol: 0.12, t: t0 + st * S, attack: 0.01 });
      for (const [n, st, len] of bass) tone({ type: 'triangle', f0: midi(n), dur: len * S * 0.9, vol: 0.35, t: t0 + st * S });
      const end = final ? 28 : 12;
      noise({ dur: 0.5, vol: 0.12, f0: 9000, f1: 3000, t: t0 + 7 * S, type: 'highpass', q: 0.4 });
      if (final) noise({ dur: 0.7, vol: 0.14, f0: 9000, f1: 3000, t: t0 + 21 * S, type: 'highpass', q: 0.4 });
      for (let k = 0; k < end; k += 2) tone({ type: 'sine', f0: 150, f1: 45, dur: 0.12, vol: k % 4 ? 0.25 : 0.45, t: t0 + k * S });
    },
  };

  // Original composition — funky minor-key bass with a bright square lead.
  const BASS = {
    Am: [45, 45, 52, 45, 57, 45, 52, 55],
    F:  [41, 41, 48, 41, 53, 41, 48, 51],
    G:  [43, 43, 50, 43, 55, 43, 50, 53],
    Em: [40, 40, 47, 40, 52, 40, 47, 50],
  };
  const PROG = ['Am', 'F', 'G', 'Am', 'F', 'G', 'Em', 'Am'];
  const LEAD = [
    76, 0, 81, 0, 79, 76, 0, 74,   72, 0, -1, 74, 76, -1, 77, 76,
    74, 0, 71, 0, 74, 79, -1, 0,   76, -1, -1, 0, 72, 74, 76, 0,
    77, -1, 76, 77, 81, -1, 79, 77, 79, -1, -1, 74, 71, 0, 74, 0,
    76, -1, 79, -1, 83, -1, 81, 79, 81, -1, -1, -1, 0, 0, 0, 0,
  ];
  const LOOP = LEAD.length;

  function scheduleStep(i, t) {
    const bar = Math.floor(i / 8), s = i % 8;
    const bn = BASS[PROG[bar]][s];
    tone({ type: 'triangle', f0: midi(bn), dur: STEP * 0.9, vol: 0.5, t, bus: musicBus });
    tone({ type: 'square', f0: midi(bn), dur: STEP * 0.45, vol: 0.05, t, bus: musicBus });
    const ln = LEAD[i];
    if (ln > 0) {
      let n = 1;
      while (LEAD[(i + n) % LOOP] === -1) n++;
      tone({ type: 'square', f0: midi(ln), dur: STEP * n * 0.95, vol: 0.075, t, bus: musicBus, attack: 0.01 });
    }
    if (s === 0 || s === 3 || s === 4) tone({ type: 'sine', f0: 150, f1: 45, dur: 0.13, vol: 0.6, t, bus: musicBus });
    if (s === 2 || s === 6) noise({ dur: 0.1, vol: 0.22, f0: 1800, f1: 900, t, bus: musicBus, type: 'bandpass', q: 0.8 });
    noise({ dur: 0.03, vol: s % 2 ? 0.07 : 0.04, f0: 8000, f1: 6000, t, bus: musicBus, type: 'highpass', q: 0.5 });
  }

  function startMusic() {
    if (!ac || musicPlaying) return;
    musicPlaying = true; step = 0; nextT = ac.currentTime + 0.05;
    timerId = setInterval(() => {
      while (nextT < ac.currentTime + 0.15) {
        if (!muted) scheduleStep(step, nextT);
        nextT += STEP; step = (step + 1) % LOOP;
      }
    }, 30);
  }

  function stopMusic() { musicPlaying = false; clearInterval(timerId); }

  let paused = false;
  function setPaused(p) {
    paused = p;
    if (!ac) return;
    if (p) ac.suspend(); else ac.resume();
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  }

  return { init, sfx, startMusic, stopMusic, setMuted, setPaused, isMuted: () => muted };
})();
