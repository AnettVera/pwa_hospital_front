// --- CONFIGURACIÓN ---
const API_URL = "http://localhost:8080/api"; // Ajusta tu puerto (8080 Java)

// Elementos DOM
const scanScreen = document.getElementById('scanScreen');
const patientScreen = document.getElementById('patientScreen');
const btnOpenScan = document.getElementById('btnOpenScan');
const btnSimulateScan = document.getElementById('btnSimulateScan'); // Botón mágico para pruebas
const helpButton = document.getElementById('helpButton');
const helpButtonText = document.getElementById('helpButtonText');
const logoutButton = document.getElementById("logoutButton");

// Modal Scan
const modalScanEl = document.getElementById('modalScan');
const modalScan = new bootstrap.Modal(modalScanEl);

// Variables Cámara
let cameraStream = null;
let scanningActive = false;
let videoElement = document.getElementById("camera");
let canvasElement = document.getElementById("qrCanvas");
let canvasCtx = canvasElement.getContext("2d");

// ---------------------------------------------------------
// 1. INICIALIZACIÓN
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Verificar si ya hay sesión activa
    const qrSaved = localStorage.getItem("qrEscaneado");
    const admissionSaved = localStorage.getItem("admissionData");

    if (qrSaved && admissionSaved) {
        mostrarPantallaPaciente(JSON.parse(admissionSaved));
    }
});

// Obtener o crear token único del dispositivo
function getDeviceToken() {
    let token = localStorage.getItem("hospital_device_token");
    if (!token) {
        token = 'dev-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
        localStorage.setItem("hospital_device_token", token);
    }
    return token;
}

// ---------------------------------------------------------
// 2. LÓGICA DE ESCANEO (CÁMARA)
// ---------------------------------------------------------
btnOpenScan.addEventListener("click", () => {
    modalScan.show();
    startCamera();
});

async function startCamera() {
    try {
        scanningActive = true;
        // Pedir cámara trasera (environment)
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        videoElement.srcObject = cameraStream;
        // Iniciar loop de escaneo
        requestAnimationFrame(tickScan);
    } catch (error) {
        console.error("Error cámara:", error);
        Toast.show("No se pudo acceder a la cámara", "error");
        modalScan.hide();
    }
}

function tickScan() {
    if (!scanningActive) return;

    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
        canvasElement.height = videoElement.videoHeight;
        canvasElement.width = videoElement.videoWidth;
        
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
        const imageData = canvasCtx.getImageData(0, 0, canvasElement.width, canvasElement.height);
        
        // Usamos la librería jsQR (Asegúrate de importarla en el HTML)
        if (window.jsQR) {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                console.log("QR Encontrado:", code.data);
                handleQrDetected(code.data);
                return; // Detener loop
            }
        }
    }
    requestAnimationFrame(tickScan);
}

