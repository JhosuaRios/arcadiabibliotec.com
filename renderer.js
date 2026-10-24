const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let catalog = { games: [], settings: { performance: 'low', emulators: {} } };
let filter = 'all';
let selected = 0;
let pendingLaunchId = null;
let pendingDeleteId = null;
let addAndLaunch = false;
let editingGameId = null;
let touchStartX = null;
let toastTimer;
let nesBrowser = null;
let activeNesGameId = null;
let nesPaused = false;
const nesPadButtons = new Map([['a', 0], ['b', 1], ['select', 2], ['start', 3], ['up', 4], ['down', 5], ['left', 6], ['right', 7]]);
let previousNesPadState = new Set();
const defaultNesKeys = {up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',a:'s',b:'a',start:'Enter',select:'ControlRight'};
const defaultNesPadMap = {up:{button:12},down:{button:13},left:{button:14},right:{button:15},a:{button:0},b:{button:1},select:{button:8},start:{button:9}};
let nesKeys = {...defaultNesKeys};
// Jugador 2 local: teclado 2 + mandos. Solo activo fuera de salas online.
const defaultNesKeys2 = {up:'i',down:'k',left:'j',right:'l',a:'p',b:'o',start:'u',select:'y'};
let nesKeys2 = {...defaultNesKeys2};
try { nesKeys2 = {...defaultNesKeys2, ...JSON.parse(localStorage.getItem('arcadia-nes-keys2') || '{}')}; } catch {}
const local2p = {enabled:false, kb1:1, kb2:2, pads:{}, manual:false};
try { const s = JSON.parse(localStorage.getItem('arcadia-nes-local2p') || '{}'); local2p.enabled = !!s.enabled; if (s.manual) { local2p.manual = true; local2p.kb1 = s.kb1 ?? 1; local2p.kb2 = s.kb2 ?? null; } } catch {}
function saveLocal2p() { try { localStorage.setItem('arcadia-nes-local2p', JSON.stringify({enabled:local2p.enabled, manual:local2p.manual, kb1:local2p.kb1, kb2:local2p.kb2})); } catch {} }
function local2pActive() {
  if (!local2p.enabled) return false;
  const o = window.arcadiaOnline;
  return !(o?.isGuest?.() || o?.isLockstep?.() || o?.isHosting?.());
}
function connectedPads() { try { return [...(navigator.getGamepads?.() || [])].filter(p => p && p.connected !== false); } catch { return []; } }
// Asignación automática: 0 mandos → teclado 1 (J1) + teclado 2 (J2); 1 mando → teclado J1, mando J2; 2 mandos → un mando por jugador.
// En un dispositivo táctil con un solo mando, el mando es J1 (no hay otro dispositivo para J1).
function autoAssignLocal2p() {
  const pads = connectedPads(), coarse = window.matchMedia?.('(pointer: coarse)').matches;
  local2p.pads = {};
  if (pads.length >= 2) { local2p.kb1 = 1; local2p.kb2 = null; local2p.pads[pads[0].index] = 1; local2p.pads[pads[1].index] = 2; }
  else if (pads.length === 1) { if (coarse) { local2p.kb1 = null; local2p.kb2 = null; local2p.pads[pads[0].index] = 1; } else { local2p.kb1 = 1; local2p.kb2 = null; local2p.pads[pads[0].index] = 2; } }
  else { local2p.kb1 = 1; local2p.kb2 = 2; }
}
function nesPlayerSet(player, button, down) {
  if (button == null) return;
  if (player === 2) { if (nesBrowser && local2pActive()) down ? nesBrowser.nes.buttonDown(2, button) : nesBrowser.nes.buttonUp(2, button); return; }
  nesPadSet(button, down);
}
let nesPadMaps = {};
let selectedGamepadIndex = -1;
let waitingForNesKey = null;
let waitingForPadAction = null;
let touchLayoutEditing = false;
let touchDragState = null;
let joystickPointerId = null;
let joystickRestStyle = null;
let joystickDirections = new Set();
let touchControlsHiddenByUser = false;
let connectedGamepadDetected = false;
let lastTouchModeCheck = 0;
let fpsFrames = 0;
let fpsLastTime = 0;
let fpsTimer = null;
let nesTurbo = false;
const NES_FRAME_RATE = 60;
const FEATURED_NES_GAMES = [
  { id: 'featured-nes-super-mario-bros', name: 'Super Mario Bros.', platform: 'NES', kind: 'ROM', file: '', cover: 'arcadia://art/cover-super-mario-bros.webp', description: 'Clásico de NES · Selecciona tu archivo .nes para jugar', icon: '🍄', colors: ['#e34e24', '#232943'] },
  { id: 'featured-nes-super-mario-bros-3', name: 'Super Mario Bros. 3', platform: 'NES', kind: 'ROM', file: '', cover: 'arcadia://art/cover-super-mario-bros-3.webp', description: 'Aventura de NES · Selecciona tu archivo .nes para jugar', icon: '🍄', colors: ['#e8c62e', '#2073bb'] },
  { id: 'featured-nes-super-mario-bros-2', name: 'Super Mario Bros. 2', platform: 'NES', kind: 'ROM', file: '', cover: 'arcadia://art/cover-super-mario-bros-2.webp', description: 'Aventura clásica de NES · Selecciona tu archivo .nes para jugar', icon: '🍄', colors: ['#36bce5', '#eac32e'] },
  { id: 'featured-nes-the-legend-of-zelda', name: 'The Legend of Zelda', platform: 'NES', kind: 'ROM', file: '', cover: 'arcadia://art/cover-the-legend-of-zelda.webp', description: 'Aventura clásica de NES · Selecciona tu archivo .nes para jugar', icon: '🗡️', colors: ['#d69a87', '#263b24'] },
  { id: 'featured-nes-tetris', name: 'Tetris', platform: 'NES', kind: 'ROM', file: '', cover: 'arcadia://art/cover-tetris.webp', description: 'Clásico de puzles de NES · Selecciona tu archivo .nes para jugar', icon: '🧩', colors: ['#1d57cb', '#7c2ed8'] }
];
const FEATURED_GBA_GAMES = [
  { id: 'featured-gba-pokemon-ruby', name: 'Pokémon Rubí', platform: 'Game Boy Advance', kind: 'ROM', file: '', cover: 'arcadia://art/cover-pokemon-ruby.png', description: 'Game Boy Advance · Selecciona tu ROM propia .gba para jugar', icon: '🔥', colors: ['#a82727', '#451c20'] }
];
const FEATURED_GAMES = [...FEATURED_NES_GAMES, ...FEATURED_GBA_GAMES];

function gamesInLibrary() {
  if (!Array.isArray(catalog.games)) catalog.games = [];
  // Always repair the catalog idempotently. The previous V3 flag prevented
  // newly featured games (such as Tetris) from being added to existing installs.
  let changed = false;
  for (const featured of FEATURED_GAMES) {
    let existing = catalog.games.find(game => game.id === featured.id);
    if (!existing) existing = catalog.games.find(game =>
      String(game.platform || '').toLocaleLowerCase() === String(featured.platform || '').toLocaleLowerCase() &&
      String(game.name || '').toLocaleLowerCase() === featured.name.toLocaleLowerCase()
    );
    if (!existing) {
      catalog.games.push({ ...featured });
      changed = true;
    } else {
      if (!existing.id) { existing.id = featured.id; changed = true; }
      if (existing.cover !== featured.cover) { existing.cover = featured.cover; changed = true; }
    }
  }
  if (changed && window.arcadia?.writeCatalog) {
    Promise.resolve(window.arcadia.writeCatalog(catalog)).catch(error => console.warn('No se pudo actualizar la biblioteca destacada:', error));
  }
  return catalog.games;
}
function visibleGames() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  let games = [...gamesInLibrary()];
  games = games.filter(game => {
    const matchesFilter = filter === 'all' || (filter === 'favorites' && game.favorite) || (filter === 'recent' && game.id === catalog.lastPlayed) || game.platform === filter;
    return matchesFilter && `${game.name} ${game.platform} ${game.kind}`.toLocaleLowerCase().includes(query);
  });
  if (filter === 'all' && catalog.lastPlayed) games.sort((a, b) => Number(b.id === catalog.lastPlayed) - Number(a.id === catalog.lastPlayed));
  selected = Math.min(selected, Math.max(0, games.length - 1));
  return games;
}
function notify(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3800);
}
function coverUrl(game) {
  const fallback = /mario/i.test(game.name) && game.platform === 'NES' ? 'arcadia://art/super-mario-bros.svg' : '';
  const source = !game.cover || /wiki\.dolphin-emu\.org/i.test(game.cover) ? fallback : game.cover;
  if (!source) return '';
  try { return window.arcadia.fileUrl(source); } catch { return /^https?:\/\//i.test(source) ? source : ''; }
}
function render() {
  const games = visibleGames();
  const game = games[selected];
  $('#title').textContent = filter === 'all' ? 'Tu próxima aventura' : filter === 'favorites' ? 'Tus favoritos' : filter === 'recent' ? 'Jugados recientemente' : filter === 'version' ? 'Versión de Arcadia' : filter;
  $('#sectionTitle').textContent = filter === 'version' ? 'Información de la aplicación' : filter === 'all' ? 'Tu biblioteca' : filter === 'favorites' ? 'Tus favoritos' : filter === 'recent' ? 'Jugados recientemente' : `Juegos · ${filter}`;
  $('#storyCount').textContent = filter === 'version' ? 'Versión instalada' : games.length ? `${selected + 1} de ${games.length} · ← → · A para jugar` : 'Añade un juego para comenzar';
  $('#storyProgress').innerHTML = games.map((_, index) => `<span class="story-progress ${index <= selected ? 'active' : ''}"><span></span></span>`).join('');
  if (filter === 'version') {
    $('#storyStage').style.setProperty('--story-a', '#244f49');
    $('#storyStage').style.setProperty('--story-b', '#172638');
    $('#storyBackdrop').innerHTML = '';
    $('#storyProgress').innerHTML = '';
    $('#storyDetails').innerHTML = `<div class="story-content version-info"><div class="story-platform">ARCADIA WEB · LANZAMIENTO 1.2</div><strong>Arcadia Web 1.2.0</strong><p>Biblioteca personal, emulador NES integrado, cinco ranuras de guardado y multijugador online.</p><div class="status-line"><span class="dot"></span> Multijugador en pruebas de estabilidad</div><p>La fluidez depende del dispositivo, la latencia y la ruta de conexión.</p><div class="story-actions"><button class="btn primary" id="versionRomsButton">Ver ROMs compatibles</button><button class="btn subtle" id="versionHomeButton">Volver al inicio</button></div></div>`;
    $('#storyPrevious').disabled = true; $('#storyNext').disabled = true;
  } else if (game) {
    const colors = game.colors || ['#397c6f', '#25365b'];
    const cover = coverUrl(game);
    $('#storyStage').style.setProperty('--story-a', colors[0]);
    $('#storyStage').style.setProperty('--story-b', colors[1]);
    $('#storyBackdrop').innerHTML = cover ? `<img src="${escapeHtml(cover)}" alt="" onerror="if(!this.dataset.rootFallback){this.dataset.rootFallback='1';this.src='./'+this.src.split('/').pop()}else{this.remove()}">` : '';
    $('#storyDetails').innerHTML = `<span class="story-mark" aria-hidden="true">${cover ? '' : escapeHtml(game.icon || '🎮')}</span><div class="story-content"><div class="story-platform">${escapeHtml(game.platform)} · ${escapeHtml(game.kind || 'Juego')}</div><h2>${escapeHtml(game.name)}</h2><p>${escapeHtml(game.description || 'En tu biblioteca personal')}</p><div class="story-actions"><button class="btn primary" id="playSelected">▶ &nbsp; Jugar</button><button class="btn subtle" id="editSelected">✎ &nbsp; Personalizar</button><button class="btn subtle" id="favoriteSelected" aria-label="${game.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${game.favorite ? '♥' : '♡'} Favorito</button><button class="btn subtle" id="removeSelected">Quitar</button></div></div>`;
    $('#storyPrevious').disabled = games.length < 2;
    $('#storyNext').disabled = games.length < 2;
  } else {
    $('#storyStage').style.removeProperty('--story-a');
    $('#storyStage').style.removeProperty('--story-b');
    $('#storyBackdrop').innerHTML = '';
    $('#storyDetails').innerHTML = `<div class="story-empty"><strong>${filter === 'favorites' ? 'Aún no tienes favoritos' : 'Tu biblioteca está lista para empezar'}</strong><small>Cuando añadas juegos, aparecerán aquí uno por uno.</small><button class="btn primary" id="emptyAddGame">＋ &nbsp; Añadir mi primer juego</button></div>`;
    $('#storyPrevious').disabled = true;
    $('#storyNext').disabled = true;
  }
  const allGames = gamesInLibrary();
  const tileCount = $('#tileCount'); if (tileCount) tileCount.textContent = `${allGames.length} ${allGames.length === 1 ? 'juego' : 'juegos'} · ${new Set(allGames.map(game => game.platform)).size} plataformas`;
  const recent = allGames.slice().sort((a, b) => Number(b.id === catalog.lastPlayed) - Number(a.id === catalog.lastPlayed)).slice(0, 8);
  $('#recentRow').innerHTML = recent.length ? recent.map(game => {
    const colors = game.colors || ['#397c6f', '#25365b'];
    const cover = coverUrl(game);
    return `<button class="recent-item" data-recent="${escapeHtml(game.id)}"><span class="recent-art" style="--cover-a:${escapeHtml(colors[0])};--cover-b:${escapeHtml(colors[1])}">${cover ? `<img src="${escapeHtml(cover)}" alt="" onerror="if(!this.dataset.rootFallback){this.dataset.rootFallback='1';this.src='./'+this.src.split('/').pop()}else{this.remove()}">` : escapeHtml(game.icon || '🎮')}</span><span class="recent-copy"><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.platform)} · ${escapeHtml(game.kind)}</small></span><span class="recent-play" aria-hidden="true">▶</span></button>`;
  }).join('') : '<div class="recent-empty">Tus juegos añadidos aparecerán aquí.</div>';
  const platforms = [...new Set(allGames.map(game => game.platform))];
  $('#platforms').innerHTML = platforms.map(platform => `<button class="platform-button ${filter === platform ? 'active' : ''}" data-platform="${escapeHtml(platform)}" title="${escapeHtml(platform)}">${platformMark(platform)}<span class="tooltip">${escapeHtml(platform)}</span></button>`).join('');
  $$('.nav [data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
}
function platformMark(platform) {
  return ({ 'PlayStation 2': 'PS2', PlayStation: 'PS', 'Game Boy Advance': 'GBA', 'Super Nintendo': 'SNES', 'Nintendo 64': 'N64', NES: 'NES', PC: 'PC' })[platform] || platform.slice(0, 3).toUpperCase();
}
function openModal(id) { closeModals(); $(`#${id}`).classList.add('open'); }
function closeModals() { $$('.modal-bg.open').forEach(modal => modal.classList.remove('open')); }
async function saveCatalog() {
  await window.arcadia.writeCatalog(catalog);
  render();
}
function defaultEmulator(game) {
  return game.emulator || catalog.settings?.emulators?.[game.platform] || '';
}
function isNesRom(game) {
  // Never send a game classified as NES to the external-emulator chooser.
  // This also repairs older browser library entries whose saved file reference
  // no longer exposes the original .nes extension after a reload.
  return game.platform === 'NES';
}
async function launchGame(id) {
  const game = gamesInLibrary().find(item => item.id === id);
  if (!game) return;
  if (!game.file && isNesRom(game)) {
    const selectedFile = await window.arcadia.pickFile('game');
    if (!selectedFile) return;
    const selectedName = window.arcadia.fileName?.(selectedFile) || selectedFile;
    if (!/\.nes$/i.test(selectedName)) { notify('Elige una ROM de NES con extensión .nes.', true); return; }
    game.file = selectedFile;
    await saveCatalog();
  }
  if (String(game.platform || '').toLowerCase().includes('game boy advance') || String(game.platform || '').toLowerCase() === 'gba') {
    const saved = await getSavedGbaRom().catch(()=>null);
    await openGbaPlayer(game.name, false);
    if (saved) loadGbaRom(saved, false); else $('#gbaRomInput')?.click();
    return;
  }
  if (!game.file) { notify('Este registro no tiene un archivo de juego asociado.', true); return; }
  if (isNesRom(game)) { await launchNesGame(game); return; }
  const emulator = defaultEmulator(game);
  if (!emulator && !/\.(exe|lnk)$/i.test(game.file)) {
    notify(`Este juego requiere un emulador externo para ${game.platform}. Arcadia Web integra actualmente el emulador NES.`, true);
    return;
  }
  const result = await window.arcadia.launch(game.file, emulator);
  if (!result?.ok) {
    notify(result?.message || 'No se pudo iniciar el juego.', true);
    return;
  }
  catalog.lastPlayed = game.id;
  await saveCatalog();
  notify(result.message || `Iniciando ${game.name}…`);
}
async function launchNesGame(game) {
  try {
    if (!window.jsnes?.Browser) throw new Error('No se encontró el núcleo NES incluido en Arcadia.');
    if (nesBrowser) nesBrowser.destroy();
    nesBrowser = null;
    activeNesGameId = null;
    previousNesPadState.clear();
    $('#gameViewport').innerHTML = '';
    $('#sessionGameTitle').textContent = game.name;
    $('#nesStatus').textContent = 'Cargando ROM…';
    $('#nesFps').textContent = '0 FPS';
    fpsFrames = 0; fpsLastTime = performance.now(); clearInterval(fpsTimer);
    openModal('gameSession');
    try { const savedKeys = JSON.parse(localStorage.getItem('arcadia-nes-keys') || 'null'); if (savedKeys && typeof savedKeys === 'object') nesKeys = {...defaultNesKeys,...savedKeys}; } catch {}
    loadControllerSettings(); loadTouchLayout();
    touchControlsHiddenByUser = false;
    syncTouchControlsForGamepad();
    const rom = await window.arcadia.readRom(game.file);
    const bytes = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
    if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
      throw new Error('El archivo no parece una ROM NES válida (.nes).');
    }
    // Huella determinista compatible con todos los navegadores y contextos.
    // No mezclar SHA-256 con un fallback distinto: produciría falsos "ROM diferente".
    // Dos hashes de 32 bits más longitud detectan diferencias comunes, no son autenticación.
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (b + (i & 255)), 0x85ebca6b) >>> 0;
    }
    const hex = n => n.toString(16).padStart(8, '0');
    window.arcadiaRomFingerprint = `${bytes.length.toString(16)}-${hex(h1)}-${hex(h2)}`;
    console.info('[Arcadia ROM] Huella determinista de la ROM cargada:', window.arcadiaRomFingerprint);
  nesBrowser = new window.jsnes.Browser({
      container: $('#gameViewport'),
      onError: error => { $('#nesStatus').textContent = 'Error en la emulación'; notify(`Error del emulador NES: ${error.message || error}`, true); }
    });
    nesBrowser.gamepad.gamepadConfig = null;
    configureNativeNesPacer(nesBrowser);
    // Do not let audio buffer underruns advance extra emulator frames.
    nesBrowser._speakers.onBufferUnderrun = () => {};
    const originalGenerateFrame = nesBrowser._frameTimer.onGenerateFrame.bind(nesBrowser._frameTimer);
    // Count only frames the emulator actually advances. In lockstep the callback
    // may return false while waiting for the remote input for this frame.
    nesBrowser._frameTimer.onGenerateFrame = (...args) => {
      const result = originalGenerateFrame(...args);
      if (result !== false) fpsFrames++;
      return result;
    };
    if (local2p.enabled && !local2p.manual) autoAssignLocal2p();
    applyNesKeys();
    nesBrowser.loadROM(bytes);
    fpsTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(1, now - fpsLastTime);
      const fps = Math.min(NES_FRAME_RATE, Math.round(fpsFrames * 1000 / elapsed));
      $('#nesFps').textContent = `${fps} FPS`;
      fpsFrames = 0; fpsLastTime = now;
    }, 1000);
    nesBrowser._arcadiaFps = true;
    activeNesGameId = game.id;
    nesPaused = false;
    $('#pauseNes').textContent = 'Pausar';
    $('#sessionPlaceholder')?.classList.add('hide');
    $('#nesStatus').textContent = 'NES integrado · Flechas + S/A · Mando o controles táctiles';
    catalog.lastPlayed = game.id;
    await saveCatalog();
  } catch (error) {
    if (nesBrowser) { nesBrowser.destroy(); nesBrowser = null; }
    activeNesGameId = null;
    closeModals();
    notify(error?.message || 'No se pudo abrir esta ROM de NES.', true);
  }
}
function configureNativeNesPacer(browser) {
  const timer = browser._frameTimer;
  const framePeriod = 1000 / NES_FRAME_RATE;
  timer.interval = framePeriod;
  timer.stop();
  let lastTimestamp = null;
  let elapsedRemainder = 0;
  timer.onAnimationFrame = timestamp => {
    if (!timer.running) return;
    timer.requestAnimationFrame();
    if (lastTimestamp === null) { lastTimestamp = timestamp; return; }
    const elapsed = Math.max(0, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    // Retain a little time after brief scheduling hiccups, but cap backlog to
    // avoid long turbo bursts. Catch up at most two frames per animation callback.
    elapsedRemainder = Math.min(elapsedRemainder + Math.min(elapsed, 100), framePeriod * 3);
    let steps = 0;
    while (elapsedRemainder >= framePeriod && steps < 2) {
      const generated = timer.onGenerateFrame();
      // Missing remote input means lockstep must wait. Drop excess backlog and
      // retry on the next RAF rather than spinning or advancing out of sync.
      if (generated === false) {
        elapsedRemainder = Math.min(elapsedRemainder, framePeriod);
        break;
      }
      elapsedRemainder -= framePeriod;
      steps++;
    }
    // Si hubo que ponerse al día (2 cuadros), solo se dibuja el último: ahorra trabajo sin cambiar la emulación.
    if (steps > 0) timer.onWriteFrame();
  };
}
function applyNesKeys() {
  if (!nesBrowser) return;
  const keyCode = value => {
    const named = {ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13,ControlRight:17,Space:32};
    if (named[value]) return named[value];
    if (/^Key[A-Z]$/.test(value)) return value.charCodeAt(3);
    if (/^Digit[0-9]$/.test(value)) return value.charCodeAt(5);
    return value.length === 1 ? value.toUpperCase().charCodeAt(0) : 0;
  };
  const ids = {a:window.jsnes.Controller.BUTTON_A,b:window.jsnes.Controller.BUTTON_B,start:window.jsnes.Controller.BUTTON_START,select:window.jsnes.Controller.BUTTON_SELECT,up:window.jsnes.Controller.BUTTON_UP,down:window.jsnes.Controller.BUTTON_DOWN,left:window.jsnes.Controller.BUTTON_LEFT,right:window.jsnes.Controller.BUTTON_RIGHT};
  const keys = {...nesBrowser.keyboard.keys};
  for (let code = 0; code < 256; code++) if (keys[code] && (keys[code][0] === 1 || keys[code][0] === 2)) delete keys[code];
  const multi = local2pActive();
  const p1 = multi ? local2p.kb1 : 1;
  if (p1) for (const [action, value] of Object.entries(nesKeys)) { const code = keyCode(value); if (code) keys[code] = [p1,ids[action],value]; }
  if (multi && local2p.kb2) for (const [action, value] of Object.entries(nesKeys2)) { const code = keyCode(value); if (code && !keys[code]) keys[code] = [local2p.kb2,ids[action],value]; }
  nesBrowser.keyboard.setKeys(keys); nesBrowser.keyboard.keys = keys;
  renderNesKeySettings(); renderLocal2pSettings();
}
function renderNesKeySettings() {
  const labels = {up:'Arriba',down:'Abajo',left:'Izquierda',right:'Derecha',a:'A',b:'B',start:'Start',select:'Select'};
  $('#nesKeyGrid').innerHTML = Object.entries(labels).map(([key,label]) => `<button type="button" data-remap="${key}">${label}<strong>${escapeHtml(nesKeys[key])}</strong></button>`).join('');
}
function renderLocal2pSettings() {
  const box = $('#local2pBox'); if (!box) return;
  const chk = $('#local2pEnable'); if (chk) chk.checked = local2p.enabled;
  const opt = (v, cur) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${v === '' ? 'Sin usar' : 'Jugador ' + v}</option>`;
  const row = (label, key, cur) => `<label class="nes-config-label">${escapeHtml(label)}<select data-l2p="${key}">${opt(1, cur)}${opt(2, cur)}${opt('', cur)}</select></label>`;
  let html = row('Teclado 1 (flechas, S, A, Enter…)', 'kb1', local2p.kb1) + row('Teclado 2 (I J K L, P, O, U, Y)', 'kb2', local2p.kb2);
  connectedPads().forEach(p => { html += row(`Mando ${p.index + 1}: ${(p.id || '').slice(0, 34)}`, 'pad' + p.index, local2p.pads[p.index]); });
  $('#local2pAssign').innerHTML = local2p.enabled ? html : '';
  $('#local2pKeys').classList.toggle('hide', !local2p.enabled);
  const labels = {up:'Arriba',down:'Abajo',left:'Izquierda',right:'Derecha',a:'A',b:'B',start:'Start',select:'Select'};
  $('#nesKeyGrid2').innerHTML = Object.entries(labels).map(([key,label]) => `<button type="button" data-remap2="${key}">${label}<strong>${escapeHtml(nesKeys2[key])}</strong></button>`).join('');
}
function controllerMapFor(pad) { return pad && nesPadMaps[pad.id] ? {...defaultNesPadMap,...nesPadMaps[pad.id]} : {...defaultNesPadMap}; }
function loadControllerSettings() {
  try { nesPadMaps = JSON.parse(localStorage.getItem('arcadia-nes-pad-maps') || '{}') || {}; } catch { nesPadMaps = {}; }
  try { selectedGamepadIndex = Number(localStorage.getItem('arcadia-nes-selected-pad') ?? -1); } catch { selectedGamepadIndex = -1; }
  renderGamepadSettings();
}
function saveControllerSettings(pad, map) {
  if (!pad) return;
  nesPadMaps[pad.id] = map;
  try { localStorage.setItem('arcadia-nes-pad-maps', JSON.stringify(nesPadMaps)); } catch {}
}
function renderGamepadSettings() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  const select = $('#nesGamepadSelect');
  if (!select) return;
  if (!pads.some(pad => pad.index === selectedGamepadIndex)) selectedGamepadIndex = pads[0]?.index ?? -1;
  select.innerHTML = pads.length ? pads.map(pad => `<option value="${pad.index}" ${pad.index === selectedGamepadIndex ? 'selected' : ''}>${escapeHtml(pad.id || `Mando ${pad.index + 1}`)}</option>`).join('') : '<option value="">No se detectaron mandos</option>';
  try { localStorage.setItem('arcadia-nes-selected-pad', String(selectedGamepadIndex)); } catch {}
  const pad = pads.find(item => item.index === selectedGamepadIndex);
  const map = controllerMapFor(pad);
  const labels = {up:'Arriba',down:'Abajo',left:'Izquierda',right:'Derecha',a:'A',b:'B',start:'Start',select:'Select'};
  $('#nesPadGrid').innerHTML = Object.entries(labels).map(([key,label]) => {
    const binding = map[key];
    const text = binding?.button != null ? `Botón ${binding.button + 1}` : binding?.axis != null ? `Eje ${binding.axis + 1} ${binding.value < 0 ? '−' : '+'}` : 'Sin asignar';
    return `<button type="button" data-pad-remap="${key}">${label}<strong>${escapeHtml(text)}</strong></button>`;
  }).join('');
}
function syncTouchControlsForGamepad() {
  let connected = false;
  try { connected = [...(navigator.getGamepads?.() || [])].some(pad => pad && pad.connected !== false); } catch {}
  connectedGamepadDetected = connected;
  $('#gameSession').classList.toggle('nes-touch-hidden', connected || touchControlsHiddenByUser);
  $('#gameSession').classList.toggle('nes-touch-capable', Boolean(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0));
  const button = $('#hideTouchNes');
  if (button) {
    button.disabled = connected;
    button.textContent = connected ? 'Mando conectado' : touchControlsHiddenByUser ? 'Mostrar táctiles' : 'Ocultar táctiles';
    button.title = connected ? 'Los controles táctiles se ocultan mientras haya un mando conectado.' : '';
  }
}
function captureGamepadBinding(pad) {
  if (!waitingForPadAction || !pad) return false;
  const buttonIndex = pad.buttons.findIndex(button => button.pressed || button.value > 0.75);
  let binding = buttonIndex >= 0 ? {button:buttonIndex} : null;
  if (!binding) for (let axis = 0; axis < (pad.axes?.length || 0); axis++) {
    const value = pad.axes[axis];
    if (Math.abs(value) > 0.7) { binding = {axis, value:value < 0 ? -1 : 1}; break; }
  }
  if (!binding) return false;
  const next = controllerMapFor(pad); next[waitingForPadAction] = binding; saveControllerSettings(pad,next);
  waitingForPadAction = null; renderGamepadSettings(); notify('Botón del mando actualizado.'); return true;
}
function mappedPadPressed(pad,binding) {
  if (binding?.button != null) return Boolean(pad.buttons[binding.button]?.pressed || (pad.buttons[binding.button]?.value || 0) > 0.5);
  if (binding?.axis != null) return binding.value < 0 ? pad.axes?.[binding.axis] < -0.55 : pad.axes?.[binding.axis] > 0.55;
  return false;
}
function loadTouchLayout() {
  let settings={size:1,groups:{}};
  let controlMode='joystick'; try { controlMode=localStorage.getItem('arcadia-nes-touch-mode') || 'joystick'; } catch {}
  const touchOverlay=$('#nesTouchControls'); if(touchOverlay){ touchOverlay.dataset.controlMode=controlMode; }
  const modeSelect=$('#touchControlMode'); if(modeSelect) modeSelect.value=controlMode;
  try { settings={...settings,...JSON.parse(localStorage.getItem('arcadia-nes-touch-layout') || '{}')}; } catch {}
  const overlay=$('#nesTouchControls'); overlay.style.setProperty('--touch-size',String(settings.size || 1)); $('#touchSize').value=String(settings.size || 1);
  for (const [name,position] of Object.entries(settings.groups || {})) {
    const group=overlay.querySelector(`[data-touch-group="${name}"]`); if (!group || !position) continue;
    group.style.position='absolute'; group.style.left=`${Math.max(0,Math.min(1,position.x))*100}%`; group.style.top=`${Math.max(0,Math.min(1,position.y))*100}%`; group.style.right='auto'; group.style.bottom='auto'; group.style.transform='none'; group.style.margin='0';
  }
}
function readTouchLayout() {
  const overlay=$('#nesTouchControls');
  const settings={size:Number(overlay.style.getPropertyValue('--touch-size'))||1,groups:{}};
  const rect=overlay.getBoundingClientRect();
  for (const group of overlay.querySelectorAll('[data-touch-group]')) {
    if (group.style.left === '' && group.style.top === '') continue;
    settings.groups[group.dataset.touchGroup]={x:Math.max(0,Math.min(1,group.offsetLeft/Math.max(1,rect.width))),y:Math.max(0,Math.min(1,group.offsetTop/Math.max(1,rect.height)))};
  }
  try { localStorage.setItem('arcadia-nes-touch-layout',JSON.stringify(settings)); } catch {}
}
function resetTouchLayout() {
  try { localStorage.removeItem('arcadia-nes-touch-layout'); } catch {}
  for (const group of $('#nesTouchControls').querySelectorAll('[data-touch-group]')) { group.removeAttribute('style'); }
  $('#nesTouchControls').style.setProperty('--touch-size','1'); $('#touchSize').value='1';
}
function setNesTurbo(enabled) {
  void enabled;
  nesTurbo = false;
  if (nesBrowser) nesBrowser._frameTimer.interval = 1000 / NES_FRAME_RATE;
}
function displayKeyName(event) { if (event.code === 'ControlRight') return 'ControlRight'; if (event.code === 'Space') return 'Space'; if (event.code.startsWith('Arrow')) return event.code; if (event.code.startsWith('Key') || event.code.startsWith('Digit')) return event.code; return ''; }
async function toggleGameFullscreen() {
  const target = $('#sessionWindow');
  try {
    if (!document.fullscreenElement) {
      setNesTurbo(false);
      if (!target.requestFullscreen) throw new Error('fullscreen-unavailable');
      await target.requestFullscreen();
      try { await screen.orientation?.lock?.('landscape'); } catch { notify('Gira el teléfono para jugar en horizontal.'); }
      $('#gameSession').classList.add('nes-session-fullscreen');
    } else {
      await document.exitFullscreen?.();
      try { screen.orientation?.unlock?.(); } catch {}
      $('#gameSession').classList.remove('nes-session-fullscreen');
    }
    requestAnimationFrame(() => nesBrowser?.fitInParent?.());
  } catch { notify('El navegador no permitió pantalla completa. Vuelve a intentarlo desde el botón.'); }
}
function updateVirtualJoystick(event) {
  const joystick = $('#nesJoystick');
  const knob = $('#nesJoystickKnob');
  if (!joystick || !knob) return;
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx, dy = event.clientY - cy;
  const radius = Math.min(rect.width, rect.height) * 0.31;
  const distance = Math.hypot(dx, dy) || 1;
  if (distance > radius) { dx = dx / distance * radius; dy = dy / distance * radius; }
  knob.style.left = `${50 + dx / rect.width * 100}%`;
  knob.style.top = `${50 + dy / rect.height * 100}%`;
  const nx = dx / radius, ny = dy / radius;
  const next = new Set();
  // Dead zone reduces accidental movement near the center; diagonals are supported.
  if (Math.hypot(nx, ny) > 0.22) {
    if (nx < -0.34) next.add('left');
    if (nx > 0.34) next.add('right');
    if (ny < -0.34) next.add('up');
    if (ny > 0.34) next.add('down');
  }
  for (const name of joystickDirections) if (!next.has(name)) nesPadSet(nesPadButtons.get(name), false);
  for (const name of next) if (!joystickDirections.has(name)) nesPadSet(nesPadButtons.get(name), true);
  joystickDirections = next;
  joystick.classList.toggle('active', next.size > 0);
}
function resetVirtualJoystick() {
  const joystick = $('#nesJoystick'), knob = $('#nesJoystickKnob');
  for (const name of joystickDirections) nesPadSet(nesPadButtons.get(name), false);
  joystickDirections.clear(); joystickPointerId = null;
  if (joystick) {
    joystick.classList.remove('active', 'floating');
    // Vuelve a su sitio (incluida la posición guardada); nunca se oculta ni mueve los demás botones.
    if (joystickRestStyle !== null) { joystick.style.cssText = joystickRestStyle; joystickRestStyle = null; }
  }
  if (knob) { knob.style.left = '50%'; knob.style.top = '50%'; }
}
function selectedSaveSlot() {
  const value = Number($('#saveSlotSelect')?.value || 1);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
}
async function saveNesState() {
  if (!nesBrowser || !activeNesGameId) return;
  const slot = selectedSaveSlot();
  await window.arcadia.writeSaveState(activeNesGameId, nesBrowser.nes.toJSON(), slot);
  notify(`Partida guardada en la ranura ${slot}.`);
}
async function loadNesState() {
  if (!nesBrowser || !activeNesGameId) return;
  if (window.arcadiaOnline?.isLockstep?.()) {
    notify('Para evitar desincronizar la partida, sal de la sala online antes de cargar un estado.', true);
    return;
  }
  const slot = selectedSaveSlot();
  const state = await window.arcadia.readSaveState(activeNesGameId, slot);
  if (!state) { notify(`La ranura ${slot} está vacía para este juego.`, true); return; }
  nesBrowser.nes.fromJSON(state);
  notify(`Partida cargada desde la ranura ${slot}.`);
}
// Un solo punto de entrada para los botones del jugador local: control 1 del emulador
// o, si esta persona es invitada de una sala online, envío al anfitrión (control 2).
function nesPadSet(button, down) {
  if (window.arcadiaOnline?.isGuest()) { window.arcadiaOnline.guestButton(button, down); return; }
  if (!nesBrowser) return;
  // In lockstep, inputs are applied at a shared emulation-frame boundary.
  // Outside lockstep preserve the original low-latency local controls.
  if (window.arcadiaOnline?.isLockstep?.()) {
    window.arcadiaOnline?.hostButton?.(button, down);
    return;
  }
  down ? nesBrowser.nes.buttonDown(1, button) : nesBrowser.nes.buttonUp(1, button);
  window.arcadiaOnline?.hostButton?.(button, down);
}
function prepareGuestControls() {
  try { const savedKeys = JSON.parse(localStorage.getItem('arcadia-nes-keys') || 'null'); if (savedKeys && typeof savedKeys === 'object') nesKeys = {...defaultNesKeys,...savedKeys}; } catch {}
  loadControllerSettings(); loadTouchLayout();
  touchControlsHiddenByUser = false;
  syncTouchControlsForGamepad();
  renderNesKeySettings();
}
function pollNesGamepad() {
  if ((!nesBrowser || !activeNesGameId) && !window.arcadiaOnline?.isGuest()) { previousNesPadState.clear(); return; }
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  const multi = local2pActive();
  // Un solo jugador (comportamiento clásico): el mando seleccionado controla al J1.
  const used = multi ? pads.filter(p => local2p.pads[p.index]) : pads.filter(p => p.index === selectedGamepadIndex);
  if (!used.length) { if (previousNesPadState.size) { for (const token of previousNesPadState) { const [, player, name] = token.split(':'); nesPlayerSet(Number(player), nesPadButtons.get(name), false); } previousNesPadState.clear(); } return; }
  const next = new Set();
  for (const pad of used) {
    const player = multi ? local2p.pads[pad.index] : 1;
    if (!multi && captureGamepadBinding(pad)) { previousNesPadState.clear(); return; }
    const map = controllerMapFor(pad), pressed = action => mappedPadPressed(pad, map[action]);
    const axisX = pad.axes?.[0] || 0, axisY = pad.axes?.[1] || 0;
    const directions = {up:pressed('up')||axisY < -0.55,down:pressed('down')||axisY > 0.55,left:pressed('left')||axisX < -0.55,right:pressed('right')||axisX > 0.55,a:pressed('a'),b:pressed('b'),select:pressed('select'),start:pressed('start')};
    for (const [name, value] of Object.entries(directions)) if (value) next.add(`${pad.index}:${player}:${name}`);
  }
  for (const token of next) if (!previousNesPadState.has(token)) { const [, player, name] = token.split(':'); nesPlayerSet(Number(player), nesPadButtons.get(name), true); }
  for (const token of previousNesPadState) if (!next.has(token)) { const [, player, name] = token.split(':'); nesPlayerSet(Number(player), nesPadButtons.get(name), false); }
  previousNesPadState = next;
}
function openAddGame(shouldLaunch = !window.arcadia.isWeb) {
  addAndLaunch = shouldLaunch;
  editingGameId = null;
  const form = $('#gameForm');
  form.reset();
  $('#addTitle').textContent = 'Añadir juego';
  $('#saveGameButton').textContent = 'Guardar juego';
  $('#coverPreviewLabel').textContent = 'Puedes elegir una carátula que ya tengas en el equipo.';
  openModal('addModal');
  form.elements.name.focus();
}
function openEditGame() {
  const game = visibleGames()[selected];
  if (!game) return;
  editingGameId = game.id;
  addAndLaunch = false;
  const form = $('#gameForm');
  form.reset();
  $('#addTitle').textContent = 'Personalizar juego';
  $('#saveGameButton').textContent = 'Guardar cambios';
  form.elements.name.value = game.name || '';
  form.elements.platform.value = game.platform || 'PC';
  form.elements.kind.value = game.kind || 'Juego de PC';
  form.elements.file.value = game.file || '';
  form.elements.cover.value = game.cover || '';
  form.elements.emulator.value = game.emulator || '';
  $('#coverPreviewLabel').textContent = game.cover ? `Carátula actual: ${game.cover.split(/[\\/]/).pop()}` : 'Elige una carátula que ya tengas en el equipo.';
  openModal('addModal');
  form.elements.name.focus();
}
async function toggleFavorite() {
  const game = visibleGames()[selected];
  if (!game) return;
  game.favorite = !game.favorite;
  await saveCatalog();
}
async function removeSelectedGame() {
  const game = visibleGames()[selected];
  if (!game) return;
  $('#removeMessage').textContent = `¿Quieres quitar “${game.name}” de Arcadia? El archivo original seguirá en tu disco.`;
  pendingDeleteId = game.id;
  openModal('removeModal');
}
async function confirmRemoveGame() {
  if (!pendingDeleteId) { closeModals(); return; }
  const deletedId = pendingDeleteId;
  const deleted = gamesInLibrary().find(game => game.id === deletedId);
  if (!deleted) { pendingDeleteId = null; closeModals(); return; }
  catalog.games = catalog.games.filter(game => game.id !== deletedId);
  pendingDeleteId = null;
  selected = Math.max(0, selected - 1);
  await saveCatalog();
  closeModals();
  notify('Juego quitado de la biblioteca. El archivo sigue en tu disco.');
}
function selectStory(next) {
  const games = visibleGames();
  if (!games.length) return;
  selected = (selected + next + games.length) % games.length;
  render();
}
function reportGameViewBounds() {
  if (!$('.modal-bg.game-session.open')) return;
  const rect = $('#gameViewport').getBoundingClientRect();
  window.arcadia.resizeGameView({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: window.devicePixelRatio || 1 });
}
function guessPlatform(extension) {
  return ({ nes: 'NES', gba: 'Game Boy Advance', gb: 'Game Boy Advance', gbc: 'Game Boy Advance', sfc: 'Super Nintendo', smc: 'Super Nintendo', n64: 'Nintendo 64', z64: 'Nintendo 64', iso: 'PlayStation 2', chd: 'PlayStation 2', exe: 'PC', lnk: 'PC' })[extension] || '';
}
async function chooseGameFile() {
  const file = await window.arcadia.pickFile('game');
  if (!file) return;
  const form = $('#gameForm');
  form.elements.file.value = file;
  const baseName = window.arcadia.fileName?.(file) || file.split(/[\\/]/).pop();
  const extension = baseName.split('.').pop().toLowerCase();
  if (!form.elements.name.value.trim()) form.elements.name.value = baseName.replace(/\.[^.]+$/, '');
  const platform = guessPlatform(extension);
  if (platform) form.elements.platform.value = platform;
  form.elements.kind.value = ['exe', 'lnk'].includes(extension) ? 'Juego de PC' : ['iso', 'cso', 'chd'].includes(extension) ? 'ISO' : 'ROM';
  const cover = await window.arcadia.findCover(file);
  if (cover) {
    form.elements.cover.value = cover;
    $('#coverPreviewLabel').textContent = `Carátula encontrada: ${window.arcadia.fileName?.(cover) || cover.split(/[\\/]/).pop()}`;
  } else if (/mario/i.test(form.elements.name.value) && form.elements.platform.value === 'NES') {
    form.elements.cover.value = 'arcadia://art/super-mario-bros.svg';
    $('#coverPreviewLabel').textContent = 'Carátula de muestra de Super Mario Bros. agregada.';
  }
}
async function chooseCover() {
  const file = await window.arcadia.pickFile('cover');
  if (!file) return;
  $('#gameForm').elements.cover.value = file;
  $('#coverPreviewLabel').textContent = `Carátula seleccionada: ${window.arcadia.fileName?.(file) || file.split(/[\\/]/).pop()}`;
}
async function chooseEmulator(inputId) {
  const file = await window.arcadia.pickFile('emulator');
  if (file) $(`#${inputId}`).value = file;
}
async function saveGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const file = String(values.get('file') || '').trim();
  const name = String(values.get('name') || '').trim();
  const wasEditing = Boolean(editingGameId);
  if (!file) { notify('Primero elige el archivo del juego.', true); return; }
  if (!name) { notify('Escribe el nombre del juego.', true); form.elements.name.focus(); return; }
  const duplicate = gamesInLibrary().find(game => game.file?.toLocaleLowerCase() === file.toLocaleLowerCase() && game.id !== editingGameId);
  if (duplicate) {
    closeModals();
    filter = 'all';
    selected = 0;
    render();
    notify('Ese archivo ya está en tu biblioteca. Lo seleccionamos para que puedas iniciarlo.');
    if (addAndLaunch) await launchGame(duplicate.id);
    addAndLaunch = false;
    return;
  }
  const fields = {
    name, platform: String(values.get('platform') || 'PC'), kind: String(values.get('kind') || 'Juego de PC'),
    description: String(values.get('description') || '').trim(), file, cover: String(values.get('cover') || '').trim(), emulator: String(values.get('emulator') || '').trim()
  };
  let game;
  if (editingGameId) {
    game = gamesInLibrary().find(item => item.id === editingGameId);
    if (!game) { notify('Ese juego ya no está en la biblioteca.', true); closeModals(); return; }
    Object.assign(game, fields);
  } else {
    game = { id: crypto.randomUUID(), ...fields, icon: '🎮', colors: ['#28786d', '#26345d'], favorite: false };
    catalog.games.unshift(game);
  }
  await saveCatalog();
  closeModals();
  filter = 'all';
  selected = 0;
  render();
  const shouldLaunch = addAndLaunch;
  addAndLaunch = false;
  editingGameId = null;
  form.reset();
  if (shouldLaunch) await launchGame(game.id);
  else notify(wasEditing ? `${game.name} se actualizó en tu biblioteca.` : `${game.name} se guardó en tu biblioteca.`);
}
async function saveEmulatorAssociations() {
  catalog.settings.emulators = {
    ...(catalog.settings.emulators || {}),
    'Game Boy Advance': $('#mgbaPath').value.trim()
  };
  await saveCatalog();
  closeModals();
  const nextId = pendingLaunchId;
  pendingLaunchId = null;
  if (nextId) await launchGame(nextId);
  else notify('Asociaciones de emuladores guardadas.');
}
async function saveSettings() {
  catalog.settings.resolution = $('#resolution').value;
  catalog.settings.vsync = $('#vsync').value;
  await saveCatalog();
  closeModals();
  notify('Ajustes guardados.');
}
function setFilter(nextFilter) { filter = nextFilter; selected = 0; render(); }
function moveSelection(direction) {
  if ($('.modal-bg.open')) return;
  selectStory(direction);
}
function withErrorToast(action) {
  return async (...args) => {
    try { await action(...args); }
    catch (error) { console.error(error); notify(error?.message || 'Ocurrió un error inesperado.', true); }
  };
}

