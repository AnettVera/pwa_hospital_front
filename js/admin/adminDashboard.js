document.addEventListener("DOMContentLoaded", async () => {
    const role = localStorage.getItem("role");

    if (role !== "ADMIN") {
        alert("Acceso denegado");
        localStorage.clear();
        window.location.href = "/modules/auth/login.html";
    }
    loadDashboardData();
    
    // Inicializar notificaciones Firebase para admin
    await initializeNotifications();
});


if (!localStorage.getItem("token")) {
    window.location.href = "../../modules/auth/login.html";
}
// Usa configuración centralizada desde config.js
const API_BASE_URL = CONFIG.API_URL;

async function makeAuthenticatedRequest(endpoint, options = {}) {
    const token = localStorage.getItem("token");
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            localStorage.clear();
            window.location.href = "/modules/auth/login.html";
            return null;
        }

        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error en la solicitud:", error);
        return null;
    }
}
async function loadDashboardData() {
    try {
        const [nursesData, bedsData, patientsData, roomsData, alertsData] = await Promise.all([
            makeAuthenticatedRequest("/nurses"),
            makeAuthenticatedRequest("/beds/status"),
            makeAuthenticatedRequest("/patients"),
            makeAuthenticatedRequest("/rooms"),
            makeAuthenticatedRequest("/help/pending")
        ]);
        updateMetrics(bedsData, patientsData, nursesData, alertsData);

        if (roomsData) {
            updateRoomsStatus(roomsData, bedsData);
            console.log(bedsData);
        }
    } catch (error) {
        console.error("Error cargando datos del dashboard:", error);
    }
}
function updateMetrics(bedsData, patientsData, nursesData, alertsData) {
    const getArray = (data) => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.data)) return data.data;
        return [];
    };

    const totalBeds = getArray(bedsData).length;
    const totalPatients = getArray(patientsData).length;
    const totalNurses = getArray(nursesData).length;
    const totalAlerts = getArray(alertsData).length;

    const bedsMetric = document.getElementById("bedsMetric");
    const patientsMetric = document.getElementById("patientsMetric");
    const nursesMetric = document.getElementById("nursesMetric");
    const alertsMetric = document.getElementById("alertsMetric");

    if (bedsMetric) {
        bedsMetric.textContent = totalBeds;
    }

    if (patientsMetric) {
        patientsMetric.textContent = totalPatients;
    }

    if (nursesMetric) {
        nursesMetric.textContent = totalNurses;
    }

    if (alertsMetric) {
        alertsMetric.textContent = totalAlerts;
        alertsMetric.style.color = totalAlerts > 0 ? "red" : "green";
    }
}

function updateRoomsStatus(roomsData, bedsData) {
    const roomsAccordion = document.getElementById("roomsAccordion");
    
    if (!roomsAccordion || !roomsData) return;
    let roomsArray = Array.isArray(roomsData) ? roomsData : (roomsData.data || Object.values(roomsData));
    if (!Array.isArray(roomsArray)) {
        console.error("roomsData no es un array válido:", roomsData);
        return;
    }
    let bedsArray = Array.isArray(bedsData) ? bedsData : (bedsData?.data);
    console.log(bedsArray);

    roomsAccordion.innerHTML = "";

    roomsArray.forEach((room, index) => {
        
        const bedsInRoom = Array.isArray(bedsArray)
            ? bedsArray.filter(bed => bed.roomId === room.id || bed.room?.id === room.id)
            : [];

        console.log(bedsInRoom);
        const roomHtml = `
            <div class="accordion-item">
                <h2 class="accordion-header" id="heading${index}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" 
                            data-bs-target="#collapse${index}" aria-expanded="false" 
                            aria-controls="collapse${index}">
                         ${room.name} - ${room.island?.name}
                    </button>
                </h2>
                <div id="collapse${index}" class="accordion-collapse collapse" 
                     aria-labelledby="heading${index}" data-bs-parent="#roomsAccordion">
                    <div class="accordion-body">
                        <div class="d-flex gap-3 mb-2 flex-wrap">
                            ${bedsInRoom.length > 0 
                                ? bedsInRoom.map(bed => {
                                    // Normalizamos el estado de ocupación sin depender del nombre exacto
                                    const rawOccupied = bed.isOccupied ?? bed.occupied ?? bed.status;
                                    const normalizedOccupied = (() => {
                                        if (typeof rawOccupied === "boolean") return rawOccupied;
                                        if (typeof rawOccupied === "number") return rawOccupied !== 0;
                                        if (typeof rawOccupied === "string") {
                                            const value = rawOccupied.toLowerCase();
                                            return value === "true" || value === "ocupada" || value === "occupied" || value === "1";
                                        }
                                        return false;
                                    })();
                                    const isAvailable = !normalizedOccupied;
                                    return `
                                        <div class="room-box">
                                            <h5><i class="bi bi-bed"></i> ${bed.bedLabel }</h5>
                                            <span class="room-status ${isAvailable ? 'status-status' : 'status-occupied'}">
                                                ${isAvailable ? 'Disponible' : 'Ocupada'}
                                            </span>
                                        </div>
                                    `;
                                }).join('')
                                : `<p class="text-muted">No hay camas registradas</p>`
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;

        roomsAccordion.innerHTML += roomHtml;
    });
}

// ========== NOTIFICACIONES FIREBASE ==========

async function initializeNotifications() {
    try {
        // Importar dinámicamente el módulo de Firebase para admin
        const { initializeAdminNotifications, areNotificationsEnabled } = await import('../notification/notification-admin.js');

        // Verificar si ya están habilitadas
        if (areNotificationsEnabled()) {
            console.log('✅ Notificaciones ya habilitadas para admin');
            setupNotificationListener();
            return;
        }

        // Inicializar sistema de notificaciones
        const initialized = await initializeAdminNotifications(handleNewNotification);

        if (initialized) {
            Toast && Toast.show 
                ? Toast.show("Notificaciones activadas correctamente", "success")
                : console.log("Notificaciones activadas");
        } else {
            Toast && Toast.show 
                ? Toast.show("No se pudieron activar las notificaciones", "warning")
                : console.warn("No se pudieron activar las notificaciones");
        }
    } catch (error) {
        console.error('Error al inicializar notificaciones:', error);
        Toast && Toast.show && Toast.show("Error al activar notificaciones", "error");
    }
}

async function setupNotificationListener() {
    try {
        const { setupForegroundNotificationListener } = await import('../notification/notification-admin.js');
        setupForegroundNotificationListener(handleNewNotification);
    } catch (error) {
        console.error('Error al configurar listener:', error);
    }
}

function handleNewNotification(payload) {
    console.log('🔔 Nueva notificación recibida en Dashboard:', payload);

    const title = payload.notification?.title || '';
    const body = payload.notification?.body || '';

    // Mostrar alerta visual en la UI
    if (Toast && Toast.show) {
        Toast.show(`${title}: ${body}`, "info");
    }

    // Reproducir sonido
    playNotificationSound();

    // Recargar datos del dashboard para actualizar métricas
    loadDashboardData();
}

function playNotificationSound() {
    try {
        // Crear un audio simple (beep)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800; // Frecuencia en Hz
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.warn('No se pudo reproducir sonido:', error);
    }
}

// ========== LOGOUT ==========

function logout() {
    // Limpiar token FCM al cerrar sesión
    import('../notification/notification-admin.js').then(({ clearFCMToken }) => {
        clearFCMToken();
    }).catch(() => {});
    
    localStorage.clear();
    // Redirigir al login
    window.location.href = "./../../index.html";
}