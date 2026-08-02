import { normalizeText, escapeHtml } from "./utils.js";

const DEFAULT_FUEL_NAME = "Gasolina 95 E5";

export function populateFuelSelect(selectEl, productos) {
  selectEl.innerHTML = "";
  const sorted = [...productos].sort((a, b) =>
    a.NombreProducto.localeCompare(b.NombreProducto, "es")
  );
  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = p.IDProducto;
    opt.textContent = p.NombreProducto;
    selectEl.appendChild(opt);
  }
  const def = productos.find((p) => p.NombreProducto === DEFAULT_FUEL_NAME);
  selectEl.value = def ? def.IDProducto : sorted[0]?.IDProducto ?? "";
}

export function populateCcaaSelect(selectEl, ccaaList) {
  const sorted = [...ccaaList].sort((a, b) => a.CCAA.localeCompare(b.CCAA, "es"));
  for (const c of sorted) {
    const opt = document.createElement("option");
    opt.value = c.IDCCAA;
    opt.textContent = c.CCAA;
    selectEl.appendChild(opt);
  }
}

// Rebuilds the province dropdown, keeping only provinces of the given CCAA
// (or all provinces if ccaaId is empty).
export function populateProvinciaSelect(selectEl, provinciasList, ccaaId) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Todas</option>';
  const filtered = provinciasList
    .filter((p) => !ccaaId || p.IDCCAA === ccaaId)
    .sort((a, b) => a.Provincia.localeCompare(b.Provincia, "es"));
  for (const p of filtered) {
    const opt = document.createElement("option");
    opt.value = p.IDPovincia;
    opt.textContent = p.Provincia;
    selectEl.appendChild(opt);
  }
  // keep selection if still valid under the new CCAA, else reset
  if (filtered.some((p) => p.IDPovincia === current)) {
    selectEl.value = current;
  } else {
    selectEl.value = "";
  }
}