$('#storyPrevious').addEventListener('click', () => selectStory(-1));
$('#storyNext').addEventListener('click', () => selectStory(1));
$('#storyDetails').addEventListener('click', withErrorToast(async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'playSelected') await launchGame(visibleGames()[selected]?.id);
  if (button.id === 'editSelected') openEditGame();
  if (button.id === 'favoriteSelected') await toggleFavorite();
  if (button.id === 'removeSelected') await removeSelectedGame();
  if (button.id === 'emptyAddGame') openAddGame();
}));
$('#storyStage').addEventListener('touchstart', event => { touchStartX = event.changedTouches[0]?.screenX ?? null; }, { passive: true });
$('#storyStage').addEventListener('touchend', event => {
  if (touchStartX === null) return;
  const delta = (event.changedTouches[0]?.screenX ?? touchStartX) - touchStartX;
  if (Math.abs(delta) > 45) selectStory(delta < 0 ? 1 : -1);
  touchStartX = null;
}, { passive: true });
$('#recentRow').addEventListener('click', event => {
  const item = event.target.closest('[data-recent]');
  if (!item) return;
  filter = 'all';
  selected = Math.max(0, gamesInLibrary().findIndex(game => game.id === item.dataset.recent));
  render();
  $('#storyStage').focus();
});
$('.nav').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (button) setFilter(button.dataset.filter);
});
$('#platforms').addEventListener('click', event => {
  const button = event.target.closest('[data-platform]');
  if (button) setFilter(button.dataset.platform);
});
$('#search').addEventListener('input', () => { selected = 0; render(); });
$('#addTile').addEventListener('click', () => openAddGame());
$('#chooseGba')?.addEventListener('click', () => { setFilter('Game Boy Advance'); $('#storyStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('#chooseNes')?.addEventListener('click', () => { setFilter('NES'); $('#storyStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('#libraryTile').addEventListener('click', () => { setFilter('all'); $('#storyStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('#romsTile').addEventListener('click', withErrorToast(() => window.arcadia.openExternal('https://www.mediafire.com/folder/sm1vuzwjveiul/Juegos')));
$('#controlsBtn').addEventListener('click', () => openModal('controlsModal'));
$('#topSettings').addEventListener('click', () => openModal('settingsModal'));
$('#pickGame').addEventListener('click', withErrorToast(chooseGameFile));
$('#pickCover').addEventListener('click', withErrorToast(chooseCover));
$('#gameForm').addEventListener('submit', withErrorToast(saveGame));
$('#saveSettings').addEventListener('click', withErrorToast(saveSettings));
$('#storyDetails').addEventListener('click', withErrorToast(async event => { if (event.target.closest('#versionRomsButton')) await window.arcadia.openExternal('https://www.mediafire.com/folder/sm1vuzwjveiul/Juegos'); if (event.target.closest('#versionHomeButton')) setFilter('all'); }));
$$('[data-close]').forEach(button => button.addEventListener('click', () => { addAndLaunch = false; closeModals(); }));
$$('.modal-bg').forEach(modal => modal.addEventListener('click', event => {
  if (event.target === modal) {
    if (modal.id === 'gameSession') { stopGameSession(); return; }
    addAndLaunch = false;
    if (modal.id === 'removeModal') pendingDeleteId = null;
    closeModals();
  }
}));
// Al jugar con teclado físico se ocultan los controles táctiles; reaparecen al tocar la pantalla.
document.addEventListener('keydown', event => {
  const session = $('#gameSession');
  if (!session.classList.contains('open') || waitingForNesKey || event.target.matches?.('input, select, textarea')) return;
  if (event.key === 'Escape' || event.key === 'Tab' || event.metaKey || ['Shift','Control','Alt'].includes(event.key)) return;
  session.classList.add('nes-touch-hidden-kb');
}, true);
document.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch') $('#gameSession').classList.remove('nes-touch-hidden-kb');
}, true);
document.addEventListener('keydown', withErrorToast(async event => {
  if (waitingForNesKey) {
    event.preventDefault(); event.stopImmediatePropagation();
    const code = displayKeyName(event);
    if (!code) { notify('Elige una tecla normal, una flecha, Enter o espacio.', true); return; }
    if (String(waitingForNesKey).startsWith('2:')) { nesKeys2[waitingForNesKey.slice(2)] = code; waitingForNesKey = null; try { localStorage.setItem('arcadia-nes-keys2', JSON.stringify(nesKeys2)); } catch {} }
    else { nesKeys[waitingForNesKey] = code; waitingForNesKey = null; try { localStorage.setItem('arcadia-nes-keys', JSON.stringify(nesKeys)); } catch {} }
    applyNesKeys(); notify('Control actualizado.'); return;
  }
  if ($('#gameSession').classList.contains('open')) {
    if (event.key === 'Escape') { event.preventDefault(); await stopGameSession(); }
    return;
  }
  if (event.target.matches('input, select, textarea') || $('#nesSettingsPanel').contains(event.target)) return;
  if (event.key === 'Escape') {
    if ($('#gameSession').classList.contains('open')) { await stopGameSession(); return; }
    if ($('#removeModal').classList.contains('open')) pendingDeleteId = null;
    addAndLaunch = false; closeModals(); return;
  }
  if (event.target.matches('input, select, textarea') || $('.modal-bg.open')) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); moveSelection(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelection(-1); }
  if (event.key === 'Enter' || event.key === ' ') {
    const game = visibleGames()[selected];
    if (game) { event.preventDefault(); await launchGame(game.id); }
  }
}));
window.addEventListener('resize', reportGameViewBounds);
new ResizeObserver(reportGameViewBounds).observe($('#gameViewport'));
$('#exitGame').addEventListener('click', withErrorToast(stopGameSession));
$('#configureNes').addEventListener('click', () => { renderNesKeySettings(); renderGamepadSettings(); renderLocal2pSettings(); $('#nesSettingsPanel').classList.toggle('hide'); });
$('#closeNesSettings').addEventListener('click', () => { waitingForNesKey = null; waitingForPadAction=null; $('#nesSettingsPanel').classList.add('hide'); $('#gameSession').classList.remove('touch-layout-editing'); touchLayoutEditing=false; });
$('#local2pEnable')?.addEventListener('change', event => { local2p.enabled = event.target.checked; if (local2p.enabled && !local2p.manual) autoAssignLocal2p(); saveLocal2p(); applyNesKeys(); previousNesPadState.clear(); renderLocal2pSettings(); notify(local2p.enabled ? 'Modo de 2 jugadores locales activado.' : 'Modo de 2 jugadores locales desactivado.'); });
$('#local2pAssign')?.addEventListener('change', event => { const sel = event.target.closest('[data-l2p]'); if (!sel) return; const v = sel.value === '' ? null : Number(sel.value), key = sel.dataset.l2p; if (key === 'kb1') local2p.kb1 = v; else if (key === 'kb2') local2p.kb2 = v; else local2p.pads[Number(key.slice(3))] = v; local2p.manual = true; saveLocal2p(); applyNesKeys(); previousNesPadState.clear(); });
$('#nesKeyGrid2')?.addEventListener('click', event => { const b = event.target.closest('[data-remap2]'); if (!b) return; waitingForNesKey = '2:' + b.dataset.remap2; notify('Presiona la nueva tecla del Jugador 2.'); });
$('#resetNesKeys2')?.addEventListener('click', () => { nesKeys2 = {...defaultNesKeys2}; try { localStorage.removeItem('arcadia-nes-keys2'); } catch {} applyNesKeys(); });
window.addEventListener('gamepadconnected', () => setTimeout(() => { if (local2p.enabled && !local2p.manual) autoAssignLocal2p(); applyNesKeys(); renderLocal2pSettings(); }, 150));
window.addEventListener('gamepaddisconnected', () => setTimeout(() => { if (local2p.enabled && !local2p.manual) autoAssignLocal2p(); applyNesKeys(); renderLocal2pSettings(); }, 150));
$('#resetNesKeys').addEventListener('click', () => { nesKeys = {...defaultNesKeys}; try { localStorage.removeItem('arcadia-nes-keys'); } catch {} applyNesKeys(); notify('Controles originales restaurados.'); });
$('#hideTouchNes').addEventListener('click', () => {
  if (connectedGamepadDetected) { notify('Los controles táctiles se ocultan mientras haya un mando conectado.'); return; }
  touchControlsHiddenByUser = !touchControlsHiddenByUser;
  syncTouchControlsForGamepad();
});
$('#nesKeyGrid').addEventListener('click', event => { const button = event.target.closest('[data-remap]'); if (!button) return; waitingForNesKey = button.dataset.remap; notify(`Presiona la nueva tecla para ${button.textContent.replace(button.querySelector('strong')?.textContent || '', '').trim()}.`); });
$('#fullscreenNes').addEventListener('click', withErrorToast(toggleGameFullscreen));
document.addEventListener('fullscreenchange', () => { const active=Boolean(document.fullscreenElement); $('#gameSession').classList.toggle('nes-session-fullscreen',active); setNesTurbo(false); requestAnimationFrame(() => nesBrowser?.fitInParent?.()); });
$('#nesGamepadSelect').addEventListener('change', event => { selectedGamepadIndex=Number(event.target.value); try{localStorage.setItem('arcadia-nes-selected-pad',String(selectedGamepadIndex));}catch{} previousNesPadState.clear(); renderGamepadSettings(); });
$('#scanGamepads').addEventListener('click',renderGamepadSettings);
$('#resetNesPad').addEventListener('click',()=>{const pad=[...(navigator.getGamepads?.()||[])].filter(Boolean).find(item=>item.index===selectedGamepadIndex);if(!pad)return notify('Conecta y selecciona un mando primero.',true);delete nesPadMaps[pad.id];try{localStorage.setItem('arcadia-nes-pad-maps',JSON.stringify(nesPadMaps));}catch{}renderGamepadSettings();notify('Distribución original del mando restaurada.');});
$('#nesPadGrid').addEventListener('click',event=>{const button=event.target.closest('[data-pad-remap]');if(!button)return;waitingForPadAction=button.dataset.padRemap;notify('Presiona el botón o mueve el eje que deseas asignar.');});
window.addEventListener('gamepadconnected',()=>setTimeout(()=>{renderGamepadSettings();syncTouchControlsForGamepad();},100));
window.addEventListener('gamepaddisconnected',()=>{renderGamepadSettings();syncTouchControlsForGamepad();});
$('#editTouchLayout').addEventListener('click',()=>{touchLayoutEditing=!touchLayoutEditing;$('#gameSession').classList.toggle('touch-layout-editing',touchLayoutEditing);$('#editTouchLayout').textContent=touchLayoutEditing?'Terminar movimiento':'Mover botones';});
$('#touchSize').addEventListener('input',event=>{$('#nesTouchControls').style.setProperty('--touch-size',event.target.value);readTouchLayout();});
$('#touchControlMode')?.addEventListener('change',event=>{const mode=event.target.value==='buttons'?'buttons':'joystick';$('#nesTouchControls').dataset.controlMode=mode;try{localStorage.setItem('arcadia-nes-touch-mode',mode);}catch{}resetVirtualJoystick();});
$('#resetTouchLayout').addEventListener('click',()=>{resetTouchLayout();notify('Tamaño y posiciones táctiles restaurados.');});
$('#pauseNes').addEventListener('click', () => {
  if (!nesBrowser) return;
  nesPaused ? nesBrowser.start() : nesBrowser.stop();
  nesPaused = !nesPaused;
  window.arcadiaOnline?.hostPaused(nesPaused);
  $('#pauseNes').textContent = nesPaused ? 'Reanudar' : 'Pausar';
  $('#nesStatus').textContent = nesPaused ? 'Juego en pausa' : 'NES integrado · Flechas + S/A · Mando o controles táctiles';
});
$('#saveNes').addEventListener('click', withErrorToast(saveNesState));
$('#loadNes').addEventListener('click', withErrorToast(loadNesState));
$('#nesTouchControls').addEventListener('pointerdown', event => {
  if (touchLayoutEditing) {
    const group=event.target.closest('[data-touch-group]'); if(!group)return;
    event.preventDefault(); const box=group.getBoundingClientRect();
    touchDragState={group,pointerId:event.pointerId,dx:event.clientX-box.left,dy:event.clientY-box.top};
    group.setPointerCapture?.(event.pointerId); return;
  }
  const overlay = $('#nesTouchControls');
  const controlMode = overlay?.dataset.controlMode === 'buttons' ? 'buttons' : 'joystick';
  const control = event.target.closest('[data-nes]');
  if (!nesBrowser && !window.arcadiaOnline?.isGuest()) return;
  // Modo joystick: toda la zona izquierda sirve como joystick flotante. Los botones A/B/Start/Select
  // (derecha y centro) no se tocan ni se mueven nunca.
  if (controlMode === 'joystick' && !control) {
    const onStick = event.target.closest('#nesJoystick');
    const inZone = event.target.id === 'nesJoystickZone';
    if (onStick || inZone) {
      event.preventDefault();
      if (joystickPointerId !== null) return;
      const joystick = $('#nesJoystick');
      joystickRestStyle = joystick.style.cssText;
      if (inZone) {
        const rect = overlay.getBoundingClientRect();
        const size = joystick.getBoundingClientRect().width || 120;
        const x = Math.max(0, Math.min(rect.width - size, event.clientX - rect.left - size / 2));
        const y = Math.max(0, Math.min(rect.height - size, event.clientY - rect.top - size / 2));
        joystick.style.left = `${x}px`; joystick.style.top = `${y}px`;
        joystick.style.right = 'auto'; joystick.style.bottom = 'auto'; joystick.style.transform = 'none'; joystick.style.margin = '0';
        joystick.classList.add('floating');
      }
      joystickPointerId = event.pointerId;
      overlay.setPointerCapture?.(event.pointerId);
      updateVirtualJoystick(event);
      return;
    }
  }
  if (!control) return;
  event.preventDefault();
  control.setPointerCapture?.(event.pointerId);
  const button = nesPadButtons.get(control.dataset.nes);
  if (button !== undefined) nesPadSet(button, true);
  control.classList.add('pressed');
});
$('#nesTouchControls').addEventListener('pointermove',event=>{
  if (joystickPointerId === event.pointerId && !touchLayoutEditing) { event.preventDefault(); updateVirtualJoystick(event); return; }
  if(!touchDragState||touchDragState.pointerId!==event.pointerId)return;
  event.preventDefault();const overlay=$('#nesTouchControls').getBoundingClientRect(),group=touchDragState.group;
  const x=Math.max(0,Math.min(overlay.width-group.offsetWidth,event.clientX-overlay.left-touchDragState.dx));
  const y=Math.max(0,Math.min(overlay.height-group.offsetHeight,event.clientY-overlay.top-touchDragState.dy));
  group.style.position='absolute';group.style.left=`${x}px`;group.style.top=`${y}px`;group.style.right='auto';group.style.bottom='auto';group.style.transform='none';group.style.margin='0';
});
function finishTouchDrag(event){if(!touchDragState||touchDragState.pointerId!==event.pointerId)return;touchDragState.group.releasePointerCapture?.(event.pointerId);touchDragState=null;readTouchLayout();}
$('#nesTouchControls').addEventListener('pointerup',finishTouchDrag);
$('#nesTouchControls').addEventListener('pointercancel',finishTouchDrag);
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  $('#nesTouchControls').addEventListener(eventName, event => {
    if (joystickPointerId === event.pointerId) { resetVirtualJoystick(); return; }
    if(touchLayoutEditing)return;
    const control = event.target.closest?.('[data-nes]');
    const button = control && nesPadButtons.get(control.dataset.nes);
    if (button != null) nesPadSet(button, false);
    control?.classList.remove('pressed');
  });
}
$('#cancelRemove').addEventListener('click', () => { pendingDeleteId = null; closeModals(); });
$('#confirmRemove').addEventListener('click', withErrorToast(confirmRemoveGame));
async function stopGameSession() {
  window.arcadiaOnline?.sessionClosed();
  clearInterval(fpsTimer); fpsTimer = null;
  if (document.fullscreenElement) { try { await document.exitFullscreen(); screen.orientation?.unlock?.(); } catch {} }
  $('#gameSession').classList.remove('nes-session-fullscreen','nes-touch-hidden','nes-touch-hidden-kb');
  touchControlsHiddenByUser = false;
  syncTouchControlsForGamepad();
  if (nesBrowser) { nesBrowser.destroy(); nesBrowser = null; }
  activeNesGameId = null;
  previousNesPadState.clear();
  await window.arcadia.stopGame();
  closeModals();
  $('#sessionPlaceholder')?.classList.remove('hide');
}
window.arcadia.onGameEnded(() => {
  closeModals();
  notify('El juego se cerró. Ya puedes elegir otro.');
});

