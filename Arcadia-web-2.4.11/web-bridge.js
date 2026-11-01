// A small browser adapter for the standalone Arcadia preview. Electron's preload bridge
// remains authoritative in the desktop app and provides the native file dialogs/launcher.
if (!window.arcadia) {
  const STORAGE_KEY = 'arcadia.web.library.v1';
  const romFiles = new Map();
  const memoryStates = new Map();
  function openArcadiaDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('arcadia-local', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('roms'); request.result.createObjectStore('states'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function storeLocal(store, key, value, read = false) {
    const db = await openArcadiaDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, read ? 'readonly' : 'readwrite');
      const request = read ? tx.objectStore(store).get(key) : tx.objectStore(store).put(value, key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }
  const MARIO_ART = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAwIDcyMCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJBdmVudHVyYSBkZSBwbGF0YWZvcm1hcyBkZSA4IGJpdHMiPgo8ZGVmcz4KIDxsaW5lYXJHcmFkaWVudCBpZD0ic2t5IiB4Mj0iMCIgeTI9IjEiPjxzdG9wIHN0b3AtY29sb3I9IiNmZjliNDIiLz48c3RvcCBvZmZzZXQ9Ii41OCIgc3RvcC1jb2xvcj0iI2YwNGMzOCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzhkMjU0ZiIvPjwvbGluZWFyR3JhZGllbnQ+CiA8bGluZWFyR3JhZGllbnQgaWQ9ImhpbGwiIHgyPSIwIiB5Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iIzQ2Yjk3OSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzE0NWQ1NyIvPjwvbGluZWFyR3JhZGllbnQ+CiA8cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNNDggMEgwVjQ4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS1vcGFjaXR5PSIuMDYiIHN0cm9rZS13aWR0aD0iMiIvPjwvcGF0dGVybj4KIDxmaWx0ZXIgaWQ9InNoYWRvdyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTIiLz48L2ZpbHRlcj4KPC9kZWZzPgo8cmVjdCB3aWR0aD0iMTIwMCIgaGVpZ2h0PSI3MjAiIGZpbGw9InVybCgjc2t5KSIvPjxyZWN0IHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjcyMCIgZmlsbD0idXJsKCNncmlkKSIvPgo8Y2lyY2xlIGN4PSI5MTAiIGN5PSIxNjAiIHI9Ijg4IiBmaWxsPSIjZmZlMTdjIiBvcGFjaXR5PSIuOCIvPgo8ZyBmaWxsPSIjZmZmMWQyIiBvcGFjaXR5PSIuNzQiPjxwYXRoIGQ9Ik0xNjAgMTQwaDk2djI0aC00OHYyNGgtOTZ2LTI0aDQ4eiIvPjxwYXRoIGQ9Ik02ODAgOTJoOTZ2MjRoLTQ4djI0aC05NnYtMjRoNDh6Ii8+PC9nPgo8cGF0aCBkPSJNMCA0ODUgMTYwIDM1NWw5NSA4MSAxNjUtMTgwIDE0NCAxNzAgMTE1LTExNSAxMzIgMTYwIDEzMy0xOTEgMTY3IDIwNCA5OS03NHYzMTBIMHoiIGZpbGw9IiM2ZDM2NWYiIG9wYWNpdHk9Ii42Ii8+CjxwYXRoIGQ9Ik0wIDUyMCAxMjYgNDIwbDEwNCA3MyAxMzgtMTQ5IDE0MCAxNDUgMTMxLTg2IDEyNiAxMTkgMTU4LTE0NCAxMTkgMTE2IDE1OC0xMDJ2MzA4SDB6IiBmaWxsPSJ1cmwoI2hpbGwpIi8+CjxwYXRoIGQ9Ik0wIDU5MGgxMjAwdjEzMEgweiIgZmlsbD0iIzJlYWE2NyIvPjxwYXRoIGQ9Ik0wIDYyNGgxMjAwdjk2SDB6IiBmaWxsPSIjM2FjODc4Ii8+CjxnIGZpbGw9IiNmNmM2NWYiPjxwYXRoIGQ9Ik0xMTggNTIwaDcydjcyaC03MnoiLz48cGF0aCBkPSJNMTkwIDUyMGg3MnY3MmgtNzJ6Ii8+PHBhdGggZD0iTTI2MiA1MjBoNzJ2NzJoLTcyeiIvPjwvZz4KPGcgZmlsbD0iIzllNGQzOCIgc3Ryb2tlPSIjMzgxYzM2IiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj4KIDwhLS0gcGl4ZWwgaGVybzogY2FwLCBmYWNlLCBtb3VzdGFjaGUsIGJsdWUgb3ZlcmFsbHMgLS0+CiA8cGF0aCBkPSJNNTAwIDI3NmgxODh2NDZoLTQ2djQ0SDUyMHYtNDRoLTIweiIgZmlsbD0iI2U5MzYzNiIvPgogPHBhdGggZD0iTTUyOCAzNjZoMTQydjEyMEg1Mjh6IiBmaWxsPSIjZjRiMzZkIi8+CiA8cGF0aCBkPSJNNTE4IDM5MmgzMHYyNGgtMzB6bTEzNCAwaDMwdjI0aC0zMHoiIGZpbGw9IiMzODIyMmIiIHN0cm9rZT0ibm9uZSIvPgogPHBhdGggZD0iTTU0MCA0NDhoNTJ2MjVoLTUyem01Mi0yM2g0MnYyNmgtNDJ6bTQyIDIzaDQzdjI1aC00M3oiIGZpbGw9IiM0NTI1MzgiIHN0cm9rZT0ibm9uZSIvPgogPHBhdGggZD0iTTQ4OCA0ODZoMjA2djEzMkg0ODh6IiBmaWxsPSIjMjQ2N2JkIi8+CiA8cGF0aCBkPSJNNTE0IDQ4Nmg0MnY1MmgtNDJ6bTExNiAwaDQydjUyaC00MnoiIGZpbGw9IiNmMmM0NWEiLz4KIDxwYXRoIGQ9Ik00NjggNjEwaDEwNXY0Nkg0Njh6bTE0MSAwaDEwNnY0Nkg2MDl6IiBmaWxsPSIjNTYzYzM3Ii8+CjwvZz4KPGcgZmlsbD0iI2ZmZTI3NSI+PHBhdGggZD0iTTM1MCAyODJoMzB2NzJoLTMweiIvPjxwYXRoIGQ9Ik0zNjUgMjY3aDMwdjMwaC0zMHoiLz48cGF0aCBkPSJNODEyIDMxOGgzMHY3MmgtMzB6Ii8+PHBhdGggZD0iTTc5NyAzMDNoMzB2MzBoLTMweiIvPjxwYXRoIGQ9Ik0xMDEwIDQyMGgyNnY2MmgtMjZ6Ii8+PC9nPgo8cmVjdCB4PSIzMiIgeT0iMzIiIHdpZHRoPSIxMTM2IiBoZWlnaHQ9IjY1NiIgcng9IjI4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS1vcGFjaXR5PSIuNDIiIHN0cm9rZS13aWR0aD0iMyIvPgo8dGV4dCB4PSI3NCIgeT0iMTA2IiBmaWxsPSIjZmZmIiBmb250LWZhbWlseT0iQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgbGV0dGVyLXNwYWNpbmc9IjUiPkFSQ0FESUEgwrcgQ0zDgVNJQ09TIDgtQklUPC90ZXh0Pgo8dGV4dCB4PSI3NCIgeT0iNjUwIiBmaWxsPSIjZmZmIiBmb250LWZhbWlseT0iQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIzOCIgZm9udC13ZWlnaHQ9IjgwMCIgbGV0dGVyLXNwYWNpbmc9IjIiPkFWRU5UVVJBIERFIFBMQVRBRk9STUFTPC90ZXh0Pgo8L3N2Zz4NCg==';
  let memoryCatalog = null;
  const webPath = file => `webfile://${String(file?.name || 'archivo').replace(/[\\/]/g, '_')}`;
  const askForFile = (kind) => new Promise(resolve => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = kind === 'cover'
      ? 'image/png,image/jpeg,image/webp,image/bmp'
      : kind === 'emulator' ? '.exe' : '.exe,.lnk,.iso,.cso,.bin,.cue,.chd,.rom,.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.zip,.7z';
    picker.hidden = true;
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return resolve(null);
      if (kind !== 'cover') {
        if (kind === 'game' && /\.nes$/i.test(file.name)) {
          const id = `rom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          romFiles.set(id, file);
          try { await storeLocal('roms', id, file); } catch {}
          return resolve(`webfile://${id}#${encodeURIComponent(file.name)}`);
        }
        return resolve(webPath(file));
      }
      try {
        const image = new Image();
        const source = await new Promise((done, fail) => {
          const reader = new FileReader();
          reader.onload = () => done(reader.result);
          reader.onerror = fail;
          reader.readAsDataURL(file);
        });
        image.src = source;
        await new Promise((done, fail) => { image.onload = done; image.onerror = fail; });
        const scale = Math.min(1, 1200 / image.width, 1200 / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(`${canvas.toDataURL('image/jpeg', 0.84)}#${encodeURIComponent(file.name)}`);
      } catch { resolve(null); }
    }, { once: true });
    document.body.append(picker);
    picker.click();
  });

  window.arcadia = {
    isWeb: true,
    async readCatalog() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { games: [], settings: { performance: 'low', emulators: {} } }; }
      catch { return memoryCatalog || { games: [], settings: { performance: 'low', emulators: {} } }; }
    },
    async writeCatalog(catalog) {
      memoryCatalog = catalog;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog)); } catch { /* Keep the preview usable for this tab session. */ }
      return true;
    },
    pickFile: askForFile,
    async readRom(fileRef) {
      const id = String(fileRef || '').replace(/^webfile:\/\//i, '').split('#', 1)[0];
      let file = romFiles.get(id);
      if (!file) file = await storeLocal('roms', id, null, true);
      if (!file) throw new Error('No se encontró la ROM guardada en este navegador. Vuelve a seleccionarla.');
      return new Uint8Array(await file.arrayBuffer());
    },
    async writeSaveState(gameId, state, slot = 1) {
      const safeSlot = Math.min(5, Math.max(1, Number(slot) || 1));
      const key = `state:${gameId}:slot:${safeSlot}`;
      memoryStates.set(key, state);
      try { await storeLocal('states', key, state); }
      catch { try { localStorage.setItem(`arcadia.state.${gameId}.slot.${safeSlot}`, JSON.stringify(state)); } catch {} }
      return true;
    },
    async readSaveState(gameId, slot = 1) {
      const safeSlot = Math.min(5, Math.max(1, Number(slot) || 1));
      const key = `state:${gameId}:slot:${safeSlot}`;
      try { const state = await storeLocal('states', key, null, true); if (state) return state; } catch {}
      try {
        const stored = JSON.parse(localStorage.getItem(`arcadia.state.${gameId}.slot.${safeSlot}`));
        if (stored) return stored;
      } catch {}
      if (memoryStates.has(key)) return memoryStates.get(key);
      // Migrate older Arcadia builds' single save into slot 1 without deleting it.
      if (safeSlot === 1) {
        try { const legacy = await storeLocal('states', `state:${gameId}`, null, true); if (legacy) return legacy; } catch {}
        try { return JSON.parse(localStorage.getItem(`arcadia.state.${gameId}`)) || null; } catch {}
      }
      return null;
    },
    fileUrl: file => {
      const value = String(file || '');
      if (value === 'arcadia://art/super-mario-bros.svg') return MARIO_ART;
      const bundledArt = value.match(/^arcadia:\/\/art\/([a-z0-9._-]+)$/i);
      if (bundledArt) return `./art/${bundledArt[1]}`;
      return /^(?:https?:|data:|webfile:)/i.test(value) ? value.replace(/#.*$/, '') : '';
    },
    fileName: file => {
      const value = String(file || '');
      const romId = value.replace(/^webfile:\/\//i, '').split('#', 1)[0];
      if (romFiles.has(romId)) return romFiles.get(romId).name;
      const hashName = value.match(/#([^#]+)$/)?.[1];
      if (hashName) { try { return decodeURIComponent(hashName); } catch {} }
      if (value.includes('#')) { try { return decodeURIComponent(value.slice(value.indexOf('#') + 1)); } catch { return value.slice(value.indexOf('#') + 1); } }
      return value.replace(/^webfile:\/\//i, '').split(/[\\/]/).pop();
    },
    async findCover() { return null; },
    async launch() { return { ok: false, message: 'La vista web permite organizar la biblioteca, pero no puede abrir emuladores ni juegos instalados. Usa Arcadia para Windows para jugar.' }; },
    resizeGameView() {},
    async stopGame() { return { ok: true }; },
    onGameEnded() {},
    async openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); return { ok: true }; }
  };
  if (location.protocol === 'https:' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Arcadia: no se pudo activar el modo instalable.', error));
  }
}


