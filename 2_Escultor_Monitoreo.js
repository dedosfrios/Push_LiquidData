// =========================================================================
// ARCHIVO: 2_Escultor_Monitoreo.gs
// DESCRIPCIÓN: Capa 3 - Orquestador, Transformador y Persistencia Segura (BI)
// =========================================================================

/**
 * Helper O(k): Traductor en RAM y Sanitizador de Tipos. 
 * Escanea el Datalake crudo, encuentra el valor numérico (tolerando variaciones de nombre),
 * y purga comas o formatos de texto antes de castearlo a número.
 */
function _leerMetricaTolerante(objeto, variacionesAceptadas) {
  if (!objeto || Object.keys(objeto).length === 0) return 0;
  
  const llavesReales = Object.keys(objeto);
  const variacionesLimpias = variacionesAceptadas.map(v => String(v).toLowerCase().replace(/[_ ]/g, ''));
  
  for (let i = 0; i < llavesReales.length; i++) {
    const llaveLimpia = String(llavesReales[i]).toLowerCase().replace(/[_ ]/g, '');
    if (variacionesLimpias.includes(llaveLimpia)) {
      
      const rawValue = objeto[llavesReales[i]];
      if (rawValue === undefined || rawValue === null || rawValue === "") return 0;
      
      // Aplicamos Regex para limpiar comas de miles y espacios (ej. "1,234.50" -> "1234.50")
      const stringLimpio = String(rawValue).replace(/,/g, '').replace(/[^\d.-]/g, '');
      const numeroParseado = parseFloat(stringLimpio);
      
      // Si a pesar de la limpieza resulta en NaN, devolvemos 0 para no romper cálculos
      return isNaN(numeroParseado) ? 0 : numeroParseado;
    }
  }
  return 0; 
}

