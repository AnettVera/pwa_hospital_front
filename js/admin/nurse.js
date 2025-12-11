(function () {
  "use strict";

  // Usa configuración centralizada desde config.js
  const API_URL = API_ENDPOINTS.NURSES;
  const tableBody = document.getElementById("nurse-table-body");
  const saveBtn = document.getElementById("save-nurse-btn");
  const inputId = document.getElementById("nurse-id");
  const inputName = document.getElementById("nurse-name");
  const inputSurnames = document.getElementById("nurse-surnames");
  const inputUsername = document.getElementById("nurse-username");
  const inputPassword = document.getElementById("nurse-password");

  let currentNurses = [];

  // --- PouchDB: bases de datos para cache y cola de pendientes ---
  let nurseCacheDb = null;
  let nurseQueueDb = null;

  if (typeof PouchDB !== "undefined") {
    nurseCacheDb = new PouchDB("nurses-cache");
    nurseQueueDb = new PouchDB("nurses-queue");
  } else {
    console.warn(
      "PouchDB no está disponible. Modo offline deshabilitado para enfermeros."
    );
  }

  // Id temporal estilo patients.js
  function genTempId() {
    return `temp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function getToken() {
    return localStorage.getItem("token");
  }

  function getHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    };
  }

  // ----------------- Helpers PouchDB (cache) -----------------

  async function saveNursesToCache(nurses) {
    if (!nurseCacheDb) return;
    try {
      let doc;
      try {
        doc = await nurseCacheDb.get("nurses_list");
      } catch (err) {
        if (err.status === 404) {
          doc = { _id: "nurses_list", type: "nurses_list" };
        } else {
          throw err;
        }
      }

      doc.nurses = nurses || [];
      doc.updatedAt = new Date().toISOString();
      await nurseCacheDb.put(doc);
    } catch (error) {
      console.error("Error al guardar enfermeros en cache PouchDB:", error);
    }
  }

  async function loadNursesFromCache() {
    if (!nurseCacheDb) {
      console.warn("PouchDB no disponible para leer la cache de enfermeros.");
      renderNurses([]); // por si acaso
      return;
    }

    try {
      const doc = await nurseCacheDb.get("nurses_list");
      currentNurses = doc.nurses || [];
      renderNurses(currentNurses);
      // Opcional: informar al usuario
      // Toast.show("Mostrando enfermeros desde almacenamiento local.", "info");
    } catch (error) {
      if (error.status === 404) {
        console.info("No hay enfermeros cacheados en PouchDB.");
        currentNurses = [];
        renderNurses([]);
      } else {
        console.error("Error al leer enfermeros desde PouchDB:", error);
      }
    }
  }

  // ----------------- Helpers PouchDB (cola de pendientes) -----------------

  async function queueCreateNurse(data) {
    if (!nurseQueueDb) return;
    try {
      await nurseQueueDb.post({
        type: "CREATE",
        entity: "nurse",
        payload: data,
        createdAt: new Date().toISOString(),
        status: "pending",
      });
    } catch (error) {
      console.error("Error al encolar enfermero en PouchDB:", error);
    }
  }

  async function syncQueuedNurses() {
    if (!nurseQueueDb || !navigator.onLine) return;

    try {
      const result = await nurseQueueDb.allDocs({ include_docs: true });
      if (!result.rows.length) return;

      console.info("Sincronizando enfermeros pendientes...");

      for (const row of result.rows) {
        const doc = row.doc;
        if (!doc || doc.status === "done") continue;
        if (doc.type !== "CREATE" || doc.entity !== "nurse") continue;

        const payload = doc.payload;
        if (!payload) continue;

        try {
          const response = await fetch(API_URL, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            await nurseQueueDb.remove(doc);
          } else {
            console.error(
              "Error al sincronizar un enfermero en cola:",
              response.status,
              response.statusText
            );
          }
        } catch (error) {
          console.error(
            "Error de red al sincronizar un enfermero en cola:",
            error
          );
        }
      }

      // Después de intentar sincronizar, recargamos desde el servidor
      await loadNurses();
      Toast.show(
        "Se sincronizaron los enfermeros pendientes (si había alguno).",
        "success"
      );
    } catch (error) {
      console.error("Error general al sincronizar enfermeros en cola:", error);
    }
  }

  // ----------------- Carga de enfermeros (GET con cache) -----------------

  async function loadNurses() {
    // Si estamos claramente offline -> leer desde cache directamente
    if (!navigator.onLine) {
      console.info("Sin conexión, cargando enfermeros desde PouchDB.");
      await loadNursesFromCache();
      return;
    }

    try {
      const response = await fetch(API_URL, {
        method: "GET",
        headers: getHeaders(),
      });

      if (response.ok) {
        const result = await response.json();
        currentNurses = result.data;
        renderNurses(currentNurses);
        // Guardar en cache para uso offline futuro
        saveNursesToCache(currentNurses);
      } else {
        console.error(
          "Error al cargar los enfermeros desde el servidor:",
          response.statusText
        );
        // Fallback a cache si algo falla
        await loadNursesFromCache();
      }
    } catch (error) {
      console.error("Error de conexión al cargar los enfermeros:", error);
      // Fallback a cache si hay error de red
      await loadNursesFromCache();
    }
  }

  // ----------------- Render con badge Pendiente -----------------

  function renderNurses(nurses) {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!nurses || nurses.length === 0) {
      tableBody.innerHTML =
        '<tr><td colspan="3" class="text-muted">No hay enfermeros registrados.</td></tr>';
      return;
    }

    nurses.forEach(function (nurse) {
      const nurseId =
        nurse.id != null ? String(nurse.id) : nurse.tempId || nurse.id || "";

      const isPending =
        nurse.pending === true ||
        (typeof nurseId === "string" && nurseId.startsWith("temp_")) ||
        nurse._localOnly === true;

      const pendingBadge = isPending
        ? ' <span class="badge text-bg-warning">Pendiente</span>'
        : "";

      var tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(nurse.name)} ${escapeHtml(
        nurse.surnames
      )}${pendingBadge}</td>
        <td>${escapeHtml(nurse.user && nurse.user.username)}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary me-2 edit-nurse-btn" data-id="${escapeHtml(
            nurseId
          )}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger delete-nurse-btn" data-id="${escapeHtml(
            nurseId
          )}"><i class="bi bi-trash"></i></button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (!str && str !== 0) return "";
    return String(str).replace(/[&<>\"']/g, function (m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m];
    });
  }

  // ----------------- Alta de enfermeros (POST + cola offline + pendiente) -----------------

  async function addNurse(data) {
    // SIN CONEXIÓN: guardar en cola + marcar pendiente
    if (!navigator.onLine) {
      await queueCreateNurse(data);

      const tempId = genTempId();

      const localNurse = {
        id: tempId, // para usar en data-id
        tempId,
        name: data.name,
        surnames: data.surnames,
        user: { username: data.username },
        pending: true,
        _localOnly: true,
      };

      currentNurses.push(localNurse);
      renderNurses(currentNurses);
      saveNursesToCache(currentNurses);

      Toast.show(
        "Sin conexión. El enfermero se guardó localmente y se enviará al servidor cuando vuelva la conexión.",
        "info"
      );
      closeModal();
      clearForm();
      return;
    }

    // CON CONEXIÓN: intentar POST normal
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(data),
      });

      if (response.ok) {
        Toast.show("Enfermero registrado correctamente", "success");
        await loadNurses(); // recarga lista + actualiza cache
        closeModal();
        clearForm();
      } else {
        console.error("Error al registrar el enfermero:", response.statusText);
        Toast.show(
          "Error al registrar el enfermero. Por favor intente nuevamente.",
          "error"
        );
      }
    } catch (error) {
      console.error("Error al registrar el enfermero:", error);

      // Error de red: tratamos como offline -> cola + pendiente
      await queueCreateNurse(data);

      const tempId = genTempId();

      const localNurse = {
        id: tempId,
        tempId,
        name: data.name,
        surnames: data.surnames,
        user: { username: data.username },
        pending: true,
        _localOnly: true,
      };

      currentNurses.push(localNurse);
      renderNurses(currentNurses);
      saveNursesToCache(currentNurses);

      Toast.show(
        "Error de conexión con el servidor. El enfermero se guardó localmente y se enviará cuando vuelva la conexión.",
        "info"
      );

      closeModal();
      clearForm();
    }
  }

  // ----------------- Update / Delete (de momento sólo online) -----------------

  async function updateNurse(id, data) {
    // Podrías extender aquí la cola para PUT, pero por ahora lo dejamos online-only.
    if (!navigator.onLine) {
      Toast.show(
        "Para actualizar un enfermero necesitas conexión a internet.",
        "info"
      );
      return;
    }

    try {
      const response = await fetch(`${API_URL}/${id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(data),
      });

      if (response.ok) {
        Toast.show("Enfermero actualizado correctamente", "success");
        await loadNurses();
        closeModal();
        clearForm();
      } else {
        console.error("Error al actualizar el enfermero:", response.statusText);
        Toast.show(
          "Error al actualizar el enfermero. Por favor intente nuevamente.",
          "error"
        );
      }
    } catch (error) {
      console.error("Error al actualizar el enfermero:", error);
      Toast.show(
        "Error de conexión con el servidor. Por favor intente nuevamente.",
        "error"
      );
    }
  }

  async function deleteNurse(id) {
    // De momento sólo permitimos borrar online (más simple)
    if (!navigator.onLine) {
      Toast.show(
        "Para eliminar un enfermero necesitas conexión a internet.",
        "info"
      );
      return;
    }

    try {
      const response = await fetch(`${API_URL}/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });

      if (response.ok) {
        Toast.show("Enfermero eliminado correctamente", "success");
        await loadNurses();
      } else {
        console.error("Error al eliminar el enfermero:", response.statusText);
        Toast.show(
          "Error al eliminar el enfermero. Por favor intente nuevamente.",
          "error"
        );
      }
    } catch (error) {
      console.error("Error al eliminar el enfermero:", error);
      Toast.show(
        "Error de conexión con el servidor. Por favor intente nuevamente.",
        "error"
      );
    }
  }

  // ----------------- Utilidades de formulario -----------------

  function getNurseById(id) {
    return (
      currentNurses.find(function (nurse) {
        const nurseId =
          nurse.id != null ? String(nurse.id) : nurse.tempId || nurse.id || "";
        return String(nurseId) === String(id);
      }) || null
    );
  }

  function clearForm() {
    inputId.value = "";
    inputName.value = "";
    inputSurnames.value = "";
    inputUsername.value = "";
    inputPassword.value = "";

    if (saveBtn) saveBtn.textContent = "Registrar Enfermero";
  }

  function populateForm(nurse) {
    if (!nurse) return;
    const nurseId =
      nurse.id != null ? String(nurse.id) : nurse.tempId || nurse.id || "";
    inputId.value = nurseId;
    inputName.value = nurse.name || "";
    inputSurnames.value = nurse.surnames || "";
    inputUsername.value = nurse.user ? nurse.user.username : "";
    inputPassword.value = "";

    if (saveBtn) saveBtn.textContent = "Guardar Cambios";
  }

  function closeModal() {
    var modalEl = document.getElementById("modalEnfermero");
    if (modalEl && typeof bootstrap !== "undefined") {
      var m =
        bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      m.hide();
    }
  }

  async function handleSaveClick() {
    var id = inputId.value;
    var name = inputName.value.trim();
    var surnames = inputSurnames.value.trim();
    var username = inputUsername.value.trim();
    var password = inputPassword.value.trim();

    if (!name || !surnames || !username) {
      Toast.show("Todos los campos son obligatorios", "error");
      return;
    }

    if (!id && !password) {
      Toast.show(
        "La contraseña es obligatoria para un nuevo enfermero",
        "error"
      );
      return;
    }

    var payload = {
      name: name,
      surnames: surnames,
      username: username,
      password: password,
    };

    if (!id) {
      await addNurse(payload);
    } else {
      await updateNurse(id, payload);
    }
  }

  // ----------------- Inicialización y eventos -----------------

  function init() {
    // Intentar sincronizar si hay conexión al cargar la página
    syncQueuedNurses();
    loadNurses();

    if (tableBody) {
      tableBody.addEventListener("click", function (ev) {
        var editBtn = ev.target.closest(".edit-nurse-btn");
        if (editBtn) {
          if (!navigator.onLine) {
            Toast.show(
              "Para editar un enfermero necesitas conexión a internet.",
              "info"
            );
            return;
          }
          var id = editBtn.getAttribute("data-id");
          var nurse = getNurseById(id);
          if (nurse) {
            populateForm(nurse);
            var modalEl = document.getElementById("modalEnfermero");
            if (modalEl && typeof bootstrap !== "undefined") {
              var m = new bootstrap.Modal(modalEl);
              m.show();
            }
          }
          return;
        }

        var delBtn = ev.target.closest(".delete-nurse-btn");
        if (delBtn) {
          if (!navigator.onLine) {
            Toast.show(
              "Para eliminar un enfermero necesitas conexión a internet.",
              "info"
            );
            return;
          }

          var id2 = delBtn.getAttribute("data-id");
          Toast.show(
            "¿Está seguro de que desea eliminar este enfermero?",
            "modification",
            () => {
              deleteNurse(id2);
            },
            () => {
              Toast.show("Operación cancelada", "info");
            }
          );

          return;
        }
      });
    }

    if (saveBtn)
      saveBtn.addEventListener("click", function (e) {
        e.preventDefault();
        handleSaveClick();
      });

    var addBtn = document.querySelector(
      'button[data-bs-target="#modalEnfermero"]'
    );
    if (addBtn) {
      addBtn.addEventListener("click", function (e) {
        e.preventDefault();
        clearForm();
      });
    }

    // Cuando vuelva la conexión, sincronizar pendientes y recargar lista
    window.addEventListener("online", function () {
      syncQueuedNurses();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 30);
  }
})();

/*
        if(!name || !surnames || !username || !password){
            alert("Todos los campos son requeridos.");
            return;
        }

        var payload = { name: name, surnames: surnames, username: username, password: password };
        
        
        
document.addEventListener("DOMContentLoaded", () => {

const API_URL = "http://localhost:8080/api/nurses/";
const token = localStorage.getItem("token");

const tableBody = document.getElementById("nurse-table-body");
const saveBtn = document.getElementById("save-nurse-btn");
    
const inputId = document.getElementById("nurse-id");
const inputName = document.getElementById("nurse-name");
const inputSurnames = document.getElementById("nurse-surnames");
const inputUsername = document.getElementById("nurse-username");
const inputPassword = document.getElementById("nurse-password");

init();

function init() {};

async function loadNurses() {
    try {
        const response = await fetch(API_URL, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": Bearer ${token}
            }
        });

        if (response.ok) {
            const result = await response.json();
            const list = result.data;
            renderTable(list);
        } else {
            console.error("Error al cargar los enfermeros:", response.statusText);
        }

    } catch (error) {
        console.error("Error al cargar los enfermeros:", error);
    }
};

function renderTable(nurses) {
    tableBody.innerHTML = '';
    if (nurses.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-muted">No hay enfermeros registrados.</td></tr>';
        return;
    }

    nurses.forEach(nurse => {
        const displayFullName = ${nurse.name} ${nurse.surnames};
        const displayUser = nurse.username;

        const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${displayFullName}</td>
                <td>${displayUser}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary me-2"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
    });
};

});
((function(){
    'use strict';

    var STORAGE_KEY = 'hospital_nourses_v1';

    // Cargar datos de enfermeros desde localStorage
    function loadNourses(){
        try{
            var raw = localStorage.getItem(STORAGE_KEY);
            // Si no hay datos, devuelve una lista con un enfermero de ejemplo
            if (!raw) {
                return [
                    { id: '1', name: 'Laura', lastname: 'García', email: 'laura.garcia@hospital.com' },
                    { id: '2', name: 'Carlos', lastname: 'Martínez', email: 'carlos.martinez@hospital.com' }
                ];
            }
            return JSON.parse(raw);
        }catch(e){
            console.error('Error parsing nourses from storage', e);
            return [];
        }
    }

    // Guardar lista de enfermeros en localStorage
    function saveNourses(list){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    // Generar un ID único para un nuevo enfermero
    function getNextId(){
        return Date.now().toString();
    }

    // Renderizar la tabla de enfermeros
    function renderNourses(){
        var tbody = document.getElementById('nourse-table-body');
        if (!tbody) return;

        var nourses = loadNourses();
        tbody.innerHTML = '';

        if (nourses.length === 0){
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No hay enfermeros registrados.</td></tr>';
            return;
        }

        nourses.forEach(function(nourse){
            var tr = document.createElement('tr');
            var fullname = (nourse.name || '') + ' ' + (nourse.lastname || '');
            
            tr.innerHTML = `
                <td>${escapeHtml(fullname)}</td>
                <td>${escapeHtml(nourse.email || '')}</td>
                <td>
                    <button class="btn-custom btn-edit-custom edit-nourse-btn" data-id="${nourse.id}">Editar</button>
                    <button class="btn-custom btn-delete-custom delete-nourse-btn" data-id="${nourse.id}">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Escapar HTML para prevenir XSS
    function escapeHtml(str){
        if (!str && str !== 0) return '';
        return String(str).replace(/[&<>\"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
    }

    // Añadir un nuevo enfermero
    function addNourse(data){
        var list = loadNourses();
        data.id = getNextId();
        list.push(data);
        saveNourses(list);
        renderNourses();
    }

    // Actualizar un enfermero existente
    function updateNourse(id, data){
        var list = loadNourses();
        var idx = list.findIndex(function(x){ return x.id === id; });
        if (idx === -1) return false;
        
        data.id = id; // Preservar el ID
        list[idx] = data;
        
        saveNourses(list);
        renderNourses();
        return true;
    }

    // Eliminar un enfermero
    function deleteNourse(id){
        var list = loadNourses();
        var idx = list.findIndex(function(x){ return x.id === id; });
        if (idx === -1) return false;
        
        list.splice(idx, 1);
        
        saveNourses(list);
        renderNourses();
        return true;
    }

    // Obtener un enfermero por su ID
    function getNourseById(id){
        var list = loadNourses();
        return list.find(function(x){ return x.id === id; }) || null;
    }

    // Limpiar el formulario del modal
    function clearForm(){
        document.getElementById('nourse-id').value = '';
        document.getElementById('nourse-name').value = '';
        document.getElementById('nourse-lastname').value = '';
        document.getElementById('nourse-email').value = '';

        var saveBtn = document.getElementById('save-nourse-btn');
        if (saveBtn) saveBtn.textContent = 'Registrar Enfermero';
    }

    // Rellenar el formulario del modal con datos de un enfermero para edición
    function populateForm(nourse){
        if (!nourse) return;
        document.getElementById('nourse-id').value = nourse.id || '';
        document.getElementById('nourse-name').value = nourse.name || '';
        document.getElementById('nourse-lastname').value = nourse.lastname || '';
        document.getElementById('nourse-email').value = nourse.email || '';

        var saveBtn = document.getElementById('save-nourse-btn');
        if (saveBtn) saveBtn.textContent = 'Guardar Cambios';
    }

    // Manejar el clic en el botón de guardar del modal
    function handleSaveClick(){
        var id = document.getElementById('nourse-id').value;
        var name = document.getElementById('nourse-name').value.trim();
        var lastname = document.getElementById('nourse-lastname').value.trim();
        var email = document.getElementById('nourse-email').value.trim();

        if (!name || !lastname || !email){
            alert('Todos los campos son requeridos.');
            return;
        }

        var payload = { name: name, lastname: lastname, email: email };

        if (!id){
            addNourse(payload);
        } else {
            updateNourse(id, payload);
        }

        // Ocultar modal si Bootstrap está disponible
        var modalEl = document.getElementById('modalEnfermero');
        if (modalEl && typeof bootstrap !== 'undefined'){
            var m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            m.hide();
        }
        clearForm();
    }

    // Función de inicialización
    function init(){
        // Renderizar la lista inicial de enfermeros
        renderNourses();

        // Delegación de eventos para los botones de editar/eliminar
        var tbody = document.getElementById('nourse-table-body');
        if (tbody){
            tbody.addEventListener('click', function(ev){
                // Botón Editar
                var editBtn = ev.target.closest('.edit-nourse-btn');
                if (editBtn){
                    var id = editBtn.getAttribute('data-id');
                    var nourse = getNourseById(id);
                    if (nourse){
                        populateForm(nourse);
                        var modalEl = document.getElementById('modalEnfermero');
                        if (modalEl && typeof bootstrap !== 'undefined'){
                            var m = new bootstrap.Modal(modalEl);
                            m.show();
                        }
                    }
                    return;
                }

                // Botón Eliminar
                var delBtn = ev.target.closest('.delete-nourse-btn');
                if (delBtn){
                    var id2 = delBtn.getAttribute('data-id');
                    if (confirm('¿Está seguro de que desea eliminar este enfermero?')){
                        deleteNourse(id2);
                    }
                    return;
                }
            });
        }

        // Manejador para el botón de guardar del modal
        var saveBtn = document.getElementById('save-nourse-btn');
        if (saveBtn) saveBtn.addEventListener('click', handleSaveClick);

        // Limpiar formulario al abrir el modal para un nuevo registro
        var addBtn = document.querySelector('button[data-bs-target="#modalEnfermero"]');
        if (addBtn){
            addBtn.addEventListener('click', function(){
                clearForm();
            });
        }
    }

    // Ejecutar init cuando el DOM esté listo
    if (document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 30); // Timeout para asegurar que los elementos inyectados existan
    }

})());
*/