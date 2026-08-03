import {
  loadLookups,
  fetchStationsByProduct,
  normalizeStationForProduct,
  fetchStationsByProvincia,
  normalizeFullStation,
  fetchHistoricalStationsByProduct,
  NON_LAND_PRODUCT_IDS,
} from "./api.js";
import { initMap, renderStations, buildPopupHtml, getStationMarker } from "./map.js";
import {
  populateFuelSelect,
  populateCcaaSelect,
  populateProvinciaSelect,
  populateMunicipioDatalist,
  populateRotuloDatalist,
  readFilters,
  applyFilters,
} from "./filters.js";
import {
  debounce,
  escapeHtml,
  formatPrice,
  formatDateDDMMYYYY,
  parseEsNumber,
  runWithConcurrency,
} from "./utils.js";
import { renderPriceHistoryChart } from "./chart.js";

const els = {
  fuel: document.getElementById("f-fuel"),
  ccaa: document.getElementById("f-ccaa"),
  provincia: document.getElementById("f-provincia"),
  municipio: document.getElementById("f-municipio"),
  municipioList: document.getElementById("municipio-list"),
  rotuloList: document.getElementById("rotulo-list"),
  priceMin: document.getElementById("f-price-min"),
  priceMax: document.getElementById("f-price-max"),
  search: document.getElementById("f-search"),
  geoloc: document.getElementById("f-geoloc"),
  reset: document.getElementById("f-reset"),
  cheapestBox: document.getElementById("cheapest-box"),
  legendMin: document.getElementById("legend-min"),
  legendMax: document.getElementById("legend-max"),
  resultCount: document.getElementById("result-count"),
  lastUpdate: document.getElementById("last-update"),
  refreshBtn: document.getElementById("refresh-btn"),
  loadingOverlay: document.getElementById("loading-overlay"),
  sidebar: document.getElementById("sidebar"),
  historyToggle: document.getElementById("history-toggle"),
  historyPanel: document.getElementById("history-panel"),
  historyRange7: document.getElementById("history-range-7"),
  historyRange30: document.getElementById("history-range-30"),
  historyChart: document.getElementById("history-chart"),
  historyStatus: document.getElementById("history-status"),
};

let productos = [];
let validProductos = []; // land-station fuels only, used for the filter dropdown + popups
let ccaaList = [];
let provinciasList = [];

// Stations accumulate here as fuels get fetched. Keyed by IDEESS so prices
// from different fuel fetches merge onto the same station record instead of
// creating duplicates.
const stationsById = new Map();
const loadedProductIds = new Set();
let lastFecha = "";

// Province full-fuel-list cache, fetched on demand when a station's popup
// opens (region-scoped endpoints return every fuel per station, unlike
// FiltroProducto). provinceLoadPromises dedupes concurrent opens.
const loadedProvinceIds = new Set();
const provinceLoadPromises = new Map();

let map = null;
let clusterGroup = null;
let lastFiltered = [];
let lastFuelId = "";

// Historical average-price chart state. Cached per "fuelId:rangeDays" so
// toggling the range back and forth, or reopening the panel, doesn't refetch.
const HISTORY_CONCURRENCY = 6;
const historyCache = new Map();
let historyRangeDays = 7;
let historyPanelOpen = false;

function setLoading(isLoading) {
  els.loadingOverlay.classList.toggle("hidden", !isLoading);
}

function formatFecha(fecha) {
  if (!fecha) return "";
  const [datePart, timePart] = fecha.split(" ");
  return `Actualizado ${datePart} ${timePart?.slice(0, 5) ?? ""}`;
}

function currentStations() {
  return Array.from(stationsById.values());
}

// Fetches one fuel's nationwide station list and merges it into the shared
// station cache. No-ops if that fuel was already fetched this session.
async function ensureProductLoaded(productId) {
  if (!productId || loadedProductIds.has(productId)) return;

  setLoading(true);
  try {
    const res = await fetchStationsByProduct(productId);
    lastFecha = res.Fecha;
    for (const raw of res.ListaEESSPrecio) {
      const parsed = normalizeStationForProduct(raw);
      if (parsed.lat == null || parsed.lon == null) continue;

      let station = stationsById.get(parsed.id);
      if (!station) {
        station = { ...parsed, prices: {} };
        delete station.price;
        stationsById.set(parsed.id, station);
      }
      if (parsed.price != null) {
        station.prices[productId] = parsed.price;
      }
    }
    loadedProductIds.add(productId);
    els.lastUpdate.textContent = formatFecha(lastFecha);
  } finally {
    setLoading(false);
  }
}

