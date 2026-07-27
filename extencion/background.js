// ============================================================
// SGVA TOOLKIT - BACKGROUND SERVICE WORKER v2.0
// Módulos: Reportes Paralelos + Cambio Disponible
// ============================================================

console.log('🤖 SGVA Toolkit Service Worker iniciado');

chrome.runtime.onInstalled.addListener(() => {
    console.log('🤖 Extensión instalada/actualizada a v2.0');
});

// ========================
// KEEP ALIVE
// ========================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'keepAlive') {
        sendResponse({ status: 'alive', timestamp: Date.now() });
        return true;
    }
});

// ========================
// NOTIFICACIONES UNIFICADAS
// ========================
async function mostrarNotificacion(id, titulo, mensaje, tipo = 'basic') {
    try {
        await chrome.notifications.create(id, {
            type: tipo,
            iconUrl: 'icon48.png',
            title: titulo,
            message: mensaje,
            priority: 2
        });
    } catch (e) {
        console.warn('No se pudo mostrar notificación:', e.message);
    }
}

// ========================
// MÓDULO: CAMBIO DISPONIBLE
// (Hub de mensajes desde popup/content)
// ========================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notificacionCambioDisponible') {
        const { exitosos, errores, total } = request;
        mostrarNotificacion(
            'cambio-disponible-done',
            exitosos > 0 ? '✅ Cambio Disponible completado' : '⚠️ Cambio Disponible finalizado con errores',
            `${exitosos} exitosos, ${errores} errores de ${total} total.`,
            'basic'
        );
        sendResponse({ ok: true });
        return true;
    }

    if (request.action === 'openSGVA') {
        chrome.tabs.create({ url: 'https://caprendizaje.sena.edu.co/sgva/Admin/Index' });
        sendResponse({ ok: true });
        return true;
    }

    return true;
});

// ========================
// MÓDULO: REPORTES PARALELOS
// ========================

const REPORT_BASE_URL = 'https://caprendizaje.sena.edu.co/sgva/ReportesFuncionario/Reporte13Export';

async function iniciarBatchParalelo(estados) {
    // Validar entrada
    if (!Array.isArray(estados) || estados.length === 0) {
        console.error('❌ iniciarBatchParalelo: estados vacío o inválido');
        return;
    }

    const queue = estados.map((e, i) => ({
        value: e.value,
        text: e.text,
        index: i,
        done: false,
        error: null
    }));
    const total = queue.length;

    // Resetear storage completamente antes de empezar
    await chrome.storage.local.set({
        reportQueue: queue,
        isProcessingReports: true,
        reportTotal: total,
        abortRequested: false,
        activeTabs: [],
        batchStartTime: Date.now()
    });

    // Limpiar keys residuales de ejecuciones anteriores
    await limpiarKeysDescargas();

    // Notificar popup
    chrome.runtime.sendMessage({
        action: 'batchIniciado',
        total: total
    }).catch(() => {});

    const tabsInfo = [];
    const createPromises = [];

    // Abrir TODAS las pestañas en paralelo (fire-and-forget con trackeo)
    for (const item of queue) {
        const params = new URLSearchParams({
            regional: '15',
            centro: '951400',
            estado: item.value,
            estado_nombre: item.text,
            fName: 'Aprendices disponibles.xlsx'
        });
        const url = `${REPORT_BASE_URL}?${params.toString()}`;

        const p = chrome.tabs.create({ url, active: false })
            .then(tab => {
                tabsInfo.push({
                    tabId: tab.id,
                    url,
                    index: item.index,
                    estadoValue: item.value,
                    estadoText: item.text
                });
            })
            .catch(err => {
                console.error('❌ Error creando tab:', err);
                queue[item.index].error = err.message || 'Error creando pestaña';
                chrome.runtime.sendMessage({
                    action: 'reporteDescargaError',
                    index: item.index,
                    estadoValue: item.value,
                    estadoText: item.text,
                    error: err.message || 'Error creando pestaña'
                }).catch(() => {});
            });

        createPromises.push(p);
    }

    await Promise.all(createPromises);

    await chrome.storage.local.set({ activeTabs: tabsInfo, reportQueue: queue });
    console.log(`🚀 ${tabsInfo.length}/${total} pestañas abiertas en paralelo`);

    // Si ninguna pestaña se abrió, fallar rápido
    if (tabsInfo.length === 0) {
        await finalizarBatch(0, total, 'No se pudieron abrir las pestañas de descarga');
    }
}

