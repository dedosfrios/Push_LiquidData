// Constantes globales de producción
const ENTORNO = {
  MASTERFILE_ID: "1rkXKqPXCKkA9fWXzvQ3464Yhay0vaSf1EclglPdWUcM",
  AIRSHIP_ID:    "1L0V5JALZimz0_-EZE0buFDCgs6HD8bzovYs4vkuGyY4",
  ADOBE_ID:      "1Lhr8ibHKeWq0O9G1Jy9iYwQLgMKSgIEuh94mgJp4LUY",
  
  // EL NUEVO CONTENEDOR EXCLUSIVO PARA BI (Reemplaza con el ID de tu nuevo archivo)
  DESTINO_BI_ID: "1nYZ9C0gLXxQuzQ8HALCcCVPJa8FeqErog-zDq98QRyc",
  UMBRAL_MASIVO: 1000000 // 1M de impactos
};

// =========================================================================
// ARCHIVO: 1_Datalake_Liquido.gs
// DESCRIPCIÓN: Capa 2 - Extracción, Normalización y Sanitización de Orígenes
// =========================================================================

/**
 * COMPONENTE DATALAKE: AIRSHIP ESTÁNDAR
 * Extrae el IED, normaliza la fecha local y consolida duplicados eligiendo el mayor volumen (mata tests).
 * @return {Map} Llave: IED_Fecha, Valor: {delivery, opens, existe}
 */
function extraerDatalakeAirship() {
  const rawData = SpreadsheetApp.openById(ENTORNO.AIRSHIP_ID).getSheets()[0].getDataRange().getValues();
  const headers = rawData[0].map(h => String(h).trim());
  
  const idxDate = headers.indexOf("Delivery Date");
  const idxCustomRaw = headers.indexOf("Custom Objects Raw");
  const idxDelivery = headers.indexOf("Total Delivery/Impression Count");
  const idxDirectResp = headers.indexOf("Direct Response Count"); 
  
  const mapDatalake = new Map();
  const iedRegex = /eid(?:\\u003d|=)([a-zA-Z0-9]+)/i; 
  
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const textoCustom = String(row[idxCustomRaw]);
    
    const match = textoCustom.match(iedRegex);
    if (!match) continue; 
    
    const iedExtraido = match[1].trim();
    
    const d = new Date(row[idxDate]);
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    const fechaString = `${anio}-${mes}-${dia}`;
    
    const llaveCompuesta = `${iedExtraido}_${fechaString}`;
    
    const nuevoVolumen = Number(row[idxDelivery]) || 0;
    const nuevasAperturas = Number(row[idxDirectResp]) || 0;
    
    if (mapDatalake.has(llaveCompuesta)) {
      const registroExistente = mapDatalake.get(llaveCompuesta);
      if (nuevoVolumen > registroExistente.delivery) {
        mapDatalake.set(llaveCompuesta, {
          delivery: nuevoVolumen,
          opens: nuevasAperturas,
          existe: true
        });
      }
    } else {
      mapDatalake.set(llaveCompuesta, {
        delivery: nuevoVolumen,
        opens: nuevasAperturas,
        existe: true
      });
    }
  }
  return mapDatalake;
}

/**
 * COMPONENTE DATALAKE: AIRSHIP AVANZADO (Nueva Adición)
 * Extrae el universo completo de columnas analíticas de Airship, resolviendo fechas fidedignas
 * y normalizando el IED extraído de la URL compleja de reenvío.
 * @return {Map} Llave: IED_Sanitizado (solo dígitos), Valor: Objeto con toda la metadata del log.
 */
