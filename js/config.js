/**
 * Configuración global del proyecto - Compatible con Docker
 * 
 * Las variables se pueden sobrescribir en runtime mediante:
 * 1. Archivo env-config.js generado por Docker
 * 2. Variables window.__ENV__ inyectadas en el HTML
 */

// Configuración por defecto (desarrollo local)
const DEFAULT_CONFIG = {
    API_URL: "https://hospitalzapata.duckdns.org:8081/api",
    APP_NAME: "Sistema de Hospital",
    
    // Firebase Config
    FIREBASE_API_KEY: "AIzaSyCXN0yk02hE5xHtHFQr3YOayME232YDHEE",
    FIREBASE_AUTH_DOMAIN: "storageintdb.firebaseapp.com",
    FIREBASE_PROJECT_ID: "storageintdb",
    FIREBASE_STORAGE_BUCKET: "storageintdb.appspot.com",
    FIREBASE_MESSAGING_SENDER_ID: "436372321001",
    FIREBASE_APP_ID: "1:436372321001:web:ebb3b7935f3c119e25b678",
    FIREBASE_VAPID_KEY: "BNWuae2n3wIYLWUenHZ3X5c72buK4pmCcRM0xQXOXtMJxL0mqRtRSxUj2P0xXby_NmhC1pale3awnPIg4VeN4Cs"
};

// Merge con variables de entorno de Docker (si existen)
const ENV_CONFIG = window.__ENV__ || {};

const CONFIG = {
    ...DEFAULT_CONFIG,
    ...ENV_CONFIG
};

// URLs derivadas del API base (para facilitar el uso)
const API_ENDPOINTS = {
    AUTH: `${CONFIG.API_URL}/auth`,
    PATIENTS: `${CONFIG.API_URL}/patients`,
    NURSES: `${CONFIG.API_URL}/nurses`,
    BEDS: `${CONFIG.API_URL}/beds`,
    ROOMS: `${CONFIG.API_URL}/rooms`,
    ISLANDS: `${CONFIG.API_URL}/islands`,
    ADMISSIONS: `${CONFIG.API_URL}/admissions`,
    HELP: `${CONFIG.API_URL}/help`,
    NOTIFICATIONS: `${CONFIG.API_URL}/notifications`
};

// Configuración de Firebase lista para usar
const FIREBASE_CONFIG = {
    apiKey: CONFIG.FIREBASE_API_KEY,
    authDomain: CONFIG.FIREBASE_AUTH_DOMAIN,
    projectId: CONFIG.FIREBASE_PROJECT_ID,
    storageBucket: CONFIG.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: CONFIG.FIREBASE_MESSAGING_SENDER_ID,
    appId: CONFIG.FIREBASE_APP_ID
};

const VAPID_KEY = CONFIG.FIREBASE_VAPID_KEY;

// Exportar para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, API_ENDPOINTS, FIREBASE_CONFIG, VAPID_KEY };
}

