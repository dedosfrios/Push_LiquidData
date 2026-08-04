function debugAdobeEnVivo() {
  // Replica EXACTAMENTE los primeros pasos de ejecutarMonitoreoOperativo()
  // para ver en qué momento se rompe.

  Logger.log("¿extraerDatalakeAirship existe? " + (typeof extraerDatalakeAirship === "function"));
  Logger.log("¿extraerDatalakeAdobe existe? " + (typeof extraerDatalakeAdobe === "function"));
  Logger.log("¿extraerDatalakeMasterDB existe? " + (typeof extraerDatalakeMasterDB === "function"));

  let airshipResult, adobeResult, masterDBResult;

  try {
    airshipResult = extraerDatalakeAirship();
    Logger.log("✅ extraerDatalakeAirship() ejecutó sin error. mapaData.size = " + airshipResult.mapaData.size);
  } catch (e) {
    Logger.log("❌ extraerDatalakeAirship() lanzó error: " + e.message);
  }

  try {
    adobeResult = extraerDatalakeAdobe();
    Logger.log("✅ extraerDatalakeAdobe() ejecutó sin error. mapaData.size = " + adobeResult.mapaData.size);
  } catch (e) {
    Logger.log("❌ extraerDatalakeAdobe() lanzó error: " + e.message);
  }

  try {
    masterDBResult = extraerDatalakeMasterDB();
    Logger.log("✅ extraerDatalakeMasterDB() ejecutó sin error. mapaData.size = " + masterDBResult.mapaData.size);
  } catch (e) {
    Logger.log("❌ extraerDatalakeMasterDB() lanzó error: " + e.message);
  }

  if (!adobeResult) return;

  const adobeMap = adobeResult.mapaData;

  // Probamos con los 5 IEDs conocidos
  const IEDS_A_INVESTIGAR = ["acc100012964", "acc100012965", "acc100012966", "acc100012967", "acc100012968"];
  IEDS_A_INVESTIGAR.forEach(ied => {
    const claveUniversal = ied.toLowerCase();
    Logger.log(`"${claveUniversal}" -> ¿existe en adobeMap? ${adobeMap.has(claveUniversal)}`);
    if (adobeMap.has(claveUniversal)) {
      Logger.log("   Contenido: " + JSON.stringify(adobeMap.get(claveUniversal)));
    }
  });

  // Tomamos una muestra real del Masterfile (primeras 5 filas de datos)
  // para ver si el "ied" que se lee ahí calza con las llaves del mapa.
  const rawMaster = SpreadsheetApp.openById(ENTORNO.MASTERFILE_ID).getSheets()[0].getDataRange().getValues();
  Logger.log("\n--- Muestra de las primeras 5 filas del Masterfile ---");
  let mostrados = 0;
  for (let i = 1; i < rawMaster.length && mostrados < 5; i++) {
    const ied = String(rawMaster[i][0]).trim();
    if (!ied || ied === "acc1" || ied.toLowerCase() === "ied") continue;
    const claveUniversal = ied.toLowerCase();
    Logger.log(`Fila ${i + 1}: ied="${ied}" -> claveUniversal="${claveUniversal}" -> ¿existe en adobeMap? ${adobeMap.has(claveUniversal)}`);
    mostrados++;
  }
}

function debugHeadersMasterDB() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.MASTER_APP_ID).getSheets()[0].getDataRange().getValues();
  const headers = rawData[0].map(h => String(h).trim());

  Logger.log("=== ENCABEZADOS MasterDB (con índice) ===");
  headers.forEach((h, idx) => Logger.log(`[${idx}] "${h}"`));

  Logger.log("\n=== FILA DE MUESTRA (fila 2, cruda) ===");
  const sampleRow = rawData[1] || [];
  headers.forEach((h, idx) => Logger.log(`"${h}" = ${sampleRow[idx]}`));
}

