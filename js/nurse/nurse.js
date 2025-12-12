'use strict';

// Usa configuración centralizada desde config.js
const API_BASE = CONFIG.API_URL;
const API_NURSES = API_ENDPOINTS.NURSES;
const API_ADMISSIONS = API_ENDPOINTS.ADMISSIONS;
const API_HELP = API_ENDPOINTS.HELP;

let currentBeds = [];
let currentAlerts = [];
let qrStream = null;


// ========== POUCHDB (CACHE CAMAS ASIGNADAS) ==========

let nurseDb;
const hasPouch = typeof window !== 'undefined' && typeof window.PouchDB !== 'undefined';

if (hasPouch) {
    nurseDb = new window.PouchDB('nurse-assigned-beds-db');
}

async function saveAssignedBedsCache(beds) {
    if (!hasPouch) return;

    try {
        const id = 'assigned-beds';
        let existing = null;

        try {
            existing = await nurseDb.get(id);
        } catch {
            // si no existe, lo creamos desde cero
        }

        const doc = {
            _id: id,
            ...(existing ? { _rev: existing._rev } : {}),
            beds: Array.isArray(beds) ? beds : [],
            lastUpdated: Date.now()
        };

        await nurseDb.put(doc);
    } catch (e) {
        console.error('PouchDB saveAssignedBedsCache error', e);
    }
}

async function readAssignedBedsCache() {
    if (!hasPouch) return [];

    try {
        const doc = await nurseDb.get('assigned-beds');
        return doc.beds || [];
    } catch (e) {
        return [];
    }
}


// ========== UTILIDADES ==========

function getToken() {
    return localStorage.getItem('token');
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    };
}

