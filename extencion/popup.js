// ============================================================
// SGVA TOOLKIT - POPUP CONTROLLER v2.0.1
// Correcciones: CSP (sin inline scripts) + selección exacta de pestaña
// ============================================================

const cambio = {
    data: [],
    isProcessing: false,
    processed: 0,
    errors: 0,
    paused: false,
    currentIndex: 0,
    results: []
};

const reportes = {
    estados: [],
    batchDone: 0,
    batchError: 0,
    batchTotal: 0
};

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
}

function nowTime() {
    return new Date().toLocaleTimeString('es-CO', { hour12: false });
}

function addLog(containerId, msg, type = 'info') {
    const box = document.getElementById(containerId);
    if (!box) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (type === 'error') entry.classList.add('log-error');
    if (type === 'warn') entry.classList.add('log-warn');
    entry.textContent = `[${nowTime()}] ${msg}`;
    box.appendChild(entry);
    box.scrollTop = box.scrollHeight;
}

function clearLog(containerId) {
    const box = document.getElementById(containerId);
    if (box) box.innerHTML = '';
}

// ========================
// TOGGLE ACORDEÓN (movido desde inline HTML)
// ========================
function toggleModule(id) {
    const mod = document.getElementById('mod-' + id);
    if (mod) mod.classList.toggle('collapsed');
}

document.querySelectorAll('.module-toggle').forEach(el => {
    el.addEventListener('click', () => {
        const id = el.dataset.module;
        if (id) toggleModule(id);
    });
});

// ========================
// BÚSQUEDA ROBUSTA DE PESTAÑAS
// ========================

async function findSGVATab(urlFragment) {
    // 1. Buscar entre todas las pestañas del dominio
    const tabs = await chrome.tabs.query({ url: '*://caprendizaje.sena.edu.co/*' });

    // 2. Intentar match exacto con el fragmento de URL requerido
    let tab = tabs.find(t => t.url && t.url.includes(urlFragment));

    // 3. Si no hay match exacto, devolver null (no adivinar con tabs[0])
    return tab || null;
}

// ========================
// CONEXIÓN SGVA
// ========================
async function checkConnection() {
    const bar = document.getElementById('connectionStatus');
    try {
        const tab = await findSGVATab('/Admin/AprendizConsultar');

        if (!tab) {
            bar.className = 'connection-bar conn-warn show';
            bar.textContent = '⚠️ Abre el SGVA en: Admin > Aprendiz > Consultar';
            return { ok: false, tab: null, reason: 'no_tab' };
        }

        const res = await chrome.tabs.sendMessage(tab.id, { action: 'checkLogin' });
        if (res?.loggedIn) {
            bar.className = 'connection-bar conn-ok show';
            bar.textContent = '✅ Conectado al SGVA — listo para procesar';
            return { ok: true, tab };
        } else {
            bar.className = 'connection-bar conn-warn show';
            bar.textContent = '⚠️ Inicia sesión en SGVA como funcionario';
            return { ok: false, tab, reason: 'not_logged' };
        }
    } catch (e) {
        bar.className = 'connection-bar conn-error show';
        bar.textContent = '⚠️ Recarga la página del SGVA (F5) — Content script desconectado';
        return { ok: false, tab: null, reason: 'disconnected' };
    }
}

setInterval(() => checkConnection(), 4000);
checkConnection();

// ========================
// MÓDULO: CAMBIO DISPONIBLE
// ========================

const cambioFile = document.getElementById('cambio-file');
const cambioUpload = document.getElementById('cambio-upload-area');
const cambioFileInfo = document.getElementById('cambio-file-info');
const cambioFileName = document.getElementById('cambio-file-name');
const cambioFileCount = document.getElementById('cambio-file-count');
const cambioPreview = document.getElementById('cambio-preview');
const cambioPreviewTbody = document.getElementById('cambio-preview-tbody');
const cambioDupWarning = document.getElementById('cambio-dup-warning');
const cambioStart = document.getElementById('cambio-start');
const cambioOpenSGVA = document.getElementById('cambio-open-sgva');
const cambioProgress = document.getElementById('cambio-progress');
const cambioStatusText = document.getElementById('cambio-status-text');
const cambioProgressText = document.getElementById('cambio-progress-text');
const cambioProgressFill = document.getElementById('cambio-progress-fill');
const cambioLog = document.getElementById('cambio-log');
const cambioCompletion = document.getElementById('cambio-completion');

cambioUpload.addEventListener('click', () => {
    if (!cambio.isProcessing) cambioFile.click();
});

cambioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processCambioFile(file);
});

