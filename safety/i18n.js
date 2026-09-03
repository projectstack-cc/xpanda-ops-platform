/* i18n.js — Safety Portal consumer of the shared xPanda i18n engine (window.I18n).
   No modules, no bundlers. Requires /shared/i18n.js to be loaded first (registers
   this module's catalogs against it). Keeps the public window.xPandaI18n shim so
   the 12 pages that call initLanguageSelector() need no edit to their init call. */
(function () {
  // --- Global training video poster (ONE poster for ALL training videos) ---
  const TRAINING_POSTER_URL = "/assets/img/training-video-poster.png";

  function applyTrainingPoster() {
    const video = document.getElementById("trainingVideo");
    if (video && !video.poster) {
      video.poster = TRAINING_POSTER_URL;
    } else if (video) {
      // Always enforce our global poster (keeps blocks consistent)
      video.poster = TRAINING_POSTER_URL;
    }
  }

  // Translations used by ALL pages (navigation-critical UI)
  const translations = {
    en: {
      common: { langLabel: "Language:" },
      safetyHome: {
        title: "xPanda Foam Safety Portal",
        subtitle: "SDS access • Safety training • Quick reference",
        searchHelp: "Search by product or manufacturer name to find Safety Data Sheets.",
        searchPlaceholder: "Search SDS...",
        searchTip: "Tip: Try simple terms like “3M”, “Cleaner”, “Oil”, “Primer”.",
        browseTitle: "📚 Browse SDS",
        browseDesc: "A–Z by manufacturer with filtering.",
        trainingTitle: "🎥 Safety Training",
        trainingDesc: "Videos, checklists, and quick guides.",
        complianceTitle: "Safety & Compliance:",
        complianceBody: "This portal provides immediate access to Safety Data Sheets (SDS), training materials, and safety references to support a hazard-aware workplace and OSHA-aligned practices.",
        complianceFineprint: "Multilingual training captions are available where provided.",
        emergencyTitle: "Emergency:",
        emergencyBody: "If there is immediate danger or a serious injury, call 911.",
        poisonBody: "For chemical exposure guidance, contact Poison Control: 1-800-222-1222."
      },
      sds: {
        back: "← Back to Search",
        title: "SDS Library (Browse by Manufacturer)",
        filterPlaceholder: "Filter (manufacturer or product)..."
      },
      train: {
        title: "Safety Training",
        subtitle: "Choose a training block, then select a video. Captions: Español + Kreyòl Ayisyen.",
        backTitle: "🏠 Back to Portal",
        backDesc: "Return to SDS search and quick links.",
        browseTitle: "📚 Browse SDS",
        browseDesc: "A–Z by manufacturer with filtering.",
        blocksTitle: "🎥 Training Blocks",
        blocksDesc: "Jump to the block sections.",
        block01: "Block 01 — New Hire Core",
        block01desc: "General orientation and baseline safety topics.",
        block02: "Block 02 — Walking Lockout",
        block02desc: "LOTO / walking lockout concepts and procedure.",
        tip: "Tip: In the video player, click the subtitles/CC control to select Español or Kreyòl Ayisyen.",

        // Shared Training Home + Block Page UI
        toTrainingTitle: "🎥 Safety Training",
        toTrainingDesc: "Videos, checklists, and quick guides.",

        backTrainingHomeTitle: "⬅️ Back to Training Home",
        backTrainingHomeDesc: "View all training blocks.",

        captionsTitle: "Captions:",
        captionsBody: "Español + Kreyòl Ayisyen (when provided)",

        completionTitle: "Training Completion",
        completionBodyGeneric: "Enter your name and confirm you completed this training block.",
        fullNameLabel: "Full Name (required)",
        attestText: "I attest that I completed this training block in full.",
        submitCompletion: "Submit Completion",

        // Optional: messages (use later if you decide to i18n the submit scripts)
        msgAlready: "⚠️ Already submitted today for this block.",
        msgSuccess: "✅ Completion recorded. Thank you.",
        msgFail: "❌ Submission failed. Try again.",
        msgNetwork: "❌ Network error. Please try again."
      }
    },

    es: {
      common: { langLabel: "Idioma:" },
      safetyHome: {
        title: "Portal de Seguridad de xPanda Foam",
        subtitle: "Acceso a SDS • Capacitación • Referencia rápida",
        searchHelp: "Busque por producto o fabricante para encontrar Hojas de Datos de Seguridad (SDS).",
        searchPlaceholder: "Buscar SDS...",
        searchTip: "Consejo: Pruebe términos simples como “3M”, “Cleaner”, “Oil”, “Primer”.",
        browseTitle: "📚 Explorar SDS",
        browseDesc: "A–Z por fabricante con filtro.",
        trainingTitle: "🎥 Capacitación de Seguridad",
        trainingDesc: "Videos, listas de verificación y guías rápidas.",
        complianceTitle: "Seguridad y Cumplimiento:",
        complianceBody: "Este portal proporciona acceso inmediato a Hojas de Datos de Seguridad (SDS), materiales de capacitación y referencias de seguridad para apoyar un lugar de trabajo consciente de los peligros y prácticas alineadas con OSHA.",
        complianceFineprint: "Los subtítulos multilingües están disponibles cuando se proporcionan.",
        emergencyTitle: "Emergencia:",
        emergencyBody: "Si hay peligro inmediato o una lesión grave, llame al 911.",
        poisonBody: "Para orientación por exposición química, comuníquese con el Centro de Toxicología: 1-800-222-1222."
      },
      sds: {
        back: "← Volver a Buscar",
        title: "Biblioteca de SDS (Explorar por Fabricante)",
        filterPlaceholder: "Filtrar (fabricante o producto)..."
      },
      train: {
        title: "Capacitación de Seguridad",
        subtitle: "Elija un bloque de capacitación y luego seleccione un video. Subtítulos: Español + Kreyòl Ayisyen.",
        backTitle: "🏠 Volver al Portal",
        backDesc: "Regresar a la búsqueda de SDS y enlaces rápidos.",
        browseTitle: "📚 Explorar SDS",
        browseDesc: "A–Z por fabricante con filtro.",
        blocksTitle: "🎥 Bloques de Capacitación",
        blocksDesc: "Ir a las secciones de bloques.",
        block01: "Bloque 01 — Núcleo para Nuevos Empleados",
        block01desc: "Orientación general y temas básicos de seguridad.",
        block02: "Bloque 02 — Bloqueo Caminando",
        block02desc: "Conceptos y procedimiento de LOTO / bloqueo caminando.",
        tip: "Consejo: En el reproductor de video, haga clic en subtítulos/CC para seleccionar Español o Kreyòl Ayisyen.",

        toTrainingTitle: "🎥 Capacitación de Seguridad",
        toTrainingDesc: "Videos, listas de verificación y guías rápidas.",

        backTrainingHomeTitle: "⬅️ Volver a Capacitación",
        backTrainingHomeDesc: "Ver todos los bloques.",

        captionsTitle: "Subtítulos:",
        captionsBody: "Español + Kreyòl Ayisyen (cuando estén disponibles)",

        completionTitle: "Confirmación de Capacitación",
        completionBodyGeneric: "Ingrese su nombre y confirme que completó este bloque de capacitación.",
        fullNameLabel: "Nombre completo (requerido)",
        attestText: "Confirmo que completé este bloque de capacitación por completo.",
        submitCompletion: "Enviar Confirmación",

        msgAlready: "⚠️ Ya se envió hoy para este bloque.",
        msgSuccess: "✅ Confirmación registrada. Gracias.",
        msgFail: "❌ Falló el envío. Intente de nuevo.",
        msgNetwork: "❌ Error de red. Intente de nuevo."
      }
    },

    ht: {
      common: { langLabel: "Lang:" },
      safetyHome: {
        title: "Pòtal Sekirite xPanda Foam",
        subtitle: "Aksè SDS • Fòmasyon Sekirite • Referans rapid",
        searchHelp: "Chèche pa non pwodwi oswa manifakti pou jwenn Fèy Done Sekirite (SDS).",
        searchPlaceholder: "Chèche SDS...",
        searchTip: "Konsèy: Eseye tèm senp tankou “3M”, “Cleaner”, “Oil”, “Primer”.",
        browseTitle: "📚 Gade SDS A–Z",
        browseDesc: "A–Z pa manifakti avèk filtè.",
        trainingTitle: "🎥 Fòmasyon Sekirite",
        trainingDesc: "Videyo, lis verifikasyon, ak gid rapid.",
        complianceTitle: "Sekirite ak Konfòmite:",
        complianceBody: "Pòtal sa a bay aksè imedyat a Fèy Done Sekirite (SDS), materyèl fòmasyon, ak referans sekirite pou sipòte yon anviwònman travay ki okouran de danje epi ki aliyen ak pratik OSHA.",
        complianceFineprint: "Soustit miltilang disponib lè yo bay yo.",
        emergencyTitle: "Ijans:",
        emergencyBody: "Si gen danje imedyat oswa yon blesi grav, rele 911.",
        poisonBody: "Pou gid sou ekspozisyon chimik, kontakte Poison Control: 1-800-222-1222."
      },
      sds: {
        back: "← Retounen nan Rechèch",
        title: "Bibliyotèk SDS (Gade pa Manifakti)",
        filterPlaceholder: "Filtre (manifakti oswa pwodwi)..."
      },
      train: {
        title: "Fòmasyon Sekirite",
        subtitle: "Chwazi yon blòk fòmasyon, epi chwazi yon videyo. Soustit: Español + Kreyòl Ayisyen.",
        backTitle: "🏠 Retounen nan Pòtal la",
        backDesc: "Retounen nan rechèch SDS ak lyen rapid.",
        browseTitle: "📚 Gade SDS A–Z",
        browseDesc: "A–Z pa manifakti avèk filtè.",
        blocksTitle: "🎥 Blòk Fòmasyon",
        blocksDesc: "Ale nan seksyon blòk yo.",
        block01: "Blòk 01 — Nwayo Nouvo Anplwaye",
        block01desc: "Oryantasyon jeneral ak sijè sekirite debaz.",
        block02: "Blòk 02 — Walking Lockout",
        block02desc: "Konsèp ak pwosedi LOTO / walking lockout.",
        tip: "Konsèy: Nan jwè videyo a, klike sou soustit/CC pou chwazi Español oswa Kreyòl Ayisyen.",

        toTrainingTitle: "🎥 Fòmasyon Sekirite",
        toTrainingDesc: "Videyo, lis verifikasyon, ak gid rapid.",

        backTrainingHomeTitle: "⬅️ Tounen sou Fòmasyon",
        backTrainingHomeDesc: "Wè tout blòk yo.",

        captionsTitle: "Soustit:",
        captionsBody: "Español + Kreyòl Ayisyen (lè yo disponib)",

        completionTitle: "Konfimasyon Fòmasyon",
        completionBodyGeneric: "Mete non ou epi konfime ou fini blòk fòmasyon sa a.",
        fullNameLabel: "Non konplè (obligatwa)",
        attestText: "Mwen konfime mwen fini blòk fòmasyon sa a nèt.",
        submitCompletion: "Voye Konfimasyon",

        msgAlready: "⚠️ Ou deja voye li jodi a pou blòk sa a.",
        msgSuccess: "✅ Nou anrejistre li. Mèsi.",
        msgFail: "❌ Li pa pase. Tanpri eseye ankò.",
        msgNetwork: "❌ Pwoblèm rezo. Tanpri eseye ankò."
      }
    }
  };

  if (!window.I18n) {
    console.warn("safety/i18n.js: window.I18n (shared engine) not found — load /shared/i18n.js first.");
  } else {
    window.I18n.register("common", { en: translations.en.common, es: translations.es.common, ht: translations.ht.common });
    window.I18n.register("safetyHome", { en: translations.en.safetyHome, es: translations.es.safetyHome, ht: translations.ht.safetyHome });
    window.I18n.register("sds", { en: translations.en.sds, es: translations.es.sds, ht: translations.ht.sds });
    window.I18n.register("train", { en: translations.en.train, es: translations.es.train, ht: translations.ht.train });
  }

  function applyLanguage(lang) {
    if (!window.I18n) return;
    window.I18n.set(lang);
    applyTrainingPoster();
  }

  function initLanguageSelector(options) {
    if (!window.I18n) {
      console.warn("safety/i18n.js: window.I18n (shared engine) not found — cannot init language selector.");
      return;
    }

    const selectorId = (options && options.selectorId) || "xpandaLang";
    const select = document.getElementById(selectorId);

    if (select) {
      select.value = window.I18n.get();
      if (!select.dataset.i18nBound) {
        select.addEventListener("change", () => applyLanguage(select.value));
        select.dataset.i18nBound = "1";
      }
    }

    window.I18n.apply(document);
    applyTrainingPoster();
  }

  window.xPandaI18n = {
    applyLanguage,
    initLanguageSelector,
    translations,

    // Preserved for shape-compatibility; delegates to the shared engine (always resolves
    // against the engine's current active language — no per-call lang override).
    getString: function (key) {
      return window.I18n ? window.I18n.t(key) : null;
    },

    // Optional export (handy if you ever want to call it directly)
    applyTrainingPoster
  };
})();
