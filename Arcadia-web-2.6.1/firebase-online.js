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
    apiKey: 'AIzaSyAEKuo_qJ2k6cA14rMDuzIBV74iVghyVuQ',
    authDomain: 'arcadia-web-51df8.firebaseapp.com',
    databaseURL: 'https://arcadia-web-51df8-default-rtdb.firebaseio.com',
    projectId: 'arcadia-web-51df8',
    storageBucket: 'arcadia-web-51df8.firebasestorage.app',
    messagingSenderId: '547834358470',
    appId: '1:547834358470:web:338bcaccb6f515acb345c7',
    measurementId: 'G-5VVV7DNL23'
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
