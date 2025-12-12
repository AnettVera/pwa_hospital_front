import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// Usa configuración centralizada desde config.js (cargado antes en HTML)
const firebaseConfigLocal = typeof FIREBASE_CONFIG !== 'undefined' ? FIREBASE_CONFIG : {
    apiKey: "AIzaSyCXN0yk02hE5xHtHFQr3YOayME232YDHEE",
    authDomain: "storageintdb.firebaseapp.com",
    projectId: "storageintdb",
    storageBucket: "storageintdb.appspot.com",
    messagingSenderId: "436372321001",
    appId: "1:436372321001:web:ebb3b7935f3c119e25b678"
};

// Clave pública VAPID (desde config.js o valor por defecto)
const VAPID_KEY_ADMIN = typeof VAPID_KEY !== 'undefined' ? VAPID_KEY : "BNWuae2n3wIYLWUenHZ3X5c72buK4pmCcRM0xQXOXtMJxL0mqRtRSxUj2P0xXby_NmhC1pale3awnPIg4VeN4Cs";

// API Base desde config.js
const API_BASE = typeof CONFIG !== 'undefined' ? CONFIG.API_URL : "https://hospitalzapata.duckdns.org:8081/api";

let app = null;
let messaging = null;
let swReg = null;

/**
 * Detecta la ruta correcta del Service Worker según el entorno
 */
function getServiceWorkerPath() {
    // Si estás en GitHub Pages, necesitas incluir el nombre del repositorio
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    // Detectar GitHub Pages
    if (hostname.includes('github.io')) {
        // Extraer el nombre del repo desde la URL
        // Ejemplo: https://usuario.github.io/repo-name/ -> /repo-name/
        const repoMatch = pathname.match(/^\/([^\/]+)/);
        const repoName = repoMatch ? repoMatch[1] : '';
        return `/${repoName}/sw.js`;
    }
    
    // Para otros entornos (localhost, dominio propio)
    return '/sw.js';
}

/**
 * Inicializa Firebase y registra el Service Worker
 */
async function initializeFirebase() {
    try {
        // Inicializar Firebase solo si no está ya inicializado
        if (!app) {
            app = initializeApp(firebaseConfigLocal);
            console.log('Firebase inicializado');
        }

        // Registrar Service Worker con ruta dinámica
        if ('serviceWorker' in navigator && !swReg) {
            const swPath = getServiceWorkerPath();
            console.log('Intentando registrar Service Worker en:', swPath);
            
            try {
                swReg = await navigator.serviceWorker.register(swPath);
                console.log('Service Worker registrado:', swReg.scope);
            } catch (swError) {
                console.error('Error al registrar Service Worker:', swError);
                console.log('Intentando con ruta alternativa: ./sw.js');
                
                // Intento alternativo con ruta relativa
                try {
                    swReg = await navigator.serviceWorker.register('./sw.js');
                    console.log('Service Worker registrado (ruta relativa):', swReg.scope);
                } catch (altError) {
                    console.error('Service Worker no se pudo registrar en ninguna ruta');
                    return false;
                }
            }
        } else if (swReg) {
            console.log('Service Worker ya estaba registrado');
        } else {
            console.warn('Service Worker no disponible en este navegador');
            return false;
        }

        // Verificar soporte de FCM
        const supported = await isSupported();
        
        if (supported) {
            // Solo inicializar messaging si no existe
            if (!messaging) {
                messaging = getMessaging(app);
                console.log('FCM inicializado');
            }
            return true;
        } else {
            console.warn('FCM no soportado en este navegador');
            return false;
        }
    } catch (error) {
        console.error('Error inicializando Firebase:', error);
        return false;
    }
}

/**
 * Solicita permiso de notificaciones y obtiene el token FCM
 * @returns {Promise<string|null>} Token FCM o null si falla
 */
async function requestNotificationPermissionAndGetToken() {
    try {
        // Verificar si Firebase está inicializado
        if (!messaging) {
            const initialized = await initializeFirebase();
            if (!initialized) {
                throw new Error('Firebase no se pudo inicializar');
            }
        }

        // Solicitar permiso
        const permission = await Notification.requestPermission();
        console.log('Permiso de notificaciones:', permission);

        if (permission !== 'granted') {
            console.warn('Permiso de notificaciones denegado');
            return null;
        }

        // Obtener token FCM
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY_ADMIN,
            serviceWorkerRegistration: swReg,
        });

        if (token) {
            console.log('Token FCM obtenido');
            return token;
        } else {
            console.warn('No se pudo obtener el token FCM');
            return null;
        }
    } catch (error) {
        console.error('Error obteniendo token:', error);
        return null;
    }
}

