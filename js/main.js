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
  haversineKm,
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
  nearestBox: document.getElementById("nearest-box"),
  legendMin: document.getElementById("legend-min"),
  legendMax: document.getElementById("legend-max"),
  resultCount: document.getElementById("result-count"),
  lastUpdate: document.getElementById("last-update"),
  refreshBtn: document.getElementById("refresh-btn"),
  loadingOverlay: document.getElementById("loading-overlay"),
  fuelLoadingIndicator: document.getElementById("fuel-loading-indicator"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebar-toggle"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  errorBanner: document.getElementById("error-banner"),
  errorBannerText: document.getElementById("error-banner-text"),
  errorBannerRetry: document.getElementById("error-banner-retry"),
  emptyState: document.getElementById("empty-state"),
  emptyStateReset: document.getElementById("empty-state-reset"),
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

// Last successful geolocation fix, used to keep the "nearest station" box in
// sync as the user changes fuel/filters after granting location access.
let lastGeoPos = null;

// Historical average-price chart state. Cached per "fuelId:rangeDays" so
// toggling the range back and forth, or reopening the panel, doesn't refetch.
const HISTORY_CONCURRENCY = 6;
const historyCache = new Map();
let historyRangeDays = 7;
let historyPanelOpen = false;

function setLoading(isLoading) {
  els.loadingOverlay.classList.toggle("hidden", !isLoading);
}

// Lighter-weight than setLoading: used while fetching a single fuel's data
// so the map/sidebar stay interactive and the previous markers stay on
// screen instead of the whole app freezing behind the full overlay.
function setFuelLoading(isLoading) {
  els.fuelLoadingIndicator.classList.toggle("hidden", !isLoading);
}

function showError(message, onRetry) {
  els.errorBannerText.textContent = message;
  els.errorBanner.classList.remove("hidden");
  els.errorBannerRetry.onclick = () => {
    hideError();
    onRetry();
  };
}

function hideError() {
  els.errorBanner.classList.add("hidden");
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
// Errors propagate to the caller (runFilters) so they can be surfaced once,
// in one place, instead of failing silently.
async function ensureProductLoaded(productId) {
  if (!productId || loadedProductIds.has(productId)) return;

  setFuelLoading(true);
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
    setFuelLoading(false);
  }
}

// Fetches every fuel for every station in a province in one call and merges
// it into the shared cache — used so clicking one station can show all of
// its fuels without having fetched each fuel type nationwide beforehand.
// On failure, the cached promise is dropped so the next popup open retries
// instead of being stuck on a permanently-rejected promise.
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
  })().catch((err) => {
    provinceLoadPromises.delete(idProvincia);
    throw err;
  });

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
  try {
    await ensureProvinceLoaded(station.idProvincia);
    marker.setPopupContent(buildPopupHtml(station, validProductos, lastFuelId, "complete"));
  } catch (err) {
    console.error(err);
    marker.setPopupContent(buildPopupHtml(station, validProductos, lastFuelId, "error"));
  }
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

// Keeps the "nearest station" box in sync with the last geolocation fix and
// the currently selected fuel. Hidden until the user has actually granted
// location access once.
function updateNearestBox() {
  if (!lastGeoPos || !lastFuelId) {
    els.nearestBox.classList.add("hidden");
    return;
  }
  let nearest = null;
  let nearestDist = Infinity;
  for (const s of currentStations()) {
    if (s.prices[lastFuelId] == null) continue;
    const d = haversineKm(lastGeoPos.lat, lastGeoPos.lon, s.lat, s.lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = s;
    }
  }
  if (!nearest) {
    els.nearestBox.classList.add("hidden");
    return;
  }
  els.nearestBox.classList.remove("hidden");
  els.nearestBox.innerHTML = `Gasolinera más cercana: <b>${escapeHtml(nearest.rotulo)}</b><br>${formatPrice(
    nearest.prices[lastFuelId]
  )} · ${nearestDist.toFixed(1)} km`;
  els.nearestBox.style.cursor = "pointer";
  els.nearestBox.onclick = () => {
    map.flyTo([nearest.lat, nearest.lon], 15, { duration: 0.6 });
    map.once("moveend", () => {
      getStationMarker(nearest.id)?.openPopup();
    });
  };
}

// Reads fuel/ccaa/provincia/municipio/priceMin/priceMax/search from the URL
// so a filtered view can be bookmarked/shared, not just ?municipio=.
function readUrlFilters() {
  const params = new URLSearchParams(location.search);
  return {
    fuel: params.get("fuel")?.trim() || "",
    ccaa: params.get("ccaa")?.trim() || "",
    provincia: params.get("provincia")?.trim() || "",
    municipio: params.get("municipio")?.trim() || "",
    priceMin: params.get("priceMin")?.trim() || "",
    priceMax: params.get("priceMax")?.trim() || "",
    search: params.get("search")?.trim() || "",
  };
}

