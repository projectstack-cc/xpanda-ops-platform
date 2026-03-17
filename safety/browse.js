const libraryEl = document.getElementById("library");
const azEl = document.getElementById("az");

if (!libraryEl) console.error("Missing #library container in sds.html");
if (!azEl) console.error("Missing #az container in sds.html");

// Turn "Gorilla Glue" into "m-gorilla-glue"
function makeId(manufacturer) {
  return "m-" + (manufacturer || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function groupByManufacturer(files) {
  const grouped = {};
  for (const file of files) {
    const m = file.manufacturer || "Unknown";
    if (!grouped[m]) grouped[m] = [];
    grouped[m].push(file);
  }
  return grouped;
}

function buildAZ(manufacturers) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  // Which letters exist?
  const present = new Set(
    manufacturers.map(m => {
      const first = (m[0] || "#").toUpperCase();
      return /[A-Z]/.test(first) ? first : "#";
    })
  );

  azEl.innerHTML = "";

  // A-Z
  for (const L of letters) {
    if (present.has(L)) {
      const a = document.createElement("a");
      a.href = `#letter-${L}`;
      a.textContent = L;
      azEl.appendChild(a);
    } else {
      const s = document.createElement("span");
      s.textContent = L;
      azEl.appendChild(s);
    }
  }

  // # bucket at end
  if (present.has("#")) {
    const a = document.createElement("a");
    a.href = `#letter-OTHER`;
    a.textContent = "#";
    azEl.appendChild(a);
  }
}

function renderLibrary() {
  if (typeof FILES === "undefined") {
    console.error("FILES array not found (did search.js load first?)");
    return;
  }

  libraryEl.innerHTML = "";

  const grouped = groupByManufacturer(FILES);

  // Sorted manufacturer list
  const manufacturers = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  // Build the A-Z bar (anchors jump to letter headers)
  buildAZ(manufacturers);

  // Bucket manufacturers by first letter
  const buckets = {}; // { "A": ["Amazon", ...], "B": [...], "OTHER": [...] }

  for (const m of manufacturers) {
    const first = (m[0] || "#").toUpperCase();
    const key = /[A-Z]/.test(first) ? first : "OTHER";
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(m);
  }

  // Order of letter sections
  const bucketKeys = Object.keys(buckets).sort((a, b) => {
    if (a === "OTHER") return 1;
    if (b === "OTHER") return -1;
    return a.localeCompare(b);
  });

  for (const letter of bucketKeys) {
    // Letter heading anchor target
    const letterHeading = document.createElement("h2");
    letterHeading.id = letter === "OTHER" ? "letter-OTHER" : `letter-${letter}`;
    letterHeading.textContent = letter === "OTHER" ? "#" : letter;
    libraryEl.appendChild(letterHeading);

    for (const manufacturer of buckets[letter]) {
      const manuHeading = document.createElement("h3");
      manuHeading.id = makeId(manufacturer);
      manuHeading.style.marginTop = "18px";
      manuHeading.textContent = manufacturer;
      libraryEl.appendChild(manuHeading);

      const items = grouped[manufacturer].sort((a, b) =>
        (a.product || "").localeCompare(b.product || "")
      );

      for (const item of items) {
        const div = document.createElement("div");
        div.className = "entry";

        div.innerHTML = `
          ${item.product}
          <div style="font-size:13px;color:#666;">
            SDS • ${item.year}
          </div>
          <div style="margin-top:6px;">
            <a href="${item.path}" target="_blank" rel="noopener">Open PDF</a>
          </div>
        `;

        libraryEl.appendChild(div);
      }
    }
  }
}

renderLibrary();
