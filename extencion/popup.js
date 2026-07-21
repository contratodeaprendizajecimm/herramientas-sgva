// ========================
// REPORTES POR ESTADO - BATCH PARALELO
// ========================
const btnCargarEstados = document.getElementById('btnCargarEstados');
const estadosCheckboxes = document.getElementById('estadosCheckboxes');
const btnDescargarReportes = document.getElementById('btnDescargarReportes');
const btnAbortar = document.getElementById('btnAbortar');
const reportesProgressBox = document.getElementById('reportesProgressBox');
const reportesProgressFill = document.getElementById('reportesProgressFill');
const reportesStatusText = document.getElementById('reportesStatusText');
const reportesProgressText = document.getElementById('reportesProgressText');
const reportesLogConsole = document.getElementById('reportesLogConsole');
const reportesCompletion = document.getElementById('reportesCompletion');

let estadosDisponibles = [];
let batchDoneCount = 0;
let batchErrorCount = 0;
let batchTotal = 0;

btnCargarEstados.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ url: '*://caprendizaje.sena.edu.co/*' });
    const tab = tabs.find(t => t.url.includes('Reporte13')) || tabs[0];
    if (!tab || !tab.url.includes('Reporte13')) {
        alert('No se encontró la pestaña de Reporte13. Ábrela primero:\nhttps://caprendizaje.sena.edu.co/sgva/Admin/Reportes/Reporte13');
        return;
    }
    try {
        btnCargarEstados.disabled = true;
        btnCargarEstados.textContent = '⏳ Cargando...';
        estadosCheckboxes.innerHTML = '<small style="color:#666;">⏳ Consultando SGVA...</small>';

        const res = await chrome.tabs.sendMessage(tab.id, { action: 'getEstadosDisponibles' });
        if (res.success) {
            estadosDisponibles = res.estados;
            renderEstadosCheckboxes(estadosDisponibles);
            addReportesLog(`✅ ${estadosDisponibles.length} estados cargados desde SGVA`);
        } else {
            throw new Error(res.error);
        }
    } catch (e) {
        estadosCheckboxes.innerHTML = `<small style="color:#dc2626;">❌ Error: ${e.message}</small>`;
        addReportesLog(`❌ Error cargando estados: ${e.message}`);
    } finally {
        btnCargarEstados.disabled = false;
        btnCargarEstados.textContent = '🔄 Cargar estados desde SGVA';
    }
});

function renderEstadosCheckboxes(estados) {
    estadosCheckboxes.innerHTML = '';
    if (estados.length === 0) {
        estadosCheckboxes.innerHTML = '<small style="color:#666;">No se encontraron estados</small>';
        btnDescargarReportes.disabled = true;
        return;
    }
    estados.forEach((est) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px; font-size:13px; cursor:pointer;';
        label.innerHTML = `
            <input type="checkbox" class="estado-check" value="${escHtml(est.value)}" data-text="${escHtml(est.text)}" checked>
            <span>${escHtml(est.text)} <small style="color:#94a3b8">(${escHtml(est.value)})</small></span>
        `;
        estadosCheckboxes.appendChild(label);
    });
    btnDescargarReportes.disabled = false;
    updateCheckboxListener();
}

function updateCheckboxListener() {
    document.querySelectorAll('.estado-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = document.querySelectorAll('.estado-check:checked').length;
            btnDescargarReportes.disabled = checked === 0;
        });
    });
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Descargar: delegar todo al background (paralelo)
btnDescargarReportes.addEventListener('click', async () => {
    const checks = document.querySelectorAll('.estado-check:checked');
    if (checks.length === 0) { alert('Selecciona al menos un estado'); return; }

    const estados = Array.from(checks).map(cb => ({ value: cb.value, text: cb.dataset.text }));

    await chrome.runtime.sendMessage({
        action: 'iniciarBatchReportes',
        estados: estados
    });
});

// Abortar
btnAbortar.addEventListener('click', async () => {
    btnAbortar.disabled = true;
    btnAbortar.textContent = '⛔ Abortando...';
    addReportesLog('⛔ Solicitando abort...');
    await chrome.runtime.sendMessage({ action: 'abortarBatch' });
});

function updateReportesUI(current, total, status) {
    const pct = total === 0 ? 0 : Math.round((current / total) * 100);
    reportesProgressFill.style.width = pct + '%';
    reportesProgressFill.textContent = pct + '%';
    reportesProgressText.textContent = `${current}/${total}`;
    reportesStatusText.textContent = status;
}

