(function () {

  const API_ROOMS = "http://localhost:8000/api/rooms";
  const API_ISLANDS = "http://localhost:8000/api/islands";

  function getToken() {
      return localStorage.getItem("token");
  }

  function getHeaders() {
      return {
          "Authorization": `Bearer ${getToken()}`,
          "Content-Type": "application/json"
      };
  }

  // =========================
  // POUCHDB SETUP
  // =========================
  const dbRooms  = new PouchDB("rooms_db");
  const dbAreas  = new PouchDB("areas_db");
  const dbOutbox = new PouchDB("outbox_db"); // cola de POST offline

  function roomDocId(id)   { return `room:${id}`; }
  function areaDocId(id)   { return `area:${id}`; }
  function tmpId(prefix)   { return `${prefix}:tmp:${Date.now()}:${Math.random().toString(16).slice(2)}`; }

  async function saveRoomsToDb(list) {
      if (!Array.isArray(list)) return;

      // 1) Reempaquetar habitaciones del server con _id estable
      const docs = list.map(r => ({
          _id: roomDocId(r.id),
          type: "room",
          data: r
      }));

      // 2) Para evitar conflictos, buscamos los existentes y ponemos _rev si aplica
      const existing = await dbRooms.allDocs({ include_docs: true });
      const revMap = new Map(existing.rows.map(x => [x.id, x.doc._rev]));

      docs.forEach(d => {
          if (revMap.has(d._id)) d._rev = revMap.get(d._id);
      });

      await dbRooms.bulkDocs(docs);
  }

  async function saveAreasToDb(list) {
      if (!Array.isArray(list)) return;

      const docs = list.map(a => ({
          _id: areaDocId(a.id),
          type: "area",
          data: a
      }));

      const existing = await dbAreas.allDocs({ include_docs: true });
      const revMap = new Map(existing.rows.map(x => [x.id, x.doc._rev]));

      docs.forEach(d => {
          if (revMap.has(d._id)) d._rev = revMap.get(d._id);
      });

      await dbAreas.bulkDocs(docs);
  }

  async function loadRoomsFromDb() {
      const res = await dbRooms.allDocs({ include_docs: true });
      return res.rows
          .map(r => r.doc.data)
          .filter(Boolean);
  }

  async function loadAreasFromDb() {
      const res = await dbAreas.allDocs({ include_docs: true });
      return res.rows
          .map(r => r.doc.data)
          .filter(Boolean);
  }

  async function addPendingToOutbox(kind, payload) {
      // kind: "room" | "area"
      const doc = {
          _id: tmpId(kind),
          kind,
          payload,
          createdAt: new Date().toISOString()
      };
      await dbOutbox.put(doc);
  }

  async function addRoomToLocalCache(payload, areasRef) {
      // payload viene como {name, beds, islandId}
      // Creamos una "habitación fake" para UI offline.
      const island = areasRef.find(a => a.id == payload.islandId) || null;

      const localRoom = {
          id: tmpId("localRoom"),   // id temporal
          name: payload.name,
          beds: new Array(payload.beds).fill({}), // simula beds.length
          island: island ? { id: island.id, name: island.name } : null,
          _offline: true
      };

      const doc = {
          _id: roomDocId(localRoom.id),
          type: "room",
          data: localRoom
      };

      try {
          await dbRooms.put(doc);
      } catch (e) {
          // si existe, actualiza
          const old = await dbRooms.get(doc._id);
          doc._rev = old._rev;
          await dbRooms.put(doc);
      }

      return localRoom;
  }

  async function addAreaToLocalCache(payload) {
      const localArea = {
          id: tmpId("localArea"),
          name: payload.name,
          description: payload.description || "",
          _offline: true
      };

      const doc = {
          _id: areaDocId(localArea.id),
          type: "area",
          data: localArea
      };

      try {
          await dbAreas.put(doc);
      } catch (e) {
          const old = await dbAreas.get(doc._id);
          doc._rev = old._rev;
          await dbAreas.put(doc);
      }

      return localArea;
  }

  // Enviar pendientes cuando regresa internet
  async function flushOutbox() {
      const pending = await dbOutbox.allDocs({ include_docs: true });
      if (!pending.rows.length) return;

      for (const row of pending.rows) {
          const doc = row.doc;
          try {
              if (doc.kind === "room") {
                  const resp = await fetch(API_ROOMS, {
                      method: "POST",
                      headers: getHeaders(),
                      body: JSON.stringify(doc.payload)
                  });
                  if (!resp.ok) throw new Error("POST room failed");
              }

              if (doc.kind === "area") {
                  const resp = await fetch(API_ISLANDS, {
                      method: "POST",
                      headers: getHeaders(),
                      body: JSON.stringify(doc.payload)
                  });
                  if (!resp.ok) throw new Error("POST area failed");
              }

              // si éxito, borramos de outbox
              await dbOutbox.remove(doc);

          } catch (e) {
              // Si falla uno, no paramos toda la cola, pero lo dejamos ahí
              console.warn("Pendiente no enviado aún:", doc._id, e.message);
          }
      }

      // refrescamos desde server para obtener ids reales
      loadAreas();
      loadRooms();
  }

  // escuchar reconexión
  window.addEventListener("online", () => {
      flushOutbox();
  });

  // =========================
  // TU CÓDIGO ORIGINAL
  // =========================
  let rooms = [];
  let areas = [];
  let editingId = null;

  let tableBody;
  let modalEl;
  let modalTitle;
  let inputName;
  let inputBeds;
  let selectArea;
  let saveBtn;

  let areaModalEl;
  let newAreaInput;
  let newAreaDesc;
  let newAreaAddBtn;
  let areaList;

  // 1. Cargar Islas (Areas)
  async function loadAreas() {
      try {
          const response = await fetch(API_ISLANDS, { method: "GET", headers: getHeaders() });
          if (response.ok) {
              const result = await response.json();
              areas = result.data || [];
              renderAreaOptions();
              renderAreaList();

              // guardar cache online
              saveAreasToDb(areas);
              return;
          }
      } catch (e) {
          console.warn("Offline o error cargando islas, usando cache local");
      }

      // fallback offline
      try {
          areas = await loadAreasFromDb();
          renderAreaOptions();
          renderAreaList();
      } catch (e2) {
          console.error("No se pudo leer islas locales", e2);
      }
  }

  async function loadRooms() {
      try {
          const response = await fetch(API_ROOMS, { method: "GET", headers: getHeaders() });
          if (response.ok) {
              const result = await response.json();
              rooms = result.data || [];
              renderTable();

              // guardar cache online
              saveRoomsToDb(rooms);
              return;
          }
      } catch (e) {
          console.warn("Offline o error cargando habitaciones, usando cache local");
      }

      // fallback offline
      try {
          rooms = await loadRoomsFromDb();
          renderTable();
      } catch (e2) {
          console.error("No se pudo leer habitaciones locales", e2);
      }
  }

  const renderTable = () => {
      if (!tableBody) return;
      tableBody.innerHTML = '';

      if (rooms.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Sin habitaciones registradas</td></tr>`;
          return;
      }

      rooms.forEach((room) => {
          const tr = document.createElement('tr');

          const islandName = room.island ? room.island.name : 'Sin Asignar';
          const bedsCount = room.beds ? room.beds.length : 0;

          tr.innerHTML = `
              <td>
                <div class="fw-semibold">${escapeHtml(room.name)}</div>
                <div class="small text-muted">Isla: ${escapeHtml(islandName)}</div>
                ${room._offline ? `<div class="small text-warning">Pendiente de sincronizar</div>` : ``}
              </td>
              <td>${bedsCount}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-secondary me-2" data-action="edit" data-id="${room.id}">
                  <i class="bi bi-pencil-square"></i>
                </button>
              </td>
          `;
          tableBody.appendChild(tr);
      });
  };

  // Opciones del Select (En Modal Crear Habitación)
  const renderAreaOptions = (selectedId) => {
      if (!selectArea) return;
      selectArea.innerHTML = '<option value="">Seleccione una isla...</option>';

      const frag = document.createDocumentFragment();

      areas.forEach((area) => {
          const opt = document.createElement('option');
          opt.value = area.id;
          opt.textContent = area.name;

          if (selectedId && selectedId == area.id) opt.selected = true;
          frag.appendChild(opt);
      });
      selectArea.appendChild(frag);
  };

  const renderAreaList = () => {
      if (!areaList) return;
      areaList.innerHTML = '';

      if (areas.length === 0) {
          const li = document.createElement('li');
          li.className = 'list-group-item text-muted';
          li.textContent = 'No hay islas registradas';
          areaList.appendChild(li);
          return;
      }

      areas.forEach((area) => {
          const li = document.createElement('li');
          li.className = 'list-group-item d-flex justify-content-between align-items-center';
          li.innerHTML = `
              <div>
                  <span class="fw-bold">${escapeHtml(area.name)}</span>
                  <br><small class="text-muted">${escapeHtml(area.description || '')}</small>
                  ${area._offline ? `<div class="small text-warning">Pendiente de sincronizar</div>` : ``}
              </div>
          `;
          areaList.appendChild(li);
      });
  };

  const onSaveArea = async () => {
      const name = (newAreaInput?.value || '').trim();
      const desc = (newAreaDesc?.value || '').trim();
      if (!name) return;

      const payload = { name: name, description: desc };

      // OFFLINE directo
      if (!navigator.onLine) {
          try {
              await addPendingToOutbox("area", payload);
              const localArea = await addAreaToLocalCache(payload);
              areas.push(localArea);
              renderAreaOptions();
              renderAreaList();
              newAreaInput.value = '';
              newAreaDesc.value = '';
              Toast.show("Isla guardada offline. Se sincronizará al volver internet.", "success");
              return;
          } catch (e) {
              console.error(e);
              Toast.show("No se pudo guardar offline", "error");
              return;
          }
      }

      try {
          const response = await fetch(API_ISLANDS, {
              method: "POST",
              headers: getHeaders(),
              body: JSON.stringify(payload)
          });

          if (response.ok) {
              newAreaInput.value = '';
              newAreaDesc.value = '';
              loadAreas();
          } else {
              Toast.show("Error al crear la isla","error");
          }
      } catch (e) {
          // Si falla online → fallback offline
          try {
              await addPendingToOutbox("area", payload);
              const localArea = await addAreaToLocalCache(payload);
              areas.push(localArea);
              renderAreaOptions();
              renderAreaList();
              Toast.show("Isla guardada offline. Se sincronizará al volver internet.", "success");
          } catch (e2) {
              console.error(e2);
              Toast.show("No se pudo guardar offline", "error");
          }
      }
  };

  const onSaveRoom = async () => {
      const name = (inputName?.value || '').trim();
      const beds = parseInt(inputBeds?.value || '0', 10);
      const islandId = selectArea ? selectArea.value : '';

      if (!name) { Toast.show("El nombre es obligatorio", "error");return; }
      if (!Number.isFinite(beds) || beds <= 0) {Toast.show("Minimo 1 cama en la habitación"); return; }
      if (!islandId) { Toast.show("Por favow seleccione una isla"); return; }

      const payload = {
          name: name,
          beds: beds,
          islandId: parseInt(islandId)
      };

      if (editingId) {
          Toast.show("Funcionalidad de edición no implementada","error");
          return;
      }

      // OFFLINE directo
      if (!navigator.onLine) {
          try {
              await addPendingToOutbox("room", payload);
              const localRoom = await addRoomToLocalCache(payload, areas);
              rooms.push(localRoom);
              renderTable();

              Toast.show("Habitación guardada offline. Se sincronizará al volver internet.", "success");

              if (window.bootstrap && modalEl) {
                  const modal = bootstrap.Modal.getInstance(modalEl);
                  modal.hide();
              }
              resetForm();
              return;
          } catch (e) {
              console.error(e);
              Toast.show("No se pudo guardar offline", "error");
              return;
          }
      }

      try {
          const response = await fetch(API_ROOMS, {
              method: "POST",
              headers: getHeaders(),
              body: JSON.stringify(payload)
          });

          if (response.ok) {
              const res = await response.json();
              console.log("Habitación creada con camas:", res.data);
              Toast.show("Habitación creada con éxito","success");
              if (window.bootstrap && modalEl) {
                  const modal = bootstrap.Modal.getInstance(modalEl);
                  modal.hide();
              }
              resetForm();
              loadRooms();
          } else {
              const err = await response.json();
              Toast.show(err.message,"error" || "Error al crear la habitación","error");
          }
      } catch (e) {
          // Si falla online → fallback offline
          try {
              await addPendingToOutbox("room", payload);
              const localRoom = await addRoomToLocalCache(payload, areas);
              rooms.push(localRoom);
              renderTable();

              Toast.show("Habitación guardada offline. Se sincronizará al volver internet.", "success");

              if (window.bootstrap && modalEl) {
                  const modal = bootstrap.Modal.getInstance(modalEl);
                  modal.hide();
              }
              resetForm();
          } catch (e2) {
              console.error(e2);
              Toast.show("Ah ocurrido un error","error");
          }
      }
  };

  const resetForm = () => {
      editingId = null;
      if (inputName) inputName.value = '';
      if (inputBeds) inputBeds.value = '';
      if (selectArea) selectArea.value = '';
      if (modalTitle) modalTitle.textContent = 'Crear Habitación';
      if (saveBtn) saveBtn.textContent = 'Guardar';
  };

  const openEdit = (room) => {
      editingId = room.id;
      if (modalTitle) modalTitle.textContent = 'Editar Habitación';
      if (saveBtn) saveBtn.textContent = 'Actualizar';

      if (inputName) inputName.value = room.name;
      if (inputBeds) inputBeds.value = room.beds ? room.beds.length : 0;

      renderAreaOptions(room.island ? room.island.id : null);

      if (window.bootstrap && modalEl) {
          const modal = new bootstrap.Modal(modalEl);
          modal.show();
      }
  };

  function escapeHtml(str) {
      if (!str && str !== 0) return '';
      return String(str).replace(/[&<>\"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
  }

  const bindTableEvents = () => {
      if (!tableBody) return;
      tableBody.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const id = btn.getAttribute('data-id');
          const action = btn.getAttribute('data-action');
          const room = rooms.find((r) => r.id == id);

          if (room && action === 'edit') {
              openEdit(room);
          }
      });
  };

  const bindAreaModal = () => {
      if (!areaModalEl) return;

      areaModalEl.addEventListener('show.bs.modal', () => {
          if (newAreaInput) newAreaInput.value = '';
          if (newAreaDesc) newAreaDesc.value = '';
          loadAreas();
      });

      if (newAreaAddBtn) {
          newAreaAddBtn.addEventListener('click', onSaveArea);
      }
  };

  const bindModalOpenForCreate = () => {
      if (!modalEl) return;
      modalEl.addEventListener('show.bs.modal', (event) => {
          if (!event.relatedTarget || !event.relatedTarget.getAttribute('data-action')) {
               if (!editingId) resetForm();
          }
      });
  };

  const init = () => {
      tableBody = document.getElementById('rooms-table-body');
      if (!tableBody) return;

      modalEl = document.getElementById('roomModal');
      modalTitle = document.getElementById('roomModalLabel');
      inputName = document.getElementById('room-name');
      inputBeds = document.getElementById('room-beds');
      selectArea = document.getElementById('room-area-select');
      saveBtn = document.getElementById('room-save-btn');

      areaModalEl = document.getElementById('areaModal');
      newAreaInput = document.getElementById('new-area-name');
      newAreaDesc = document.getElementById('new-area-description');
      newAreaAddBtn = document.getElementById('new-area-add-btn');
      areaList = document.getElementById('area-list');

      // Carga inicial
      loadAreas();
      loadRooms();

      // Si ya está online al arrancar, intenta vaciar cola (por si quedó pendiente)
      if (navigator.onLine) flushOutbox();

      // Listeners
      bindTableEvents();
      bindModalOpenForCreate();
      bindAreaModal();

      if (saveBtn) saveBtn.addEventListener('click', onSaveRoom);
  };

  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
  } else {
      init();
  }
})();


/*
  Gestión de Habitaciones (in-memory)
  - Lista, crea y edita habitaciones
  - Gestión de Áreas (solo selección en formulario de habitación; creación en modal aparte)
  - Sin backend; persiste en localStorage para mantener el estado entre recargas
  - Conectado a modules/admin/rooms-content.html

(function () {
  const LS_KEYS = {
    ROOMS: 'adm.rooms',
    AREAS: 'adm.areas',
  };

  // Estado
  let rooms = [];
  let areas = [];
  let editingId = null; // id de la habitación en edición

  // DOM refs (se resuelven en init, ya que el contenido se inyecta dinámicamente)
  let tableBody;
  let modalEl; // #roomModal
  let modalTitle; // #roomModalLabel
  let inputName; // #room-name
  let inputBeds; // #room-beds
  let selectArea; // #room-area-select
  let saveBtn; // #room-save-btn

  // Modal de Áreas
  let areaModalEl; // #areaModal
  let newAreaInput; // #new-area-name
  let newAreaAddBtn; // #new-area-add-btn
  let areaList; // #area-list

  // Utilidades
  const uid = () => Math.random().toString(36).slice(2, 9);

  const loadState = () => {
    try {
      rooms = JSON.parse(localStorage.getItem(LS_KEYS.ROOMS) || '[]');
      areas = JSON.parse(localStorage.getItem(LS_KEYS.AREAS) || '[]');
      if (!Array.isArray(areas) || areas.length === 0) {
        // Semillas por defecto
        areas = ['Cardiología', 'Pediatría', 'General'];
      }
      if (!Array.isArray(rooms)) rooms = [];
    } catch (e) {
      rooms = [];
      areas = ['General'];
    }
  };

  const saveState = () => {
    localStorage.setItem(LS_KEYS.ROOMS, JSON.stringify(rooms));
    localStorage.setItem(LS_KEYS.AREAS, JSON.stringify(areas));
  };

  // Renderizado de tabla
  const renderTable = () => {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (rooms.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Sin habitaciones registradas</td></tr>`;
      return;
    }

    rooms.forEach((room) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${room.name}</div>
          <div class="small text-muted">Área: ${room.area}</div>
        </td>
        <td>${room.beds}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary me-2" data-action="edit" data-id="${room.id}">
            <i class="bi bi-pencil-square"></i>
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  };

  // Renderizado de opciones de áreas en el select del modal de habitación
  const renderAreaOptions = (selected) => {
    if (!selectArea) return;
    selectArea.innerHTML = '';
    const frag = document.createDocumentFragment();
    areas.sort((a, b) => a.localeCompare(b)).forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      if (selected && selected === a) opt.selected = true;
      frag.appendChild(opt);
    });
    selectArea.appendChild(frag);
  };

  // Renderizado del listado de áreas en el modal de áreas
  const renderAreaList = () => {
    if (!areaList) return;
    areaList.innerHTML = '';
    const sorted = [...areas].sort((a, b) => a.localeCompare(b));
    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-group-item text-muted';
      li.textContent = 'No hay áreas registradas';
      areaList.appendChild(li);
      return;
    }
    sorted.forEach((name) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.innerHTML = `<span>${name}</span>`;
      areaList.appendChild(li);
    });
  };

  // Limpia el formulario de habitación
  const resetForm = () => {
    editingId = null;
    inputName && (inputName.value = '');
    inputBeds && (inputBeds.value = '');
    renderAreaOptions();
    if (selectArea && areas[0]) selectArea.value = areas[0];
    if (modalTitle) modalTitle.textContent = 'Crear Habitación';
    if (saveBtn) saveBtn.textContent = 'Guardar';
  };

  // Abrir modal en modo edición
  const openEdit = (room) => {
    editingId = room.id;
    if (modalTitle) modalTitle.textContent = 'Editar Habitación';
    if (saveBtn) saveBtn.textContent = 'Actualizar';

    inputName && (inputName.value = room.name);
    inputBeds && (inputBeds.value = room.beds);
    renderAreaOptions(room.area);

    // Abrir modal vía Bootstrap
    if (window.bootstrap && modalEl) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    } else if (modalEl) {
      modalEl.classList.add('show');
    }
  };

  // Guardar (crear o actualizar)
  const onSave = () => {
    const name = (inputName?.value || '').trim();
    const beds = parseInt(inputBeds?.value || '0', 10);
    const area = selectArea ? selectArea.value : '';

    if (!name) {
      alert('El nombre es obligatorio');
      return;
    }
    if (!Number.isFinite(beds) || beds < 0) {
      alert('Número de camas inválido');
      return;
    }
    if (!area) {
      alert('Selecciona un área');
      return;
    }

    if (editingId) {
      rooms = rooms.map((r) => (r.id === editingId ? { ...r, name, beds, area } : r));
    } else {
      rooms.push({ id: uid(), name, beds, area });
    }

    saveState();
    renderTable();

    // Cerrar modal
    if (window.bootstrap && modalEl) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.hide();
    }
    resetForm();
  };

  // Delegación de eventos en la tabla
  const bindTableEvents = () => {
    if (!tableBody) return;
    tableBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const room = rooms.find((r) => r.id === id);
      if (!room) return;

      if (action === 'edit') {
        openEdit(room);
      }
    });
  };

  // Modal de creación de áreas: bindings
  const bindAreaModal = () => {
    if (!areaModalEl) return;

    // Al mostrar el modal, listar áreas y limpiar input
    areaModalEl.addEventListener('show.bs.modal', () => {
      if (newAreaInput) newAreaInput.value = '';
      renderAreaList();
    });

    // Botón Agregar área
    if (newAreaAddBtn) {
      newAreaAddBtn.addEventListener('click', () => {
        const val = (newAreaInput?.value || '').trim();
        if (!val) return;
        if (!areas.includes(val)) {
          areas.push(val);
          areas.sort((a, b) => a.localeCompare(b));
          saveState();
        }
        // Actualizar UI
        renderAreaOptions(val); // seleccionar la recién creada
        renderAreaList();
        if (newAreaInput) newAreaInput.value = '';
      });
    }
  };

  // Hook: al abrir el modal de habitación desde el botón Crear Habitación
  const bindModalOpenForCreate = () => {
    if (!modalEl) return;
    modalEl.addEventListener('show.bs.modal', () => {
      // Solo reiniciar cuando se abre en modo creación
      if (!editingId) resetForm();
    });
  };

  // Init
  const init = () => {
    // Resolver refs cada vez, porque el contenido se inyecta dinámicamente
    tableBody = document.getElementById('rooms-table-body');
    if (!tableBody) return; // No estamos en la pantalla de rooms

    modalEl = document.getElementById('roomModal');
    modalTitle = document.getElementById('roomModalLabel');
    inputName = document.getElementById('room-name');
    inputBeds = document.getElementById('room-beds');
    selectArea = document.getElementById('room-area-select');
    saveBtn = document.getElementById('room-save-btn');

    // Modal Áreas
    areaModalEl = document.getElementById('areaModal');
    newAreaInput = document.getElementById('new-area-name');
    newAreaAddBtn = document.getElementById('new-area-add-btn');
    areaList = document.getElementById('area-list');

    loadState();
    renderTable();
    renderAreaOptions();
    bindTableEvents();
    bindModalOpenForCreate();
    bindAreaModal();
    if (saveBtn) saveBtn.addEventListener('click', onSave);
  };

  // Importante: en SPA, el script puede ejecutarse después del DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
*/