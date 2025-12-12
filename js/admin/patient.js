'use strict';

// Usa configuración centralizada desde config.js
const API_URL = API_ENDPOINTS.PATIENTS;
const API_ADMISSIONS = API_ENDPOINTS.ADMISSIONS;
const API_BEDS = API_ENDPOINTS.BEDS;
const API_NURSES = API_ENDPOINTS.NURSES;

const tableBody = document.getElementById('patient-table-body');
const saveBtn = document.getElementById('save-patient-btn');
const inputId = document.getElementById('patient-id');
const inputName = document.getElementById('patient-name');
const inputSurnames = document.getElementById('patient-lastname');
const inputNotes = document.getElementById('patient-notes');
const nurseList = document.getElementById('nurse-list');
const nurseListEmpty = document.getElementById('nurse-list-empty');
const nurseListTitle = document.getElementById('nurse-list-title');

let currentPatients = [];
let allBedsWithStatus = [];
let allNurses = [];
let currentEditingPatient = null;
let currentAssignNursePatient = null; // Paciente usado en el modal de asignar enfermeros
const assignedNurseIdsByBed = {}; // Cache local de asignaciones por cama

let patientsDb, outboxDb;

const hasPouch = typeof window !== 'undefined' && typeof window.PouchDB !== 'undefined';

if (hasPouch) {
  patientsDb = new window.PouchDB('patients-db');
  outboxDb = new window.PouchDB('outbox-db');
}

function genTempId() {
  return `temp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function upsertPatientDoc(patient) {
  if (!hasPouch || !patient) return;
  const id = String(patient.id || patient.tempId);
  if (!id) return;

  const _id = `patient:${id}`;

  try {
    const existing = await patientsDb.get(_id).catch(() => null);
    const doc = {
      _id,
      ...(existing ? { _rev: existing._rev } : {}),
      value: patient
    };
    await patientsDb.put(doc);
  } catch (e) {
    console.error('PouchDB upsertPatientDoc error', e);
  }
}

async function replacePatientsCache(list) {
  if (!hasPouch) return;
  try {
    const all = await patientsDb.allDocs({
      include_docs: true,
      startkey: 'patient:',
      endkey: 'patient:\ufff0'
    });

    const toDelete = all.rows.map(r => ({
      _id: r.id,
      _rev: r.doc._rev,
      _deleted: true
    }));

    const toInsert = (Array.isArray(list) ? list : []).map(p => ({
      _id: `patient:${p.id}`,
      value: p
    }));

    const ops = [];
    if (toDelete.length) ops.push(...toDelete);
    if (toInsert.length) ops.push(...toInsert);

    if (ops.length) {
      await patientsDb.bulkDocs(ops);
    }
    const metaId = 'meta:patients';
    let meta;
    try {
      meta = await patientsDb.get(metaId);
      await patientsDb.put({ _id: metaId, _rev: meta._rev, lastUpdated: Date.now() });
    } catch {
      await patientsDb.put({ _id: metaId, lastUpdated: Date.now() });
    }
  } catch (e) {
    console.error('PouchDB replacePatientsCache error', e);
  }
}

async function readCachedPatients() {
  if (!hasPouch) return [];
  try {
    const res = await patientsDb.allDocs({
      include_docs: true,
      startkey: 'patient:',
      endkey: 'patient:\ufff0'
    });
    const list = res.rows.map(r => r.doc.value);
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  } catch (e) {
    console.error('PouchDB readCachedPatients error', e);
    return [];
  }
}

async function queueRequest(op) {
  if (!hasPouch) return;
  const id = `op:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  try {
    await outboxDb.put({
      _id: id,
      ...op,
      createdAt: Date.now()
    });
  } catch (e) {
    console.error('PouchDB queueRequest error', e);
  }
}