function extraerDatalakeAirshipAvanzado() {
  const rawData = SpreadsheetApp.openById(ENTORNO.AIRSHIP_ID).getSheets()[0].getDataRange().getValues();
  const headers = rawData[0].map(h => String(h).trim());
  
  // Identificación dinámica de columnas
  const idxDate = headers.indexOf("Delivery Date");
  const idxWorkflow = headers.indexOf("Workflow Type");
  const idxMsgType = headers.indexOf("Message Type");
  const idxMessage = headers.indexOf("Message");
  const idxList = headers.indexOf("Static List");
  const idxCategory = headers.indexOf("Campaign Category");
  const idxSegment = headers.indexOf("Segment");
  const idxCustomRaw = headers.indexOf("Custom Objects Raw");
  const idxDelivery = headers.indexOf("Total Delivery/Impression Count");
  const idxDirectResp = headers.indexOf("Direct Response Count");
  const idxDirectRate = headers.indexOf("Direct Response Rate");
  const idxIndirectResp = headers.indexOf("Indirect Response Count");
  const idxIndirectRate = headers.indexOf("Indirect Response Rate");
  const idxOptOut = headers.indexOf("Opt Out User Count");
  const idxOptOutRate = headers.indexOf("Opt Out Rate");
  const idxUninstall = headers.indexOf("Uninstall User Count");
  const idxUninstallRate = headers.indexOf("Uninstall Rate");
  
  const mapDatalake = new Map();
  const iedRegex = /eid(?:\\u003d|=)([a-zA-Z0-9]+)/i; 
  
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const textoCustom = String(row[idxCustomRaw]);
    
    const match = textoCustom.match(iedRegex);
    if (!match) continue; 
    
    // Forzar ID numérico puro para el puente entre bases
    const iedSanitizado = match[1].trim().replace(/\D/g, "");
    
    const d = new Date(row[idxDate]);
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    const fechaRealString = `${anio}-${mes}-${dia}`;
    
    const nuevoVolumen = Number(row[idxDelivery]) || 0;
    
    const registroDatalake = {
      fechaReal: fechaRealString,
      workflowType: idxWorkflow !== -1 ? row[idxWorkflow] : "N/D",
      messageType: idxMsgType !== -1 ? row[idxMsgType] : "N/D",
      message: idxMessage !== -1 ? row[idxMessage] : "N/D",
      staticList: idxList !== -1 ? row[idxList] : "N/D",
      campaignCategory: idxCategory !== -1 ? row[idxCategory] : "N/D",
      segment: idxSegment !== -1 ? row[idxSegment] : "N/D",
      delivery: nuevoVolumen,
      directResponse: idxDirectResp !== -1 ? (Number(row[idxDirectResp]) || 0) : 0,
      directRate: idxDirectRate !== -1 ? (Number(row[idxDirectRate]) || 0) : 0,
      indirectResponse: idxIndirectResp !== -1 ? (Number(row[idxIndirectResp]) || 0) : 0,
      indirectRate: idxIndirectRate !== -1 ? (Number(row[idxIndirectRate]) || 0) : 0,
      optOut: idxOptOut !== -1 ? (Number(row[idxOptOut]) || 0) : 0,
      optOutRate: idxOptOutRate !== -1 ? (Number(row[idxOptOutRate]) || 0) : 0,
      uninstall: idxUninstall !== -1 ? (Number(row[idxUninstall]) || 0) : 0,
      uninstallRate: idxUninstallRate !== -1 ? (Number(row[idxUninstallRate]) || 0) : 0,
      existe: true
    };

    if (mapDatalake.has(iedSanitizado)) {
      const registroExistente = mapDatalake.get(iedSanitizado);
      if (nuevoVolumen > registroExistente.delivery) {
        mapDatalake.set(iedSanitizado, registroDatalake);
      }
    } else {
      mapDatalake.set(iedSanitizado, registroDatalake);
    }
  }
  return mapDatalake;
}

/**
 * COMPONENTE DATALAKE: ADOBE ANALYTICS
 * Extrae y estandariza las métricas de performance clasificando de forma estricta canales vs PDPs.
 * @return {Map} Llave: IED sanitizado, Valor: Objeto con métricas normalizadas.
 */
