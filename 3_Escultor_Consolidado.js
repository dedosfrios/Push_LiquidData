// =========================================================================
// ARCHIVO: 3_Escultor_Consolidado.gs
// DESCRIPCIÓN: Capa 3 - Orquestador ETL con Validación de Contratos y Persistencia SSOT
// =========================================================================

function ejecutarReporteConsolidado() {
  const logger = [];
  logger.push(`🚀 [${new Date().toISOString()}] Inicio de orquestación ETL...`);

  const config = _obtenerConfiguracionEntorno();
  const idDestino = config.DESTINO_BI_ID;

  if (!idDestino) throw new Error("🚨 CRITICAL: No se definió DESTINO_BI_ID.");

  logger.push("📥 Extrayendo data lakes en memoria RAM...");
  const rsApp = extraerDatalakeAirshipAvanzado();
  const rsWeb = extraerDatalakeAirshipWeb();
  const rsMasterApp = extraerDatalakeMasterDB();
  const rsMasterWeb = extraerDatalakeMasterWebDB();
  const rsAdobe = extraerDatalakeAdobe();

  // PROGRAMACIÓN DEFENSIVA: Validar el Contrato de Datos de la Capa 1
  const modulos = [rsApp, rsWeb, rsMasterApp, rsMasterWeb, rsAdobe];
  for (let i = 0; i < modulos.length; i++) {
    if (!modulos[i] || typeof modulos[i].mapaData === 'undefined') {
      throw new Error(`🚨 CONTRATO ROTO: El módulo de Datalake en el índice ${i} no devolvió la estructura '{ encabezados, mapaData }'. Asegúrate de que el archivo 1_Datalake_Liquido.gs está actualizado con la última versión provista.`);
    }
  }

  const datalakeApp = rsApp.mapaData;
  const datalakeWeb = rsWeb.mapaData;
  const masterAppMap = rsMasterApp.mapaData;
  const masterWebMap = rsMasterWeb.mapaData;
  const adobeMap = rsAdobe.mapaData;

  logger.push(`📊 Registros base cargados - App: ${datalakeApp.size} | Web: ${datalakeWeb.size}`);

  const columnasExcluidas = new Set(["", "Custom Objects Raw", "Notification Name", "IED", "IED_Sanitizado"]);
  const superSetHeaders = new Set();
  
  modulos.forEach(rs => {
    rs.encabezados.forEach(h => {
      if (!columnasExcluidas.has(h)) superSetHeaders.add(h);
    });
  });

  const masterHeaders = ["Canal", "IED", ...Array.from(superSetHeaders)];
  const filasConsolidadas = [masterHeaders];

  const construirFilaCompleta = (canal, ied, objCombinado) => {
    return masterHeaders.map(header => {
      if (header === "Canal") return canal;
      if (header === "IED") return ied;
      return objCombinado[header] !== undefined ? objCombinado[header] : ""; 
    });
  };

  // Transform: Canal APP
  for (const [claveUniversal, appData] of datalakeApp.entries()) {
    const masterData = masterAppMap.get(claveUniversal) || {};
    const adobeData = adobeMap.get(claveUniversal) || {};
    const superObjeto = { ...masterData, ...appData, ...adobeData };
    filasConsolidadas.push(construirFilaCompleta("APP", appData.__displayIed, superObjeto));
  }

  // Transform: Canal WEB
  for (const [claveUniversal, webData] of datalakeWeb.entries()) {
    const masterWebData = masterWebMap.get(claveUniversal) || {};
    const adobeData = adobeMap.get(claveUniversal) || {};
    const superObjeto = { ...masterWebData, ...webData, ...adobeData };
    filasConsolidadas.push(construirFilaCompleta("WEB", webData.__displayIed, superObjeto));
  }

  logger.push(`💾 Preparando escritura de ${filasConsolidadas.length - 1} filas y ${masterHeaders.length} dimensiones...`);

  // =========================================================================
  // 4. LOAD: Persistencia Segura (Truncate & Load)
  // =========================================================================
  const ssDestino = SpreadsheetApp.openById(idDestino);
  let sheetMaster = ssDestino.getSheetByName("CONSOLIDADO_MASTER");

  // Validación de pre-existencia para proteger el GID de Looker Studio
  if (!sheetMaster) {
    sheetMaster = ssDestino.insertSheet("CONSOLIDADO_MASTER");
    logger.push("⚠️ AVISO: Pestaña creada por primera vez. Conecta Looker a esta pestaña.");
  } else {
    // Purga de datos estrictamente no destructiva (mantiene formatos y GID)
    sheetMaster.clearContents(); 
  }

  if (filasConsolidadas.length > 1) {
    sheetMaster.getRange(1, 1, filasConsolidadas.length, masterHeaders.length).setValues(filasConsolidadas);
  } else {
    logger.push("⚠️ WARNING: No hay datos indexables válidos para consolidar. Se escribió solo el encabezado.");
    sheetMaster.getRange(1, 1, 1, masterHeaders.length).setValues([masterHeaders]);
  }

  logger.push("✅ [SUCCESS] ETL Schema-Agnostic completado.");
  console.log(logger.join("\n"));
}