function stopCamera() {
    scanningActive = false;
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

modalScanEl.addEventListener("hidden.bs.modal", stopCamera);

// ---------------------------------------------------------
// 3. VINCULACIÓN (BIND) - EL MOMENTO DE LA VERDAD
// ---------------------------------------------------------
async function handleQrDetected(qrContent) {
    stopCamera();
    modalScan.hide();
    
    // Llamar al Backend
    const result = await vincularQRConServidor(qrContent);
    
    if (result) {
        // Guardar sesión
        localStorage.setItem("qrEscaneado", qrContent);
        localStorage.setItem("admissionData", JSON.stringify(result)); // Guardamos todo el objeto Admission
        
        mostrarPantallaPaciente(result);
        Toast.show("¡Bienvenido! Dispositivo vinculado.", "success");
    }
}

async function vincularQRConServidor(qrCode) {
    const deviceToken = getDeviceToken();
    
    try {
        const response = await fetch(`${API_URL}/admissions/bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                qrCode: qrCode, 
                deviceToken: deviceToken 
            })
        });

        if (response.ok) {
            const json = await response.json();
            // Retornamos el objeto 'data' que trae la Admission
            return json.data; 
        } else {
            const err = await response.json();
            Toast.show(err.message || "Error al vincular. Verifique el QR.", "error");
            return null;
        }
    } catch (e) {
        console.error(e);
        Toast.show("Error de conexión con el servidor", "error");
        return null;
    }
}

// Botón Simular (Para probar sin cámara)
btnSimulateScan.addEventListener('click', () => {
    // Pide al usuario que ingrese el UUID manual para probar
    const qrManual = prompt("Ingresa el UUID del QR de la cama:");
    if (qrManual) {
        handleQrDetected(qrManual);
    }
});

// ---------------------------------------------------------
// 4. INTERFAZ PACIENTE
// ---------------------------------------------------------
function mostrarPantallaPaciente(admission) {
    // Extraer datos del objeto Admission
    // Estructura esperada: admission.bed.bedLabel, admission.patient.name, etc.
    
    const bedName = admission.bed ? admission.bed.bedLabel : "Cama Desconocida";
    const roomName = admission.bed && admission.bed.room ? admission.bed.room.name : "Habitación";
    const islandName = admission.bed && admission.bed.room && admission.bed.room.island 
                        ? admission.bed.room.island.name : "General";
    
    const patientName = admission.patient 
                        ? `${admission.patient.name} ${admission.patient.lastname || ''}` 
                        : "Paciente";

    // Pintar en el DOM
    document.getElementById('bedName').textContent = bedName;
    document.getElementById('bedInfo').textContent = `${roomName} - ${islandName}`;
    document.getElementById('bedFooter').innerHTML = `<i class="bi bi-person-check me-1"></i> Hola, ${patientName}`;

    // Cambio de pantalla
    scanScreen.classList.add('d-none-custom');
    patientScreen.classList.remove('d-none-custom');
}

// ---------------------------------------------------------
// 5. BOTÓN DE AYUDA (TRIGGER)
// ---------------------------------------------------------
const WAIT_TIME = 15; // Segundos de cooldown visual

helpButton.addEventListener('click', async () => {
    if (helpButton.classList.contains('disabled')) return;

    // 1. Enviar Alerta al Backend
    const success = await sendHelpAlert();

    if (success) {
        // 2. Iniciar cuenta regresiva visual (Cooldown)
        startCooldownAnimation();
    }
});

async function sendHelpAlert() {
    const qrCode = localStorage.getItem("qrEscaneado");
    const deviceToken = getDeviceToken();

    try {
        const response = await fetch(`${API_URL}/help/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                qrCode: qrCode, 
                deviceToken: deviceToken 
            })
        });

        if (response.ok) {
            Toast.show("🚨 Alerta enviada. El personal viene en camino.", "success");
            return true;
        } else {
            const err = await response.json();
            // Puede ser error de spam (429/400)
            Toast.show(err.message || "No se pudo enviar la alerta", "warning");
            return false;
        }
    } catch (e) {
        console.error(e);
        Toast.show("Error de conexión", "error");
        return false;
    }
}

function startCooldownAnimation() {
    let remaining = WAIT_TIME;
    helpButton.classList.add('disabled', 'animating');
    helpButtonText.textContent = `Espere ${remaining}s`;

    const interval = setInterval(() => {
        remaining--;
        helpButtonText.textContent = `Espere ${remaining}s`;

        if (remaining <= 0) {
            clearInterval(interval);
            helpButtonText.textContent = "AYUDA";
            helpButton.classList.remove('disabled', 'animating');
        }
    }, 1000);
}

// ---------------------------------------------------------
// 6. LOGOUT (Desvincular visualmente)
// ---------------------------------------------------------
logoutButton.addEventListener("click", () => {
    if(confirm("¿Desea salir? Tendrá que escanear el QR nuevamente.")) {
        localStorage.removeItem("qrEscaneado");
        localStorage.removeItem("admissionData");
        
        patientScreen.classList.add("d-none-custom");
        scanScreen.classList.remove("d-none-custom");
        
        // Nota: El deviceToken NO se borra, es la identidad del celular.
    }
});
