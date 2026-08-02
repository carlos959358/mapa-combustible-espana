import { escapeHtml, formatPrice } from "./utils.js";

const SPAIN_CENTER = [40.4168, -3.7038];
const SPAIN_ZOOM = 6;

export function initMap() {
  const map = L.map("map", { preferCanvas: true }).setView(SPAIN_CENTER, SPAIN_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Clustering stays on only at nationwide/regional zoom, where ~11k
  // permanent price labels rendered at once would freeze the tab and
  // wouldn't be readable anyway. Past zoom 13 (city/street level, where
  // grouping was actually getting in the way) every dot shows individually.
  const clusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    disableClusteringAtZoom: 13,
  });
  map.addLayer(clusterGroup);

  return { map, clusterGroup };
}

// green (cheap) -> yellow -> red (expensive), t in [0,1]
function colorForRatio(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [34, 197, 94],
    [234, 179, 8],
    [239, 68, 68],
  ];
  const seg = t < 0.5 ? 0 : 1;
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg];
  const b = stops[seg + 1];
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * localT));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function priceColor(price, min, max) {
  if (min == null || max == null || min === max) return colorForRatio(0.5);
  return colorForRatio((price - min) / (max - min));
}

// status: "loading" while we're fetching the rest of this station's fuels,
// "complete" once its province has been fully loaded.
export function buildPopupHtml(station, productos, selectedProductId, status) {
  const rows = productos
    .filter((p) => station.prices[p.IDProducto] != null)
    .map((p) => {
      const selected = String(p.IDProducto) === String(selectedProductId);
      const label = p.NombreProductoAbreviatura || p.NombreProducto;
      return `<tr class="${selected ? "selected" : ""}"><td>${escapeHtml(label)}</td><td>${formatPrice(station.prices[p.IDProducto])}</td></tr>`;
    })
    .join("");

  const tipo =
    station.tipoVenta === "P" ? "Público" : station.tipoVenta === "R" ? "Restringido" : "";

  const hint =
    status === "loading"
      ? `<div class="popup-hint">Cargando el resto de precios de esta estación…</div>`
      : "";

  return `
    <div class="station-popup">
      <h3>${escapeHtml(station.rotulo)}${tipo ? ` <span class="badge">${tipo}</span>` : ""}</h3>
      <div class="addr">${escapeHtml(station.direccion)}<br>${escapeHtml(station.municipio)} (${escapeHtml(station.provincia)})</div>
      <div class="addr">🕒 ${escapeHtml(station.horario)}</div>
      <table>${rows}</table>
      ${hint}
    </div>`;
}

// Tracks each rendered station's marker by id so the "cheapest" box can open
// a station's popup after flying to it (see getStationMarker below).
const markersByStationId = new Map();

export function getStationMarker(stationId) {
  return markersByStationId.get(stationId);
}

// Replaces all markers on the cluster layer and returns the min/max price
// among the rendered stations for the selected fuel (used for the legend).
// getStatus(station) -> "loading" | "complete", decides the popup's initial
// content; onPopupOpen(station, marker) fires once per open so the caller can
// kick off fetching the rest of that station's fuels and live-update it.
export function renderStations(
  clusterGroup,
  stations,
  productos,
  selectedProductId,
  getStatus,
  onPopupOpen
) {
  clusterGroup.clearLayers();
  markersByStationId.clear();

  let min = Infinity;
  let max = -Infinity;
  if (selectedProductId) {
    for (const s of stations) {
      const p = s.prices[selectedProductId];
      if (p != null) {
        if (p < min) min = p;
        if (p > max) max = p;
      }
    }
  }
  const hasRange = min !== Infinity;

  const markers = stations.map((s) => {
    const price = selectedProductId ? s.prices[selectedProductId] : null;
    const color = price != null && hasRange ? priceColor(price, min, max) : "#3b82f6";

    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 7,
      weight: 1,
      color: "#111827",
      fillColor: color,
      fillOpacity: 0.9,
    });
    marker.bindPopup(() => buildPopupHtml(s, productos, selectedProductId, getStatus(s)), {
      maxWidth: 260,
    });
    if (onPopupOpen) {
      marker.on("popupopen", () => onPopupOpen(s, marker));
    }
    if (price != null) {
      marker.bindTooltip(formatPrice(price), {
        permanent: true,
        direction: "top",
        offset: [0, -7],
        className: "price-tooltip",
      });
    }
    markersByStationId.set(s.id, marker);
    return marker;
  });

  clusterGroup.addLayers(markers);

  return { min: hasRange ? min : null, max: hasRange ? max : null };
}
