const FILES = [
  { manufacturer: "3M", product: "Holdfast 70", year: "2025", path: "pdfs/3M/3M-Holdfast-70-SDS-2025.pdf" },

  { manufacturer: "Absorbs-It", product: "Spill Clean", year: "2015", path: "pdfs/Absorbs-It/Absorbs-It-Spill-Clean-SDS-2015.pdf" },

  { manufacturer: "Amazon", product: "Hand Sanitizer", year: "2019", path: "pdfs/Amazon/Amazon-Hand-Sanitizer-SDS-2019.pdf" },

  { manufacturer: "Diamond Crystal", product: "Bright Soft Salt Pellets", year: "2014", path: "pdfs/Diamond Crystal/Diamond-Crystal-Bright-Soft-Salt-Pellets-SDS-2014.pdf" },

  { manufacturer: "Ecolab", product: "Industrial Degreaser", year: "2025", path: "pdfs/Ecolab/Ecolab-Industrial-Degreaser-SDS-2025.pdf" },

  { manufacturer: "Epsilyte", product: "S5454", year: "2020", path: "pdfs/Epsilyte/Epsilyte-S5454-SDS-2020.pdf" },

  { manufacturer: "Foam Blaster", product: "Coil Cleaner", year: "2020", path: "pdfs/Foam Blaster/Foam-Blaster-Coil-Cleaner-SDS-2020.pdf" },

  { manufacturer: "Gorilla Glue", product: "Spray Adhesive", year: "2023", path: "pdfs/Gorilla Glue/Gorilla-Glue-Spray-Adhesive-SDS-2023.pdf" },
  { manufacturer: "Gorilla Glue", product: "Super Glue", year: "2020", path: "pdfs/Gorilla Glue/Gorilla-Glue-Super-Glue-SDS-2020.pdf" },

  { manufacturer: "Ingersoll Rand", product: "Ultra Coolant", year: "2015", path: "pdfs/Ingersoll Rand/Ingersoll-Rand-Ultra-Coolant-SDS-2015.pdf" },
  { manufacturer: "Ingersoll Rand", product: "Ultra Coolant Synthetic Oil", year: "2021", path: "pdfs/Ingersoll Rand/Ingersoll-Rand-Ultra-Coolant-Synthetic-Oil-SDS-2021.pdf" },

  { manufacturer: "Lucas Oil Products", product: "Red Tacky Grease NLGI 2", year: "2014", path: "pdfs/Lucas Oil Products/Lucas-Oil-Red-Tacky-Grease-NLGI-2-SDS-2014.pdf" },

  { manufacturer: "O_Reilly", product: "Premium ATF", year: "2021", path: "pdfs/O_Reilly/OReilly-Premium-ATF-SDS-2021.pdf" },

  { manufacturer: "Oatey", product: "CPVC Medium Orange / All Weather Medium Yellow", year: "2024", path: "pdfs/Oatey/Oatey-CPVC-Medium-Orange-All-Weather-Medium-Yellow-SDS-2024.pdf" },
  { manufacturer: "Oatey", product: "Purple Primer / Clear Primer", year: "2023", path: "pdfs/Oatey/Oatey-Purple-Primer-Clear-Primer-SDS-2023.pdf" },

  { manufacturer: "Pennzoil", product: "Platinum High Mileage 0W-20", year: "2016", path: "pdfs/Pennzoil/Pennzoil-Platinum-High-Mileage-0W-20-SDS-2016.pdf" },

  { manufacturer: "Purple Power", product: "Concentrated Degreaser", year: "2024", path: "pdfs/Purple Power/Purple-Power-Concentrated-Degreaser-SDS-2024.pdf" },

  { manufacturer: "Rust-Oleum", product: "Automotive Primer Rusty Metal Light Gray", year: "2022", path: "pdfs/Rust-oleum/Rust-Oleum-Automotive-Primer-Rusty-Metal-Light-Gray-SDS-2022.pdf" },
  { manufacturer: "Rust-Oleum", product: "Cold Galvanizing Compound Spray", year: "2023", path: "pdfs/Rust-oleum/Rust-Oleum-Cold-Galvanizing-Compound-Spray-SDS-2023.pdf" },
  { manufacturer: "Rust-Oleum", product: "Striping Paint Yellow", year: "2025", path: "pdfs/Rust-oleum/Rust-Oleum-Striping-Paint-Yellow-SDS-2025.pdf" },

  { manufacturer: "Scott", product: "Foam Skin Cleanser with Moisturizer", year: "2018", path: "pdfs/Scott/Scott-Foam-Skin-Cleanser-with-Moisturizer-SDS-2018.pdf" },

  { manufacturer: "Spears Manufacturing", product: "PVC 17 Gray", year: "2023", path: "pdfs/Spears Manufacturing/Spears-PVC-17-Gray-2023.pdf" },
  { manufacturer: "Spears Manufacturing", product: "Primer 21-68 Purple Primer", year: "2021", path: "pdfs/Spears Manufacturing/Spears-Primer-21-68-Purple-Primer-SDS-2021.pdf" },

  { manufacturer: "STA PUT", product: "Ultra Plumbers Putty", year: "2021", path: "pdfs/STA PUT/StaPut-Ultra-Plumbers-Putty-SDS-2021.pdf" },

  { manufacturer: "State Industrial", product: "State Triple Quick Cleaner", year: "2025", path: "pdfs/State Industrial/State-Industrial-State-Triple-Quick-Cleaner-SDS-2025.pdf" },

  { manufacturer: "Styropek", product: "BF295", year: "2025", path: "pdfs/Styropek/Styropek-BF295-SDS-2025.pdf" },

  { manufacturer: "SuperS", product: "AW68 Hydraulic Oil", year: "2009", path: "pdfs/SuperS/SuperS-AW68-Hydraulic-Oil-SDS-2009.pdf" },

  { manufacturer: "Terro", product: "Liquid Ant Bait", year: "2015", path: "pdfs/Terro/Terro-Liquid-Ant-Bait-SDS-2015.pdf" },

  { manufacturer: "Urnex", product: "Rinza Milk Frother Cleaner", year: "2018", path: "pdfs/Urnex/Urnex-Rinza-Milk-Frother-Cleaner-SDS-2018.pdf" },

  { manufacturer: "Valvoline", product: "SAE 80W-90 High Performance Gear Oil", year: "2025", path: "pdfs/Valvoline/Valvoline-SAE-80W-90-High-Performance-Gear-Oil-SDS-2025.pdf" },

  { manufacturer: "Water Sciences", product: "204", year: "2016", path: "pdfs/Water Sciences/Water-Sciences-204-SDS-2016.pdf" },
  { manufacturer: "Water Sciences", product: "410", year: "2016", path: "pdfs/Water Sciences/Water-Sciences-410-SDS-2016.pdf" },
  { manufacturer: "Water Sciences", product: "6502", year: "2016", path: "pdfs/Water Sciences/Water-Sciences-6502-SDS-2016.pdf" },
  { manufacturer: "Water Sciences", product: "HL2", year: "2025", path: "pdfs/Water Sciences/Water-Sciences-HL2-SDS-2025.pdf" },
  { manufacturer: "Water Sciences", product: "HP3", year: "2021", path: "pdfs/Water Sciences/Water-Sciences-HP3-SDS-2021.pdf" },
  { manufacturer: "Water Sciences", product: "HR477", year: "2024", path: "pdfs/Water Sciences/Water-Sciences-HR477-SDS-2024.pdf" },
  { manufacturer: "Water Sciences", product: "HR513", year: "2024", path: "pdfs/Water Sciences/Water-Sciences-HR513-SDS-2024.pdf" },
  { manufacturer: "Water Sciences", product: "HR530", year: "2024", path: "pdfs/Water Sciences/Water-Sciences-HR530-SDS-2024.pdf" },

  { manufacturer: "Weld-On", product: "700 Clear", year: "2022", path: "pdfs/Weld-On/WELD-ON-700-CLEAR-SDS-2022.pdf" },

  { manufacturer: "Wilko Paint", product: "Mod Sil Blue Metallic Hi Heat", year: "2003", path: "pdfs/Wilko Paint/Wilko-Paint-Mod-Sil-Blue-Metallic-Hi-Heat-SDS-2003.pdf" }
];

