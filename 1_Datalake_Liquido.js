// =========================================================================
// ARCHIVO: 1_Datalake_Liquido.gs
// DESCRIPCIÓN: Capa 1 - Extractores Schema-Agnostic (Full Payload & Nomenclatura Estricta)
// =========================================================================

function _obtenerConfiguracionEntorno() {
  return {
    DESTINO_BI_ID: "1nYZ9C0gLXxQuzQ8HALCcCVPJa8FeqErog-zDq98QRyc",   
    AIRSHIP_APP_ID: "1L0V5JALZimz0_-EZE0buFDCgs6HD8bzovYs4vkuGyY4",  
    AIRSHIP_WEB_ID: "1M9H0krWxLJ2Yyo3obYzyRiomxqGRdylKQMNleDJUSCQ",  
    MASTER_APP_ID: "1rkXKqPXCKkA9fWXzvQ3464Yhay0vaSf1EclglPdWUcM",   
    MASTER_WEB_ID: "1XcHUXnsaIwxoNBICLGUYkIwK0_yr_Mj8XqlSDrl5mQc",   
    ADOBE_DB_ID: "1Lhr8ibHKeWq0O9G1Jy9iYwQLgMKSgIEuh94mgJp4LUY"      
  };
}

/** Helper O(1) para convertir la matriz plana en JSON dinámico */
function _empaquetarFila(headers, row) {
  return headers.reduce((obj, header, index) => {
    if (header) obj[header] = row[index];
    return obj;
  }, {});
}

function extraerDatalakeAirshipAvanzado() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.AIRSHIP_APP_ID).getSheets()[0].getDataRange().getValues();
  if (!rawData || rawData.length === 0) return { encabezados: [], mapaData: new Map() };

  const headers = rawData[0].map(h => String(h).trim());
  let idxName = headers.indexOf("Custom Objects Raw");
  if (idxName === -1) idxName = headers.indexOf(""); 
  if (idxName === -1) idxName = 8; 

  const mapaData = new Map();
  const regexIedApp = /(acc\d+)/i;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const rawUrl = String(row[idxName]).trim();
    if (!rawUrl) continue;

    const match = rawUrl.match(regexIedApp);
    if (!match) continue;

    // Normalización estricta: forzamos minúsculas para evitar variaciones humanas (ej. ACC vs acc)
    const displayIed = match[1].toLowerCase(); 
    const claveUniversal = displayIed;
    
    const payload = _empaquetarFila(headers, row);
    payload["__displayIed"] = displayIed; // Inyección para la presentación en Looker Studio

    mapaData.set(claveUniversal, payload);
  }
  return { encabezados: headers, mapaData };
}

function extraerDatalakeAirshipWeb() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.AIRSHIP_WEB_ID).getSheets()[0].getDataRange().getValues();
  if (!rawData || rawData.length === 0) return { encabezados: [], mapaData: new Map() };

  const headers = rawData[0].map(h => String(h).trim());
  let idxName = headers.indexOf("Notification Name");
  if (idxName === -1) idxName = 14; 

  const mapaData = new Map();
  const regexIEDWeb = /(wp-?\d+)/i; 

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const rawVal = String(row[idxName]).trim();
    if (!rawVal) continue;

    const match = rawVal.match(regexIEDWeb);
    if (!match) continue; 

    const numPuro = match[1].replace(/\D/g, "");
    
    // Aquí estaba la discrepancia. Homologamos clave universal y de visualización a "wpXXXXX"
    const claveUniversal = `wp${numPuro}`;
    const displayIed = `wp${numPuro}`;

    const payload = _empaquetarFila(headers, row);
    payload["__displayIed"] = displayIed; 

    mapaData.set(claveUniversal, payload);
  }
  return { encabezados: headers, mapaData };
}

function extraerDatalakeMasterDB() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.MASTER_APP_ID).getSheets()[0].getDataRange().getValues();
  if (!rawData || rawData.length === 0) return { encabezados: [], mapaData: new Map() };

  const headers = rawData[0].map(h => String(h).trim());
  let idxIed = headers.indexOf("IED");
  if (idxIed === -1) idxIed = headers.indexOf("IED_Sanitizado");
  if (idxIed === -1) idxIed = 0;

  const mapaData = new Map();
  const regexIedApp = /(acc\d+)/i;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const cellValue = String(row[idxIed]).trim();
    if (!cellValue) continue;

    const match = cellValue.match(regexIedApp);
    if (!match) continue;

    mapaData.set(match[1].toLowerCase(), _empaquetarFila(headers, row));
  }
  return { encabezados: headers, mapaData };
}

function extraerDatalakeMasterWebDB() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.MASTER_WEB_ID).getSheets()[0].getDataRange().getValues();
  if (!rawData || rawData.length === 0) return { encabezados: [], mapaData: new Map() };

  const headers = rawData[0].map(h => String(h).trim());
  let idxIed = headers.indexOf("IED");
  if (idxIed === -1) idxIed = headers.indexOf("IED_Sanitizado");
  if (idxIed === -1) idxIed = 0;

  const mapaData = new Map();
  const regexIEDWeb = /(wp-?\d+)/i; 

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const cellValue = String(row[idxIed]).trim();
    if (!cellValue) continue;

    const match = cellValue.match(regexIEDWeb);
    if (!match) continue;

    const numPuro = match[1].replace(/\D/g, "");
    mapaData.set(`wp${numPuro}`, _empaquetarFila(headers, row));
  }
  return { encabezados: headers, mapaData };
}

function extraerDatalakeAdobe() {
  const config = _obtenerConfiguracionEntorno();
  const rawData = SpreadsheetApp.openById(config.ADOBE_DB_ID).getSheets()[0].getDataRange().getValues();
  if (!rawData || rawData.length === 0) return { encabezados: [], mapaData: new Map() };

  const headers = rawData[0].map(h => String(h).trim());
  let idxIed = headers.indexOf("IED");
  if (idxIed === -1) idxIed = 0;

  const mapaData = new Map();
  const regexUniv = /(acc\d+|wp-?\d+)/i;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row[idxIed]) continue;

    const cellValue = String(row[idxIed]).trim();
    const match = cellValue.match(regexUniv);
    if (!match) continue;

    let rawExtraido = match[1].toLowerCase();
    let claveUniversal = "";
    
    if (rawExtraido.startsWith("acc")) claveUniversal = rawExtraido;
    else if (rawExtraido.startsWith("wp")) claveUniversal = `wp${rawExtraido.replace(/\D/g, "")}`;

    if (!claveUniversal) continue;

    mapaData.set(claveUniversal, _empaquetarFila(headers, row));
  }
  return { encabezados: headers, mapaData };
}