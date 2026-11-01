(window.ARCADIA_FILES=window.ARCADIA_FILES||{})['cloud-saves.js']='2.6.0';
/* Arcadia · Cuenta opcional + partidas en la nube.
 * Nadie está obligado a registrarse: sin cuenta todo funciona igual y las partidas quedan en este navegador.
 * Con cuenta (Google o correo) se copian las partidas GBA (.sav) y los estados guardados de NES a Firebase Realtime Database
 * bajo users/<uid>/ y se descargan en otros dispositivos. Las ROMs NUNCA se suben.
 * Reglas de seguridad necesarias en Firebase: ver LEEME-CUENTAS.txt */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const LS_META = 'arcadia-cloud-meta', LS_HINT = 'arcadia-cloud-hint', LS_LAST = 'arcadia-cloud-last';
  const SYNC_MS = 60000, MAX_ITEMS = 80, MAX_B64 = 650000;
  const say = (m, e) => { try { notify(m, e); } catch { console.log(m); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ───────────── utilidades ───────────── */
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const hash = u8 => { let h = 2166136261; for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619); return (h >>> 0).toString(16) + ':' + u8.length; };
  const enc = id => btoa(unescape(encodeURIComponent(id))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function pipe(u8, Stream, kind) {
    const s = new Blob([u8]).stream().pipeThrough(new Stream(kind));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const gzip = async u8 => (typeof CompressionStream === 'function') ? { z: 1, u8: await pipe(u8, CompressionStream, 'gzip') } : { z: 0, u8 };
  const gunzip = async (u8, z) => z ? pipe(u8, DecompressionStream, 'gzip') : u8;
  const blank = u8 => { const v = u8[0]; if (v !== 0 && v !== 255) return false; for (let i = 1; i < u8.length; i++) if (u8[i] !== v) return false; return true; };
  const niceName = k => String(k).replace(/^gba:|^state:/, '').replace(/^TYPE_/, '').replace(/:slot:\d+$/, '');
  const meta = { get() { try { return JSON.parse(localStorage.getItem(LS_META) || '{}') || {}; } catch { return {}; } }, set(m) { try { localStorage.setItem(LS_META, JSON.stringify(m)); } catch {} } };

  /* ───────────── almacenamiento local ───────────── */
  const openDb = (name, stores) => new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const s of stores) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const dbExists = async name => { try { const l = await indexedDB.databases?.(); return !l || l.some(d => d.name === name); } catch { return true; } };
  async function allOf(dbName, stores, store) {
    if (!(await dbExists(dbName))) return [];
    const db = await openDb(dbName, stores);
    try {
      return await new Promise((res, rej) => {
        const out = []; const tx = db.transaction(store, 'readonly'); const os = tx.objectStore(store);
        const c = os.openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
        c.onerror = () => rej(c.error);
      });
    } finally { db.close(); }
  }
  async function putTo(dbName, stores, store, key, value) {
    const db = await openDb(dbName, stores);
    try { await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } finally { db.close(); }
  }
  const GBA = ['arcadia-gba', ['saves'], 'saves'], NES = ['arcadia-local', ['roms', 'states'], 'states'];

  /** Todas las partidas locales como { id, kind, key, bytes }. */
  async function localItems() {
    const out = [];
    for (const [k, v] of await allOf(...GBA).catch(() => [])) {
      if (typeof k !== 'string' || !k.startsWith('gba:') || !(v && v.length)) continue;
      out.push({ id: 'gba|' + k, kind: 'gba', key: k, bytes: Uint8Array.from(v) });
    }
    for (const [k, v] of await allOf(...NES).catch(() => [])) {
      if (typeof k !== 'string' || !k.startsWith('state:') || !v) continue;
      out.push({ id: 'nes|' + k, kind: 'nes', key: k, bytes: new TextEncoder().encode(JSON.stringify(v)) });
    }
    return out;
  }
  async function applyItem(kind, key, bytes) {
    if (kind === 'gba') await putTo(...GBA, key, bytes);
    else await putTo(...NES, key, JSON.parse(new TextDecoder().decode(bytes)));
  }

  /* ───────────── Firebase ───────────── */
  const st = { user: null, busy: false, msg: '', err: false, last: 0, timer: 0, ready: false };
  const fb = () => window.firebase;
  const auth = () => fb()?.auth?.();
  const dbRef = p => fb().database().ref(p);
  async function whenReady() { try { await window.ARCADIA_FIREBASE_READY; } catch {} return !!fb()?.auth; }

  const ERRS = {
    'auth/invalid-email': 'El correo no es válido.', 'auth/missing-password': 'Escribe tu contraseña.', 'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/email-already-in-use': 'Ese correo ya tiene una cuenta. Prueba "Entrar".', 'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.', 'auth/invalid-credential': 'Correo o contraseña incorrectos.', 'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.', 'auth/network-request-failed': 'Sin conexión a internet.',
    'auth/operation-not-allowed': 'Este método de acceso aún no está activado en Arcadia.', 'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase (falta añadir el dominio).',
    'PERMISSION_DENIED': 'Firebase rechazó guardar: faltan las reglas de la base de datos (ver LEEME-CUENTAS.txt).'
  };
  const errText = e => ERRS[e?.code] || ERRS[String(e?.message || '').includes('PERMISSION_DENIED') ? 'PERMISSION_DENIED' : ''] || (e?.message || 'Ocurrió un error.');

  /* ───────────── sincronización ───────────── */
  async function syncNow(manual) {
    if (!st.user || st.busy) return;
    st.busy = true; st.msg = 'Sincronizando…'; st.err = false; render();
    let up = 0, down = 0;
    try {
      const uid = st.user.uid, base = `users/${uid}`;
      const cm = (await dbRef(base + '/meta').once('value')).val() || {};
      const local = await localItems(); const lm = meta.get(); const seen = new Set();
      for (const it of local.slice(0, MAX_ITEMS)) {
        const e = enc(it.id); seen.add(e); const h = hash(it.bytes); const c = cm[e]; const m = lm[it.id];
        if (c && c.h === h) { lm[it.id] = { h, t: c.t }; continue; }                                         // ya es igual
        const localChanged = !m || m.h !== h, cloudChanged = c && (!m || c.t > m.t);
        let pullCloud = c && cloudChanged && !localChanged;
        if (c && cloudChanged && localChanged) {                                                               // las dos versiones cambiaron: nunca se pierde ninguna
          if (blank(it.bytes)) pullCloud = true;                                                               // la local está vacía (dispositivo nuevo)
          else if (String(it.key).includes('TYPE_')) pullCloud = false;
          else if (!m) pullCloud = confirm(`La partida «${niceName(it.key)}» existe en tu cuenta y en este dispositivo, y son distintas.\n\nAceptar = usar la de tu cuenta.\nCancelar = usar la de este dispositivo.\n\n(La otra se guarda como respaldo en tu cuenta.)`);
          else pullCloud = false;                                                                              // jugaste en dos sitios: gana lo local, la de la nube queda de respaldo
          const bk = pullCloud ? { d: b64((await gzip(it.bytes)).u8), z: (await gzip(it.bytes)).z } : (await dbRef(`${base}/data/${e}`).once('value')).val();
          if (bk) await dbRef(`${base}/prev/${e}`).set(bk);
        }
        if (pullCloud) {                                                                                       // descargar la de la nube
          const d = (await dbRef(`${base}/data/${e}`).once('value')).val();
          if (d?.d) { await applyItem(it.kind, it.key, await gunzip(unb64(d.d), d.z)); lm[it.id] = { h: c.h, t: c.t }; down++; }
          continue;
        }
        const z = await gzip(it.bytes); const dd = b64(z.u8);
        if (dd.length > MAX_B64) continue;
        const t = Date.now();
        await dbRef(`${base}/data/${e}`).set({ d: dd, z: z.z });
        await dbRef(`${base}/meta/${e}`).set({ k: it.id, h, t });
        lm[it.id] = { h, t }; up++;
      }
      for (const [e, c] of Object.entries(cm)) {                                                               // partidas que solo existen en la nube
        if (seen.has(e) || !c?.k) continue;
        const d = (await dbRef(`${base}/data/${e}`).once('value')).val(); if (!d?.d) continue;
        const [kind, ...rest] = String(c.k).split('|'); const key = rest.join('|');
        if (!(kind === 'gba' && key.startsWith('gba:')) && !(kind === 'nes' && key.startsWith('state:'))) continue;
        await applyItem(kind, key, await gunzip(unb64(d.d), d.z)); lm[c.k] = { h: c.h, t: c.t }; down++;
      }
      meta.set(lm); st.last = Date.now(); try { localStorage.setItem(LS_LAST, String(st.last)); } catch {}
      st.msg = up || down ? `Sincronizado: ${up} subida(s), ${down} descarga(s).` : 'Todo está al día.';
      if (down && document.querySelector('#gbaModal.open, #gameSession.open')) st.msg += ' Cierra y vuelve a abrir el juego para usar la partida descargada.';
      if (manual || down) say(down ? `☁️ ${down} partida(s) descargada(s) de tu cuenta.` : '☁️ Partidas sincronizadas.');
    } catch (e) { st.err = true; st.msg = 'No se pudo sincronizar: ' + errText(e); console.warn('Arcadia cloud:', e); }
    st.busy = false; render();
  }

  /* ───────────── cuenta ───────────── */
  async function signedIn(user) {
    st.user = user && !user.isAnonymous ? user : null;
    clearInterval(st.timer);
    if (st.user) { st.timer = setInterval(() => { if (!document.hidden) syncNow(false); }, SYNC_MS); st.msg = ''; await syncNow(false); }
    else { st.msg = ''; }
    render(); updateBtn();
  }
  async function initAuth() {
    if (!(await whenReady())) { st.ready = false; render(); return; }
    st.ready = true;
    try { await auth().getRedirectResult(); } catch (e) { st.err = true; st.msg = errText(e); }
    auth().onAuthStateChanged(u => signedIn(u));
  }
  async function google() {
    if (!(await whenReady())) { st.err = true; st.msg = 'No se pudo cargar el servicio de cuentas. Revisa tu conexión.'; render(); return; }
    const p = new (fb().auth.GoogleAuthProvider)();
    try { await auth().signInWithPopup(p); }
    catch (e) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') { try { await auth().signInWithRedirect(p); return; } catch (e2) { e = e2; } }
      st.err = true; st.msg = errText(e); render();
    }
  }
  async function email(mode) {
    const mail = $('#acMail')?.value.trim(), pass = $('#acPass')?.value || '';
    if (!(await whenReady())) { st.err = true; st.msg = 'No se pudo cargar el servicio de cuentas. Revisa tu conexión.'; render(); return; }
    try {
      st.msg = 'Un momento…'; st.err = false; render();
      if (mode === 'new') await auth().createUserWithEmailAndPassword(mail, pass);
      else if (mode === 'reset') { await auth().sendPasswordResetEmail(mail); st.msg = 'Te enviamos un correo para restablecer la contraseña.'; render(); return; }
      else await auth().signInWithEmailAndPassword(mail, pass);
    } catch (e) { st.err = true; st.msg = errText(e); render(); }
  }
  async function signOut() {
    clearInterval(st.timer);
    try { await auth().signOut(); await auth().signInAnonymously().catch(() => {}); } catch {}
    st.user = null; st.msg = 'Sesión cerrada. Tus partidas siguen en este dispositivo.'; st.err = false; render(); updateBtn();
  }

  /* ───────────── interfaz ───────────── */
  const style = document.createElement('style');
  style.textContent = `
  #acPanel{position:fixed;inset:0;z-index:320;display:none;place-items:center;background:#02050bee;padding:16px;overflow:auto}
  #acPanel.open{display:grid}
  #acPanel .ac-card{width:min(460px,100%);background:#101925;border:1px solid #2f4a63;border-radius:18px;padding:clamp(16px,3vw,24px);color:#e9f1f7;display:grid;gap:12px}
  #acPanel h2{margin:0;font-size:clamp(18px,3vw,22px)}#acPanel p{margin:0;color:#b8c8d6;font-size:14px;line-height:1.45}
  #acPanel small{color:#8fa3b4;font-size:12px;line-height:1.4}
  #acPanel .ac-sec{background:#0b121b;border:1px solid #243a4f;border-radius:14px;padding:14px;display:grid;gap:10px}
  #acPanel button,#acPanel input{font:inherit;border-radius:10px;border:1px solid #35566f;background:#16283a;color:#fff;padding:9px 12px;min-height:42px}
  #acPanel input{width:100%;box-sizing:border-box}#acPanel button.primary{background:#c4f36a;color:#10210a;border-color:#c4f36a;font-weight:700}
  #acPanel button.danger{background:#5c2530;border-color:#a3495a}#acPanel .ac-row{display:flex;gap:8px;flex-wrap:wrap}#acPanel .ac-row>button{flex:1}
  #acPanel .ac-ok{color:#8fe39a}#acPanel .ac-err{color:#ffb86b}#acPanel button:focus-visible,#acPanel input:focus-visible{outline:3px solid #c4f36a}
  #acBtn.signed{color:#c4f36a}
  #acHint{position:fixed;left:14px;bottom:14px;z-index:150;max-width:min(340px,calc(100vw - 28px));background:#101925;border:1px solid #2f4a63;border-radius:14px;padding:12px 14px;color:#e9f1f7;font:14px/1.4 system-ui,sans-serif;display:none;gap:8px;box-shadow:0 10px 30px #000a}
  #acHint.show{display:grid}#acHint .ac-row{display:flex;gap:8px}#acHint button{font:inherit;border-radius:9px;border:1px solid #35566f;background:#16283a;color:#fff;padding:7px 11px;min-height:36px}
  #acHint button.primary{background:#c4f36a;color:#10210a;border-color:#c4f36a;font-weight:700}`;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'acPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Cuenta de Arcadia');
  panel.innerHTML = '<div class="ac-card"><h2>☁️ Cuenta de Arcadia <small>(opcional)</small></h2><div id="acBody"></div><div class="ac-row"><button id="acClose">Cerrar</button></div></div>';
  document.body.appendChild(panel);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const open = () => { panel.classList.add('open'); render(); };
  const close = () => panel.classList.remove('open');
  $('#acClose').onclick = close;
  panel.addEventListener('pointerdown', e => { if (e.target === panel) close(); });
  window.addEventListener('keydown', e => { if (panel.classList.contains('open')) { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && (e.target.id === 'acPass')) $('#acLogin')?.click(); } }, true);

  function render() {
    const body = $('#acBody'); if (!body) return;
    const msg = st.msg ? `<p class="${st.err ? 'ac-err' : 'ac-ok'}">${esc(st.msg)}</p>` : '';
    if (st.user) {
      const when = st.last ? new Date(st.last).toLocaleTimeString() : '—';
      body.innerHTML = `<div class="ac-sec"><p><b>${esc(st.user.displayName || st.user.email || 'Tu cuenta')}</b><br><small>${esc(st.user.email || '')}</small></p>
        <p>Tus partidas guardadas (GBA y NES) se copian a tu cuenta y se descargan en cualquier dispositivo donde entres. Última sincronización: ${when}.</p>${msg}
        <div class="ac-row"><button class="primary" id="acSync" ${st.busy ? 'disabled' : ''}>Sincronizar ahora</button><button class="danger" id="acOut">Cerrar sesión</button></div>
        <small>Tus ROMs no se suben: solo las partidas guardadas. Cada dispositivo necesita tener su propia ROM.</small></div>`;
      $('#acSync').onclick = () => syncNow(true); $('#acOut').onclick = signOut;
    } else {
      body.innerHTML = `<div class="ac-sec"><p>Arcadia funciona sin cuenta; tus partidas se guardan solo en este navegador. <b>Si quieres</b>, crea una cuenta gratis para guardarlas en la nube y no perderlas si cambias de dispositivo o borras los datos del navegador.</p>
        <button class="primary" id="acGoogle">Continuar con Google</button>
        <small>o con correo y contraseña</small>
        <input id="acMail" type="email" autocomplete="email" placeholder="Correo" aria-label="Correo"><input id="acPass" type="password" autocomplete="current-password" placeholder="Contraseña (mínimo 6)" aria-label="Contraseña">
        <div class="ac-row"><button id="acLogin">Entrar</button><button id="acNew">Crear cuenta</button></div>
        <button id="acReset" style="background:none;border:none;text-decoration:underline;min-height:30px;color:#9fb6c8">Olvidé mi contraseña</button>${msg}
        ${st.ready ? '' : '<p class="ac-err">El servicio de cuentas aún no está disponible (sin conexión o bloqueado).</p>'}</div>`;
      $('#acGoogle').onclick = google; $('#acLogin').onclick = () => email('in'); $('#acNew').onclick = () => email('new'); $('#acReset').onclick = () => email('reset');
    }
  }
  function updateBtn() { const b = $('#acBtn'); if (b) { b.classList.toggle('signed', !!st.user); b.title = st.user ? 'Cuenta: sesión iniciada' : 'Cuenta (opcional): guarda tus partidas en la nube'; } }
  function addButton() {
    const nav = $('.nav'); if (!nav || $('#acBtn')) return;
    const b = document.createElement('button'); b.id = 'acBtn'; b.setAttribute('aria-label', 'Cuenta');
    b.innerHTML = '☁<span class="tooltip">Cuenta</span>'; b.onclick = open;
    nav.insertBefore(b, $('#newsButton') || null); updateBtn();
  }

  /* Aviso suave y único: solo aparece si ya hay partidas guardadas y nunca obliga a nada. */
  async function maybeHint() {
    try { if (localStorage.getItem(LS_HINT) || st.user) return; } catch { return; }
    const items = await localItems().catch(() => []); if (!items.length || st.user) return;
    const h = document.createElement('div'); h.id = 'acHint'; h.setAttribute('role', 'status');
    h.innerHTML = '<div>☁️ ¿Quieres guardar tus partidas en la nube? Es <b>opcional</b> y gratis.</div><div class="ac-row"><button class="primary" id="acHintYes">Ver cómo</button><button id="acHintNo">Ahora no</button></div>';
    document.body.appendChild(h); h.classList.add('show');
    const done = () => { try { localStorage.setItem(LS_HINT, '1'); } catch {} h.remove(); };
    $('#acHintYes').onclick = () => { done(); open(); }; $('#acHintNo').onclick = done;
    setTimeout(() => { if (document.body.contains(h)) done(); }, 20000);
  }

  addButton(); render();
  try { st.last = +localStorage.getItem(LS_LAST) || 0; } catch {}
  initAuth();
  setTimeout(maybeHint, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.user) syncNow(false); });
  window.arcadiaCloud = { open, syncNow, state: st, localItems };
})();
