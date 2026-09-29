'use strict';
/* Page chrome: modal dialogs, keyboard/touch input, scaling and preferences. */
const UI = (() => {
  const $ = id => document.getElementById(id);
  const modal = $('modal'), mTitle = $('modalTitle'), mBody = $('modalBody'), mActions = $('modalActions');
  let open = false, dismissible = true, onClose = null, pausedByModal = false;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show({ heading, html, buttons = [], canDismiss = true, closed = null, focus = null }) {
    if (open) close(true);
    mTitle.textContent = heading;
    mBody.innerHTML = html;
    mActions.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => b.action ? b.action() : close());
      if (b.primary) el.dataset.primary = '1';
      mActions.appendChild(el);
    });
    dismissible = canDismiss; onClose = closed;
    if (Game.inGame() && !Game.isPaused()) { Game.setPaused(true); pausedByModal = true; }
    modal.hidden = false; open = true;
    requestAnimationFrame(() => {
      const target = focus ? mBody.querySelector(focus) : mActions.querySelector('[data-primary]');
      if (target) target.focus();
    });
  }

  function close(silent) {
    if (!open) return;
    modal.hidden = true; open = false;
    const cb = onClose; onClose = null;
    if (pausedByModal) { pausedByModal = false; Game.setPaused(false); }
    if (cb && !silent) cb();
    updatePauseButton();
  }

  modal.addEventListener('click', e => { if (e.target === modal && dismissible) close(); });

  // ------------------------------------------------------------- dialogs
  function pauseMenu() {
    if (!Game.inGame()) return;
    show({
      heading: 'Paused',
      html: '<p class="lead">Your patrol is on hold. The moon will wait.</p>',
      buttons: [
        { label: 'Quit to title', action: () => { close(true); Game.quitToTitle(); } },
        { label: 'Restart', action: () => { close(true); Game.startGame(); } },
        { label: 'Resume', primary: true },
      ],
    });
  }

  function helpDialog() {
    show({
      heading: 'How to Play',
      html: `
        <p class="lead">Drive your patrol buggy across the lunar surface from point A to point Z.
        Jump craters, blast rocks and fend off attackers from the sky.</p>
        <div class="grid2">
          <div><h4>Controls</h4>
            <ul class="keys">
              <li><span>Speed up / slow down</span><span><kbd>&larr;</kbd> <kbd>&rarr;</kbd></span></li>
              <li><span>Jump</span><span><kbd>&uarr;</kbd> <kbd>Space</kbd> <kbd>Z</kbd></span></li>
              <li><span>Fire (forward + up)</span><span><kbd>X</kbd> <kbd>Ctrl</kbd></span></li>
              <li><span>Start</span><span><kbd>Enter</kbd></span></li>
              <li><span>Pause</span><span><kbd>P</kbd> <kbd>Esc</kbd></span></li>
              <li><span>Sound</span><span><kbd>M</kbd></span></li>
            </ul>
          </div>
          <div><h4>Scoring</h4>
            <table class="pts">
              <tr><td>Saucer / pod / dart</td><td>100 / 200 / 300</td></tr>
              <tr><td>Tank</td><td>300</td></tr>
              <tr><td>Boulder</td><td>200</td></tr>
              <tr><td>Rock (big rocks split)</td><td>100 (+50)</td></tr>
              <tr><td>Bomb or shell shot down</td><td>50</td></tr>
              <tr><td>Jumping a hazard</td><td>50 &ndash; 100</td></tr>
              <tr><td>Checkpoint</td><td>500 + time bonus</td></tr>
            </table>
          </div>
        </div>
        <h4>Field guide</h4>
        <ul class="guide">
          <li><b>Craters</b> can only be jumped. Wide ones need speed.</li>
          <li><b>Rocks</b> can be shot or jumped. Big rocks take two hits.</li>
          <li><b>Boulders</b> roll toward you. <b>Mines</b> can't be shot, so jump them.</li>
          <li><b>Tanks</b> fire shells along the ground. Jump or shoot the shells.</li>
          <li><b>Orange pods</b> drop bombs that blast fresh craters into your path.</li>
          <li>Warning lamps: <span class="dot red"></span> air attack <span class="dot amber"></span> ground attack <span class="dot green"></span> mines ahead.</li>
          <li>Checkpoints are at <b>E, J, O, T and Z</b>. Losing a buggy returns you to the last one.</li>
        </ul>`,
      buttons: [{ label: 'Got it', primary: true }],
    });
  }

  function scoresTable(highlight) {
    const rows = Game.getScores().map((s, i) =>
      `<tr class="${i === highlight ? 'hl' : ''}"><td>${i + 1}</td><td>${esc(s.name)}</td><td>${s.score.toLocaleString()}</td></tr>`).join('');
    return `<table class="scores"><thead><tr><th>#</th><th>Pilot</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function scoresDialog(highlight = -1) {
    show({ heading: 'High Scores', html: scoresTable(highlight), buttons: [{ label: 'Close', primary: true }] });
  }

  function gameOver(score) {
    const again = { label: 'Play again', primary: true, action: () => { close(true); Game.startGame(); } };
    if (!Game.qualifies(score)) {
      show({
        heading: 'Game Over',
        html: `<p class="lead">Final score <b class="big">${score.toLocaleString()}</b></p>${scoresTable(-1)}`,
        buttons: [{ label: 'Close' }, again],
      });
      return;
    }
    show({
      heading: 'New High Score!',
      html: `<p class="lead">Final score <b class="big">${score.toLocaleString()}</b>. Enter your initials for the board.</p>
             <label class="field">Initials<input id="initials" maxlength="3" autocomplete="off" spellcheck="false" placeholder="AAA"></label>
             <p class="error" id="initErr" hidden>Enter one to three letters or digits.</p>`,
      canDismiss: false,
      focus: '#initials',
      buttons: [{
        label: 'Save score', primary: true, action: () => {
          const v = $('initials').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!v) { $('initErr').hidden = false; return; }
          Game.saveScore(v, score);
          const idx = Game.getScores().findIndex(s => s.name === v && s.score === score);
          close(true);
          show({ heading: 'High Scores', html: scoresTable(idx), buttons: [{ label: 'Close' }, again] });
        },
      }],
    });
    const input = $('initials');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  }
  Game.onGameOver = gameOver;

  // ------------------------------------------------------------- controls
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
    KeyX: 'fire', ControlLeft: 'fire', ControlRight: 'fire', KeyF: 'fire',
    Enter: 'start', NumpadEnter: 'start', Digit1: 'start',
  };

  document.addEventListener('keydown', e => {
    AudioSys.init();
    if (open) {
      if (e.code === 'Escape' && dismissible) { e.preventDefault(); close(); }
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && document.activeElement?.tagName === 'INPUT') {
        e.preventDefault(); mActions.querySelector('[data-primary]')?.click();
      }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); pauseMenu(); return; }
    if (e.code === 'KeyM') { toggleSound(); return; }
    const a = KEYMAP[e.code];
    if (a) { e.preventDefault(); if (!e.repeat) Game.press(a); }
  });
  document.addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) Game.release(a); });
  window.addEventListener('blur', () => { Game.releaseAll(); if (Game.inGame() && !open) pauseMenu(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && Game.inGame() && !open) pauseMenu(); });

  document.querySelectorAll('[data-action]').forEach(btn => {
    const a = btn.dataset.action;
    const down = e => { e.preventDefault(); AudioSys.init(); btn.classList.add('down'); Game.press(a); };
    const up = e => { e.preventDefault(); btn.classList.remove('down'); Game.release(a); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });

  // ------------------------------------------------------------- toolbar
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('lp_prefs')) || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('lp_prefs', JSON.stringify(prefs)); } catch { /* ignore */ } };

  function toggleSound() {
    prefs.muted = !AudioSys.isMuted();
    AudioSys.setMuted(prefs.muted);
    $('btnSound').textContent = prefs.muted ? 'Sound: Off' : 'Sound: On';
    $('btnSound').setAttribute('aria-pressed', String(!prefs.muted));
    savePrefs();
  }

  function setCrt(on) {
    prefs.crtHD = on;
    $('screenWrap').classList.toggle('crt', on);
    $('btnCrt').textContent = on ? 'CRT: On' : 'CRT: Off';
    savePrefs();
  }

  function updatePauseButton() {
    $('btnPause').textContent = 'Pause';
  }

  $('btnPause').addEventListener('click', () => {
    if (Game.inGame()) pauseMenu();
    else show({ heading: 'Nothing to pause', html: '<p class="lead">Start a game with <kbd>Enter</kbd> first, then pause any time with <kbd>P</kbd> or <kbd>Esc</kbd>.</p>', buttons: [{ label: 'OK', primary: true }] });
  });
  $('btnSound').addEventListener('click', () => { AudioSys.init(); toggleSound(); });
  $('btnCrt').addEventListener('click', () => setCrt(!prefs.crtHD));
  $('btnScores').addEventListener('click', () => scoresDialog());
  $('btnHelp').addEventListener('click', helpDialog);
  $('btnFull').addEventListener('click', () => {
    const el = $('stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {
      show({ heading: 'Fullscreen unavailable', html: '<p class="lead">Your browser blocked fullscreen mode for this page.</p>', buttons: [{ label: 'OK', primary: true }] });
    });
  });
  $('btnStart').addEventListener('click', () => { AudioSys.init(); Game.startGame(); $('screen').focus(); });

  // ------------------------------------------------------------- scaling
  // The game renders natively at the display's resolution. 'fill' widens the view to the
  // window's shape; 'arcade' keeps the original 4:3 screen shape.
  const VIEWS = { fill: 'View: Fill screen', arcade: 'View: Arcade 4:3' };
  let fitQueued = false;
  function fit() {
    const canvas = $('screen'), stage = $('stage');
    const availW = Math.max(320, stage.clientWidth);
    const availH = Math.max(240, stage.clientHeight);
    const view = VIEWS[prefs.view] ? prefs.view : 'fill';
    let w = availW, h = availH;
    if (view === 'arcade' || availW / availH < 256 / 224) { h = Math.min(availH, availW * 3 / 4); w = h * 4 / 3; }
    if (view === 'fill' && w / h > 460 / 224) w = h * 460 / 224;
    w = Math.floor(w); h = Math.floor(h);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const scale = Math.min(dpr, 3400 / w);
    Game.resize(Math.round(w * scale), Math.round(h * scale), view === 'fill' && w / h >= 256 / 224 ? 'fill' : 'arcade');
    $('screenWrap').style.setProperty('--px', (h / 224) + 'px');
    $('btnView').textContent = VIEWS[view];
  }
  const queueFit = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };

  $('btnView').addEventListener('click', () => {
    prefs.view = prefs.view === 'arcade' ? 'fill' : 'arcade';
    savePrefs(); fit();
  });

  if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch-ui');
  window.addEventListener('resize', queueFit);
  new ResizeObserver(queueFit).observe($('stage'));
  document.addEventListener('fullscreenchange', queueFit);
  fit();

  AudioSys.setMuted(!!prefs.muted);
  $('btnSound').textContent = prefs.muted ? 'Sound: Off' : 'Sound: On';
  setCrt(prefs.crtHD === true);

  return { show, close, isOpen: () => open };
})();
