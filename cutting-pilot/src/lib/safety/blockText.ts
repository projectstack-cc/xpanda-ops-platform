// src/lib/safety/blockText.ts
// saf-02: en/es/ht display strings for the ready training blocks (block title + topics) and their videos (title +
// description), keyed by block id / video key, so trainingBlocks.ts stays English-only data. English = the legacy
// pages verbatim (same as trainingBlocks.ts). Spanish block titles 01–04 = the approved "v2 Safety" canvas's phone
// artboard; every other es/ht string here is NEW best-effort machine translation (legacy has these in English only) —
// listed in CHANGELOG saf-02 for the native-speaker review (BACKLOG). Topics use " · " between items, as the canvas does.
import type { Lang } from "@/lib/i18n";
import type { TrainingBlock, TrainingVideo } from "./trainingBlocks";

type L = Record<Lang, string>;

export const BLOCK_TEXT: Record<string, { title: L; topics: L }> = {
  "block-01": {
    title: {
      en: "New Hire Core Orientation",
      es: "Orientación básica para nuevos empleados",
      ht: "Oryantasyon debaz pou nouvo anplwaye",
    },
    topics: {
      en: "General Safety Orientation · PPE · Hearing Protection · Workers’ Comp (Non-CA)",
      es: "Orientación general de seguridad · EPP · Protección auditiva · Compensación laboral (fuera de CA)",
      ht: "Oryantasyon jeneral sou sekirite · EPP · Pwoteksyon zòrèy · Konpansasyon travayè (pa CA)",
    },
  },
  "block-02": {
    title: {
      en: "Walking, Slips and Lockout",
      es: "Caminar, resbalones y bloqueo",
      ht: "Mache, glise ak bloke machin",
    },
    topics: {
      en: "Slips/Trips/Falls · Walking-Working Surfaces · Machine Guarding · Lockout/Tagout",
      es: "Resbalones/tropiezos/caídas · Superficies para caminar y trabajar · Resguardo de máquinas · Bloqueo y etiquetado",
      ht: "Glise/bite/tonbe · Sifas pou mache ak travay · Pwoteksyon machin · Bloke ak etikete (LOTO)",
    },
  },
  "block-03": {
    title: {
      en: "Physical Injury and First Response",
      es: "Lesiones físicas y primera respuesta",
      ht: "Blesi fizik ak premye repons",
    },
    topics: {
      en: "First Aid (Basic) · Back Safety · Eyewash and Safety Shower",
      es: "Primeros auxilios (básico) · Seguridad de la espalda · Lavaojos y ducha de seguridad",
      ht: "Premye swen (debaz) · Sekirite do · Lave je ak douch sekirite",
    },
  },
  "block-04": {
    title: {
      en: "Fall Protection and Heat Exposure",
      es: "Protección contra caídas y calor",
      ht: "Pwoteksyon kont tonbe ak chalè",
    },
    topics: {
      en: "Fall Protection (General Industry Awareness) · Extreme Temperature (Heat)",
      es: "Protección contra caídas (conocimiento general de la industria) · Temperatura extrema (calor)",
      ht: "Pwoteksyon kont tonbe (konesans jeneral endistri) · Tanperati ekstrèm (chalè)",
    },
  },
};

