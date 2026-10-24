/* Arcadia · Mandos con el celular (v2.2.0)
 * La pantalla (TV, PC o tablet) crea una sala con un código; cada celular se conecta como mando (PeerJS directo)
 * y actúa como Jugador 1 o 2. Sirve para NES y para GBA. Dentro de una sala online el celular es "tu mando".
 * Bits del mando (compartidos con el celular): 0 arriba, 1 abajo, 2 izq, 3 der, 4 A, 5 B, 6 L, 7 R, 8 Start, 9 Select. */
(() => {
  'use strict';
  const PREFIX = 'arcadia-pad-';
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const BITS = ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'];
  const GBA_KEY = { up: 6, down: 7, left: 5, right: 4, a: 0, b: 1, l: 9, r: 8, start: 3, select: 2 };
  const $ = s => document.querySelector(s);
  const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), n => CHARS[n % CHARS.length]).join('');
  const cleanCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const ls = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const peerOpts = () => window.arcadiaOnline?.peerOptions || { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
  const say = (m, e) => { try { notify(m, e); } catch { console.log(m); } };
  const hasPeer = () => typeof window.Peer === 'function';

  /* ───────────── estilos ───────────── */
  const style = document.createElement('style');
  style.textContent = `
  #ppPanel{position:fixed;inset:0;z-index:300;display:none;place-items:center;background:#02050bee;padding:16px;overflow:auto}
  #ppPanel.open{display:grid}
  #ppPanel .pp-card{width:min(720px,100%);background:#101a24;border:1px solid #2c4256;border-radius:18px;padding:clamp(14px,3vw,26px);color:#eaf3ff;display:grid;gap:14px}
  #ppPanel h2{margin:0;font-size:clamp(18px,3vw,26px)}#ppPanel h3{margin:0;font-size:15px;color:#9fc4e8}
  #ppPanel p{margin:0;color:#b9cde0;font-size:14px;line-height:1.45}
  #ppPanel .pp-sec{background:#0b131b;border:1px solid #243645;border-radius:14px;padding:14px;display:grid;gap:10px}
  #ppPanel .pp-code{font:800 clamp(40px,10vw,84px)/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;text-align:center;color:#c4f36a}
  #ppPanel .pp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#142230;border-radius:10px;padding:8px 10px}
  #ppPanel .pp-row b{flex:1;min-width:110px}
  #ppPanel .pp-row .st{font-size:12px;color:#8fe39a}#ppPanel .pp-row .st.bad{color:#ffb86b}
  #ppPanel button,#ppPanel input{font:inherit;border-radius:10px;border:1px solid #35516b;background:#1a2c3d;color:#fff;padding:9px 12px;min-height:40px}
  #ppPanel button.on{background:#4d813d;border-color:#8fd35e}
  #ppPanel button.primary{background:#3b7fd0;border-color:#6aa8ee}
  #ppPanel button.danger{background:#6d2530;border-color:#b24a5a}
  #ppPanel input{text-transform:uppercase;letter-spacing:.3em;text-align:center;font-weight:700;font-size:20px;width:9em}
  #ppPanel .pp-actions{display:flex;gap:8px;flex-wrap:wrap}
  #ppPanel button:focus-visible,#ppPanel input:focus-visible{outline:3px solid #c4f36a}
  #ppView{position:fixed;inset:0;z-index:2000;background:#06090f;color:#fff;display:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;overflow:hidden;font-family:system-ui,sans-serif}
  #ppView.open{display:block}
  #ppView .pp-top{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:13px;color:#9fb8d0;z-index:3}
  #ppView .pp-top b{color:#c4f36a;font-size:15px}
  #ppView .pp-x{background:#1c2733;border:1px solid #3b5268;color:#fff;border-radius:10px;padding:7px 12px;font-size:13px}
  #ppView .pp-dpad{position:absolute;left:4vw;bottom:8vh;width:min(42vh,34vw);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,#1b2735 0 38%,#121b26 39% 100%);border:2px solid #2e4358;touch-action:none}
  #ppView .pp-dpad i{position:absolute;font-style:normal;color:#5d7893;font-size:clamp(18px,5vh,34px);display:grid;place-items:center;width:30%;height:30%}
  #ppView .pp-dpad i.on{color:#c4f36a;text-shadow:0 0 12px #c4f36a}
  #ppView .pp-dpad i[data-d=up]{left:35%;top:4%}#ppView .pp-dpad i[data-d=down]{left:35%;bottom:4%}
  #ppView .pp-dpad i[data-d=left]{left:4%;top:35%}#ppView .pp-dpad i[data-d=right]{right:4%;top:35%}
  #ppView .pp-face{position:absolute;right:4vw;bottom:8vh;width:min(46vh,38vw);aspect-ratio:1.25}
  #ppView button.pp-b{position:absolute;border-radius:50%;border:2px solid #3b5268;background:linear-gradient(145deg,#2a3c4f,#141f2b);color:#fff;font-weight:800;touch-action:none;display:grid;place-items:center;padding:0}
  #ppView button.pp-b.on{background:linear-gradient(145deg,#c4f36a,#4d813d);color:#10230a;transform:scale(.94)}
  #ppView .pp-a{right:0;top:6%;width:48%;aspect-ratio:1;font-size:clamp(20px,6vh,38px);background:linear-gradient(145deg,#d66a6a,#7e2430)}
  #ppView .pp-bb{left:0;bottom:0;width:48%;aspect-ratio:1;font-size:clamp(20px,6vh,38px);background:linear-gradient(145deg,#58b8ec,#175580)}
  #ppView .pp-a.on,#ppView .pp-bb.on{background:linear-gradient(145deg,#c4f36a,#4d813d)}
  #ppView .pp-sys{position:absolute;left:50%;bottom:7vh;transform:translateX(-50%);display:flex;gap:14px}
  #ppView .pp-sys button.pp-b{position:static;border-radius:999px;width:auto;padding:12px 20px;font-size:13px;letter-spacing:.06em}
  #ppView .pp-sh{position:absolute;top:44px;width:30vw;height:15vh;border-radius:14px!important;font-size:18px}
  #ppView .pp-l{left:3vw}#ppView .pp-r{right:3vw}
  #ppView:not(.gba) .pp-sh{display:none}
  #ppView .pp-msg{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:15px;color:#9fb8d0;padding:0 24px;pointer-events:none}
  #ppView .pp-rot{display:none;position:absolute;left:0;right:0;top:44px;text-align:center;color:#ffb86b;font-size:13px;pointer-events:none}
  @media (orientation:portrait){#ppView .pp-rot{display:block}#ppView .pp-dpad{width:42vw;bottom:14vh}#ppView .pp-face{width:46vw;bottom:14vh}#ppView .pp-sys{bottom:3vh}}
  `;
  document.head.appendChild(style);

  /* ───────────── ANFITRIÓN (pantalla) ───────────── */
  const H = { peer: null, code: '', pads: new Map(), applied: { 1: 0, 2: 0 }, at: 'none', opening: false, seq: 0 };

  const activeConsole = () => {
    if ($('#gbaModal')?.classList.contains('open')) return 'gba';
    if ($('#gameSession')?.classList.contains('open')) return 'nes';
    return 'none';
  };
  const isOnline = () => { const o = window.arcadiaOnline; return !!(o?.isGuest?.() || o?.isLockstep?.() || o?.isHosting?.()); };

  function setBtn(consoleName, slot, name, down) {
    try {
      if (consoleName === 'gba') {
        if (typeof gbaEngine === 'undefined' || !gbaEngine) return;
        const k = GBA_KEY[name]; if (k == null) return;
        down ? gbaEngine.keyDown(k) : gbaEngine.keyUp(k);
      } else if (consoleName === 'nes') {
        if (typeof nesBrowser === 'undefined' || !nesBrowser) return;
        const C = window.jsnes?.Controller; if (!C || name === 'l' || name === 'r') return;
        const id = { a: C.BUTTON_A, b: C.BUTTON_B, start: C.BUTTON_START, select: C.BUTTON_SELECT, up: C.BUTTON_UP, down: C.BUTTON_DOWN, left: C.BUTTON_LEFT, right: C.BUTTON_RIGHT }[name];
        if (id == null) return;
        if (slot === 2 && !isOnline()) down ? nesBrowser.nes.buttonDown(2, id) : nesBrowser.nes.buttonUp(2, id);
        else nesPadSet(id, down);
      }
    } catch (e) { console.warn('Arcadia mando:', e); }
  }
  function slotMasks() {
    const m = { 1: 0, 2: 0 }, now = performance.now();
    for (const p of H.pads.values()) {
      if (!p.slot || now - p.seen > 2500) continue;      // sin señal: sus botones se sueltan
      m[p.slot] |= p.mask;
    }
    if (H.at === 'gba' || isOnline()) { m[1] |= m[2]; m[2] = 0; }
    return m;
  }
  function recompute() {
    const target = slotMasks();
    if (H.at === 'none') {                               // sin juego abierto: el celular mueve el cursor de los menús
      const m = target[1] | target[2], diff = (H.navMask | 0) ^ m;
      if (diff) { ['up', 'down', 'left', 'right', 'a', 'b', 'start'].forEach(n => { const i = BITS.indexOf(n); if (diff & (1 << i)) window.arcadiaTV?.navHold(n, !!(m & (1 << i))); }); H.navMask = m; }
      return;
    }
    for (const slot of [1, 2]) {
      const diff = H.applied[slot] ^ target[slot];
      if (!diff) continue;
      BITS.forEach((n, i) => { if (diff & (1 << i)) setBtn(H.at, slot, n, !!(target[slot] & (1 << i))); });
      H.applied[slot] = target[slot];
    }
  }
  function releaseAll() {
    for (const slot of [1, 2]) BITS.forEach((n, i) => { if (H.applied[slot] & (1 << i)) setBtn(H.at, slot, n, false); H.applied[slot] = 0; });
  }
  setInterval(() => {                                    // cambio de juego/consola y señal perdida
    const now = activeConsole();
    if (now !== H.at) { releaseAll(); window.arcadiaTV?.navReleaseAll(); H.navMask = 0; H.at = now; for (const p of H.pads.values()) send(p, { t: 'layout', c: now }); }
    for (const [k, p] of H.pads) if (performance.now() - p.seen > 20000) { try { p.conn.close(); } catch {} H.pads.delete(k); }
    if (H.pads.size) { recompute(); renderPanel(true); }
  }, 500);

  const send = (p, obj) => { try { if (p.conn?.open) p.conn.send(obj); } catch {} };
  function autoSlot() {
    const used = new Set([...H.pads.values()].map(p => p.slot));
    return !used.has(1) ? 1 : (!used.has(2) ? 2 : 2);
  }
  function onHostConn(conn) {
    if (H.pads.size >= 4 && !H.pads.has(conn.peer)) { try { conn.close(); } catch {} return; }
    let p = H.pads.get(conn.peer);
    if (!p) { p = { id: conn.peer, name: 'Celular ' + (H.pads.size + 1), slot: autoSlot(), mask: 0, seen: performance.now(), conn }; H.pads.set(conn.peer, p); }
    else { try { p.conn?.close(); } catch {} p.conn = conn; p.seen = performance.now(); }
    conn.on('open', () => { send(p, { t: 'welcome', slot: p.slot, c: H.at, gz: typeof DecompressionStream === 'function' }); renderPanel(); say(`${p.name} conectado como mando (Jugador ${p.slot}).`); });
    conn.on('data', d => {
      if (!d || typeof d !== 'object') return;
      p.seen = performance.now();
      if (d.t === 'm') { p.mask = (d.m | 0) & 0x3FF; recompute(); }
      else if (d.t === 'cmd') { if (d.c === 'exit') window.arcadiaTV?.exitGame(); }
      else if (d.t === 'hi' && d.name) { p.name = String(d.name).slice(0, 14); renderPanel(); }
      else if (d.t === 'rom-start' || d.t === 'rom-chunk' || d.t === 'rom-end') romRx(p, d);
    });
    const gone = () => { if (H.pads.get(conn.peer)?.conn === conn) { p.mask = 0; recompute(); H.pads.delete(conn.peer); renderPanel(); } };
    conn.on('close', gone); conn.on('error', gone);
    renderPanel();
  }
  async function openRoom() {
    if (H.peer || H.opening) return;
    if (!hasPeer()) { say('No se cargó PeerJS. Revisa tu conexión y recarga Arcadia.', true); return; }
    H.opening = true; renderPanel();
    try {
      let code = cleanCode(ls.get('arcadia-pad-code')) || makeCode(), peer = null;
      for (let i = 0; i < 6; i++) {
        peer = new window.Peer(PREFIX + code, peerOpts());
        try {
          await new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('Tiempo agotado al contactar el servicio de conexión.')), 12000);
            peer.once('open', () => { clearTimeout(t); res(); });
            peer.once('error', e => { clearTimeout(t); rej(e); });
          });
          break;
        } catch (e) {
          try { peer.destroy(); } catch {} peer = null;
          if (e?.type === 'unavailable-id' || e?.type === 'id-taken') { code = makeCode(); continue; }
          throw e;
        }
      }
      if (!peer) throw new Error('No se pudo reservar una sala de mandos.');
      ls.set('arcadia-pad-code', code);
      H.peer = peer; H.code = code;
      peer.on('connection', onHostConn);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
      peer.on('error', e => console.warn('Arcadia mandos:', e));
    } catch (e) {
      say(e?.message || 'No se pudo crear la sala de mandos.', true);
    } finally { H.opening = false; renderPanel(); }
  }
  function closeRoom() {
    releaseAll();
    for (const p of H.pads.values()) { send(p, { t: 'bye' }); try { p.conn.close(); } catch {} }
    H.pads.clear();
    try { H.peer?.destroy(); } catch {}
    H.peer = null; H.code = ''; renderPanel();
  }


  /* ───────────── recibir un juego enviado desde el celular ───────────── */
  const toast = document.createElement('div');
  toast.id = 'ppToast'; toast.setAttribute('role', 'status');
  toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:400;background:#101a24;color:#eaf3ff;border:1px solid #4d813d;border-radius:14px;padding:12px 20px;font:600 16px system-ui,sans-serif;display:none;max-width:90vw;text-align:center';
  document.body.appendChild(toast);
  let toastTimer = 0;
  function showToast(text, ms) { toast.textContent = text; toast.style.display = 'block'; clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => { toast.style.display = 'none'; }, ms); }
  let rxPatched = false, rxBytes = null;
  function patchRomReader() {
    if (rxPatched || !window.arcadia?.readRom) return; rxPatched = true;
    const orig = window.arcadia.readRom.bind(window.arcadia);
    window.arcadia.readRom = async ref => (String(ref) === 'phone://rom' && rxBytes) ? rxBytes : orig(ref);
  }
  async function launchReceived(name, bytes) {
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    closePanel(); window.arcadiaTV?.setOn(true);
    try {
      if (ext === 'nes') {
        patchRomReader(); rxBytes = bytes;
        if ($('#gbaModal')?.classList.contains('open')) closeGbaPlayer();
        const clean = name.replace(/\.nes$/i, '');
        await launchNesGame({ id: 'phone-' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name: clean, platform: 'NES', file: 'phone://rom' });
      } else if (ext === 'gba' || ext === 'bin') {
        if ($('#gameSession')?.classList.contains('open')) stopGameSession();
        await openGbaPlayer(name.replace(/\.(gba|bin)$/i, ''), false);
        await loadGbaRom(new File([bytes], name), true);
      } else throw new Error('Formato no reconocido. Usa una ROM .nes o .gba.');
    } catch (e) { showToast('No se pudo abrir el juego: ' + (e?.message || e), 7000); throw e; }
  }
  function romRx(p, d) {
    if (d.t === 'rom-start') {
      const size = d.size | 0, name = String(d.name || 'juego').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').slice(0, 80);
      if (size <= 0 || size > 33554432 || (d.raw | 0) > 33554432 || !/\.(nes|gba|bin)$/i.test(name)) { send(p, { t: 'rom-err', m: 'Elige una ROM .nes o .gba (máximo 32 MB).' }); return; }
      const ch = Math.min(Math.max(d.ch | 0, 1024), 16384) || 8192;
      H.rx = { name, size, gz: d.gz ? 1 : 0, raw: d.raw | 0, ch, have: new Uint8Array(Math.ceil(size / ch)), buf: new Uint8Array(size), got: 0, from: p, shown: -1 };
      showToast(`Recibiendo ${name}… 0 %`);
    } else if (d.t === 'rom-chunk') {
      const r = H.rx; if (!r || r.from !== p) return;
      try {
        const bin = atob(d.d), o = d.o | 0;
        if (o < 0 || o + bin.length > r.size) return;
        const idx = Math.floor(o / r.ch);
        if (o % r.ch === 0 && !r.have[idx]) {
          for (let i = 0; i < bin.length; i++) r.buf[o + i] = bin.charCodeAt(i);
          r.have[idx] = 1; r.got += bin.length;
        }
        const pct = Math.floor(100 * r.got / r.size);
        if (pct !== r.shown) { r.shown = pct; showToast(`Recibiendo ${r.name}… ${pct} %`); if (pct % 5 === 0) send(p, { t: 'rom-prog', pct }); }
      } catch {}
    } else if (d.t === 'rom-end') {
      const r = H.rx; if (!r || r.from !== p) return;
      const miss = []; for (let i = 0; i < r.have.length && miss.length < 600; i++) if (!r.have[i]) miss.push(i);
      if (miss.length) { H.rx = r; r.tries = (r.tries || 0) + 1; if (r.tries > 6) { H.rx = null; showToast('No se pudo completar la transferencia.', 6000); send(p, { t: 'rom-err', m: 'No se pudo completar la transferencia. Acerca el celular al router e inténtalo de nuevo.' }); return; } showToast(`Reenviando partes perdidas (${miss.length})…`); send(p, { t: 'rom-miss', list: miss }); return; }
      H.rx = null; showToast(`Abriendo ${r.name}…`);
      (async () => {
        if (!r.gz) return r.buf;
        if (typeof DecompressionStream !== 'function') throw new Error('Este navegador no puede descomprimir el juego.');
        const out = new Uint8Array(await new Response(new Blob([r.buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        if (r.raw && out.length !== r.raw) throw new Error('El juego se descomprimió mal. Inténtalo de nuevo.');
        return out;
      })().then(buf => launchReceived(r.name, buf)).then(() => { toast.style.display = 'none'; send(p, { t: 'rom-done' }); }).catch(e => send(p, { t: 'rom-err', m: String(e?.message || e) }));
    }
  }

  /* ───────────── panel ───────────── */
  const panel = document.createElement('div');
  panel.id = 'ppPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Mandos con el celular');
  panel.innerHTML = `<div class="pp-card"><h2>📱 Mandos con el celular</h2>
    <div class="pp-sec" id="ppHost"><h3>Esta pantalla (TV, PC o tablet) es la consola</h3><div id="ppHostBody"></div></div>
    <div class="pp-sec"><h3>Este celular es el mando</h3><p>Escribe el código que aparece en la pantalla del juego.</p>
      <div class="pp-actions"><input id="ppJoinCode" maxlength="5" inputmode="text" autocapitalize="characters" autocomplete="off" placeholder="CÓDIGO" aria-label="Código de la sala de mandos"><button class="primary" id="ppJoinBtn">Usar como mando</button></div></div>
    <div class="pp-actions"><button id="ppClose">Cerrar</button></div></div>`;
  document.body.appendChild(panel);
  const slotLabel = s => s === 1 ? 'Jugador 1' : s === 2 ? 'Jugador 2' : 'Apagado';
  function renderPanel(light) {
    const body = $('#ppHostBody'); if (!body) return;
    if (light && !panel.classList.contains('open')) return;
    if (H.opening) { body.innerHTML = '<p>Creando la sala…</p>'; return; }
    if (!H.peer) {
      body.innerHTML = '<p>Crea un código y conecta uno o dos celulares como mando. Funciona con NES y GBA, y también dentro de una sala online (el celular es tu mando).</p><div class="pp-actions"><button class="primary" id="ppOpen">Crear código de mandos</button></div>';
      $('#ppOpen').onclick = openRoom; return;
    }
    const now = performance.now();
    const rows = [...H.pads.values()].map(p => {
      const ok = now - p.seen < 2500;
      return `<div class="pp-row" data-id="${p.id}"><b>${p.name.replace(/[<>&]/g, '')}</b><span class="st ${ok ? '' : 'bad'}">${ok ? 'conectado' : 'sin señal'}</span>` +
        [1, 2, 0].map(s => `<button data-slot="${s}" class="${p.slot === s ? 'on' : ''}">${slotLabel(s)}</button>`).join('') + '</div>';
    }).join('');
    body.innerHTML = `<div class="pp-code" aria-label="Código">${H.code}</div>
      <p>En el celular abre Arcadia → 📱 Mandos → escribe este código${H.pads.size ? '' : '. Esperando celulares…'}</p><p>¿Sin archivos en esta pantalla? Con el celular conectado pulsa <b>📁 Enviar juego</b> en el mando y elige la ROM del celular: se abre aquí.</p>${rows}
      <div class="pp-actions"><button class="danger" id="ppShut">Cerrar sala de mandos</button></div>`;
    body.querySelectorAll('.pp-row').forEach(row => row.querySelectorAll('button').forEach(b => b.onclick = () => {
      const p = H.pads.get(row.dataset.id); if (!p) return;
      p.slot = +b.dataset.slot; p.mask = p.slot ? p.mask : 0; send(p, { t: 'slot', slot: p.slot }); recompute(); renderPanel();
    }));
    $('#ppShut').onclick = closeRoom;
  }
  function openPanel() { panel.classList.add('open'); renderPanel(); $('#ppOpen')?.focus(); }
  function closePanel() { panel.classList.remove('open'); }
  $('#ppClose').onclick = closePanel;
  panel.addEventListener('pointerdown', e => { if (e.target === panel) closePanel(); });
  // El teclado dentro del panel no debe llegar al juego (ni a los manejadores de captura del emulador).
  for (const ev of ['keydown', 'keyup']) window.addEventListener(ev, e => { if (panel.classList.contains('open') && panel.contains(e.target)) { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') closePanel(); if (ev === 'keydown' && e.key === 'Enter' && e.target.id === 'ppJoinCode') $('#ppJoinBtn').click(); } }, true);
  $('#ppJoinCode').value = cleanCode(ls.get('arcadia-pad-join'));
  $('#ppJoinCode').addEventListener('input', e => { e.target.value = cleanCode(e.target.value); });
  $('#ppJoinBtn').onclick = () => { const c = cleanCode($('#ppJoinCode').value); if (c.length !== 5) { say('El código tiene 5 letras o números.', true); return; } closePanel(); startController(c); };

  /* ───────────── MANDO (celular) ───────────── */
  const view = document.createElement('div');
  view.id = 'ppView';
  view.innerHTML = `<div class="pp-top"><span>Mando · <b id="ppWho">…</b></span><span id="ppStat">Conectando…</span><span><button class="pp-x" id="ppSend">📁 Enviar juego</button> <button class="pp-x" id="ppExit">⏏ Cerrar juego</button> <button class="pp-x" id="ppLeave">Salir</button></span></div><input type="file" id="ppFile" accept=".nes,.gba,.bin,application/octet-stream" hidden>
    <div class="pp-rot">Gira el celular en horizontal para jugar mejor</div>
    <button class="pp-b pp-sh pp-l" data-b="l">L</button><button class="pp-b pp-sh pp-r" data-b="r">R</button>
    <div class="pp-dpad" id="ppDpad"><i data-d="up">▲</i><i data-d="down">▼</i><i data-d="left">◀</i><i data-d="right">▶</i></div>
    <div class="pp-sys"><button class="pp-b" data-b="select">SELECT</button><button class="pp-b" data-b="start">START</button></div>
    <div class="pp-face"><button class="pp-b pp-bb" data-b="b">B</button><button class="pp-b pp-a" data-b="a">A</button></div>
    <div class="pp-msg" id="ppMsg"></div>`;
  document.body.appendChild(view);

  const C = { peer: null, conn: null, code: '', mask: 0, down: new Map(), timer: 0, retry: 0, wake: null, active: false, sentAt: 0, last: -1 };

  function setStat(text, msg) { $('#ppStat').textContent = text; $('#ppMsg').textContent = msg || ''; }
  function sendMask(force) {
    const now = performance.now();
    if (!force && C.mask === C.last && now - C.sentAt < 100) return;
    try { if (C.conn?.open) { C.conn.send({ t: 'm', m: C.mask }); C.last = C.mask; C.sentAt = now; } } catch {}
  }
  function setBit(name, on) {
    const i = BITS.indexOf(name); if (i < 0) return;
    const next = on ? (C.mask | (1 << i)) : (C.mask & ~(1 << i));
    if (next === C.mask) return;
    C.mask = next;
    view.querySelectorAll(`[data-b="${name}"]`).forEach(b => b.classList.toggle('on', on));
    view.querySelectorAll(`#ppDpad i[data-d="${name}"]`).forEach(b => b.classList.toggle('on', on));
    if (on) try { navigator.vibrate?.(8); } catch {}
    sendMask(true);
  }
  // Botones: cada dedo (pointerId) controla un botón; multitáctil libre.
  view.querySelectorAll('button[data-b]').forEach(btn => {
    const name = btn.dataset.b;
    btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch {} setBit(name, true); enterFullscreenOnce(); });
    const up = e => { e.preventDefault(); setBit(name, false); };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', () => setBit(name, false));
  });
  // Cruceta: un solo disco; la dirección sale de la posición del dedo (8 direcciones).
  const dpad = $('#ppDpad');
  function dpadMove(e) {
    const r = dpad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, t = r.width * 0.14;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    setBit('left', dx < -t); setBit('right', dx > t); setBit('up', dy < -t); setBit('down', dy > t);
  }
  dpad.addEventListener('pointerdown', e => { e.preventDefault(); try { dpad.setPointerCapture(e.pointerId); } catch {} dpadMove(e); enterFullscreenOnce(); });
  dpad.addEventListener('pointermove', e => { if (dpad.hasPointerCapture?.(e.pointerId)) dpadMove(e); });
  const dpadUp = () => ['left', 'right', 'up', 'down'].forEach(n => setBit(n, false));
  dpad.addEventListener('pointerup', dpadUp); dpad.addEventListener('pointercancel', dpadUp); dpad.addEventListener('lostpointercapture', dpadUp);
  view.addEventListener('contextmenu', e => e.preventDefault());
  view.addEventListener('touchmove', e => e.preventDefault(), { passive: false });


  /* Enviar una ROM del celular a la pantalla por el mismo canal del mando. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let sending = false, tx = null;
  async function sendChunk(n) {
    const t = tx; if (!t || !t.conn.open) throw new Error('Se perdió la conexión con la pantalla.');
    while ((t.conn.dataChannel?.bufferedAmount || 0) > 524288) await sleep(15);
    const o = n * t.CH, part = t.bytes.subarray(o, Math.min(o + t.CH, t.bytes.length));
    let bin = ''; for (let i = 0; i < part.length; i += 4096) bin += String.fromCharCode.apply(null, part.subarray(i, i + 4096));
    t.conn.send({ t: 'rom-chunk', o, d: btoa(bin) });
  }
  async function resendMissing(list) {
    try { for (let i = 0; i < list.length; i++) { await sendChunk(list[i]); if (i % 8 === 0) { setStat('Enviando…', `Reenviando partes perdidas… ${list.length - i}`); await sleep(0); } } tx?.conn.send({ t: 'rom-end' }); }
    catch (err) { setStat('Error', String(err?.message || err)); sending = false; tx = null; }
  }
  $('#ppSend').onclick = () => { if (!C.conn?.open) { setStat('Sin conexión', 'Conecta primero con la pantalla.'); return; } if (!sending) $('#ppFile').click(); };
  $('#ppFile').onchange = async e => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f || sending) return;
    if (!/\.(nes|gba|bin)$/i.test(f.name)) { setStat('Formato no válido', 'Elige una ROM .nes o .gba (si es .zip, descomprímela antes).'); return; }
    if (f.size > 33554432) { setStat('Archivo muy grande', 'El máximo es 32 MB.'); return; }
    sending = true;
    try {
      const raw = new Uint8Array(await f.arrayBuffer());
      let bytes = raw, gz = 0; const conn = C.conn, CH = 8192;
      if (C.gz && typeof CompressionStream === 'function') {
        try {
          setStat('Preparando…', 'Comprimiendo el juego para enviarlo más rápido…');
          const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
          if (z.length < raw.length * 0.95) { bytes = z; gz = 1; }
        } catch {}
      }
      tx = { bytes, conn, CH, name: f.name };
      conn.send({ t: 'rom-start', name: f.name, size: bytes.length, ch: CH, gz, raw: raw.length });
      const total = Math.ceil(bytes.length / CH);
      for (let n = 0; n < total; n++) {
        await sendChunk(n);
        if (n % 8 === 0) { setStat('Enviando…', `Enviando ${f.name}… ${Math.floor(100 * n / total)} %`); await sleep(0); }
      }
      conn.send({ t: 'rom-end' });
      setStat('Enviando…', 'Verificando que llegó completo…');
      // si la pantalla no responde, vuelve a preguntar
      for (let k = 0; k < 8 && tx && tx.bytes === bytes; k++) { await sleep(5000); if (tx && tx.bytes === bytes && conn.open) conn.send({ t: 'rom-end' }); }
    } catch (err) { setStat('Error', String(err?.message || err)); }
    sending = tx ? sending : false;
  };

  $('#ppExit').onclick = () => { try { C.conn?.send({ t: 'cmd', c: 'exit' }); } catch {} };
  let fsDone = false;
  function enterFullscreenOnce() {
    if (fsDone) return; fsDone = true;
    try { document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); } catch {}
  }
  async function keepScreenOn() { try { C.wake = await navigator.wakeLock?.request('screen'); } catch {} }
  document.addEventListener('visibilitychange', () => { if (C.active && !document.hidden) { keepScreenOn(); if (!C.conn?.open) connectNow(); } });

  function applyLayout(c) { view.classList.toggle('gba', c === 'gba'); if (!sending) $('#ppMsg').textContent = c === 'none' ? 'La pantalla está en el menú: cruceta = moverse · A = elegir · B = volver' : ''; }
  function connectNow() {
    if (!C.active) return;
    clearTimeout(C.retry);
    try { C.conn?.close(); } catch {}
    const go = () => {
      const conn = C.peer.connect(PREFIX + C.code, { reliable: true, serialization: 'json' });
      C.conn = conn;
      const timeout = setTimeout(() => { if (!conn.open) { setStat('Sin respuesta', 'No se encontró la sala. Revisa el código y que la pantalla tenga Arcadia abierto con la sala de mandos creada.'); retry(); } }, 15000);
      conn.on('open', () => { clearTimeout(timeout); $('#ppStat').textContent = 'Conectado'; if (!$('#ppMsg').textContent.startsWith('La pantalla')) $('#ppMsg').textContent = ''; conn.send({ t: 'hi', name: (/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Celular') + ' ' + Math.floor(Math.random() * 90 + 10) }); sendMask(true); ls.set('arcadia-pad-join', C.code); });
      conn.on('data', d => {
        if (!d) return;
        if (d.t === 'welcome' || d.t === 'slot') { $('#ppWho').textContent = d.slot ? 'Jugador ' + d.slot : 'Apagado'; if (d.t === 'welcome') C.gz = !!d.gz; if (d.c) applyLayout(d.c); }
        if (d.t === 'layout') applyLayout(d.c);
        if (d.t === 'rom-miss' && tx) resendMissing(d.list || []);
        if (d.t === 'rom-err') { sending = false; tx = null; setStat('Error', d.m || 'La pantalla no pudo abrir el juego.'); }
        if (d.t === 'rom-done') { tx = null; sending = false; setStat('Conectado', 'Listo: la pantalla abrió el juego.'); setTimeout(() => { if (C.active && C.conn?.open) setStat('Conectado', ''); }, 5000); }
        if (d.t === 'bye') { setStat('Sala cerrada', 'La pantalla cerró la sala de mandos.'); }
      });
      const lost = () => { clearTimeout(timeout); if (C.active) { setStat('Reconectando…', ''); retry(); } };
      conn.on('close', lost); conn.on('error', lost);
    };
    if (C.peer && !C.peer.destroyed && !C.peer.disconnected) go();
    else {
      try { C.peer?.destroy(); } catch {}
      C.peer = new window.Peer(undefined, peerOpts());
      C.peer.once('open', go);
      C.peer.on('error', e => { setStat('Sin conexión', e?.type === 'peer-unavailable' ? 'No se encontró esa sala. Revisa el código.' : 'No se pudo contactar el servicio de conexión.'); retry(); });
    }
  }
  function retry() { clearTimeout(C.retry); if (C.active) C.retry = setTimeout(connectNow, 2500); }
  function startController(code) {
    if (!hasPeer()) { say('No se cargó PeerJS. Revisa tu conexión y recarga Arcadia.', true); return; }
    C.code = code; C.active = true; C.mask = 0; C.last = -1;
    view.classList.add('open'); setStat('Conectando…', 'Conectando con la pantalla…'); $('#ppWho').textContent = '…';
    keepScreenOn(); connectNow();
    clearInterval(C.timer); C.timer = setInterval(() => sendMask(false), 100);
  }
  function stopController() {
    C.active = false; clearTimeout(C.retry); clearInterval(C.timer);
    C.mask = 0; try { C.conn?.send({ t: 'm', m: 0 }); } catch {}
    try { C.conn?.close(); } catch {} try { C.peer?.destroy(); } catch {}
    C.conn = null; C.peer = null; try { C.wake?.release?.(); } catch {}
    view.classList.remove('open'); fsDone = false;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
    try { const u = new URL(location.href); if (u.searchParams.has('mando')) { u.searchParams.delete('mando'); history.replaceState(null, '', u); } } catch {}
  }
  $('#ppLeave').onclick = stopController;

  /* ───────────── botones de entrada ───────────── */
  function addButtons() {
    const nav = document.querySelector('.sidebar .nav');
    if (nav && !$('#ppNav')) {
      const b = document.createElement('button'); b.id = 'ppNav'; b.title = 'Mandos con el celular'; b.setAttribute('aria-label', 'Mandos con el celular');
      b.innerHTML = '📱<span class="tooltip">Mandos con el celular</span>'; b.onclick = openPanel; nav.insertBefore(b, $('#newsButton'));
    }
    const nesBar = $('.nes-toolbar-actions');
    if (nesBar && !$('#ppNes')) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'ppNes'; b.textContent = '📱 Mandos'; b.onclick = openPanel; nesBar.insertBefore(b, $('#configureNes')); }
    const gbaBar = $('.gba-head');
    if (gbaBar && !$('#ppGba')) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'ppGba'; b.textContent = '📱'; b.title = 'Mandos con el celular'; b.setAttribute('aria-label', 'Mandos con el celular'); b.onclick = openPanel; gbaBar.insertBefore(b, $('#gbaSettingsBtn')); }
  }
  addButtons();
  window.arcadiaPhonePad = { openPanel, startController, stopController, isHosting: () => !!H.peer, _state: () => ({ H, C }) };

  // Enlace directo desde el celular: ?mando=CODIGO
  try {
    const q = cleanCode(new URLSearchParams(location.search).get('mando'));
    if (q.length === 5) setTimeout(() => startController(q), 300);
  } catch {}
})();
