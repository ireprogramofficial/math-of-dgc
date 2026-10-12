// The DGC difference equation x[k+1] = A[k] x[k] + B_R u[k], drawn with the deck's array diagrams.
// Indexing is 1-based: x[1] = x_initial, A[1] … A[K−1], x[K] the endpoint. data-k on the element pins one step.
// The TAD-sized shapes are proportional to the real sizes (Ñ TADs). B_R is a recipe: a slice of R columns of the full
// signed-TF matrix B, so B_R and u[k] are drawn one cell per column / entry (to scale they would be under a pixel).
// Brackets under the products show that the inner dimensions match. Hover a term to light up the dimensions it shares.
import data from '../data/pipeline.json';
import { s, setTex } from '../lib/svg.js';

const fmtN = (x) => x.toLocaleString('en-US');
const NT = data.dims.Ntilde;          // TADs
const MS = data.dims.M_expanded;      // signed TF columns of the full B
const R = 5;                          // TFs in one recipe: the columns of B_R
const H = 250;                        // px for Ñ
const W_VEC = 22;
const px = (n) => (n / NT) * H;

const K = data.dims.K;                // time points, 1-indexed: x[1] … x[K], steps k = 1 … K−1

// Each term: its shape (rows × cols in real units), color, symbol (for step k) and dimension names.
// `alias` names a term that is pinned at the first or last step.
const TERMS = [
  { id: 'x1', sym: (k) => `x[${k.next}]`, rows: NT, cols: 1, rowName: 'TADs', alias: (k) => (k.n === K - 1 ? 'x[K]' : null) },
  { op: '=' },
  { id: 'A', sym: (k) => `A[${k.at}]`, rows: NT, cols: NT, rowName: 'TADs', colName: 'TADs', color: '#1a5fb4' },
  { id: 'x0', sym: (k) => `x[${k.at}]`, rows: NT, cols: 1, rowName: 'TADs', gap: 10, alias: (k) => (k.n === 1 ? '\\textcolor{#1a5fb4}{x_{\\text{initial}}}' : null) },
  { op: '+' },
  { id: 'B', sym: () => 'B_R', rows: NT, cols: R, rowName: 'TADs', colName: 'recipe TFs', color: '#e8501a', cellCols: true },
  { id: 'u', sym: (k) => `u[${k.at}] \\ge 0`, rows: R, cols: 1, rowName: 'recipe TFs', gap: 10, cellRows: true },
];
// Which terms share a dimension (inner dimensions of the two products, and the common TAD rows).
const PAIRS = { A: ['x0'], x0: ['A'], B: ['u'], u: ['B'], x1: ['A', 'B'] };

/** The step this slide shows: data-k="1" or "47" pins it; anything else draws the generic step k. */
function stepOf(el) {
  const n = Number(el.dataset.k);
  return Number.isInteger(n) && n >= 1 && n < K ? { n, at: `${n}`, next: `${n + 1}` } : { n: null, at: 'k', next: 'k+1' };
}