async function processOutbox() {
  if (!hasPouch) return;
  if (!navigator.onLine) return;

  try {
    const res = await outboxDb.allDocs({
      include_docs: true,
      startkey: 'op:',
      endkey: 'op:\ufff0'
    });
    const ops = res.rows.map(r => r.doc);

    for (const doc of ops) {
      const headers = getHeaders();
      const url = `${API_URL}${doc.path || ''}`;
      const fetchInit = { method: doc.method, headers };

      if (doc.body) {
        fetchInit.body = JSON.stringify(doc.body);
      }

      try {
        const response = await fetch(url, fetchInit);
        if (!response.ok) {
          throw new Error(`Failed ${doc.method} ${url} - ${response.status}`);
        }

        if (doc.method === 'POST') {
          const json = await response.json().catch(() => null);
          const serverPatient = json && (json.data || json.patient || json);

          if (serverPatient && serverPatient.id != null) {
            const tempId = doc.body && doc.body.tempId;
            if (tempId) {
              const tempDocId = `patient:${tempId}`;
              try {
                const tempDoc = await patientsDb.get(tempDocId);
                await patientsDb.remove(tempDoc);
              } catch { /* ignorar si no existe */ }
            }
            await upsertPatientDoc(serverPatient);
          }
        }

        if (doc.method === 'PUT') {
          const json = await response.json().catch(() => null);
          const updated = json && (json.data || json.patient || json);
          if (updated && updated.id != null) {
            await upsertPatientDoc(updated);
          }
        }

        if (doc.method === 'DELETE') {
          const idFromPath = (doc.path || '').replace(/^\//, '');
          const pid = idFromPath;
          const _id = `patient:${pid}`;
          try {
            const existing = await patientsDb.get(_id);
            await patientsDb.remove(existing);
          } catch {}
        }

        const del = await outboxDb.get(doc._id);
        await outboxDb.remove(del);
      } catch (err) {
        console.warn('Outbox op failed; will retry later:', err);
        break;
      }
    }
  } catch (e) {
    console.error('PouchDB processOutbox error', e);
  }
}

function getToken() {
  return localStorage.getItem('token');
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`
  };
}

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>\"']/g, function (m) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m];
  });
}

async function loadPatients() {
  // Intento online primero
  if (navigator.onLine) {
    try {
      const res = await fetch(API_URL, {
        method: 'GET',
        headers: getHeaders()
      });

      if (res.ok) {
        const json = await res.json();
        currentPatients = json.data || [];

        // guardamos en PouchDB
        await replacePatientsCache(currentPatients);
        renderPatients();
        return;
      } else {
        console.error('Error al cargar pacientes', res.statusText);
      }
    } catch (e) {
      console.error('Error al cargar pacientes (online attempt failed)', e);
    }
  }

  try {
    const cached = await readCachedPatients();
    currentPatients = cached || [];
    renderPatients();
  } catch (e) {
    console.error('Error al cargar pacientes desde cache', e);
    currentPatients = [];
    renderPatients();
  }
}

async function registerPatient(payload) {
  if (navigator.onLine) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return res;
  }

  // Offline: guardamos en cache y en cola
  const tempId = genTempId();
  const offlinePatient = { ...payload, tempId, pending: true };
  await upsertPatientDoc(offlinePatient);

  await queueRequest({
    method: 'POST',
    path: '',
    body: { ...payload, tempId }
  });

  return {
    ok: true,
    offline: true,
    status: 202,
    json: async () => ({ data: offlinePatient })
  };
}

async function updatePatient(id, payload) {
  if (navigator.onLine) {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return res;
  }

  const optimistic = { ...payload, id, pending: true };
  await upsertPatientDoc(optimistic);

  await queueRequest({
    method: 'PUT',
    path: `/${id}`,
    body: payload
  });

  return {
    ok: true,
    offline: true,
    status: 202,
    json: async () => ({ data: optimistic })
  };
}

async function deletePatient(id) {
  if (navigator.onLine) {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return res;
  }

  if (hasPouch) {
    try {
      const _id = `patient:${id}`;
      const existing = await patientsDb.get(_id);
      await patientsDb.remove(existing);
    } catch { /* ignorar */ }
  }

  await queueRequest({
    method: 'DELETE',
    path: `/${id}`
  });

  return {
    ok: true,
    offline: true,
    status: 202,
    json: async () => ({})
  };
}

// ------------ Beds & Nurses helpers (solo online) ------------

async function loadAllBedsWithStatus() {
  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Se requiere conexión para cargar camas", "info");
    return;
  }

  try {
    const res = await fetch(`${API_BEDS}/status`, { method: "GET", headers: getHeaders() });

    if (res.ok) {
      const json = await res.json();

      // Filtrar solo camas desocupadas
      allBedsWithStatus = (json.data || []).filter(bed => bed.occupied === false);

      console.log("Camas desocupadas:", allBedsWithStatus);
    }
  } catch (e) {
    console.error("Error al cargar camas", e);
  }
}


async function loadAllNurses() {
  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Se requiere conexión para cargar enfermeros", "info");
    return;
  }
  try {
    const res = await fetch(API_NURSES, { method: "GET", headers: getHeaders() });
    if (res.ok) {
      const json = await res.json();
      allNurses = json.data || [];
    }
  } catch (e) {
    console.error("Error al cargar enfermeros", e);
  }
}

async function createAdmission(patientId, bedId) {
  return fetch(API_ADMISSIONS, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ patientId, bedId })
  });
}

async function changeBed(patientId, newBedId) {
  return fetch(`${API_ADMISSIONS}/change-bed`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ patientId, newBedId })
  });
}

async function dischargePatient(admissionId) {
  return fetch(`${API_ADMISSIONS}/discharge/${admissionId}`, {
    method: "PATCH",
    headers: getHeaders()
  });
}

async function assignNurseToBed(nurseId, bedId) {
  // API deprecada: dejamos wrapper por compatibilidad si se llamara en otro lado
  return assignNursesToBed(bedId, [nurseId]);
}

async function assignNursesToBed(bedId, nurseIds) {
  return fetch(`${API_NURSES}/assignments`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({ bedId, nurses: nurseIds })
  });
}

function renderPatients() {
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (!currentPatients.length) {
    tableBody.innerHTML = '<tr><td colspan="4" class="text-muted">No hay pacientes registrados.</td></tr>';
    return;
  }

  const rows = currentPatients.map(function (p) {
    const fullName = `${escapeHtml(p.name)} ${escapeHtml(p.surnames || '')}`.trim();
    const bedLabel = p.bed ? escapeHtml(p.bed) : 'Sin Asignar';
    const bedIdVal = p.bedId || p.bed_id || null;

    const pendingBadge = p.pending
      ? ' <span class="badge text-bg-warning">Pendiente</span>'
      : '';

    return `
      <tr>
        <td>${fullName}${pendingBadge}</td>
        <td>
          ${p.bed
            ? `<span class="badge bg-success">${bedLabel}</span>`
            : `<button class="btn btn-sm btn-outline-primary assign-bed-btn" data-id="${p.id || p.tempId}">
                <i class="bi bi-plus-circle me-1"></i> Asignar Cama
              </button>`}
        </td>
        <td>
          <button class="btn btn-sm btn-outline-primary view-nurses-btn" data-id="${p.id || p.tempId}" data-bed="${bedIdVal || ''}">
            <i class="bi bi-people me-1"></i> Ver Enfermeros
          </button>
        </td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary me-1 edit-patient-btn" data-id="${p.id || p.tempId}">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger delete-patient-btn" data-id="${p.id || p.tempId}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tableBody.innerHTML = rows;
}

function showNursesModal(patient) {
  if (!patient) return;

  currentAssignNursePatient = patient;

  const nurses = Array.isArray(patient.nurses) ? patient.nurses : [];
  nurseList.innerHTML = '';
  nurseListTitle.textContent = `${patient.name} ${patient.surnames || ''}`;

  if (!nurses.length) {
    nurseList.classList.add('d-none');
    nurseListEmpty.classList.remove('d-none');
  } else {
    nurseList.classList.remove('d-none');
    nurseListEmpty.classList.add('d-none');

    nurses.forEach(function (n) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.textContent = n;
      nurseList.appendChild(li);
    });
  }

  // Guardar bedId para asignar enfermeros
  const assignNurseBedId = document.getElementById('assign-nurse-bed-id');
  if (assignNurseBedId) {
    assignNurseBedId.value = patient.bedId || patient.bed_id || '';
    // Guardamos posibles IDs asignados si vienen del backend
    const possibleIds = patient.nurseIds || patient.nurse_ids || patient.nursesIds || [];
    if (Array.isArray(possibleIds) && possibleIds.length) {
      assignedNurseIdsByBed[assignNurseBedId.value] = possibleIds;
    }
  }

  // Deshabilitar botón si no tiene cama
  const assignNurseModalBtn = document.querySelector('#nurseListModal button[data-bs-target="#modalAssignNurse"]');
  if (assignNurseModalBtn) {
    if (!patient.bedId && !patient.bed_id) {
      assignNurseModalBtn.disabled = true;
      assignNurseModalBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i> Paciente sin cama asignada';
    } else {
      assignNurseModalBtn.disabled = false;
      assignNurseModalBtn.innerHTML = '<i class="bi bi-person-plus me-2"></i> Asignar Enfermero';
    }
  }

  const modalEl = document.getElementById('nurseListModal');
  if (modalEl && typeof bootstrap !== 'undefined') {
    const m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    m.show();
  }
}

