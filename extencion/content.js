console.log('🤖 SGVA Bot cargado en:', window.location.href);

const TIPO_DOC_MAP = {
    'CEDULA DE CIUDADANIA': '01', 'CÉDULA DE CIUDADANÍA': '01', 'CEDULA CIUDADANIA': '01', 'CC': '01', 'C.C': '01', 'C.C.': '01',
    'TARJETA DE IDENTIDAD': '02', 'TARJETA IDENTIDAD': '02', 'TI': '02', 'T.I': '02', 'T.I.': '02',
    'CEDULA DE EXTRANJERIA': '03', 'CÉDULA DE EXTRANJERÍA': '03', 'CEDULA EXTRANJERIA': '03', 'CE': '03', 'C.E': '03', 'C.E.': '03',
    'REGISTRO UNICO': '04', 'REGISTRO ÚNICO': '04', 'NUIP': '04', 'RU': '04', 'R.U': '04', 'R.U.': '04',
    'PERMISO ESPECIAL PERMANENCIA': '05', 'PERMISO ESPECIAL DE PERMANENCIA': '05', 'PEP': '05', 'P.E.P': '05', 'P.E.P.': '05',
    'PERMISO PROTECCION TEMPORAL': '06', 'PERMISO PROTECCIÓN TEMPORAL': '06', 'PERMISO DE PROTECCION TEMPORAL': '06', 'PPT': '06', 'P.P.T': '06', 'P.P.T.': '06'
};

let keepAliveInterval;
function startKeepAlive() {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'keepAlive' }).catch(() => {});
    }, 20000);
}
startKeepAlive();

function checkIfLoggedIn() {
    const isInSGVA = window.location.href.includes('caprendizaje.sena.edu.co/sgva');
    if (!isInSGVA) return false;
    const indicators = {
        inAdminArea: window.location.href.includes('/Admin'),
        hasCerrarSesion: document.body.textContent.includes('Cerrar Sesión') || document.body.textContent.includes('cerrar sesión'),
        hasLogoutLink: document.querySelector('a[href*="Logout"]') !== null || document.querySelector('a[href*="logout"]') !== null,
        hasAdminMenu: document.querySelector('a[href*="Administrar"]') !== null || document.body.textContent.includes('Administrar'),
        notInLogin: !window.location.href.includes('/Login') && !document.body.textContent.includes('Iniciar Sesión')
    };
    if (indicators.inAdminArea) return true;
    return Object.values(indicators).filter(v => v === true).length >= 2;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Acción:', request.action);

    if (request.action === 'checkLogin') {
        sendResponse({ loggedIn: checkIfLoggedIn() });
        return true;
    }

    if (request.action === 'processAprendiz') {
        if (!window.location.href.includes('/Admin/AprendizConsultar')) {
            sendResponse({ success: false, error: 'No estás en Consultar Aprendiz', needsNavigation: true });
            return true;
        }
        processAprendiz(request.aprendiz)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'getEstadosDisponibles') {
        getEstadosDisponibles()
            .then(estados => sendResponse({ success: true, estados }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'generarReporte') {
        sendResponse({ success: false, error: 'El batch ahora se maneja desde el background con pestañas independientes.' });
        return true;
    }
});

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function normalizarTipoDoc(tipoDoc) {
    if (!tipoDoc) return '01';
    let t = tipoDoc.toString().trim().toUpperCase().replace(/\s+/g, ' ');
    if (TIPO_DOC_MAP[t]) return TIPO_DOC_MAP[t];
    for (const [k, v] of Object.entries(TIPO_DOC_MAP)) {
        if (t.includes(k) || k.includes(t)) return v;
    }
    return '01';
}

// ========================
// CAMBIO A DISPONIBLE
// ========================
async function processAprendiz(aprendiz) {
    console.log(`🔄 ${aprendiz.documento}`);
    if (!window.location.href.includes('/Admin/AprendizConsultar')) {
        throw new Error('No estás en Consultar Aprendiz');
    }
    await wait(300);

    const docInput = document.querySelector('input#txt_docid');
    if (docInput) docInput.value = '';
    await wait(200);

    const selTdoc = document.querySelector('select#sel_tdoc');
    if (!selTdoc) throw new Error('No sel_tdoc');
    const val = normalizarTipoDoc(aprendiz.tipoDoc);
    selTdoc.value = val;
    selTdoc.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
    if (selTdoc.value !== val && window.jQuery) {
        window.jQuery(selTdoc).val(val).trigger('change');
        await wait(300);
    }
    await wait(400);

    const docField = document.querySelector('input#txt_docid');
    if (!docField) throw new Error('No txt_docid');
    docField.value = aprendiz.documento;
    docField.dispatchEvent(new Event('input', { bubbles: true }));
    docField.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(500);

    const btnConsultar = document.querySelector('button#botonConsultar');
    if (!btnConsultar) throw new Error('No botonConsultar');
    btnConsultar.click();
    await wait(3000);

    const lblNombre = document.querySelector('label#lbl_nombre');
    if (!lblNombre || !lblNombre.textContent.trim()) {
        throw new Error('Aprendiz no encontrado');
    }
    await wait(500);

    const btnAct = document.querySelector('button#botonActEstado');
    if (!btnAct) throw new Error('No botonActEstado');
    btnAct.click();
    await wait(2000);

    const selNuevo = document.querySelector('select#sel_actest_nuevo');
    if (!selNuevo) throw new Error('No sel_actest_nuevo');
    selNuevo.value = "1";
    selNuevo.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(500);

    const btnAceptar = document.querySelector('button#btn_actest_aceptar');
    if (!btnAceptar) throw new Error('No btn_actest_aceptar');
    btnAceptar.click();
    await wait(2000);

    try {
        const btnConf = document.querySelector('button#btn_confirmar_aceptar');
        if (btnConf) { btnConf.click(); await wait(1500); }
    } catch (e) {}

    try {
        const btnAlert = document.querySelector('button#btn_alerta_cerrar');
        if (btnAlert) { btnAlert.click(); await wait(500); }
    } catch (e) {}

    return { success: true };
}

// ========================
// REPORTES: LEER ESTADOS
// ========================
async function getEstadosDisponibles() {
    if (!window.location.href.includes('Reporte13')) {
        throw new Error('No estás en Reporte13. Estás en: ' + window.location.href);
    }
    const sel = document.querySelector('select#selEstado');
    if (!sel) throw new Error('No se encontró select#selEstado en esta página');

    return Array.from(sel.options)
        .filter(opt => opt.value && opt.value.trim() !== '' && opt.value.trim() !== '0')
        .map(opt => ({ value: opt.value.trim(), text: opt.text.trim() }));
}

const style = document.createElement('style');
style.textContent = `
    .sgva-bot-highlight { outline: 3px solid #39b54a !important; outline-offset: 2px; animation: sgva-pulse 1s infinite; }
    @keyframes sgva-pulse { 0%, 100% { outline-color: #39b54a; } 50% { outline-color: #1e7a2f; } }
`;
document.head.appendChild(style);
console.log('✅ SGVA Bot listo');