// Builds the municipio <datalist> options from the already-loaded station
// data (filtered by CCAA/provincia if set) instead of a second API call.
export function populateMunicipioDatalist(datalistEl, stations, ccaaId, provinciaId) {
  const seen = new Set();
  const names = [];
  for (const s of stations) {
    if (ccaaId && s.idCCAA !== ccaaId) continue;
    if (provinciaId && s.idProvincia !== provinciaId) continue;
    const name = s.municipio;
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  names.sort((a, b) => a.localeCompare(b, "es"));
  datalistEl.innerHTML = names
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
}

// Builds the brand (Rótulo) <datalist> options from the already-loaded
// station data, same approach as the municipio datalist.
// Generic Spanish words that show up as a station name's first word way more
// often than any real brand does ("LA CAÑADA", "ESTACION DE SERVICIO X",
// "COOPERATIVA SAN JOSE"...) — grouping by these would invent fake "brands",
// so they're never used as a group key even if the count threshold is met.
const BRAND_GROUP_STOPWORDS = new Set([
  "ESTACION", "ESTACIO", "GASOLINERA", "GASOLINERAS", "COOPERATIVA", "COOP",
  "CARBURANTES", "GASOLEOS", "GASOLEO", "AREA", "COMBUSTIBLES", "SUMINISTROS",
  "SERVICIOS", "GRUPO", "HERMANOS", "CENTRO", "ZONA", "ES", "EE", "EESS",
  "US", "SCA", "LA", "EL", "LOS", "LAS", "SAN", "SANTA", "DE", "DEL", "GAS",
  "OIL", "FUEL", "PETROL", "RED", "GLOBAL", "NORTE", "SUR", "ESTE", "OESTE",
  "NUEVA", "NUEVO", "AUTOSERVICIO", "SOCIEDAD", "SA", "SL", "SLU",
]);

const BRAND_GROUP_MIN_SIZE = 4;

function brandGroupCandidateKey(rotulo) {
  const firstWord = rotulo.trim().split(/\s+/)[0];
  const cleaned = normalizeText(firstWord).replace(/[^a-z0-9]/g, "").toUpperCase();
  if (cleaned.length < 3 || BRAND_GROUP_STOPWORDS.has(cleaned)) return null;
  return cleaned;
}

// Longest shared leading run of whole words across a brand family, e.g. "LOW
// COST FUEL OIL" / "LOW COST VALLELADO" / "LOW COST" -> "LOW COST" (not just
// the first-word bucket key "LOW").
function cleanWord(w) {
  return w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toUpperCase();
}

function commonWordPrefix(names) {
  const wordLists = names.map((n) => n.trim().split(/\s+/));
  const minLen = Math.min(...wordLists.map((w) => w.length));
  const prefix = [];
  for (let i = 0; i < minLen; i++) {
    const word = cleanWord(wordLists[0][i]);
    if (!word) break;
    if (wordLists.every((w) => cleanWord(w[i]) === word)) {
      prefix.push(word);
    } else {
      break;
    }
  }
  return prefix.join(" ");
}

// Brands with many location-suffixed station names (e.g. "BP ROMICA", "BP
// OJEN", 500+ of these) get collapsed into a single suggestion ("BP")
// instead of cluttering the list with every location. Names with nothing
// in common with >=4 siblings are left exactly as they are.
export function populateRotuloDatalist(datalistEl, stations) {
  const uniqueNames = new Set();
  for (const s of stations) {
    const name = s.rotulo?.trim();
    if (name) uniqueNames.add(name);
  }

  const buckets = new Map();
  for (const name of uniqueNames) {
    const key = brandGroupCandidateKey(name);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(name);
  }

  const groupLabelByName = new Map();
  for (const members of buckets.values()) {
    if (members.length < BRAND_GROUP_MIN_SIZE) continue;
    const label = commonWordPrefix(members);
    if (label.length < 2) continue; // no clean shared text (e.g. "E.LECLERC" vs "E-LECLERC")

    // Never suggest a label that wouldn't actually match all its own
    // members through the app's real (punctuation-preserving) search match.
    const normalizedLabel = normalizeText(label);
    const allMatch = members.every((m) => normalizeText(m).includes(normalizedLabel));
    if (!allMatch) continue;

    for (const name of members) groupLabelByName.set(name, label);
  }

  const options = new Set();
  for (const name of uniqueNames) {
    options.add(groupLabelByName.get(name) ?? name);
  }

  const sorted = [...options].sort((a, b) => a.localeCompare(b, "es"));
  datalistEl.innerHTML = sorted
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
}

export function readFilters(els) {
  return {
    fuelId: els.fuel.value || "",
    ccaaId: els.ccaa.value || "",
    provinciaId: els.provincia.value || "",
    municipio: els.municipio.value.trim(),
    priceMin: els.priceMin.value === "" ? null : Number(els.priceMin.value),
    priceMax: els.priceMax.value === "" ? null : Number(els.priceMax.value),
    search: els.search.value.trim(),
  };
}

export function applyFilters(stations, filters) {
  const municipioQuery = filters.municipio ? normalizeText(filters.municipio) : "";
  const searchQuery = filters.search ? normalizeText(filters.search) : "";

  return stations.filter((s) => {
    if (filters.fuelId && s.prices[filters.fuelId] == null) return false;
    if (filters.ccaaId && s.idCCAA !== filters.ccaaId) return false;
    if (filters.provinciaId && s.idProvincia !== filters.provinciaId) return false;

    if (municipioQuery && !normalizeText(s.municipio).includes(municipioQuery)) {
      return false;
    }

    if (filters.fuelId && (filters.priceMin != null || filters.priceMax != null)) {
      const price = s.prices[filters.fuelId];
      if (filters.priceMin != null && price < filters.priceMin) return false;
      if (filters.priceMax != null && price > filters.priceMax) return false;
    }

    if (searchQuery && !normalizeText(s.rotulo).includes(searchQuery)) {
      return false;
    }

    return true;
  });
}