function extraerDatalakeAdobe() {
  const sheet = SpreadsheetApp.openById(ENTORNO.ADOBE_ID).getSheets()[0];
  const rawData = sheet.getDataRange().getValues();
  
  if (rawData.length <= 1) return new Map();

  const headers = rawData[0].map(h => String(h).replace(/[\s\u00A0]+/g, ' ').trim());
  
  const idxKey = 0; 
  const idxBounce = headers.indexOf("Bounce Rate");
  const idxVisitsPDP = headers.indexOf("Visits PDP");

  let idxVisitsTotal = -1, idxVisits1P = -1, idxVisits3P = -1;
  let idxVisitsPDP1P = -1,  idxVisitsPDP3P = -1;
  let idxOrdersTotal = -1, idxOrders1P = -1, idxOrders3P = -1;
  let idxVentaTotal = -1,  idxVenta1P = -1,  idxVenta3P = -1;

  headers.forEach((header, index) => {
    const esVenta = /venta|vta|revenue|sales/i.test(header);
    const esVisitas = /visits|visitas/i.test(header);
    const esOrdenes = /ordenes|orders|pedidos/i.test(header);

    if (esVenta) {
      if (/1p|1/i.test(header)) idxVenta1P = index;
      else if (/3p|3/i.test(header)) idxVenta3P = index;
      else if (/^venta$/i.test(header) || /total/i.test(header)) idxVentaTotal = index;
    } else if (esVisitas) {
      if (/pdp/i.test(header)) {
        if (/1p|1/i.test(header)) idxVisitsPDP1P = index;
        else if (/3p|3/i.test(header)) idxVisitsPDP3P = index;
      } else {
        if (/1p|1/i.test(header)) idxVisits1P = index;
        else if (/3p|3/i.test(header)) idxVisits3P = index;
        else if (/^visits$/i.test(header) || /total/i.test(header)) idxVisitsTotal = index;
      }
    } else if (esOrdenes) {
      if (/1p|1/i.test(header)) idxOrders1P = index;
      else if (/3p|3/i.test(header)) idxOrders3P = index;
      else if (/^ordenes$/i.test(header) || /^orders$/i.test(header) || /total/i.test(header)) idxOrdersTotal = index;
    }
  });

  if (idxVentaTotal === -1) idxVentaTotal = 9;

  const mapDatalake = new Map();

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    
    const iedRaw = String(row[idxKey]).trim();
    if (!iedRaw) continue;
    const iedSanitizado = iedRaw.replace(/\D/g, "");
    
    mapDatalake.set(iedSanitizado, {
      visits_Total:  idxVisitsTotal !== -1 ? (Number(row[idxVisitsTotal]) || 0) : 0,
      visits_1P:     idxVisits1P !== -1 ? (Number(row[idxVisits1P]) || 0) : 0,
      visits_3P:     idxVisits3P !== -1 ? (Number(row[idxVisits3P]) || 0) : 0,
      
      visits_PDP_Total: idxVisitsPDP !== -1 ? (Number(row[idxVisitsPDP]) || 0) : 0,
      visits_PDP_1P:    idxVisitsPDP1P !== -1 ? (Number(row[idxVisitsPDP1P]) || 0) : 0,
      visits_PDP_3P:    idxVisitsPDP3P !== -1 ? (Number(row[idxVisitsPDP3P]) || 0) : 0,
      
      orders_Total:  idxOrdersTotal !== -1 ? (Number(row[idxOrdersTotal]) || 0) : 0,
      orders_1P:     idxOrders1P !== -1 ? (Number(row[idxOrders1P]) || 0) : 0,
      orders_3P:     idxOrders3P !== -1 ? (Number(row[idxOrders3P]) || 0) : 0,
      
      venta_Total:   idxVentaTotal !== -1 ? (Number(row[idxVentaTotal]) || 0) : 0,
      venta_1P:      idxVenta1P !== -1 ? (Number(row[idxVenta1P]) || 0) : 0,
      venta_3P:      idxVenta3P !== -1 ? (Number(row[idxVenta3P]) || 0) : 0,
      
      bounceRate:    idxBounce !== -1 ? (Number(row[idxBounce]) || 0) : 0,
      existe:        true
    });
  }
  return mapDatalake;
}

/**
 * COMPONENTE DATALAKE: MASTER DB (Historial Diario del Masterfile)
 * Obtiene los metadatos de copy e historial operativo de planificación sin indexar la fecha.
 * @return {Map} Llave: IED, Valor: Objeto con toda la metadata de planificación del ID.
 */
