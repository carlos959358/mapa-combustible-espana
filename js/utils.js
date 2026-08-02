// Spanish API uses comma-decimals ("1,699") and empty strings for missing values.
export function parseEsNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

export const parseEsCoord = parseEsNumber;

export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

export function formatPrice(n) {
  return n == null ? "—" : `${n.toFixed(3)} €`;
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
