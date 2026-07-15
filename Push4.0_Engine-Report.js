// =========================================================================
// ARCHIVO: 2_Escultor_Monitoreo.gs
// DESCRIPCIÓN: Capa 3 - Orquestador, Transformador y Persistencia (BI)
// =========================================================================

/**
 * FUNCIÓN EJECUTABLE DE PRODUCCIÓN: Corre este módulo para actualizar el reporte histórico.
 */
function ejecutarMonitoreoOperativo() {
  console.time("⏱️ Pipeline Monitoreo Operativo");
  
  // 1. EXTRACT: Invocación de los Datalakes en memoria RAM
  const airshipDatalake = extraerDatalakeAirship();
  const adobeDatalake = extraerDatalakeAdobe();
  const masterDBDatalake = extraerDatalakeMasterDB();
  
  // Lectura del universo completo del Masterfile base de planificación
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
    
    // --- NUEVO ESTÁNDAR DE TRÁFICO ADOBE ---
    "Visitas_Total", 
    "Bounce_Rate",        
    "Visits_PDP_Total",   // <- Cambiado de "Visits_PDP" a "Visits_PDP_Total"
    "Visits_PDP_1P",      
    "Visits_PDP_3P",      
    "Visits_1P",          
    "Visits_3P",          
    
    // --- NUEVO ESTÁNDAR DE ÓRDENES ADOBE ---
    "Orders_Total",            
    "Orders_1P",         
    "Orders_3P",         
    
    // --- NUEVO ESTÁNDAR DE MONETIZACIÓN ADOBE ---
    "Venta_Total",        
    "Venta_1P",           
    "Venta_3P",           
    
    // --- AUDITORÍA Y SEMÁFOROS ---
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
    
    const llaveBuscar = `${ied}_${fechaString}`;
    
    // Cruces en RAM
    const airship = airshipDatalake.get(llaveBuscar) || { delivery: 0, opens: 0, existe: false };
    const iedSanitizado = ied.replace(/\D/g, "");
    
    const adobe = adobeDatalake.get(iedSanitizado) || { 
      visits_Total: 0, 
      visits_1P: 0, 
      visits_3P: 0, 
      visits_PDP_Total: 0, // Fallback alineado
      visits_PDP_1P: 0, 
      visits_PDP_3P: 0, 
      bounceRate: 0,
      orders_Total: 0, 
      orders_1P: 0, 
      orders_3P: 0, 
      venta_Total: 0,  
      venta_1P: 0,  
      venta_3P: 0, 
      existe: false 
    };
    
    const pushDB = masterDBDatalake.get(ied) || { nToque: "N/D", esFMedia: "N/D", texto: "N/D" };
    
    if (airship.existe) {
      conteoMatches++;
    }
    
    const openRate = airship.delivery > 0 ? (airship.opens / airship.delivery) : 0;
    
    let tipoRealAirship = "NO ENVIADO";
    if (airship.existe && airship.delivery > 0) {
      tipoRealAirship = airship.delivery >= ENTORNO.UMBRAL_MASIVO ? "MASIVO" : "SEGMENTADO";
    }
    
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
    
    // 3. MAPEO ESTRUCTURADO: Repositorio alineado al molde final
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
      
      // Mapeo bajo el estándar simétrico
      "Visitas_Total": adobe.visits_Total,
      "Bounce_Rate": adobe.bounceRate,
      "Visits_PDP_Total": adobe.visits_PDP_Total, // Asignación de la propiedad alineada
      "Visits_PDP_1P": adobe.visits_PDP_1P, 
      "Visits_PDP_3P": adobe.visits_PDP_3P, 
      "Visits_1P": adobe.visits_1P,
      "Visits_3P": adobe.visits_3P,
      
      "Orders_Total": adobe.orders_Total,
      "Orders_1P": adobe.orders_1P,
      "Orders_3P": adobe.orders_3P,
      
      "Venta_Total": adobe.venta_Total,
      "Venta_1P": adobe.venta_1P,
      "Venta_3P": adobe.venta_3P,
      
      "Estado_Ejecucion": estadoEjecucion,
      "Validacion_Base": validacionBase,
      "Estado_Tracking": estadoTracking
    };
    
    const filaEsculpida = moldeVisual.map(col => repositorio[col] !== undefined ? repositorio[col] : null);
    matrizSalida.push(filaEsculpida);
  }
  
  // ==========================================
  // 4. LOAD: Inyección Persistente en Bloque (BI)
  // ==========================================
  const ssDestino = SpreadsheetApp.openById(ENTORNO.DESTINO_BI_ID);
  let destSheet = ssDestino.getSheetByName("MONITOREO_OPERATIVO");
  
  if (!destSheet) {
    destSheet = ssDestino.insertSheet("MONITOREO_OPERATIVO");
  }
  
  destSheet.clearContents();
  destSheet.getRange(1, 1, matrizSalida.length, matrizSalida[0].length).setValues(matrizSalida);
  destSheet.autoResizeColumns(1, moldeVisual.length);
  
  console.timeEnd("⏱️ Pipeline Monitoreo Operativo");
  console.log(`💾 Persistencia completada con éxito. Matriz de Looker Studio completamente estandarizada.`);
}