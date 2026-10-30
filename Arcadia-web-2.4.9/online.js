(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['online.js']='2.4.9';
/* Arcadia Online · partida de 2 jugadores por conexión directa (WebRTC).
 *
 * - El ANFITRIÓN es el dispositivo que ejecuta el emulador (sin servidor de juego).
 * - El INVITADO entra con un código de 5 caracteres, ve la pantalla del jugador 1
 *   (vídeo + audio) y envía sus botones, que el anfitrión aplica al control 2.
 * - Para encontrarse solo se usa un "buzón de señalización" público y gratuito
 *   (bróker de PeerJS, 0.peerjs.com). Después del saludo, el juego viaja directo
 *   entre los dos dispositivos. No se instala ni se paga ningún servidor.
 *
 * Todo se puede cambiar antes de cargar este archivo con window.ARCADIA_ONLINE_CONFIG
 * (por ejemplo, otro servidor de señalización o servidores TURN propios).
 */
(() => {
  'use strict';

  const DEFAULTS = {
    idPrefix: 'arcadia-nes-',
    signal: { host: '0.peerjs.com', port: 443, secure: true, path: '/', key: 'peerjs', factory: null },
    // Arcadia Web 1.0.5 — prueba TURN Metered.
    // SOLO PARA PRUEBA: estas credenciales fueron compartidas en la conversación.
    // Rótalas después de la prueba. No publicar credenciales TURN permanentes en producción.
    iceServers: [
      { urls: ['stun:stun.relay.metered.ca:80'] },
      {
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:80?transport=tcp',
          'turn:global.relay.metered.ca:443',
          'turns:global.relay.metered.ca:443?transport=tcp'
        ],
        username: '21a705cf2506f346bb253831',
        credential: 'callWh4zpfQUQm2G'
      }
    ],
    videoScale: 1.25,
    maxVideoBitrate: 550000,
    connectTimeoutMs: 20000
  };
  const user = window.ARCADIA_ONLINE_CONFIG || {};
  const CFG = { ...DEFAULTS, ...user, signal: { ...DEFAULTS.signal, ...(user.signal || {}) } };

  const qs = (selector, root = document) => root.querySelector(selector);
  const say = (message, isError = false) => { try { notify(message, isError); } catch { console.log(message); } };
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), n => CODE_CHARS[n % CODE_CHARS.length]).join('');
  const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const cleanCode = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const NAME_KEY = 'arcadia-online-name';
  const loadName = () => { try { return cleanName(localStorage.getItem(NAME_KEY)); } catch { return ''; } };
  const saveName = () => {
    const name = cleanName(qs('#onlineName').value);
    qs('#onlineName').value = name;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    return name;
  };

  /* ───────── Señalización (protocolo del bróker de PeerJS) ───────── */
  function openSignal(id, onMessage) {
    const s = CFG.signal;
    if (typeof s.factory === 'function') return s.factory(id, onMessage);
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const url = `${s.secure ? 'wss' : 'ws'}://${s.host}${s.port ? ':' + s.port : ''}${s.path}peerjs?key=${encodeURIComponent(s.key)}&id=${encodeURIComponent(id)}&token=${token}`;
    let ws = null, heartbeat = null, retry = null, closed = false, everOpen = false, settle;
    const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    ready.catch(() => {});
    const api = {
      id, ready,
      send(dst, type, payload) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, dst, payload })); },
      close() { closed = true; clearInterval(heartbeat); clearTimeout(retry); try { ws && ws.close(); } catch {} }
    };
    const openTimer = setTimeout(() => { if (!everOpen) { settle.reject(new Error('timeout')); api.close(); } }, 10000);
    const connect = () => {
      try { ws = new WebSocket(url); } catch (error) { settle.reject(error); return; }
      ws.onopen = () => {
        clearInterval(heartbeat);
        heartbeat = setInterval(() => { if (ws.readyState === 1) ws.send('{"type":"HEARTBEAT"}'); }, 5000);
      };
      ws.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'OPEN') { everOpen = true; clearTimeout(openTimer); settle.resolve(); return; }
        if (message.type === 'ID-TAKEN') { clearTimeout(openTimer); settle.reject(new Error('taken')); api.close(); return; }
        if (message.type === 'INVALID-KEY' || message.type === 'ERROR') { clearTimeout(openTimer); settle.reject(new Error('unreachable')); return; }
        onMessage(message);
      };
      ws.onclose = () => {
        clearInterval(heartbeat);
        if (closed) return;
        if (!everOpen) { clearTimeout(openTimer); settle.reject(new Error('unreachable')); return; }
        retry = setTimeout(connect, 2500); // el bróker corta conexiones inactivas: reconectar en silencio
      };
      ws.onerror = () => {};
    };
    connect();
    return api;
  }
  const friendly = error => {
    const code = error?.message;
    if (code === 'unreachable' || code === 'timeout') return new Error('No se pudo contactar el servicio de enlace. Revisa tu internet e inténtalo otra vez.');
    return error instanceof Error ? error : new Error(String(error));
  };
  const rtcConfig = () => ({ iceServers: CFG.iceServers });
  const sendJson = (channel, data) => { try { if (channel && (channel.open === true || channel.readyState === 'open')) channel.send(JSON.stringify(data)); } catch (error) { console.debug('[Arcadia Online] No se pudo enviar mensaje:', error); } };
  const parse = event => { try { const raw = typeof event === 'string' ? event : event?.data; const data = typeof raw === 'string' ? JSON.parse(raw) : raw; return data && typeof data === 'object' ? data : null; } catch { return null; } };

  /* ───────── Pantalla compartida: nombres sobre el juego ───────── */
  function showTags(container, p1, p2, p2Waiting = false) {
    let box = qs('.online-tags', container);
    if (!box) {
      box = document.createElement('div');
      box.className = 'online-tags';
      box.innerHTML = '<span class="online-tag p1"></span><span class="online-tag p2"></span>';
      container.append(box);
    }
    const [a, b] = box.children;
    a.textContent = `J1 · ${p1 || 'Anfitrión'}`;
    b.textContent = p2Waiting ? 'J2 · esperando…' : `J2 · ${p2 || 'Invitado'}`;
    b.classList.toggle('waiting', p2Waiting);
  }
  const removeTags = () => document.querySelectorAll('.online-tags').forEach(node => node.remove());

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (H.active || G.active)) keepAwake(true); });

  /* ───────── ANFITRIÓN ───────── */
  const H = { active: false, code: '', name: '', signal: null, peer: null, guest: null, stream: null, raf: 0, paused: false };

  function tapAudio() {
    const speakers = typeof nesBrowser !== 'undefined' && nesBrowser ? nesBrowser._speakers : null;
    if (!speakers || !speakers.audioCtx) return null;
    const dest = speakers.audioCtx.createMediaStreamDestination();
    const hook = () => { if (!speakers.node) return false; try { speakers.node.connect(dest); } catch {} return true; };
    if (!hook()) { let tries = 0; const timer = setInterval(() => { if (hook() || ++tries > 50) clearInterval(timer); }, 200); }
    return dest;
  }
  function startCapture() {
    const out = document.createElement('canvas');
    out.width = 256 * CFG.videoScale; out.height = 240 * CFG.videoScale;
    const ctx = out.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    const stream = out.captureStream(60);
    const loop = () => {
      const source = qs('#gameViewport canvas');
      if (source) ctx.drawImage(source, 0, 0, out.width, out.height);
      H.raf = requestAnimationFrame(loop);
    };
    loop();
    try { stream.getVideoTracks()[0].contentHint = 'motion'; } catch {}
    const dest = tapAudio();
    if (dest) dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    H.stream = stream;
  }
  function stopCapture() {
    cancelAnimationFrame(H.raf);
    if (H.stream) H.stream.getTracks().forEach(track => track.stop());
    H.stream = null;
  }

  async function startHost() {
    if (H.active) return;
    if (!(typeof nesBrowser !== 'undefined' && nesBrowser && activeNesGameId)) throw new Error('Primero abre un juego y luego crea la sala.');
    if (!window.RTCPeerConnection) throw new Error('Este navegador no permite conexiones directas (WebRTC).');
    H.name = saveName() || 'Anfitrión';
    let signal = null, code = '';
    for (let attempt = 0; attempt < 6 && !signal; attempt++) {
      code = makeCode();
      const candidate = openSignal(CFG.idPrefix + code, onHostSignal);
      try { await candidate.ready; signal = candidate; }
      catch (error) { candidate.close(); if (error.message !== 'taken') throw friendly(error); }
    }
    if (!signal) throw new Error('No se pudo reservar un código. Inténtalo de nuevo.');
    H.signal = signal; H.code = code; H.active = true; H.guest = null; H.paused = false;
    startCapture();
    keepAwake(true);
    showTags(qs('#gameViewport'), H.name, '', true);
    renderHostUI();
  }

  function onHostSignal(message) {
    if (!H.active) return;
    if (message.type === 'OFFER') {
      if (H.guest) { H.signal.send(message.src, 'ANSWER', { reject: 'full' }); return; }
      acceptGuest(message.src, message.payload).catch(error => { console.warn('Arcadia online:', error); dropGuest('No se pudo completar la conexión.'); });
    } else if (message.type === 'CANDIDATE') {
      const guest = H.guest;
      if (!guest || guest.id !== message.src || !message.payload?.candidate) return;
      if (guest.pc.remoteDescription) guest.pc.addIceCandidate(message.payload.candidate).catch(() => {});
      else guest.pending.push(message.payload.candidate);
    } else if (message.type === 'LEAVE') {
      if (H.guest && H.guest.id === message.src && !H.guest.connected) dropGuest('El invitado canceló.');
    }
  }

  async function acceptGuest(id, payload) {
    if (!payload?.sdp) throw new Error('Oferta inválida');
    const pc = new RTCPeerConnection(rtcConfig());
    const guest = { id, pc, dc: null, pending: [], connected: false, name: '', mask: 0, ping: null, lostTimer: null, timeout: null };
    H.guest = guest;
    guest.timeout = setTimeout(() => { if (!guest.connected && H.guest === guest) dropGuest('El invitado no logró conectarse (red restringida).'); }, CFG.connectTimeoutMs);
    pc.onicecandidate = event => { if (event.candidate) H.signal.send(id, 'CANDIDATE', { candidate: event.candidate.toJSON() }); };
    pc.ondatachannel = event => bindHostChannel(guest, event.channel);
    pc.onconnectionstatechange = () => {
      if (H.guest !== guest) return;
      const state = pc.connectionState;
      if (state === 'connected') { clearTimeout(guest.lostTimer); tuneSenders(pc); }
      else if (state === 'disconnected') { clearTimeout(guest.lostTimer); guest.lostTimer = setTimeout(() => { if (H.guest === guest && pc.connectionState !== 'connected') dropGuest('Se perdió la conexión.'); }, 8000); }
      else if (state === 'failed' || state === 'closed') dropGuest('Se perdió la conexión.');
    };
    await pc.setRemoteDescription(payload.sdp);
    if (H.guest !== guest) return;
    H.stream.getTracks().forEach(track => pc.addTrack(track, H.stream));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    for (const candidate of guest.pending.splice(0)) pc.addIceCandidate(candidate).catch(() => {});
    H.signal.send(id, 'ANSWER', { sdp: pc.localDescription });
  }
  function tuneSenders(pc) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = CFG.maxVideoBitrate;
        params.degradationPreference = 'maintain-framerate';
        sender.setParameters(params).catch(() => {});
      } catch {}
    }
  }

  function bindHostChannel(guest, channel) {
    guest.dc = channel;
    // PeerJS DataConnection is an EventEmitter: payloads arrive via 'data', not onmessage.
    channel.on('data', raw => {
      if (H.guest !== guest) return;
      const data = parse(raw);
      if (!data) return;
      if (data.t === 'hello') {
        guest.connected = true; clearTimeout(guest.timeout);
        guest.name = cleanName(data.name) || 'Invitado';
        sendJson(channel, { t: 'welcome', host: H.name, title: qs('#sessionGameTitle')?.textContent || '', p1: H.name, p2: guest.name, paused: H.paused });
        showTags(qs('#gameViewport'), H.name, guest.name);
        say(`${guest.name} se unió como jugador 2.`);
        renderHostUI();
      } else if (data.t === 'in') {
        if (guest.connected) applyGuestMask(guest, Number(data.b) & 255);
      } else if (data.t === 'ping') {
        sendJson(channel, { t: 'pong', n: data.n });
      } else if (data.t === 'pong') {
        const ms = Math.round(performance.now() - Number(data.n)); if (LS.active && ms >= 0 && ms < 10000) LS.diagRtt = ms;
      } else if (data.t === 'rtt') {
        if (LS.active) LS.diagRtt = Math.round(Number(data.ms) || 0);
        guest.ping = Math.max(0, Math.min(9999, Math.round(Number(data.ms) || 0)));
        renderHostUI();
      } else if (data.t === 'bye') {
        dropGuest(`${guest.name || 'El invitado'} salió de la sala.`, false);
      }
    });
    channel.on('close', () => { if (H.guest === guest) dropGuest(`${guest.name || 'El invitado'} se desconectó.`, false); });
  }
  function applyGuestMask(guest, mask) {
    const pad = typeof nesBrowser !== 'undefined' && nesBrowser ? nesBrowser.nes : null;
    if (!pad) return;
    for (let button = 0; button < 8; button++) {
      const was = (guest.mask >> button) & 1, now = (mask >> button) & 1;
      if (was !== now) now ? pad.buttonDown(2, button) : pad.buttonUp(2, button);
    }
    guest.mask = mask;
  }
  function dropGuest(reason, tellGuest = true) {
    const guest = H.guest;
    if (!guest) return;
    H.guest = null;
    clearTimeout(guest.lostTimer); clearTimeout(guest.timeout);
    applyGuestMask(guest, 0);
    if (tellGuest) sendJson(guest.dc, { t: 'bye', reason });
    setTimeout(() => { try { guest.pc.close(); } catch {} }, 150);
    if (H.active) {
      showTags(qs('#gameViewport'), H.name, '', true);
      if (reason) say(reason);
      renderHostUI();
    }
  }
  function closeRoom(reason = 'El anfitrión cerró la sala.') {
    if (!H.active) return;
    const guest = H.guest;
    if (guest) { sendJson(guest.dc, { t: 'bye', reason }); applyGuestMask(guest, 0); setTimeout(() => { try { guest.pc.close(); } catch {} }, 200); }
    H.guest = null; H.active = false;
    try { H.signal.close(); } catch {}
    H.signal = null; H.code = '';
    stopCapture(); removeTags(); keepAwake(false);
    renderHostUI();
  }

  /* ───────── INVITADO ───────── */
  const G = { active: false, joining: false, signal: null, peer: null, call: null, dummyStream: null, pc: null, dc: null, mask: 0, name: '', hostName: '', video: null, timers: [], keys: null };

  async function joinRoom(rawCode) {
    if (G.joining || G.active) return;
    if (!window.RTCPeerConnection) throw new Error('Este navegador no permite conexiones directas (WebRTC).');
    const code = cleanCode(rawCode);
    if (code.length !== 5) throw new Error('El código tiene 5 letras o números.');
    G.name = saveName() || 'Invitado';
    G.joining = true;
    const fail = error => { cleanupGuest(); throw friendly(error); };
    try {
      const hostId = CFG.idPrefix + code;
      const guestId = `${CFG.idPrefix}g-${Math.random().toString(36).slice(2, 10)}`;
      let settleAnswer; const answered = new Promise((resolve, reject) => { settleAnswer = { resolve, reject }; });
      answered.catch(() => {});
      const queue = []; let offerSent = false;
      G.signal = openSignal(guestId, message => {
        if (message.type === 'ANSWER') {
          if (message.payload?.reject === 'full') settleAnswer.reject(new Error('La sala ya tiene a su jugador 2.'));
          else if (message.payload?.sdp) settleAnswer.resolve(message.payload.sdp);
        } else if (message.type === 'CANDIDATE' && message.payload?.candidate) {
          if (G.pc?.remoteDescription) G.pc.addIceCandidate(message.payload.candidate).catch(() => {});
          else queue.push(message.payload.candidate);
        } else if (message.type === 'EXPIRE') {
          settleAnswer.reject(new Error('No se encontró esa sala. Revisa el código y que el anfitrión tenga el juego abierto.'));
        }
      });
      await G.signal.ready;
      const pc = new RTCPeerConnection(rtcConfig());
      G.pc = pc;
      const stream = new MediaStream();
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      const dc = pc.createDataChannel('arcadia', { ordered: true });
      G.dc = dc;
      const opened = new Promise(resolve => { dc.onopen = resolve; });
      pc.ontrack = event => {
        stream.addTrack(event.track);
        try { event.receiver.playoutDelayHint = 0; event.receiver.jitterBufferTarget = 0; } catch {}
        if (G.video) attachStream(stream);
      };
      G.stream = stream;
      const pendingIce = [];
      pc.onicecandidate = event => {
        if (!event.candidate) return;
        if (offerSent) G.signal.send(hostId, 'CANDIDATE', { candidate: event.candidate.toJSON() });
        else pendingIce.push(event.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (!G.active && !G.joining) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') endGuest('Se perdió la conexión con el anfitrión.');
        else if (pc.connectionState === 'disconnected') G.timers.push(setTimeout(() => { if (G.pc === pc && pc.connectionState !== 'connected') endGuest('Se perdió la conexión con el anfitrión.'); }, 8000));
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      G.signal.send(hostId, 'OFFER', { sdp: pc.localDescription });
      offerSent = true;
      pendingIce.splice(0).forEach(candidate => G.signal.send(hostId, 'CANDIDATE', { candidate }));
      const timeout = ms => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout-sala')), ms));
      let sdp;
      try { sdp = await Promise.race([answered, timeout(20000)]); }
      catch (error) { if (error.message === 'timeout-sala') throw new Error('No se encontró esa sala. Revisa el código y que el anfitrión tenga el juego abierto.'); throw error; }
      await pc.setRemoteDescription(sdp);
      queue.splice(0).forEach(candidate => pc.addIceCandidate(candidate).catch(() => {}));
      try { await Promise.race([opened, timeout(CFG.connectTimeoutMs)]); }
      catch { throw new Error('No se pudo conectar de forma directa. Pasa con algunos datos móviles o redes de empresa: prueben ambos con la misma WiFi o con otra red.'); }
      // Conectados: el buzón ya no hace falta.
      G.signal.close(); G.signal = null;
      setupGuestChannel(dc);
      sendJson(dc, { t: 'hello', name: G.name });
    } catch (error) { fail(error); }
  }

  function setupGuestChannel(dc) {
    G.joining = false; G.active = true;
    // PeerJS DataConnection emits payloads through 'data'; onmessage is for RTCDataChannel.
    dc.on('data', raw => {
      const data = parse(raw);
      if (!data) return;
      if (data.t === 'welcome') {
        G.hostName = cleanName(data.host) || 'Anfitrión';
        openGuestSession(data);
      } else if (data.t === 'names') {
        showTags(qs('#gameViewport'), cleanName(data.p1), cleanName(data.p2));
      } else if (data.t === 'pong') {
        const ms = Math.round(performance.now() - Number(data.n));
        if (ms >= 0 && ms < 10000) { qs('#nesFps').textContent = `${ms} ms`; sendJson(dc, { t: 'rtt', ms }); }
      } else if (data.t === 'paused') {
        qs('#nesStatus').textContent = data.v ? 'El anfitrión pausó el juego' : 'Online · Tú eres el jugador 2';
      } else if (data.t === 'bye') {
        endGuest(cleanText(data.reason) || 'El anfitrión cerró la sala.');
      }
    });
    dc.on('close', () => { if (G.active) endGuest('Se cerró la conexión con el anfitrión.'); });
    G.timers.push(setInterval(() => sendJson(dc, { t: 'ping', n: performance.now() }), 2000));
    G.timers.push(setInterval(() => sendJson(dc, { t: 'in', b: G.mask }), 500)); // refuerzo por si algún mensaje se pierde
  }
  const cleanText = value => String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 120);

  function attachStream(stream) {
    const video = G.video;
    video.srcObject = stream;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      qs('#onlineUnmute')?.classList.remove('hide');
    });
  }
  function openGuestSession(welcome) {
    const session = qs('#gameSession');
    session.classList.add('online-guest');
    const viewport = qs('#gameViewport');
    viewport.innerHTML = '';
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.setAttribute('playsinline', '');
    video.disablePictureInPicture = true;
    viewport.append(video);
    const unmute = document.createElement('button');
    unmute.id = 'onlineUnmute'; unmute.className = 'btn primary online-unmute hide'; unmute.textContent = '🔊 Toca para activar el sonido';
    unmute.addEventListener('click', () => { video.muted = false; video.play().catch(() => {}); unmute.classList.add('hide'); });
    viewport.append(unmute);
    G.video = video;
    attachStream(G.stream);
    showTags(viewport, cleanName(welcome.p1), cleanName(welcome.p2));
    qs('#sessionGameTitle').textContent = welcome.title ? `${welcome.title} · sala de ${G.hostName}` : `Sala de ${G.hostName}`;
    qs('#nesStatus').textContent = welcome.paused ? 'El anfitrión pausó el juego' : 'Online · Tú eres el jugador 2';
    qs('#nesFps').textContent = '… ms';
    closeOnlineModal();
    prepareGuestControls();
    openModal('gameSession');
    keepAwake(true);
    bindGuestKeys(true);
  }
  function guestButton(button, down) {
    if (!G.active) return;
    const bit = 1 << button;
    const next = down ? (G.mask | bit) : (G.mask & ~bit);
    if (next === G.mask) return;
    G.mask = next;
    sendJson(G.dc, { t: 'in', b: G.mask });
  }
  function bindGuestKeys(on) {
    if (!on) { if (G.keys) { document.removeEventListener('keydown', G.keys.down, true); document.removeEventListener('keyup', G.keys.up, true); G.keys = null; } return; }
    if (G.keys) return;
    const lookup = event => {
      if (event.target.matches?.('input, select, textarea') || !qs('#gameSession').classList.contains('open')) return null;
      const key = String(event.key).toLowerCase();
      const entry = Object.entries(nesKeys).find(([, value]) => value === event.code || String(value).toLowerCase() === key);
      return entry ? nesPadButtons.get(entry[0]) : null;
    };
    G.keys = {
      down: event => { if (typeof waitingForNesKey !== 'undefined' && waitingForNesKey) return; const b = lookup(event); if (b == null) return; event.preventDefault(); guestButton(b, true); },
      up: event => { const b = lookup(event); if (b == null) return; event.preventDefault(); guestButton(b, false); }
    };
    document.addEventListener('keydown', G.keys.down, true);
    document.addEventListener('keyup', G.keys.up, true);
  }
  function cleanupGuest() {
    G.timers.forEach(timer => { clearTimeout(timer); clearInterval(timer); }); G.timers = [];
    bindGuestKeys(false);
    // Closing/destroying the PeerJS connection removes its event listeners.
    try { G.dc && G.dc.close(); } catch {}
    try { G.pc && G.pc.close(); } catch {}
    try { G.signal && G.signal.close(); } catch {}
    if (G.video) { G.video.srcObject = null; }
    qs('#gameSession').classList.remove('online-guest');
    removeTags();
    keepAwake(false);
    Object.assign(G, { active: false, joining: false, signal: null, pc: null, dc: null, mask: 0, video: null, stream: null });
  }
  function endGuest(message) {
    const wasActive = G.active;
    if (G.dc && wasActive) sendJson(G.dc, { t: 'bye' });
    cleanupGuest();
    if (wasActive && qs('#gameSession').classList.contains('open')) { stopGameSession().catch(() => {}); }
    if (message) say(message, true);
  }

  /* ───────── Ventana "Jugar online" ───────── */
  const modal = () => qs('#onlineModal');
  function openOnlineModal(mode) {
    qs('#onlineName').value = loadName();
    modal().dataset.mode = mode;
    modal().classList.add('open');
    renderHostUI();
    setStatus('');
    setTimeout(() => (mode === 'join' ? qs('#onlineJoinCode') : qs('#onlineName')).focus?.(), 60);
  }
  function closeOnlineModal() { modal().classList.remove('open'); }
  function setStatus(text, isError = false) {
    const node = qs('#onlineJoinStatus'); node.textContent = text; node.classList.toggle('error', isError);
  }
  function shareUrl() {
    return /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?sala=${H.code}` : '';
  }
  function renderHostUI() {
    if (!modal()) return;
    const inSession = qs('#gameSession').classList.contains('open') && typeof nesBrowser !== 'undefined' && !!nesBrowser;
    const mode = modal().dataset.mode || 'join';
    // Always show both host and join controls regardless of how the modal was opened.
    qs('#onlineJoinBox').classList.remove('hide');
    qs('#onlineHostIdle').classList.toggle('hide', H.active);
    qs('#onlineHostActive').classList.toggle('hide', !H.active);
    qs('#onlineCreate').classList.toggle('hide', !inSession);
    qs('#onlineHostHint').textContent = inSession
      ? 'Ambos dispositivos ejecutan la misma ROM localmente; Arcadia sincroniza los controles.'
      : 'Paso 1: abre una ROM NES desde tu biblioteca. Paso 2: vuelve aquí y pulsa Crear sala.';
    qs('#onlineCode').textContent = H.active ? H.code : '·····';
    const guest = H.guest;
    const list = qs('#onlinePlayers');
    list.innerHTML = '';
    const row = (label, name, extra) => {
      const item = document.createElement('div'); item.className = 'online-player';
      const tag = document.createElement('b'); tag.textContent = label;
      const text = document.createElement('span'); text.textContent = name;
      item.append(tag, text);
      if (extra) item.append(extra);
      list.append(item);
    };
    row('J1', `${H.name || 'Tú'} (anfitrión)`);
    if (guest && guest.connected) {
      const kick = document.createElement('button'); kick.className = 'btn'; kick.type = 'button'; kick.textContent = 'Expulsar';
      kick.addEventListener('click', () => dropGuest('Sacaste al invitado de la sala.'));
      const ping = document.createElement('small'); ping.textContent = guest.ping == null ? '' : `${guest.ping} ms`;
      row('J2', guest.name, ping); list.lastChild.append(kick);
    } else row('J2', guest ? 'conectando…' : 'esperando a alguien con el código…');
    qs('#onlineNes').textContent = H.active ? (guest?.connected ? 'Online ● 2/2' : 'Online ● 1/2') : 'Online';
    qs('#onlineShare').classList.toggle('hide', !shareUrl());
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      area.remove(); return ok;
    }
  }

  /* ───── v0.3.6: PeerJS oficial para señalización; sin credenciales TURN ─────
     PeerJS se encarga del protocolo de señalización. STUN facilita conexiones
     directas, pero algunas redes seguirán necesitando TURN para atravesar NAT. */
  const PEER_OPTIONS = {
    host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs',
    config: { iceServers: CFG.iceServers }
  };
  const makePeer = id => {
    if (typeof window.Peer !== 'function') throw new Error('No se pudo cargar PeerJS. Comprueba que tienes internet y recarga la página.');
    return new window.Peer(id, PEER_OPTIONS);
  };
  function peerErrorMessage(error) {
    const type = error && (error.type || error.message);
    if (type === 'peer-unavailable') return 'No se encontró esa sala. El anfitrión debe crearla y mantener Arcadia abierta.';
    if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'No se pudo contactar el servicio global de conexión. Revisa internet y vuelve a intentarlo.';
    if (type === 'unavailable-id' || type === 'id-taken') return 'Ese código ya está ocupado. Cierra la sala y crea otra.';
    return error?.message || 'No se pudo establecer la conexión online.';
  }
  function peerGuestFor(id) {
    if (H.guest && H.guest.id === id) return H.guest;
    if (H.guest) return null;
    const guest = { id, pc: { close() {} }, dc: null, call: null, pending: [], connected: false, name: '', mask: 0, ping: null, lostTimer: null, timeout: null };
    H.guest = guest;
    guest.timeout = setTimeout(() => { if (!guest.connected && H.guest === guest) dropGuest('El invitado no logró conectarse. Sin TURN, algunas redes no permiten conexiones directas.'); }, CFG.connectTimeoutMs * 2);
    return guest;
  }
  startHost = async function startHostPeerJS() {
    if (H.active) return;
    if (!(typeof nesBrowser !== 'undefined' && nesBrowser && activeNesGameId)) throw new Error('Primero abre un juego y luego crea la sala.');
    if (!window.RTCPeerConnection) throw new Error('Este navegador no permite conexiones WebRTC.');
    H.name = saveName() || 'Anfitrión';
    if (typeof window.Peer !== 'function') throw new Error('No se cargó PeerJS desde internet. Comprueba la conexión y recarga Arcadia.');
    let peer = null, code = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      code = makeCode();
      peer = makePeer(CFG.idPrefix + code);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Tiempo agotado al registrar la sala en el servidor global.')), 12000);
          peer.once('open', () => { clearTimeout(timer); resolve(); });
          peer.once('error', error => { clearTimeout(timer); reject(error); });
        });
        break;
      } catch (error) {
        try { peer.destroy(); } catch {}
        if (error?.type === 'unavailable-id' || error?.type === 'id-taken') { peer = null; continue; }
        throw new Error(peerErrorMessage(error));
      }
    }
    if (!peer) throw new Error('No se pudo reservar una sala. Inténtalo otra vez.');
    H.peer = peer; H.signal = null; H.code = code; H.active = true; H.guest = null; H.paused = false;
    peer.on('connection', conn => {
      const guest = peerGuestFor(conn.peer);
      if (!guest) { try { conn.close(); } catch {} return; }
      guest.dc = conn;
      bindHostChannel(guest, conn);
      conn.on('close', () => { if (H.guest === guest) dropGuest(`${guest.name || 'El invitado'} se desconectó.`, false); });
    });
    peer.on('call', call => {
      const guest = peerGuestFor(call.peer);
      if (!guest) { try { call.close(); } catch {} return; }
      guest.call = call;
      call.answer(H.stream);
      call.on('close', () => { if (H.guest === guest && !guest.connected) dropGuest('Se cerró la conexión multimedia.'); });
      call.on('error', error => { console.warn('Arcadia media:', error); if (H.guest === guest && !guest.connected) dropGuest('No se pudo iniciar el vídeo.'); });
    });
    peer.on('error', error => { console.warn('Arcadia PeerJS:', error); if (H.active && !H.guest) say(peerErrorMessage(error), true); });
    startCapture(); keepAwake(true); showTags(qs('#gameViewport'), H.name, '', true); renderHostUI();
  };
  closeRoom = function closeRoomPeerJS(reason = 'El anfitrión cerró la sala.') {
    if (!H.active) return;
    const guest = H.guest;
    if (guest) {
      sendJson(guest.dc, { t: 'bye', reason }); applyGuestMask(guest, 0);
      try { guest.dc?.close(); } catch {} try { guest.call?.close(); } catch {}
    }
    H.guest = null; H.active = false; H.code = '';
    try { H.peer?.destroy(); } catch {} H.peer = null; H.signal = null;
    stopCapture(); removeTags(); keepAwake(false); renderHostUI();
  };
  joinRoom = async function joinRoomPeerJS(rawCode) {
    if (G.joining || G.active) return;
    if (!window.RTCPeerConnection) throw new Error('Este navegador no permite conexiones WebRTC.');
    const code = cleanCode(rawCode);
    if (code.length !== 5) throw new Error('El código tiene 5 letras o números.');
    if (typeof window.Peer !== 'function') throw new Error('No se cargó PeerJS desde internet. Comprueba la conexión y recarga Arcadia.');
    G.name = saveName() || 'Invitado'; G.joining = true;
    try {
      const hostId = CFG.idPrefix + code;
      const peer = makePeer(); G.peer = peer;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tiempo agotado al contactar el servicio global.')), 12000);
        peer.once('open', () => { clearTimeout(timer); resolve(); });
        peer.once('error', error => { clearTimeout(timer); reject(new Error(peerErrorMessage(error))); });
      });
      const conn = peer.connect(hostId, { reliable: true, serialization: 'json' }); G.dc = conn;
      // PeerJS necesita una pista local para negociar una llamada multimedia; es una pista diminuta y descartable.
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const dummy = canvas.captureStream(1); G.dummyStream = dummy;
      const call = peer.call(hostId, dummy); G.call = call;
      if (!call) throw new Error('No se pudo iniciar la llamada multimedia. Comprueba que el anfitrión siga conectado.');
      call.on('stream', stream => { G.stream = stream; if (G.video) attachStream(stream); const status = qs('#nesStatus'); if (status && G.active) status.textContent = 'Online · Tú eres el jugador 2'; });
      call.on('error', error => { console.warn('[Arcadia Online] Falló el canal multimedia; se conserva el canal de controles:', error); if (G.joining || G.active) { const status = qs('#nesStatus'); if (status) status.textContent = 'Controles conectados; esperando vídeo del anfitrión…'; } });
      const opened = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El anfitrión no respondió. Verifica el código y que la sala esté abierta.')), 20000);
        conn.once('open', () => { clearTimeout(timer); resolve(); });
        conn.once('error', error => { clearTimeout(timer); reject(new Error(peerErrorMessage(error))); });
      });
      conn.on('open', () => { setupGuestChannel(conn); sendJson(conn, { t: 'hello', name: G.name }); });
      await opened;
    } catch (error) {
      cleanupGuest();
      throw error instanceof Error ? error : new Error(peerErrorMessage(error));
    }
  };
  cleanupGuest = function cleanupGuestPeerJS() {
    G.timers.forEach(timer => { clearTimeout(timer); clearInterval(timer); }); G.timers = [];
    bindGuestKeys(false);
    // Closing/destroying the PeerJS connection removes its event listeners.
    try { G.dc?.close(); } catch {} try { G.call?.close(); } catch {}
    try { G.dummyStream?.getTracks().forEach(track => track.stop()); } catch {}
    try { G.peer?.destroy(); } catch {}
    if (G.video) G.video.srcObject = null;
    qs('#gameSession').classList.remove('online-guest'); removeTags(); keepAwake(false);
    Object.assign(G, { active: false, joining: false, signal: null, pc: null, dc: null, peer: null, call: null, dummyStream: null, mask: 0, video: null, stream: null });
  };

  function wireUi() {
    qs('#onlineClose').addEventListener('click', closeOnlineModal);
    modal().addEventListener('click', event => { if (event.target === modal()) closeOnlineModal(); });
    qs('#onlineName').addEventListener('change', saveName);
    qs('#onlineJoinCode').addEventListener('input', event => { event.target.value = cleanCode(event.target.value); });
    qs('#onlineJoinCode').addEventListener('keydown', event => { if (event.key === 'Enter') qs('#onlineJoin').click(); });
    qs('#joinOnline').addEventListener('click', () => openOnlineModal('join'));
    qs('#onlineTile').addEventListener('click', () => openOnlineModal('join'));
    qs('#onlineNes').addEventListener('click', () => openOnlineModal('host'));
    const delaySelect = qs('#onlineDelay');
    if (delaySelect) {
      try { const saved = localStorage.getItem(DELAY_KEY); if (saved && [...delaySelect.options].some(opt => opt.value === saved)) delaySelect.value = saved; } catch {}
      delaySelect.addEventListener('change', () => { try { localStorage.setItem(DELAY_KEY, delaySelect.value); } catch {} });
    }
    qs('#onlineCreate').addEventListener('click', async () => {
      const button = qs('#onlineCreate'); button.disabled = true;
      try { await startHost(); } catch (error) { say(error.message, true); }
      button.disabled = false;
    });
    qs('#onlineCloseRoom').addEventListener('click', () => { closeRoom('Cerraste la sala.'); say('Sala cerrada.'); });
    qs('#onlineCopy').addEventListener('click', async () => { say(await copyText(H.code) ? 'Código copiado.' : 'No se pudo copiar. Dicta el código.', false); });
    qs('#onlineShare').addEventListener('click', async () => {
      const url = shareUrl();
      const text = `Juega conmigo en Arcadia · código ${H.code}`;
      if (navigator.share) { try { await navigator.share({ title: 'Arcadia Online', text, url }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
      say(await copyText(`${text}\n${url}`) ? 'Enlace copiado.' : 'No se pudo copiar el enlace.', false);
    });
    qs('#onlineJoin').addEventListener('click', async () => {
      const button = qs('#onlineJoin'); button.disabled = true;
      setStatus('Buscando la sala…');
      try { await joinRoom(qs('#onlineJoinCode').value); setStatus(''); }
      catch (error) { setStatus(error.message || 'No se pudo unir.', true); }
      button.disabled = false;
    });
    // Escape cierra primero esta ventana, y los teclados/mandos no se cuelan debajo.
    document.addEventListener('keydown', event => {
      if (!modal().classList.contains('open')) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeOnlineModal(); }
    }, true);
    document.addEventListener('keyup', event => { if (modal().classList.contains('open')) event.stopPropagation(); }, true);
  }

  /* ───── Arcadia Netplay 0.4.1: cada dispositivo ejecuta su propio emulador ─────
     Sin vídeo ni audio transmitidos. Ambos deben abrir exactamente la misma ROM.
     Los controles se replican a los dos emuladores mediante un canal PeerJS fiable.
     Es una primera versión experimental: la sincronía depende de que JSNES avance
     determinísticamente en ambos dispositivos; no ofrece rollback/frame-lock. */
  H.localMask = 0;
  G.remoteHostMask = 0;

  // Lockstep with a small input-delay pipeline. Each peer sends compact masks
  // for future frames so normal network latency is absorbed before a frame is due.
  // This is still strict lockstep (not rollback); very high RTT can still stall.
  // Retraso fijo de entrada (en cuadros). Lo elige el anfitrión al crear la sala y se lo comunica al invitado.
  // 5 ≈ 83 ms (Rápido), 8 ≈ 133 ms (Normal), 12 ≈ 200 ms (Estable), 18 ≈ 300 ms (Máximo).
  const DELAY_KEY = 'arcadia-online-delay2';
  const DELAY_LEVELS = [5, 8, 12, 18];
  const DELAY_NAMES = { 5: 'Rápido', 8: 'Normal', 12: 'Estable', 18: 'Máximo' };
  const delayName = d => DELAY_NAMES[d] || `${d} cuadros`;
  let LS_INPUT_DELAY = 5;   // retraso inicial (cuadros) de esta sesión
  let LS_AUTO = true;       // true: baja la velocidad si la red falla y vuelve a subir al estabilizarse
  function chosenDelay() {
    const value = document.getElementById('onlineDelay')?.value || 'auto';
    if (value === 'auto') return { auto: true, delay: 5 };
    const n = Number(value);
    return DELAY_LEVELS.includes(n) ? { auto: false, delay: n } : { auto: true, delay: 5 };
  }
  const LS = {
    active: false, role: '', frame: 0, conn: null,
    remoteFrames: new Map(), localFrames: new Map(), inputHistory: new Map(),
    appliedP1: 0, appliedP2: 0, installed: false, timerRef: null,
    myDelay: 5, peerDelay: 5, produced: -1, auto: true, lastWantAt: 0, lastWantRecvAt: 0, lastStepAt: 0, stallStart: 0, stallEvents: [],
    rtt: null, rttRecent: [], lastPingAt: 0, resyncPending: false,
    myHash: new Map(), peerHash: new Map(), hashFrame: -1, badStreak: 0, lastResyncAt: 0,
    previousGenerate: null, hostKeysInstalled: false, lastSentFrame: -1, lastSentMask: -1, lastSentAt: 0,
    diagTimer: null, diagNode: null, diagLastFrame: 0, diagLastAt: 0, diagRate: 0, diagRtt: null, diagStatsAt: 0, diagIce: 'sin datos', diagIceType: 'sin determinar', diagStartAt: 0, diagStartFrame: 0
  };

  // Diagnostic overlay removed from the user interface in 1.0.8.
  // Keep a safe cleanup hook for existing stop/reset paths.
  function ensureLockstepDiagnostics() {}
  function updateLockstepDiagnostics() {}
  function removeLockstepDiagnostics() {
    if (LS.diagTimer) clearInterval(LS.diagTimer);
    LS.diagTimer = null;
    if (LS.diagNode) LS.diagNode.remove();
    LS.diagNode = null;
  }
  const lockstepInput = () => LS.role === 'host' ? (H.localMask || 0) : (G.mask || 0);
  const lockstepRemoteInput = () => LS.role === 'host' ? (H.guest?.mask || 0) : (G.remoteHostMask || 0);

  function stopLockstep() {
    LS.active = false; LS.role = ''; LS.conn = null; LS.frame = 0;
    LS.remoteFrames.clear(); LS.localFrames.clear(); LS.inputHistory.clear(); LS.lastSentFrame = -1; LS.lastSentMask = -1; LS.lastSentAt = 0;
    LS.resyncPending = false; LS.rtt = null; LS.rttRecent = []; LS.lastPingAt = 0; LS.myHash.clear(); LS.peerHash.clear(); LS.hashFrame = -1; LS.badStreak = 0; LS.stallStart = 0; LS.stallEvents = [];
    removeLockstepDiagnostics();
    uninstallHostLockstepKeys();
  }
  // Margen que pide la red: mitad del ping + 20 ms de holgura, en cuadros de 16,7 ms.
  function rttNeedLevel() {
    if (!LS.rttRecent.length) return DELAY_LEVELS[0];
    const rtt = Math.max(...LS.rttRecent);
    const frames = Math.ceil((rtt / 2 + 20) / 16.7);
    return DELAY_LEVELS.find(level => level >= frames) || DELAY_LEVELS[DELAY_LEVELS.length - 1];
  }
  function stateHash() {
    const nes = localNes(); const cpu = nes?.cpu; if (!cpu) return 0;
    let h = 2166136261 >>> 0;
    const mem = cpu.mem;
    if (mem) for (let i = 0; i < 0x800; i++) { h ^= (mem[i] | 0) & 255; h = Math.imul(h, 16777619) >>> 0; }
    for (const v of [cpu.REG_ACC, cpu.REG_X, cpu.REG_Y, cpu.REG_SP, cpu.REG_PC]) { h ^= (v | 0) & 0xFFFF; h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function compareSync(frame) {
    const mine = LS.myHash.get(frame), theirs = LS.peerHash.get(frame);
    if (mine === undefined || theirs === undefined) return;
    LS.myHash.delete(frame); LS.peerHash.delete(frame);
    if (mine === theirs) { LS.badStreak = 0; return; }
    LS.badStreak++;
    console.warn('[Arcadia Lockstep] Huellas distintas en el cuadro', frame, { mine, theirs, racha: LS.badStreak });
    if (LS.role === 'host' && LS.badStreak >= 2 && performance.now() - LS.lastResyncAt > 8000 && H.guest?.connected && H.guest.dc?.open) {
      LS.lastResyncAt = performance.now(); LS.badStreak = 0;
      say('Corrigiendo la sincronización…');
      if (H.guest) H.guest.lockstepStartAck = false;
      // La captura del estado debe hacerse FUERA del ciclo de un cuadro (si no, el anfitrión avanza un cuadro
      // más que la foto y quedan desfasados): se congela el avance y se envía justo después.
      LS.resyncPending = true;
      setTimeout(() => {
        if (H.guest?.connected && H.guest.dc?.open && LS.active) sendInitialState(H.guest.dc, 'resync');
        else LS.resyncPending = false;
      }, 0);
    }
  }
  function lockstepCheckSync(frame) {
    LS.hashFrame = frame;
    const h = stateHash();
    LS.myHash.set(frame, h);
    sendJson(LS.conn, { t: 'ls-hash', f: frame, h });
    compareSync(frame);
    for (const key of [...LS.myHash.keys()]) if (key < frame - 480) LS.myHash.delete(key);
    for (const key of [...LS.peerHash.keys()]) if (key < frame - 480) LS.peerHash.delete(key);
  }
  function receiveLockstepControl(data) {
    if (data.t === 'ls-want') {
      const d = Number(data.d);
      if (LS.active && LS.auto && DELAY_LEVELS.includes(d) && d > LS.myDelay) {
        LS.myDelay = d; LS.lastWantRecvAt = performance.now(); LS.lastStepAt = LS.lastWantRecvAt; netplayStatus(delayStatus());
      } else if (LS.active) LS.lastWantRecvAt = performance.now();
    } else if (data.t === 'ls-ping') {
      sendJson(LS.conn, { t: 'ls-pong', n: data.n });
    } else if (data.t === 'ls-pong') {
      const ms = performance.now() - Number(data.n);
      if (LS.active && ms >= 0 && ms < 20000) { LS.rtt = ms; LS.rttRecent.push(ms); if (LS.rttRecent.length > 4) LS.rttRecent.shift(); }
    } else if (data.t === 'ls-hash') {
      const f = Number(data.f);
      if (LS.active && Number.isSafeInteger(f)) { LS.peerHash.set(f, Number(data.h) >>> 0); compareSync(f); }
    }
  }
  function installLockstepFrameGate() {
    const timer = nesBrowser?._frameTimer;
    if (!timer || LS.timerRef === timer) return;
    LS.previousGenerate = timer.onGenerateFrame;
    LS.timerRef = timer;
    timer.onGenerateFrame = function arcadiaLockstepGenerateFrame(...args) {
      if (!LS.active) return LS.previousGenerate?.apply(this, args);
      if (LS.resyncPending) return false;
      const frame = LS.frame;
      const now = performance.now();
      // Comprobación periódica de sincronía (cada 120 cuadros): compara una huella del estado del emulador.
      if (frame > 0 && frame % 120 === 0 && LS.hashFrame !== frame) lockstepCheckSync(frame);
      if (LS.resyncPending) return false;
      // Medición de ping propia (cada segundo) y ajuste automático del retraso.
      if (now - LS.lastPingAt >= 1000) { LS.lastPingAt = now; sendJson(LS.conn, { t: 'ls-ping', n: now }); }
      if (LS.auto) {
        const need = rttNeedLevel();
        if (need > LS.myDelay) { LS.myDelay = need; LS.lastStepAt = now; netplayStatus(delayStatus()); }
        else if (LS.myDelay > DELAY_LEVELS[0] && now - LS.lastWantRecvAt > 20000 && now - LS.lastStepAt > 20000) {
          const idx = DELAY_LEVELS.indexOf(LS.myDelay);
          if (idx > 0 && DELAY_LEVELS[idx - 1] >= need) { LS.myDelay = DELAY_LEVELS[idx - 1]; LS.lastStepAt = now; netplayStatus(delayStatus()); }
        }
      }
      // Cada entrada se escribe UNA sola vez (nunca se reescribe un cuadro ya enviado):
      // reescribirlo durante una espera de red desincronizaba las partidas.
      const localNow = lockstepInput() & 255;
      const wantTarget = frame + LS.myDelay;
      let firstNew = -1;
      for (let t = LS.produced + 1; t <= wantTarget; t++) {
        LS.localFrames.set(t, localNow); LS.inputHistory.set(t, localNow);
        if (firstNew < 0) firstNew = t;
      }
      if (firstNew >= 0) LS.produced = wantTarget;
      const targetFrame = LS.produced;
      const gap = firstNew >= 0 && targetFrame - firstNew > 0;
      if (firstNew >= 0 || now - LS.lastSentAt >= 80) {
        const msg = { t: 'frame-input', f: targetFrame, b: LS.inputHistory.get(targetFrame) & 255, d: LS.myDelay };
        if (gap || firstNew < 0) {
          const history = [];
          for (let f = Math.max(LS.frame, gap ? firstNew : targetFrame - 3); f <= targetFrame; f++) {
            if (LS.inputHistory.has(f)) history.push([f, LS.inputHistory.get(f)]);
          }
          msg.h = history;
        }
        sendJson(LS.conn, msg);
        LS.lastSentFrame = targetFrame;
        LS.lastSentMask = msg.b;
        LS.lastSentAt = now;
      }
      if (!LS.remoteFrames.has(frame) || !LS.localFrames.has(frame)) {
        if (!LS.lastStallAt) LS.lastStallAt = now;
        if (!LS.stallStart) {
          LS.stallStart = now;
          LS.stallEvents.push(now);
          while (LS.stallEvents.length && now - LS.stallEvents[0] > 3000) LS.stallEvents.shift();
        }
        // El otro dispositivo llega tarde: pídele más margen (en modo automático).
        if (LS.auto && now - LS.lastWantAt > 1200 && ((LS.stallEvents.length >= 3 && rttNeedLevel() > LS.peerDelay) || now - LS.stallStart > 300)) {
          const next = DELAY_LEVELS.find(level => level > LS.peerDelay);
          if (next) { LS.lastWantAt = now; sendJson(LS.conn, { t: 'ls-want', d: next }); }
        }
        if (now - LS.lastStallAt > 1000 && !LS.stallWarned) {
          LS.stallWarned = true;
          console.warn('[Arcadia Lockstep] Esperando entradas remotas', { frame: LS.frame, pending: LS.remoteFrames.size, delay: LS.myDelay });
          netplayStatus(`Online · esperando red (cuadro ${LS.frame})`);
        }
        return false;
      }
      LS.stallStart = 0;
      if (LS.stallWarned) netplayStatus(delayStatus());
      LS.lastStallAt = 0; LS.stallWarned = false;
      const remoteMask = LS.remoteFrames.get(frame) & 255;
      const localMask = LS.localFrames.get(frame) & 255;
      LS.remoteFrames.delete(frame); LS.localFrames.delete(frame);
      const nes = localNes();
      const p1 = LS.role === 'host' ? localMask : remoteMask;
      const p2 = LS.role === 'host' ? remoteMask : localMask;
      setPadMask(nes, 1, LS.appliedP1, p1); setPadMask(nes, 2, LS.appliedP2, p2);
      LS.appliedP1 = p1; LS.appliedP2 = p2; LS.frame++;
      // Amortize pruning rather than scanning every queued frame on every tick.
      if ((LS.frame & 31) === 0) {
        const minFrame = LS.frame;
        const maxFrame = LS.frame + 180;
        for (const key of LS.remoteFrames.keys()) {
          if (key < minFrame || key > maxFrame) LS.remoteFrames.delete(key);
        }
        for (const key of LS.localFrames.keys()) {
          if (key < minFrame || key > maxFrame) LS.localFrames.delete(key);
        }
        for (const key of LS.inputHistory.keys()) {
          if (key < minFrame - 4 || key > maxFrame) LS.inputHistory.delete(key);
        }
      }
      LS.previousGenerate?.apply(this, args);
      return true;
    };
    LS.installed = true;
  }
  function installHostLockstepKeys() {
    if (LS.hostKeysInstalled || !nesBrowser?.keyboard) return;
    const keyboard = nesBrowser.keyboard;
    document.removeEventListener('keydown', keyboard.handleKeyDown);
    document.removeEventListener('keyup', keyboard.handleKeyUp);
    const down = event => {
      if (!LS.active || LS.role !== 'host') return;
      if (typeof waitingForNesKey !== 'undefined' && waitingForNesKey) return;
      const entry = keyboard.keys?.[event.keyCode]; if (!entry || entry[0] !== 1) return;
      event.preventDefault(); event.stopPropagation(); hostButtonNetplay(entry[1], true);
    };
    const up = event => {
      if (!LS.active || LS.role !== 'host') return;
      const entry = keyboard.keys?.[event.keyCode]; if (!entry || entry[0] !== 1) return;
      event.preventDefault(); event.stopPropagation(); hostButtonNetplay(entry[1], false);
    };
    LS.hostKeyDown = down; LS.hostKeyUp = up;
    document.addEventListener('keydown', down, true); document.addEventListener('keyup', up, true);
    LS.hostKeysInstalled = true;
  }
  function uninstallHostLockstepKeys() {
    if (!LS.hostKeysInstalled) return;
    document.removeEventListener('keydown', LS.hostKeyDown, true);
    document.removeEventListener('keyup', LS.hostKeyUp, true);
    if (nesBrowser?.keyboard) {
      document.addEventListener('keydown', nesBrowser.keyboard.handleKeyDown);
      document.addEventListener('keyup', nesBrowser.keyboard.handleKeyUp);
    }
    LS.hostKeysInstalled = false; LS.hostKeyDown = null; LS.hostKeyUp = null;
  }
  function startLockstep(role, conn) {
    stopLockstep(); const nes = localNes(); if (!nes || !conn) return false;
    LS.role = role; LS.conn = conn; LS.frame = 0; LS.active = true; LS.diagStartAt = performance.now(); LS.diagStartFrame = 0; LS.diagRtt = null; LS.diagIce = 'buscando par'; LS.diagIceType = 'sin determinar'; LS.diagStatsAt = 0;
    const localMask = lockstepInput() & 255, remoteMask = lockstepRemoteInput() & 255;
    LS.appliedP1 = role === 'host' ? localMask : remoteMask;
    LS.appliedP2 = role === 'host' ? remoteMask : localMask;
    for (let f = 0; f < LS_INPUT_DELAY; f++) {
      LS.localFrames.set(f, localMask); LS.remoteFrames.set(f, remoteMask); LS.inputHistory.set(f, localMask);
    }
    LS.lastSentFrame = -1; LS.lastSentMask = -1; LS.lastSentAt = 0; LS.lastStallAt = 0; LS.stallWarned = false;
    LS.myDelay = LS_INPUT_DELAY; LS.peerDelay = LS_INPUT_DELAY; LS.produced = LS_INPUT_DELAY - 1; LS.auto = LS_AUTO;
    LS.lastWantAt = 0; LS.lastWantRecvAt = performance.now(); LS.lastStepAt = performance.now();
    installLockstepFrameGate();
    if (role === 'host') installHostLockstepKeys();
    ensureLockstepDiagnostics();
    netplayStatus(delayStatus());
    console.info('[Arcadia Lockstep] Iniciado', { role, rom: window.arcadiaRomFingerprint, inputDelayFrames: LS_INPUT_DELAY });
    return true;
  }
  function receiveLockstepInput(data) {
    if (!LS.active) return;
    const put = (frame, mask) => {
      if (!Number.isSafeInteger(frame) || frame < LS.frame || frame > LS.frame + 180) return;
      LS.remoteFrames.set(frame, Number(mask) & 255);
    };
    if (Array.isArray(data.h)) {
      for (const pair of data.h) {
        if (Array.isArray(pair) && pair.length >= 2) put(pair[0], pair[1]);
      }
    }
    put(data.f, data.b);
    const d = Number(data.d); if (Number.isInteger(d) && d >= 3 && d <= 24) LS.peerDelay = d;
  }

  const setPadMask = (nes, player, oldMask, newMask) => {
    if (!nes) return;
    for (let b = 0; b < 8; b++) {
      const was = (oldMask >> b) & 1, now = (newMask >> b) & 1;
      if (was !== now) now ? nes.buttonDown(player, b) : nes.buttonUp(player, b);
    }
  };
  const localNes = () => (typeof nesBrowser !== 'undefined' && nesBrowser ? nesBrowser.nes : null);
  const delayStatus = () => `Online · ${LS.auto ? 'auto · ' : ''}${delayName(LS.myDelay)}`;
  const netplayStatus = text => { const n = qs('#nesStatus'); if (n) n.textContent = text; };
  // Initial state sync: bring the guest to the exact emulation state of the host
  // when both devices loaded the same ROM. Large JSON states are chunked to avoid
  // browser/WebRTC maximum-message-size limits.
  const STATE_CHUNK_CHARS = 8000;
  function sendInitialState(conn, reason = 'initial') {
    const guest = H.guest;
    if (guest && guest.stateSending) return;
    if (guest) guest.stateSending = true;
    const nes = localNes();
    if (!nes || typeof nes.toJSON !== 'function') {
      sendJson(conn, { t: 'state-sync-error', message: 'El emulador no permite exportar el estado.' });
      try { nesBrowser?._frameTimer?.start(); } catch {}
      if (guest) guest.stateSending = false;
      return;
    }
    try {
      // Freeze the authoritative emulator so the transferred snapshot and the
      // lockstep start point represent exactly the same frame.
      const frameTimer = nesBrowser?._frameTimer;
      frameTimer?.stop();
      if (guest) {
        clearTimeout(guest.lockstepReadyTimer);
        guest.lockstepReadyTimer = setTimeout(() => {
          if (H.guest !== guest || !guest.connected || !guest.lockstepAwaiting) return;
          guest.lockstepAwaiting = false;
          stopLockstep();
          frameTimer?.start();
          say('No se pudo iniciar lockstep; la sala sigue conectada con controles normales.', true);
        }, 15000);
        guest.lockstepAwaiting = true;
      }
      const json = JSON.stringify(nes.toJSON());
      const transferId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const total = Math.ceil(json.length / STATE_CHUNK_CHARS);
      if (!LS.active) { const pick = chosenDelay(); LS_INPUT_DELAY = pick.delay; LS_AUTO = pick.auto; }
      sendJson(conn, { t: 'state-begin', id: transferId, total, length: json.length, reason, delay: LS_INPUT_DELAY, auto: LS_AUTO });
      let index = 0;
      const sendNext = () => {
        if (H.guest?.dc !== conn || !conn.open) return;
        if (index >= total) {
          sendJson(conn, { t: 'state-end', id: transferId });
          if (guest) guest.stateSending = false;
          return;
        }
        sendJson(conn, { t: 'state-chunk', id: transferId, index, chunk: json.slice(index * STATE_CHUNK_CHARS, (index + 1) * STATE_CHUNK_CHARS) });
        index++;
        setTimeout(sendNext, 4);
      };
      setTimeout(sendNext, 0);
    } catch (error) {
      console.warn('[Arcadia Netplay] No se pudo preparar el estado:', error);
      sendJson(conn, { t: 'state-sync-error', message: 'No se pudo preparar el estado de la partida.' });
      try { nesBrowser?._frameTimer?.start(); } catch {}
      if (guest) guest.stateSending = false;
    }
  }
  function applySyncedState(json, resumeTimer = true) {
    const nes = localNes();
    if (!nes || typeof nes.fromJSON !== 'function') throw new Error('El emulador no permite importar el estado.');
    const state = JSON.parse(json);
    // State transfers pause frame generation while chunks arrive. Preserve the
    // pre-transfer running flag: checking timer.running only here would always be
    // false because state-begin already stopped it (the 0.4.6 blank-screen bug).
    const timer = nesBrowser?._frameTimer;
    try {
      nes.fromJSON(state);
      // Repaint the restored PPU buffer without advancing an extra emulation frame.
      try { nesBrowser?._frameTimer?.onWriteFrame?.(); } catch {}
      if (resumeTimer) timer?.start();
      requestAnimationFrame(() => nesBrowser?.fitInParent?.());
    } catch (error) {
      if (resumeTimer) timer?.start();
      throw error;
    }
  }

  bindHostChannel = function bindHostNetplay(guest, conn) {
    guest.dc = conn;
    conn.on('data', raw => {
      if (H.guest !== guest) return;
      const data = parse(raw); if (!data) return;
      if (data.t === 'hello') {
        const hostHash = window.arcadiaRomFingerprint || '';
        const guestHash = data.rom || '';
        // Las huellas diferentes (p. ej. revisiones regionales) ya no bloquean la sala.
        // Se informa de la diferencia, porque el comportamiento del juego puede variar.
        if (hostHash && guestHash && hostHash !== guestHash) {
          console.warn('[Arcadia Netplay] ROM distintas; se permite conectar, pero la sincronización puede variar.', { anfitrion: hostHash, invitado: guestHash });
          say('Aviso: las ROM son diferentes; se permite conectar, pero la sincronización puede variar.', true);
        } else if (!hostHash || !guestHash) {
          console.warn('[Arcadia Netplay] No se obtuvo la huella de una ROM; se permite conectar.');
        }
        guest.connected = true; clearTimeout(guest.timeout); guest.name = cleanName(data.name) || 'Invitado';
        sendJson(conn, { t: 'welcome-netplay', host: H.name, p1: H.name, p2: guest.name, rom: hostHash, title: qs('#sessionGameTitle')?.textContent || '', hostMask: H.localMask || 0, guestMask: guest.mask || 0 });
        if (hostHash && guestHash && hostHash === guestHash) {
          // One initial snapshot only. Repeated full snapshots pause the guest.
          setTimeout(() => {
            if (H.guest === guest && guest.connected && conn.open) sendInitialState(conn, 'initial');
          }, 80);
        } else {
          // Never import CPU/PPU/mapper state from a different ROM: it can corrupt the guest screen.
          sendJson(conn, { t: 'state-sync-error', mode: 'input-only', message: 'Las ROM son diferentes; se mantienen los controles y no se importa un estado incompatible.' });
        }
        showTags(qs('#gameViewport'), H.name, guest.name);
        netplayStatus('Netplay · controles conectados');
        say(`${guest.name} se unió. Ambos dispositivos ejecutan la ROM localmente.`);
        renderHostUI();
      } else if (data.t === 'guest-mask' && guest.connected) {
        const next = Number(data.b) & 255;
        if (!LS.active) setPadMask(localNes(), 2, guest.mask || 0, next);
        guest.mask = next;
        sendJson(conn, { t: 'host-mask', b: H.localMask || 0, g: guest.mask });
      } else if ((data.t === 'ls-want' || data.t === 'ls-hash' || data.t === 'ls-ping' || data.t === 'ls-pong') && guest.connected) {
        receiveLockstepControl(data);
      } else if (data.t === 'frame-input' && guest.connected) {
        if (LS.active && LS.role === 'host') receiveLockstepInput(data);
      } else if (data.t === 'lockstep-start-ack' && guest.connected) {
        guest.lockstepStartAck = true;
        clearTimeout(guest.lockstepStartTimer);
        if (LS.active && LS.role === 'host') {
          const timer = nesBrowser?._frameTimer;
          timer?.start();
          netplayStatus(delayStatus());
        }
      } else if (data.t === 'lockstep-ready' && guest.connected) {
        clearTimeout(guest.lockstepReadyTimer); guest.lockstepAwaiting = false;
        const timer = nesBrowser?._frameTimer;
        if (startLockstep('host', conn)) {
          // Send the same initial controller masks to both emulators. The host
          // starts only after the guest has armed its frame gate and acknowledged.
          sendJson(conn, { t: 'lockstep-started', frame: 0, hostMask: H.localMask || 0, guestMask: guest.mask || 0, delay: LS_INPUT_DELAY });
          guest.lockstepStartTimer = setTimeout(() => {
            if (H.guest === guest && guest.connected && LS.active && LS.role === 'host' && !guest.lockstepStartAck) {
              stopLockstep();
              sendJson(conn, { t: 'state-sync-error', message: 'No llegó la confirmación de inicio sincronizado. Vuelve a conectar la sala.' });
            }
          }, 10000);
        } else {
          timer?.start();
          sendJson(conn, { t: 'state-sync-error', message: 'No se pudo iniciar lockstep en el anfitrión.' });
        }
      } else if (data.t === 'ping') sendJson(conn, { t: 'pong', n: data.n });
      else if (data.t === 'bye') dropGuest(`${guest.name || 'El invitado'} salió de la sala.`, false);
    });
    conn.on('close', () => { if (H.guest === guest) dropGuest(`${guest.name || 'El invitado'} se desconectó.`, false); });
    conn.on('error', err => console.warn('[Arcadia Netplay] DataConnection:', err));
  };

  startHost = async function startHostNetplay() {
    if (H.active) return;
    if (!(typeof nesBrowser !== 'undefined' && nesBrowser && activeNesGameId)) throw new Error('Abre una ROM de NES antes de crear la sala.');
    H.name = saveName() || 'Anfitrión';
    let peer = null, code = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      code = makeCode(); peer = makePeer(CFG.idPrefix + code);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Tiempo agotado al registrar la sala.')), 12000);
          peer.once('open', () => { clearTimeout(timer); resolve(); });
          peer.once('error', error => { clearTimeout(timer); reject(error); });
        }); break;
      } catch (error) {
        try { peer.destroy(); } catch {} peer = null;
        if (error?.type === 'unavailable-id' || error?.type === 'id-taken') continue;
        throw new Error(peerErrorMessage(error));
      }
    }
    if (!peer) throw new Error('No se pudo reservar una sala. Inténtalo de nuevo.');
    H.peer = peer; H.signal = null; H.code = code; H.active = true; H.guest = null; H.paused = false; H.localMask = 0;
    peer.on('connection', conn => {
      if (H.guest) { try { conn.close(); } catch {} return; }
      const guest = { id: conn.peer, pc: { close() {} }, dc: conn, call: null, pending: [], connected: false, name: '', mask: 0, ping: null, lostTimer: null, timeout: setTimeout(() => { if (H.guest === guest && !guest.connected) dropGuest('El invitado no completó el inicio.'); }, 20000), lockstepAwaiting: false, lockstepReadyTimer: null };
      H.guest = guest; bindHostChannel(guest, conn); renderHostUI();
    });
    peer.on('error', error => { console.warn('[Arcadia Netplay]', error); if (H.active && !H.guest) say(peerErrorMessage(error), true); });
    netplayStatus('Netplay · esperando jugador 2');
    showTags(qs('#gameViewport'), H.name, '', true); keepAwake(true); renderHostUI();
  };

  closeRoom = function closeNetplayRoom(reason = 'Cerraste la sala.') {
    if (!H.active) return;
    clearTimeout(H.guest?.lockstepReadyTimer);
    stopLockstep();
    try { nesBrowser?._frameTimer?.start(); } catch {}
    if (H.guest) { sendJson(H.guest.dc, { t: 'bye', reason }); setPadMask(localNes(), 2, H.guest.mask || 0, 0); try { H.guest.dc?.close(); } catch {} }
    H.guest = null; H.active = false; H.code = ''; H.localMask = 0;
    try { H.peer?.destroy(); } catch {} H.peer = null; H.signal = null;
    removeTags(); keepAwake(false); renderHostUI();
    if (localNes()) netplayStatus('NES integrado · juego local');
  };

  joinRoom = async function joinNetplayRoom(rawCode) {
    if (G.joining || G.active) return;
    if (!(typeof nesBrowser !== 'undefined' && nesBrowser && activeNesGameId)) throw new Error('Abre un juego NES en este dispositivo antes de unirte a la sala.');
    const code = cleanCode(rawCode); if (code.length !== 5) throw new Error('El código tiene 5 letras o números.');
    if (typeof window.Peer !== 'function') throw new Error('No se cargó PeerJS. Comprueba internet y recarga Arcadia.');
    G.name = saveName() || 'Invitado'; G.joining = true;
    try {
      const peer = makePeer(); G.peer = peer;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tiempo agotado al contactar el servicio global.')), 12000);
        peer.once('open', () => { clearTimeout(timer); resolve(); });
        peer.once('error', error => { clearTimeout(timer); reject(new Error(peerErrorMessage(error))); });
      });
      const conn = peer.connect(CFG.idPrefix + code, { reliable: true, serialization: 'json' }); G.dc = conn;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El anfitrión no respondió. Revisa el código y que su sala siga abierta.')), 20000);
        conn.once('open', () => { clearTimeout(timer); resolve(); });
        conn.once('error', error => { clearTimeout(timer); reject(new Error(peerErrorMessage(error))); });
      });
      G.joining = false; G.active = true; G.mask = 0; G.remoteHostMask = 0;
      conn.on('data', raw => {
        const data = parse(raw); if (!data) return;
        if (data.t === 'reject') { if (data.reason === 'ROM diferente') { console.warn('[Arcadia Netplay] El anfitrión usa una versión anterior que bloquea ROM diferentes. Actualiza ambos dispositivos.'); say('El anfitrión usa una versión anterior. Actualiza ambos dispositivos a Arcadia v0.4.5.', true); } else say('El anfitrión rechazó la conexión.', true); endGuest(); return; }
        if (data.t === 'welcome-netplay') {
          if (data.rom && window.arcadiaRomFingerprint && data.rom !== window.arcadiaRomFingerprint) {
            console.warn('[Arcadia Netplay] ROM distinta; conexión permitida. La sincronización puede variar.', { anfitrion: data.rom, invitado: window.arcadiaRomFingerprint });
            say('Aviso: las ROM son diferentes; se permite conectar, pero la sincronización puede variar.', true);
          }
          G.hostName = cleanName(data.host) || 'Anfitrión';
          G.remoteHostMask = Number(data.hostMask || 0) & 255;
          showTags(qs('#gameViewport'), cleanName(data.p1), cleanName(data.p2));
          qs('#sessionGameTitle').textContent = `${data.title || 'Juego NES'} · Netplay`;
          netplayStatus('Netplay · controles conectados');
          closeOnlineModal(); keepAwake(true); bindGuestKeys(true);
          sendJson(conn, { t: 'guest-mask', b: G.mask });
        } else if (data.t === 'state-begin') {
          { const d = Number(data.delay); if (Number.isInteger(d) && d >= 3 && d <= 24 && !LS.active) { LS_INPUT_DELAY = d; LS_AUTO = data.auto !== false; } }
          const frameTimer = localNes()?._frameTimer;
          G.stateTransfer = { id: data.id, total: Number(data.total) || 0, length: Number(data.length) || 0, chunks: new Array(Number(data.total) || 0), received: 0, reason: data.reason || 'initial', wasRunning: !!frameTimer?.running };
          netplayStatus(data.reason === 'resync' ? 'Online · corrigiendo sincronización…' : 'Online · sincronizando estado de la partida…');
          try { frameTimer?.stop(); } catch {}
        } else if (data.t === 'state-chunk') {
          const transfer = G.stateTransfer;
          if (transfer && transfer.id === data.id && Number.isInteger(data.index) && data.index >= 0 && data.index < transfer.total && typeof data.chunk === 'string' && transfer.chunks[data.index] === undefined) {
            transfer.chunks[data.index] = data.chunk; transfer.received++;
          }
        } else if (data.t === 'state-end') {
          const transfer = G.stateTransfer;
          if (transfer && transfer.id === data.id) {
            try {
              if (transfer.received !== transfer.total) throw new Error('Llegó incompleto el estado de la partida.');
              const json = transfer.chunks.join('');
              if (transfer.length && json.length !== transfer.length) throw new Error('El estado recibido está incompleto.');
              applySyncedState(json, false);
              const conn = G.dc;
              if (!startLockstep('guest', conn)) throw new Error('No se pudo iniciar el coordinador lockstep.');
              sendJson(conn, { t: 'lockstep-ready' });
              // Keep the guest paused until the host's explicit start signal.
              // Starting immediately here can let it advance frames before the host.
              netplayStatus('Netplay · esperando inicio sincronizado…');
              if (transfer.reason !== 'resync') say('Estado inicial recibido; iniciando sincronización por cuadros.');
            } catch (error) {
              try { localNes()?._frameTimer?.start(); } catch {}
              console.warn('[Arcadia Netplay] Error al sincronizar estado:', error);
              netplayStatus('Online · no se pudo sincronizar el estado');
              say('Los controles están conectados, pero no se pudo sincronizar el estado de la partida.', true);
            } finally { G.stateTransfer = null; }
          }
        } else if (data.t === 'state-sync-error') {
          stopLockstep();
          try { localNes()?._frameTimer?.start(); } catch {}
          G.stateTransfer = null;
          netplayStatus('Online · controles conectados; estado no sincronizado');
          say(data.message || 'No se pudo sincronizar el estado de la partida.', true);
        } else if (data.t === 'host-mask') {
          const next = Number(data.b) & 255;
          if (!LS.active) setPadMask(localNes(), 1, G.remoteHostMask || 0, next);
          G.remoteHostMask = next;
        } else if (data.t === 'ls-want' || data.t === 'ls-hash' || data.t === 'ls-ping' || data.t === 'ls-pong') {
          receiveLockstepControl(data);
        } else if (data.t === 'frame-input') {
          if (LS.active && LS.role === 'guest') receiveLockstepInput(data);
        } else if (data.t === 'lockstep-started') {
          if (LS.active && LS.role === 'guest') {
            // Align the pipeline's initial masks with the host's authoritative
            // values before either emulator is allowed to advance.
            const hostMask = Number(data.hostMask || 0) & 255;
            const guestMask = Number(data.guestMask || 0) & 255;
            for (let f = 0; f < LS_INPUT_DELAY; f++) {
              LS.localFrames.set(f, guestMask);
              LS.remoteFrames.set(f, hostMask);
            }
            LS.appliedP1 = hostMask;
            LS.appliedP2 = guestMask;
            sendJson(conn, { t: 'lockstep-start-ack', frame: Number(data.frame) || 0 });
            netplayStatus(delayStatus());
            try { nesBrowser?._frameTimer?.start(); } catch {}
          }
        } else if (data.t === 'pong') {
          const ms = Math.round(performance.now() - Number(data.n)); if (ms >= 0 && ms < 10000) { if (LS.active) LS.diagRtt = ms; const n = qs('#nesFps'); if (n) n.textContent = `${ms} ms`; sendJson(conn, { t: 'rtt', ms }); }
        } else if (data.t === 'bye') endGuest(cleanText(data.reason) || 'El anfitrión cerró la sala.');
      });
      conn.on('close', () => { if (G.active) endGuest('Se cerró la conexión con el anfitrión.'); });
      conn.on('error', err => console.warn('[Arcadia Netplay] DataConnection:', err));
      sendJson(conn, { t: 'hello', name: G.name, rom: window.arcadiaRomFingerprint });
      G.timers.push(setInterval(() => sendJson(conn, { t: 'ping', n: performance.now() }), 2000));
    } catch (error) {
      cleanupGuest(); throw error instanceof Error ? error : new Error(peerErrorMessage(error));
    }
  };

  const hostButtonNetplay = (button, down) => {
    if (!H.active) return;
    const bit = 1 << button; const next = down ? ((H.localMask || 0) | bit) : ((H.localMask || 0) & ~bit);
    if (next === H.localMask) return;
    H.localMask = next;
    if (H.guest?.connected && !LS.active) sendJson(H.guest.dc, { t: 'host-mask', b: H.localMask, g: H.guest.mask || 0 });
  };

  guestButton = function guestNetplayButton(button, down) {
    if (!G.active) return;
    const bit = 1 << button; const next = down ? (G.mask | bit) : (G.mask & ~bit);
    if (next === G.mask) return;
    if (!LS.active) setPadMask(localNes(), 2, G.mask, next);
    G.mask = next;
    if (!LS.active) sendJson(G.dc, { t: 'guest-mask', b: G.mask });
  };

  // Resend compact controller masks at 60 Hz to recover from delayed/lost input transitions.
  // This is intentionally not a full state snapshot: snapshots pause the game and can corrupt other ROMs.
  let hostInputHeartbeat = null;
  let guestInputHeartbeat = null;
  function startInputHeartbeats() {
    clearInterval(hostInputHeartbeat); clearInterval(guestInputHeartbeat);
    hostInputHeartbeat = setInterval(() => {
      const guest = H.guest;
      if (H.active && !LS.active && guest?.connected && guest.dc?.open) sendJson(guest.dc, { t: 'host-mask', b: H.localMask || 0 });
    }, 1000 / 60);
    guestInputHeartbeat = setInterval(() => {
      if (G.active && !LS.active && G.dc?.open) sendJson(G.dc, { t: 'guest-mask', b: G.mask || 0 });
    }, 1000 / 60);
  }
  startInputHeartbeats();

  cleanupGuest = function cleanupNetplayGuest() {
    stopLockstep();
    G.timers.forEach(timer => { clearTimeout(timer); clearInterval(timer); }); G.timers = [];
    bindGuestKeys(false);
    G.active = false; G.joining = false; G.mask = 0; G.remoteHostMask = 0; G.stateTransfer = null;
    try { G.dc?.close(); } catch {} try { G.peer?.destroy(); } catch {}
    G.dc = null; G.peer = null; G.call = null; G.video = null; G.stream = null;
    removeTags(); keepAwake(false);
    if (localNes()) netplayStatus('NES integrado · juego local');
  };
  dropGuest = function dropNetplayGuest(reason, tellGuest = true) {
    const guest = H.guest; if (!guest) return;
    clearTimeout(guest.lockstepReadyTimer);
    if (LS.active && LS.role === 'host') { stopLockstep(); try { nesBrowser?._frameTimer?.start(); } catch {} }
    H.guest = null; clearTimeout(guest.timeout); clearTimeout(guest.lostTimer);
    setPadMask(localNes(), 2, guest.mask || 0, 0);
    if (tellGuest) sendJson(guest.dc, { t: 'bye', reason });
    try { guest.dc?.close(); } catch {}
    if (H.active) { showTags(qs('#gameViewport'), H.name, '', true); if (reason) say(reason); renderHostUI(); }
  };

  endGuest = function endNetplayGuest(message) {
    const wasActive = G.active;
    if (G.dc && wasActive) sendJson(G.dc, { t: 'bye' });
    cleanupGuest();
    if (message) say(message, true);
  };

  /* Netplay UI copy: no video transmission is used in this mode. */
  const hint = qs('#onlineHostHint');
  if (hint) hint.textContent = 'Para lockstep, ambos jugadores deben abrir una ROM idéntica. Con ROM distintas se mantienen los controles, pero cada pantalla ejecuta su propia versión.';
  const guestHelp = qs('#onlineJoinBox')?.querySelector('p');
  if (guestHelp) guestHelp.textContent = 'Paso 1: abre un juego NES en este dispositivo. Paso 2: abre Online, escribe el código del anfitrión y pulsa Unirse. Para sincronización por cuadros, abre exactamente el mismo archivo ROM que el anfitrión. Con ROM diferentes solo se intercambian controles.';

  window.arcadiaOnline = {
    peerOptions: PEER_OPTIONS,
    isGuest: () => G.active,
    isLockstep: () => LS.active,
    isHosting: () => !!H.active,
    guestButton,
    hostButton: hostButtonNetplay,
    hostPaused(value) { H.paused = !!value; if (H.guest?.connected) sendJson(H.guest.dc, { t: 'paused', v: H.paused }); },
    /** Llamado al salir de la partida (anfitrión o invitado). */
    sessionClosed() {
      if (H.active) closeRoom('El anfitrión salió de la partida.');
      if (G.active || G.joining) { const dc = G.dc; if (G.active) sendJson(dc, { t: 'bye' }); cleanupGuest(); }
    }
  };

  wireUi();
  const roomFromLink = cleanCode(new URLSearchParams(location.search).get('sala'));
  if (roomFromLink.length === 5) {
    setTimeout(() => { openOnlineModal('join'); qs('#onlineJoinCode').value = roomFromLink; }, 500);
    try { history.replaceState(null, '', location.pathname); } catch {}
  }
})();