function clearForm() {
  if (inputId) inputId.value = '';
  if (inputName) inputName.value = '';
  if (inputSurnames) inputSurnames.value = '';
  if (inputNotes) inputNotes.value = '';
  if (saveBtn) saveBtn.textContent = 'Registrar Paciente';
}

function populateForm(patient) {
  if (!patient) return;
  if (inputId) inputId.value = patient.id || patient.tempId || '';
  if (inputName) inputName.value = patient.name || '';
  if (inputSurnames) inputSurnames.value = patient.surnames || '';
  if (inputNotes) inputNotes.value = patient.notes || '';
  if (saveBtn) saveBtn.textContent = 'Guardar cambios';
}

async function handleSaveClick() {
  const name = inputName ? inputName.value.trim() : '';
  const surnames = inputSurnames ? inputSurnames.value.trim() : '';
  const notes = inputNotes ? inputNotes.value.trim() : '';

  if (!name || !surnames) {
    Toast && Toast.show ? Toast.show("Nombre y apellidos son requeridos","error") : alert("Nombre y apellidos son requeridos");
    return;
  }

  const payload = { name, surnames, notes };

  try {
    let res;
    if (inputId && inputId.value && !String(inputId.value).startsWith('temp_')) {
      res = await updatePatient(inputId.value, payload);
    } else if (inputId && inputId.value && String(inputId.value).startsWith('temp_')) {
      res = await registerPatient(payload);
    } else {
      res = await registerPatient(payload);
    }

    if (res.ok) {
      const isOffline = res.offline === true;

      const msg = (inputId && inputId.value && !String(inputId.value).startsWith('temp_'))
        ? (isOffline
          ? 'Cambios guardados (pendiente de sincronizar)'
          : 'Paciente actualizado correctamente')
        : (isOffline
          ? 'Paciente guardado offline (pendiente de sincronizar)'
          : 'Paciente registrado correctamente');

      Toast && Toast.show ? Toast.show(msg, "success") : alert(msg);
      await loadPatients();

      const modalEl = document.getElementById('modalPaciente');
      if (modalEl && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        m.hide();
      }
      clearForm();
    } else {
      console.error('Error al registrar/actualizar paciente', res.statusText);
      Toast && Toast.show ? Toast.show("Error al registrar paciente","error") : alert("Error al registrar paciente");
    }
  } catch (e) {
    console.error('Error al registrar paciente', e);
    Toast && Toast.show ? Toast.show("Error de conexión","error") : alert("Error de conexión");
  }
}