// Fetches every fuel for every station in a province in one call and merges
// it into the shared cache — used so clicking one station can show all of
// its fuels without having fetched each fuel type nationwide beforehand.
function ensureProvinceLoaded(idProvincia) {
  if (!idProvincia || loadedProvinceIds.has(idProvincia)) return Promise.resolve();
  if (provinceLoadPromises.has(idProvincia)) return provinceLoadPromises.get(idProvincia);

  const promise = (async () => {
    const res = await fetchStationsByProvincia(idProvincia);
    for (const raw of res.ListaEESSPrecio) {
      const parsed = normalizeFullStation(raw);
      if (parsed.lat == null || parsed.lon == null) continue;

      const station = stationsById.get(parsed.id);
      if (!station) {
        stationsById.set(parsed.id, parsed);
      } else {
        Object.assign(station.prices, parsed.prices);
      }
    }
    loadedProvinceIds.add(idProvincia);
  })();

  provinceLoadPromises.set(idProvincia, promise);
  return promise;
}

// Fetches one day's nationwide average price for a fuel (undocumented
// EstacionesTerrestresHist endpoint — archive only covers up to yesterday,
// today isn't finalized yet).
async function fetchDailyAverage(fuelId, date) {
  const res = await fetchHistoricalStationsByProduct(formatDateDDMMYYYY(date), fuelId);
  const prices = res.ListaEESSPrecio.map((raw) => parseEsNumber(raw.PrecioProducto)).filter(
    (p) => p != null
  );
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  return { date, avg };
}

// Fetches the last `rangeDays` days (ending yesterday) of nationwide average
// price for a fuel, in parallel with bounded concurrency. Cached per
// fuel+range so switching back and forth is instant after the first fetch.
function loadPriceHistory(fuelId, rangeDays) {
  const cacheKey = `${fuelId}:${rangeDays}`;
  if (historyCache.has(cacheKey)) return historyCache.get(cacheKey);

  const promise = (async () => {
    const days = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 1 - (rangeDays - 1 - i));
      return d;
    });

    const points = new Array(days.length);
    await runWithConcurrency(days, HISTORY_CONCURRENCY, async (day, idx) => {
      try {
        points[idx] = await fetchDailyAverage(fuelId, day);
      } catch (err) {
        console.error(`Fallo al cargar histórico de ${formatDateDDMMYYYY(day)}:`, err);
        points[idx] = { date: day, avg: null };
      }
    });
    return points;
  })();

  historyCache.set(cacheKey, promise);
  return promise;
}

async function refreshHistoryChart() {
  if (!historyPanelOpen) return;
  const fuelId = els.fuel.value;
  if (!fuelId) return;

  els.historyStatus.textContent = "Cargando histórico…";
  try {
    const points = await loadPriceHistory(fuelId, historyRangeDays);
    renderPriceHistoryChart(els.historyChart, points);
    els.historyStatus.textContent = "";
  } catch (err) {
    els.historyStatus.textContent = "No se pudo cargar el histórico.";
    console.error(err);
  }
}

function getStationStatus(station) {
  return loadedProvinceIds.has(station.idProvincia) ? "complete" : "loading";
}

async function onMarkerPopupOpen(station, marker) {
  if (loadedProvinceIds.has(station.idProvincia)) return;
  await ensureProvinceLoaded(station.idProvincia);
  marker.setPopupContent(buildPopupHtml(station, validProductos, lastFuelId, "complete"));
}

function refreshMunicipioOptions() {
  populateMunicipioDatalist(
    els.municipioList,
    currentStations(),
    els.ccaa.value,
    els.provincia.value
  );
}

// Brand suggestions are scoped to whatever the map is currently showing —
// every active filter applies except the search text itself (so typing
// doesn't shrink its own suggestion list).
function refreshRotuloOptions() {
  const filters = readFilters(els);
  const visible = applyFilters(currentStations(), { ...filters, search: "" });
  populateRotuloDatalist(els.rotuloList, visible);
}

async function runFilters() {
  const filters = readFilters(els);
  if (filters.fuelId) {
    await ensureProductLoaded(filters.fuelId);
  }

  const filtered = applyFilters(currentStations(), filters);
  lastFiltered = filtered;
  lastFuelId = filters.fuelId;

  const { min, max } = renderStations(
    clusterGroup,
    filtered,
    validProductos,
    filters.fuelId,
    getStationStatus,
    onMarkerPopupOpen
  );

  els.resultCount.textContent = `${filtered.length.toLocaleString("es")} estaciones`;
  els.legendMin.textContent = min != null ? formatPrice(min) : "";
  els.legendMax.textContent = max != null ? formatPrice(max) : "";

  updateCheapestBox();
  refreshMunicipioOptions();
  refreshRotuloOptions();
}