/**
 * Suscribe el token FCM al backend (topic del admin)
 * @param {string} token - Token FCM del dispositivo
 * @returns {Promise<boolean>} True si se suscribió correctamente
 */
async function subscribeToAdminNotifications(token) {
    try {
        const authToken = localStorage.getItem('token');
        
        if (!authToken) {
            console.error('No hay token de autenticación');
            return false;
        }

        const response = await fetch(`${API_BASE}/notifications/subscribe-admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ token })
        });

        if (response.ok) {
            console.log('Suscrito a notificaciones del administrador');
            return true;
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('Error al suscribirse:', errorData);
            return false;
        }
    } catch (error) {
        console.error('Error en subscribeToAdminNotifications:', error);
        return false;
    }
}

/**
 * Configura el listener para notificaciones en primer plano
 * @param {Function} callback - Función que se ejecuta al recibir notificación
 */
function setupForegroundNotificationListener(callback) {
    if (!messaging) {
        console.error('ERROR: Messaging no inicializado. No se puede configurar el listener.');
        return false;
    }

    onMessage(messaging, (payload) => {
        console.log('Notificación recibida en primer plano:', payload);
        
        const notificationTitle = payload.notification?.title || 'Nueva notificación';
        const notificationBody = payload.notification?.body || '';

        // Mostrar notificación del navegador
        if (Notification.permission === 'granted') {
            new Notification(notificationTitle, {
                body: notificationBody,
                icon: '/img/192.png',
                badge: '/img/192.png',
                tag: 'admin-notification',
                requireInteraction: true
            });
        }

        // Ejecutar callback personalizado
        if (callback && typeof callback === 'function') {
            callback(payload);
        }
    });

    console.log('Listener de notificaciones configurado');
    return true;
}

/**
 * Inicializa completamente el sistema de notificaciones para el administrador
 * @param {Function} onNotificationCallback - Callback al recibir notificación
 * @returns {Promise<boolean>} True si se inicializó correctamente
 */
async function initializeAdminNotifications(onNotificationCallback) {
    try {
        console.log('Inicializando sistema de notificaciones...');

        // 1. Inicializar Firebase
        const initialized = await initializeFirebase();
        if (!initialized) {
            console.error('No se pudo inicializar Firebase');
            return false;
        }

        // 2. Verificar si ya tiene token guardado
        let fcmToken = localStorage.getItem('fcm_token_admin');
        
        if (!fcmToken) {
            // 3. Solicitar permiso y obtener token
            fcmToken = await requestNotificationPermissionAndGetToken();
            
            if (!fcmToken) {
                console.error('No se pudo obtener token FCM');
                return false;
            }

            // Guardar token en localStorage
            localStorage.setItem('fcm_token_admin', fcmToken);
        } else {
            console.log('Token FCM recuperado de localStorage');
            
            // IMPORTANTE: Verificar que messaging esté inicializado incluso si hay token
            if (!messaging) {
                console.log('Messaging no estaba inicializado, re-inicializando...');
                const reinitialized = await requestNotificationPermissionAndGetToken();
                if (!reinitialized) {
                    console.error('No se pudo re-inicializar messaging');
                    return false;
                }
            }
        }

        // 4. Suscribir al topic del administrador
        const subscribed = await subscribeToAdminNotifications(fcmToken);
        
        if (!subscribed) {
            console.warn('No se pudo suscribir a notificaciones');
            // No retornamos false porque el token existe y puede funcionar
        }

        // 5. Configurar listener de notificaciones
        const listenerConfigured = setupForegroundNotificationListener(onNotificationCallback);
        
        if (!listenerConfigured) {
            console.error('No se pudo configurar el listener de notificaciones');
            return false;
        }

        console.log('Sistema de notificaciones inicializado completamente');
        return true;
    } catch (error) {
        console.error('Error en initializeAdminNotifications:', error);
        return false;
    }
}

/**
 * Verifica si las notificaciones están habilitadas
 * @returns {boolean}
 */
function areNotificationsEnabled() {
    return Notification.permission === 'granted' && !!localStorage.getItem('fcm_token_admin');
}

/**
 * Limpia el token FCM (útil para logout)
 */
function clearFCMToken() {
    localStorage.removeItem('fcm_token_admin');
    console.log('Token FCM eliminado');
}

// Exportar funciones
export {
    initializeFirebase,
    requestNotificationPermissionAndGetToken,
    subscribeToAdminNotifications,
    setupForegroundNotificationListener,
    initializeAdminNotifications,
    areNotificationsEnabled,
    clearFCMToken
};