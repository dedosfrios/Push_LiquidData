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