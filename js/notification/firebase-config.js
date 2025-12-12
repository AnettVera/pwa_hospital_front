import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// Configuración
const firebaseConfig = typeof FIREBASE_CONFIG !== 'undefined' ? FIREBASE_CONFIG : {
    apiKey: "AIzaSyCXN0yk02hE5xHtHFQr3YOayME232YDHEE",
    authDomain: "storageintdb.firebaseapp.com",
    projectId: "storageintdb",
    storageBucket: "storageintdb.appspot.com",
    messagingSenderId: "436372321001",
    appId: "1:436372321001:web:ebb3b7935f3c119e25b678"
};

const VAPID_KEY_LOCAL = typeof VAPID_KEY !== 'undefined' ? VAPID_KEY : "BNWuae2n3wIYLWUenHZ3X5c72buK4pmCcRM0xQXOXtMJxL0mqRtRSxUj2P0xXby_NmhC1pale3awnPIg4VeN4Cs";
const API_BASE = typeof CONFIG !== 'undefined' ? CONFIG.API_URL : "https://hospitalzapata.duckdns.org:8081/api";

let app = null;
let messaging = null;
let swReg = null;

/**
 * Detecta la ruta correcta del Service Worker según el entorno
 */
function getServiceWorkerPath() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    if (hostname.includes('github.io')) {
        const repoMatch = pathname.match(/^\/([^\/]+)/);
        const repoName = repoMatch ? repoMatch[1] : '';
        return `/${repoName}/sw.js`;
    }
    
    return '/sw.js';
}

/**
 * Inicializa Firebase y registra el Service Worker
 */
async function initializeFirebase() {
    try {
        // Inicializar Firebase
        app = initializeApp(firebaseConfig);
        console.log('✅ Firebase inicializado');

        // Registrar Service Worker
        if ('serviceWorker' in navigator) {
            const swPath = getServiceWorkerPath();
            console.log('📝 Registrando Service Worker en:', swPath);
            
            try {
                swReg = await navigator.serviceWorker.register(swPath);
                console.log('✅ Service Worker registrado:', swReg.scope);
            } catch (swError) {
                console.error('❌ Error al registrar Service Worker:', swError);
                console.log('🔄 Intentando con ruta alternativa: ./sw.js');
                
                try {
                    swReg = await navigator.serviceWorker.register('./sw.js');
                    console.log('✅ Service Worker registrado (ruta relativa):', swReg.scope);
                } catch (altError) {
                    console.error('❌ Service Worker no se pudo registrar en ninguna ruta');
                    return false;
                }
            }
        } else {
            console.warn('⚠️ Service Worker no disponible en este navegador');
            return false;
        }

        // Verificar soporte de FCM
        const supported = await isSupported();
        
        if (supported) {
            messaging = getMessaging(app);
            console.log('✅ FCM soportado y messaging inicializado');
            return true;
        } else {
            console.warn('⚠️ FCM no soportado en este navegador');
            return false;
        }
    } catch (error) {
        console.error('❌ Error inicializando Firebase:', error);
        return false;
    }
}

/**
 * Solicita permiso de notificaciones y obtiene el token FCM
 */
async function requestNotificationPermissionAndGetToken() {
    try {
        if (!messaging) {
            console.error('❌ Messaging no está inicializado');
            return null;
        }

        const permission = await Notification.requestPermission();
        console.log('🔔 Permiso de notificaciones:', permission);

        if (permission !== 'granted') {
            console.warn('⚠️ Permiso de notificaciones denegado');
            return null;
        }

        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY_LOCAL,
            serviceWorkerRegistration: swReg,
        });

        if (token) {
            console.log('✅ Token FCM obtenido');
            return token;
        } else {
            console.warn('⚠️ No se pudo obtener el token FCM');
            return null;
        }
    } catch (error) {
        console.error('❌ Error obteniendo token:', error);
        return null;
    }
}

/**
 * Suscribe el token FCM al backend
 */
