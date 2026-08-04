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