// Restricted to stations currently within the map's viewport — "cheapest"
// should point at a dot the user can actually see, not one off-screen.
function updateCheapestBox() {
  if (!lastFuelId) {
    els.cheapestBox.innerHTML = "";
    return;
  }
  const bounds = map.getBounds();
  let cheapest = null;
  for (const s of lastFiltered) {
    if (!bounds.contains([s.lat, s.lon])) continue;
    const price = s.prices[lastFuelId];
    if (price != null && (cheapest == null || price < cheapest.prices[lastFuelId])) {
      cheapest = s;
    }
  }
  if (!cheapest) {
    els.cheapestBox.innerHTML = "Sin resultados visibles en el mapa.";
    return;
  }
  els.cheapestBox.innerHTML = `Más barata (en el mapa): <b>${escapeHtml(
    cheapest.rotulo
  )}</b><br>${formatPrice(cheapest.prices[lastFuelId])} · ${escapeHtml(cheapest.municipio)}`;
  els.cheapestBox.style.cursor = "pointer";
  els.cheapestBox.onclick = () => {
    map.flyTo([cheapest.lat, cheapest.lon], 15, { duration: 0.6 });
    map.once("moveend", () => {
      getStationMarker(cheapest.id)?.openPopup();
    });
  };
}

function wireEvents() {
  els.fuel.addEventListener("change", () => {
    runFilters();
    refreshHistoryChart();
  });

  els.ccaa.addEventListener("change", () => {
    populateProvinciaSelect(els.provincia, provinciasList, els.ccaa.value);
    els.municipio.value = "";
    runFilters();
  });

  els.provincia.addEventListener("change", () => {
    els.municipio.value = "";
    runFilters();
  });

  const debouncedRun = debounce(runFilters, 250);
  els.municipio.addEventListener("input", debouncedRun);
  els.priceMin.addEventListener("input", debouncedRun);
  els.priceMax.addEventListener("input", debouncedRun);
  els.search.addEventListener("input", debouncedRun);

  els.reset.addEventListener("click", () => {
    els.ccaa.value = "";
    populateProvinciaSelect(els.provincia, provinciasList, "");
    els.municipio.value = "";
    els.priceMin.value = "";
    els.priceMax.value = "";
    els.search.value = "";
    runFilters();
  });

  els.geoloc.addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo([pos.coords.latitude, pos.coords.longitude], 13, { duration: 0.6 });
      },
      () => {
        els.cheapestBox.textContent = "No se pudo obtener tu ubicación.";
      }
    );
  });

  els.refreshBtn.addEventListener("click", () => {
    stationsById.clear();
    loadedProductIds.clear();
    runFilters();
  });

  els.historyToggle.addEventListener("click", () => {
    historyPanelOpen = !historyPanelOpen;
    els.historyPanel.classList.toggle("hidden", !historyPanelOpen);
    els.historyToggle.setAttribute("aria-expanded", String(historyPanelOpen));
    if (historyPanelOpen) refreshHistoryChart();
  });

  const setHistoryRange = (days) => {
    historyRangeDays = days;
    els.historyRange7.classList.toggle("active", days === 7);
    els.historyRange30.classList.toggle("active", days === 30);
    refreshHistoryChart();
  };
  els.historyRange7.addEventListener("click", () => setHistoryRange(7));
  els.historyRange30.addEventListener("click", () => setHistoryRange(30));
}

// Reads ?municipio=Madrid from the URL — lets the "Gasolina barata en <ciudad>"
// links in the SEO content section land on a page already filtered to that
// city instead of just a bare map.
function readUrlMunicipio() {
  return new URLSearchParams(location.search).get("municipio")?.trim() || "";
}

async function bootstrap() {
  setLoading(true);
  try {
    const lookups = await loadLookups();
    productos = lookups.productos;
    validProductos = productos.filter((p) => !NON_LAND_PRODUCT_IDS.has(String(p.IDProducto)));
    ccaaList = lookups.ccaa;
    provinciasList = lookups.provincias;

    populateFuelSelect(els.fuel, validProductos);
    populateCcaaSelect(els.ccaa, ccaaList);
    populateProvinciaSelect(els.provincia, provinciasList, "");

    const urlMunicipio = readUrlMunicipio();
    if (urlMunicipio) els.municipio.value = urlMunicipio;

    await runFilters();

    if (urlMunicipio && lastFiltered.length) {
      const first = lastFiltered[0];
      map.setView([first.lat, first.lon], 13);
    }
  } catch (err) {
    els.resultCount.textContent = "Error al cargar datos";
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// Centers the map on the user's location on first load, if they grant
// permission; silently keeps the nationwide default view otherwise. Skipped
// when a ?municipio= link already asked for a specific city.
function tryInitialGeolocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 13);
    },
    () => {},
    { timeout: 8000 }
  );
}

function main() {
  const initialized = initMap();
  map = initialized.map;
  clusterGroup = initialized.clusterGroup;
  map.on("moveend", () => updateCheapestBox());
  wireEvents();
  if (!readUrlMunicipio()) tryInitialGeolocate();
  bootstrap();
}

main();