function qs(id) {
    return document.getElementById(id);
}

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str).replace(/[&<>\"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
}

// ========== API CALLS ==========

async function toggleDutyStatus() {
    try {
        const res = await fetch(`${API_NURSES}/status`, {
            method: 'PATCH',
            headers: getHeaders()
        });

        if (res.ok) {
            const json = await res.json();
            console.log('Estado actualizado:', json);
            return json.data;
        } else {
            console.error('Error al cambiar estado', res.statusText);
            return null;
        }
    } catch (e) {
        console.error('Error al cambiar estado', e);
        return null;
    }
}

async function loadAssignedBeds() {
    if (navigator.onLine) {
        try {
            const res = await fetch(`${API_NURSES}/my-assignments`, {
                method: 'GET',
                headers: getHeaders()
            });

            if (res.ok) {
                const json = await res.json();
                currentBeds = json.data || [];
                renderBeds();

                await saveAssignedBedsCache(currentBeds);
                return;
            } else {
                console.error('Error al cargar camas', res.statusText);
            }
        } catch (e) {
            console.error('Error al cargar camas (online attempt failed)', e);
        }
    }

    try {
        const cached = await readAssignedBedsCache();
        currentBeds = cached || [];
        renderBeds();

        if (!navigator.onLine) {
            if (!cached || !cached.length) {
                Toast && Toast.show
                    ? Toast.show("Sin conexión y sin datos de camas guardados. Vuelve a intentar cuando tengas internet.", "info")
                    : alert("Sin conexión y sin datos de camas guardados. Vuelve a intentar cuando tengas internet.");
            } else {
                Toast && Toast.show
                    ? Toast.show("Mostrando las camas asignadas guardadas en el dispositivo (modo offline).", "info")
                    : alert("Mostrando las camas asignadas guardadas en el dispositivo (modo offline).");
            }
        }
    } catch (e) {
        console.error('Error al cargar camas desde cache', e);
    }
}


async function loadPendingAlerts() {
    try {
        const res = await fetch(`${API_HELP}/pending`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (res.ok) {
            const json = await res.json();
            currentAlerts = json.data || [];
            renderAlerts();
        } else {
            console.error('Error al cargar alertas', res.statusText);
        }
    } catch (e) {
        console.error('Error al cargar alertas', e);
    }
}

async function getPatientInfoByQR(qrCode) {
    try {
        const res = await fetch(`${API_ADMISSIONS}/info/${encodeURIComponent(qrCode)}`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (res.ok) {
            const json = await res.json();
            return json.data;
        } else {
            const errorJson = await res.json().catch(() => ({}));
            throw new Error(errorJson.message || 'No se encontró información del paciente');
        }
    } catch (e) {
        throw e;
    }
}

async function markAlertAsAttended(alertId) {
    try {
        const res = await fetch(`${API_HELP}/resolve/${alertId}`, {
            method: 'PATCH',
            headers: getHeaders()
        });

        if (res.ok) {
            return true;
        } else {
            console.error('Error al marcar alerta como atendida', res.statusText);
            return false;
        }
    } catch (e) {
        console.error('Error al marcar alerta', e);
        return false;
    }
}

// ========== RENDER FUNCTIONS ==========

function renderAlerts() {
    const alertsList = qs("alerts-list");
    const alertsCount = qs("alerts-count");

    if (!alertsList || !alertsCount) return;

    alertsCount.textContent = currentAlerts.length;
    alertsList.innerHTML = "";

    if (currentAlerts.length === 0) {
        alertsList.innerHTML = '<p class="text-muted text-center py-3">No hay alertas pendientes</p>';
        return;
    }

    currentAlerts.forEach(alert => {
        const admission = alert.admission;
        const patient = admission?.patient;
        const bed = admission?.bed;

        const patientName = patient ? `${patient.name} ${patient.surnames || ''}` : 'Paciente desconocido';
        const bedLabel = bed?.bedLabel || 'Cama desconocida';
        const roomName = bed?.room?.name || 'Habitación desconocida';

        const div = document.createElement("div");
        div.className = "card-panel status-occupied p-3 mb-2 d-flex justify-content-between align-items-center";

        div.innerHTML = `
            <div>
                <div class="d-flex align-items-center mb-1">
                    <i class="bi bi-exclamation-triangle-fill text-danger me-2"></i>
                    <strong>${escapeHtml(bedLabel)}</strong>
                    <span class="text-muted ms-2">- ${escapeHtml(roomName)}</span>
                </div>
                <div class="text-muted small">
                    <i class="bi bi-person me-1"></i>${escapeHtml(patientName)}
                </div>
                <div class="text-muted small">
                    <i class="bi bi-clock me-1"></i>${formatTime(alert.requestTime)}
                </div>
            </div>
            <button class="btn btn-sm btn-success" data-alert-id="${alert.id}">
                <i class="bi bi-check2"></i> Atender
            </button>
        `;

        alertsList.appendChild(div);
    });

    alertsList.querySelectorAll("button[data-alert-id]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const alertId = Number(e.currentTarget.dataset.alertId);
            const success = await markAlertAsAttended(alertId);

            if (success) {
                Toast && Toast.show ? Toast.show("Alerta atendida", "success") : alert("Alerta atendida");
                await loadPendingAlerts();
                await loadAssignedBeds();
            } else {
                Toast && Toast.show ? Toast.show("Error al atender alerta", "error") : alert("Error al atender alerta");
            }
        });
    });
}

function renderBeds() {
    const grid = qs("beds-grid");
    const bedsCount = qs("beds-count");

    if (!grid || !bedsCount) return;

    bedsCount.textContent = currentBeds.length;
    grid.innerHTML = "";

    if (currentBeds.length === 0) {
        grid.innerHTML = '<div class="col-12"><p class="text-muted text-center py-3">No tienes camas asignadas</p></div>';
        return;
    }

    currentBeds.forEach(bed => {
        const col = document.createElement("div");
        col.className = "col-12 col-sm-6 col-md-4 col-lg-3";

        const alertClass = bed.state === "alert" ? "status-occupied" : "";

        col.innerHTML = `
            <div class="beds-card p-3 h-100 ${alertClass}">
                <h5 class="mb-1">
                    <i class="bi bi-hospital-bed me-2"></i>
                    ${escapeHtml(bed.bedLabel)}
                </h5>
                <div class="text-muted">${escapeHtml(bed.roomName)}</div>
                <div class="mt-3">
                    ${badgeForState(bed.state)}
                </div>
            </div>
        `;

        grid.appendChild(col);
    });
}