function ejecutarMonitoreoOperativo() {
  console.time("⏱️ Pipeline Monitoreo Operativo");
  
  // =========================================================================
  // 1. EXTRACT: Invocación de Datalakes Schema-Agnostic (RAM)
  // =========================================================================
  const rsAirshipApp = extraerDatalakeAirshipAvanzado();
  const rsAdobe = extraerDatalakeAdobe();
  const rsPushDB = extraerDatalakeMasterDB();
  
  const airshipDatalake = rsAirshipApp.mapaData;
  const adobeDatalake = rsAdobe.mapaData;
  const masterDBDatalake = rsPushDB.mapaData;
  
  const rawMaster = SpreadsheetApp.openById(ENTORNO.MASTERFILE_ID).getSheets()[0].getDataRange().getValues();
  const headersMaster = rawMaster[0].map(h => String(h).trim());
  
  const idxFecha = headersMaster.indexOf("Fecha");
  const idxTipo = headersMaster.indexOf("Tipo");
  const idxMundo = headersMaster.indexOf("Categoría F / Mundo");
  const idxTitulo = headersMaster.indexOf("Título");
  const idxIed = headersMaster.indexOf("IED") !== -1 ? headersMaster.indexOf("IED") : 0;
  
  // =========================================================================
  // 2. TRANSFORM: Definición de Estructura de Diseño (SCHEMA LOCK)
  // =========================================================================
  const matrizEstructura = [
    "Fecha", "IED", "N° Toque", "Es_FMedia", "Texto", "Título_Planificado", 
    "Mundo_Categoria", "Tipo_Planificado", "Tipo_Real_Airship", "Volumen_Real_Airship", 
    "Aperturas_Directas", "Open_Rate",
    
    // Tráfico Web Estandarizado (Adobe Analytics)
    "Visitas_Total", "Bounce_Rate", "Visits_PDP_Total", "Visits_1P", "Visits_3P",
    
    // Órdenes (Adobe Analytics)
    "Orders_Total", "Orders_1P", "Orders_3P",
    
    // Monetización (Adobe Analytics)
    "Venta_Total", "Venta_1P", "Venta_3P",
    
    // Auditoría y Semáforos
    "Estado_Ejecucion", "Validacion_Base", "Estado_Tracking"
  ];
  
  const matrizSalida = [matrizEstructura];
  let conteoMatches = 0;
  
  for (let i = 1; i < rawMaster.length; i++) {
    const row = rawMaster[i];
    const rawIed = String(row[idxIed]).trim();
    if (!rawIed || rawIed === "acc1" || rawIed.toLowerCase() === "ied") continue; 
    
    // --- NORMALIZACIÓN DE FECHA ---
    let fechaString = "N/D";
    if (idxFecha !== -1 && row[idxFecha]) {
      const dMaster = new Date(row[idxFecha]);
      if (!isNaN(dMaster.getTime())) {
        const anioM = dMaster.getFullYear();
        const mesM = String(dMaster.getMonth() + 1).padStart(2, '0');
        const diaM = String(dMaster.getDate()).padStart(2, '0');
        fechaString = `${anioM}-${mesM}-${diaM}`;
      }
    }
    
    // --- CONSTRUCCIÓN DE CLAVE UNIVERSAL PARA MATCH $O(1)$ ---
    let claveUniversal = "";
    const matchAcc = rawIed.match(/(acc\d+)/i);
    if (matchAcc) {
      claveUniversal = matchAcc[1].toLowerCase();
    } else {
      const matchWp = rawIed.match(/(wp-?\d+)/i);
      if (matchWp) claveUniversal = `wp${matchWp[1].replace(/\D/g, "")}`;
    }
    
    if (!claveUniversal) continue;
    
    const airship = airshipDatalake.get(claveUniversal) || {};
    const adobe = adobeDatalake.get(claveUniversal) || {};
    const masterDB = masterDBDatalake.get(claveUniversal) || {};
    
    const existeEnAirship = Object.keys(airship).length > 0;
    const existeEnAdobe = Object.keys(adobe).length > 0;
    if (existeEnAirship) conteoMatches++;
    
    // --- MAPEOS MÉTRICOS DINÁMICOS Y PURGADOS ---
    const volDelivery = Number(airship["Total Delivery/Impression Count"]) || 0;
    const volOpens = Number(airship["Direct Response Count"]) || 0;
    const openRate = volDelivery > 0 ? (volOpens / volDelivery) : 0;
    
    const visTotal = _leerMetricaTolerante(adobe, ["Visitas Total", "Visitas_Total", "Visitas", "Visits", "Visits Total"]);
    const visPDP = _leerMetricaTolerante(adobe, ["Visits PDP Total", "Visits_PDP_Total", "Visitas PDP", "Visits PDP"]);
    const vis1P = _leerMetricaTolerante(adobe, ["Visits 1P", "Visits_1P", "Visitas 1P"]);
    const vis3P = _leerMetricaTolerante(adobe, ["Visits 3P", "Visits_3P", "Visitas 3P"]);
    
    // AMPLIACIÓN DE DICCIONARIO: Cubrimos exportaciones en inglés y español
    const ordersTotal = _leerMetricaTolerante(adobe, ["Orders Total", "Orders_Total", "Orders", "Pedidos", "Ordenes"]);
    const orders1P = _leerMetricaTolerante(adobe, ["Orders 1P", "Orders_1P", "Pedidos 1P", "Ordenes 1P", "Order 1P"]);
    const orders3P = _leerMetricaTolerante(adobe, ["Orders 3P", "Orders_3P", "Pedidos 3P", "Ordenes 3P", "Order 3P"]);
    
    const ventaTotal = _leerMetricaTolerante(adobe, ["Venta Total", "Venta_Total", "Ventas", "Venta", "Revenue"]);
    const venta1P = _leerMetricaTolerante(adobe, ["Venta 1P", "Venta_1P", "Ventas 1P"]);
    const venta3P = _leerMetricaTolerante(adobe, ["Venta 3P", "Venta_3P", "Ventas 3P"]);
    
    const bounceRate = _leerMetricaTolerante(adobe, ["Bounce Rate", "Bounce_Rate", "Tasa de Rebote"]);
    
    // --- LÓGICA DE AUDITORÍA (SEMÁFOROS) ---
    const tipoPlanificado = idxTipo !== -1 ? String(row[idxTipo]).toUpperCase() : "N/D";
    
    let tipoRealAirship = "NO ENVIADO";
    if (existeEnAirship && volDelivery > 0) {
      tipoRealAirship = volDelivery >= ENTORNO.UMBRAL_MASIVO ? "MASIVO" : "SEGMENTADO";
    }
    
    const estadoEjecucion = existeEnAirship ? "✅ OK" : "❌ ERROR: No ejecutado en Airship";
    
    let validacionBase = "✅ OK";
    if (existeEnAirship) {
      if (tipoPlanificado.includes("GENERAL") && volDelivery < ENTORNO.UMBRAL_MASIVO) {
        validacionBase = "⚠️ ALERTA: Programado General pero volumen bajo (<1M)";
      } else if (!tipoPlanificado.includes("GENERAL") && volDelivery > 500000) {
        validacionBase = "⚠️ ALERTA: Programado Segmentado pero volumen excesivo";
      }
    } else {
      validacionBase = "N/A";
    }
    
    let estadoTracking = "✅ OK";
    if (existeEnAirship) {
      if (!existeEnAdobe || visTotal === 0) {
        estadoTracking = "🚨 ERROR: 0 Visitas con Aperturas (URL Rota / UTM erróneo)";
      }
    } else {
      estadoTracking = "N/A";
    }
    
    // =========================================================================
    // 3. MAPEO ESTRUCTURADO (Inyección en columnas oficiales)
    // =========================================================================
    const repositorio = {
      "Fecha": fechaString,
      "IED": rawIed, 
      "N° Toque": masterDB["N° Toque"] ?? "N/D",
      "Es_FMedia": masterDB["Es_FMedia"] ?? "N/D",
      "Texto": masterDB["Texto"] ?? "N/D",
      "Título_Planificado": idxTitulo !== -1 ? row[idxTitulo] : "N/D",
      "Mundo_Categoria": idxMundo !== -1 ? row[idxMundo] : "N/D",
      "Tipo_Planificado": idxTipo !== -1 ? row[idxTipo] : "N/D",
      "Tipo_Real_Airship": tipoRealAirship, 
      "Volumen_Real_Airship": volDelivery,
      "Aperturas_Directas": volOpens,
      "Open_Rate": openRate,
      
      // Tráfico Adobe
      "Visitas_Total": visTotal,
      "Bounce_Rate": bounceRate,
      "Visits_PDP_Total": visPDP,
      "Visits_1P": vis1P,
      "Visits_3P": vis3P,
      
      // Órdenes Adobe
      "Orders_Total": ordersTotal,
      "Orders_1P": orders1P,
      "Orders_3P": orders3P,
      
      // Ventas Adobe
      "Venta_Total": ventaTotal,
      "Venta_1P": venta1P,
      "Venta_3P": venta3P,
      
      "Estado_Ejecucion": estadoEjecucion,
      "Validacion_Base": validacionBase,
      "Estado_Tracking": estadoTracking
    };
    
    const filaEsculpida = matrizEstructura.map(col => repositorio[col] !== undefined ? repositorio[col] : null);
    matrizSalida.push(filaEsculpida);
  }
  
  // =========================================================================
  // 4. LOAD: Inyección Persistente Segura (Truncate & Load)
  // =========================================================================
  const ssDestino = SpreadsheetApp.openById(ENTORNO.DESTINO_BI_ID);
  let destSheet = ssDestino.getSheetByName("MONITOREO_OPERATIVO");
  
  if (!destSheet) {
    destSheet = ssDestino.insertSheet("MONITOREO_OPERATIVO");
  } else {
    destSheet.clearContents();
  }
  
  if (matrizSalida.length > 1) {
    destSheet.getRange(1, 1, matrizSalida.length, matrizSalida[0].length).setValues(matrizSalida);
  } else {
    console.warn("⚠️ No se encontraron cruces válidos para insertar. Escribiendo solo encabezados.");
    destSheet.getRange(1, 1, 1, matrizEstructura.length).setValues([matrizEstructura]);
  }
  
  console.timeEnd("⏱️ Pipeline Monitoreo Operativo");
  console.log(`💾 Persistencia segura completada. Match ejecutado en ${conteoMatches} campañas validables.`);
}