// =========================================================================
// ARCHIVO: 3_Escultor_Consolidado.gs
// DESCRIPCIÓN: Capa 3 - Orquestador ETL con Validación de Contratos,
// Persistencia SSOT e Inyección de Métricas Derivadas
// =========================================================================
//
// CAMBIOS EN ESTA REVISIÓN:
//
// 1. RENOMBRADO: "OR%_real" -> "Visitas_por_Impacto".
//    El nombre anterior sugería un "Open Rate" tradicional (aperturas /
//    enviados), pero la fórmula real es Visitas (Adobe) / Impactos de
//    Airship (Direct Response Count + Indirect Response Count). Esa suma
//    no son "aperturas" en sentido estricto: incluye usuarios que vieron
//    el push sin tocarlo (indirect), por eso hoy el numerador de visitas
//    podía superar al de "Direct Response Count" solo. El nuevo nombre
//    refleja lo que la métrica realmente mide. REQUIERE reconectar el
//    campo en Looker Studio con el nombre nuevo (acción pendiente del
//    usuario, confirmada y aceptada).
//
// 2. PATRÓN ESCALABLE: se reemplazó la función de una sola métrica
//    hardcodeada por un REGISTRO (`METRICAS_DERIVADAS`), array de
//    definiciones { nombre, calcular }. Agregar una métrica nueva en el
//    futuro es agregar un objeto a ese array — nada más se toca. El
//    esquema de salida (`superSetHeaders`) se deriva automáticamente del
//    mismo registro, así que es imposible que una métrica se calcule y
//    no llegue a la hoja, o que se declare una columna sin cálculo.
//
// 3. LOOKUP EXPLÍCITO: se eliminó el `find(k => /visit/i.test(k))` que
//    tomaba de forma ambigua/silenciosa la primera columna que contuviera
//    "visit" en el nombre. Ahora se referencia la columna "Visits" de
//    forma explícita. Si no existe, se cuenta y se reporta al final del
//    log en vez de fallar en silencio fila por fila.
// =========================================================================

/**
 * REGISTRO DE MÉTRICAS DERIVADAS (Single Source of Truth)
 * ---------------------------------------------------------------------
 * Para agregar una métrica nueva: agrega un objeto { nombre, calcular }
 * a este array. No hace falta tocar ninguna otra parte del código —
 * ni el esquema de columnas, ni el helper de inyección, ni el LOAD.
 *
 * `calcular(superObjeto, ctx)` debe ser una función pura: recibe el
 * objeto unificado de la fila (todas las columnas ya combinadas de
 * Master/Airship/Adobe) y el contexto de ejecución (para reportar
 * columnas faltantes de forma agregada), y devuelve el valor a inyectar.
 */
const METRICAS_DERIVADAS = [
  {
    nombre: "Visitas_por_Impacto",
    descripcion: "Visitas atribuidas por Adobe, por cada impacto de push " +
                 "(Direct Response Count + Indirect Response Count de Airship). " +
                 "No es un Open Rate tradicional: 'Indirect' incluye usuarios que " +
                 "vieron el push sin tocarlo, por eso el numerador de visitas puede " +
                 "superar al conteo de respuestas directas.",
    calcular: (superObjeto, ctx) => {
      const impactos = (Number(superObjeto["Direct Response Count"]) || 0) +
                        (Number(superObjeto["Indirect Response Count"]) || 0);

      if (superObjeto["Visits"] === undefined) {
        ctx.contadorVisitsFaltante++;
      }
      const visitas = Number(superObjeto["Visits"]) || 0;

      return impactos > 0 ? (visitas / impactos) : 0;
    }
  }

  // Para agregar una métrica nueva, solo agrega un objeto aquí, ej:
  // {
  //   nombre: "MiMetricaNueva",
  //   descripcion: "...",
  //   calcular: (superObjeto, ctx) => { ... return valor; }
  // }
];

/**
 * Inyecta todas las métricas del registro sobre el objeto unificado de una fila.
 * `ctx` es un objeto mutable compartido entre filas, usado para acumular
 * estadísticas de columnas faltantes sin loguear fila por fila.
 */