export function create(el) {
  el.classList.add('de-widget');
  const step = stepOf(el);
  const row = document.createElement('div');
  row.className = 'de-row';
  const termEls = {};
  for (const T of TERMS) {
    if (T.op) {
      const o = document.createElement('div');
      o.className = 'de-op';
      o.textContent = T.op;
      row.append(o);
      continue;
    }
    const w = T.cellCols ? T.cols * W_VEC : T.cols === 1 ? W_VEC : px(T.cols);
    const h = T.cellRows ? T.rows * W_VEC : px(T.rows);
    const box = document.createElement('div');
    box.className = `de-term de-${T.id}`;
    if (T.gap) box.style.marginLeft = `${T.gap - 18}px`;
    if (T.color) box.style.setProperty('--c', T.color);
    // column count on top for matrices, row count on the left for everything
    box.innerHTML = `<div class="de-top">${T.cols > 1 ? `${T.colName}<br><b>${fmtN(T.cols)}</b>` : ''}</div>` +
      `<div class="de-side">${T.rowName}<br><b>${fmtN(T.rows)}</b></div>`;
    const svg = s('svg', { width: w + 2, height: h + 2, viewBox: `0 0 ${w + 2} ${h + 2}`, class: 'de-shape' });
    s('rect', { x: 1, y: 1, width: w, height: h, class: 'de-box' }, svg);
    if (T.cellCols) {
      // one cell per column: separators between columns, a rule down the middle of each
      for (let i = 0; i < T.cols; i++) {
        if (i) s('line', { x1: 1 + i * W_VEC, y1: 1, x2: 1 + i * W_VEC, y2: h + 1, class: 'de-sep' }, svg);
        s('line', { x1: 1 + (i + 0.5) * W_VEC, y1: 10, x2: 1 + (i + 0.5) * W_VEC, y2: h - 8, class: 'de-rule' }, svg);
      }
    } else if (T.cellRows) {
      for (let i = 1; i < T.rows; i++) s('line', { x1: 1, y1: 1 + i * W_VEC, x2: w + 1, y2: 1 + i * W_VEC, class: 'de-sep' }, svg);
    } else if (T.cols === 1) s('line', { x1: 1 + w / 2, y1: 10, x2: 1 + w / 2, y2: h - 8, class: 'de-rule' }, svg);
    else for (let i = 1; i <= 6; i++) if (i !== 5) s('line', { x1: 1 + (i * w) / 7, y1: 10, x2: 1 + (i * w) / 7, y2: h - 8, class: 'de-rule' }, svg);
    if (T.cols > 1 && !T.cellCols) s('text', { x: 1 + (5 * w) / 7, y: h / 2 + 5, class: 'dm-dots' }, svg).textContent = '⋯';
    box.append(svg);
    const sym = document.createElement('div');
    sym.className = 'de-sym';
    const tex = T.sym(step);
    setTex(sym, T.color ? `\\textcolor{${T.color}}{${tex}}` : tex);
    box.append(sym);
    const alias = T.alias?.(step);
    if (alias) {
      const a = document.createElement('div');
      a.className = 'de-alias';
      setTex(a, `= ${alias}`);
      box.append(a);
    }
    row.append(box);
    termEls[T.id] = box;
  }
  const note = document.createElement('div');
  note.className = 'de-note';
  el.append(row, note);

  // Brackets under each product: the matrix's column count must equal the vector's length.
  const brackets = s('svg', { class: 'de-brackets' }, el);
  function layout() {
    const wr = el.getBoundingClientRect(), k = wr.width / el.offsetWidth || 1;
    const rel = (n) => { const r = n.getBoundingClientRect(); return { x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k }; };
    brackets.setAttribute('viewBox', `0 0 ${el.offsetWidth} ${el.offsetHeight}`);
    brackets.replaceChildren();
    for (const [m, v, label] of [['A', 'x0', `${fmtN(NT)} = ${fmtN(NT)}`], ['B', 'u', `${R} = ${R}`]]) {
      const a = rel(termEls[m].querySelector('.de-shape')), b = rel(termEls[v].querySelector('.de-shape'));
      // below the lowest label in the row (some terms carry an extra '= …' line)
      const y = Math.max(...Object.values(termEls).map((t) => { const r = rel(t); return r.y + r.h; })) + 18;
      const x0 = a.x + 2, x1 = b.x + b.w - 2;
      s('path', { d: `M${x0},${y - 8} V${y} H${x1} V${y - 8}`, class: 'de-bracket' }, brackets);
      s('text', { x: (x0 + x1) / 2, y: y + 18, class: 'de-bracket-text' }, brackets).textContent = `inner dimensions match: ${label}`;
    }
  }

  const { at, next } = step;
  const NOTE = `<span class="dim">Hover a term to see which dimensions it shares. B<sub>R</sub> and u[${at}] are drawn one cell per column and entry; at the scale of the other shapes, ${R} columns would be under a pixel wide.</span>`;
  const TEXT = {
    x1: `The next state x[${next}]: one value per TAD (${fmtN(NT)}). Both terms on the right produce a vector of this length.` +
      (step.n === K - 1 ? ` This is the last step, so x[${next}] = x[K] is the endpoint compared with x_target.` : ''),
    A: `A[${at}] is ${fmtN(NT)} × ${fmtN(NT)}: its ${fmtN(NT)} columns meet the ${fmtN(NT)} entries of x[${at}]. It carries the cell forward one step on its own.`,
    x0: `The current state x[${at}], ${fmtN(NT)} entries: one per column of A[${at}].` +
      (step.n === 1 ? ' At the first step it is fixed: x[1] = x_initial.' : ''),
    B: `B_R is ${fmtN(NT)} × ${R}: a recipe, ${R} columns sliced from the ${fmtN(MS)} signed-TF columns of B. The same B_R acts at every step. Its columns meet the entries of u[${at}].`,
    u: `The input at step ${at}: one nonnegative dose per TF in the recipe, ${R} entries, one per column of B_R.`,
  };
  for (const [id, e] of Object.entries(termEls)) {
    e.onmouseenter = () => {
      el.classList.add('de-focus');
      for (const [j, f] of Object.entries(termEls)) f.classList.toggle('on', j === id || PAIRS[id].includes(j));
      note.textContent = TEXT[id];
    };
    e.onmouseleave = () => { el.classList.remove('de-focus'); note.innerHTML = NOTE; };
  }
  note.innerHTML = NOTE;

  const ro = new ResizeObserver(layout);
  ro.observe(el);
  return {
    setActive(on) { if (on) layout(); },
    destroy() { ro.disconnect(); el.innerHTML = ''; },
  };
}
