/* Arcadia Online 0.3.9 — Firebase bootstrap.
 * Firebase Web API keys identify the project; database access must still be protected by RTDB rules.
 * This initializes anonymous auth + Realtime Database. It does not send ROM/input state until the
 * deterministic multiplayer protocol is implemented in the emulator layer.
 */
(() => {
  'use strict';
  const status = (text, ok = false) => {
    window.ARCADIA_FIREBASE_STATUS = { text, ok, at: Date.now() };
    document.dispatchEvent(new CustomEvent('arcadia:firebase-status', { detail: window.ARCADIA_FIREBASE_STATUS }));
    console.info('[Arcadia Firebase]', text);
  };
  const config = {
    apiKey: 'AIzaSyANmRBAWZnNr28rR_oIrnP6L4iD7q5pxZ4',
    authDomain: 'arcadia-online-57be4.firebaseapp.com',
    databaseURL: 'https://arcadia-online-57be4-default-rtdb.firebaseio.com',
    projectId: 'arcadia-online-57be4',
    storageBucket: 'arcadia-online-57be4.firebasestorage.app',
    messagingSenderId: '409548940790',
    appId: '1:409548940790:web:da9ebe1a646e64949313d7',
    measurementId: 'G-BTLMYEN3DE'
  };
  window.ARCADIA_FIREBASE_CONFIG = config;
  window.ARCADIA_FIREBASE_READY = (async () => {
    try {
      if (!window.firebase?.initializeApp) throw new Error('No se pudo cargar el SDK de Firebase. Revisa la conexión a internet.');
      const app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(config);
      const auth = firebase.auth();
      if (!auth.currentUser) await auth.signInAnonymously();
      const db = firebase.database();
      // Keep a small connectivity listener; this does not open database permissions.
      db.ref('.info/connected').on('value', snap => status(snap.val() ? 'Firebase conectado' : 'Firebase desconectado', !!snap.val()));
      window.ARCADIA_FIREBASE = { app, auth, db, config };
      status('Autenticación anónima lista; esperando conexión con Realtime Database', true);
      return window.ARCADIA_FIREBASE;
    } catch (error) {
      status(error?.message || 'No se pudo iniciar Firebase', false);
      throw error;
    }
  })();
  window.ARCADIA_FIREBASE_READY.catch(() => {});
})();