async function showAssignBedModal(patient) {
  if (!patient) return;

  await loadAllBedsWithStatus();

  const select = document.getElementById('assign-bed-select');
  const patientNameEl = document.getElementById('assign-bed-patient-name');
  const patientIdEl = document.getElementById('assign-bed-patient-id');

  if (patientNameEl) patientNameEl.textContent = `${patient.name} ${patient.surnames || ''}`;
  if (patientIdEl) patientIdEl.value = patient.id || patient.tempId || '';

  if (select) {
    select.innerHTML = '';
    const availableBeds = allBedsWithStatus.filter(bed => !bed.isOccupied);
    if (!availableBeds.length) {
      select.innerHTML = '<option value="">No hay camas disponibles</option>';
    } else {
      select.innerHTML = '<option value="">Seleccione una cama</option>';
      availableBeds.forEach(bed => {
        const option = document.createElement('option');
        option.value = bed.id;
        option.textContent = `${escapeHtml(bed.bedLabel || bed.label || bed.name || '')} - Habitación: ${escapeHtml(bed.roomName || 'Sin habitación')}`;
        select.appendChild(option);
      });
    }
  }

  const modalEl = document.getElementById('modalAssignBed');
  if (modalEl && typeof bootstrap !== 'undefined') {
    const m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    m.show();
  }
}

async function showEditPatientModal(patient) {
  if (!patient) return;

  currentEditingPatient = patient;

  const editId = document.getElementById('edit-patient-id');
  const editName = document.getElementById('edit-patient-name');
  const editLastname = document.getElementById('edit-patient-lastname');
  const editNotes = document.getElementById('edit-patient-notes');
  const editAdmissionId = document.getElementById('edit-admission-id');

  if (editId) editId.value = patient.id || patient.tempId || '';
  if (editName) editName.value = patient.name || '';
  if (editLastname) editLastname.value = patient.surnames || '';
  if (editNotes) editNotes.value = patient.notes || '';
  if (editAdmissionId) editAdmissionId.value = patient.admissionId || '';

  const currentBedLabel = document.getElementById('current-bed-label');
  if (currentBedLabel) currentBedLabel.textContent = patient.bed || 'Sin asignar';

  await loadAllBedsWithStatus();
  const changeBedSelect = document.getElementById('change-bed-select');
  if (changeBedSelect) {
    changeBedSelect.innerHTML = '<option value="">Seleccione una cama</option>';
    const availableForChange = allBedsWithStatus.filter(b => !b.isOccupied);
    availableForChange.forEach(bed => {
      const option = document.createElement('option');
      option.value = bed.id;
      option.textContent = `${escapeHtml(bed.bedLabel || bed.label || bed.name || '')} - Isla: ${escapeHtml(bed.islandName || 'Sin Isla')}`;
      changeBedSelect.appendChild(option);
    });
  }

  const changeBedAccordion = document.querySelector('#headingBed button');
  const changeBedBtn = document.getElementById('change-bed-btn');

  if (!patient.bed) {
    if (changeBedAccordion) {
      changeBedAccordion.disabled = true;
      changeBedAccordion.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i> Cambiar Cama (Paciente sin cama)';
    }
    if (changeBedBtn) changeBedBtn.disabled = true;
  } else {
    if (changeBedAccordion) {
      changeBedAccordion.disabled = false;
      changeBedAccordion.innerHTML = '<i class="bi bi-arrow-left-right me-2"></i> Cambiar Cama';
    }
    if (changeBedBtn) changeBedBtn.disabled = false;
  }

  const dischargeBtn = document.getElementById('discharge-patient-btn');
  if (dischargeBtn) {
    if (!patient.admissionId) {
      dischargeBtn.disabled = true;
      dischargeBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i> Sin admisión activa';
    } else {
      dischargeBtn.disabled = false;
      dischargeBtn.innerHTML = '<i class="bi bi-box-arrow-right me-2"></i> Dar de Alta';
    }
  }

  const modalEl = document.getElementById('modalEditPatient');
  if (modalEl && typeof bootstrap !== 'undefined') {
    const m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    m.show();
  }
}