function _inyectarMetricasDerivadas(superObjeto, ctx) {
  METRICAS_DERIVADAS.forEach(metrica => {
    superObjeto[metrica.nombre] = metrica.calcular(superObjeto, ctx);
  });
  return superObjeto;
}

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
      throw new Error(`🚨 CONTRATO ROTO: El módulo de Datalake en el índice ${i} no devolvió la estructura '{ encabezados, mapaData }'.`);
    }
  }

  const datalakeApp = rsApp.mapaData;
  const datalakeWeb = rsWeb.mapaData;
  const masterAppMap = rsMasterApp.mapaData;
  const masterWebMap = rsMasterWeb.mapaData;
  const adobeMap = rsAdobe.mapaData;

  logger.push(`📊 Registros base cargados - App: ${datalakeApp.size} | Web: ${datalakeWeb.size}`);

  // CONSTRUCCIÓN DEL ESQUEMA DINÁMICO (Schema-On-Read)
  const columnasExcluidas = new Set(["", "Custom Objects Raw", "Notification Name", "IED", "IED_Sanitizado"]);
  const superSetHeaders = new Set();

  modulos.forEach(rs => {
    rs.encabezados.forEach(h => {
      if (!columnasExcluidas.has(h)) superSetHeaders.add(h);
    });
  });

  // Las columnas de métricas derivadas se declaran automáticamente a
  // partir del registro — imposible que se desincronicen del cálculo.
  METRICAS_DERIVADAS.forEach(metrica => superSetHeaders.add(metrica.nombre));

  const masterHeaders = ["Canal", "IED", ...Array.from(superSetHeaders)];
  const filasConsolidadas = [masterHeaders];

  const construirFilaCompleta = (canal, ied, objCombinado) => {
    return masterHeaders.map(header => {
      if (header === "Canal") return canal;
      if (header === "IED") return ied;
      return objCombinado[header] !== undefined ? objCombinado[header] : "";
    });
  };

  // Contexto compartido para acumular estadísticas de columnas faltantes
  // sin loguear fila por fila (evita ruido en el log de ejecución).
  const ctxMetricas = { contadorVisitsFaltante: 0 };

  // Transform: Canal APP
  for (const [claveUniversal, appData] of datalakeApp.entries()) {
    const masterData = masterAppMap.get(claveUniversal) || {};
    const adobeData = adobeMap.get(claveUniversal) || {};

    // Spread Operator para unificar la data
    let superObjeto = { ...masterData, ...appData, ...adobeData };

    // Inyectamos la lógica de negocio pura (registro de métricas)
    superObjeto = _inyectarMetricasDerivadas(superObjeto, ctxMetricas);

    filasConsolidadas.push(construirFilaCompleta("APP", appData.__displayIed, superObjeto));
  }

  // Transform: Canal WEB
  for (const [claveUniversal, webData] of datalakeWeb.entries()) {
    const masterWebData = masterWebMap.get(claveUniversal) || {};
    const adobeData = adobeMap.get(claveUniversal) || {};

    let superObjeto = { ...masterWebData, ...webData, ...adobeData };

    // Inyectamos la lógica de negocio pura (registro de métricas)
    superObjeto = _inyectarMetricasDerivadas(superObjeto, ctxMetricas);

    filasConsolidadas.push(construirFilaCompleta("WEB", webData.__displayIed, superObjeto));
  }

  if (ctxMetricas.contadorVisitsFaltante > 0) {
    logger.push(`⚠️ AVISO: ${ctxMetricas.contadorVisitsFaltante} filas no tenían columna "Visits" de Adobe (probablemente sin match en Adobe) — se calculó Visitas_por_Impacto con visitas=0 para esas filas.`);
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
    // Single-pass write
    sheetMaster.getRange(1, 1, filasConsolidadas.length, masterHeaders.length).setValues(filasConsolidadas);
  } else {
    logger.push("⚠️ WARNING: No hay datos indexables válidos para consolidar. Se escribió solo el encabezado.");
    sheetMaster.getRange(1, 1, 1, masterHeaders.length).setValues([masterHeaders]);
  }

  logger.push("✅ [SUCCESS] ETL Schema-Agnostic completado.");
  console.log(logger.join("\n"));
}