function extraerDatalakeMasterDB() {
  const rawData = SpreadsheetApp.openById(ENTORNO.MASTERFILE_ID).getSheets()[0].getDataRange().getValues();
  const headers = rawData[0].map(h => String(h).trim());
  
  const idxIED = headers.findIndex(h => /ied|id/i.test(h) || h === "IED");
  const idxTipo = headers.findIndex(h => /tipo/i.test(h));
  const idxToque = headers.findIndex(h => /n.*toque|toque/i.test(h));
  const idxMundo = headers.findIndex(h => /categoría f \/ mundo|mundo/i.test(h));
  const idxAudiencia = headers.findIndex(h => /audiencia/i.test(h));
  const idxFMedia = headers.findIndex(h => /es.*fmedia|fmedia/i.test(h));
  const idxTitulo = headers.findIndex(h => /título|titulo/i.test(h));
  const idxTexto = headers.findIndex(h => /texto|copy|body/i.test(h));
  
  const mapDatalake = new Map();
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const iedRaw = String(row[idxIED]).trim();
    if (!iedRaw || iedRaw.toLowerCase() === "ied") continue;
    
    // Sanitizamos el IED de planificación para asegurar consistencia numérico-vocal
    const iedSanitizado = iedRaw.replace(/\D/g, "");
    
    mapDatalake.set(iedSanitizado, {
      tipo: idxTipo !== -1 ? row[idxTipo] : "N/D",
      nToque: idxToque !== -1 ? row[idxToque] : "N/D",
      categoria: idxMundo !== -1 ? row[idxMundo] : "N/D",
      audiencia: idxAudiencia !== -1 ? row[idxAudiencia] : "N/D",
      esFMedia: idxFMedia !== -1 ? row[idxFMedia] : "N/D",
      titulo: idxTitulo !== -1 ? row[idxTitulo] : "N/D",
      texto: idxTexto !== -1 ? row[idxTexto] : "N/D"
    });
  }
  return mapDatalake;
}

// =========================================================================
// ARCHIVO: 2_Escultor_Monitoreo.gs
// DESCRIPCIÓN: Capa 3 - Orquestador, Transformador y Persistencia (BI)
// =========================================================================

/**
 * FUNCIÓN EJECUTABLE DE PRODUCCIÓN: Actualiza el reporte operativo diario.
 * Coordina la extracción en RAM, resuelve el conflicto de llaves, unifica nombres
 * de columnas y corrige la lectura de visitas a PDP desde el datalake de Adobe.
 */