async function showAssignNurseModal() {
  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Se requiere conexión para asignar enfermeros", "info");
    return;
  }
  await loadAllNurses();

  const container = document.getElementById('nurses-checkboxes');
  if (!container) return;
  container.innerHTML = '';

  const bedIdEl = document.getElementById('assign-nurse-bed-id');
  const bedId = bedIdEl ? String(bedIdEl.value || '') : '';

  if (!allNurses.length) {
    container.innerHTML = '<p class="text-muted">No hay enfermeros disponibles</p>';
    return;
  }

  // Determinar qué enfermeros ya están asignados
  const fromPatientIds = (() => {
    const p = currentAssignNursePatient;
    if (!p) return [];
    return (p.nurseIds || p.nurse_ids || p.nursesIds || []).filter(x => x !== null && x !== undefined);
  })();

  const fromCacheIds = assignedNurseIdsByBed[bedId] || [];

  // Si solo tenemos nombres, mapeamos a ids
  const fromNamesIds = (() => {
    const p = currentAssignNursePatient;
    if (!p || !Array.isArray(p.nurses)) return [];
    const nameToId = new Map(allNurses.map(n => [`${(n.name || '').toLowerCase()} ${ (n.surnames || '').toLowerCase()}`.trim(), n.id]));
    return p.nurses
      .map(n => nameToId.get(String(n).toLowerCase().trim()))
      .filter(Boolean);
  })();

  const preselectedIds = Array.from(new Set([
    ...fromPatientIds,
    ...fromCacheIds,
    ...fromNamesIds
  ]));

  allNurses.forEach(nurse => {
    const div = document.createElement('div');
    div.className = 'form-check mb-2';
    const nurseName = `${escapeHtml(nurse.name || '')} ${escapeHtml(nurse.surnames || '')}`.trim();
    div.innerHTML = `
      <input class="form-check-input nurse-checkbox" type="checkbox" value="${nurse.id}" id="nurse-${nurse.id}">
      <label class="form-check-label" for="nurse-${nurse.id}">
        ${nurseName || 'Sin nombre'}
      </label>
    `;
    container.appendChild(div);

    const checkbox = div.querySelector('.nurse-checkbox');
    if (checkbox && preselectedIds.includes(nurse.id)) {
      checkbox.checked = true;
    }
  });
}

async function handleAssignBed() {
  const patientIdEl = document.getElementById('assign-bed-patient-id');
  const select = document.getElementById('assign-bed-select');
  const patientId = patientIdEl ? patientIdEl.value : '';
  const bedId = select ? select.value : '';

  if (!bedId) {
    Toast && Toast.show ? Toast.show("Debe seleccionar una cama", "error") : alert("Debe seleccionar una cama");
    return;
  }

  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Asignar cama solo disponible en línea", "info");
    return;
  }

  try {
    const res = await createAdmission(patientId, bedId);
    if (res.ok) {
      Toast && Toast.show ? Toast.show("Cama asignada correctamente", "success") : alert("Cama asignada correctamente");
      await loadPatients();
      const modalEl = document.getElementById('modalAssignBed');
      if (modalEl && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(modalEl);
        if (m) m.hide();
      }
    } else {
      const errorData = await res.json().catch(() => ({}));
      Toast && Toast.show
        ? Toast.show(errorData.message || "No se pudo asignar la cama", "error")
        : alert(errorData.message || "No se pudo asignar la cama");
    }
  } catch (e) {
    console.error('Error al asignar cama', e);
    Toast && Toast.show ? Toast.show("Error de conexión", "error") : alert("Error de conexión");
  }
}

async function handleUpdateInfo() {
  const id = document.getElementById('edit-patient-id').value;
  const name = document.getElementById('edit-patient-name').value.trim();
  const surnames = document.getElementById('edit-patient-lastname').value.trim();
  const notes = document.getElementById('edit-patient-notes').value.trim();

  if (!name || !surnames) {
    Toast && Toast.show ? Toast.show("Nombre y apellidos son requeridos", "error") : alert("Nombre y apellidos son requeridos");
    return;
  }

  try {
    const res = await updatePatient(id, { name, surnames, notes });
    if (res.ok) {
      Toast && Toast.show ? Toast.show("Información actualizada", "success") : alert("Información actualizada");
      await loadPatients();
    } else {
      Toast && Toast.show ? Toast.show("Error al actualizar información", "error") : alert("Error al actualizar información");
    }
  } catch (e) {
    console.error('Error al actualizar', e);
    Toast && Toast.show ? Toast.show("Error de conexión", "error") : alert("Error de conexión");
  }
}