export const VIDEO_TEXT: Record<string, { title: L; desc: L }> = {
  // block-01
  "general-safety-orientation": {
    title: { en: "General Safety Orientation", es: "Orientación general de seguridad", ht: "Oryantasyon jeneral sou sekirite" },
    desc: {
      en: "Baseline safety orientation for new hires.",
      es: "Orientación básica de seguridad para nuevos empleados.",
      ht: "Oryantasyon sekirite debaz pou nouvo anplwaye.",
    },
  },
  "personal-protective-equipment": {
    title: { en: "Personal Protective Equipment", es: "Equipo de protección personal", ht: "Ekipman pwoteksyon pèsonèl" },
    desc: {
      en: "PPE expectations and required usage.",
      es: "Lo que se espera del EPP y su uso obligatorio.",
      ht: "Sa yo atann pou EPP ak fason pou itilize li obligatwa.",
    },
  },
  "hearing-protection": {
    title: { en: "Hearing Protection", es: "Protección auditiva", ht: "Pwoteksyon zòrèy" },
    desc: {
      en: "Hearing protection requirements and best practices.",
      es: "Requisitos y buenas prácticas de protección auditiva.",
      ht: "Egzijans ak bon pratik pou pwoteje zòrèy.",
    },
  },
  "peo-workers-comp-non-ca": {
    title: { en: "PEO Workers Comp (Non-CA)", es: "Compensación laboral PEO (fuera de CA)", ht: "Konpansasyon travayè PEO (pa CA)" },
    desc: {
      en: "Workers comp guidance for non-California context.",
      es: "Guía de compensación laboral fuera de California.",
      ht: "Gid sou konpansasyon travayè pou andeyò Kalifòni.",
    },
  },
  // block-02
  "lockout-tagout": {
    title: { en: "Lockout Tagout", es: "Bloqueo y etiquetado", ht: "Bloke ak etikete (LOTO)" },
    desc: {
      en: "Core LOTO concepts and expectations for safe work.",
      es: "Conceptos clave de LOTO y lo que se espera para trabajar con seguridad.",
      ht: "Konsèp debaz LOTO ak sa yo atann pou travay an sekirite.",
    },
  },
  "machine-guarding": {
    title: { en: "Machine Guarding", es: "Resguardo de máquinas", ht: "Pwoteksyon machin" },
    desc: {
      en: "Machine guarding basics and safe operation reminders.",
      es: "Lo básico del resguardo de máquinas y recordatorios para operar con seguridad.",
      ht: "Baz pwoteksyon machin ak rapèl pou opere an sekirite.",
    },
  },
  "walking-working-surfaces": {
    title: { en: "Walking-Working Surfaces", es: "Superficies para caminar y trabajar", ht: "Sifas pou mache ak travay" },
    desc: {
      en: "Walkway safety, trip hazards, housekeeping, and awareness.",
      es: "Seguridad en pasillos, riesgos de tropiezo, orden y limpieza, y atención.",
      ht: "Sekirite nan pasaj, danje pou bite, pwòpte ak atansyon.",
    },
  },
  "slips-trips-falls": {
    title: { en: "Slips, Trips, and Falls", es: "Resbalones, tropiezos y caídas", ht: "Glise, bite ak tonbe" },
    desc: {
      en: "Preventing slip/trip/fall incidents with practical habits.",
      es: "Cómo prevenir resbalones, tropiezos y caídas con hábitos prácticos.",
      ht: "Kijan pou evite glise, bite ak tonbe ak bon abitid.",
    },
  },
  // block-03
  "basic-first-aid": {
    title: { en: "First Aid – Basic", es: "Primeros auxilios – Básico", ht: "Premye swen – Debaz" },
    desc: {
      en: "Basic first aid guidance and response fundamentals.",
      es: "Guía básica de primeros auxilios y fundamentos de respuesta.",
      ht: "Gid debaz pou premye swen ak baz pou reyaji.",
    },
  },
  "back-safety": {
    title: { en: "Back Safety", es: "Seguridad de la espalda", ht: "Sekirite do" },
    desc: {
      en: "Safe lifting practices and back injury prevention.",
      es: "Cómo levantar cargas con seguridad y prevenir lesiones de espalda.",
      ht: "Kijan pou leve chay an sekirite epi evite blese do.",
    },
  },
  "eyewash-and-safety-shower": {
    title: { en: "Eyewash and Safety Shower", es: "Lavaojos y ducha de seguridad", ht: "Lave je ak douch sekirite" },
    desc: {
      en: "When and how to use eyewash and safety shower equipment.",
      es: "Cuándo y cómo usar el lavaojos y la ducha de seguridad.",
      ht: "Kilè ak kijan pou itilize lave je ak douch sekirite.",
    },
  },
  // block-04
  fall_protection: {
    title: { en: "Fall Protection", es: "Protección contra caídas", ht: "Pwoteksyon kont tonbe" },
    desc: {
      en: "Fall Protection (General Industry Awareness).",
      es: "Protección contra caídas (conocimiento general de la industria).",
      ht: "Pwoteksyon kont tonbe (konesans jeneral endistri).",
    },
  },
  "heat-exposure": {
    title: { en: "Heat Exposure", es: "Exposición al calor", ht: "Ekspozisyon nan chalè" },
    desc: {
      en: "Extreme Temperature (Heat) awareness and prevention.",
      es: "Conocimiento y prevención de temperaturas extremas (calor).",
      ht: "Konesans ak prevansyon tanperati ekstrèm (chalè).",
    },
  },
};

/** Display title + topics for a block in `lang` (falls back to the English config). */
export function blockText(block: TrainingBlock, lang: Lang): { title: string; topics: string } {
  const t = BLOCK_TEXT[block.id];
  return {
    title: t?.title[lang] ?? block.titleEn,
    topics: t?.topics[lang] ?? block.topicsEn.replace(/ • /g, " · "),
  };
}

/** Display title + description for a video in `lang` (falls back to the English config). */
export function videoText(video: TrainingVideo, lang: Lang): { title: string; desc: string } {
  const t = VIDEO_TEXT[video.key];
  return { title: t?.title[lang] ?? video.titleEn, desc: t?.desc[lang] ?? video.descEn };
}

/**
 * "YYYY-MM-DD" (an ET calendar date) → localized date, never shifted a day: the date is built at 12:00 UTC (07:00/08:00
 * ET) and formatted in America/New_York, so 2026-11-16 shows as Nov 16 in every browser timezone. `ht` has no ICU data,
 * so Haitian Creole falls back to French month names (closest available).
 */
export function formatYmd(ymd: string, lang: Lang, style: "short" | "long"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const locales = lang === "ht" ? ["ht", "fr"] : lang === "es" ? ["es"] : ["en-US"];
  return new Intl.DateTimeFormat(locales, {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: style === "long" ? "numeric" : undefined,
  }).format(d);
}
