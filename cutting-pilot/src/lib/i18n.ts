export const LANGS = ["en", "es", "ht"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";
export const LANG_STORAGE_KEY = "xpanda_lang";

export const catalog: Record<string, Record<Lang, string>> = {
  "orders.newOrder": { en: "New order", es: "Pedido nuevo", ht: "Nouvo kòmand" },
  "orders.customerOrderSection": {
    en: "Customer & order",
    es: "Cliente y pedido",
    ht: "Kliyan & kòmand",
  },
  "orders.customer": { en: "Customer", es: "Cliente", ht: "Kliyan" },
  "orders.poNumber": { en: "PO number", es: "Número de OC", ht: "Nimewo PO" },
  "orders.invoiceNumber": { en: "Invoice number", es: "Número de factura", ht: "Nimewo fakti" },
  "orders.orderSaved": { en: "Order saved", es: "Pedido guardado", ht: "Kòmand anrejistre" },

  // prod-a-03 — Production Log (v2): Molding / Expansion board, full en/es/ht.
  "production.board.molding": { en: "Molding", es: "Moldeo", ht: "Moulaj" },
  "production.board.expansion": { en: "Expansion", es: "Expansión", ht: "Ekspansyon" },

  "production.today.heading": { en: "Made today", es: "Hecho hoy", ht: "Fèt jodi a" },
  "production.today.moldingLabel": { en: "Molding:", es: "Moldeo:", ht: "Moulaj:" },
  "production.today.expansionLabel": { en: "Expansion:", es: "Expansión:", ht: "Ekspansyon:" },
  "production.today.blocksUnit": { en: "blocks", es: "bloques", ht: "blòk" },
  "production.today.batchesUnit": { en: "batches", es: "lotes", ht: "lo" },
  "production.today.lbsUnit": { en: "lbs", es: "lbs", ht: "lbs" },
  "production.today.kgUnit": { en: "kg", es: "kg", ht: "kg" },
  "production.today.silo": { en: "Silo", es: "Silo", ht: "Silo" },
  "production.today.blkUnit": { en: "blk", es: "blq", ht: "blòk" },
  "production.today.batchUnit": { en: "batch", es: "lote", ht: "lo" },

  "production.session.empty": {
    en: "No sheets yet. Start a sheet to begin logging.",
    es: "Aún no hay hojas. Inicia una hoja para comenzar a registrar.",
    ht: "Poko gen fèy. Kòmanse yon fèy pou kòmanse anrejistre.",
  },
  "production.session.blockTypeHint": {
    en: "One sheet = one block type — change type, start a new sheet.",
    es: "Una hoja = un tipo de bloque — para cambiar el tipo, inicia una hoja nueva.",
    ht: "Yon fèy = yon sèl tip blòk — pou chanje tip, kòmanse yon nouvo fèy.",
  },
  "production.session.open": { en: "OPEN", es: "ABIERTA", ht: "OUVÈ" },
  "production.session.closed": { en: "CLOSED", es: "CERRADA", ht: "FÈMEN" },
  "production.session.selectSheetAria": { en: "Select sheet", es: "Seleccionar hoja", ht: "Chwazi fèy" },
  "production.session.newSheet": { en: "New sheet", es: "Nueva hoja", ht: "Nouvo fèy" },
  "production.session.closeSheet": { en: "Close sheet", es: "Cerrar hoja", ht: "Fèmen fèy" },
  "production.session.reopen": { en: "Reopen", es: "Reabrir", ht: "Louvri ankò" },
  "production.session.deleteSheet": { en: "Delete sheet", es: "Eliminar hoja", ht: "Efase fèy" },
  "production.session.loggingAs": { en: "Logging as", es: "Registrando como", ht: "Anrejistre kòm" },
  "production.session.switchUser": { en: "Switch user", es: "Cambiar usuario", ht: "Chanje itilizatè" },

  "production.grid.actions": { en: "Actions", es: "Acciones", ht: "Aksyon" },
  "production.grid.editAria": { en: "Edit row", es: "Editar fila", ht: "Modifye liy" },
  "production.grid.deleteAria": { en: "Delete row", es: "Eliminar fila", ht: "Efase liy" },
  "production.grid.add": { en: "Add", es: "Agregar", ht: "Ajoute" },
  "production.grid.closedHint": {
    en: "Closed — reopen to edit.",
    es: "Cerrada — reabre para editar.",
    ht: "Fèmen — louvri ankò pou modifye.",
  },
  "production.grid.rowIndex": { en: "#", es: "#", ht: "#" },

  "production.options.emptyHint": {
    en: "No options yet — ask a manager to add them.",
    es: "Aún no hay opciones — pide a un gerente que las agregue.",
    ht: "Poko gen opsyon — mande yon manadjè ajoute yo.",
  },
  "production.options.addNew": { en: "+ Add new…", es: "+ Agregar nuevo…", ht: "+ Ajoute nouvo…" },

  "production.common.cancel": { en: "Cancel", es: "Cancelar", ht: "Anile" },
  "production.common.retry": { en: "Retry", es: "Reintentar", ht: "Eseye ankò" },

  "production.toast.sheetStarted": { en: "Sheet started.", es: "Hoja iniciada.", ht: "Fèy kòmanse." },
  "production.toast.sheetClosed": { en: "Sheet closed.", es: "Hoja cerrada.", ht: "Fèy fèmen." },
  "production.toast.sheetReopened": { en: "Sheet reopened.", es: "Hoja reabierta.", ht: "Fèy louvri ankò." },
  "production.toast.rowUpdated": { en: "Row updated.", es: "Fila actualizada.", ht: "Liy mete ajou." },
  "production.toast.rowDeleted": { en: "Row deleted.", es: "Fila eliminada.", ht: "Liy efase." },
  "production.toast.sheetHidden": { en: "Sheet hidden.", es: "Hoja ocultada.", ht: "Fèy kache." },
  "production.toast.sheetPurged": {
    en: "Sheet permanently deleted.",
    es: "Hoja eliminada permanentemente.",
    ht: "Fèy efase pou tout bon.",
  },
  "production.toast.optionAdded": { en: "Option added.", es: "Opción agregada.", ht: "Opsyon ajoute." },
  "production.toast.networkError": { en: "Network error.", es: "Error de red.", ht: "Erè rezo." },
  "production.toast.startSheetFailed": {
    en: "Failed to start sheet.", es: "No se pudo iniciar la hoja.", ht: "Echèk pou kòmanse fèy.",
  },
  "production.toast.closeSheetFailed": {
    en: "Failed to close sheet.", es: "No se pudo cerrar la hoja.", ht: "Echèk pou fèmen fèy.",
  },
  "production.toast.reopenSheetFailed": {
    en: "Failed to reopen sheet.", es: "No se pudo reabrir la hoja.", ht: "Echèk pou louvri fèy ankò.",
  },
  "production.toast.saveBlockFailed": {
    en: "Failed to save block.", es: "No se pudo guardar el bloque.", ht: "Echèk pou anrejistre blòk.",
  },
  "production.toast.saveBatchFailed": {
    en: "Failed to save batch.", es: "No se pudo guardar el lote.", ht: "Echèk pou anrejistre lo.",
  },
  "production.toast.updateRowFailed": {
    en: "Failed to update row.", es: "No se pudo actualizar la fila.", ht: "Echèk pou mete liy ajou.",
  },
  "production.toast.deleteRowFailed": {
    en: "Failed to delete row.", es: "No se pudo eliminar la fila.", ht: "Echèk pou efase liy.",
  },
  "production.toast.deleteSheetFailed": {
    en: "Failed to delete sheet.", es: "No se pudo eliminar la hoja.", ht: "Echèk pou efase fèy.",
  },
  "production.toast.addOptionFailed": {
    en: "Failed to add option.", es: "No se pudo agregar la opción.", ht: "Echèk pou ajoute opsyon.",
  },

  "production.error.sheetClosed": {
    en: "This sheet is locked — reopen it to edit.",
    es: "Esta hoja está bloqueada — reábrela para editar.",
    ht: "Fèy sa a bloke — louvri li ankò pou modifye.",
  },
  "production.error.sheetNotFound": {
    en: "Sheet not found — it may have been deleted.",
    es: "Hoja no encontrada — puede haber sido eliminada.",
    ht: "Fèy pa jwenn — li ka te efase.",
  },
  "production.error.weightRequired": { en: "Weight is required.", es: "El peso es obligatorio.", ht: "Pwa a obligatwa." },
  "production.error.blockTypeRequired": {
    en: "Block type is required.", es: "El tipo de bloque es obligatorio.", ht: "Tip blòk la obligatwa.",
  },
  "production.error.unknownBlockType": {
    en: "Unknown block type — add it first.",
    es: "Tipo de bloque desconocido — agrégalo primero.",
    ht: "Tip blòk enkoni — ajoute li anvan.",
  },
  "production.error.unknownBlockSize": {
    en: "Unknown block size — add it first.",
    es: "Tamaño de bloque desconocido — agrégalo primero.",
    ht: "Gwosè blòk enkoni — ajoute li anvan.",
  },
  "production.error.unknownBeadType": {
    en: "Unknown bead type for that supplier — add it first.",
    es: "Tipo de perla desconocido para ese proveedor — agrégalo primero.",
    ht: "Tip grenn enkoni pou founisè sa a — ajoute li anvan.",
  },
  "production.error.optionExists": {
    en: "That option already exists.", es: "Esa opción ya existe.", ht: "Opsyon sa a deja egziste.",
  },
  "production.error.adminOnly": {
    en: "Administrator access required.", es: "Se requiere acceso de administrador.", ht: "Aksè administratè obligatwa.",
  },
  "production.error.unauthorized": { en: "Please sign in again.", es: "Vuelve a iniciar sesión.", ht: "Tanpri konekte ankò." },
  "production.error.forbidden": { en: "Access denied.", es: "Acceso denegado.", ht: "Aksè refize." },
  "production.error.loadMoldingFailed": {
    en: "Failed to load Molding sessions.",
    es: "No se pudieron cargar las hojas de Moldeo.",
    ht: "Echèk pou chaje fèy Moulaj.",
  },
  "production.error.loadExpansionFailed": {
    en: "Failed to load Expansion sessions.",
    es: "No se pudieron cargar las hojas de Expansión.",
    ht: "Echèk pou chaje fèy Ekspansyon.",
  },
  "production.error.networkError": {
    en: "Network error — check connection.",
    es: "Error de red — revisa la conexión.",
    ht: "Erè rezo — verifye koneksyon an.",
  },

  "production.field.blockNo": { en: "# Block", es: "# Bloque", ht: "# Blòk" },
  "production.field.blockSize": { en: "Block Size", es: "Tamaño de Bloque", ht: "Gwosè Blòk" },
  "production.field.silo": { en: "Silo", es: "Silo", ht: "Silo" },
  "production.field.lotNo": { en: "Lot #", es: "Lote #", ht: "Lo #" },
  "production.field.rcPctOpen": { en: "RC % Open", es: "RC % Abierto", ht: "RC % Ouvè" },
  "production.field.rcSpeed": { en: "RC Speed", es: "Velocidad RC", ht: "Vitès RC" },
  "production.field.virginPctOpen": { en: "Virgin % Open", es: "Virgen % Abierto", ht: "Vyèj % Ouvè" },
  "production.field.virginSpeed": { en: "Virgin Speed", es: "Velocidad Virgen", ht: "Vitès Vyèj" },
  "production.field.time": { en: "Time", es: "Hora", ht: "Lè" },
  "production.field.autoChip": { en: "Auto", es: "Automático", ht: "Otomatik" },
  "production.field.weightLbs": { en: "Block Weight (lbs)", es: "Peso del Bloque (lbs)", ht: "Pwa Blòk (lbs)" },
  "production.field.operator": { en: "Operator", es: "Operador", ht: "Operatè" },
  "production.field.weightKg": { en: "Weight (KG)", es: "Peso (KG)", ht: "Pwa (KG)" },
  "production.field.heatingTimeS": { en: "Heating Time (s)", es: "Tiempo de Calentamiento (s)", ht: "Tan Chofaj (s)" },
  "production.field.bucketWeightG": { en: "Bucket Weight (g)", es: "Peso del Balde (g)", ht: "Pwa Bokit (g)" },

  "production.newSheet.titleMolding": { en: "New Molding sheet", es: "Nueva hoja de Moldeo", ht: "Nouvo fèy Moulaj" },
  "production.newSheet.titleExpansion": { en: "New Expansion sheet", es: "Nueva hoja de Expansión", ht: "Nouvo fèy Ekspansyon" },
  "production.newSheet.blockType": { en: "Block type", es: "Tipo de bloque", ht: "Tip blòk" },
  "production.newSheet.supplier": { en: "Supplier", es: "Proveedor", ht: "Founisè" },
  "production.newSheet.beadType": { en: "Bead type", es: "Tipo de perla", ht: "Tip grenn" },
  "production.newSheet.density": { en: "Density", es: "Densidad", ht: "Dansite" },
  "production.newSheet.targetWeightG": { en: "Weight (g)", es: "Peso (g)", ht: "Pwa (g)" },
  "production.newSheet.startTime": { en: "Start time", es: "Hora de inicio", ht: "Lè kòmansman" },
  "production.newSheet.finishTime": { en: "Finish time", es: "Hora de finalización", ht: "Lè fini" },
  "production.newSheet.start": { en: "Start sheet", es: "Iniciar hoja", ht: "Kòmanse fèy" },
  "production.newSheet.starting": { en: "Starting…", es: "Iniciando…", ht: "K ap kòmanse…" },
  "production.newSheet.selectPlaceholder": { en: "Select…", es: "Seleccionar…", ht: "Chwazi…" },

  "production.edit.save": { en: "Save", es: "Guardar", ht: "Anrejistre" },
  "production.edit.saving": { en: "Saving…", es: "Guardando…", ht: "K ap anrejistre…" },

  "production.deleteRow.title": { en: "Delete row?", es: "¿Eliminar fila?", ht: "Efase liy?" },
  "production.deleteRow.body": {
    en: "This will permanently remove the row. This can't be undone.",
    es: "Esto eliminará la fila de forma permanente. Esto no se puede deshacer.",
    ht: "Sa ap efase liy la pou tout bon. Ou pa ka defèt sa.",
  },
  "production.deleteRow.confirm": { en: "Delete", es: "Eliminar", ht: "Efase" },
  "production.deleteRow.confirming": { en: "Deleting…", es: "Eliminando…", ht: "K ap efase…" },

  "production.addOption.titleBlockType": { en: "Add block type", es: "Agregar tipo de bloque", ht: "Ajoute tip blòk" },
  "production.addOption.titleBlockSize": { en: "Add block size", es: "Agregar tamaño de bloque", ht: "Ajoute gwosè blòk" },
  "production.addOption.titleBeadType": { en: "Add bead type", es: "Agregar tipo de perla", ht: "Ajoute tip grenn" },
  "production.addOption.value": { en: "Value", es: "Valor", ht: "Valè" },
  "production.addOption.submit": { en: "Add", es: "Agregar", ht: "Ajoute" },
  "production.addOption.submitting": { en: "Adding…", es: "Agregando…", ht: "K ap ajoute…" },

  "production.deleteSheet.title": { en: "Delete sheet?", es: "¿Eliminar hoja?", ht: "Efase fèy?" },
  "production.deleteSheet.body": {
    en: "Hiding a sheet removes it from the active list; an administrator can still see it. Purging removes it completely and cannot be undone.",
    es: "Ocultar una hoja la quita de la lista activa; un administrador aún puede verla. Purgar la elimina por completo y no se puede deshacer.",
    ht: "Kache yon fèy retire l nan lis aktif la; yon administratè ka toujou wè li. Retire nèt efase l pou tout bon, ou pa ka defèt sa.",
  },
  "production.deleteSheet.hide": {
    en: "Hide sheet — recoverable by admin",
    es: "Ocultar hoja — recuperable por un administrador",
    ht: "Kache fèy — administratè ka rekipere l",
  },
  "production.deleteSheet.hiding": { en: "Hiding…", es: "Ocultando…", ht: "K ap kache…" },
  "production.deleteSheet.purge": {
    en: "Permanently delete (purge)", es: "Eliminar permanentemente (purgar)", ht: "Efase pou tout bon (retire nèt)",
  },
  "production.deleteSheet.purging": { en: "Purging…", es: "Purgando…", ht: "K ap retire nèt…" },
};

export function getStoredLang(): Lang {
  try {
    const val = localStorage.getItem(LANG_STORAGE_KEY);
    if (val === "en" || val === "es" || val === "ht") return val;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

export function translate(lang: Lang, key: string): string {
  const entry = catalog[key];
  if (!entry) return key;
  return entry[lang] ?? entry[DEFAULT_LANG] ?? key;
}