// ========================
// DETECTAR DESCARGAS Y CERRAR PESTAÑAS
// ========================

chrome.downloads.onCreated.addListener(async (item) => {
    const { isProcessingReports, activeTabs } = await chrome.storage.local.get([
        'isProcessingReports', 'activeTabs'
    ]);
    if (!isProcessingReports || !activeTabs || activeTabs.length === 0) return;

    const isSGVA = (item.url || '').includes('caprendizaje.sena.edu.co') ||
                   (item.referrer || '').includes('caprendizaje.sena.edu.co');
    if (!isSGVA) return;

    // Buscar la pestaña que generó esta descarga
    let match = activeTabs.find(t => t.url === item.url);
    if (!match && item.referrer) {
        match = activeTabs.find(t => item.referrer.includes(t.url) || t.url.includes(item.referrer));
    }

    if (!match) {
        console.log('⚠️ Descarga no coincide con batch:', item.url);
        return;
    }

    console.log(`📥 Descarga detectada [${match.index + 1}]: ${match.estadoText} (downloadId=${item.id})`);

    // Cerrar la pestaña AHORA que el navegador ya capturó la descarga
    chrome.tabs.remove(match.tabId).catch(err => console.log('Tab ya cerrada:', err.message));

    // Limpiar de activeTabs
    const filtered = activeTabs.filter(t => t.tabId !== match.tabId);
    await chrome.storage.local.set({ activeTabs: filtered });

    // Guardar info para trackear completitud en onChanged
    await chrome.storage.local.set({
        [`download_${item.id}`]: {
            index: match.index,
            estadoValue: match.estadoValue,
            estadoText: match.estadoText
        }
    });

    // Notificar popup
    chrome.runtime.sendMessage({
        action: 'reporteDescargaIniciada',
        index: match.index,
        estadoText: match.estadoText
    }).catch(() => {});
});

chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.state) return;

    const key = `download_${delta.id}`;
    const data = await chrome.storage.local.get(key);
    const info = data[key];

    if (!info) return; // No es nuestra descarga

    const { reportQueue } = await chrome.storage.local.get('reportQueue');
    if (reportQueue) {
        if (delta.state.current === 'complete') {
            console.log(`✅ Descarga completa [${info.index + 1}]: ${info.estadoText}`);
            reportQueue[info.index].done = true;
            await chrome.storage.local.set({ reportQueue });

            chrome.runtime.sendMessage({
                action: 'reporteDescargaCompleta',
                index: info.index,
                estado: info.estadoValue,
                estadoText: info.estadoText
            }).catch(() => {});

            await chrome.storage.local.remove(key);
            await verificarBatchCompleto();
        }

        if (delta.state.current === 'interrupted') {
            console.error(`❌ Descarga interrumpida [${info.index + 1}]: ${info.estadoText}`);
            reportQueue[info.index].error = 'Descarga interrumpida';
            await chrome.storage.local.set({ reportQueue });

            chrome.runtime.sendMessage({
                action: 'reporteDescargaError',
                index: info.index,
                estado: info.estadoValue,
                estadoText: info.estadoText,
                error: 'Descarga interrumpida'
            }).catch(() => {});

            await chrome.storage.local.remove(key);
            await verificarBatchCompleto();
        }
    }
});