// =========================================================================
// ARCHIVO: 8_Debug_ConsolidadoAuditoria.gs
// DESCRIPCIÓN: Diagnóstico de SOLO LECTURA para 3_Escultor_Consolidado.gs.
//              No modifica ni escribe nada. Solo audita.
// =========================================================================

function debugAuditoriaConsolidado() {
  Logger.log("========================================================");
  Logger.log("🔍 AUDITORÍA DE 3_Escultor_Consolidado.gs (solo lectura)");
  Logger.log("========================================================");

  const rsApp = extraerDatalakeAirshipAvanzado();
  const rsWeb = extraerDatalakeAirshipWeb();
  const rsMasterApp = extraerDatalakeMasterDB();
  const rsMasterWeb = extraerDatalakeMasterWebDB();
  const rsAdobe = extraerDatalakeAdobe();

  const modulosNombrados = [
    { nombre: "AirshipApp", rs: rsApp },
    { nombre: "AirshipWeb", rs: rsWeb },
    { nombre: "MasterApp", rs: rsMasterApp },
    { nombre: "MasterWeb", rs: rsMasterWeb },
    { nombre: "Adobe", rs: rsAdobe }
  ];

  // -----------------------------------------------------------------
  // PASO 1: Tamaños de cada mapa (sanity check rápido)
  // -----------------------------------------------------------------
  Logger.log("\n--- PASO 1: Tamaño de cada datalake ---");
  modulosNombrados.forEach(m => {
    Logger.log(`${m.nombre}: mapaData.size = ${m.rs.mapaData.size} | encabezados = [${m.rs.encabezados.join(", ")}]`);
  });

  // -----------------------------------------------------------------
  // PASO 2: Detección de colisiones de nombres de columna entre fuentes
  // -----------------------------------------------------------------
  Logger.log("\n--- PASO 2: Colisiones de headers entre fuentes ---");
  const columnasExcluidas = new Set(["", "Custom Objects Raw", "Notification Name", "IED", "IED_Sanitizado"]);
  const headerAOrigenes = new Map(); // header -> [nombres de módulos que lo tienen]

  modulosNombrados.forEach(m => {
    m.rs.encabezados.forEach(h => {
      if (columnasExcluidas.has(h)) return;
      if (!headerAOrigenes.has(h)) headerAOrigenes.set(h, []);
      headerAOrigenes.get(h).push(m.nombre);
    });
  });

  let colisionesEncontradas = 0;
  for (const [header, origenes] of headerAOrigenes.entries()) {
    if (origenes.length > 1) {
      colisionesEncontradas++;
      Logger.log(`  ⚠️ "${header}" aparece en: ${origenes.join(", ")} -> en el superObjeto, "${origenes[origenes.length - 1]}" pisará a los anteriores según el orden de spread ({...master, ...app/web, ...adobe}).`);
    }
  }
  if (colisionesEncontradas === 0) {
    Logger.log("  ✅ No se encontraron colisiones de nombres de columna entre fuentes.");
  } else {
    Logger.log(`  Total de columnas en colisión: ${colisionesEncontradas}`);
  }

  // -----------------------------------------------------------------
  // PASO 3: Verificar consistencia de llaves (claveUniversal) entre
  // datalakeApp/datalakeWeb y sus respectivos masterMap/adobeMap
  // -----------------------------------------------------------------
  Logger.log("\n--- PASO 3: Cobertura de matching APP (Airship <-> MasterApp <-> Adobe) ---");
  let matchMasterApp = 0, matchAdobeApp = 0;
  for (const claveUniversal of rsApp.mapaData.keys()) {
    if (rsMasterApp.mapaData.has(claveUniversal)) matchMasterApp++;
    if (rsAdobe.mapaData.has(claveUniversal)) matchAdobeApp++;
  }
  Logger.log(`  Total IEDs en AirshipApp: ${rsApp.mapaData.size}`);
  Logger.log(`  Con match en MasterApp: ${matchMasterApp} (${((matchMasterApp / rsApp.mapaData.size) * 100).toFixed(1)}%)`);
  Logger.log(`  Con match en Adobe: ${matchAdobeApp} (${((matchAdobeApp / rsApp.mapaData.size) * 100).toFixed(1)}%)`);

  Logger.log("\n--- PASO 3b: Cobertura de matching WEB (Airship <-> MasterWeb <-> Adobe) ---");
  let matchMasterWeb = 0, matchAdobeWeb = 0;
  for (const claveUniversal of rsWeb.mapaData.keys()) {
    if (rsMasterWeb.mapaData.has(claveUniversal)) matchMasterWeb++;
    if (rsAdobe.mapaData.has(claveUniversal)) matchAdobeWeb++;
  }
  Logger.log(`  Total IEDs en AirshipWeb: ${rsWeb.mapaData.size}`);
  Logger.log(`  Con match en MasterWeb: ${matchMasterWeb} (${((matchMasterWeb / rsWeb.mapaData.size) * 100).toFixed(1)}%)`);
  Logger.log(`  Con match en Adobe: ${matchAdobeWeb} (${((matchAdobeWeb / rsWeb.mapaData.size) * 100).toFixed(1)}%)`);

  // -----------------------------------------------------------------
  // PASO 4: Muestra real de una fila combinada (APP) para inspección visual
  // -----------------------------------------------------------------
  Logger.log("\n--- PASO 4: Muestra de fila combinada real (primer IED de AirshipApp) ---");
  const primeraClave = rsApp.mapaData.keys().next().value;
  if (primeraClave) {
    const appData = rsApp.mapaData.get(primeraClave);
    const masterData = rsMasterApp.mapaData.get(primeraClave) || {};
    const adobeData = rsAdobe.mapaData.get(primeraClave) || {};
    const superObjeto = { ...masterData, ...appData, ...adobeData };
    Logger.log(`Clave: "${primeraClave}"`);
    Logger.log("superObjeto resultante: " + JSON.stringify(superObjeto));
  }

  // -----------------------------------------------------------------
  // PASO 5: Buscar valores vacíos/undefined sospechosos en columnas clave
  // -----------------------------------------------------------------
  Logger.log("\n--- PASO 5: Chequeo de columnas potencialmente vacías en la data consolidada ---");
  const superSetHeaders = new Set();
  modulosNombrados.forEach(m => {
    m.rs.encabezados.forEach(h => { if (!columnasExcluidas.has(h)) superSetHeaders.add(h); });
  });
  const masterHeaders = ["Canal", "IED", ...Array.from(superSetHeaders)];

  const construirFilaCompleta = (canal, ied, objCombinado) => {
    return masterHeaders.map(header => {
      if (header === "Canal") return canal;
      if (header === "IED") return ied;
      return objCombinado[header] !== undefined ? objCombinado[header] : "";
    });
  };

  const columnaVacios = {};
  masterHeaders.forEach(h => columnaVacios[h] = 0);
  let filasRevisadas = 0;

  for (const [claveUniversal, appData] of rsApp.mapaData.entries()) {
    const masterData = rsMasterApp.mapaData.get(claveUniversal) || {};
    const adobeData = rsAdobe.mapaData.get(claveUniversal) || {};
    const superObjeto = { ...masterData, ...appData, ...adobeData };
    const fila = construirFilaCompleta("APP", appData.__displayIed, superObjeto);
    fila.forEach((val, idx) => {
      if (val === "" || val === null || val === undefined) columnaVacios[masterHeaders[idx]]++;
    });
    filasRevisadas++;
  }

  Logger.log(`Filas APP revisadas: ${filasRevisadas}`);
  Logger.log("Columnas con celdas vacías (top 15, ordenado desc):");
  Object.entries(columnaVacios)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([h, count]) => {
      const pct = ((count / filasRevisadas) * 100).toFixed(1);
      Logger.log(`  "${h}": ${count}/${filasRevisadas} vacías (${pct}%)`);
    });

  Logger.log("\n========================================================");
  Logger.log("🔍 FIN AUDITORÍA");
  Logger.log("========================================================");
}