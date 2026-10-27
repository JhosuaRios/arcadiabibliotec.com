(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['gba-link-net.js']='2.4.1';
/* Arcadia · Cable link GBA por internet: cada dispositivo emula las dos consolas y solo se intercambian los botones (lockstep). */
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
  const N = { peer: null, conn: null, role: '', code: '', active: false, starting: false, status: 'Sin conexión', rtt: 0, d: 0,
              mine: null, ghost: null, cv: null, timer: 0, raf: 0, frame: 0, step: 0, idx: 0, loc: {}, rem: {}, cur: [0, 0],
              held: 0, tapped: 0, orig: null, stalls: 0 };
  const send = o => { try { if (N.conn?.open) N.conn.send(o); } catch {} };
  const STEP_MS = 0.5;                                      // el cable se atiende cada medio milisegundo de juego
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const romHash = u8 => { let h = 2166136261; for (let i = 0; i < u8.length; i += 7) h = Math.imul(h ^ u8[i], 16777619); return (h >>> 0).toString(16) + ':' + u8.length; };
  const mySave = () => { try { const x = N.mine.exportCurrentSave(); return x ? b64(x) : ''; } catch { return ''; } };

  /* Cada dispositivo emula LAS DOS consolas (la suya y una copia de la otra) con exactamente los mismos ciclos y se
   * intercambian solo los botones, aplicados el mismo cuadro en ambos lados (lockstep). Así el cable interno responde
   * al instante aunque la red tarde, y no se envía vídeo. */
  async function begin(remoteSaveB64, d) {
    const mine = eng();
    if (!mine?.rom?.()) { stopLink('Abre primero tu juego GBA.'); return; }
    N.starting = true; N.status = 'Preparando las dos consolas…'; render();
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:240px;height:160px';
    document.body.appendChild(cv);
    let g;
    try {
      g = await window.ArcadiaGBA.create(cv, { biosUrl: 'vendor/gba/bios.bin', saveKeyPrefix: 'gbaG:' });
      g.audioStream();                                      // la consola copia no suena en tus altavoces
      g.load(mine.rom()); await g.deleteSave();
      if (remoteSaveB64) await g.importCurrentSave(unb64(remoteSaveB64)); else g.restart();
    } catch (e) { cv.remove(); stopLink('No se pudo crear la segunda consola: ' + (e?.message || e)); return; }
    g.setExternalDriver(true); mine.setExternalDriver(true); g.start();
    const cores = [mine.core, g.core]; const own = [];
    for (const c of cores) { own.push([Object.prototype.hasOwnProperty.call(c, 'audioUnderrunAdjustment'), c.audioUnderrunAdjustment]); c.audioUnderrunAdjustment = function () { this.CPUCyclesTotal = this.CPUCyclesPerIteration | 0; }; c.setIntervalRate(STEP_MS); }
    N.mine = mine; N.ghost = g; N.cv = cv; N.d = d; N.idx = N.role === 'host' ? 0 : 1;
    // entradas locales: se guardan y se aplican en el cuadro acordado
    N.orig = { kd: mine.keyDown, ku: mine.keyUp, ra: mine.releaseAll, rs: mine.restart, own };
    N.held = 0; N.tapped = 0;
    mine.keyDown = k => { k |= 0; if (k >= 0 && k < 10) { N.held |= 1 << k; N.tapped |= 1 << k; } };
    mine.keyUp = k => { k |= 0; if (k >= 0 && k < 10) N.held &= ~(1 << k); };
    mine.releaseAll = () => { N.held = 0; };
    mine.restart = () => stopLink('Reiniciar el juego cierra el cable link.');
    mine.core.restart(); g.core.restart();
    const c0 = N.idx === 0 ? mine.core : g.core, c1 = N.idx === 0 ? g.core : mine.core;
    c0.IOCore.serial.linkConnect(0, c1.IOCore.serial); c1.IOCore.serial.linkConnect(1, c0.IOCore.serial);
    N.c0 = c0; N.c1 = c1; N.Q = c0.CPUCyclesPerIteration | 0;
    N.loc = {}; N.rem = {}; N.cur = [0, 0]; N.frame = 0; N.step = 0;
    for (let f = 0; f < d; f++) { N.loc[f] = 0; N.rem[f] = 0; }
    startDriver();
    N.starting = false; N.active = true; N.status = 'Conectado: tú eres la consola ' + (N.idx + 1);
    render();
  }
  function applyMask(i, core, m) {
    const prev = N.cur[i]; if (prev === m) return;
    for (let k = 0; k < 10; k++) { const bit = 1 << k; if ((prev ^ m) & bit) { if (m & bit) core.keyDown(k); else core.keyUp(k); } }
    N.cur[i] = m;
  }
  function startDriver() {
    let last = performance.now(), owed = 0;
    const tick = () => {
      if (!N.mine) return;
      const now = performance.now(); owed += Math.min(now - last, 100); last = now;
      if (!N.mine.isPlaying()) { owed = 0; return; }
      const { c0, c1, Q } = N; let n = 0;
      while (owed >= STEP_MS && n < 400) {
        if (N.step === 0) {
          const f = N.frame;
          if (N.rem[f] === undefined) { N.stalls++; if (owed > 60) owed = 60; break; }       // esperando los botones del otro jugador
          const mi = N.loc[f], ri = N.rem[f];
          applyMask(N.idx, N.mine.core, mi); applyMask(1 - N.idx, N.ghost.core, ri);
          const m = (N.held | N.tapped) & 1023; N.tapped = 0;
          N.loc[f + N.d] = m; send({ t: 'i', f: f + N.d, m });
          delete N.loc[f - 2]; delete N.rem[f - 2];
        }
        const cb = c0.IOCore.cyclesOveriteratedPreviously | 0;
        c0.timerCallback(0);
        const ran = Math.max(0, Q + cb - (c0.IOCore.cyclesOveriteratedPreviously | 0));
        c1.CPUCyclesPerIteration = ran; c1.timerCallback(0);
        owed -= STEP_MS * (ran / Q); n++;
        if (++N.step >= 33 + ((N.frame & 3) === 3 ? 1 : 0)) { N.step = 0; N.frame++; }
      }
      if (owed > 100) owed = 0;
    };
    N.timer = setInterval(tick, 6);
    const loop = () => { if (!N.mine) return; tick(); N.raf = requestAnimationFrame(loop); };
    N.raf = requestAnimationFrame(loop);
  }
  function stopDual() {
    clearInterval(N.timer); N.timer = 0; cancelAnimationFrame(N.raf);
    const { mine, ghost, cv, orig } = N; N.mine = N.ghost = N.cv = null; N.orig = null;
    if (mine && orig) {
      try { mine.core.IOCore.serial.linkDisconnect(); } catch {}
      mine.keyDown = orig.kd; mine.keyUp = orig.ku; mine.releaseAll = orig.ra; mine.restart = orig.rs;
      try { const c = mine.core; if (orig.own[0][0]) c.audioUnderrunAdjustment = orig.own[0][1]; else delete c.audioUnderrunAdjustment; c.setIntervalRate(8); for (let k = 0; k < 10; k++) c.keyUp(k); mine.setExternalDriver(false); mine.start(); } catch {}
    }
    try { ghost?.destroy(); } catch {} try { cv?.remove(); } catch {}
  }

  /* ───────────── conexión ───────────── */
  function stopLink(reason) {
    const was = N.active || N.starting || !!N.conn;
    if (N.mine) stopDual();
    try { N.conn?.close(); } catch {} try { N.peer?.destroy(); } catch {}
    N.conn = N.peer = null; N.role = ''; N.code = ''; N.active = false; N.starting = false;
    N.status = reason || 'Sin conexión';
    if (was && reason) say(reason);
    render();
  }
  function sendInit(withD) {
    const e = eng(); const o = { t: 'init', h: romHash(e.rom()), save: mySave() };
    if (withD) o.d = withD; send(o);
  }
  function onMessage(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'init') {
      const e = eng(); if (!e?.rom?.()) { send({ t: 'bye', why: 'El otro jugador no tiene un juego abierto.' }); return; }
      if (d.h !== romHash(e.rom())) { send({ t: 'bye', why: 'Los dos deben abrir exactamente el mismo juego (.gba).' }); stopLink('Los dos deben abrir exactamente el mismo juego (.gba).'); return; }
      if (N.role === 'host') {
        const dly = Math.max(5, Math.min(30, Math.ceil(((N.rtt || 120) / 2 + 45) / 16.6) + 1));
        sendInit(dly); begin(d.save, dly);
      } else begin(d.save, d.d | 0 || 12);
    }
    else if (d.t === 'i') { N.rem[d.f | 0] = d.m | 0; }
    else if (d.t === 'ping') send({ t: 'pong', ts: d.ts });
    else if (d.t === 'pong') N.rtt = Math.round(performance.now() - d.ts);
    else if (d.t === 'bye') stopLink(d.why || 'El otro jugador se desconectó.');
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
        conn.on('open', () => { N.status = 'Conectando…'; render(); send({ t: 'ping', ts: performance.now() }); });
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
    if (!eng()?.rom?.()) { say('Abre primero el mismo juego GBA que tu amigo y luego únete.', true); return; }
    if (N.peer) stopLink();
    N.status = 'Conectando…'; render();
    try {
      const peer = new window.Peer(undefined, peerOpts()); N.peer = peer; N.role = 'guest'; N.code = code;
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Tiempo agotado al contactar el servicio de conexión.')), 12000); peer.once('open', () => { clearTimeout(t); res(); }); peer.once('error', e => { clearTimeout(t); rej(e); }); });
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      bindConn(conn);
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('No se encontró la sala. Revisa el código y que el otro jugador tenga la sala abierta.')), 20000); conn.once('open', () => { clearTimeout(t); res(); }); conn.once('error', e => { clearTimeout(t); rej(e); }); });
      sendInit(0);
      N.status = 'Sincronizando las consolas…';
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
        <p>${hostSide ? `Cada dispositivo corre su consola y una copia de la otra; solo viajan los botones (retraso de entrada ≈ ${Math.round(N.d*16.6)} ms). Entren los dos al menú del cable del juego (en Mario Kart: Multi-Pak Link). Tu partida se guarda solo en tu dispositivo.` : 'Cada dispositivo corre su consola y una copia de la otra; solo viajan los botones. Entren los dos al menú del cable del juego. Tu partida se guarda solo en tu dispositivo.'}</p>
        <div class="gl-actions"><button class="danger" id="glStop">Desconectar</button></div></div>`;
      $('#glStop').onclick = () => { send({ t: 'bye' }); stopLink('Desconectado.'); };
    } else if (N.peer && N.role === 'host') {
      body.innerHTML = `<div class="gl-sec"><h3>Tu código</h3><div class="gl-code">${N.code}</div><p>${N.status} El otro jugador debe abrir el MISMO juego .gba en su Arcadia → 🔗 Link → Unirse, y escribir este código.</p>
        <div class="gl-actions"><button class="danger" id="glStop">Cancelar</button></div></div>`;
      $('#glStop').onclick = () => stopLink('Sala cerrada.');
    } else {
      const e = eng();
      body.innerHTML = `<div class="gl-sec"><p>Une dos consolas GBA como con un cable, cada una en su dispositivo. <b>Los dos abren el mismo juego .gba</b> (por ejemplo Mario Kart Super Circuit); uno crea la sala y el otro se une con el código. Cada dispositivo emula las dos consolas y solo se envían los botones.</p>${e?.rom?.() ? '' : '<p class="gl-warn">Abre primero tu juego GBA.</p>'}
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
      send({ t: 'ping', ts: performance.now() });
      chip.style.display = $('#gbaModal')?.classList.contains('open') ? 'block' : 'none';
      chip.textContent = N.role === 'host' ? `🔗 Cable · J1 · ${N.rtt || '…'} ms` : `🔗 Cable · J2 · ${N.rtt || '…'} ms`;
      if (panel.classList.contains('open')) render();
    } else chip.style.display = 'none';
  }, 1500);

  window.arcadiaGbaLink = { open: openPanel, host, join, stop: () => stopLink('Desconectado.'), state: N };
})();
