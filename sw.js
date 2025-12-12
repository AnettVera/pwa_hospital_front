const STATIC_CACHE = 'static-v5';
const DYNAMIC_CACHE = 'dynamic-v2';

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
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap',
    'https://fonts.googleapis.com',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css'
];


importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyCXN0yk02hE5xHtHFQr3YOayME232YDHEE",
    authDomain: "storageintdb.firebaseapp.com",
    projectId: "storageintdb",
    storageBucket: "storageintdb.appspot.com",
    messagingSenderId: "436372321001",
    appId: "1:436372321001:web:ebb3b7935f3c119e25b678"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Notificación";
  const options = {
    body: payload.notification?.body || "",
    icon: "./img/192.png"
  };
  self.registration.showNotification(title, options);
});

// Manejar clics en la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});

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