function hasUrlFilters() {
  const f = readUrlFilters();
  return Object.values(f).some(Boolean);
}

// Mirrors the current filter state into the URL via replaceState (no new
// history entries per keystroke) so the view can be bookmarked/shared.
function syncUrlFromFilters(filters) {
  const params = new URLSearchParams();
  if (filters.fuelId) params.set("fuel", filters.fuelId);
  if (filters.ccaaId) params.set("ccaa", filters.ccaaId);
  if (filters.provinciaId) params.set("provincia", filters.provinciaId);
  if (filters.municipio) params.set("municipio", filters.municipio);
  if (filters.priceMin != null) params.set("priceMin", filters.priceMin);
  if (filters.priceMax != null) params.set("priceMax", filters.priceMax);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
}

async function runFilters() {
  const filters = readFilters(els);

  if (filters.fuelId) {
    try {
      await ensureProductLoaded(filters.fuelId);
      hideError();
    } catch (err) {
      console.error(err);
      showError("No se pudieron cargar los precios. Comprueba tu conexión.", runFilters);
      return;
    }
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
  els.emptyState.classList.toggle("hidden", filtered.length !== 0);

  updateCheapestBox();
  updateNearestBox();
  refreshMunicipioOptions();
  refreshRotuloOptions();
  syncUrlFromFilters(filters);
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

function resetFilters() {
  els.ccaa.value = "";
  populateProvinciaSelect(els.provincia, provinciasList, "");
  els.municipio.value = "";
  els.priceMin.value = "";
  els.priceMax.value = "";
  els.search.value = "";
  runFilters();
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarToggle.setAttribute("aria-expanded", "false");
  els.sidebarToggle.querySelector(".material-symbols-outlined").textContent = "menu";
  els.sidebarBackdrop.hidden = true;
}

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarToggle.setAttribute("aria-expanded", "true");
  els.sidebarToggle.querySelector(".material-symbols-outlined").textContent = "close";
  els.sidebarBackdrop.hidden = false;
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

  els.reset.addEventListener("click", resetFilters);
  els.emptyStateReset.addEventListener("click", resetFilters);

  els.geoloc.addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastGeoPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        map.flyTo([lastGeoPos.lat, lastGeoPos.lon], 13, { duration: 0.6 });
        updateNearestBox();
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

  els.sidebarToggle.addEventListener("click", () => {
    if (els.sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  els.sidebarBackdrop.addEventListener("click", closeSidebar);

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

async function bootstrap() {
  setLoading(true);
  hideError();
  try {
    const lookups = await loadLookups();
    productos = lookups.productos;
    validProductos = productos.filter((p) => !NON_LAND_PRODUCT_IDS.has(String(p.IDProducto)));
    ccaaList = lookups.ccaa;
    provinciasList = lookups.provincias;

    populateFuelSelect(els.fuel, validProductos);
    populateCcaaSelect(els.ccaa, ccaaList);
    populateProvinciaSelect(els.provincia, provinciasList, "");

    const urlFilters = readUrlFilters();
    if (urlFilters.fuel) els.fuel.value = urlFilters.fuel;
    if (urlFilters.ccaa) {
      els.ccaa.value = urlFilters.ccaa;
      populateProvinciaSelect(els.provincia, provinciasList, urlFilters.ccaa);
    }
    if (urlFilters.provincia) els.provincia.value = urlFilters.provincia;
    if (urlFilters.municipio) els.municipio.value = urlFilters.municipio;
    if (urlFilters.priceMin) els.priceMin.value = urlFilters.priceMin;
    if (urlFilters.priceMax) els.priceMax.value = urlFilters.priceMax;
    if (urlFilters.search) els.search.value = urlFilters.search;

    await runFilters();

    if (urlFilters.municipio && lastFiltered.length) {
      const first = lastFiltered[0];
      map.setView([first.lat, first.lon], 13);
    }
  } catch (err) {
    els.resultCount.textContent = "";
    console.error(err);
    showError("No se pudieron cargar los datos iniciales.", bootstrap);
  } finally {
    setLoading(false);
  }
}

// Centers the map on the user's location on first load, if they grant
// permission; silently keeps the nationwide default view otherwise. Skipped
// when the URL already asked for a specific filtered view (e.g. a
// ?municipio= link), to respect that instead of overriding it.
function tryInitialGeolocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastGeoPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      map.setView([lastGeoPos.lat, lastGeoPos.lon], 13);
      updateNearestBox();
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
  if (!hasUrlFilters()) tryInitialGeolocate();
  bootstrap();
}

main();
