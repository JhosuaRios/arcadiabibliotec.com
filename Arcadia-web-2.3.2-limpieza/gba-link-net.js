(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['gba-link-net.js']='2.3.2';
/* Arcadia · Cable link GBA por internet (v2.3.0)
 * Dos consolas GBA (una en cada dispositivo) se unen con un código, como con un cable link.
 * Funciona con cualquier ROM que use el cable en modo multijugador.
 * Sincronización: cada consola envía un paquete en cada cuadro; el intercambio del cuadro N se aplica en las dos
 * consolas D cuadros después (D se ajusta a la latencia). Si falta un paquete, la emulación espera. */
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
  const BLANK = { send: 0xFFFF, start: false };

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
  .gba-head{overflow-x:auto!important;scrollbar-width:none}.gba-head::-webkit-scrollbar{display:none}
  .gba-head #gbaExit{position:sticky;right:0;z-index:3}
  @media (max-width:900px){.gba-head #gbaFullscreen{font-size:0!important}.gba-head #gbaFullscreen::after{content:'⛶';font-size:15px}.gba-head #gbaReset{font-size:0!important}.gba-head #gbaReset::after{content:'↻';font-size:15px}}
  `;
  document.head.appendChild(style);

  /* ───────────── estado ───────────── */
  const N = { peer: null, conn: null, role: '', code: '', id: 0, D: 4, F: 0, applied: 0, L: {}, R: {}, active: false, eng: null,
              rtt: 0, lastRx: 0, stallSince: 0, remote: null, status: 'Sin conexión', warn: '', pingT: 0, sent: 0, got: 0, transfers: 0 };

  const localInfo = () => { const e = eng(); return { title: (e?.title?.() || '').slice(0, 40), file: (typeof gbaCurrentRom !== 'undefined' ? gbaCurrentRom : '') }; };
  const send = o => { try { if (N.conn?.open) N.conn.send(o); } catch {} };

  function hookEngine() {
    const e = eng(); if (!e) return false;
    if (N.eng === e) return true;
    N.eng = e;
    e.linkConnect(N.id, true);
    e.onFrame(onFrame);
    e.setLinkGate(gate);
    return true;
  }
  function startLink() {
    if (N.active) return;
    N.F = 0; N.applied = 0; N.L = {}; N.R = {}; N.stallSince = 0; N.sent = 0; N.got = 0; N.transfers = 0; N.eng = null;
    N.active = true;
    try { if (typeof gbaSetTurbo === 'function') gbaSetTurbo(false); } catch {}
    hookEngine();
    N.status = 'Conectado como consola ' + (N.id + 1);
    N.warn = (N.remote && localInfo().title && N.remote.title && localInfo().title !== N.remote.title) ? `Juegos distintos: tú ${localInfo().title} · el otro ${N.remote.title}. Es normal entre versiones compatibles (por ejemplo Rubí y Zafiro).` : '';
    render();
  }
  function stopLink(reason) {
    const was = N.active || !!N.conn;
    N.active = false;
    try { N.eng?.linkDisconnect(); } catch {}
    try { eng()?.linkDisconnect(); } catch {}
    N.eng = null; N.L = {}; N.R = {};
    try { N.conn?.close(); } catch {} try { N.peer?.destroy(); } catch {}
    N.conn = null; N.peer = null; N.role = ''; N.code = ''; N.remote = null;
    N.status = reason || 'Sin conexión';
    if (was && reason) { try { notify(reason); } catch {} }
    render();
  }

  /* ───────────── sincronización por cuadros ───────────── */
  function onFrame() {
    if (!N.active) return;
    N.F++;
    const e = eng(); let p = null;
    try { p = e?.linkOut(); } catch {}
    p = p || BLANK;
    N.L[N.F] = p;
    send({ t: 'f', n: N.F, p });
    N.sent++;
    if (N.F % 90 === 0) send({ t: 'ping', ts: performance.now() });
  }
  function applyExchange(n) {
    const a = N.id === 0 ? [N.L[n], N.R[n]] : [N.R[n], N.L[n]];
    let ok = false;
    try { ok = eng()?.linkIn(a); } catch {}
    if (ok) N.transfers++;
    delete N.L[n]; delete N.R[n];
  }
  function gate() {
    if (!N.active) return true;
    if (eng() !== N.eng) hookEngine();
    let n = N.applied + 1;
    while (n <= N.F - N.D) {
      if (N.L[n] && N.R[n]) { applyExchange(n); N.applied = n; n++; }
      else { if (!N.stallSince) N.stallSince = performance.now(); return false; }
    }
    N.stallSince = 0;
    return true;
  }
  function onMessage(d) {
    if (!d || typeof d !== 'object') return;
    N.lastRx = performance.now();
    if (d.t === 'f') { if (d.n > N.applied) { N.R[d.n] = d.p || BLANK; N.got++; } }
    else if (d.t === 'ping') send({ t: 'pong', ts: d.ts });
    else if (d.t === 'pong') { N.rtt = Math.round(performance.now() - d.ts); autoDelay(); }
    else if (d.t === 'cfg') { N.D = Math.min(10, Math.max(2, d.D | 0)); }
    else if (d.t === 'hello') { N.remote = d.info || {}; if (N.role === 'host') send({ t: 'hello', info: localInfo() }); startLink(); }
    else if (d.t === 'bye') stopLink('El otro jugador se desconectó.');
  }
  function autoDelay() {                                     // solo manda el anfitrión; el invitado sigue su valor
    if (N.role !== 'host' || !N.active) return;
    const want = Math.min(8, Math.max(3, Math.ceil(N.rtt / 33.3) + 2));
    if (want !== N.D && (want > N.D || N.D - want >= 2)) { N.D = want; send({ t: 'cfg', D: N.D }); }
  }

  /* ───────────── conexión ───────────── */
  function bindConn(conn) {
    N.conn = conn;
    conn.on('data', onMessage);
    const gone = () => { if (N.conn === conn) stopLink('Se perdió la conexión con el otro jugador.'); };
    conn.on('close', gone); conn.on('error', gone);
  }
  async function host() {
    if (N.peer) return;
    if (!hasPeer()) { say('No se cargó PeerJS. Revisa tu conexión y recarga Arcadia.', true); return; }
    if (!eng()) { say('Primero abre tu juego GBA y luego crea la sala.', true); return; }
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
      N.peer = peer; N.role = 'host'; N.id = 0; N.code = code; N.status = 'Esperando al otro jugador…';
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
    if (!eng()) { say('Primero abre tu juego GBA y luego únete.', true); return; }
    if (N.peer) stopLink();
    N.status = 'Conectando…'; render();
    try {
      const peer = new window.Peer(undefined, peerOpts()); N.peer = peer; N.role = 'guest'; N.id = 1; N.code = code;
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Tiempo agotado al contactar el servicio de conexión.')), 12000); peer.once('open', () => { clearTimeout(t); res(); }); peer.once('error', e => { clearTimeout(t); rej(e); }); });
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      bindConn(conn);
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('No se encontró la sala. Revisa el código y que el otro jugador tenga la sala abierta.')), 20000); conn.once('open', () => { clearTimeout(t); res(); }); conn.once('error', e => { clearTimeout(t); rej(e); }); });
      send({ t: 'hello', info: localInfo() });
    } catch (e) { const msg = e?.type === 'peer-unavailable' ? 'No se encontró esa sala. Revisa el código.' : (e?.message || 'No se pudo conectar.'); stopLink(null); N.status = 'Sin conexión'; say(msg, true); }
    render();
  }
  const say = (m, e) => { try { notify(m, e); } catch { console.log(m); } };

  /* ───────────── interfaz ───────────── */
  const panel = document.createElement('div');
  panel.id = 'glPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Cable link GBA');
  panel.innerHTML = `<div class="gl-card"><h2>🔗 Cable link GBA por internet</h2><div id="glBody"></div><div class="gl-actions"><button id="glClose">Cerrar</button></div></div>`;
  document.body.appendChild(panel);
  const chip = Object.assign(document.createElement('div'), { id: 'glChip' });
  document.body.appendChild(chip);

  function render() {
    const body = $('#glBody'); if (!body) return;
    const e = eng();
    if (N.active) {
      body.innerHTML = `<div class="gl-sec"><h3>Conectado</h3><p class="gl-ok">${N.status} · latencia ${N.rtt || '…'} ms · retraso ${N.D} cuadros</p>${N.warn ? `<p class="gl-warn">${N.warn}</p>` : ''}
        <p>Ahora, en el juego, usen la opción del cable (en Pokémon: hablar con la recepcionista del Centro Pokémon → Club de cable). Intercambios hechos: <b>${N.transfers}</b>.</p>
        <div class="gl-actions"><button class="danger" id="glStop">Desconectar</button></div></div>`;
      $('#glStop').onclick = () => { send({ t: 'bye' }); stopLink('Desconectado.'); };
    } else if (N.peer && N.role === 'host') {
      body.innerHTML = `<div class="gl-sec"><h3>Tu código</h3><div class="gl-code">${N.code}</div><p>${N.status} Pídele al otro jugador que abra Arcadia → su juego GBA → 🔗 Link → Unirse, y escriba este código. Los dos deben tener el juego abierto.</p>
        <div class="gl-actions"><button class="danger" id="glStop">Cancelar</button></div></div>`;
      $('#glStop').onclick = () => stopLink('Sala cerrada.');
    } else {
      body.innerHTML = `<div class="gl-sec"><p>Une dos consolas GBA como con un cable. Cada jugador usa su propio juego (Pokémon, etc.). Abre tu juego GBA primero.</p>${e ? '' : '<p class="gl-warn">Aún no hay un juego GBA abierto en este dispositivo.</p>'}
        <h3>Crear sala</h3><div class="gl-actions"><button class="primary" id="glHost">Crear sala (consola 1)</button></div>
        <h3>Unirse con un código</h3><div class="gl-actions"><input id="glCode" maxlength="5" placeholder="CÓDIGO" autocapitalize="characters" autocomplete="off" aria-label="Código de la sala"><button class="primary" id="glJoin">Unirse (consola 2)</button></div>
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

  setInterval(() => {                                      // estado visible + vigilancia
    if (N.active) {
      if (eng() && eng() !== N.eng) hookEngine();
      const stalled = N.stallSince ? performance.now() - N.stallSince : 0;
      chip.style.display = $('#gbaModal')?.classList.contains('open') ? 'block' : 'none';
      chip.classList.toggle('warn', stalled > 1500);
      chip.textContent = stalled > 1500 ? '🔗 Esperando al otro jugador…' : `🔗 Link · J${N.id + 1} · ${N.rtt || '…'} ms`;
      if (stalled > 25000) stopLink('Se perdió la conexión con el otro jugador.');
      if (panel.classList.contains('open')) render();
    } else chip.style.display = 'none';
  }, 700);

  window.arcadiaGbaLink = { open: openPanel, host, join, stop: () => stopLink('Desconectado.'), state: N };
})();
