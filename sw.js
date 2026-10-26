/* Entschlüsselt die Vorschau im Browser.
   Alle Seiten, Bilder und Daten liegen nur verschlüsselt in den Ordnern teil1/ und teil2/.
   Nach Eingabe des Passworts liegt der Schlüssel im Browser (IndexedDB);
   dieser Service Worker fängt jede Anfrage ab, lädt die verschlüsselte
   Datei, entschlüsselt sie (AES-256-GCM) und liefert sie aus. */

const DB = 'stadtvilla-vorschau', STORE = 'schluessel';
const SCOPE = new URL(self.registration.scope).pathname;
const OFFEN = new Set(['sw.js', 'schluessel.json', 'robots.txt', '404.html']);
const TYPEN = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', woff2: 'font/woff2'
};
let schluessel = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => { if (e.data === 'neu-laden') schluessel = null; });

function db() {
  return new Promise((ok, fehler) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fehler(r.error);
  });
}
async function holeSchluessel() {
  if (schluessel) return schluessel;
  try {
    const d = await db();
    schluessel = await new Promise(ok => {
      const r = d.transaction(STORE).objectStore(STORE).get('key');
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ok(null);
    });
  } catch (e) { schluessel = null; }
  return schluessel;
}
async function dateiname(pfad) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pfad));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET' || !url.pathname.startsWith(SCOPE)) return;
  let pfad = decodeURIComponent(url.pathname.slice(SCOPE.length));
  if (pfad === '' || pfad.endsWith('/')) pfad += 'index.html';
  if (OFFEN.has(pfad) || pfad.startsWith('teil1/') || pfad.startsWith('teil2/')) return;
  e.respondWith(ausliefern(pfad, e.request));
});

async function ausliefern(pfad, anfrage) {
  const key = await holeSchluessel();
  if (!key) return fetch(anfrage);                        // noch kein Passwort → Passwortseite
  const name = await dateiname(pfad);
  const ordner = '01234567'.includes(name[0]) ? 'teil1' : 'teil2';
  const antwort = await fetch(SCOPE + ordner + '/' + name + '.bin', { cache: 'no-cache' });
  if (!antwort.ok) {
    return anfrage.mode === 'navigate' ? fetch(SCOPE + '404.html') : new Response('', { status: 404 });
  }
  const daten = await antwort.arrayBuffer();
  try {
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: daten.slice(0, 12) }, key, daten.slice(12));
    const endung = pfad.split('.').pop().toLowerCase();
    return new Response(klar, { headers: { 'Content-Type': TYPEN[endung] || 'application/octet-stream' } });
  } catch (err) {
    schluessel = null;                                    // Schlüssel passt nicht (z. B. neues Passwort)
    return anfrage.mode === 'navigate' ? fetch(SCOPE + 'index.html', { cache: 'no-cache' }) : new Response('', { status: 403 });
  }
}