function ejecutarMonitoreoOperativo() {
  console.time("⏱️ Pipeline Monitoreo Operativo");
  
  // 1. EXTRACT: Invocación de los Datalakes líquidos en memoria RAM
  const airshipDatalake = extraerDatalakeAirship();
  const adobeDatalake = extraerDatalakeAdobe();
  const masterDBDatalake = extraerDatalakeMasterDB();
  
  // Lectura del universo completo del Masterfile base de planificación
  const rawMaster = SpreadsheetApp.openById(ENTORNO.MASTERFILE_ID).getSheets()[0].getDataRange().getValues();
  const headersMaster = rawMaster[0].map(h => String(h).trim());
  
  const idxFecha = headersMaster.indexOf("Fecha");
  const idxTipo = headersMaster.indexOf("Tipo");
  const idxMundo = headersMaster.indexOf("Categoría F / Mundo");
  const idxTitulo = headersMaster.indexOf("Título");
  
  // 2. TRANSFORM: Definición del Molde de Diseño Ampliado y Estandarizado para Looker Studio
  const moldeVisual = [
    "Fecha", 
    "IED", 
    "N° Toque",            
    "Es_FMedia",          
    "Texto",              
    "Título_Planificado", 
    "Mundo_Categoria", 
    "Tipo_Planificado",
    "Tipo_Real_Airship",    
    "Volumen_Real_Airship", 
    "Aperturas_Directas", 
    "Open_Rate",
    
    // Tráfico Web Estandarizado (Adobe Analytics)
    "Visitas_Total", 
    "Bounce_Rate",        
    "Visits_PDP_Total",   // CORREGIDO: Renombrado según acuerdo de arquitectura analítica
    "Visits_1P",          
    "Visits_3P",          
    
    // Órdenes (Adobe Analytics)
    "Orders_Total",            
    "Orders_1P",         
    "Orders_3P",         
    
    // Monetización (Adobe Analytics)
    "Venta_Total",        
    "Venta_1P",           
    "Venta_3P",           
    
    // Auditoría y Semáforos
    "Estado_Ejecucion", 
    "Validacion_Base", 
    "Estado_Tracking"
  ];
  
  const matrizSalida = [moldeVisual];
  let conteoMatches = 0;
  
  // Iteración sobre todo el universo de planificación (Masterfile)
  for (let i = 1; i < rawMaster.length; i++) {
    const row = rawMaster[i];
    const ied = String(row[0]).trim();
    if (!ied || ied === "acc1" || ied.toLowerCase() === "ied") continue; 
    
    // --- NORMALIZACIÓN DE FECHA (MASTERFILE) ---
    const dMaster = new Date(row[idxFecha]);
    const anioM = dMaster.getFullYear();
    const mesM = String(dMaster.getMonth() + 1).padStart(2, '0');
    const diaM = String(dMaster.getDate()).padStart(2, '0');
    const fechaString = `${anioM}-${mesM}-${diaM}`;
    
    const llaveBuscarAirship = `${ied}_${fechaString}`;
    
    // --- SANITIZACIÓN DE LLAVE PARA MATCH EN RAM ---
    const iedSanitizado = ied.replace(/\D/g, "");
    
    // Cruces en RAM a velocidad O(1)
    const airship = airshipDatalake.get(llaveBuscarAirship) || { delivery: 0, opens: 0, existe: false };
    
    // CORRECCIÓN: Inicialización explícita de visitas PDP bajo la nueva propiedad del Datalake
    const adobe = adobeDatalake.get(iedSanitizado) || { 
      visits_Total: 0, visits_1P: 0, visits_3P: 0, visits_PDP_Total: 0, visitsPDP: 0, bounceRate: 0,
      orders_Total: 0, orders_1P: 0, orders_3P: 0, 
      venta_Total: 0,  venta_1P: 0,  venta_3P: 0, 
      existe: false 
    };
    
    const pushDB = masterDBDatalake.get(iedSanitizado) || { nToque: "N/D", esFMedia: "N/D", texto: "N/D" };
    
    if (airship.existe) {
      conteoMatches++;
    }
    
    // Métricas Derivadas
    const openRate = airship.delivery > 0 ? (airship.opens / airship.delivery) : 0;
    
    // Clasificación de Audiencia Real
    let tipoRealAirship = "NO ENVIADO";
    if (airship.existe && airship.delivery > 0) {
      tipoRealAirship = airship.delivery >= ENTORNO.UMBRAL_MASIVO ? "MASIVO" : "SEGMENTADO";
    }
    
    // --- LÓGICA DE AUDITORÍA (SEMÁFOROS) ---
    const estadoEjecucion = airship.existe ? "✅ OK" : "❌ ERROR: No ejecutado en Airship";
    const tipoPlanificado = String(row[idxTipo]).toUpperCase();
    
    let validacionBase = "✅ OK";
    if (airship.existe) {
      if (tipoPlanificado.includes("GENERAL") && airship.delivery < ENTORNO.UMBRAL_MASIVO) {
        validacionBase = "⚠️ ALERTA: Programado General pero volumen bajo (<1M)";
      } else if (!tipoPlanificado.includes("GENERAL") && airship.delivery > 500000) {
        validacionBase = "⚠️ ALERTA: Programado Segmentado pero volumen excesivo";
      }
    } else {
      validacionBase = "N/A";
    }
    
    let estadoTracking = "✅ OK";
    if (airship.existe) {
      if (!adobe.existe || adobe.visits_Total === 0) {
        estadoTracking = "🚨 ERROR: 0 Visitas con Aperturas (URL Rota / UTM erróneo)";
      }
    } else {
      estadoTracking = "N/A";
    }
    
    // CORRECCIÓN DE ASIGNACIÓN: Doble asignación preventiva para mitigar desajustes entre propiedades
    const valorVisitsPDP = adobe.visits_PDP_Total !== undefined ? adobe.visits_PDP_Total : (adobe.visitsPDP || 0);
    
    // 3. MAPEO ESTRUCTURADO: Repositorio alineado al molde y a la data recuperada en RAM
    const repositorio = {
      "Fecha": fechaString,
      "IED": ied,
      "N° Toque": pushDB.nToque,
      "Es_FMedia": pushDB.esFMedia,
      "Texto": pushDB.texto,
      "Título_Planificado": row[idxTitulo],
      "Mundo_Categoria": row[idxMundo],
      "Tipo_Planificado": row[idxTipo],
      "Tipo_Real_Airship": tipoRealAirship, 
      "Volumen_Real_Airship": airship.delivery,
      "Aperturas_Directas": airship.opens,
      "Open_Rate": openRate,
      
      // Tráfico Adobe
      "Visitas_Total": adobe.visits_Total,
      "Bounce_Rate": adobe.bounceRate,
      "Visits_PDP_Total": valorVisitsPDP, // Mapeo seguro a la nueva columna corregida
      "Visits_1P": adobe.visits_1P,
      "Visits_3P": adobe.visits_3P,
      
      // Órdenes Adobe
      "Orders_Total": adobe.orders_Total,
      "Orders_1P": adobe.orders_1P,
      "Orders_3P": adobe.orders_3P,
      
      // Ventas Adobe
      "Venta_Total": adobe.venta_Total,
      "Venta_1P": adobe.venta_1P,
      "Venta_3P": adobe.venta_3P,
      
      "Estado_Ejecucion": estadoEjecucion,
      "Validacion_Base": validacionBase,
      "Estado_Tracking": estadoTracking
    };
    
    // Construcción de la fila final para la inyección respetando la estructura del molde
    const filaEsculpida = moldeVisual.map(col => repositorio[col] !== undefined ? repositorio[col] : null);
    matrizSalida.push(filaEsculpida);
  }
  
  // =========================================================================
  // 4. LOAD: Inyección Persistente en Bloque (BI)
  // =========================================================================
  const ssDestino = SpreadsheetApp.openById(ENTORNO.DESTINO_BI_ID);
  let destSheet = ssDestino.getSheetByName("MONITOREO_OPERATIVO");
  
  if (!destSheet) {
    destSheet = ssDestino.insertSheet("MONITOREO_OPERATIVO");
  }
  
  // Escritura atómica limpia de una sola llamada a la API de Google Sheets
  destSheet.clearContents();
  destSheet.getRange(1, 1, matrizSalida.length, matrizSalida[0].length).setValues(matrizSalida);
  destSheet.autoResizeColumns(1, moldeVisual.length);
  
  console.timeEnd("⏱️ Pipeline Monitoreo Operativo");
  console.log(`💾 Persistencia completada con éxito. Columna 'Visits_PDP_Total' normalizada con flujo numérico.`);
}

