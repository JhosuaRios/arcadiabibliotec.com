(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['tv-mode.js']='2.3.3';
/* Arcadia · Modo TV (v2.3.0)
 * - Se activa solo cuando se envía un juego desde el celular (o con ?tv=1 / el botón del panel 📱).
 * - Pantalla completa sin barras, sin efectos visuales costosos.
 * - Navegación de menús con cruceta/A/B: teclado, mando USB o el celular conectado (sin usar el puntero).
 * - NES: ahorro adaptativo; si la TV no llega a 60 cuadros/s deja de dibujar algunos cuadros (el juego sigue a velocidad
 *   normal) y, como último recurso, apaga el sonido. */
(() => {
  'use strict';
  const KEY = 'arcadia-tv', PERF_KEY = 'arcadia-tv-perf';
  const $ = s => document.querySelector(s);
  let tvOn = false, perfMode = 'auto';
  try { tvOn = localStorage.getItem(KEY) === '1' || /[?&]tv=1\b/.test(location.search); perfMode = localStorage.getItem(PERF_KEY) || 'auto'; } catch {}
  if (perfMode !== 'auto') perfMode = Math.min(3, Math.max(0, parseInt(perfMode, 10) || 0));

  const style = document.createElement('style');
  style.textContent = `
  body.tv-mode *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important;animation:none!important;transition:none!important;filter:none!important}
  body.tv-mode{font-size:112%}
  body.tv-mode button,body.tv-mode a,body.tv-mode input,body.tv-mode select{min-height:44px}
  body.tv-nav :focus,body.tv-mode :focus{outline:5px solid #c4f36a!important;outline-offset:3px!important;border-radius:12px}
  body.tv-playing .session-toolbar,body.tv-playing .gba-head,body.tv-playing .gba-status,body.tv-playing .gba-help,
  body.tv-playing .nes-touch-controls,body.tv-playing #gbaTouch{display:none!important}
  body.tv-playing #gameSession,body.tv-playing #gameSession .session-window{padding:0!important;width:100vw!important;max-width:none!important;height:100vh!important;max-height:none!important;border-radius:0!important;border:0!important;background:#000}
  body.tv-playing #gameSession .session-viewport canvas{width:min(100vw,133.333vh)!important;height:min(100vh,75vw)!important;aspect-ratio:4/3!important;object-fit:fill!important;image-rendering:pixelated}
  body.tv-playing #gbaModal{padding:0!important;background:#000}
  body.tv-playing #gbaStage{flex:1;display:flex;align-items:center;justify-content:center}
  body.tv-playing #gbaStage canvas{width:min(100vw,150vh)!important;height:min(100vh,66.667vw)!important;image-rendering:pixelated}
  #tvChip{position:fixed;left:10px;bottom:8px;z-index:260;background:#000a;color:#c4f36a;font:600 13px ui-monospace,monospace;padding:4px 9px;border-radius:8px;pointer-events:none;display:none}
  body.tv-playing #tvChip{display:block}
  #tvToast{position:fixed;right:14px;top:12px;z-index:400;background:#101a24;color:#eaf3ff;border:1px solid #4d813d;border-radius:12px;padding:10px 16px;font:600 15px system-ui,sans-serif;display:none;max-width:60vw}
  `;
  document.head.appendChild(style);
  const chip = Object.assign(document.createElement('div'), { id: 'tvChip' });
  const toast = Object.assign(document.createElement('div'), { id: 'tvToast' });
  document.body.append(chip, toast);
  let toastT = 0;
  const say = (m, ms = 4000) => { toast.textContent = m; toast.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { toast.style.display = 'none'; }, ms); };

  const nesLive = () => typeof nesBrowser !== 'undefined' && nesBrowser && $('#gameSession')?.classList.contains('open');
  const gbaLive = () => typeof gbaEngine !== 'undefined' && gbaEngine && $('#gbaModal')?.classList.contains('open');
  const gameRunning = () => !!(nesLive() || gbaLive());

  function setOn(v, persist = true) {
    tvOn = !!v;
    document.body.classList.toggle('tv-mode', tvOn);
    if (persist) { try { localStorage.setItem(KEY, tvOn ? '1' : '0'); } catch {} }
    renderSettings();
  }

  /* ───────────── navegación espacial ───────────── */
  const SEL = 'button:not([disabled]),a[href],input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
  function topLayer() {
    const layers = [...document.querySelectorAll('#ppPanel.open,.modal-bg.open,.news-panel.open')];
    if (!layers.length) return document.body;
    return layers.sort((a, b) => (parseInt(getComputedStyle(a).zIndex, 10) || 0) - (parseInt(getComputedStyle(b).zIndex, 10) || 0)).pop();
  }
  const usable = e => { if (e.closest('#ppView,#tvChip')) return false; const r = e.getBoundingClientRect(); if (r.width < 6 || r.height < 6) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none'; };
  const candidates = () => [...topLayer().querySelectorAll(SEL)].filter(usable);
  function focusEl(e) { e.focus({ preventScroll: true }); try { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} }
  function move(dir) {
    document.body.classList.add('tv-nav');
    const list = candidates(); if (!list.length) return;
    let cur = document.activeElement;
    if (!cur || !list.includes(cur)) { const first = list.filter(e => e.getBoundingClientRect().top >= 0).sort((a, b) => { const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(); return (A.top + A.left * 0.2) - (B.top + B.left * 0.2); })[0] || list[0]; focusEl(first); return; }
    const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const c of list) {
      if (c === cur) continue;
      const q = c.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      let main, side;
      if (dir === 'right') { main = dx; side = Math.abs(dy); } else if (dir === 'left') { main = -dx; side = Math.abs(dy); }
      else if (dir === 'down') { main = dy; side = Math.abs(dx); } else { main = -dy; side = Math.abs(dx); }
      if (main < 4) continue;
      const score = main + side * 2.5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) focusEl(best);
  }
  function activate() {
    const e = document.activeElement;
    if (!e || e === document.body || !candidates().includes(e)) { move('down'); return; }
    if (e.tagName === 'INPUT' && /text|search|number|tel|email/.test(e.type)) { e.focus(); return; }
    e.click();
  }
  function back() {
    const l = topLayer();
    if (l === document.body) { if (typeof setFilter === 'function') { try { setFilter('all'); } catch {} } return; }
    const btn = l.id === 'ppPanel' ? l.querySelector('#ppClose') : (l.querySelector('#newsClose') || [...l.querySelectorAll('button')].find(b => /cerrar|cancelar|volver|salir/i.test(b.textContent)));
    btn?.click();
  }
  function exitGame() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
    if ($('#gameSession')?.classList.contains('open') && typeof stopGameSession === 'function') stopGameSession();
    if ($('#gbaModal')?.classList.contains('open') && typeof closeGbaPlayer === 'function') closeGbaPlayer();
    setTimeout(() => move('down'), 300);
  }
  // Entrada de navegación con repetición al mantener pulsado (cruceta).
  const holds = new Map();
  function fire(n) { if (n === 'up' || n === 'down' || n === 'left' || n === 'right') move(n); else if (n === 'a' || n === 'start') activate(); else if (n === 'b') back(); }
  function navHold(name, down) {
    if (gameRunning() && down) return;
    const h = holds.get(name);
    if (!down) { if (h) { clearTimeout(h.t); clearInterval(h.i); holds.delete(name); } return; }
    if (h) return;
    fire(name);
    if (name === 'a' || name === 'b' || name === 'start' || name === 'select') { holds.set(name, { t: 0, i: 0 }); return; }
    const o = { t: 0, i: 0 };
    o.t = setTimeout(() => { o.i = setInterval(() => { if (gameRunning()) { navHold(name, false); return; } fire(name); }, 110); }, 380);
    holds.set(name, o);
  }
  const navReleaseAll = () => { for (const n of [...holds.keys()]) navHold(n, false); };

  // Teclado (flechas del control remoto, si las envía) — solo en Modo TV y sin juego.
  window.addEventListener('keydown', e => {
    if (!tvOn || gameRunning() || e.ctrlKey || e.altKey || e.metaKey) return;
    const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.key.length === 1;
    if (typing) return;
    const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (m) { e.preventDefault(); e.stopPropagation(); fire(m); }
    else if (e.key === 'Escape' || (e.key === 'Backspace' && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName))) { e.preventDefault(); back(); }
  }, true);
  // Mando USB: cruceta/stick, A (activar), B (volver).
  const padPrev = {};
  (function pollPad() {
    if (tvOn && !gameRunning()) {
      const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
      if (pad) {
        const ax = pad.axes?.[0] || 0, ay = pad.axes?.[1] || 0, b = i => !!pad.buttons[i]?.pressed;
        const now = { up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6, a: b(0), b: b(1), start: b(9) };
        for (const k in now) { if (now[k] !== !!padPrev[k]) navHold(k, now[k]); padPrev[k] = now[k]; }
      }
    }
    requestAnimationFrame(pollPad);
  })();

  /* ───────────── ajustes (dentro del panel 📱) ───────────── */
  const PERF_LABEL = { auto: 'Automático', 0: 'Normal', 1: 'Ahorro 1', 2: 'Ahorro 2', 3: 'Ahorro 3 (sin sonido)' };
  function renderSettings() {
    const card = $('#ppPanel .pp-card'); if (!card) return;
    let sec = $('#tvSec');
    if (!sec) {
      sec = document.createElement('div'); sec.className = 'pp-sec'; sec.id = 'tvSec';
      sec.innerHTML = '<h3>Modo TV</h3><p>Pantalla completa sin menús, sin efectos pesados y con ahorro automático en NES. Se activa solo al enviar un juego desde el celular.</p><div class="pp-actions"><button id="tvToggle"></button><button id="tvPerf"></button></div>';
      card.insertBefore(sec, card.lastElementChild);
      $('#tvToggle').onclick = () => { setOn(!tvOn); };
      $('#tvPerf').onclick = () => { const order = ['auto', 0, 1, 2, 3]; const i = order.indexOf(perfMode); perfMode = order[(i + 1) % order.length]; try { localStorage.setItem(PERF_KEY, String(perfMode)); } catch {} for (const t of tuners) t.lock = perfMode; renderSettings(); };
    }
    $('#tvToggle').textContent = 'Modo TV: ' + (tvOn ? 'activado' : 'apagado');
    $('#tvToggle').classList.toggle('on', tvOn);
    $('#tvPerf').textContent = 'Rendimiento NES: ' + PERF_LABEL[perfMode];
  }

  /* ───────────── ahorro adaptativo de NES ───────────── */
  const tuners = new Set(); let tunedFor = null;
  const noop = function () {};
  function installTuner(b) {
    const t = b._frameTimer, nes = b.nes, ppu = nes.ppu, proto = Object.getPrototypeOf(ppu).renderFramePartially;
    const mapper = nes.rom?.mapperType;
    const T = { level: 0, gen: 0, skip: false, cnt: 0, low: 0, lock: perfMode, fps: 60, muted: false, safe: !(mapper === 9 || mapper === 10), b };
    const gf = t.onGenerateFrame, wf = t.onWriteFrame;
    t.onGenerateFrame = function () {
      if (T.lock !== 'auto' && T.lock !== T.level) setLevel(T, T.lock);
      T.gen++; T.cnt++;
      const every = T.level >= 2 ? 3 : 2;
      T.skip = T.safe && T.level >= 1 && (T.gen % every) !== 0 && !onlineActive();
      ppu.renderFramePartially = T.skip ? noop : proto;
      return gf.apply(this, arguments);
    };
    t.onWriteFrame = function () { if (T.skip) return; return wf.apply(this, arguments); };
    T.timer = setInterval(() => {
      if (b !== nesBrowserNow()) { clearInterval(T.timer); tuners.delete(T); return; }
      T.fps = T.cnt; T.cnt = 0;
      if (T.lock === 'auto' && !onlineActive() && $('#gameSession')?.classList.contains('open') && !document.hidden) {
        if (T.fps > 0 && T.fps < 54) T.low++; else T.low = 0;
        if (T.low >= 3 && T.level < 3) { setLevel(T, T.level + 1); T.low = 0; }
      }
      chip.textContent = `NES ${T.fps} FPS${T.level ? ' · ahorro ' + T.level : ''}`;
    }, 1000);
    tuners.add(T);
  }
  const nesBrowserNow = () => (typeof nesBrowser !== 'undefined' ? nesBrowser : null);
  const onlineActive = () => { const o = window.arcadiaOnline; return !!(o?.isGuest?.() || o?.isLockstep?.() || o?.isHosting?.()); };
  function setLevel(T, level) {
    level = Math.min(3, Math.max(0, level | 0));
    if (level === T.level) return;
    T.level = level;
    const o = T.b.nes.opts;
    if (level >= 3 && !T.muted) { T.muted = true; T.savedCb = o.onAudioSample; T.savedSound = o.emulateSound; o.onAudioSample = null; o.emulateSound = false; }
    else if (level < 3 && T.muted) { T.muted = false; o.onAudioSample = T.savedCb; o.emulateSound = T.savedSound; }
    if (T.lock === 'auto') say(level ? `Ahorro ${level} activado para mantener la velocidad${level >= 3 ? ' (sin sonido)' : ''}.` : 'Ahorro desactivado.');
  }

  /* ───────────── detección de juego abierto ───────────── */
  let wasRunning = false;
  setInterval(() => {
    const running = gameRunning();
    document.body.classList.toggle('tv-playing', tvOn && running);
    if (running && !wasRunning) {
      navReleaseAll();
      if (tvOn) {
        if (nesLive()) { $('#gameSession').classList.add('nes-session-fullscreen'); try { $('#sessionWindow')?.requestFullscreen?.().catch(() => {}); } catch {} setTimeout(() => nesBrowser?.fitInParent?.(), 200); }
        else if (gbaLive()) { try { $('#gbaModal')?.requestFullscreen?.().catch(() => {}); } catch {} }
      }
    }
    if (!running && wasRunning) { try { if (document.fullscreenElement) document.exitFullscreen(); } catch {} }
    wasRunning = running;
    const b = nesBrowserNow();
    if (tvOn && b && b !== tunedFor && b._frameTimer && b.nes) { tunedFor = b; try { installTuner(b); } catch (e) { console.warn('Arcadia TV:', e); } }
    if (!b) tunedFor = null;
    if (!tvOn) { chip.textContent = ''; }
  }, 500);

  window.arcadiaTV = { isOn: () => tvOn, on: () => tvOn, setOn, navHold, navReleaseAll, exitGame, say, gameRunning, renderSettings };
  if (tvOn) document.body.classList.add('tv-mode');
  setTimeout(renderSettings, 400);
})();
