console.log('🤖 Service Worker iniciado');

chrome.runtime.onInstalled.addListener(() => {
    console.log('🤖 Extensión instalada');
});

// ========================
// ORQUESTADOR PARALELO
// ========================

async function iniciarBatchParalelo(estados) {
    const queue = estados.map((e, i) => ({ ...e, index: i, done: false, error: null }));
    const total = queue.length;

    await chrome.storage.local.set({
        reportQueue: queue,
        isProcessingReports: true,
        reportTotal: total,
        abortRequested: false,
        activeTabs: []
    });

    // Notificar popup
    chrome.runtime.sendMessage({
        action: 'batchIniciado',
        total: total
    }).catch(() => {});

    const baseUrl = 'https://caprendizaje.sena.edu.co/sgva/ReportesFuncionario/Reporte13Export';
    const tabsInfo = [];

    // Abrir TODAS las pestañas en paralelo (sin await entre ellas)
    for (const item of queue) {
        const params = new URLSearchParams({
            regional: '15',
            centro: '951400',
            estado: item.value,
            estado_nombre: item.text,
            fName: 'Aprendices disponibles.xlsx'
        });
        const url = `${baseUrl}?${params.toString()}`;

        try {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabsInfo.push({
                tabId: tab.id,
                url: url,
                index: item.index,
                estadoValue: item.value,
                estadoText: item.text
            });
        } catch (err) {
            console.error('❌ Error creando tab:', err);
            queue[item.index].error = err.message || 'Error creando pestaña';
            chrome.runtime.sendMessage({
                action: 'reporteDescargaError',
                index: item.index,
                estadoText: item.text,
                error: err.message || 'Error creando pestaña'
            }).catch(() => {});
        }
    }

    // Guardar todas las pestañas en storage
    await chrome.storage.local.set({ activeTabs: tabsInfo, reportQueue: queue });
    console.log(`🚀 ${tabsInfo.length} pestañas abiertas en paralelo`);
}

// ========================
// DETECTAR DESCARGAS Y CERRAR PESTAÑAS
// ========================

chrome.downloads.onCreated.addListener(async (item) => {
    // Verificar si hay un batch activo (desde storage, no memoria)
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

    if (delta.state.current === 'complete') {
        console.log(`✅ Descarga completa [${info.index + 1}]: ${info.estadoText}`);

        const { reportQueue } = await chrome.storage.local.get('reportQueue');
        if (reportQueue) {
            reportQueue[info.index].done = true;
            await chrome.storage.local.set({ reportQueue });
        }

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

        const { reportQueue } = await chrome.storage.local.get('reportQueue');
        if (reportQueue) {
            reportQueue[info.index].error = 'Descarga interrumpida';
            await chrome.storage.local.set({ reportQueue });
        }

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

    // Limpiar de activeTabs
    const filtered = activeTabs.filter(t => t.tabId !== tabId);
    await chrome.storage.local.set({ activeTabs: filtered });

    // Marcar como error si aún no estaba done
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

async function verificarBatchCompleto() {
    const { reportQueue, reportTotal, isProcessingReports } = await chrome.storage.local.get([
        'reportQueue', 'reportTotal', 'isProcessingReports'
    ]);
    if (!reportQueue || !isProcessingReports) return;

    const allDone = reportQueue.every(q => q.done || q.error);
    if (!allDone) return;

    const done = reportQueue.filter(r => r.done).length;
    const errs = reportQueue.filter(r => r.error).length;

    await chrome.storage.local.set({ isProcessingReports: false });

    chrome.runtime.sendMessage({
        action: 'batchCompletado',
        done: done,
        errors: errs,
        total: reportTotal
    }).catch(() => {});

    // Limpiar todo
    await chrome.storage.local.remove([
        'reportQueue', 'reportTotal', 'abortRequested', 'activeTabs'
    ]);

    // Limpiar keys de descargas residuales
    const all = await chrome.storage.local.get(null);
    for (const k of Object.keys(all)) {
        if (k.startsWith('download_')) await chrome.storage.local.remove(k);
    }

    try {
        await chrome.notifications.create('reportes-done', {
            type: 'basic',
            iconUrl: 'icon48.png',
            title: '✅ Reportes SGVA completados',
            message: `${done} descargados, ${errs} errores de ${reportTotal} total.`,
            priority: 2
        });
    } catch (e) {}
}

// ========================
// MENSAJES
// ========================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openSGVA') {
        chrome.tabs.create({ url: 'https://caprendizaje.sena.edu.co/sgva/Admin/Index' });
    }

    if (request.action === 'keepAlive') {
        sendResponse({ status: 'alive' });
    }

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

async function abortarBatch() {
    const { activeTabs } = await chrome.storage.local.get('activeTabs');
    if (activeTabs && activeTabs.length > 0) {
        const ids = activeTabs.map(t => t.tabId).filter(id => id);
        chrome.tabs.remove(ids).catch(() => {});
    }

    await chrome.storage.local.remove([
        'reportQueue', 'isProcessingReports', 'reportTotal',
        'abortRequested', 'activeTabs'
    ]);

    const all = await chrome.storage.local.get(null);
    for (const k of Object.keys(all)) {
        if (k.startsWith('download_')) await chrome.storage.local.remove(k);
    }

    chrome.runtime.sendMessage({ action: 'batchAbortado' }).catch(() => {});
    console.log('⛔ Batch abortado');
}

self.addEventListener('activate', () => console.log('SW activado'));