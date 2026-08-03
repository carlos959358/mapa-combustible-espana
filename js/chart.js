import { formatPrice } from "./utils.js";

const CHART_W = 600;
const CHART_H = 180;
const PAD = { top: 16, right: 12, bottom: 24, left: 52 };

// Renders a simple line chart of {date, avg}[] onto an inline <svg>. Gaps
// (avg === null, e.g. a day's fetch failed) break the line instead of
// interpolating across them.
export function renderPriceHistoryChart(svgEl, points) {
  const valid = points.filter((p) => p.avg != null);
  if (valid.length < 2) {
    svgEl.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
    svgEl.innerHTML = `<text x="50%" y="50%" text-anchor="middle" class="chart-empty">Sin datos suficientes</text>`;
    return;
  }

  const prices = valid.map((p) => p.avg);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) {
    min -= 0.01;
    max += 0.01;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    if (p.avg == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push(`${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`);
  });
  if (current.length) segments.push(current);

  const polylines = segments
    .map(
      (seg) =>
        `<polyline points="${seg.join(" ")}" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`
    )
    .join("");

  const dots = points
    .map((p, i) => {
      if (p.avg == null) return "";
      const label = `${p.date.toLocaleDateString("es")}: ${formatPrice(p.avg)}`;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.avg).toFixed(1)}" r="2.5" fill="var(--color-primary)"><title>${label}</title></circle>`;
    })
    .join("");

  const axisLabels = `
    <text x="${PAD.left - 8}" y="${y(max).toFixed(1)}" text-anchor="end" dominant-baseline="middle" class="chart-axis-label">${formatPrice(max)}</text>
    <text x="${PAD.left - 8}" y="${y(min).toFixed(1)}" text-anchor="end" dominant-baseline="middle" class="chart-axis-label">${formatPrice(min)}</text>
    <text x="${x(0).toFixed(1)}" y="${CHART_H - 4}" text-anchor="start" class="chart-axis-label">${points[0].date.toLocaleDateString("es", { day: "2-digit", month: "2-digit" })}</text>
    <text x="${x(points.length - 1).toFixed(1)}" y="${CHART_H - 4}" text-anchor="end" class="chart-axis-label">${points[points.length - 1].date.toLocaleDateString("es", { day: "2-digit", month: "2-digit" })}</text>
  `;

  svgEl.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
  svgEl.innerHTML = polylines + dots + axisLabels;
}
