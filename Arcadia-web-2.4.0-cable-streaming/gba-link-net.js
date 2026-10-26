(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['gba-link-net.js']='2.4.0';
/* Arcadia · Cable link GBA por internet
 * El anfitrión emula las DOS consolas en su dispositivo, unidas por un cable interno exacto (así los juegos que
 * exigen un cable muy rápido, como Mario Kart Super Circuit, lo reconocen). La consola 2 se envía como vídeo y
 * sonido al otro jugador, que solo manda sus botones: no necesita ROM ni un dispositivo potente. */
(() => {
  'use strict';
  const PREFIX = 'arcadia-gba-';
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const $ = s => document.querySelector(s);
  const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), n => CHARS[n % CHARS.length]).join('');
  const cleanCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const peerOpts = () => window.arcadiaOnline?.peerOptions || { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
  const hasPeer = () => typeof window.Peer === 'function';
  const eng = () => (typeof gbaEngine !== 'undefined' ? gbaEngine : null);
  const say = (m, e) => { try { notify(m, e); } catch { console.log(m); } };

  const style = document.createElement('style');
  style.textContent = `
  #glPanel{position:fixed;inset:0;z-index:310;display:none;place-items:center;background:#02050bee;padding:16px;overflow:auto}
  #glPanel.open{display:grid}
  #glPanel .gl-card{width:min(640px,100%);background:#141029;border:1px solid #4b3d8f;border-radius:18px;padding:clamp(14px,3vw,24px);color:#eee9ff;display:grid;gap:12px}
  #glPanel h2{margin:0;font-size:clamp(18px,3vw,24px)}#glPanel h3{margin:0;font-size:15px;color:#b9a8ff}
  #glPanel p{margin:0;color:#cfc6f5;font-size:14px;line-height:1.45}
  #glPanel .gl-sec{background:#0d0a1f;border:1px solid #382e70;border-radius:14px;padding:14px;display:grid;gap:10px}
  #glPanel .gl-code{font:800 clamp(38px,10vw,76px)/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;text-align:center;color:#c4f36a}
  #glPanel .gl-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  #glPanel button,#glPanel input{font:inherit;border-radius:10px;border:1px solid #5a4aa8;background:#251d4d;color:#fff;padding:9px 12px;min-height:42px}
  #glPanel button.primary{background:#5b3fd0;border-color:#8c75ff}#glPanel button.danger{background:#6d2530;border-color:#b24a5a}
  #glPanel input{text-transform:uppercase;letter-spacing:.3em;text-align:center;font-weight:700;font-size:20px;width:9em}
  #glPanel .gl-ok{color:#8fe39a}#glPanel .gl-warn{color:#ffb86b}
  #glPanel button:focus-visible,#glPanel input:focus-visible{outline:3px solid #c4f36a}
  #glChip{position:fixed;right:10px;bottom:8px;z-index:140;background:#000b;color:#d8ccff;font:600 12px system-ui,sans-serif;padding:5px 10px;border-radius:9px;pointer-events:none;display:none}
  #glChip.warn{color:#ffb86b}
  #glVideo{width:100%;height:100%;max-height:100%;aspect-ratio:3/2;object-fit:contain;image-rendering:pixelated;background:#000;display:block;margin:auto}
  .gba-head{overflow-x:auto!important;scrollbar-width:none}.gba-head::-webkit-scrollbar{display:none}
  .gba-head #gbaExit{position:sticky;right:0;z-index:3}
  @media (max-width:900px){.gba-head #gbaFullscreen{font-size:0!important}.gba-head #gbaFullscreen::after{content:'⛶';font-size:15px}.gba-head #gbaReset{font-size:0!important}.gba-head #gbaReset::after{content:'↻';font-size:15px}}
  `;
  document.head.appendChild(style);

  /* ───────────── estado ───────────── */
  const N = { peer: null, conn: null, call: null, role: '', code: '', active: false, status: 'Sin conexión', rtt: 0,
              A: null, B: null, cv: null, timer: 0, raf: 0, origRestart: null, video: null, proxy: null, fps: 0 };

  const send = o => { try { if (N.conn?.open) N.conn.send(o); } catch {} };
  const STEP_MS = 0.5;                                      // el cable se atiende cada medio milisegundo de juego

  /* ───────────── anfitrión: dos consolas, un cable ───────────── */
  function wire() {
    const a = N.A.core, b = N.B.core;
    for (const c of [a, b]) c.setIntervalRate(STEP_MS);
    N.Q = a.CPUCyclesPerIteration | 0;
    a.IOCore.serial.linkConnect(0, b.IOCore.serial);
    b.IOCore.serial.linkConnect(1, a.IOCore.serial);
  }
  async function startDual() {
    const A = eng();
    if (!A || !A.rom?.()) { say('Abre primero tu juego GBA y luego crea la sala.', true); return false; }
    N.status = 'Preparando la consola 2…'; render();
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:240px;height:160px';
    document.body.appendChild(cv);
    let B;
    try { B = await window.ArcadiaGBA.create(cv, { biosUrl: 'vendor/gba/bios.bin', saveKeyPrefix: 'gbaB:' }); }
    catch (e) { cv.remove(); say('No se pudo crear la consola 2: ' + (e?.message || e), true); return false; }
    const audio = B.audioStream();
    B.load(A.rom()); B.setExternalDriver(true); A.setExternalDriver(true);
    B.start();
    B.core.audioUnderrunAdjustment = function () { this.CPUCyclesTotal = this.CPUCyclesPerIteration | 0; };   // las dos consolas avanzan los mismos ciclos
    N.A = A; N.B = B; N.cv = cv;
    wire();
    N.origRestart = A.restart;
    A.restart = () => { N.origRestart(); try { B.restart(); } catch {} wire(); };
    startDriver();
    const tracks = [...cv.captureStream(60).getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
    try { N.call = N.peer.call(N.conn.peer, new MediaStream(tracks)); } catch (e) { say('No se pudo enviar el vídeo: ' + (e?.message || e), true); }
    N.active = true; N.status = 'Conectado: tú eres la consola 1';
    render();
    return true;
  }
  function startDriver() {
    let last = performance.now(), owed = 0;
    const tick = () => {
      const A = N.A, B = N.B; if (!A || !B) return;
      const now = performance.now(); owed += Math.min(now - last, 100); last = now;
      if (!A.isPlaying()) { owed = 0; return; }
      const a = A.core, b = B.core, Q = N.Q || 1;
      let n = 0;
      while (owed >= STEP_MS && n < 600) {
        const cb = a.IOCore.cyclesOveriteratedPreviously | 0;
        a.timerCallback(now | 0);
        const ran = Math.max(0, Q + cb - (a.IOCore.cyclesOveriteratedPreviously | 0));    // ciclos que de verdad avanzó la consola 1
        b.CPUCyclesPerIteration = ran; b.timerCallback(now | 0);
        owed -= STEP_MS * (ran / Q); n++;
      }
      if (owed > 100) owed = 0;
    };
    N.timer = setInterval(tick, 6);
    const loop = () => { if (!N.B) return; tick(); N.raf = requestAnimationFrame(loop); };
    N.raf = requestAnimationFrame(loop);
  }
  function stopDual() {
    clearInterval(N.timer); N.timer = 0; cancelAnimationFrame(N.raf);
    const { A, B, cv } = N; N.A = N.B = N.cv = null;
    try { A?.core.IOCore.serial.linkDisconnect(); } catch {}
    if (A) { if (N.origRestart) A.restart = N.origRestart; N.origRestart = null; try { A.core.setIntervalRate(8); A.setExternalDriver(false); A.start(); } catch {} }
    try { B?.destroy(); } catch {} try { cv?.remove(); } catch {}
  }

  /* ───────────── invitado: ve y controla la consola 2 ───────────── */
  const EMPTY_STAGE = '<div class="gba-empty" id="gbaEmpty"><strong>Tu próxima aventura portátil</strong><p>Carga tu archivo .gba para iniciar el emulador de Arcadia.</p><button class="btn primary" id="gbaChooseBig">Elegir archivo de juego</button></div>';
  function showViewer(stream) {
    try { if (typeof stopGbaEngine === 'function') stopGbaEngine(); } catch {}
    const stage = $('#gbaStage'); if (!stage) return;
    stage.innerHTML = '';
    const v = document.createElement('video'); v.id = 'glVideo'; v.autoplay = true; v.playsInline = true; v.srcObject = stream;
    stage.appendChild(v); N.video = v;
    const unmuteOnTouch = () => { v.muted = false; v.play?.().catch(() => {}); };
    v.play?.().catch(() => { v.muted = true; v.play?.().catch(() => {}); document.addEventListener('pointerdown', unmuteOnTouch, { once: true }); });
    const sendKey = (k, d) => send({ t: 'k', k: k | 0, d });
    N.proxy = {
      keyDown: k => sendKey(k, 1), keyUp: k => sendKey(k, 0), releaseAll() { for (let k = 0; k < 10; k++) sendKey(k, 0); },
      pause() {}, resume() {}, restart() {}, start() {}, destroy() {}, setSpeed() {}, setSmoothing() {}, saveNow() {},
      setMuted(m) { v.muted = !!m; }, setVolume(x) { v.volume = Math.max(0, Math.min(1, x)); },
      exportCurrentSave: () => null, importCurrentSave: async () => {}, title: () => 'Cable link', speed: () => 100, isPlaying: () => true, frames: () => 0,
      sound: { resume() { v.play?.().catch(() => {}); } }
    };
    try { gbaEngine = N.proxy; } catch {}
    try { $('#gbaStatus').textContent = 'Cable link · eres la consola 2 (el juego corre en el dispositivo del anfitrión)'; $('#gbaModal').classList.add('open'); window.gbaTouchApply?.(); } catch {}
    N.active = true; N.status = 'Conectado: tú eres la consola 2'; render();
  }
  function hideViewer() {
    if (!N.video) return;
    try { N.video.srcObject = null; } catch {}
    N.video = null;
    try { if (eng() === N.proxy) gbaEngine = null; } catch {}
    N.proxy = null;
    const stage = $('#gbaStage'); if (stage) { stage.innerHTML = EMPTY_STAGE; $('#gbaChooseBig')?.addEventListener('click', () => $('#gbaRomInput').click()); }
    const st = $('#gbaStatus'); if (st) st.textContent = 'Cable link cerrado.';
  }

  /* ───────────── conexión ───────────── */
  function stopLink(reason) {
    const was = N.active || !!N.conn;
    if (N.B) stopDual();
    hideViewer();
    try { N.call?.close(); } catch {} try { N.conn?.close(); } catch {} try { N.peer?.destroy(); } catch {}
    N.call = N.conn = N.peer = null; N.role = ''; N.code = ''; N.active = false;
    N.status = reason || 'Sin conexión';
    if (was && reason) say(reason);
    render();
  }
  function onMessage(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello' && N.role === 'host') startDual();
    else if (d.t === 'k') { if (N.B) { const k = d.k | 0; if (k >= 0 && k < 10) { d.d ? N.B.keyDown(k) : N.B.keyUp(k); } } }
    else if (d.t === 'ping') send({ t: 'pong', ts: d.ts });
    else if (d.t === 'pong') N.rtt = Math.round(performance.now() - d.ts);
    else if (d.t === 'bye') stopLink('El otro jugador se desconectó.');
  }
  function bindConn(conn) {
    N.conn = conn;
    conn.on('data', onMessage);
    const gone = () => { if (N.conn === conn) stopLink('Se perdió la conexión con el otro jugador.'); };
    conn.on('close', gone); conn.on('error', gone);
  }
  async function host() {
    if (N.peer) return;
    if (!hasPeer()) { say('No se cargó PeerJS. Revisa tu conexión y recarga Arcadia.', true); return; }
    if (!eng()?.rom?.()) { say('Primero abre tu juego GBA y luego crea la sala.', true); return; }
    N.status = 'Creando sala…'; render();
    try {
      let code = makeCode(), peer = null;
      for (let i = 0; i < 6; i++) {
        peer = new window.Peer(PREFIX + code, peerOpts());
        try {
          await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Tiempo agotado al contactar el servicio de conexión.')), 12000); peer.once('open', () => { clearTimeout(t); res(); }); peer.once('error', e => { clearTimeout(t); rej(e); }); });
          break;
        } catch (e) { try { peer.destroy(); } catch {} peer = null; if (e?.type === 'unavailable-id' || e?.type === 'id-taken') { code = makeCode(); continue; } throw e; }
      }
      if (!peer) throw new Error('No se pudo reservar una sala.');
      N.peer = peer; N.role = 'host'; N.code = code; N.status = 'Esperando al otro jugador…';
      peer.on('connection', conn => {
        if (N.conn) { try { conn.close(); } catch {} return; }
        bindConn(conn);
        conn.on('open', () => { N.status = 'Conectando…'; render(); });
      });
      peer.on('error', e => console.warn('Arcadia link:', e));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    } catch (e) { N.status = 'Sin conexión'; say(e?.message || 'No se pudo crear la sala.', true); }
    render();
  }
  async function join(codeRaw) {
    const code = cleanCode(codeRaw);
    if (code.length !== 5) { say('El código tiene 5 letras o números.', true); return; }
    if (!hasPeer()) { say('No se cargó PeerJS. Revisa tu conexión y recarga Arcadia.', true); return; }
    if (N.peer) stopLink();
    N.status = 'Conectando…'; render();
    try {
      const peer = new window.Peer(undefined, peerOpts()); N.peer = peer; N.role = 'guest'; N.code = code;
      peer.on('call', call => { call.answer(); N.call = call; call.on('stream', st => showViewer(st)); call.on('close', () => { if (N.role === 'guest' && N.active) stopLink('El anfitrión cerró la sala.'); }); });
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Tiempo agotado al contactar el servicio de conexión.')), 12000); peer.once('open', () => { clearTimeout(t); res(); }); peer.once('error', e => { clearTimeout(t); rej(e); }); });
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      bindConn(conn);
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('No se encontró la sala. Revisa el código y que el otro jugador tenga la sala abierta.')), 20000); conn.once('open', () => { clearTimeout(t); res(); }); conn.once('error', e => { clearTimeout(t); rej(e); }); });
      send({ t: 'hello' });
      N.status = 'Esperando el vídeo del anfitrión…';
    } catch (e) { const msg = e?.type === 'peer-unavailable' ? 'No se encontró esa sala. Revisa el código.' : (e?.message || 'No se pudo conectar.'); stopLink(null); N.status = 'Sin conexión'; say(msg, true); }
    render();
  }

  /* ───────────── interfaz ───────────── */
  const panel = document.createElement('div');
  panel.id = 'glPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Cable link GBA');
  panel.innerHTML = `<div class="gl-card"><h2>🔗 Cable link GBA por internet</h2><div id="glBody"></div><div class="gl-actions"><button id="glClose">Cerrar</button></div></div>`;
  document.body.appendChild(panel);
  const chip = Object.assign(document.createElement('div'), { id: 'glChip' });
  document.body.appendChild(chip);

  function render() {
    const body = $('#glBody'); if (!body) return;
    if (N.active) {
      const hostSide = N.role === 'host';
      body.innerHTML = `<div class="gl-sec"><h3>Conectado</h3><p class="gl-ok">${N.status}${N.rtt ? ' · latencia ' + N.rtt + ' ms' : ''}</p>
        <p>${hostSide ? 'Tu dispositivo emula las dos consolas unidas por el cable. Entren los dos al menú del cable del juego (en Mario Kart: Multi-Pak Link). La partida de la consola 2 se guarda en este dispositivo.' : 'Ves y controlas la consola 2. Usa los botones de pantalla, el teclado o tu mando.'}</p>
        <div class="gl-actions"><button class="danger" id="glStop">Desconectar</button></div></div>`;
      $('#glStop').onclick = () => { send({ t: 'bye' }); stopLink('Desconectado.'); };
    } else if (N.peer && N.role === 'host') {
      body.innerHTML = `<div class="gl-sec"><h3>Tu código</h3><div class="gl-code">${N.code}</div><p>${N.status} Pídele al otro jugador que abra Arcadia → GBA → 🔗 Link → Unirse, y escriba este código. No necesita el juego.</p>
        <div class="gl-actions"><button class="danger" id="glStop">Cancelar</button></div></div>`;
      $('#glStop').onclick = () => stopLink('Sala cerrada.');
    } else {
      const e = eng();
      body.innerHTML = `<div class="gl-sec"><p>Une dos consolas GBA como con un cable. <b>Quien crea la sala</b> abre su juego (por ejemplo Mario Kart Super Circuit) y su dispositivo emula las dos consolas; <b>quien se une</b> no necesita ROM: ve y controla la consola 2.</p>${e?.rom?.() ? '' : '<p class="gl-warn">Para crear una sala abre primero tu juego GBA. Para unirte no hace falta.</p>'}
        <h3>Crear sala (consola 1)</h3><div class="gl-actions"><button class="primary" id="glHost">Crear sala</button></div>
        <h3>Unirse con un código (consola 2)</h3><div class="gl-actions"><input id="glCode" maxlength="5" placeholder="CÓDIGO" autocapitalize="characters" autocomplete="off" aria-label="Código de la sala"><button class="primary" id="glJoin">Unirse</button></div>
        <p>${N.status}</p></div>`;
      $('#glHost').onclick = host; $('#glJoin').onclick = () => join($('#glCode').value);
      $('#glCode').addEventListener('input', ev => { ev.target.value = cleanCode(ev.target.value); });
    }
  }
  const openPanel = () => { panel.classList.add('open'); render(); };
  const closePanel = () => panel.classList.remove('open');
  $('#glClose').onclick = closePanel;
  panel.addEventListener('pointerdown', ev => { if (ev.target === panel) closePanel(); });
  for (const ev of ['keydown', 'keyup']) window.addEventListener(ev, e => { if (panel.classList.contains('open') && panel.contains(e.target)) { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') closePanel(); if (ev === 'keydown' && e.key === 'Enter' && e.target.id === 'glCode') $('#glJoin')?.click(); } }, true);

  function addButton() {
    const bar = $('.gba-head'); if (!bar || $('#gbaLinkBtn')) return;
    const b = document.createElement('button'); b.className = 'btn'; b.id = 'gbaLinkBtn'; b.textContent = '🔗 Link'; b.title = 'Cable link por internet'; b.setAttribute('aria-label', 'Cable link por internet');
    b.onclick = openPanel; bar.insertBefore(b, $('#gbaSettingsBtn'));
  }
  addButton();

  setInterval(() => {
    if (N.active) {
      if (N.role === 'guest') send({ t: 'ping', ts: performance.now() });
      chip.style.display = $('#gbaModal')?.classList.contains('open') ? 'block' : 'none';
      chip.textContent = N.role === 'host' ? `🔗 Cable · J1 (tú) y J2 en línea` : `🔗 Cable · J2 · ${N.rtt || '…'} ms`;
      if (panel.classList.contains('open')) render();
    } else chip.style.display = 'none';
  }, 1500);

  window.arcadiaGbaLink = { open: openPanel, host, join, stop: () => stopLink('Desconectado.'), state: N };
})();