let lastPadAction = 0;
window.addEventListener('gamepadconnected', event => { syncTouchControlsForGamepad(); notify(`Mando conectado: ${event.gamepad.id || 'control compatible'}. Los controles táctiles se ocultaron.`); });
window.addEventListener('gamepaddisconnected', () => { syncTouchControlsForGamepad(); notify('Mando desconectado. Los controles táctiles están disponibles.'); });
function pollGamepad() {
  window.pollGbaPad?.();
  if (performance.now() - lastTouchModeCheck > 400) { lastTouchModeCheck = performance.now(); syncTouchControlsForGamepad(); }
  pollNesGamepad();
  const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (pad && !$('.modal-bg.open') && !$('#gbaModal')?.classList.contains('open') && Date.now() - lastPadAction > 220) {
    const axis = pad.axes?.[0] || 0;
    if (pad.buttons[14]?.pressed || axis < -0.65) { moveSelection(-1); lastPadAction = Date.now(); }
    else if (pad.buttons[15]?.pressed || axis > 0.65) { moveSelection(1); lastPadAction = Date.now(); }
    else if (pad.buttons[0]?.pressed) {
      const game = visibleGames()[selected];
      if (game) launchGame(game.id).catch(error => notify(error.message, true));
      lastPadAction = Date.now();
    }
    else if (pad.buttons[1]?.pressed) { setFilter('all'); lastPadAction = Date.now(); }
  }
  requestAnimationFrame(pollGamepad);
}