const inputEl = document.getElementById("search");
const resultsEl = document.getElementById("results");

// Safety check: if these are null, your index.html IDs don't match.
if (!inputEl || !resultsEl) {
  console.error("Missing #search input or #results container in index.html");
}

// Normalize text for matching (case-insensitive, ignore punctuation-ish)
function norm(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/['"]/g, "")          // remove quotes/apostrophes
    .replace(/[^a-z0-9]+/g, " ")   // keep letters/numbers, convert others to spaces
    .trim();
}

// Render results list
function renderResults(items) {
  resultsEl.innerHTML = "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No matches. Try fewer words (e.g., “3M”, “Cleaner”, “Oil”).";
    resultsEl.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");

    const title = document.createElement("div");
    title.style.fontWeight = "bold";
    title.textContent = `${item.manufacturer} — ${item.product}`;

    const meta = document.createElement("div");
    meta.style.fontSize = "13px";
    meta.style.color = "#666";
    meta.textContent = item.year ? `SDS • ${item.year}` : "SDS";

    const link = document.createElement("a");
    link.href = item.path;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open PDF";

    const linkWrap = document.createElement("div");
    linkWrap.style.marginTop = "6px";
    linkWrap.appendChild(link);

    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(linkWrap);

    resultsEl.appendChild(li);
  }
}

// Search: match against manufacturer + product + year + path
function search(termRaw) {
  const term = norm(termRaw);

  if (!term) {
    resultsEl.innerHTML = "";
    return;
  }

  const tokens = term.split(/\s+/).filter(Boolean);

  const scored = FILES.map((item) => {
    const haystack = norm(
      `${item.manufacturer} ${item.product} ${item.year || ""} ${item.path}`
    );

    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
    }

    // small boost if manufacturer starts with the typed term
    if (norm(item.manufacturer).startsWith(term)) score += 1;

    return { item, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);

  renderResults(scored);
}

// Wire it up: search as you type
inputEl?.addEventListener("input", (e) => search(e.target.value));

// Optional: ESC clears quickly
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    inputEl.value = "";
    resultsEl.innerHTML = "";
    inputEl.blur();
  }
});