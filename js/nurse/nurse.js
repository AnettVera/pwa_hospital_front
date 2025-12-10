// /modules/nourse/nourse.js



(function () {

    const beds = [
        { id: 201, name: "Cama 201", room: "Hab. 2", state: "alert" },
        { id: 101, name: "Cama 101", room: "Hab. 1", state: "occupied" }
    ];

    function qs(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        return String(str).replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    // QR Scanner
    let qrStream = null;
    let qrModalEl = document.getElementById("qrModal");
    let qrModal = new bootstrap.Modal(qrModalEl);
    let video = document.getElementById("qrVideo");
    let resultBox = document.getElementById("qrResult");

    document.getElementById("btn-scan-qr")?.addEventListener("click", startQRScanner);

    async function startQRScanner() {
        resultBox.textContent = "";

        // Verificar compatibilidad del navegador
        if (!("BarcodeDetector" in window)) {
            alert("Tu dispositivo no soporta escaneo QR nativo.");
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
                        resultBox.textContent = "QR detectado: " + qrValue;

                        stopQRScanner();
                    }
                } catch (err) { }

                requestAnimationFrame(scanLoop);
            };

            scanLoop();

        } catch (err) {
            alert("No se pudo acceder a la cámara");
            console.error(err);
        }
    }

    function stopQRScanner() {
        if (qrStream) {
            qrStream.getTracks().forEach(t => t.stop());
            qrStream = null;
        }
    }

    // Detener escaneo al cerrar modal
    qrModalEl.addEventListener("hidden.bs.modal", stopQRScanner);


    // Renderizar alertas
    function renderAlerts() {
        const alertsList = qs("alerts-list");
        const alerts = beds.filter(b => b.state === "alert");

        qs("alerts-count").textContent = alerts.length;

        alertsList.innerHTML = "";

        alerts.forEach(b => {
            const div = document.createElement("div");
            div.className =
                "card-panel status-occupied p-2 mb-2 d-flex justify-content-between align-items-center";

            div.innerHTML = `
        <div>
          <i class="bi bi-hospital-bed me-2"></i>
          <strong>${escapeHtml(b.name)}</strong> - ${escapeHtml(b.room)}
        </div>
        <button class="btn btn-sm btn-outline-danger" data-id="${b.id}">
          <i class="bi bi-x"></i>
        </button>
      `;

            alertsList.appendChild(div);
        });

        // botón cerrar alerta
        alertsList.querySelectorAll("button[data-id]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = Number(e.currentTarget.dataset.id);
                const item = beds.find(b => b.id === id);

                if (item) {
                    item.state = "occupied";
                    renderAll();
                }
            });
        });
    }

    // Renderizar cards de camas
    function renderBeds() {
        const grid = qs("beds-grid");
        grid.innerHTML = "";

        qs("beds-count").textContent = beds.length;

        beds.forEach(b => {
            const col = document.createElement("div");
            col.className = "col-12 col-sm-6 col-md-4 col-lg-3";

            const alertClass = b.state === "alert" ? "status-occupied" : "";

            col.innerHTML = `
        <div class="beds-card p-3 h-100 ${alertClass}">
          <h5 class="mb-1">
            <i class="bi bi-hospital-bed me-2"></i>
            ${escapeHtml(b.name)}
          </h5>
          <div class="text-muted">${escapeHtml(b.room)}</div>
          <div class="mt-3">
            ${badgeForState(b.state)}
          </div>
        </div>
      `;

            grid.appendChild(col);
        });
    }

    function badgeForState(state) {
        if (state === "alert") return `<span class="state-badge state-occupied">Alerta</span>`;
        if (state === "occupied") return `<span class="state-badge state-occupied">Ocupada</span>`;
        return `<span class="state-badge state-available">Disponible</span>`;
    }

    function renderAll() {
        renderAlerts();
        renderBeds();
    }

    document.addEventListener("DOMContentLoaded", renderAll);

})();