// Si el usuario cierra una pestaña manualmente antes de que se descargue
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const { isProcessingReports, activeTabs, reportQueue } = await chrome.storage.local.get([
        'isProcessingReports', 'activeTabs', 'reportQueue'
    ]);
    if (!isProcessingReports || !activeTabs) return;

    const match = activeTabs.find(t => t.tabId === tabId);
    if (!match) return;

    console.log(`🗑️ Tab cerrada manualmente [${match.index + 1}]: ${match.estadoText}`);

    const filtered = activeTabs.filter(t => t.tabId !== tabId);
    await chrome.storage.local.set({ activeTabs: filtered });

    if (reportQueue && !reportQueue[match.index].done) {
        reportQueue[match.index].error = 'Pestaña cerrada manualmente';
        await chrome.storage.local.set({ reportQueue });

        chrome.runtime.sendMessage({
            action: 'reporteDescargaError',
            index: match.index,
            estado: match.estadoValue,
            estadoText: match.estadoText,
            error: 'Pestaña cerrada manualmente'
        }).catch(() => {});

        await verificarBatchCompleto();
    }
});

// ========================
// FINALIZACIÓN Y LIMPIEZA
// ========================

async function verificarBatchCompleto() {
    const { reportQueue, reportTotal, isProcessingReports } = await chrome.storage.local.get([
        'reportQueue', 'reportTotal', 'isProcessingReports'
    ]);
    if (!reportQueue || !isProcessingReports) return;

    const allDone = reportQueue.every(q => q.done || q.error);
    if (!allDone) return;

    const done = reportQueue.filter(r => r.done).length;
    const errs = reportQueue.filter(r => r.error).length;

    await finalizarBatch(done, errs, null);
}

async function finalizarBatch(done, errs, mensajeErrorGlobal) {
    const { reportTotal } = await chrome.storage.local.get('reportTotal');
    const total = reportTotal || done + errs;

    await chrome.storage.local.set({ isProcessingReports: false });

    chrome.runtime.sendMessage({
        action: 'batchCompletado',
        done,
        errors: errs,
        total
    }).catch(() => {});

    // Notificación nativa
    if (mensajeErrorGlobal) {
        await mostrarNotificacion('reportes-done', '❌ Reportes SGVA - Error', mensajeErrorGlobal);
    } else {
        await mostrarNotificacion(
            'reportes-done',
            done === total ? '✅ Reportes SGVA completados' : '⚠️ Reportes SGVA finalizados',
            `${done} descargados, ${errs} errores de ${total} total.`
        );
    }

    // Limpiar todo
    await chrome.storage.local.remove([
        'reportQueue', 'reportTotal', 'abortRequested', 'activeTabs', 'batchStartTime'
    ]);
    await limpiarKeysDescargas();
}

async function limpiarKeysDescargas() {
    const all = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(k => k.startsWith('download_'));
    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
    }
}

// ========================
// ABORTAR BATCH
// ========================

async function abortarBatch() {
    const { activeTabs } = await chrome.storage.local.get('activeTabs');
    if (activeTabs && activeTabs.length > 0) {
        const ids = activeTabs.map(t => t.tabId).filter(id => id);
        if (ids.length > 0) {
            chrome.tabs.remove(ids).catch(() => {});
        }
    }

    const { reportQueue } = await chrome.storage.local.get('reportQueue');
    if (reportQueue) {
        reportQueue.forEach(q => {
            if (!q.done && !q.error) q.error = 'Abortado por el usuario';
        });
        await chrome.storage.local.set({ reportQueue });
    }

    await chrome.storage.local.remove([
        'reportQueue', 'isProcessingReports', 'reportTotal',
        'abortRequested', 'activeTabs', 'batchStartTime'
    ]);
    await limpiarKeysDescargas();

    chrome.runtime.sendMessage({ action: 'batchAbortado' }).catch(() => {});
    console.log('⛔ Batch abortado');
}

// ========================
// MENSAJES PRINCIPALES
// ========================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'iniciarBatchReportes') {
        iniciarBatchParalelo(request.estados);
        sendResponse({ ok: true });
        return true;
    }

    if (request.action === 'abortarBatch') {
        abortarBatch();
        sendResponse({ ok: true });
        return true;
    }

    return true;
});

self.addEventListener('activate', () => console.log('SW activado'));