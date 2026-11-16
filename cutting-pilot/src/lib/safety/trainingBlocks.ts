// src/lib/safety/trainingBlocks.ts
// saf-01: the safety training block list (pure data + helpers, no DB). Titles, topics, minutes, video titles and
// descriptions are copied verbatim from the legacy pages (safety/training/index.html + block-0N.html); video order
// follows each page's setMedia(...) calls. Blocks 05–09 are listed but not ready (no videos yet; legacy shows them
// as "Work in Progress"). English strings here are for CSV/logs; saf-02 adds the en/es/ht display strings.

export interface TrainingVideo {
  key: string; // media base name (legacy setMedia's 3rd argument)
  file: string; // "<key>.mp4"
  titleEn: string;
  descEn: string;
}

export interface TrainingBlock {
  id: string; // "block-01"
  n: string; // "01"
  folder: string; // R2 folder under TRAINING_MEDIA_BASE ("" until the block has videos)
  minutes: number;
  ready: boolean;
  titleEn: string;
  topicsEn: string;
  videos: TrainingVideo[];
}

export const TRAINING_MEDIA_BASE = "https://pub-6fa76f0673dd4d7190bb9f79bb59b77d.r2.dev/training-media";
export const TRAINING_POSTER = "/assets/img/training-video-poster.png";

const v = (key: string, titleEn: string, descEn: string): TrainingVideo => ({ key, file: `${key}.mp4`, titleEn, descEn });

export const TRAINING_BLOCKS: TrainingBlock[] = [
  {
    id: "block-01", n: "01", folder: "block-01-new-hire-core", minutes: 47, ready: true,
    titleEn: "New Hire Core Orientation",
    topicsEn: "General Safety Orientation • PPE • Hearing Protection • Workers’ Comp (Non-CA)",
    videos: [
      v("general-safety-orientation", "General Safety Orientation", "Baseline safety orientation for new hires."),
      v("personal-protective-equipment", "Personal Protective Equipment", "PPE expectations and required usage."),
      v("hearing-protection", "Hearing Protection", "Hearing protection requirements and best practices."),
      v("peo-workers-comp-non-ca", "PEO Workers Comp (Non-CA)", "Workers comp guidance for non-California context."),
    ],
  },
  {
    id: "block-02", n: "02", folder: "block-02-walking-lockout", minutes: 47, ready: true,
    titleEn: "Walking, Slips and Lockout",
    topicsEn: "Slips/Trips/Falls • Walking-Working Surfaces • Machine Guarding • Lockout/Tagout",
    videos: [
      v("lockout-tagout", "Lockout Tagout", "Core LOTO concepts and expectations for safe work."),
      v("machine-guarding", "Machine Guarding", "Machine guarding basics and safe operation reminders."),
      v("walking-working-surfaces", "Walking-Working Surfaces", "Walkway safety, trip hazards, housekeeping, and awareness."),
      v("slips-trips-falls", "Slips, Trips, and Falls", "Preventing slip/trip/fall incidents with practical habits."),
    ],
  },
  {
    id: "block-03", n: "03", folder: "block-03-physical-injury", minutes: 43, ready: true,
    titleEn: "Physical Injury and First Response",
    topicsEn: "First Aid (Basic) • Back Safety • Eyewash and Safety Shower",
    videos: [
      v("basic-first-aid", "First Aid – Basic", "Basic first aid guidance and response fundamentals."),
      v("back-safety", "Back Safety", "Safe lifting practices and back injury prevention."),
      v("eyewash-and-safety-shower", "Eyewash and Safety Shower", "When and how to use eyewash and safety shower equipment."),
    ],
  },
  {
    id: "block-04", n: "04", folder: "block-04-fall-heat-exposure", minutes: 26, ready: true,
    titleEn: "Fall Protection and Heat Exposure",
    topicsEn: "Fall Protection (General Industry Awareness) • Extreme Temperature (Heat)",
    videos: [
      v("fall_protection", "Fall Protection", "Fall Protection (General Industry Awareness)."),
      v("heat-exposure", "Heat Exposure", "Extreme Temperature (Heat) awareness and prevention."),
    ],
  },
  {
    id: "block-05", n: "05", folder: "", minutes: 47, ready: false,
    titleEn: "Fire, Chemicals and Containers",
    topicsEn: "Fire Extinguisher • Hazard Communication • Flammable Liquids (Container Storage)",
    videos: [],
  },
  {
    id: "block-06", n: "06", folder: "", minutes: 41, ready: false,
    titleEn: "Electrical and Power Tools",
    topicsEn: "Electrical Safety • Hand and Portable Power Tools",
    videos: [],
  },
  {
    id: "block-07", n: "07", folder: "", minutes: 47, ready: false,
    titleEn: "Gas, Ladders and Respiratory Equipment",
    topicsEn: "Compressed Gas • Ladder Safety • Respirators (FFP) • Respirators (Air Purifying)",
    videos: [],
  },
  {
    id: "block-08", n: "08", folder: "", minutes: 29, ready: false,
    titleEn: "Powered Industrial Equipment",
    topicsEn: "Forklift • Safe Driving",
    videos: [],
  },
  {
    // legacy card: "approx. 26 minutes"
    id: "block-09", n: "09", folder: "", minutes: 26, ready: false,
    titleEn: "Incident Response and Conduct",
    topicsEn: "Accident Reporting • Workplace Violence • Emergency Action Plan (in progress)",
    videos: [],
  },
];

/** Same URLs legacy setMedia(idPrefix, blockFolder, baseName) builds. */
export function mediaUrls(block: TrainingBlock, video: TrainingVideo): { mp4: string; vttEs: string; vttHt: string } {
  const base = `${TRAINING_MEDIA_BASE}/${block.folder}/${video.key}`;
  return { mp4: `${base}.mp4`, vttEs: `${base}-es.vtt`, vttHt: `${base}-ht.vtt` };
}

export function readyBlocks(): TrainingBlock[] {
  return TRAINING_BLOCKS.filter((b) => b.ready);
}

export function getBlock(id: string): TrainingBlock | undefined {
  return TRAINING_BLOCKS.find((b) => b.id === id);
}
