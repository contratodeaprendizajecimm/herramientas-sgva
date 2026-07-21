# 🤖 SGVA Automation Suite — SENA Regional Boyacá

> **Herramientas internas del CIMM Sogamoso** para automatización del SGVA y validación de datos de aprendices en etapa práctica.

---

## 📦 Contenido del Repositorio

| Archivo / Carpeta | Descripción |
|-------------------|-------------|
| `manifest.json` | Manifiesto de la extensión Chrome (MV3) |
| `background.js` | Service Worker — orquestador de descargas paralelas |
| `content.js` | Script inyectado en páginas del SGVA |
| `popup.html` + `popup.js` | Interfaz de usuario de la extensión |
| `consolidador_sena_v3.html` | Herramienta HTML local para consolidar y clasificar archivos Excel |
| `xlsx.full.min.js` *(requerido)* | Librería SheetJS para lectura/escritura de Excel |

---

## 🔒 Alcance y Uso

> **⚠️ Uso exclusivo para funcionarios del CIMM Sogamoso — SENA Regional Boyacá.**
>
> Esta suite **no está publicada** en la Chrome Web Store ni en ningún marketplace. Es software interno desarrollado para automatizar flujos específicos del sistema SGVA (`caprendizaje.sena.edu.co`).

---

## 🧩 1. Extensión Chrome — "Cambio disponible SGVA"

### Funcionalidades

- **Cambio de estado a "Disponible"**: Lee un archivo Excel con aprendices (documento + tipo de documento), navega automáticamente al módulo *Consultar Aprendiz* del SGVA y cambia su estado a disponible uno por uno.
- **Descarga masiva de reportes por estado**: Desde `Reporte13`, abre pestañas en paralelo para descargar reportes de múltiples estados simultáneamente, cerrando cada pestaña al detectar la descarga.
- **Verificación de sesión**: Detecta si el usuario está logueado en el SGVA antes de ejecutar acciones.

### Instalación (modo desarrollador)

1. Abre Chrome y ve a `chrome://extensions/`.
2. Activa el **modo desarrollador** (esquina superior derecha).
3. Haz clic en **"Cargar descomprimida"**.
4. Selecciona la carpeta que contiene los archivos de la extensión.
5. La extensión aparecerá en la barra de herramientas.

> **Nota:** La extensión requiere permisos amplios (`*://*/*`) para inyectar scripts en el dominio del SGVA. No la distribuyas fuera del centro.

### Requisitos

- Google Chrome o Chromium (MV3 compatible).
- Sesión activa en el SGVA con permisos de funcionario.
- Archivo Excel con columnas: tipo de documento y número de documento.

---

## 📊 2. Consolidador SENA — Etapa Práctica

### ¿Qué hace?

Herramienta HTML local (sin servidor) que permite:

1. **Cargar una carpeta** con múltiples archivos Excel/CSV.
2. **Consolidar** todas las filas en un solo dataset.
3. **Clasificar aprendices** según la validez de su etapa práctica (18 meses):
   - ✅ **Válidos**: Fecha productiva dentro de los 18 meses.
   - ❌ **No válidos**: Vencieron los 18 meses **y** tienen 0 contratos.
   - ⚠️ **Conflictos**: Vencieron los 18 meses **pero** tienen contratos activos.
4. **Eliminar duplicados idénticos** automáticamente.
5. **Exportar** cada categoría a archivos Excel separados.

### Uso

1. Descarga la librería **SheetJS** (`xlsx.full.min.js`) y colócala en la misma carpeta que `consolidador_sena_v3.html`.
2. Abre `consolidador_sena_v3.html` en cualquier navegador moderno.
3. Haz clic en **"Elegir carpeta"** y selecciona la carpeta con tus archivos Excel.
4. Revisa las estadísticas y descarga las categorías que necesites.

### Formato esperado de los archivos

Los archivos deben contener al menos estas columnas (nombres flexibles):

| Campo | Variantes de nombre aceptadas |
|-------|------------------------------|
| Número de documento | `Número Documento`, `Documento`, `CC`, `Cédula`, `Identificación`, etc. |
| Fecha Productiva | `Fecha Productiva`, `Etapa Práctica`, `FechaPractica`, etc. |
| Cantidad de contratos | `Cantidad de contratos`, `Contratos`, `Total Contratos`, etc. |

---

## ⚙️ Dependencias

| Dependencia | Versión | Uso | Dónde obtener |
|-------------|---------|-----|---------------|
| `xlsx.full.min.js` (SheetJS) | 0.20.x o compatible | Lectura y escritura de archivos Excel | [https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js](https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js) |

> **Importante:** Tanto la extensión como el consolidador requieren esta librería. Descárgala y colócala junto a los archivos correspondientes.

---

## 🛡️ Seguridad y Privacidad

- **No almacena credenciales** ni datos personales en servidores externos.
- Toda la operación ocurre **localmente** en el navegador del funcionario.
- La extensión solo actúa sobre el dominio `caprendizaje.sena.edu.co`.
- Los datos procesados por el consolidador **nunca salen del equipo**.

---

## 📝 Notas Técnicas

- La extensión usa **Manifest V3** y un Service Worker para orquestar descargas paralelas.
- El mapeo de tipos de documento (`CC`, `TI`, `CE`, etc.) está hardcodeado en `content.js`.
- La regional (`15`) y centro (`951400`) están configurados en `background.js` para reportes.
- El consolidador detecta fechas en múltiples formatos: serial Excel, `DD/MM/YYYY`, `YYYY-MM-DD`, ISO, etc.

---

## 👥 Autoría y Soporte

Desarrollado para uso interno del **CIMM Sogamoso — SENA Regional Boyacá**.

Para dudas o mejoras, contactar al área de sistemas del centro.

---

> **⚠️ Advertencia legal:** Este software es propiedad del Servicio Nacional de Aprendizaje (SENA). Su uso no autorizado fuera de las instalaciones o fines establecidos puede constituir una violación de las políticas de seguridad de la información de la entidad.