async function handleChangeBed() {
  const patientId = document.getElementById('edit-patient-id').value;
  const newBedId = document.getElementById('change-bed-select').value;

  if (!newBedId) {
    Toast && Toast.show ? Toast.show("Debe seleccionar una cama", "error") : alert("Debe seleccionar una cama");
    return;
  }

  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Cambio de cama solo disponible en línea", "info");
    return;
  }

  try {
    const res = await changeBed(patientId, newBedId);
    if (res.ok) {
      Toast && Toast.show ? Toast.show("Cama cambiada exitosamente", "success") : alert("Cama cambiada exitosamente");
      await loadPatients();
      const modalEl = document.getElementById('modalEditPatient');
      if (modalEl && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(modalEl);
        if (m) m.hide();
      }
    } else {
      const errorData = await res.json().catch(() => ({}));
      Toast && Toast.show
        ? Toast.show(errorData.message || "No se pudo cambiar la cama", "error")
        : alert(errorData.message || "No se pudo cambiar la cama");
    }
  } catch (e) {
    console.error('Error al cambiar cama', e);
    Toast && Toast.show ? Toast.show("Error de conexión", "error") : alert("Error de conexión");
  }
}

async function handleDischarge() {
  const admissionId = document.getElementById('edit-admission-id').value;

  if (!admissionId) {
    Toast && Toast.show ? Toast.show("No hay admisión activa", "info") : alert("No hay admisión activa");
    return;
  }

  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Dar de alta solo disponible en línea", "info");
    return;
  }

  if (!confirm('¿Está seguro que desea dar de alta a este paciente?')) return;

  try {
    const res = await dischargePatient(admissionId);
    if (res.ok) {
      Toast && Toast.show ? Toast.show("Paciente dado de alta", "success") : alert("Paciente dado de alta");
      await loadPatients();
      const modalEl = document.getElementById('modalEditPatient');
      if (modalEl && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(modalEl);
        if (m) m.hide();
      }
    } else {
      const errorData = await res.json().catch(() => ({}));
      Toast && Toast.show
        ? Toast.show(errorData.message || "No se pudo dar de alta", "error")
        : alert(errorData.message || "No se pudo dar de alta");
    }
  } catch (e) {
    console.error('Error al dar de alta', e);
    Toast && Toast.show ? Toast.show("Error de conexión", "error") : alert("Error de conexión");
  }
}

async function handleAssignNurses() {
  const bedIdEl = document.getElementById('assign-nurse-bed-id');
  const bedId = bedIdEl ? bedIdEl.value : '';

  if (!bedId) {
    Toast && Toast.show ? Toast.show("El paciente no tiene cama asignada", "info") : alert("El paciente no tiene cama asignada");
    return;
  }

  const checkboxes = document.querySelectorAll('.nurse-checkbox:checked');
  const nurseIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

  if (!nurseIds.length) {
    Toast && Toast.show ? Toast.show("Seleccione al menos un enfermero", "info") : alert("Seleccione al menos un enfermero");
    return;
  }

  if (!navigator.onLine) {
    Toast && Toast.show && Toast.show("Asignar enfermeros solo disponible en línea", "info");
    return;
  }

  try {
    const res = await assignNursesToBed(bedId, nurseIds);
    if (res.ok) {
      // Actualizamos cache local para que al reabrir el modal los checks permanezcan
      assignedNurseIdsByBed[bedId] = nurseIds;

      Toast && Toast.show ? Toast.show("Enfermeros asignados correctamente", "success") : alert("Enfermeros asignados correctamente");
      await loadPatients();

      const assignModal = document.getElementById('modalAssignNurse');
      const nurseListModal = document.getElementById('nurseListModal');
      if (assignModal && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(assignModal);
        if (m) m.hide();
      }
      if (nurseListModal && typeof bootstrap !== 'undefined') {
        const m = bootstrap.Modal.getInstance(nurseListModal);
        if (m) m.hide();
      }
    } else {
      const errorData = await res.json().catch(() => ({}));
      Toast && Toast.show
        ? Toast.show(errorData.message || "No se pudo asignar la cama", "error")
        : alert(errorData.message || "No se pudo asignar la cama");
    }
  } catch (e) {
    console.error('Error al asignar enfermeros', e);
    Toast && Toast.show ? Toast.show("Error de conexión", "error") : alert("Error de conexión");
  }
}