// =========================================================================
// ARCHIVO: 3_Escultor_Consolidado.gs
// DESCRIPCIÓN: Capa 3 - Orquestador y Escultor de la Vista de Negocio Consolidada
// =========================================================================

/**
 * FUNCIÓN EJECUTABLE DE PRODUCCIÓN: Genera el reporte consolidado de negocio.
 * Consolida Airship (App), Masterfile y Adobe, e introduce la segmentación 
 * por tipo de dispositivo para la futura integración del flujo Push Web.
 */
function ejecutarReporteConsolidado() {
  console.time("⏱️ Pipeline Reporte Consolidado");
  
  // 1. EXTRACT: Invocación paralela en RAM de los tres Datalakes Líquidos
  const airshipDatalake = extraerDatalakeAirshipAvanzado();
  const adobeDatalake = extraerDatalakeAdobe();
  const masterDBDatalake = extraerDatalakeMasterDB();
  
  // 2. TRANSFORM: Definición del Molde de Diseño Estandarizado para Looker Studio
  const moldeVisual = [
    // Tiempo e Identificación
    "Fecha_Publicacion_Real",
    "IED",
    "dispositivo_envio",          // NUEVA DIMENSIÓN: Preparada para segmentación App vs Web
    
    // Metadata de Planificación
    "Tipo_Planificado",
    "N° Toque",
    "Mundo_Categoria",
    "Audiencia",
    "Es_FMedia",
    "Título_Planificado",
    "Texto_Copy",
    
    // Métricas Analíticas de Airship (Flujo nativo de App actual)
    "Workflow_Type",
    "Message_Type",
    "Message_Copy_Real",
    "Static_List",
    "Campaign_Category",
    "Segment_Airship",
    "Volumen_Real_Airship",
    "Aperturas_Directas",
    "Open_Rate_Directo",
    "Aperturas_Indirectas",
    "Open_Rate_Indirecto",
    "Opt_Out_Users",
    "Opt_Out_Rate",
    "Uninstalls",
    "Uninstall_Rate",
    
    // Tráfico Web (Adobe Analytics)
    "Visitas_Total",
    "Visits_1P",
    "Visits_3P",
    "Visits_PDP_Total",
    "Visits_PDP_1P",
    "Visits_PDP_3P",
    "Bounce_Rate",
    
    // Conversión y Finanzas (Adobe Analytics)
    "Orders_Total",
    "Orders_1P",
    "Orders_3P",
    "Venta_Total",
    "Venta_1P",
    "Venta_3P",
    
    // KPIs Derivados Normalizados en RAM
    "Click_To_Session_Rate",      
    "CTR_Total",                  
    "CTR_PDP_Total",              
    "Conversion_Rate_Total",      
    "Conversion_Rate_PDP_Total",  
    "Ticket_Medio_Total",         
    "Venta_Por_Impacto"           
  ];
  
  const matrizSalida = [moldeVisual];
  
  // 3. PROCESAMIENTO: Left-Join en RAM tomando Airship como Driver de Publicación
  for (let [ied, airship] of airshipDatalake.entries()) {
    
    // Consultas instantáneas O(1) a los mapas indexados en memoria
    const master = masterDBDatalake.get(ied) || { 
      tipo: "N/D", nToque: "N/D", categoria: "N/D", audiencia: "N/D", 
      esFMedia: "N/D", titulo: "N/D", texto: "N/D" 
    };
    
    const adobe = adobeDatalake.get(ied) || { 
      visits_Total: 0, visits_1P: 0, visits_3P: 0, 
      visits_PDP_Total: 0, visits_PDP_1P: 0, visits_PDP_3P: 0, bounceRate: 0,
      orders_Total: 0, orders_1P: 0, orders_3P: 0, 
      venta_Total: 0, venta_1P: 0, venta_3P: 0
    };
    
    // --- CÁLCULO DE KPIs DERIVADOS EN CALIENTE (RAM) ---
    const openRateDirect = airship.delivery > 0 ? (airship.directResponse / airship.delivery) : 0;
    const openRateIndirect = airship.delivery > 0 ? (airship.indirectResponse / airship.delivery) : 0;
    
    const clickToSession = airship.directResponse > 0 ? (adobe.visits_Total / airship.directResponse) : 0;
    const ctrTotal = airship.delivery > 0 ? (adobe.visits_Total / airship.delivery) : 0;
    const ctrPDPTotal = airship.delivery > 0 ? (adobe.visits_PDP_Total / airship.delivery) : 0;
    
    const conversionRateTotal = adobe.visits_Total > 0 ? (adobe.orders_Total / adobe.visits_Total) : 0;
    const conversionRatePDPTotal = adobe.visits_PDP_Total > 0 ? (adobe.orders_Total / adobe.visits_PDP_Total) : 0;
    
    const ticketMedio = adobe.orders_Total > 0 ? (adobe.venta_Total / adobe.orders_Total) : 0;
    const ventaPorImpacto = airship.delivery > 0 ? (adobe.venta_Total / airship.delivery) : 0;
    
    // Reconstrucción del prefijo visual del IED corporativo
    const iedConPrefijo = `acc${ied}`;
    
    // --- LÓGICA DE NEGOCIO MULTI-DISPOSITIVO ---
    // Como este lazo procesa actualmente el Datalake extraído de Airship-daily.db (App),
    // se clasifica por defecto como "App". Al integrar la fuente web, usaremos esta propiedad
    // para bifurcar el origen del dato.
    const dispositivoEnvio = "App";
    
    // Construcción estructurada de la entidad de datos líquida
    const repositorio = {
      "Fecha_Publicacion_Real": airship.fechaReal,
      "IED": iedConPrefijo, 
      "dispositivo_envio": dispositivoEnvio, // Inyección de la nueva dimensión de arquitectura
      
      // Mapeo Masterfile
      "Tipo_Planificado": master.tipo,
      "N° Toque": master.nToque,
      "Mundo_Categoria": master.categoria,
      "Audiencia": master.audiencia,
      "Es_FMedia": master.esFMedia,
      "Título_Planificado": master.titulo,
      "Texto_Copy": master.texto,
      
      // Mapeo Airship
      "Workflow_Type": airship.workflowType,
      "Message_Type": airship.messageType,
      "Message_Copy_Real": airship.message,
      "Static_List": airship.staticList,
      "Campaign_Category": airship.campaignCategory,
      "Segment_Airship": airship.segment,
      "Volumen_Real_Airship": airship.delivery,
      "Aperturas_Directas": airship.directResponse,
      "Open_Rate_Directo": openRateDirect,
      "Aperturas_Indirectas": airship.indirectResponse,
      "Open_Rate_Indirecto": openRateIndirect,
      "Opt_Out_Users": airship.optOut,
      "Opt_Out_Rate": airship.optOutRate,
      "Uninstalls": airship.uninstall,
      "Uninstall_Rate": airship.uninstallRate,
      
      // Mapeo Adobe
      "Visitas_Total": adobe.visits_Total,
      "Visits_1P": adobe.visits_1P,
      "Visits_3P": adobe.visits_3P,
      "Visits_PDP_Total": adobe.visits_PDP_Total,
      "Visits_PDP_1P": adobe.visits_PDP_1P,
      "Visits_PDP_3P": adobe.visits_PDP_3P,
      "Bounce_Rate": adobe.bounceRate,
      "Orders_Total": adobe.orders_Total,
      "Orders_1P": adobe.orders_1P,
      "Orders_3P": adobe.orders_3P,
      "Venta_Total": adobe.venta_Total,
      "Venta_1P": adobe.venta_1P,
      "Venta_3P": adobe.venta_3P,
      
      // Inyección de los KPIs analíticos
      "Click_To_Session_Rate": clickToSession,
      "CTR_Total": ctrTotal,
      "CTR_PDP_Total": ctrPDPTotal,
      "Conversion_Rate_Total": conversionRateTotal,
      "Conversion_Rate_PDP_Total": conversionRatePDPTotal,
      "Ticket_Medio_Total": ticketMedio,
      "Venta_Por_Impacto": ventaPorImpacto
    };
    
    // Esculpido síncrono basándose estrictamente en el orden indexado del molde visual
    const filaEsculpida = moldeVisual.map(col => repositorio[col] !== undefined ? repositorio[col] : null);
    matrizSalida.push(filaEsculpida);
  }
  
  // =========================================================================
  // 4. LOAD: Inyección Persistente en Hoja de Destino ("CONSOLIDADO_MASTER")
  // =========================================================================
  const ssDestino = SpreadsheetApp.openById(ENTORNO.DESTINO_BI_ID);
  let destSheet = ssDestino.getSheetByName("CONSOLIDADO_MASTER");
  
  if (!destSheet) {
    destSheet = ssDestino.insertSheet("CONSOLIDADO_MASTER");
  }
  
  // Persistencia limpia de una sola llamada atómica a la API de Sheets
  destSheet.clearContents();
  destSheet.getRange(1, 1, matrizSalida.length, matrizSalida[0].length).setValues(matrizSalida);
  destSheet.autoResizeColumns(1, moldeVisual.length);
  
  console.timeEnd("⏱️ Pipeline Reporte Consolidado");
  console.log("💾 Persistencia completada. Columna 'dispositivo_envio' inicializada para flujos App.");
}