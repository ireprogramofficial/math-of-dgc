// The DGC variables at a glance: each array's diagram, its size and dimension labels, and a summary of its entries.
// Numbers come from src/linear-algebra/data/variables.json (scripts/extract_variable_stats.py).
import vars from '../data/variables.json';
import { glyph } from '../lib/glyphs.js';
import { setTex } from '../lib/svg.js';

const n = (x) => x.toLocaleString('en-US');
// Entry values: integers as-is, small decimals to 2 significant places.
const v = (x) => (Number.isInteger(x) ? n(x) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toPrecision(2));

// A one-row table: column heads, then values.
function table(cols) {
  return `<table class="vr-tbl"><tr>${cols.map(([k]) => `<th>${k}</th>`).join('')}</tr><tr>${cols.map(([, x]) => `<td>${x}</td>`).join('')}</tr></table>`;
}

function body(V) {
  if (V.signs) {
    const { activator, repressor, unknown, expanded_columns } = V.signs;
    return table([['+1', n(activator)], ['−1', n(repressor)], ['unknown', n(unknown)]]) +
      `<p class="vr-foot">Unknown signs are tried both ways: ${n(expanded_columns)} signed columns.</p>`;
  }
  if (V.genes_per_tad) {
    const g = V.genes_per_tad;
    return `<p class="vr-line">${n(V.n_tads)} TADs; genes per TAD:</p>` + table([['min', v(g.min)], ['median', v(g.median)], ['mean', v(g.mean)], ['max', v(g.max)]]);
  }
  return table([['min', v(V.min)], ['median', v(V.median)], ['mean', v(V.mean)], ['max', v(V.max)]]) +
    `<p class="vr-line">sparsity <b>${V.zero_pct.toFixed(1)}%</b> zeros</p>`;
}

export function create(el) {
  el.classList.add('vr-widget');
  for (const V of vars) {
    const card = document.createElement('div');
    card.className = `vr-card vr-${V.id}`;
    // Diagram with its dimension labels: rows down the left, columns (or a row vector's length) along the top.
    const fig = document.createElement('div');
    fig.className = 'vr-fig';
    const g = glyph(V.id);
    const isRow = V.id === 's';
    if (V.id === 'tad') {
      fig.innerHTML = '<span class="vr-dim top">genes</span>';
      fig.append(g);
      fig.insertAdjacentHTML('beforeend', '<span class="vr-dim bottom">TADs</span>');
    } else {
      const rows = isRow ? null : V.dims[0];
      const cols = isRow ? V.dims[0] : V.dims[1];
      if (cols) fig.insertAdjacentHTML('beforeend', `<span class="vr-dim top">${cols}</span>`);
      if (rows) fig.insertAdjacentHTML('beforeend', `<span class="vr-dim side">${rows}</span>`);
      fig.append(g);
    }
    const info = document.createElement('div');
    info.className = 'vr-info';
    const sym = document.createElement('div');
    sym.className = 'vr-sym';
    setTex(sym, V.sym);
    const size = document.createElement('div');
    size.className = 'vr-size';
    size.textContent = V.shape.map(n).join(' × ');
    const what = document.createElement('div');
    what.className = 'vr-what';
    what.textContent = V.what;
    info.append(sym, size, what);
    info.insertAdjacentHTML('beforeend', body(V));
    card.append(fig, info);
    el.append(card);
  }
  return { setActive() {}, destroy() { el.innerHTML = ''; } };
}