async function subscribeToNurseNotifications(token) {
    try {
        const authToken = localStorage.getItem('token');
        
        if (!authToken) {
            console.error('❌ No hay token de autenticación');
            return false;
        }

        const response = await fetch(`${API_BASE}/notifications/subscribe-notifications`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ token })
        });

        if (response.ok) {
            console.log('✅ Suscrito a notificaciones del enfermero');
            return true;
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('❌ Error al suscribirse:', errorData);
            return false;
        }
    } catch (error) {
        console.error('❌ Error en subscribeToNurseNotifications:', error);
        return false;
    }
}

/**
 * Configura el listener para notificaciones en primer plano
 * ⚠️ DEBE llamarse SOLO después de initializeFirebase()
 */
function setupForegroundNotificationListener(callback) {
    if (!messaging) {
        console.error('❌ ERROR CRÍTICO: setupForegroundNotificationListener llamado antes de initializeFirebase()');
        console.error('❌ Messaging no está inicializado. El listener NO se configurará.');
        return false;
    }

    try {
        onMessage(messaging, (payload) => {
            console.log('🔔 Notificación recibida en primer plano:', payload);

            const title = payload.notification?.title || 'Nueva notificación';
            const body = payload.notification?.body || '';

            if (Notification.permission === 'granted') {
                new Notification(title, {
                    body,
                    icon: '/img/192.png',
                    badge: '/img/192.png',
                    tag: 'noti',
                    requireInteraction: true
                });
            }

            if (callback && typeof callback === 'function') {
                callback(payload);
            }
        });

        console.log('✅ Listener de notificaciones configurado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error al configurar listener:', error);
        return false;
    }
}

/**
 * Inicializa completamente el sistema de notificaciones
 * ✅ Esta es la ÚNICA función que debe llamarse desde fuera
 */
async function initializeNurseNotifications(onNotificationCallback) {
    try {
        console.log('🚀 Inicializando sistema de notificaciones...');

        // 1. Inicializar Firebase
        const initialized = await initializeFirebase();
        if (!initialized) {
            console.error('❌ No se pudo inicializar Firebase');
            return false;
        }

        // 2. Verificar que messaging esté listo
        if (!messaging) {
            console.error('❌ Messaging no disponible después de inicializar Firebase');
            return false;
        }

        // 3. Verificar si ya tiene token guardado
        let fcmToken = localStorage.getItem('fcm_token');

        if (!fcmToken) {
            // 4. Solicitar permiso y obtener token
            fcmToken = await requestNotificationPermissionAndGetToken();
            
            if (!fcmToken) {
                console.error('❌ No se pudo obtener token FCM');
                return false;
            }

            localStorage.setItem('fcm_token', fcmToken);
        } else {
            console.log('✅ Token FCM recuperado de localStorage');
        }

        // 5. Suscribir al topic del enfermero
        const subscribed = await subscribeToNurseNotifications(fcmToken);
        
        if (!subscribed) {
            console.warn('⚠️ No se pudo suscribir a notificaciones (pero continuamos)');
        }

        // 6. Configurar listener (DESPUÉS de que todo esté listo)
        const listenerConfigured = setupForegroundNotificationListener(onNotificationCallback);
        
        if (!listenerConfigured) {
            console.error('❌ No se pudo configurar el listener de notificaciones');
            return false;
        }

        console.log('✅✅✅ Sistema de notificaciones inicializado completamente');
        return true;

    } catch (error) {
        console.error('❌ Error en initializeNurseNotifications:', error);
        return false;
    }
}

/**
 * Verifica si las notificaciones están habilitadas
 */
function areNotificationsEnabled() {
    return Notification.permission === 'granted' && !!localStorage.getItem('fcm_token');
}

/**
 * Limpia el token FCM (útil para logout)
 */
function clearFCMToken() {
    localStorage.removeItem('fcm_token');
    console.log('🗑️ Token FCM eliminado');
}

// Exportar funciones
export {
    initializeFirebase,
    requestNotificationPermissionAndGetToken,
    subscribeToNurseNotifications,
    setupForegroundNotificationListener,
    initializeNurseNotifications,
    areNotificationsEnabled,
    clearFCMToken
};