function badgeForState(state) {
    if (state === "alert") return `<span class="state-badge state-occupied">🚨 Alerta</span>`;
    if (state === "occupied") return `<span class="state-badge state-occupied">Ocupada</span>`;
    return `<span class="state-badge state-available">Disponible</span>`;
}

function formatTime(dateTimeString) {
    if (!dateTimeString) return '';
    
    try {
        const date = new Date(dateTimeString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Hace menos de 1 min';
        if (diffMins < 60) return `Hace ${diffMins} min`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `Hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;

        return date.toLocaleString('es-MX', { 
            day: '2-digit', 
            month: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } catch (e) {
        return dateTimeString;
    }
}

// ========== QR SCANNER ==========

let qrModalEl, qrModal, video, resultBox;

async function startQRScanner() {
    if (!resultBox) return;
    resultBox.textContent = "";

    if (!("BarcodeDetector" in window)) {
        Toast && Toast.show 
            ? Toast.show("Tu dispositivo no soporta escaneo QR nativo", "error")
            : alert("Tu dispositivo no soporta escaneo QR nativo.");
        return;
    }

    qrModal.show();

    try {
        qrStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = qrStream;

        const detector = new BarcodeDetector({ formats: ["qr_code"] });

        const scanLoop = async () => {
            if (!qrStream) return;

            try {
                const barcodes = await detector.detect(video);
                if (barcodes.length > 0) {
                    const qrValue = barcodes[0].rawValue;
                    
                    resultBox.textContent = "Escaneando...";
                    
                    try {
                        const patientInfo = await getPatientInfoByQR(qrValue);
                        
                        resultBox.innerHTML = `
                            <div class="alert alert-success text-start mt-3">
                                <h6 class="fw-bold mb-2">
                                    <i class="bi bi-check-circle-fill me-2"></i>Información del Paciente
                                </h6>
                                <p class="mb-1"><strong>Nombre:</strong> ${escapeHtml(patientInfo.patientName)}</p>
                                <p class="mb-1"><strong>Cama:</strong> ${escapeHtml(patientInfo.bed)}</p>
                                <p class="mb-1"><strong>Habitación:</strong> ${escapeHtml(patientInfo.room)}</p>
                                ${patientInfo.notes ? `<p class="mb-0"><strong>Notas:</strong> ${escapeHtml(patientInfo.notes)}</p>` : ''}
                            </div>
                        `;
                        
                        Toast && Toast.show && Toast.show("Información del paciente cargada", "success");
                    } catch (err) {
                        resultBox.innerHTML = `
                            <div class="alert alert-danger text-start mt-3">
                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                ${escapeHtml(err.message || 'Error al obtener información')}
                            </div>
                        `;
                        Toast && Toast.show && Toast.show(err.message || "Error al escanear", "error");
                    }

                    stopQRScanner();
                }
            } catch (err) {
                // Continuar escaneando
            }

            requestAnimationFrame(scanLoop);
        };

        scanLoop();

    } catch (err) {
        Toast && Toast.show 
            ? Toast.show("No se pudo acceder a la cámara", "error")
            : alert("No se pudo acceder a la cámara");
        console.error(err);
    }
}

function stopQRScanner() {
    if (qrStream) {
        qrStream.getTracks().forEach(t => t.stop());
        qrStream = null;
    }
}

// ========== EVENT HANDLERS ==========

function handleToggleAlerts(e) {
    const isChecked = e.target.checked;
    
    toggleDutyStatus().then(nurse => {
        if (nurse) {
            const status = nurse.isOnDuty || nurse.onDuty ? "activo" : "inactivo";
            Toast && Toast.show 
                ? Toast.show(`Estado cambiado a: ${status}`, "success")
                : console.log(`Estado: ${status}`);
            
            if (!isChecked) {
                console.log('Notificaciones desactivadas');
            } else {
                console.log('Notificaciones activadas');
            }
        } else {
            e.target.checked = !isChecked;
            Toast && Toast.show 
                ? Toast.show("Error al cambiar estado", "error")
                : alert("Error al cambiar estado");
        }
    });
}

// ========== NOTIFICACIONES ==========

async function initializeNotifications() {
    try {
        console.log('🚀 Inicializando notificaciones...');
        
        // Importar dinámicamente el módulo de Firebase
        const { initializeNurseNotifications, areNotificationsEnabled } = await import('../notification/firebase-config.js');

        // Verificar si ya están habilitadas
        if (areNotificationsEnabled()) {
            console.log('✅ Notificaciones ya habilitadas previamente');
            
            // Re-inicializar para configurar el listener con el nuevo callback
            const reInitialized = await initializeNurseNotifications(handleNewNotification);
            
            if (reInitialized) {
                console.log('✅ Sistema de notificaciones re-inicializado');
            }
            return;
        }

        // Inicializar sistema de notificaciones (esto YA configura el listener internamente)
        const initialized = await initializeNurseNotifications(handleNewNotification);

        if (initialized) {
            Toast && Toast.show 
                ? Toast.show("Notificaciones activadas correctamente", "success")
                : console.log("✅ Notificaciones activadas");
        } else {
            Toast && Toast.show 
                ? Toast.show("No se pudieron activar las notificaciones", "warning")
                : console.warn("⚠️ No se pudieron activar las notificaciones");
        }
    } catch (error) {
        console.error('❌ Error al inicializar notificaciones:', error);
        Toast && Toast.show && Toast.show("Error al activar notificaciones", "error");
    }
}

function handleNewNotification(payload) {
    console.log('🔔 Nueva notificación recibida:', payload);

    const title = payload.notification?.title || '';
    const body = payload.notification?.body || '';

    // Mostrar alerta visual en la UI
    if (Toast && Toast.show) {
        Toast.show(`${title}: ${body}`, "info");
    }

    // Reproducir sonido
    playNotificationSound();

    // Recargar alertas y camas
    loadPendingAlerts();
    loadAssignedBeds();

    // Expandir acordeón de alertas si está cerrado
    const alertsCollapse = document.getElementById('collapseAlerts');
    if (alertsCollapse && !alertsCollapse.classList.contains('show')) {
        const bsCollapse = new bootstrap.Collapse(alertsCollapse, { show: true });
    }
}

function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.warn('No se pudo reproducir sonido:', error);
    }
}

// ========== INIT ==========

async function init() {
    console.log('🚀 Inicializando panel de enfermero...');
    
    // Inicializar elementos del DOM
    qrModalEl = qs("qrModal");
    if (qrModalEl) {
        qrModal = new bootstrap.Modal(qrModalEl);
        qrModalEl.addEventListener("hidden.bs.modal", stopQRScanner);
    }
    
    video = qs("qrVideo");
    resultBox = qs("qrResult");

    // Cargar datos iniciales
    loadAssignedBeds();
    loadPendingAlerts();

    // ✅ SOLO llamar a initializeNotifications (que ya configura el listener internamente)
    await initializeNotifications();

    // Event listeners
    const btnScanQR = qs("btn-scan-qr");
    if (btnScanQR) {
        btnScanQR.addEventListener("click", startQRScanner);
    }

    const alertsToggle = qs("alertsToggle");
    if (alertsToggle) {
        alertsToggle.addEventListener("change", handleToggleAlerts);
    }

    // Recargar alertas cada 30 segundos
    setInterval(() => {
        if (navigator.onLine) {
            loadPendingAlerts();
            loadAssignedBeds();
        }
    }, 30000);

    console.log('✅ Panel de enfermero inicializado');
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 30);
}

function logout() {
    // Limpiar token FCM al cerrar sesión
    import('../notification/firebase-config.js').then(({ clearFCMToken }) => {
        clearFCMToken();
    }).catch(() => {});
    
    localStorage.clear();
    window.location.href = "./../../index.html";
}

// Hacer la función logout accesible globalmente

window.logout = logout;