function init() {
  loadPatients();

  // Toast de bienvenida solo si existe
  if (window.Toast && Toast.show) {
    Toast.show("Sistema cargado correctamente 🎉", "success");
  }

  if (navigator.onLine) {
    processOutbox().then(() => loadPatients());
  }

  window.addEventListener('online', async () => {
    await processOutbox();
    await loadPatients();
  });

  if (tableBody) {
    tableBody.addEventListener('click', function (ev) {
      // Ver enfermeros
      const viewBtn = ev.target.closest('.view-nurses-btn');
      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        const patient = currentPatients.find(p => String(p.id || p.tempId) === String(id));
        showNursesModal(patient);
        return;
      }

      // Asignar cama
      const assignBedBtn = ev.target.closest('.assign-bed-btn');
      if (assignBedBtn) {
        const id = assignBedBtn.getAttribute('data-id');
        const patient = currentPatients.find(p => String(p.id || p.tempId) === String(id));
        showAssignBedModal(patient);
        return;
      }

      // Editar
      const editBtn = ev.target.closest('.edit-patient-btn');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const patient = currentPatients.find(p => String(p.id || p.tempId) === String(id));
        if (patient) {
          showEditPatientModal(patient);
        }
        return;
      }

      // Eliminar
      const delBtn = ev.target.closest('.delete-patient-btn');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');

        // Usar Toast modification para confirmar
        if (window.Toast && Toast.show) {
          Toast.show(
            "¿Seguro que desea eliminar este paciente?",
            "modification",
            // Acción ACEPTAR
            () => {
              if (String(id).startsWith('temp_')) {
                if (hasPouch) {
                  patientsDb
                    .get(`patient:${id}`)
                    .then(doc => patientsDb.remove(doc))
                    .catch(() => {});
                }
                readCachedPatients().then(list => {
                  currentPatients = list;
                  renderPatients();
                });
                return;
              }

              deletePatient(id)
                .then(res => {
                  if (res.ok) {
                    loadPatients();
                    Toast.show("Paciente eliminado correctamente", "success");
                  } else {
                    Toast.show("Error al eliminar paciente", "error");
                  }
                })
                .catch(err => {
                  console.error("Error al eliminar paciente", err);
                  Toast.show("Error al eliminar paciente", "error");
                });
            },
            // Acción CANCELAR
            () => {
              Toast.show("Operación cancelada", "info");
            }
          );
        } else {
          // Fallback a confirm si no hay Toast
          if (!confirm('¿Seguro que desea eliminar este paciente?')) return;
          
          if (String(id).startsWith('temp_')) {
            if (hasPouch) {
              patientsDb
                .get(`patient:${id}`)
                .then(doc => patientsDb.remove(doc))
                .catch(() => {});
            }
            readCachedPatients().then(list => {
              currentPatients = list;
              renderPatients();
            });
            return;
          }

          deletePatient(id)
            .then(res => {
              if (res.ok) {
                loadPatients();
              } else {
                alert("Error al eliminar paciente");
              }
            })
            .catch(err => {
              console.error("Error al eliminar paciente", err);
              alert("Error al eliminar paciente");
            });
        }
        return;
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function (e) {
      e.preventDefault();
      handleSaveClick();
    });
  }

  const assignBedBtn = document.getElementById('assign-bed-btn');
  if (assignBedBtn) assignBedBtn.addEventListener('click', handleAssignBed);

  const updateInfoBtn = document.getElementById('update-info-btn');
  if (updateInfoBtn) updateInfoBtn.addEventListener('click', handleUpdateInfo);

  const changeBedBtn = document.getElementById('change-bed-btn');
  if (changeBedBtn) changeBedBtn.addEventListener('click', handleChangeBed);

  const dischargeBtn = document.getElementById('discharge-patient-btn');
  if (dischargeBtn) dischargeBtn.addEventListener('click', handleDischarge);

  const assignNursesBtn = document.getElementById('assign-nurses-btn');
  if (assignNursesBtn) assignNursesBtn.addEventListener('click', handleAssignNurses);

  const addBtn = document.querySelector('button[data-bs-target="#modalPaciente"]');
  if (addBtn) addBtn.addEventListener('click', clearForm);

  const modalAssignNurse = document.getElementById('modalAssignNurse');
  if (modalAssignNurse) {
    modalAssignNurse.addEventListener('show.bs.modal', showAssignNurseModal);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 30);
}



