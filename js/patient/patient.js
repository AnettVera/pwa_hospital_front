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
    const admissionSaved = localStorage.getItem("admissionData");

    if (qrSaved && admissionSaved) {
        mostrarPantallaPaciente(JSON.parse(admissionSaved));
    }
});

//---------------------------------------------------------
// EVENTO: ABRIR MODAL PERO SOLO SI NO EXISTE QR
//---------------------------------------------------------
btnOpenScan.addEventListener("click", () => {
    const qrSaved = localStorage.getItem("qrEscaneado");
    const admissionSaved = localStorage.getItem("admissionData");

    if (qrSaved && admissionSaved) {
        mostrarPantallaPaciente(JSON.parse(admissionSaved));
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

            stopCamera();
            modalScan.hide();

            // Consumir API
            vincularQRConServidor(code.data).then(result => {
                if (result) {
                    localStorage.setItem("qrEscaneado", code.data);
                    localStorage.setItem("admissionData", JSON.stringify(result.data));

                    mostrarPantallaPaciente(result.data);
                }
            });

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
// LLAMADA AL ENDPOINT PARA VINCULAR QR
//---------------------------------------------------------
async function vincularQRConServidor(qrValue) {
    try {
        const response = await fetch("http://localhost:8000/api/admissions/bind", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                qrcode: qrValue,
                deviceToken: "DEVICE_TOKEN_EJEMPLO"
            })
        });

        if (!response.ok) {
            Toast.show("No se pudo vincular el dispositivo.", "error");
            return null;
        }

        const data = await response.json();
        Toast.show("Dispositivo vinculado correctamente.", "success");

        return data;
        
    } catch (error) {
        console.error(error);
        Toast.show("Error de conexión con el servidor.", "error");
        return null;
    }
}

//---------------------------------------------------------
// SIMULAR ESCANEO
//---------------------------------------------------------
btnSimulateScan.addEventListener('click', async () => {
    await simulateApiCall();

    const qrSimulado = "QR_SIMULADO";

    const result = await vincularQRConServidor(qrSimulado);

    if (result) {
        localStorage.setItem("qrEscaneado", qrSimulado);
        localStorage.setItem("admissionData", JSON.stringify(result.data));

        stopCamera();
        modalScan.hide();
        mostrarPantallaPaciente(result.data);
    }
});

function simulateApiCall() {
    return new Promise((resolve) => setTimeout(resolve, 800));
}

//---------------------------------------------------------
// MOSTRAR PANTALLA PACIENTE
//---------------------------------------------------------
function mostrarPantallaPaciente(admissionData) {
    console.log("Mostrando datos:", admissionData);
    loadBedInfo(admissionData);

    scanScreen.classList.add('d-none-custom');
    patientScreen.classList.remove('d-none-custom');
}

//---------------------------------------------------------
// CARGAR DATOS REALES DE LA CAMA + PACIENTE
//---------------------------------------------------------
function loadBedInfo(data) {
    const bed = data.bed;
    const patient = data.patient;

    document.getElementById('bedName').textContent = bed.bedLabel;

    document.getElementById('bedInfo').textContent =
        `${bed.room.name} - Isla ${bed.room.island.name}`;

    document.getElementById('bedFooter').innerHTML = `
        <i class="bi bi-person me-1"></i>
        Paciente: ${patient.name} ${patient.surnames}
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
// LOGOUT
//---------------------------------------------------------
document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("qrEscaneado");
    localStorage.removeItem("admissionData");

    patientScreen.classList.add("d-none-custom");
    scanScreen.classList.remove("d-none-custom");

    console.log("🔓 Sesión cerrada. QR eliminado.");
});
