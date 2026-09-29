'use strict';
/* Pixel-art sprites, pre-rendered to offscreen canvases. All artwork is original. */
const SPR = (() => {
  function make(rows, pal) {
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const col = pal[rows[j][i]];
        if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); }
      }
    }
    return c;
  }

  function blank(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  }

  // Six-wheeled patrol buggy (three wheels visible), facing right.
  const buggy = make([
    '..........GG....................',
    '.........GGGG.....WWWWWWW.......',
    '......WWWWWWWWWWWWWWCCCCCWW.....',
    '.....WWWWWWWWWWWWWWWCCCCCCWW....',
    '....WWWWWWWWWWWWWWWWWWWWWWWWWW..',
    '..RRRRRRRRRRRRRRRRRRRRRRRRRRRRY.',
    '.SWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.',
    '.SSSSSSSSSSSSSSSSSSSSSSSSSSSSSS.',
    '....DD........DD........DD......',
  ], { W: '#dfe6ee', S: '#8e9cad', R: '#e2483d', C: '#5fd3f3', D: '#3b4552', Y: '#ffd166', G: '#7c8794' });

  function wheelFrame(a) {
    const [c, x] = blank(8, 8);
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const dx = i + 0.5 - 4, dy = j + 0.5 - 4, d = Math.hypot(dx, dy);
        if (d > 4.05) continue;
        x.fillStyle = d > 2.9 ? '#23282f' : d > 1.3 ? '#59636f' : '#cfd6de';
        x.fillRect(i, j, 1, 1);
      }
    }
    x.fillStyle = '#aeb8c4';
    for (const k of [0, Math.PI]) {
      x.fillRect(Math.floor(4 + Math.cos(a + k) * 2.2), Math.floor(4 + Math.sin(a + k) * 2.2), 1, 1);
    }
    return c;
  }
  const wheels = [0, 1, 2, 3].map(k => wheelFrame(k * Math.PI / 4));

  const ufoPal = { W: '#ffffff', C: '#c9d4df', S: '#7d8a99', a: '#ff3b30', b: '#ffd166' };
  const ufo1 = [
    make(['.....WWWWWW.....', '...WWCCCCCCWW...', '.CCCCCCCCCCCCCC.', 'CCaCCbCCaCCbCCaC',
          '.SSSSSSSSSSSSSS.', '...SSSSSSSSSS...', '....S......S....'], ufoPal),
    make(['.....WWWWWW.....', '...WWCCCCCCWW...', '.CCCCCCCCCCCCCC.', 'CCbCCaCCbCCaCCbC',
          '.SSSSSSSSSSSSSS.', '...SSSSSSSSSS...', '....S......S....'], ufoPal),
  ];

  const pod = ['....OOOOOO....', '..OOYYYYYYOO..', '.OOOOOOOOOOOO.', 'OODOODOODOODOO',
               '.OOOOOOOOOOOO.', '..RR......RR..', '.RR........RR.', 'RR..........RR'];
  const ufo2 = [
    make(pod, { O: '#f08a24', Y: '#ffd166', D: '#6b2e0a', R: '#c0392b' }),
    make(pod, { O: '#f08a24', Y: '#fff1c1', D: '#ffd166', R: '#c0392b' }),
  ];

  const dart = ['.....GG.....', '....GLLG....', '...GLLLLG...', 'GGGGGGGGGGGG',
                '.GYGGYYGGYG.', '..GGGGGGGG..', '...G....G...', '..G......G..'];
  const ufo3 = [
    make(dart, { G: '#3ecf6e', L: '#b6f5c9', Y: '#ffe066' }),
    make(dart, { G: '#3ecf6e', L: '#ffffff', Y: '#ff6b3d' }),
  ];

  const tank = make([
    '........GGGG........',
    '.......GGLLGG.......',
    'BBBBBBBGGGGGG.......',
    '.......GGGGGG.......',
    '....GGGGGGGGGGGG....',
    '...GGGGGGGGGGGGGGG..',
    '..TTTTTTTTTTTTTTTTT.',
    '.TDTTDTTDTTDTTDTTDT.',
    '.TTTTTTTTTTTTTTTTTT.',
    '..TTTTTTTTTTTTTTTT..',
  ], { G: '#6f8f3a', L: '#b8d36b', B: '#9aa3ad', T: '#3d4a2a', D: '#1c2214' });

  const rockPal = { T: '#c58b4f', L: '#e6b07a', D: '#7a4a24' };
  const rockS = make([
    '...LLLL...', '..LLTTTT..', '.LLTTTTTT.', '.LTTTTTTTD',
    'LTTTTTTTDD', 'TTTTTTTDDD', 'TTTTDTTDDD', '.DDDDDDDD.',
  ], rockPal);
  const rockL = make([
    '.....LLLLLL.....', '...LLLTTTTTLL...', '..LLTTTTTTTTTT..', '.LLTTTTTTTTTTTD.',
    '.LTTTTTTDTTTTTD.', 'LLTTTTTTTTTTTTDD', 'LTTTTTTTTTTTTTDD', 'LTTTDTTTTTTTTDDD',
    'TTTTTTTTTTTTTDDD', 'TTTTTTTTTTTTDDDD', 'TTTDTTTTTTTTDDDD', 'TTTTTTTTTTTDDDDD',
    '.DDDDDDDDDDDDDD.',
  ], rockPal);

  const mineRows = ['...rrr...', '..MMMMM..', '.MMMMMMM.', 'MMHMMMHMM', 'DDDDDDDDD'];
  const mine = [
    make(mineRows, { r: '#ff3b30', M: '#8c96a3', H: '#dfe6ee', D: '#3b4552' }),
    make(mineRows, { r: '#5a1a16', M: '#8c96a3', H: '#dfe6ee', D: '#3b4552' }),
  ];

  function boulderFrame(a) {
    const [c, x] = blank(14, 14);
    for (let j = 0; j < 14; j++) {
      for (let i = 0; i < 14; i++) {
        const dx = i + 0.5 - 7, dy = j + 0.5 - 7, d = Math.hypot(dx, dy);
        if (d > 7) continue;
        const lit = (-dx - dy) / 10;
        x.fillStyle = d > 6.2 ? '#4f2f16' : lit > 0.35 ? '#c89262' : lit > -0.25 ? '#9a653a' : '#6e4322';
        x.fillRect(i, j, 1, 1);
      }
    }
    x.fillStyle = '#4f2f16';
    for (let k = 0; k < 3; k++) {
      const ang = a + k * 2.1;
      x.fillRect(Math.floor(7 + Math.cos(ang) * 3.6), Math.floor(7 + Math.sin(ang) * 3.6), 2, 2);
    }
    return c;
  }
  const boulder = [0, 1, 2, 3].map(k => boulderFrame(-k * Math.PI / 6));

  const life = make([
    '....WWW.....', '..WWWWWWWW..', '.RRRRRRRRRR.', '.WWWWWWWWWW.', '.DD..DD..DD.', '.DD..DD..DD.',
  ], { W: '#dfe6ee', R: '#e2483d', D: '#59636f' });

  return { buggy, wheels, ufo1, ufo2, ufo3, tank, rockS, rockL, mine, boulder, life };
})();