/*
((function(){
    'use strict';

    var STORAGE_KEY = 'hospital_patients_v1';

    function loadPatients(){
        try{
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        }catch(e){
            console.error('Error parsing patients from storage', e);
            return [];
        }
    }

    function savePatients(list){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function getNextId(){
        return Date.now().toString();
    }

    function renderPatients(){
        var tbody = document.getElementById('patient-table-body');
        if (!tbody) return;
        var patients = loadPatients();
        tbody.innerHTML = '';
        // Ensure the table header contains the 'Acciones' column so header/body column counts match
        var table = tbody.closest('table');
        var headerCount = 0;
        if (table){
            var thead = table.querySelector('thead');
            if (thead){
                var ths = thead.querySelectorAll('th');
                headerCount = ths.length;
                var hasAcciones = false;
                ths.forEach(function(th){
                    if (th.textContent && th.textContent.trim().toLowerCase() === 'acciones') hasAcciones = true;
                });
                if (!hasAcciones){
                    var trHead = thead.querySelector('tr') || document.createElement('tr');
                    var thAcc = document.createElement('th');
                    thAcc.textContent = 'Acciones';
                    trHead.appendChild(thAcc);
                    if (!thead.querySelector('tr')) thead.appendChild(trHead);
                    headerCount = headerCount + 1;
                }
            }
        }

        if (patients.length === 0){
            var colspan = headerCount || 4;
            tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-muted">No hay pacientes registrados.</td></tr>';
            return;
        }

        patients.forEach(function(p){
            var tr = document.createElement('tr');
            var fullname = (p.name || '') + ' ' + (p.lastname || '');
            tr.innerHTML = '\n                <td>' + escapeHtml(fullname) + '</td>\n                <td>' + escapeHtml(p.bed || '') + '</td>\n                <td>' + escapeHtml(p.nurse || '') + '</td>\n                <td>\n                    <button class="btn-custom btn-edit-custom edit-patient-btn" data-id="' + p.id + '">Editar</button>\n                    ' + (p.active ? '<span class="badge bg-success">Activo</span>' : '<button class="btn-custom btn-delete-custom delete-patient-btn" data-id="' + p.id + '">Dar de alta</button>') + '\n                </td>\n            ';
            tbody.appendChild(tr);
        });
    }

    function escapeHtml(str){
        if (!str && str !== 0) return '';
        return String(str).replace(/[&<>\"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
    }

    function addPatient(data){
        var list = loadPatients();
        data.id = getNextId();
        data.active = false;
        list.push(data);
        savePatients(list);
        renderPatients();
    }

    function updatePatient(id, data){
        var list = loadPatients();
        var idx = list.findIndex(function(x){ return x.id === id; });
        if (idx === -1) return false;
        data.id = id;
        data.active = list[idx].active; 
        list[idx] = data;
        savePatients(list);
        renderPatients();
        return true;
    }

    function deletePatient(id){
        var list = loadPatients();
        var idx = list.findIndex(function(x){ return x.id === id; });
        if (idx === -1) return false;
        
        list.splice(idx, 1);
        
        savePatients(list);
        renderPatients();
        return true;
    }

    function getPatientById(id){
        var list = loadPatients();
        return list.find(function(x){ return x.id === id; }) || null;
    }

    function clearForm(){
        var fields = ['patient-id','patient-name','patient-lastname','patient-notes','patient-bed','patient-nurse'];
        fields.forEach(function(id){
            var el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'SELECT') el.selectedIndex = 0;
            else el.value = '';
        });
        var saveBtn = document.getElementById('save-patient-btn');
        if (saveBtn) saveBtn.textContent = 'Registrar Paciente';
    }

    function populateForm(patient){
        if (!patient) return;
        document.getElementById('patient-id').value = patient.id || '';
        document.getElementById('patient-name').value = patient.name || '';
        document.getElementById('patient-lastname').value = patient.lastname || '';
        document.getElementById('patient-notes').value = patient.notes || '';
        var bed = document.getElementById('patient-bed'); if (bed) bed.value = patient.bed || bed.value;
        var nurse = document.getElementById('patient-nurse'); if (nurse) nurse.value = patient.nurse || nurse.value;
        var saveBtn = document.getElementById('save-patient-btn');
        if (saveBtn) saveBtn.textContent = 'Guardar cambios';
    }

    function handleSaveClick(){
        var id = document.getElementById('patient-id').value;
        var name = document.getElementById('patient-name').value.trim();
        var lastname = document.getElementById('patient-lastname').value.trim();
        var notes = document.getElementById('patient-notes').value.trim();
        var bed = document.getElementById('patient-bed').value;
        var nurse = document.getElementById('patient-nurse').value;

        if (!name){ alert('El nombre es requerido'); return; }

        var payload = { name: name, lastname: lastname, notes: notes, bed: bed, nurse: nurse };

        if (!id){
            addPatient(payload);
        } else {
            updatePatient(id, payload);
        }

        var modalEl = document.getElementById('modalPaciente');
        if (modalEl && typeof bootstrap !== 'undefined'){
            var m = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            m.hide();
        }
        clearForm();
    }

    function init(){
        renderPatients();
        var tbody = document.getElementById('patient-table-body');
        if (tbody){
            tbody.addEventListener('click', function(ev){
                var editBtn = ev.target.closest('.edit-patient-btn');
                if (editBtn){
                    var id = editBtn.getAttribute('data-id');
                    var patient = getPatientById(id);
                    if (patient){
                        populateForm(patient);
                        var modalEl = document.getElementById('modalPaciente');
                        if (modalEl && typeof bootstrap !== 'undefined'){
                            var m = new bootstrap.Modal(modalEl);
                            m.show();
                        }
                    }
                    return;
                }

                var delBtn = ev.target.closest('.delete-patient-btn');
                if (delBtn){
                    var id2 = delBtn.getAttribute('data-id');
                    if (confirm('¿Está seguro de que desea eliminar este paciente?')){
                        deletePatient(id2);
                    }
                    return;
                }
            });
        }

        var saveBtn = document.getElementById('save-patient-btn');
        if (saveBtn) saveBtn.addEventListener('click', handleSaveClick);

        var addBtn = document.querySelector('button[data-bs-target="#modalPaciente"]');
        if (addBtn){
            addBtn.addEventListener('click', function(){
                clearForm();
            });
        }
    }

    if (document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 30);
    }

})())
*/  