function addReportesLog(msg) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${msg}`;
    reportesLogConsole.appendChild(entry);
    reportesLogConsole.scrollTop = reportesLogConsole.scrollHeight;
}

function mostrarAbortar() {
    btnAbortar.style.display = 'block';
    btnDescargarReportes.disabled = true;
    btnCargarEstados.disabled = true;
}

function ocultarAbortar() {
    btnAbortar.style.display = 'none';
    btnAbortar.disabled = false;
    btnAbortar.textContent = '⛔ Abortar Operación';
    btnDescargarReportes.disabled = false;
    btnCargarEstados.disabled = false;
}

// Escuchar progreso del background
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchIniciado') {
        batchDoneCount = 0;
        batchErrorCount = 0;
        batchTotal = request.total;
        reportesProgressBox.style.display = 'block';
        reportesCompletion.style.display = 'none';
        mostrarAbortar();
        updateReportesUI(0, batchTotal, 'Abriendo pestañas en paralelo...');
        reportesLogConsole.innerHTML = '';
        addReportesLog(`🚀 Abriendo ${batchTotal} reportes en paralelo`);
    }

    if (request.action === 'reporteDescargaIniciada') {
        addReportesLog(`📥 [${request.index + 1}] Descarga detectada: ${request.estadoText}`);
    }

    if (request.action === 'reporteDescargaCompleta') {
        batchDoneCount++;
        updateReportesUI(batchDoneCount + batchErrorCount, batchTotal, `${request.estadoText} completado`);
        addReportesLog(`✅ [${request.index + 1}] Descargado: ${request.estadoText}`);
        const cb = document.querySelector(`.estado-check[value="${request.estado}"]`);
        if (cb) {
            cb.checked = false;
            cb.parentElement.style.opacity = '0.5';
        }
    }

    if (request.action === 'reporteDescargaError') {
        batchErrorCount++;
        updateReportesUI(batchDoneCount + batchErrorCount, batchTotal, `Error en ${request.estadoText}`);
        addReportesLog(`❌ [${request.index + 1}] Error: ${request.estadoText} - ${request.error}`);
        const cb = document.querySelector(`.estado-check[value="${request.estado}"]`);
        if (cb) {
            cb.parentElement.style.color = '#dc2626';
        }
    }

    if (request.action === 'batchCompletado') {
        ocultarAbortar();
        reportesCompletion.innerHTML = `
            <div class="alert alert-success">
                <strong>✅ Completado</strong><br>
                ${request.done} descargados, ${request.errors} errores de ${request.total} total
            </div>
        `;
        reportesCompletion.style.display = 'block';
        updateReportesUI(request.total, request.total, 'Completado');
        addReportesLog(`🎉 PROCESO FINALIZADO: ${request.done} OK, ${request.errors} errores`);
    }

    if (request.action === 'batchAbortado') {
        ocultarAbortar();
        reportesCompletion.innerHTML = `
            <div class="alert alert-danger">
                <strong>⛔ Operación Abortada</strong><br>
                Las pestañas restantes fueron cerradas.
            </div>
        `;
        reportesCompletion.style.display = 'block';
        addReportesLog('⛔ Operación abortada por el usuario');
    }
});

// Recuperar estado al abrir el popup
(async function checkPendingReports() {
    const data = await chrome.storage.local.get([
        'isProcessingReports', 'reportTotal', 'reportQueue', 'activeTabs'
    ]);

    if (data.isProcessingReports && data.reportQueue) {
        batchTotal = data.reportTotal || data.reportQueue.length;
        batchDoneCount = data.reportQueue.filter(q => q.done).length;
        batchErrorCount = data.reportQueue.filter(q => q.error).length;

        reportesProgressBox.style.display = 'block';
        reportesCompletion.style.display = 'none';
        mostrarAbortar();

        if (data.reportQueue.length > 0) {
            estadosDisponibles = data.reportQueue.map(q => ({ value: q.value, text: q.text }));
            renderEstadosCheckboxes(estadosDisponibles);
            data.reportQueue.forEach((q) => {
                const cb = document.querySelector(`.estado-check[value="${q.value}"]`);
                if (cb) {
                    cb.checked = !q.done && !q.error;
                    if (q.done) cb.parentElement.style.opacity = '0.5';
                    if (q.error) cb.parentElement.style.color = '#dc2626';
                }
            });
        }

        updateReportesUI(batchDoneCount + batchErrorCount, batchTotal, 'Recuperando...');
        addReportesLog(`🔄 Recuperando: ${batchDoneCount} OK, ${batchErrorCount} errores de ${batchTotal}`);
        if (data.activeTabs) {
            addReportesLog(`📂 ${data.activeTabs.length} pestañas aún abiertas esperando descarga...`);
        }
    }
})();