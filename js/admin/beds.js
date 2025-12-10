(function () {
  'use strict';

  const API_BEDS = "http://localhost:8000/api/beds";
  const API_BEDS_STATUS = `${API_BEDS}/status`;
  const API_ROOMS = "http://localhost:8000/api/rooms";

  function getToken() { return localStorage.getItem("token"); }
  function getHeaders() {
    return { "Authorization": `Bearer ${getToken()}`, "Content-Type": "application/json" };
  }

  let bedsData = [];
  let roomsData = [];

  const ROOMS_PER_PAGE = 10;
  let currentPage = 1;
  let groupedBeds = {};

  // --------- PouchDB (cache + cola) ----------
  let bedsCacheDb = null;
  let bedsQueueDb = null;
  let roomsCacheDb = null; // ← NUEVO


  const hasPouch = typeof window !== "undefined" && typeof window.PouchDB !== "undefined";

  if (hasPouch) {
    try {
      bedsCacheDb = new window.PouchDB("beds-cache");
      bedsQueueDb = new window.PouchDB("beds-queue");
      roomsCacheDb = new window.PouchDB("rooms-cache"); // ← NUEVO

    } catch (e) {
      console.error("Error inicializando PouchDB en beds:", e);
    }
  } else {
    console.warn("PouchDB no está disponible en esta página. Modo offline de camas deshabilitado.");
  }

  // ID temporal tipo temp_...
  function genTempId() {
    return `temp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  // --------- Helpers PouchDB (cache de camas) ----------

  async function saveBedsToCache(list) {
    if (!bedsCacheDb) return;
    try {
      let doc;
      try {
        doc = await bedsCacheDb.get("beds_list");
      } catch (e) {
        if (e.status === 404) {
          doc = { _id: "beds_list", type: "beds_list" };
        } else {
          throw e;
        }
      }
      doc.beds = Array.isArray(list) ? list : [];
      doc.updatedAt = new Date().toISOString();
      await bedsCacheDb.put(doc);
    } catch (e) {
      console.error("Error al guardar camas en cache PouchDB:", e);
    }
  }

  async function saveRoomsToCache(list) {
    if (!roomsCacheDb) return;
    try {
      let doc;
      try {
        doc = await roomsCacheDb.get("rooms_list");
      } catch (e) {
        if (e.status === 404) doc = { _id: "rooms_list" };
        else throw e;
      }

      doc.rooms = Array.isArray(list) ? list : [];
      doc.updatedAt = Date.now();

      await roomsCacheDb.put(doc);
    } catch (e) {
      console.error("Error guardando habitaciones en cache:", e);
    }
  }
  async function loadRoomsFromCache() {
    if (!roomsCacheDb) return [];

    try {
      const doc = await roomsCacheDb.get("rooms_list");
      return doc.rooms || [];
    } catch (e) {
      console.warn("No hay habitaciones en cache");
      return [];
    }
  }

  async function loadBedsFromCache() {
    if (!bedsCacheDb) {
      console.warn("PouchDB no disponible para leer cache de camas.");
      bedsData = [];
      renderBedsGrouped();
      return;
    }
    try {
      const doc = await bedsCacheDb.get("beds_list");
      bedsData = doc.beds || [];
      currentPage = 1;
      renderBedsGrouped();
    } catch (e) {
      if (e.status === 404) {
        console.info("No hay camas cacheadas en PouchDB.");
        bedsData = [];
        renderBedsGrouped();
      } else {
        console.error("Error al leer camas desde PouchDB:", e);
      }
    }
  }

  // --------- Helpers PouchDB (cola de POST pendientes) ----------

  async function queueCreateBed(payload) {
    if (!bedsQueueDb) return;
    try {
      const id = `op:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      await bedsQueueDb.put({
        _id: id,
        type: "CREATE",
        entity: "bed",
        payload,
        createdAt: Date.now(),
        status: "pending",
      });
    } catch (e) {
      console.error("Error al encolar creación de cama en PouchDB:", e);
    }
  }

  async function syncQueuedBeds() {
    if (!bedsQueueDb || !navigator.onLine) return;

    try {
      const res = await bedsQueueDb.allDocs({ include_docs: true });
      const ops = res.rows.map(r => r.doc);

      if (!ops.length) return;

      console.info("Sincronizando camas pendientes...");

      for (const doc of ops) {
        if (!doc || doc.status === "done") continue;
        if (doc.type !== "CREATE" || doc.entity !== "bed") continue;
        const payload = doc.payload;
        if (!payload) continue;

        try {
          const response = await fetch(API_BEDS, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            console.error(
              "Error al sincronizar una cama en cola:",
              response.status,
              response.statusText
            );
            // No borramos el doc para reintentar luego
            continue;
          }

          // Si el servidor la creó bien, eliminamos de cola
          try {
            const toDel = await bedsQueueDb.get(doc._id);
            await bedsQueueDb.remove(toDel);
          } catch {
            // ignorar
          }
        } catch (err) {
          console.warn("Error de red al sincronizar cama pendiente, se reintentará luego:", err);
          // Cortamos el ciclo para no quemar la cola en caso de caída de red
          break;
        }
      }

      // Luego de sincronizar, recargamos desde el servidor
      await loadBeds();
      if (typeof Toast !== "undefined") {
        Toast.show("Se sincronizaron las camas pendientes (si había alguna).", "success");
      }
    } catch (e) {
      console.error("Error general al sincronizar camas en cola:", e);
    }
  }

  // --------- Carga de habitaciones (igual que antes) ----------

  async function loadRooms() {
    // Si no hay internet → usar cache
    if (!navigator.onLine) {
      roomsData = await loadRoomsFromCache();
      renderRoomsSelect();
      return;
    }

    // Online: cargar y guardar en cache
    try {
      const res = await fetch(API_ROOMS, { method: "GET", headers: getHeaders() });
      if (res.ok) {
        const json = await res.json();
        roomsData = json.data || [];

        renderRoomsSelect();
        saveRoomsToCache(roomsData); // ← Guardar cache
      } else {
        console.error("Error cargando habitaciones:", res.statusText);
        roomsData = await loadRoomsFromCache();
        renderRoomsSelect();
      }
    } catch (e) {
      console.error("Error conexión habitaciones:", e);
      roomsData = await loadRoomsFromCache();
      renderRoomsSelect();
    }
  }


  // --------- Carga de camas (GET con soporte offline) ----------

  async function loadBeds() {
    // Si claramente no hay conexión, vamos directo a cache
    if (!navigator.onLine) {
      console.info("Sin conexión, cargando camas desde PouchDB.");
      if (typeof Toast !== "undefined") {
        Toast.show("Sin conexión. Mostrando camas almacenadas localmente.", "info");
      }
      await loadBedsFromCache();
      return;
    }

    try {
      const res = await fetch(API_BEDS_STATUS, { method: "GET", headers: getHeaders() });
      if (res.ok) {
        const json = await res.json();
        bedsData = json.data || [];
        currentPage = 1;
        renderBedsGrouped();
        // Guardar en cache
        saveBedsToCache(bedsData);
      } else {
        console.error("Error al cargar camas desde el servidor:", res.statusText);
        if (typeof Toast !== "undefined") {
          Toast.show("No se pudieron cargar las camas desde el servidor. Se intentará usar datos locales.", "error");
        }
        await loadBedsFromCache();
      }
    } catch (e) {
      console.error("Error de conexión al cargar camas.", e);
      if (typeof Toast !== "undefined") {
        Toast.show("Error de conexión al cargar camas. Se intentará usar datos locales.", "error");
      }
      await loadBedsFromCache();
    }
  }

  // --------- Render de selects y agrupación (igual con pequeños ajustes) ----------

  function renderRoomsSelect(selectedId) {
    var select = document.getElementById('bed-room');
    if (!select) return;

    select.innerHTML = '<option value="">Seleccione una habitación</option>';
    roomsData.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (selectedId && selectedId == r.id) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function groupBedsByRoom() {
    groupedBeds = {};

    bedsData.forEach(function (bed) {
      var roomId = bed.room ? bed.room.id : (bed.roomId != null ? bed.roomId : 'sin-asignar');
      var roomName = bed.room
        ? bed.room.name
        : (bed.roomName || (bed.room && bed.room.name) || 'Sin Asignar');

      if (!groupedBeds[roomId]) {
        groupedBeds[roomId] = {
          roomId: roomId,
          roomName: roomName,
          beds: []
        };
      }
      groupedBeds[roomId].beds.push(bed);
    });

    return Object.values(groupedBeds);
  }

  function renderBedsGrouped() {
    var container = document.getElementById('rooms-container');
    if (!container) return;

    var rooms = groupBedsByRoom();

    if (!rooms.length) {
      container.innerHTML = '<div class="text-center text-muted py-4">No hay camas registradas.</div>';
      renderPagination(0);
      return;
    }

    var totalPages = Math.ceil(rooms.length / ROOMS_PER_PAGE);
    var startIndex = (currentPage - 1) * ROOMS_PER_PAGE;
    var endIndex = startIndex + ROOMS_PER_PAGE;
    var paginatedRooms = rooms.slice(startIndex, endIndex);

    container.innerHTML = paginatedRooms.map(function (room, index) {
      var collapseId = 'collapse-room-' + room.roomId;
      var headerId = 'header-room-' + room.roomId;
      var isFirst = index === 0;

      return `
            <div class="accordion-item border mb-2 rounded overflow-hidden">
              <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button ${isFirst ? '' : 'collapsed'}" type="button" 
                        data-bs-toggle="collapse" data-bs-target="#${collapseId}" 
                        aria-expanded="${isFirst}" aria-controls="${collapseId}">
                  <div class="d-flex align-items-center justify-content-between w-100 me-3">
                    <span>
                      <i class="bi bi-door-open me-2 text-primary"></i>
                      <strong>${escapeHtml(room.roomName)}</strong>
                    </span>
                    <span class="badge bg-primary rounded-pill">${room.beds.length} cama${room.beds.length !== 1 ? 's' : ''}</span>
                  </div>
                </button>
              </h2>
              <div id="${collapseId}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}" 
                   aria-labelledby="${headerId}" data-bs-parent="#rooms-container">
                <div class="accordion-body p-0">
                  <table class="table table-hover mb-0">
                    <thead class="table-light">
                      <tr>
                        <th style="width: 40%">Nombre de Cama</th>
                        <th style="width: 20%">Disponibilidad</th>
                        <th style="width: 40%" class="text-end">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${renderBedsRows(room.beds, room.roomName)}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `;
    }).join('');

    renderPagination(totalPages);
  }

  function renderBedsRows(beds, roomName) {
    return beds.map(function (bed) {
      const bedId = bed.id != null ? String(bed.id) : (bed.tempId || "");
      const isPending =
        bed.pending === true ||
        (typeof bedId === "string" && bedId.startsWith("temp_")) ||
        bed._localOnly === true;

      const pendingBadge = isPending
        ? ' <span class="badge bg-warning text-dark">Pendiente</span>'
        : '';

      const rawOccupied = bed.isOccupied ?? bed.occupied ?? bed.status ?? bed.isoccupied;
      const normalizedOccupied = (() => {
        if (typeof rawOccupied === "boolean") return rawOccupied;
        if (typeof rawOccupied === "number") return rawOccupied !== 0;
        if (typeof rawOccupied === "string") {
          const v = rawOccupied.toLowerCase();
          return v === "true" || v === "1" || v === "ocupada" || v === "occupied";
        }
        return false;
      })();

      const stateBadge = normalizedOccupied
        ? '<span class="badge bg-danger">Ocupada</span>'
        : '<span class="badge bg-success">Disponible</span>';

      return `
            <tr>
              <td class="fw-bold text-primary">
                <i class="bi bi-hospital me-2"></i> ${escapeHtml(bed.bedLabel)}${pendingBadge}
              </td>
              <td>
                ${stateBadge}
              </td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-dark me-1" onclick="window.showQR('${bed.qrcode || ""}', '${escapeHtml(bed.bedLabel)}', '${escapeHtml(roomName)}')">
                    <i class="bi bi-qr-code"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="window.deleteBed('${bedId}')">
                    <i class="bi bi-trash"></i>
                </button>
              </td>
            </tr>
          `;
    }).join('');
  }

  function renderPagination(totalPages) {
    var paginationContainer = document.querySelector('#beds-pagination ul');
    if (!paginationContainer) return;

    if (totalPages <= 1) {
      paginationContainer.innerHTML = '';
      return;
    }

    var html = '';

    html += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
          <a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="Anterior">
            <i class="bi bi-chevron-left"></i>
          </a>
        </li>
      `;

    for (var i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
        html += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                  <a class="page-link" href="#" data-page="${i}">${i}</a>
                </li>
              `;
      } else if (i === currentPage - 3 || i === currentPage + 3) {
        html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
      }
    }

    html += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
          <a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="Siguiente">
            <i class="bi bi-chevron-right"></i>
          </a>
        </li>
      `;

    paginationContainer.innerHTML = html;
  }

  function handlePaginationClick(e) {
    e.preventDefault();
    var target = e.target.closest('[data-page]');
    if (!target) return;

    var page = parseInt(target.getAttribute('data-page'), 10);
    var rooms = Object.values(groupedBeds);
    var totalPages = Math.ceil(rooms.length / ROOMS_PER_PAGE);

    if (page >= 1 && page <= totalPages) {
      currentPage = page;
      renderBedsGrouped();
      document.getElementById('rooms-container').scrollIntoView({ behavior: 'smooth' });
    }
  }

  // --------- Guardar cama (POST online + offline con pendiente) ----------

  async function saveBed() {
    var roomSelect = document.getElementById('bed-room');
    var labelInput = document.getElementById('bed-label');

    var roomId = roomSelect ? roomSelect.value : '';
    var label = labelInput ? labelInput.value.trim() : '';

    if (!roomId) {
      if (typeof Toast !== "undefined") {
        Toast.show('Seleccione una habitación', 'error');
      } else {
        alert('Seleccione una habitación');
      }
      return;
    }
    if (!label) {
      if (typeof Toast !== "undefined") {
        Toast.show('Ingrese un nombre para la cama', 'error');
      } else {
        alert('Ingrese un nombre para la cama');
      }
      return;
    }

    const roomIdNum = parseInt(roomId, 10);
    const payload = {
      roomId: roomIdNum,
      bedLabel: label
    };

    // Si no hay conexión -> modo offline
    if (!navigator.onLine) {
      await handleOfflineBedCreate(payload, roomIdNum, label, roomSelect, labelInput);
      return;
    }

    // Online normal
    try {
      const res = await fetch(API_BEDS, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        if (typeof Toast !== "undefined") {
          Toast.show("Cama creada exitosamente", "success");
        } else {
          alert("Cama creada exitosamente");
        }
        closeBedModalAndReset(roomSelect, labelInput);
        loadBeds();
      } else {
        let message = "Error al crear la cama";
        try {
          const err = await res.json();
          if (err && err.message) message = "Error: " + err.message;
        } catch { }
        if (typeof Toast !== "undefined") {
          Toast.show(message, "error");
        } else {
          alert(message);
        }
      }
    } catch (e) {
      console.error(e);
      // Si fallo de conexión, tratamos como offline con pendiente
      await handleOfflineBedCreate(payload, roomIdNum, label, roomSelect, labelInput, true);
    }
  }

  async function handleOfflineBedCreate(payload, roomIdNum, label, roomSelect, labelInput, fromError = false) {
    if (hasPouch && bedsQueueDb) {
      await queueCreateBed(payload);
    }

    // Encontrar la habitación para mostrar el nombre
    let roomName = "Sin Asignar";
    const room = roomsData.find(r => String(r.id) === String(roomIdNum));
    if (room) {
      roomName = room.name;
    }

    const tempId = genTempId();

    const offlineBed = {
      id: tempId,
      tempId,
      bedLabel: label,
      room: { id: roomIdNum, name: roomName },
      roomId: roomIdNum,
      roomName: roomName,
      qrcode: null,
      pending: true,
      isOccupied: false,
      _localOnly: true
    };

    bedsData.push(offlineBed);
    currentPage = 1;
    renderBedsGrouped();
    saveBedsToCache(bedsData);

    const msg = fromError
      ? "Error de conexión. La cama se guardó localmente y se enviará cuando vuelva la conexión."
      : "Sin conexión. La cama se guardó localmente y se enviará cuando vuelva la conexión.";

    if (typeof Toast !== "undefined") {
      Toast.show(msg, "info");
    } else {
      alert(msg);
    }

    closeBedModalAndReset(roomSelect, labelInput);
  }

  function closeBedModalAndReset(roomSelect, labelInput) {
    var modalEl = document.getElementById('bedModal');
    if (modalEl && typeof bootstrap !== "undefined") {
      var instance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      instance.hide();
    }

    if (roomSelect) roomSelect.value = '';
    if (labelInput) labelInput.value = '';
  }

  // --------- Eliminar cama (solo online) ----------

  window.deleteBed = async function (id) {
    // Bloqueamos si no hay conexión
    if (!navigator.onLine) {
      if (typeof Toast !== "undefined") {
        Toast.show("Para eliminar una cama necesitas conexión a internet.", "info");
      } else {
        alert("Para eliminar una cama necesitas conexión a internet.");
      }
      return;
    }

    // Confirmación usando Toast tipo modification
    if (typeof Toast !== "undefined") {
      Toast.show(
        "¿Estás seguro de eliminar esta cama?",
        "modification",
        async () => {
          try {
            const res = await fetch(`${API_BEDS}/${id}`, {
              method: "DELETE",
              headers: getHeaders()
            });
            if (res.ok) {
              if (typeof Toast !== "undefined") {
                Toast.show("Cama eliminada correctamente", "success");
              }
              loadBeds();
            } else {
              if (typeof Toast !== "undefined") {
                Toast.show("No se pudo eliminar (quizás tiene un paciente activo)", "error");
              } else {
                alert("No se pudo eliminar (quizás tiene un paciente activo)");
              }
            }
          } catch (e) {
            console.error(e);
            if (typeof Toast !== "undefined") {
              Toast.show("Error de conexión al eliminar la cama", "error");
            } else {
              alert("Error de conexión al eliminar la cama");
            }
          }
        },
        () => {
          if (typeof Toast !== "undefined") {
            Toast.show("Operación cancelada", "info");
          }
        }
      );
    } else {
      // Fallback con confirm()
      if (!confirm("¿Estás seguro de eliminar esta cama?")) return;
      try {
        const res = await fetch(`${API_BEDS}/${id}`, {
          method: "DELETE",
          headers: getHeaders()
        });
        if (res.ok) {
          loadBeds();
        } else {
          alert("No se pudo eliminar (quizás tiene un paciente activo)");
        }
      } catch (e) { console.error(e); }
    }
  };

  // --------- QR (igual que antes) ----------

  let currentQRData = {
    qrcode: '',
    bedLabel: '',
    roomName: ''
  };
  let qrCodeInstance = null;

  window.showQR = function (qrcode, bedLabel, roomName) {
    var container = document.getElementById('qr-container');
    var cap = document.getElementById('qr-caption');

    currentQRData = { qrcode, bedLabel, roomName };

    container.innerHTML = '';
    qrCodeInstance = null;

    if (typeof QRCode !== 'undefined' && qrcode) {
      qrCodeInstance = new QRCode(container, {
        text: qrcode,
        width: 280,
        height: 280,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      container.innerHTML = '<p class="text-muted">No hay código QR disponible</p>';
    }

    cap.textContent = `${roomName} - ${bedLabel}`;

    var qrEl = document.getElementById('qrModal');
    var modal = new bootstrap.Modal(qrEl);
    modal.show();
  };

  function downloadQR() {
    var container = document.getElementById('qr-container');
    var canvas = container.querySelector('canvas');
    var img = container.querySelector('img');

    if (!canvas && !img) {
      if (typeof Toast !== "undefined") {
        Toast.show('No hay código QR para descargar', 'info');
      } else {
        alert('No hay código QR para descargar');
      }
      return;
    }

    var link = document.createElement('a');
    var fileName = `QR_${currentQRData.roomName}_${currentQRData.bedLabel}`.replace(/\s+/g, '_');
    link.download = `${fileName}.png`;

    if (canvas) {
      link.href = canvas.toDataURL('image/png');
    } else if (img) {
      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      var ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      link.href = tempCanvas.toDataURL('image/png');
    }

    link.click();
  }

  function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str).replace(/[&<>\"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; });
  }

  function init() {
    var saveBtn = document.getElementById('bed-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', function (e) {
      e.preventDefault();
      saveBed();
    });

    var downloadBtn = document.getElementById('qr-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadQR);

    var paginationNav = document.getElementById('beds-pagination');
    if (paginationNav) paginationNav.addEventListener('click', handlePaginationClick);

    loadRooms();
    // Primero intentamos sincronizar cualquier cama pendiente
    syncQueuedBeds().then(() => {
      loadBeds();
    });

    // Cuando vuelva la conexión, sincronizar pendientes y recargar lista
    window.addEventListener("online", function () {
      syncQueuedBeds();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();



/*
(function(){
  'use strict';

  // Datos de ejemplo en memoria
  var bedsData = [
  ];

  var bedModal, qrModal;
  var editingId = null;

  function ensureBootstrapModals() {
    var qrEl = document.getElementById('qrModal');
    if (qrEl) qrModal = bootstrap.Modal.getInstance(qrEl) || new bootstrap.Modal(qrEl);
  }

  function getRoomsList() {
    if (Array.isArray(window.roomsData) && window.roomsData.length) {
      return window.roomsData;
    }
    // fallback básico si no existe roomsData
    return [
      { id: 1001, name: 'Habitación A', beds: 2 },
      { id: 1002, name: 'Habitación B', beds: 3 }
    ];
  }

  function renderRoomsSelect(selectedId) {
    var select = document.getElementById('bed-room');
    if (!select) return;
    var rooms = getRoomsList();
    select.innerHTML = '<option value="">Seleccione una habitación</option>' +
      rooms.map(function(r){
        var sel = (selectedId && selectedId === r.id) ? ' selected' : '';
        return '<option value="' + r.id + '"' + sel + '>' + r.name + '</option>';
      }).join('');
  }

  function loadBeds() {
    var tbody = document.getElementById('beds-table-body');
    if (!tbody) return;
    if (!bedsData.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Sin camas registradas</td></tr>';
      return;
    }
    tbody.innerHTML = bedsData.map(function(bed){
      var stateBadge = bed.occupied
        ? '<span class="state-badge state-occupied">Ocupada</span>'
        : '<span class="state-badge state-available">Disponible</span>';
      return (
        '<tr>'+
          '<td class="beds-id">' +
            '<i class="bi bi-bed me-2"></i>' +
            bed.bedNumber +
          '</td>'+
          '<td class="beds-room">' + bed.roomName + '</td>'+
          '<td class="beds-state">' + stateBadge + '</td>'+
          '<td class="text-end">' +
            '<button class="btn btn-qr" data-action="qr" data-id="' + bed.id + '"><i class="bi bi-qr-code me-2"></i>Ver QR</button>'+
          '</td>'+
        '</tr>'
      );
    }).join('');
  }

  function attachTableActions() {
    var tbody = document.getElementById('beds-table-body');
    if (!tbody) return;
    tbody.addEventListener('click', function(ev){
      var btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      var id = parseInt(btn.getAttribute('data-id'), 10);
      var action = btn.getAttribute('data-action');
      if (action === 'edit') openBedModal(id);
      else if (action === 'del') deleteBed(id);
      else if (action === 'qr') showQR(id);
    });
  }

  function openBedModal(id) {
    var title = document.getElementById('bedModalLabel');
    var saveBtn = document.getElementById('bed-save-btn');
    var roomSelect = document.getElementById('bed-room');
    var numberInput = document.getElementById('bed-number');
    var occupiedInput = document.getElementById('bed-occupied');

    renderRoomsSelect();

    if (id) {
      editingId = id;
      var bed = bedsData.find(function(b){ return b.id === id; });
      if (!bed) return;
      title.textContent = 'Editar Cama';
      saveBtn.textContent = 'Guardar Cambios';
      roomSelect.value = bed.roomId;
      numberInput.value = bed.bedNumber;
      occupiedInput.checked = !!bed.occupied;
    } else {
      editingId = null;
      title.textContent = 'Crear Cama';
      saveBtn.textContent = 'Guardar';
      roomSelect.value = '';
      numberInput.value = '';
      occupiedInput.checked = false;
    }

    var modalEl = document.getElementById('bedModal');
    var instance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    instance.show();
  }

  function saveBed() {
    var roomId = parseInt(document.getElementById('bed-room').value, 10);
    var number = parseInt(document.getElementById('bed-number').value, 10);
    var occupied = document.getElementById('bed-occupied').checked;

    if (!roomId) return alert('Seleccione una habitación');
    if (!number || number < 1) return alert('Indique un número de cama válido');

    var room = getRoomsList().find(function(r){ return r.id === roomId; });
    if (!room) return alert('Habitación inválida');

    if (editingId) {
      var bed = bedsData.find(function(b){ return b.id === editingId; });
      if (!bed) return;
      bed.roomId = room.id;
      bed.roomName = room.name;
      bed.bedNumber = number;
      bed.occupied = occupied;
      bed.qrData = buildQRData(bed);
    } else {
      var newBed = {
        id: Date.now(),
        roomId: room.id,
        roomName: room.name,
        bedNumber: number,
        occupied: occupied,
        qrData: ''
      };
      newBed.qrData = buildQRData(newBed);
      bedsData.push(newBed);
    }

    var modalEl = document.getElementById('bedModal');
    var instance = bootstrap.Modal.getInstance(modalEl);
    if (instance) instance.hide();
    loadBeds();
  }

  function deleteBed(id) {
    if (!confirm('¿Eliminar esta cama?')) return;
    bedsData = bedsData.filter(function(b){ return b.id !== id; });

    loadBeds();
  }

  function buildQRData(bed) {
    // Payload simple en JSON
    var payload = {
      id: bed.id,
      roomId: bed.roomId,
      roomName: bed.roomName,
      bedNumber: bed.bedNumber,
      occupied: bed.occupied
    };
    return JSON.stringify(payload);
  }

  function qrUrlFromData(data) {

    var enc = encodeURIComponent(data);
    return 'https://chart.googleapis.com/chart?cht=qr&chs=280x280&chl=' + enc + '&choe=UTF-8';
  }

  function showQR(id) {
    var bed = bedsData.find(function(b){ return b.id === id; });
    if (!bed) return;
    var img = document.getElementById('qr-image');
    var cap = document.getElementById('qr-caption');
    img.src = qrUrlFromData(bed.qrData || buildQRData(bed));
    cap.textContent = bed.roomName + ' - Cama ' + bed.bedNumber + (bed.occupied ? ' (Ocupada)' : ' (Libre)');
    if (!qrModal) ensureBootstrapModals();
    qrModal && qrModal.show();
  }

  function init() {
    // Listeners
    var saveBtn = document.getElementById('bed-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveBed);

    var createBtn = document.querySelector('[data-bs-target="#bedModal"]');
    if (createBtn) createBtn.addEventListener('click', function(){
      // Preparar formulario para creación; el modal se abrirá por data-bs-toggle
      var title = document.getElementById('bedModalLabel');
      var saveBtn = document.getElementById('bed-save-btn');
      renderRoomsSelect();
      editingId = null;
      if (title) title.textContent = 'Crear Cama';
      if (saveBtn) saveBtn.textContent = 'Guardar';
      var roomSelect = document.getElementById('bed-room');
      var numberInput = document.getElementById('bed-number');
      var occupiedInput = document.getElementById('bed-occupied');
      if (roomSelect) roomSelect.value = '';
      if (numberInput) numberInput.value = '';
      if (occupiedInput) occupiedInput.checked = false;
    });

    attachTableActions();
    loadBeds();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
*/
