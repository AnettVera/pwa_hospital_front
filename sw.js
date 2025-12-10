const STATIC_CACHE = 'static-v2';
const DYNAMIC_CACHE = 'dynamic-v1';

const APP_SHELL = [
    './',
    './index.html',
    './img/logo.jpeg',
    './css/styles.css',
    './css/patient.css',
    './css/bootstrap.min.css',
    './alerts/toast.css',
    './alerts/toastConfig.js',
    './js/bootstrap.min.js',
    './js/bootstrap.bundle.min.js',
    './js/app.js',
    './js/config.js',
    './js/jsQR.js',
    './js/pouchdb-9.0.0.min.js',
    './js/qrcode.js',
    './js/admin/adminDashboard.js',
    './js/admin/admintk.js',
    './js/admin/beds.js',
    './js/admin/nurse.js',
    './js/admin/patient.js',
    './js/admin/rooms.js',
    './js/logAuth/auth.js',
    './js/login/login.js',
    './js/nurse/nurse.js',
    './js/patient/patient.js',
    './modules/admin/dashboard.html',
    './modules/admin/patient.html',
    './modules/admin/nurse.html',
    './modules/admin/assignments.html',
    './modules/admin/rooms.html',
    './modules/admin/beds.html',
    './modules/auth/login.html',
    './modules/patient/patient.html',
    './modules/nurse/nurse-content.html',
];

self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');
    event.waitUntil(
        (async () => {
            const cache = await caches.open(STATIC_CACHE);
            const results = await Promise.allSettled(
                APP_SHELL.map((url) => cache.add(url))
            );
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length) {
                console.warn(`[SW] ${failed.length} recursos no se pudieron precachear:`, failed.map(r => r.reason.url || r.reason));
            } else {
                console.log('[SW] Pre-caching completo y exitoso.');
            }
            self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activando Service Worker y limpiando cachés antiguas...');
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
                    .map((key) => {
                        console.log(`[SW] Eliminando caché antigua: ${key}`);
                        return caches.delete(key);
                    })
            )
        ).then(() => {
            self.clients.claim();
            console.log('[SW] Control de clientes reclamado con éxito.');
        })
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; 

    if (request.url.startsWith('chrome-extension://')) return;

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }

            return fetch(request)
                .then((response) => {
                    const respClone = response.clone();
                    
                    if (request.url.startsWith(self.location.origin) && response.ok) {
                         caches.open(DYNAMIC_CACHE).then((cache) => {
                             cache.put(request, respClone);
                         });
                    }

                    return response;
                })
                .catch(() => {                    
                    const isHtmlRequest = request.destination === 'document' || request.url.includes('.html');
                    
                    if (isHtmlRequest) {
                        return caches.match('./index.html');
                    }
                    
                    console.error('[SW] Fallo de red para recurso no cacheado:', request.url);
                    return new Response(null, { status: 503, statusText: 'Service Unavailable (Offline)' });
                });
        })
    );
});