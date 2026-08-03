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

// The historical fuel-price endpoint expects dd-mm-yyyy.
export function formatDateDDMMYYYY(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getFullYear()}`;
}

// Runs `worker` over `items` with at most `limit` in flight at once.
export async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  async function runNext() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