// Standalone GBA player. ROMs are stored locally in IndexedDB (never uploaded).
let gbaRomObjectUrl = null;
const GBA_ROM_DB = 'arcadia-local-roms-v1';
function openGbaRomDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('Este navegador no permite guardar ROMs localmente.'));return;}
    const request=indexedDB.open(GBA_ROM_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('roms'))request.result.createObjectStore('roms');};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error('No se pudo abrir el almacenamiento local.'));
  });
}
async function saveGbaRom(file){
  const db=await openGbaRomDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction('roms','readwrite');tx.objectStore('roms').put({blob:file,name:file.name,type:file.type||'application/octet-stream',savedAt:Date.now()},'last-gba-rom');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error||new Error('No se pudo guardar la ROM.'))};tx.onabort=()=>{db.close();reject(tx.error||new Error('Se canceló el guardado de la ROM.'))};});
}
async function getSavedGbaRom(){
  const db=await openGbaRomDb();
  return new Promise((resolve,reject)=>{const tx=db.transaction('roms','readonly');const req=tx.objectStore('roms').get('last-gba-rom');req.onsuccess=()=>{const record=req.result;db.close();if(record?.blob)resolve(new File([record.blob],record.name||'arcadia-game.gba',{type:record.type||'application/octet-stream'}));else resolve(null)};req.onerror=()=>{db.close();reject(req.error||new Error('No se pudo recuperar la ROM guardada.'))};});
}
async function openGbaPlayer(gameName='',autoRestore=true){
  const modal=$('#gbaModal'); if(!modal)return;
  modal.classList.add('open');
  $('#gbaStatus').textContent=gameName ? `Buscando la ROM guardada de ${gameName}…` : 'Buscando una ROM guardada…';
  if(autoRestore){
    try{const saved=await getSavedGbaRom();if(saved){loadGbaRom(saved,false);$('#gbaStatus').textContent=`Abriendo ${saved.name} guardada en este navegador…`;return;}}
    catch(error){console.warn('No se pudo restaurar la ROM GBA:',error);}
  }
  $('#gbaStatus').textContent=gameName ? `Selecciona tu ROM .gba de ${gameName} la primera vez.` : 'Elige una ROM .gba para empezar.';
}
let gbaEngine=null, gbaLoading=null, gbaWaitKey=null, gbaWaitPad=null, gbaCurrentRom='';
const GBA_ACTIONS=[['up','Arriba',6],['down','Abajo',7],['left','Izquierda',5],['right','Derecha',4],['a','A',0],['b','B',1],['l','L',9],['r','R',8],['start','Start',3],['select','Select',2],['turbo','Turbo',null]];
const GBA_KEY_OF=Object.fromEntries(GBA_ACTIONS.map(([a,,k])=>[a,k]));
const gbaDefaultKeys={up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',a:'KeyX',b:'KeyZ',l:'KeyA',r:'KeyS',start:'Enter',select:'ShiftLeft',turbo:'Space'};
const gbaDefaultPad={up:{button:12},down:{button:13},left:{button:14},right:{button:15},a:{button:0},b:{button:1},l:{button:4},r:{button:5},start:{button:9},select:{button:8},turbo:{button:7}};
let gbaKeys={...gbaDefaultKeys}, gbaPadMaps={}, gbaPadIndex=-1;
try{gbaKeys={...gbaDefaultKeys,...JSON.parse(localStorage.getItem('arcadia-gba-keys')||'{}')};}catch{}
try{gbaPadMaps=JSON.parse(localStorage.getItem('arcadia-gba-pad-maps')||'{}')||{};}catch{}
const gbaNorm=c=>String(c||'').replace(/^(Shift|Control|Alt)(Left|Right)$/,'$1');
const gbaActionByCode=code=>{code=gbaNorm(code);for(const [a] of GBA_ACTIONS)if(gbaNorm(gbaKeys[a])===code)return a;return null;};
const gbaKeyLabel=c=>({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Enter:'Enter',ShiftLeft:'Shift',ShiftRight:'Shift',Space:'Espacio',ControlLeft:'Ctrl',ControlRight:'Ctrl'})[c]||String(c||'').replace(/^Key|^Digit/,'');
const gbaPadMapFor=pad=>({...gbaDefaultPad,...(pad&&gbaPadMaps[pad.id]||{})});
function loadScriptOnce(src){return new Promise((res,rej)=>{const t=document.createElement('script');t.src=src;t.onload=res;t.onerror=()=>rej(new Error('No se pudo cargar '+src));document.head.appendChild(t);});}
async function loadAny(list){let last;for(const u of list){try{await loadScriptOnce(u);return;}catch(e){last=e;}}throw new Error('No se encontró '+list[0]+' en tu sitio. Sube la carpeta vendor/gba completa (3 archivos) al repositorio.');}
async function ensureGbaCore(){
  if(window.ArcadiaGBA?.available?.())return;
  if(!gbaLoading)gbaLoading=(async()=>{if(typeof window.GameBoyAdvanceEmulator!=='function')await loadAny(['vendor/gba/iodine-gba.min.js','iodine-gba.min.js','/vendor/gba/iodine-gba.min.js']);if(!window.ArcadiaGBA)await loadAny(['vendor/gba/gba-engine.js','gba-engine.js','/vendor/gba/gba-engine.js']);})().catch(e=>{gbaLoading=null;throw e;});
  await gbaLoading;
}
let gbaTurbo=false,gbaUserMuted=false;
function gbaTurboMult(){let m=2;try{m=Number(localStorage.getItem('arcadia-gba-turbo-mult'))||2;}catch{}return Math.max(1.5,Math.min(5,m));}
function gbaSetTurbo(on){
  gbaTurbo=!!on&&!!gbaEngine;
  if(gbaEngine){gbaEngine.setSpeed(gbaTurbo?gbaTurboMult():1);gbaEngine.setMuted(gbaTurbo||gbaUserMuted);}
  document.querySelectorAll('[data-gba=turbo]').forEach(b=>b.classList.toggle('latched',gbaTurbo));
  const el=$('#gbaFps');if(el){el.dataset.turbo=gbaTurbo?'1':'';if(gbaTurbo)el.textContent='⏩ '+gbaTurboMult()+'x';}
}
function gbaToggleTurbo(){gbaSetTurbo(!gbaTurbo);}
function stopGbaEngine(){
  gbaTurbo=false;document.querySelectorAll('[data-gba=turbo]').forEach(b=>b.classList.remove('latched'));
  window.gbaPadReset?.();
  const fe=$('#gbaFps'); if(fe)fe.hidden=true;
  if(gbaEngine){try{gbaEngine.destroy();}catch{} gbaEngine=null;}
  document.querySelectorAll('#gbaPad .on').forEach(b=>b.classList.remove('on'));
}
function closeGbaPlayer(){
  $('#gbaModal')?.classList.remove('open');
  stopGbaEngine();
  if(document.fullscreenElement)document.exitFullscreen?.();
  $('#gbaStage').innerHTML='<div class="gba-empty" id="gbaEmpty"><strong>Tu próxima aventura portátil</strong><p>Carga tu archivo .gba para iniciar el emulador de Arcadia.</p><button class="btn primary" id="gbaChooseBig">Elegir archivo de juego</button></div>';
  $('#gbaChooseBig')?.addEventListener('click',()=>$('#gbaRomInput').click());
  $('#gbaStatus').textContent='Emulador cerrado.';
}
async function loadGbaRom(file, persist=true){
  if(!file)return;
  if(!(/\.(gba|bin)$/i.test(file.name))){$('#gbaStatus').textContent='Formato no reconocido. Selecciona una ROM .gba (los .zip aún no se admiten: descomprímelo antes).';return;}
  if(persist) saveGbaRom(file).then(()=>$('#gbaStatus').textContent='ROM guardada en este navegador; no tendrás que seleccionarla cada vez.').catch(error=>{console.warn(error);$('#gbaStatus').textContent='El juego se abrirá, pero el navegador no pudo guardar la ROM.';});
  stopGbaEngine();
  const stage=$('#gbaStage'); stage.innerHTML='';
  const canvas=document.createElement('canvas'); canvas.id='gbaCanvas'; stage.appendChild(canvas);
  $('#gbaStatus').textContent='Iniciando el emulador de Arcadia…';
  try{
    await ensureGbaCore();
    gbaCurrentRom=file.name; window.ArcadiaGBA.requestPersistence?.();
    const bytes=new Uint8Array(await file.arrayBuffer());
    const engine=await window.ArcadiaGBA.create(canvas,{biosUrl:await (async()=>{for(const u of ['vendor/gba/bios.bin','bios.bin','/vendor/gba/bios.bin']){try{const r=await fetch(u,{method:'HEAD'});if(r.ok)return u;}catch{}}return 'vendor/gba/bios.bin';})(),saveKeyPrefix:'gba:',legacyPrefix:'rom:'+file.name.replace(/\.[^.]+$/,'')+':',onSave:()=>{const el=$('#gbaStatus');if(el){const t=el.textContent;el.textContent='💾 Partida guardada';setTimeout(()=>{if(el.textContent==='💾 Partida guardada')el.textContent=t;},1500);}},onSpeed:pct=>{if(!gbaEngine||!pct)return;const fps=Math.min(60,Math.round(59.73*pct/100));const el=$('#gbaFps');if(el){el.hidden=false;el.textContent=gbaTurbo?'⏩ '+gbaTurboMult()+'x · '+Math.round(pct)+'%':fps+' FPS';el.className='gba-fps'+(fps<45?' bad':fps<57?' low':'');}$('#gbaStatus').textContent='GBA · '+file.name+' · '+Math.round(pct)+'%';}});
    gbaEngine=engine; engine.load(bytes); engine.start(); engine.sound.resume(); if($('#gbaPause')){$('#gbaPause').dataset.p='';$('#gbaPause').textContent='⏸ Pausa';}
    $('#gbaStatus').textContent='GBA · '+file.name;
    window.gbaTouchApply?.();$('#gbaModal').classList.remove('nes-touch-hidden-kb');
  }catch(error){
    console.error(error); stopGbaEngine();
    $('#gbaStatus').textContent='No se pudo iniciar el juego: '+(error.message||error);
  }
}
(function gbaInput(){
  const modal=$('#gbaModal'), touch=$('#gbaTouch'); if(!touch)return;
  // Controles táctiles GBA: mismo diseño y mismo funcionamiento que los de NES (joystick flotante o botones).
  const KEY={up:6,down:7,left:5,right:4,a:0,b:1,select:2,start:3,l:9,r:8};
  const setKey=(name,on)=>{if(name==='turbo'){if(on)gbaToggleTurbo();return;}const k=KEY[name];if(k===undefined||!gbaEngine)return;on?gbaEngine.keyDown(k):gbaEngine.keyUp(k);};
  const getMode=()=>{let m=null;try{m=localStorage.getItem('arcadia-gba-touch-mode')||localStorage.getItem('arcadia-nes-touch-mode');}catch{}return m==='buttons'?'buttons':'joystick';};
  const applyMode=()=>{
    touch.dataset.controlMode=getMode();
    let st={size:1,groups:{}};try{st={...st,...JSON.parse(localStorage.getItem('arcadia-gba-touch-layout')||'{}')};}catch{}
    touch.style.setProperty('--touch-size',String(st.size||1));
    const sz=$('#gbaTouchSize');if(sz)sz.value=String(st.size||1);const ms=$('#gbaTouchMode');if(ms)ms.value=touch.dataset.controlMode;
    touch.querySelectorAll('[data-touch-group]').forEach(g=>{
      const p=st.groups&&st.groups[g.dataset.touchGroup];
      if(!p){g.style.left=g.style.top=g.style.right=g.style.bottom='';g.style.transform='';return;}
      g.style.position='absolute';g.style.left=Math.max(0,Math.min(1,p.x))*100+'%';g.style.top=Math.max(0,Math.min(1,p.y))*100+'%';g.style.right='auto';g.style.bottom='auto';g.style.transform='none';g.style.margin='0';
    });
  };
  const saveLayout=()=>{
    const st={size:Number(touch.style.getPropertyValue('--touch-size'))||1,groups:{}},rect=touch.getBoundingClientRect();
    touch.querySelectorAll('[data-touch-group]').forEach(g=>{if(g.style.left===''&&g.style.top==='')return;st.groups[g.dataset.touchGroup]={x:Math.max(0,Math.min(1,g.offsetLeft/Math.max(1,rect.width))),y:Math.max(0,Math.min(1,g.offsetTop/Math.max(1,rect.height)))};});
    try{localStorage.setItem('arcadia-gba-touch-layout',JSON.stringify(st));}catch{}
  };
  let editing=false,drag=null;window.gbaSetEditing=v=>{editing=!!v;modal.classList.toggle('touch-layout-editing',editing);};
  window.gbaTouchSave=saveLayout;
  applyMode(); window.gbaTouchApply=applyMode;
  const joy=$('#gbaJoy'), knob=$('#gbaKnob'); let joyId=null, joyRest='', joyOn=new Set();
  const joyUpdate=e=>{
    const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=e.clientX-cx,dy=e.clientY-cy;
    const radius=Math.min(r.width,r.height)*.31,dist=Math.hypot(dx,dy)||1;if(dist>radius){dx=dx/dist*radius;dy=dy/dist*radius;}
    knob.style.transform='translate(calc(-50% + '+dx.toFixed(1)+'px),calc(-50% + '+dy.toFixed(1)+'px))';
    const nx=dx/radius,ny=dy/radius,next=new Set();
    if(Math.hypot(nx,ny)>.22){if(nx<-.34)next.add('left');if(nx>.34)next.add('right');if(ny<-.34)next.add('up');if(ny>.34)next.add('down');}
    for(const n of joyOn)if(!next.has(n))setKey(n,false);
    for(const n of next)if(!joyOn.has(n))setKey(n,true);
    joyOn=next;joy.classList.add('active');
  };
  const joyReset=()=>{for(const n of joyOn)setKey(n,false);joyOn=new Set();joyId=null;knob.style.transform='';joy.classList.remove('active','floating');joy.style.cssText=joyRest;};
  touch.addEventListener('contextmenu',e=>e.preventDefault());
  touch.addEventListener('pointerdown',e=>{
    if(editing){const g=e.target.closest('[data-touch-group]');if(!g)return;e.preventDefault();const bx=g.getBoundingClientRect();drag={g,id:e.pointerId,dx:e.clientX-bx.left,dy:e.clientY-bx.top};g.setPointerCapture?.(e.pointerId);return;}
    modal.classList.remove('nes-touch-hidden-kb');
    const ctl=e.target.closest('[data-gba]');
    if(touch.dataset.controlMode==='joystick'&&!ctl){
      const onStick=e.target.closest('#gbaJoy'),inZone=e.target.id==='gbaZone';
      if(onStick||inZone){
        e.preventDefault();if(joyId!==null)return;
        joyRest=joy.style.cssText;
        if(inZone){const r=touch.getBoundingClientRect(),sz=joy.getBoundingClientRect().width||120;
          joy.style.left=Math.max(0,Math.min(r.width-sz,e.clientX-r.left-sz/2))+'px';joy.style.top=Math.max(0,Math.min(r.height-sz,e.clientY-r.top-sz/2))+'px';
          joy.style.right='auto';joy.style.bottom='auto';joy.style.transform='none';joy.style.margin='0';joy.classList.add('floating');}
        joyId=e.pointerId;touch.setPointerCapture?.(e.pointerId);joyUpdate(e);return;
      }
    }
    if(!ctl)return;
    e.preventDefault();ctl.setPointerCapture?.(e.pointerId);setKey(ctl.dataset.gba,true);ctl.classList.add('pressed');
  });
  touch.addEventListener('pointermove',e=>{
    if(drag&&drag.id===e.pointerId){e.preventDefault();const o=touch.getBoundingClientRect(),g=drag.g;
      g.style.position='absolute';g.style.left=Math.max(0,Math.min(o.width-g.offsetWidth,e.clientX-o.left-drag.dx))+'px';g.style.top=Math.max(0,Math.min(o.height-g.offsetHeight,e.clientY-o.top-drag.dy))+'px';g.style.right='auto';g.style.bottom='auto';g.style.transform='none';g.style.margin='0';return;}
    if(joyId===e.pointerId){e.preventDefault();joyUpdate(e);}});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])touch.addEventListener(ev,e=>{
    if(drag&&drag.id===e.pointerId){drag=null;saveLayout();return;}
    if(editing)return;
    if(joyId===e.pointerId){joyReset();return;}
    const ctl=e.target.closest?.('[data-gba]');if(ctl){setKey(ctl.dataset.gba,false);ctl.classList.remove('pressed');}
  });
  window.gbaPadReset=()=>{if(joyId!==null||joyOn.size)joyReset();touch.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));};
  // ---- Panel ⚙ Controles ----
  const panel=$('#gbaSettings');
  window.gbaRenderSettings=()=>{
    $('#gbaKeyGrid').innerHTML=GBA_ACTIONS.map(([a,l])=>`<button type="button" data-k="${a}">${l}<strong>${gbaWaitKey===a?'…':escapeHtml(gbaKeyLabel(gbaKeys[a]))}</strong></button>`).join('');
    const pads=[...(navigator.getGamepads?.()||[])].filter(Boolean),sel=$('#gbaPadSelect');
    if(!pads.some(p=>p.index===gbaPadIndex))gbaPadIndex=pads[0]?.index??-1;
    sel.innerHTML=pads.length?pads.map(p=>`<option value="${p.index}" ${p.index===gbaPadIndex?'selected':''}>${escapeHtml(p.id||'Mando '+(p.index+1))}</option>`).join(''):'<option value="">No se detectaron mandos</option>';
    const gp=pads.find(p=>p.index===gbaPadIndex),map=gbaPadMapFor(gp);
    $('#gbaPadGrid').innerHTML=GBA_ACTIONS.map(([a,l])=>{const b=map[a];const t=gbaWaitPad===a?'…':b?.button!=null?'Botón '+(b.button+1):b?.axis!=null?'Eje '+(b.axis+1)+(b.value<0?' −':' +'):'—';return `<button type="button" data-p="${a}">${l}<strong>${t}</strong></button>`;}).join('');
  };
  const info=t=>{const el=$('#gbaSaveInfo');if(el)el.textContent=t;};
  $('#gbaSettingsBtn')?.addEventListener('click',()=>{window.gbaRenderSettings();panel.classList.toggle('hide');});
  $('#gbaCloseSettings')?.addEventListener('click',()=>{gbaWaitKey=null;gbaWaitPad=null;panel.classList.add('hide');window.gbaSetEditing(false);$('#gbaEditDone').hidden=true;});
  $('#gbaKeyGrid')?.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;gbaWaitKey=b.dataset.k;gbaWaitPad=null;window.gbaRenderSettings();});
  $('#gbaPadGrid')?.addEventListener('click',e=>{const b=e.target.closest('[data-p]');if(!b)return;gbaWaitPad=b.dataset.p;gbaWaitKey=null;window.gbaRenderSettings();});
  $('#gbaResetKeys')?.addEventListener('click',()=>{gbaKeys={...gbaDefaultKeys};try{localStorage.removeItem('arcadia-gba-keys');}catch{}window.gbaRenderSettings();});
  $('#gbaResetPad')?.addEventListener('click',()=>{const gp=[...(navigator.getGamepads?.()||[])].filter(Boolean).find(p=>p.index===gbaPadIndex);if(gp){delete gbaPadMaps[gp.id];try{localStorage.setItem('arcadia-gba-pad-maps',JSON.stringify(gbaPadMaps));}catch{}}window.gbaRenderSettings();});
  $('#gbaScanPads')?.addEventListener('click',()=>window.gbaRenderSettings());
  $('#gbaPadSelect')?.addEventListener('change',e=>{gbaPadIndex=Number(e.target.value);window.gbaRenderSettings();});
  window.addEventListener('gamepadconnected',()=>setTimeout(window.gbaRenderSettings,100));
  $('#gbaTouchMode')?.addEventListener('change',e=>{const m=e.target.value==='buttons'?'buttons':'joystick';touch.dataset.controlMode=m;try{localStorage.setItem('arcadia-gba-touch-mode',m);}catch{}joyReset();});
  const tm=$('#gbaTurboMult');if(tm){try{tm.value=localStorage.getItem('arcadia-gba-turbo-mult')||'2';}catch{}tm.addEventListener('change',e=>{try{localStorage.setItem('arcadia-gba-turbo-mult',e.target.value);}catch{}if(gbaTurbo)gbaSetTurbo(true);});}
  $('#gbaTouchSize')?.addEventListener('input',e=>{touch.style.setProperty('--touch-size',e.target.value);saveLayout();});
  const stopEdit=()=>{window.gbaSetEditing(false);$('#gbaEditDone').hidden=true;panel.classList.remove('hide');};
  $('#gbaEditLayout')?.addEventListener('click',()=>{window.gbaSetEditing(true);panel.classList.add('hide');$('#gbaEditDone').hidden=false;});
  $('#gbaEditDone')?.addEventListener('click',stopEdit);
  $('#gbaResetLayout')?.addEventListener('click',()=>{try{localStorage.removeItem('arcadia-gba-touch-layout');}catch{}applyMode();});
  const download=(name,data,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);};
  $('#gbaBackupAll')?.addEventListener('click',async()=>{try{await ensureGbaCore();gbaEngine?.saveNow();const o=await window.ArcadiaGBA.exportAllSaves();const n=Object.keys(o.saves).filter(k=>!/TYPE_/.test(k)).length;download('arcadia-gba-partidas-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(o),'application/json');info(n?`Copia descargada (${n} partida${n>1?'s':''}).`:'No hay partidas guardadas todavía.');}catch(err){info('No se pudo crear la copia: '+(err.message||err));}});
  $('#gbaRestoreAll')?.addEventListener('click',()=>$('#gbaFileJson').click());
  $('#gbaFileJson')?.addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{await ensureGbaCore();const n=await window.ArcadiaGBA.importAllSaves(JSON.parse(await f.text()));info(`Copia restaurada (${n} elementos). Reinicia el juego para cargarla.`);}catch(err){info('Archivo no válido: '+(err.message||err));}});
  $('#gbaExportSav')?.addEventListener('click',()=>{if(!gbaEngine)return info('Abre un juego primero.');const d=gbaEngine.exportCurrentSave();if(!d)return info('Este juego todavía no ha guardado nada.');download((gbaCurrentRom||'partida').replace(/\.[^.]+$/,'')+'.sav',d,'application/octet-stream');info('Partida descargada (.sav).');});
  $('#gbaImportSav')?.addEventListener('click',()=>{if(!gbaEngine)return info('Abre primero el juego al que pertenece la partida.');$('#gbaFileSav').click();});
  $('#gbaFileSav')?.addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(!f||!gbaEngine)return;try{await gbaEngine.importCurrentSave(new Uint8Array(await f.arrayBuffer()));info('Partida cargada. El juego se reinició con ella.');}catch(err){info('No se pudo cargar: '+(err.message||err));}});
  // Mando conectado => se ocultan los táctiles (igual que en NES)
  const syncPad=()=>{let c=false;try{c=[...(navigator.getGamepads?.()||[])].some(p=>p&&p.connected!==false);}catch{}modal.classList.toggle('nes-touch-hidden',c);};
  window.addEventListener('gamepadconnected',syncPad);window.addEventListener('gamepaddisconnected',syncPad);syncPad();
  const gbaOpen=()=>!!($('#gbaModal')?.classList.contains('open'));
  const wake=()=>{const s=gbaEngine&&gbaEngine.sound;if(s&&s.ctx&&s.ctx.state!=='running')s.resume();};
  document.addEventListener('pointerdown',wake,true);
  document.addEventListener('keydown',e=>{
    if(!gbaOpen())return;
    wake();
    if(gbaWaitKey){
      e.preventDefault();e.stopImmediatePropagation();
      if(e.key==='Escape'){gbaWaitKey=null;window.gbaRenderSettings?.();return;}
      for(const [a] of GBA_ACTIONS)if(a!==gbaWaitKey&&gbaNorm(gbaKeys[a])===gbaNorm(e.code))gbaKeys[a]=gbaKeys[gbaWaitKey];   // intercambia si ya estaba usada
      gbaKeys[gbaWaitKey]=e.code;gbaWaitKey=null;try{localStorage.setItem('arcadia-gba-keys',JSON.stringify(gbaKeys));}catch{}
      window.gbaRenderSettings?.();return;
    }
    if(e.key==='Escape')return;
    if(e.target&&e.target.matches&&e.target.matches('select,input[type=range]'))return;
    e.stopImmediatePropagation();
    const act=gbaActionByCode(e.code);
    if(act==='turbo'){e.preventDefault();if(!e.repeat&&gbaEngine)gbaToggleTurbo();return;}
    const k=act?GBA_KEY_OF[act]:undefined;
    if(k==null||!gbaEngine)return;
    e.preventDefault();modal.classList.add('nes-touch-hidden-kb');if(!e.repeat)gbaEngine.keyDown(k);
  },true);
  document.addEventListener('keyup',e=>{if(!gbaOpen())return;e.stopImmediatePropagation();const act=gbaActionByCode(e.code),k=act?GBA_KEY_OF[act]:undefined;if(k!=null&&gbaEngine)gbaEngine.keyUp(k);},true);
  // Mando: asignaciones por mando (editables en ⚙ Controles). Stick izquierdo siempre mueve.
  const held=new Set();
  window.pollGbaPad=function(){
    if(!gbaOpen())return;
    const pads=[...(navigator.getGamepads?.()||[])].filter(Boolean);
    const gp=pads.find(p=>p.index===gbaPadIndex)||pads[0]; if(!gp)return;
    if(gbaWaitPad){                                   // modo asignar: primer botón/eje que se mueva
      let bind=null;
      gp.buttons.forEach((b,i)=>{if(!bind&&b.pressed)bind={button:i};});
      if(!bind)gp.axes.forEach((v,i)=>{if(!bind&&Math.abs(v)>.7)bind={axis:i,value:v<0?-1:1};});
      if(bind){const m=gbaPadMapFor(gp);m[gbaWaitPad]=bind;gbaPadMaps[gp.id]=m;try{localStorage.setItem('arcadia-gba-pad-maps',JSON.stringify(gbaPadMaps));}catch{}gbaWaitPad=null;window.gbaRenderSettings?.();}
      return;
    }
    if(!gbaEngine)return;
    const map=gbaPadMapFor(gp),want=new Set();
    for(const [a,,k] of GBA_ACTIONS){const bd=map[a];if(!bd)continue;
      const on=bd.button!=null?gp.buttons[bd.button]?.pressed:(bd.axis!=null&&(gp.axes[bd.axis]||0)*bd.value>.5);
      if(a==='turbo'){if(on&&!held.has('turbo'))gbaToggleTurbo();on?held.add('turbo'):held.delete('turbo');continue;}
      if(on)want.add(k);}
    const ax=gp.axes[0]||0,ay=gp.axes[1]||0;
    if(ax<-.5)want.add(5);if(ax>.5)want.add(4);if(ay<-.5)want.add(6);if(ay>.5)want.add(7);
    for(const k of want)if(!held.has(k))gbaEngine.keyDown(k);
    for(const k of [...held])if(k!=='turbo'&&!want.has(k)){gbaEngine.keyUp(k);held.delete(k);}
    want.forEach(k=>held.add(k));
  };
  document.addEventListener('visibilitychange',()=>{if(!gbaEngine)return;if(document.hidden){gbaEngine.pause();gbaEngine.releaseAll();window.gbaPadReset?.();}else if($('#gbaModal')?.classList.contains('open'))gbaEngine.resume();});
})();
$('#gbaChoose')?.addEventListener('click',()=>$('#gbaRomInput').click());
$('#gbaChooseBig')?.addEventListener('click',()=>$('#gbaRomInput').click());
$('#gbaRomInput')?.addEventListener('change',event=>{loadGbaRom(event.target.files?.[0]);event.target.value='';});
$('#gbaExit')?.addEventListener('click',closeGbaPlayer);
$('#gbaPause')?.addEventListener('click',()=>{if(!gbaEngine)return;const b=$('#gbaPause');if(b.dataset.p==='1'){gbaEngine.resume();b.dataset.p='';b.textContent='⏸ Pausa';}else{gbaEngine.pause();gbaEngine.releaseAll();b.dataset.p='1';b.textContent='▶ Seguir';}});
$('#gbaMute')?.addEventListener('click',()=>{if(!gbaEngine)return;const b=$('#gbaMute');const m=b.dataset.m!=='1';gbaUserMuted=m;gbaEngine.setMuted(m||gbaTurbo);gbaEngine.sound.resume();b.dataset.m=m?'1':'';b.textContent=m?'🔇 Silencio':'🔊 Sonido';});
$('#gbaSave')?.addEventListener('click',()=>{if(gbaEngine){gbaEngine.saveNow();const el=$('#gbaStatus');el.textContent='💾 Guardado';}});
$('#gbaReset')?.addEventListener('click',()=>{if(gbaEngine){gbaEngine.restart();gbaEngine.start();}});
$('#gbaFullscreen')?.addEventListener('click',()=>{const target=$('#gbaModal');if(!document.fullscreenElement)target.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.();});
$('#gbaModal')?.addEventListener('click',event=>{if(event.target===$('#gbaModal'))closeGbaPlayer();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#gbaModal')?.classList.contains('open')&&!document.fullscreenElement)closeGbaPlayer();});

// News badge is lit only until the user opens the current release notes.
(function setupArcadiaNews(){
  const version='2.2.1';
  const dot=$('#newsButton'), panel=$('#newsPanel');
  if(!dot||!panel)return;
  let seen=''; try{seen=localStorage.getItem('arcadia-news-seen-version')||'';}catch{}
  dot.classList.toggle('news-unread',seen!==version);
  const close=()=>panel.classList.remove('open');
  dot.addEventListener('click',()=>{panel.classList.add('open');dot.classList.remove('news-unread');try{localStorage.setItem('arcadia-news-seen-version',version);}catch{}});
  $('#newsClose')?.addEventListener('click',close);
  panel.addEventListener('click',e=>{if(e.target===panel)close();});
})();

(async function initialize() {
  try {
    catalog = await window.arcadia.readCatalog();
    if (window.arcadia.isWeb) $('#addModal p').textContent = 'Elige una ROM .nes y una carátula. La ROM se conserva en este navegador y puedes jugarla aquí mismo.';
    catalog.games = Array.isArray(catalog.games) ? catalog.games : [];
    // Merge featured titles on every startup, not only on the old V3 flag.
    // This is what allows existing installations to receive new catalog entries.
    let featuredCatalogChanged = false;
    for (const featured of FEATURED_GAMES) {
      let existing = catalog.games.find(game => game.id === featured.id);
      if (!existing) existing = catalog.games.find(game =>
        String(game.platform || '').toLocaleLowerCase() === String(featured.platform || '').toLocaleLowerCase() &&
        String(game.name || '').toLocaleLowerCase() === featured.name.toLocaleLowerCase()
      );
      if (!existing) {
        catalog.games.push({ ...featured });
        featuredCatalogChanged = true;
      } else {
        if (!existing.id) { existing.id = featured.id; featuredCatalogChanged = true; }
        if (existing.cover !== featured.cover) { existing.cover = featured.cover; featuredCatalogChanged = true; }
      }
    }
    catalog.featuredNesSeededV4 = true;
    if (featuredCatalogChanged) await window.arcadia.writeCatalog(catalog);
    catalog.settings ||= { performance: 'low', emulators: {} };
    catalog.settings.emulators ||= {};
    $('#resolution').value = catalog.settings.resolution || '1';
    $('#vsync').value = catalog.settings.vsync || 'off';
    const bootId = catalog.pendingLaunchId;
    delete catalog.pendingLaunchId;
    render();
    if (bootId) {
      await window.arcadia.writeCatalog(catalog);
      setTimeout(() => launchGame(bootId).catch(error => notify(error.message, true)), 850);
    }
  } catch (error) {
    console.error(error);
    notify('No se pudo cargar la biblioteca. Cierra y vuelve a abrir Arcadia.', true);
  }
  requestAnimationFrame(pollGamepad);
})();