function processCambioFile(file) {
    cambioFileName.textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);

            parseAprendices(json);
            renderPreview();
            detectDuplicates();

            cambioFileInfo.classList.remove('hidden');
            cambioPreview.classList.remove('hidden');
            cambioStart.disabled = cambio.data.length === 0;

            addLog('cambio-log', `📊 ${cambio.data.length} aprendices cargados desde "${file.name}"`);
        } catch (err) {
            addLog('cambio-log', `❌ Error leyendo Excel: ${err.message}`, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseAprendices(rows) {
    cambio.data = rows.map((row, i) => ({
        index: i,
        tipoDoc: row['Tipo de documento'] ?? row['TIPO DE DOCUMENTO'] ?? row['Tipo Documento'] ??
                 row['tipo documento'] ?? row['tipo_documento'] ?? row['TipoDoc'] ?? 'CEDULA DE CIUDADANIA',
        documento: String(row['Número de documento'] ?? row['NUMERO DE DOCUMENTO'] ?? row['Numero Documento'] ??
                         row['numero documento'] ?? row['Documento'] ?? row['documento'] ?? '').trim(),
        nombre: row['Nombre'] ?? row['NOMBRE'] ?? row['Nombres'] ?? row['nombre'] ?? '',
        status: 'pending'
    })).filter(a => a.documento !== '');

    cambio.results = [];
    cambio.processed = 0;
    cambio.errors = 0;
    cambio.currentIndex = 0;
}

function renderPreview() {
    cambioFileCount.textContent = cambio.data.length;
    cambioPreviewTbody.innerHTML = cambio.data.slice(0, 50).map((a, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escHtml(a.tipoDoc)}</td>
            <td>${escHtml(a.documento)}</td>
            <td>${escHtml(a.nombre)}</td>
        </tr>
    `).join('');
    if (cambio.data.length > 50) {
        cambioPreviewTbody.innerHTML += `<tr><td colspan="4" style="text-align:center;color:#9ca3af;">... y ${cambio.data.length - 50} más</td></tr>`;
    }
}

function detectDuplicates() {
    const seen = new Set();
    const dups = new Set();
    cambio.data.forEach(a => {
        const key = `${a.tipoDoc}|${a.documento}`;
        if (seen.has(key)) dups.add(key);
        seen.add(key);
    });
    cambioDupWarning.style.display = dups.size > 0 ? 'inline' : 'none';
    if (dups.size > 0) {
        addLog('cambio-log', `⚠️ Se detectaron ${dups.size} documentos duplicados en el archivo`, 'warn');
    }
}

cambioOpenSGVA.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://caprendizaje.sena.edu.co/sgva/Admin/AprendizConsultar' });
    addLog('cambio-log', '🌐 Abriendo SGVA en Consultar Aprendiz...');
});

cambioStart.addEventListener('click', async () => {
    if (cambio.isProcessing || cambio.data.length === 0) return;

    const conn = await checkConnection();
    if (!conn.ok) {
        if (conn.reason === 'no_tab') {
            alert('❌ No se encontró una pestaña del SGVA en "Consultar Aprendiz".\n\nVe a:\nhttps://caprendizaje.sena.edu.co/sgva/Admin/AprendizConsultar\n\nSi ya la tienes abierta, recárgala (F5) para que la extensión se conecte.');
        } else if (conn.reason === 'not_logged') {
            alert('⚠️ Estás en la página correcta pero no hay sesión activa.\n\nInicia sesión como funcionario en el SGVA.');
        } else if (conn.reason === 'disconnected') {
            alert('⚠️ La pestaña del SGVA perdió la conexión con la extensión.\n\nRecarga la página (F5) e intenta de nuevo.');
        }
        return;
    }

    const confirmed = confirm(
        `⚠️ VAS A PROCESAR ${cambio.data.length} APRENDICES\n\n` +
        '¿Estás seguro?\n\n' +
        'IMPORTANTE:\n' +
        '• NO cierres esta ventana\n' +
        '• NO cierres la pestaña del SGVA\n' +
        '• NO interactúes con el SGVA mientras procesa\n\n' +
        `Tiempo estimado: ~${Math.ceil(cambio.data.length * 10 / 60)} minutos`
    );
    if (!confirmed) return;

    cambio.isProcessing = true;
    cambio.processed = 0;
    cambio.errors = 0;
    cambio.currentIndex = 0;
    cambio.results = cambio.data.map(a => ({
        documento: a.documento,
        tipoDoc: a.tipoDoc,
        nombre: a.nombre,
        status: 'Pendiente',
        error: ''
    }));

    cambioStart.disabled = true;
    cambioOpenSGVA.disabled = true;
    cambioProgress.classList.remove('hidden');
    cambioCompletion.classList.add('hidden');
    clearLog('cambio-log');

    addLog('cambio-log', `🚀 Iniciando Cambio a Disponible — ${cambio.data.length} aprendices`);

    const tab = conn.tab;

    for (let i = 0; i < cambio.data.length; i++) {
        if (!cambio.isProcessing) break;

        cambio.currentIndex = i;
        const ap = cambio.data[i];

        updateCambioUI(i, cambio.data.length, `Procesando: ${ap.documento}`);
        addLog('cambio-log', `⏳ [${i + 1}/${cambio.data.length}] ${ap.tipoDoc} ${ap.documento} — ${ap.nombre}`);

        try {
            const res = await Promise.race([
                chrome.tabs.sendMessage(tab.id, { action: 'processAprendiz', aprendiz: ap }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout — más de 25 segundos')), 25000))
            ]);

            if (res?.success) {
                cambio.processed++;
                cambio.results[i].status = 'OK';
                addLog('cambio-log', `✅ [${i + 1}] ${ap.documento} — COMPLETADO`);
            } else if (res?.needsNavigation) {
                cambio.errors++;
                cambio.results[i].status = 'Error';
                cambio.results[i].error = res.error || 'Navegación incorrecta';
                addLog('cambio-log', `❌ [${i + 1}] ${ap.documento} — ${res.error}`, 'error');
                alert('❌ Ya no estás en la página correcta. El proceso se detendrá.');
                break;
            } else {
                throw new Error(res?.error || 'Respuesta inválida del content script');
            }
        } catch (err) {
            cambio.errors++;
            const msg = err.message || 'Error desconocido';
            cambio.results[i].status = 'Error';
            cambio.results[i].error = msg;
            addLog('cambio-log', `❌ [${i + 1}] ${ap.documento} — ${msg}`, 'error');

            if (msg.includes('message channel closed') || msg.includes('back/forward cache') || msg.includes('Receiving end does not exist')) {
                addLog('cambio-log', '💡 La página se recargó o cambió. Deteniendo.', 'warn');
                alert('❌ Se perdió la conexión con el SGVA.\n\nLa página se recargó o cambió.\nProcesados: ' + cambio.processed);
                break;
            }
        }

        updateCambioUI(i + 1, cambio.data.length);

        if (i < cambio.data.length - 1 && cambio.isProcessing) {
            await wait(4000);
        }
    }

    finalizeCambio();
});

function updateCambioUI(current, total, statusText) {
    const pct = Math.round((current / total) * 100);
    cambioProgressFill.style.width = pct + '%';
    cambioProgressFill.textContent = pct + '%';
    cambioProgressText.textContent = `${current}/${total}`;
    if (statusText) cambioStatusText.textContent = statusText;
}

function finalizeCambio() {
    cambio.isProcessing = false;
    cambioStart.disabled = false;
    cambioOpenSGVA.disabled = false;

    cambioCompletion.innerHTML = `
        <div class="alert alert-success">
            <strong>✅ Proceso Finalizado</strong><br>
            ${cambio.processed} exitosos, ${cambio.errors} errores de ${cambio.data.length} total
        </div>
        <button class="btn btn-secondary" id="cambio-descargar-resumen" style="margin-top:8px;">
            📥 Descargar resumen (Excel)
        </button>
    `;
    cambioCompletion.classList.remove('hidden');

    addLog('cambio-log', `🎉 FINALIZADO — ${cambio.processed} OK, ${cambio.errors} errores`);
    if (cambio.errors > 0) addLog('cambio-log', '⚠️ Revisa manualmente los que dieron error', 'warn');

    chrome.runtime.sendMessage({
        action: 'notificacionCambioDisponible',
        exitosos: cambio.processed,
        errores: cambio.errors,
        total: cambio.data.length
    }).catch(() => {});

    document.getElementById('cambio-descargar-resumen').addEventListener('click', descargarResumenCambio);
}

function descargarResumenCambio() {
    const wsData = [
        ['#', 'Tipo Documento', 'Documento', 'Nombre', 'Estado', 'Error / Observación'],
        ...cambio.results.map((r, i) => [i + 1, r.tipoDoc, r.documento, r.nombre, r.status, r.error])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resumen');
    const blob = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Resumen_Cambio_Disponible_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('cambio-log', '📥 Resumen descargado');
}

// ========================
// MÓDULO: REPORTES POR ESTADO
// ========================

const btnCargarEstados = document.getElementById('reporte-cargar-estados');
const estadosContainer = document.getElementById('reporte-estados-container');
const estadosList = document.getElementById('reporte-estados-list');
const selectAllCheckbox = document.getElementById('reporte-select-all');
const btnDescargar = document.getElementById('reporte-descargar');
const btnAbortar = document.getElementById('reporte-abortar');
const reporteProgress = document.getElementById('reporte-progress');
const reporteStatusText = document.getElementById('reporte-status-text');
const reporteProgressText = document.getElementById('reporte-progress-text');
const reporteProgressFill = document.getElementById('reporte-progress-fill');
const reporteLog = document.getElementById('reporte-log');
const reporteCompletion = document.getElementById('reporte-completion');

btnCargarEstados.addEventListener('click', async () => {
    const tab = await findSGVATab('Reporte13');
    if (!tab) {
        alert('No se encontró la pestaña de Reporte13.\nÁbrela primero:\nhttps://caprendizaje.sena.edu.co/sgva/Admin/Reportes/Reporte13\n\nSi ya la tienes abierta, recárgala (F5).');
        return;
    }
    try {
        btnCargarEstados.disabled = true;
        btnCargarEstados.textContent = '⏳ Cargando...';
        clearLog('reporte-log');

        const res = await chrome.tabs.sendMessage(tab.id, { action: 'getEstadosDisponibles' });
        if (res.success) {
            reportes.estados = res.estados;
            renderEstados(reportes.estados);
            estadosContainer.classList.remove('hidden');
            addLog('reporte-log', `✅ ${res.estados.length} estados cargados`);
        } else {
            throw new Error(res.error);
        }
    } catch (e) {
        addLog('reporte-log', `❌ Error: ${e.message}`, 'error');
        if (e.message.includes('Receiving end does not exist')) {
            addLog('reporte-log', '💡 Recarga la página del Reporte 13 (F5) e intenta de nuevo.', 'warn');
        }
    } finally {
        btnCargarEstados.disabled = false;
        btnCargarEstados.textContent = '🔄 Cargar estados desde SGVA';
    }
});

function renderEstados(estados) {
    estadosList.innerHTML = '';
    if (estados.length === 0) {
        estadosList.innerHTML = '<div style="padding:8px;font-size:12px;color:#6b7280;">No se encontraron estados</div>';
        btnDescargar.disabled = true;
        return;
    }
    estados.forEach(est => {
        const label = document.createElement('label');
        label.className = 'estado-item';
        label.innerHTML = `
            <input type="checkbox" class="estado-check" value="${escHtml(est.value)}" data-text="${escHtml(est.text)}" checked>
            <span>${escHtml(est.text)} <small>(${escHtml(est.value)})</small></span>
        `;
        estadosList.appendChild(label);
    });
    btnDescargar.disabled = false;
    updateSelectAllState();
}

selectAllCheckbox.addEventListener('change', () => {
    const checked = selectAllCheckbox.checked;
    document.querySelectorAll('.estado-check').forEach(cb => cb.checked = checked);
    btnDescargar.disabled = !checked && document.querySelectorAll('.estado-check:checked').length === 0;
});

estadosList.addEventListener('change', updateSelectAllState);

function updateSelectAllState() {
    const checks = document.querySelectorAll('.estado-check');
    const checked = document.querySelectorAll('.estado-check:checked');
    selectAllCheckbox.checked = checks.length > 0 && checks.length === checked.length;
    selectAllCheckbox.indeterminate = checked.length > 0 && checked.length < checks.length;
    btnDescargar.disabled = checked.length === 0;
}

btnDescargar.addEventListener('click', async () => {
    const checks = document.querySelectorAll('.estado-check:checked');
    if (checks.length === 0) { alert('Selecciona al menos un estado'); return; }

    const estados = Array.from(checks).map(cb => ({ value: cb.value, text: cb.dataset.text }));
    await chrome.runtime.sendMessage({ action: 'iniciarBatchReportes', estados });
});

btnAbortar.addEventListener('click', async () => {
    btnAbortar.disabled = true;
    btnAbortar.textContent = '⛔ Abortando...';
    addLog('reporte-log', '⛔ Solicitando abort...');
    await chrome.runtime.sendMessage({ action: 'abortarBatch' });
});

function updateReportesUI(current, total, status) {
    const pct = total === 0 ? 0 : Math.round((current / total) * 100);
    reporteProgressFill.style.width = pct + '%';
    reporteProgressFill.textContent = pct + '%';
    reporteProgressText.textContent = `${current}/${total}`;
    if (status) reporteStatusText.textContent = status;
}

function mostrarAbortar() {
    btnAbortar.style.display = 'block';
    btnDescargar.disabled = true;
    btnCargarEstados.disabled = true;
}

function ocultarAbortar() {
    btnAbortar.style.display = 'none';
    btnAbortar.disabled = false;
    btnAbortar.textContent = '⛔ Abortar Operación';
    btnDescargar.disabled = false;
    btnCargarEstados.disabled = false;
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchIniciado') {
        reportes.batchDone = 0;
        reportes.batchError = 0;
        reportes.batchTotal = request.total;
        reporteProgress.classList.remove('hidden');
        reporteCompletion.classList.add('hidden');
        mostrarAbortar();
        updateReportesUI(0, reportes.batchTotal, 'Abriendo pestañas en paralelo...');
        clearLog('reporte-log');
        addLog('reporte-log', `🚀 Abriendo ${request.total} reportes en paralelo`);
    }

    if (request.action === 'reporteDescargaIniciada') {
        addLog('reporte-log', `📥 [${request.index + 1}] Descarga detectada: ${request.estadoText}`);
    }

    if (request.action === 'reporteDescargaCompleta') {
        reportes.batchDone++;
        updateReportesUI(reportes.batchDone + reportes.batchError, reportes.batchTotal, `${request.estadoText} completado`);
        addLog('reporte-log', `✅ [${request.index + 1}] Descargado: ${request.estadoText}`);
        const cb = document.querySelector(`.estado-check[value="${request.estado}"]`);
        if (cb) {
            cb.checked = false;
            cb.closest('.estado-item').classList.add('done');
        }
        updateSelectAllState();
    }

    if (request.action === 'reporteDescargaError') {
        reportes.batchError++;
        updateReportesUI(reportes.batchDone + reportes.batchError, reportes.batchTotal, `Error en ${request.estadoText}`);
        addLog('reporte-log', `❌ [${request.index + 1}] Error: ${request.estadoText} — ${request.error}`, 'error');
        const cb = document.querySelector(`.estado-check[value="${request.estado}"]`);
        if (cb) cb.closest('.estado-item').classList.add('error');
    }

    if (request.action === 'batchCompletado') {
        ocultarAbortar();
        reporteCompletion.innerHTML = `
            <div class="alert alert-success">
                <strong>✅ Completado</strong><br>
                ${request.done} descargados, ${request.errors} errores de ${request.total} total
            </div>
        `;
        reporteCompletion.classList.remove('hidden');
        updateReportesUI(request.total, request.total, 'Completado');
        addLog('reporte-log', `🎉 PROCESO FINALIZADO: ${request.done} OK, ${request.errors} errores`);
    }

    if (request.action === 'batchAbortado') {
        ocultarAbortar();
        reporteCompletion.innerHTML = `
            <div class="alert alert-danger">
                <strong>⛔ Operación Abortada</strong><br>
                Las pestañas restantes fueron cerradas.
            </div>
        `;
        reporteCompletion.classList.remove('hidden');
        addLog('reporte-log', '⛔ Operación abortada por el usuario', 'warn');
    }
});

// ========================
// RECUPERACIÓN DE ESTADO
// ========================
(async function recoverState() {
    const data = await chrome.storage.local.get([
        'isProcessingReports', 'reportTotal', 'reportQueue', 'activeTabs'
    ]);

    if (data.isProcessingReports && data.reportQueue) {
        reportes.batchTotal = data.reportTotal || data.reportQueue.length;
        reportes.batchDone = data.reportQueue.filter(q => q.done).length;
        reportes.batchError = data.reportQueue.filter(q => q.error).length;

        reporteProgress.classList.remove('hidden');
        reporteCompletion.classList.add('hidden');
        mostrarAbortar();

        if (data.reportQueue.length > 0) {
            reportes.estados = data.reportQueue.map(q => ({ value: q.value, text: q.text }));
            renderEstados(reportes.estados);
            data.reportQueue.forEach(q => {
                const cb = document.querySelector(`.estado-check[value="${q.value}"]`);
                if (cb) {
                    cb.checked = !q.done && !q.error;
                    if (q.done) cb.closest('.estado-item').classList.add('done');
                    if (q.error) cb.closest('.estado-item').classList.add('error');
                }
            });
        }
        updateSelectAllState();
        updateReportesUI(reportes.batchDone + reportes.batchError, reportes.batchTotal, 'Recuperando...');
        addLog('reporte-log', `🔄 Recuperando: ${reportes.batchDone} OK, ${reportes.batchError} errores de ${reportes.batchTotal}`);
        if (data.activeTabs?.length) {
            addLog('reporte-log', `📂 ${data.activeTabs.length} pestañas aún abiertas esperando descarga...`);
        }
    }
})();