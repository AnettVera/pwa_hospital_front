//---------------------------------------------------------
// VARIABLES Y ELEMENTOS DEL DOM
//---------------------------------------------------------

const scanScreen = document.getElementById('scanScreen');
const patientScreen = document.getElementById('patientScreen');
const btnOpenScan = document.getElementById('btnOpenScan');
const btnSimulateScan = document.getElementById('btnSimulateScan');
const helpButton = document.getElementById('helpButton');
const helpButtonText = document.getElementById('helpButtonText');

const modalScanEl = document.getElementById('modalScan');
const modalScan = new bootstrap.Modal(modalScanEl);

//---------------------------------------------------------
// VARIABLES PARA LA CÁMARA
//---------------------------------------------------------
let cameraStream = null;
let scanningActive = false;

//---------------------------------------------------------
// AL CARGAR LA PÁGINA: VALIDAR SI YA EXISTE UN QR
//---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const qrSaved = localStorage.getItem("qrEscaneado");

    if (qrSaved) {
        // Ya hay QR registrado → pantalla paciente directa
        mostrarPantallaPaciente(qrSaved);
    }
});

//---------------------------------------------------------
// EVENTO: ABRIR MODAL PERO SOLO SI NO EXISTE QR
//---------------------------------------------------------
btnOpenScan.addEventListener("click", () => {
    const qrSaved = localStorage.getItem("qrEscaneado");

    if (qrSaved) {
        mostrarPantallaPaciente(qrSaved);
        return;
    }

    modalScan.show();
    startCamera();
});

//---------------------------------------------------------
// ENCENDER CÁMARA TRASERA
//---------------------------------------------------------
async function startCamera() {
    const video = document.getElementById("camera");

    try {
        scanningActive = true;

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = cameraStream;

        requestAnimationFrame(scanQRCode);
    } catch (error) {
        console.error("Error al acceder a la cámara:", error);
        alert("No se pudo acceder a la cámara.");
    }
}

//---------------------------------------------------------
// ESCANEAR QR EN TIEMPO REAL
//---------------------------------------------------------
function scanQRCode() {
    if (!scanningActive) return;

    const video = document.getElementById("camera");
    const canvas = document.getElementById("qrCanvas");
    const ctx = canvas.getContext("2d");

    if (!cameraStream) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
            console.log("QR Detectado:", code.data);

            // 🔥 Guardar QR en localStorage
            localStorage.setItem("qrEscaneado", code.data);

            stopCamera();
            modalScan.hide();

            mostrarPantallaPaciente(code.data);

            return;
        }
    }

    requestAnimationFrame(scanQRCode);
}

//---------------------------------------------------------
// APAGAR CÁMARA
//---------------------------------------------------------
function stopCamera() {
    scanningActive = false;

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

//---------------------------------------------------------
// APAGAR CÁMARA AL CERRAR MODAL
//---------------------------------------------------------
modalScanEl.addEventListener("hidden.bs.modal", () => {
    stopCamera();
});

//---------------------------------------------------------
// SIMULAR ESCANEO (solo pruebas)
//---------------------------------------------------------
btnSimulateScan.addEventListener('click', async () => {
    await simulateApiCall();

    const qrSimulado = "QR_SIMULADO";
    localStorage.setItem("qrEscaneado", qrSimulado);

    stopCamera();
    modalScan.hide();

    mostrarPantallaPaciente(qrSimulado);
});

function simulateApiCall() {
    return new Promise((resolve) => setTimeout(resolve, 800));
}

//---------------------------------------------------------
// FUNCIÓN PARA MOSTRAR LA PANTALLA DEL PACIENTE
//---------------------------------------------------------
function mostrarPantallaPaciente(qrValue) {
    console.log("Mostrando pantalla con QR:", qrValue);

    // Cargar datos (puedes usar API real luego)
    loadBedInfo({
        name: "Cama 500",
        room: "Habitación 10",
        area: "Pediatria"
    });

    scanScreen.classList.add('d-none-custom');
    patientScreen.classList.remove('d-none-custom');
}

//---------------------------------------------------------
// CARGAR DATOS DE LA CAMA
//---------------------------------------------------------
function loadBedInfo(bedData) {
    document.getElementById('bedName').textContent = bedData.name;
    document.getElementById('bedInfo').textContent = `${bedData.room} - ${bedData.area}`;
    document.getElementById('bedFooter').innerHTML = `
        <i class="bi bi-link-45deg me-1"></i>
        Vinculado a la ${bedData.name}
    `;
}

//---------------------------------------------------------
// BOTÓN "AYUDA"
//---------------------------------------------------------
const WAIT_TIME = 15;

helpButton.addEventListener('click', () => {
    if (helpButton.classList.contains('disabled')) return;

    let remaining = WAIT_TIME;

    helpButton.classList.add('disabled', 'animating');
    helpButtonText.textContent = remaining;

    const interval = setInterval(() => {
        remaining--;
        helpButtonText.textContent = remaining;

        if (remaining <= 0) {
            clearInterval(interval);

            helpButtonText.textContent = "Ayuda";
            helpButton.classList.remove('disabled', 'animating');
        }
    }, 1000);

    sendHelpAlert();
});

function sendHelpAlert() {
    console.log("🚨 Alerta enviada");
}


//---------------------------------------------------------
// CERRAR SESIÓN / BORRAR STORAGE
//---------------------------------------------------------
document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("qrEscaneado");  // borrar valor del QR

    // volver a la pantalla de escaneo
    patientScreen.classList.add("d-none-custom");
    scanScreen.classList.remove("d-none-custom");

    console.log("🔓 Sesión cerrada. QR eliminado.");
});
