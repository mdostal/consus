// Renders the flayr super-admin nav survey images from the pinned NAV_ITEMS.
// Not screenshots: SVG mockups built from the real labels in their real order.
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const SHA = "b6cae430b336fdc47a2a269214019df87620936a";
const LAYOUT = process.env.FLAYR_LAYOUT ?? path.join(__dirname, "../src/flayr/apps/dashboard/src/app/super-admin/layout.tsx");
const NAV = [...fs.readFileSync(LAYOUT, "utf8").matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
if (NAV.length !== 47) throw new Error(`expected 47 nav items, got ${NAV.length}`);

const FONT_DIR = "/home/node/pwlibs/root/usr/share/fonts/truetype/dejavu";
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FOOT = `Rendered from firefly-events/flayr@${SHA.slice(0, 8)} super-admin/layout.tsx NAV_ITEMS (47 items). Mockup, not a live screenshot.`;

// Every option's grouping must place each of the 47 items exactly once.
function checkPlacement(name, groups) {
  const placed = groups.flatMap((g) => g.items);
  const missing = NAV.filter((n) => !placed.includes(n));
  const extra = placed.filter((p) => !NAV.includes(p));
  const dupes = placed.filter((p, i) => placed.indexOf(p) !== i);
  if (missing.length || extra.length || dupes.length) {
    throw new Error(`${name}: missing=${missing} extra=${extra} dupes=${dupes}`);
  }
}

const ROW = 22;
function navColumn(x, y, highlight, title = "Super Admin") {
  const h = 70 + NAV.length * ROW + 10;
  let s = `<rect x="${x}" y="${y}" width="250" height="${h}" fill="#1e293b"/>`;
  s += `<text x="${x + 14}" y="${y + 28}" font-size="18" font-weight="bold" fill="#fff">${esc(title)}</text>`;
  s += `<text x="${x + 14}" y="${y + 48}" font-size="11" fill="#94a3b8">← Back to app</text>`;
  NAV.forEach((label, i) => {
    const ry = y + 62 + i * ROW;
    if (highlight.includes(label)) {
      s += `<rect x="${x + 5}" y="${ry}" width="240" height="${ROW - 2}" rx="3" fill="#fef3c7" stroke="#f59e0b" stroke-width="1.5"/>`;
    }
    const fill = highlight.includes(label) ? "#111827" : "#e2e8f0";
    s += `<text x="${x + 14}" y="${ry + 15}" font-size="12" fill="${fill}">${esc(label)}</text>`;
  });
  return { svg: s, h };
}

function groupsPanel(x, y, w, groups, opts = {}) {
  let s = "";
  let cy = y;
  const cols = opts.cols ?? 2;
  const colW = (w - (cols - 1) * 12) / cols;
  const colY = Array(cols).fill(y);
  for (const g of groups) {
    const c = colY.indexOf(Math.min(...colY));
    const gx = x + c * (colW + 12);
    cy = colY[c];
    const bodyH = g.tabs ? 30 + 22 : g.items.length * 19 + 8;
    const gh = 28 + bodyH;
    const stroke = g.accent ? "#f59e0b" : "#cbd5e1";
    s += `<rect x="${gx}" y="${cy}" width="${colW}" height="${gh}" rx="6" fill="#fff" stroke="${stroke}" stroke-width="${g.accent ? 2 : 1}"/>`;
    s += `<rect x="${gx}" y="${cy}" width="${colW}" height="26" rx="6" fill="${g.accent ? "#fde68a" : "#e2e8f0"}"/>`;
    s += `<text x="${gx + 10}" y="${cy + 18}" font-size="12" font-weight="bold" fill="#0f172a">${esc(g.name)} (${g.items.length})</text>`;
    if (g.tabs) {
      s += `<text x="${gx + 10}" y="${cy + 44}" font-size="11" fill="#475569">One page, ${g.items.length} tabs:</text>`;
      let tx = gx + 10;
      const tabW = Math.min(120, (colW - 20) / g.items.length - 4);
      g.items.forEach((it, i) => {
        s += `<rect x="${tx}" y="${cy + 52}" width="${tabW}" height="20" rx="3" fill="${i === 0 ? "#2563eb" : "#e2e8f0"}"/>`;
        const short = it.length * 6 > tabW ? it.slice(0, Math.floor(tabW / 6.2) - 1) + "…" : it;
        s += `<text x="${tx + 5}" y="${cy + 66}" font-size="10" fill="${i === 0 ? "#fff" : "#0f172a"}">${esc(short)}</text>`;
        tx += tabW + 4;
      });
    } else {
      g.items.forEach((it, i) => {
        const hl = (opts.highlight ?? []).includes(it);
        if (hl) s += `<rect x="${gx + 6}" y="${cy + 30 + i * 19}" width="${colW - 12}" height="17" rx="3" fill="#fef3c7" stroke="#f59e0b"/>`;
        s += `<text x="${gx + 14}" y="${cy + 43 + i * 19}" font-size="11" fill="#1f2937">${esc(it)}</text>`;
      });
    }
    colY[c] = cy + gh + 12;
  }
  return { svg: s, h: Math.max(...colY) - y };
}

function wrap(text, max) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function render(file, { title, subtitle, highlight = [], afterTitle, afterNote, groups, cols, notes = [] }) {
  if (groups && groups.some((g) => g.full)) checkPlacement(file, groups);
  const W = 1240;
  let body = "";
  body += `<text x="20" y="34" font-size="22" font-weight="bold" fill="#0f172a">${esc(title)}</text>`;
  wrap(subtitle, 150).forEach((l, i) => {
    body += `<text x="20" y="${56 + i * 16}" font-size="12" fill="#475569">${esc(l)}</text>`;
  });
  const top = 90;
  const nav = navColumn(20, top, highlight);
  body += nav.svg;
  body += `<text x="20" y="${top + nav.h + 20}" font-size="12" font-weight="bold" fill="#0f172a">Before (today: 47 links, one flat list)</text>`;
  let afterH = 0;
  if (groups) {
    body += `<text x="290" y="${top + 150}" font-size="26" fill="#64748b">→</text>`;
    body += `<text x="330" y="${top + 14}" font-size="14" font-weight="bold" fill="#0f172a">${esc(afterTitle)}</text>`;
    let ny = top + 22;
    if (afterNote) {
      wrap(afterNote, 125).forEach((l) => {
        body += `<text x="330" y="${ny + 12}" font-size="11" fill="#475569">${esc(l)}</text>`;
        ny += 15;
      });
    }
    const gp = groupsPanel(330, ny + 10, W - 350, groups, { cols, highlight });
    body += gp.svg;
    afterH = ny + 10 + gp.h - top;
  }
  let y = top + Math.max(nav.h + 30, afterH) + 20;
  for (const n of notes) {
    for (const l of wrap(n, 165)) {
      body += `<text x="20" y="${y}" font-size="11" fill="#334155">${esc(l)}</text>`;
      y += 15;
    }
    y += 4;
  }
  y += 10;
  body += `<text x="${W - 20}" y="${y}" font-size="10" fill="#64748b" text-anchor="end">${esc(FOOT)}</text>`;
  const H = y + 14;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans"><rect width="${W}" height="${H}" fill="#f1f5f9"/>${body}</svg>`;
  const png = new Resvg(svg, {
    font: { fontFiles: [`${FONT_DIR}/DejaVuSans.ttf`, `${FONT_DIR}/DejaVuSans-Bold.ttf`], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" },
  }).render().asPng();
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(file, png.length);
}

module.exports = { render, NAV, SHA };
