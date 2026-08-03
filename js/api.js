import { parseEsCoord, parseEsNumber } from "./utils.js";

const BASE_URL =
  "https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes";

// These product ids only ever sell through maritime posts, aviation supply or
// heating-oil delivery — they never carry a price in the land-station
// (EstacionesTerrestres) endpoints, so they're excluded from the fuel filter.
export const NON_LAND_PRODUCT_IDS = new Set(["7", "9", "10", "11", "12", "13", "14"]);

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Fallo al pedir ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchComunidades() {
  return getJson("/Listados/ComunidadesAutonomas/");
}

export function fetchProvincias() {
  return getJson("/Listados/Provincias/");
}

export function fetchProductos() {
  return getJson("/Listados/ProductosPetroliferos/");
}

// Stations selling one specific fuel, nationwide. Chosen over the full
// EstacionesTerrestres dump (~12MB, every fuel, every station) so the app
// only pays for the fuel the user actually has selected.
export function fetchStationsByProduct(productId) {
  return getJson(`/EstacionesTerrestres/FiltroProducto/${productId}`);
}

// Unlike FiltroProducto, the province-scoped endpoint returns every fuel's
// price on each station record (one request = that station's full fuel
// list) — used on-demand when a user opens a station's popup.
export function fetchStationsByProvincia(idProvincia) {
  return getJson(`/EstacionesTerrestres/FiltroProvincia/${idProvincia}`);
}

// Historical (undocumented but stable, verified live back to 2020) snapshot
// of one fuel's nationwide station list on a given day. Same shape as
// fetchStationsByProduct, one request per day — used to build the "average
// price over the last N days" chart.
export function fetchHistoricalStationsByProduct(ddMmYyyy, productId) {
  return getJson(`/EstacionesTerrestresHist/FiltroProducto/${ddMmYyyy}/${productId}`);
}

// The ProductosPetroliferos catalog names don't match the "Precio <Nombre>"
// field names used by the unfiltered/region-scoped endpoints (accents and
// wording differ, e.g. catalog "Gasóleo A habitual" vs field "Precio Gasoleo
// A"). Verified against a live response — this is the correct, fixed
// correspondence for all 23 land-station fuels.
const PRODUCT_ID_TO_LEGACY_KEY = {
  1: "Precio Gasolina 95 E5",
  23: "Precio Gasolina 95 E10",
  24: "Precio Gasolina 95 E25",
  25: "Precio Gasolina 95 E85",
  20: "Precio Gasolina 95 E5 Premium",
  3: "Precio Gasolina 98 E5",
  21: "Precio Gasolina 98 E10",
  4: "Precio Gasoleo A",
  5: "Precio Gasoleo Premium",
  6: "Precio Gasoleo B",
  16: "Precio Bioetanol",
  8: "Precio Biodiesel",
  17: "Precio Gases licuados del petróleo",
  18: "Precio Gas Natural Comprimido",
  19: "Precio Gas Natural Licuado",
  22: "Precio Hidrogeno",
  26: "Precio Adblue",
  27: "Precio Diésel Renovable",
  28: "Precio Gasolina Renovable",
  29: "Precio Metanol",
  30: "Precio Amoniaco",
  31: "Precio Biogas Natural Comprimido",
  32: "Precio Biogas Natural Licuado",
};

// Normalizes a full (all-fuels) station record from a region-scoped endpoint.
export function normalizeFullStation(raw) {
  const prices = {};
  for (const [productId, key] of Object.entries(PRODUCT_ID_TO_LEGACY_KEY)) {
    const value = parseEsNumber(raw[key]);
    if (value != null) prices[productId] = value;
  }
  return {
    id: raw.IDEESS,
    lat: parseEsCoord(raw.Latitud),
    lon: parseEsCoord(raw["Longitud (WGS84)"]),
    rotulo: raw["Rótulo"] || "",
    direccion: raw["Dirección"] || "",
    horario: raw.Horario || "",
    localidad: raw.Localidad || "",
    municipio: raw.Municipio || "",
    idMunicipio: raw.IDMunicipio,
    provincia: raw.Provincia || "",
    idProvincia: raw.IDProvincia,
    idCCAA: raw.IDCCAA,
    tipoVenta: raw["Tipo Venta"] || "",
    prices,
  };
}

export async function loadLookups() {
  const [ccaa, provincias, productos] = await Promise.all([
    fetchComunidades(),
    fetchProvincias(),
    fetchProductos(),
  ]);
  return { ccaa, provincias, productos };
}

// FiltroProducto responses carry a single "PrecioProducto" field (not the
// full "Precio <Nombre>" set from the unfiltered endpoint), since they're
// already scoped to one product.
export function normalizeStationForProduct(raw) {
  return {
    id: raw.IDEESS,
    lat: parseEsCoord(raw.Latitud),
    lon: parseEsCoord(raw["Longitud (WGS84)"]),
    rotulo: raw["Rótulo"] || "",
    direccion: raw["Dirección"] || "",
    horario: raw.Horario || "",
    localidad: raw.Localidad || "",
    municipio: raw.Municipio || "",
    idMunicipio: raw.IDMunicipio,
    provincia: raw.Provincia || "",
    idProvincia: raw.IDProvincia,
    idCCAA: raw.IDCCAA,
    tipoVenta: raw["Tipo Venta"] || "",
    price: parseEsNumber(raw.PrecioProducto),
  };
}

