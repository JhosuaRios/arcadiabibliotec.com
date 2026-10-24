/* Arcadia · motor GBA
 * Envoltura de Arcadia sobre el núcleo IodineGBA (MIT, © Grant Galitz) + BIOS libre Cult-of-GBA (MIT).
 * Sin Workers ni SharedArrayBuffer: corre en el hilo principal, así funciona en cualquier alojamiento.
 * API: ArcadiaGBA.create(canvas) -> motor { load, start, pause, resume, keyDown, keyUp, setVolume, destroy, ... }
 * Teclas del núcleo: 0 A, 1 B, 2 Select, 3 Start, 4 Derecha, 5 Izquierda, 6 Arriba, 7 Abajo, 8 R, 9 L.
 */
(() => {
  'use strict';
  const GBA_W = 240, GBA_H = 160;
  const DB_NAME = 'arcadia-gba', STORE = 'saves';

  /* ── Guardados de batería (SRAM/Flash/EEPROM) en IndexedDB, con copia en memoria ── */
  const memorySaves = new Map();
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbPromise;
  }
  async function saveGet(key) {
    const db = await openDb();
    if (!db) return memorySaves.get(key) || null;
    return new Promise(resolve => {
      try {
        const req = db.transaction(STORE).objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(memorySaves.get(key) || null);
      } catch { resolve(memorySaves.get(key) || null); }
    });
  }
  async function savePut(key, value) {
    memorySaves.set(key, value);
    const db = await openDb();
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); } catch {}
  }
  async function saveDelete(key) {
    memorySaves.delete(key);
    const db = await openDb();
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch {}
  }

  /* ── Vídeo: el núcleo entrega RGB 240×160; se pinta en el siguiente fotograma de pantalla ── */
  class Screen {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = GBA_W; canvas.height = GBA_H;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.image = this.ctx.createImageData(GBA_W, GBA_H);
      const px = this.image.data; for (let i = 3; i < px.length; i += 4) px[i] = 255;
      this.pending = null; this.frames = 0; this.raf = 0; this.alive = true;
      this.tick = this.tick.bind(this);
      this.raf = requestAnimationFrame(this.tick);
    }
    copyBuffer(rgb) {                       // llamado por el núcleo en cada cuadro
      if (!this.pending) this.pending = new Uint8Array(GBA_W * GBA_H * 3);
      this.pending.set(rgb);
      this.dirty = true;
    }
    tick() {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(this.tick);
      if (!this.dirty) return;
      this.dirty = false;
      const src = this.pending, dst = this.image.data;
      for (let i = 0, j = 0, n = GBA_W * GBA_H * 3; i < n; i += 3, j += 4) { dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; }
      this.ctx.putImageData(this.image, 0, 0);
      this.frames++;
    }
    destroy() { this.alive = false; cancelAnimationFrame(this.raf); }
  }

  /* ── Audio: cola de buffers programados con WebAudio (sin Workers; la reproducción no depende del hilo principal) ── */
  class Sound {
    constructor() {
      this.ctx = null; this.gain = null; this.volume = 1; this.muted = false;
      this.channels = 2; this.rate = 44100; this.nextTime = 0; this.registered = false;
    }
    ensureContext() {
      if (this.ctx) return true;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      try {
        this.ctx = new Ctx({ latencyHint: 'interactive' });
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        this.applyVolume();
      } catch { this.ctx = null; return false; }
      return true;
    }
    applyVolume() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume; }
    setVolume(v) { this.volume = Math.max(0, Math.min(1, +v || 0)); this.applyVolume(); }
    setMuted(m) { this.muted = !!m; this.applyVolume(); }
    resume() { try { this.ctx?.resume?.(); } catch {} }
    // — interfaz que espera el núcleo —
    initialize(channels, sampleRate) {
      this.channels = channels | 0 || 2; this.rate = Math.max(8000, Math.min(96000, Math.round(sampleRate) || 44100));
      this.ensureContext();
    }
    register() { this.registered = true; this.nextTime = 0; }
    unregister() { this.registered = false; }
    setBufferSpace(samples) {                // relleno de silencio inicial para estabilizar
      if (!this.ctx || !this.registered || samples <= 0) return;
      this.push(new Float32Array(Math.min(samples, this.rate * this.channels)), 0, Math.min(samples, this.rate * this.channels));
    }
    push(buffer, start, end) {
      if (!this.ctx || !this.registered) return;
      const frames = Math.floor((end - start) / this.channels);
      if (frames <= 0) return;
      const ab = this.ctx.createBuffer(this.channels, frames, this.rate);
      for (let c = 0; c < this.channels; c++) {
        const out = ab.getChannelData(c);
        for (let i = 0, k = start + c; i < frames; i++, k += this.channels) out[i] = buffer[k];
      }
      const src = this.ctx.createBufferSource();
      src.buffer = ab; src.connect(this.gain);
      const now = this.ctx.currentTime;
      if (this.nextTime < now + 0.01) this.nextTime = now + 0.03;     // se vació: reengancha con un pequeño margen
      src.start(this.nextTime);
      this.nextTime += frames / this.rate;
    }
    remainingBuffer() {                      // muestras entrelazadas aún por sonar (a la tasa del núcleo)
      if (!this.ctx) return 0;
      const secs = Math.max(0, this.nextTime - this.ctx.currentTime);
      return Math.floor(secs * this.rate) * this.channels;
    }
    destroy() { try { this.ctx?.close?.(); } catch {} this.ctx = null; this.gain = null; }
  }

  async function fetchBios(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar la BIOS libre de GBA.');
    return new Uint8Array(await res.arrayBuffer());
  }

  const ArcadiaGBA = {
    available: () => typeof window.GameBoyAdvanceEmulator === 'function',
    /** @param canvas <canvas> destino
     *  @param opts { biosUrl, saveKeyPrefix, onSpeed(pct), onStatus(text) } */
    async create(canvas, opts = {}) {
      if (!ArcadiaGBA.available()) throw new Error('El núcleo de GBA no está cargado.');
      const bios = await fetchBios(opts.biosUrl || 'vendor/gba/bios.bin');
      const core = new window.GameBoyAdvanceEmulator();
      const screen = new Screen(canvas);
      const sound = new Sound();
      let saveKeyPrefix = opts.saveKeyPrefix || '';
      let linkCfg = null, timer = 0, destroyed = false, playing = false, speedPct = 0;
      const t0 = performance.now();

      core.settings.SKIPBoot = true;              // sin pantalla de arranque
      core.setIntervalRate(8);
      core.attachBIOS(bios);
      core.attachGraphicsFrameHandler(screen);
      core.attachAudioHandler(sound);
      core.attachSpeedHandler(pct => { speedPct = pct; opts.onSpeed?.(pct); });
      core.attachPlayStatusHandler(status => { playing = !!status; opts.onStatus?.(playing ? 'play' : 'pause'); });
      core.attachSaveExportHandler((name, data) => {
        const key = saveKeyPrefix + name;
        try { savePut(key, Array.from(data)); } catch {}
      });
      core.attachSaveImportHandler((name, ok, fail) => {
        saveGet(saveKeyPrefix + name).then(value => (value ? ok(value) : fail()), () => fail());
      });

      const loop = () => { if (!destroyed) core.timerCallback((performance.now() - t0) >>> 0); };
      const engine = {
        core, screen, sound,
        setSaveKey(prefix) { saveKeyPrefix = prefix || ''; },
        load(rom) { core.attachROM(rom instanceof Uint8Array ? rom : new Uint8Array(rom)); },
        start() {
          if (destroyed) return;
          sound.ensureContext(); sound.resume();
          core.play();
          if (!timer) timer = setInterval(loop, 8);
        },
        pause() { core.pause(); if (timer) { clearInterval(timer); timer = 0; } },
        resume() { if (!destroyed) engine.start(); },
        restart() { core.restart(); },
        isPlaying: () => playing,
        speed: () => speedPct,
        title: () => core.getGameName?.() || '',
        keyDown(k) { core.keyDown(k | 0); },
        keyUp(k) { core.keyUp(k | 0); },
        releaseAll() { for (let k = 0; k < 10; k++) core.keyUp(k); },
        setVolume(v) { sound.setVolume(v); },
        setMuted(m) { sound.setMuted(m); },
        setSmoothing(on) { canvas.style.imageRendering = on ? 'auto' : 'pixelated'; },
        setSpeed(mult) { core.setSpeed(mult); },
        frames: () => screen.frames,
        // — cable link (etapa 1): el intercambio de paquetes lo decide la capa de red —
        linkConnect(id, ready) { linkCfg = { id: id | 0, ready: ready !== false }; const s = core.IOCore?.serial; if (s) s.linkConnect(linkCfg.id, linkCfg.ready); },
        linkDisconnect() { linkCfg = null; core.IOCore?.serial?.linkDisconnect(); },
        linkOut() { const s = core.IOCore?.serial; if (!s || !linkCfg) return null; if (!s.link) s.linkConnect(linkCfg.id, linkCfg.ready); return s.linkOut(); },
        linkIn(packets) { const s = core.IOCore?.serial; if (!s || !linkCfg) return false; if (!s.link) s.linkConnect(linkCfg.id, linkCfg.ready); return s.linkIn(packets); },
        linkActive: () => !!linkCfg,
        async deleteSave() { /* usa la clave del juego actual */ const n = core.getGameName?.(); if (n) await saveDelete(saveKeyPrefix + n); },
        destroy() {
          destroyed = true;
          if (timer) clearInterval(timer);
          timer = 0;
          try { core.pause(); core.stop(); } catch {}
          screen.destroy(); sound.destroy();
        }
      };
      return engine;
    }
  };
  window.ArcadiaGBA = ArcadiaGBA;
})();
