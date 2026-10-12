// The DGC difference equation x[k+1] = A[k] x[k] + B_R u[k], drawn with the deck's array diagrams.
// The TAD-sized shapes are proportional to the real sizes (Ñ TADs). B_R is a recipe: a slice of R columns of the full
// signed-TF matrix B, so B_R and u[k] are drawn one cell per column / entry (to scale they would be under a pixel).
// Brackets under the products show that the inner dimensions match. Hover a term to light up the dimensions it shares.
import data from '../data/pipeline.json';
import { s, setTex } from '../lib/svg.js';

const fmtN = (x) => x.toLocaleString('en-US');
const NT = data.dims.Ntilde;          // TADs
const MS = data.dims.M_expanded;      // signed TF columns of the full B
const R = 5;                          // TFs in one recipe: the columns of B_R
const H = 170;                        // px for Ñ
const W_VEC = 18;
const px = (n) => (n / NT) * H;

// Each term: its shape (rows × cols in real units), color, symbol and dimension names.
const TERMS = [
  { id: 'x1', sym: 'x[k+1]', rows: NT, cols: 1, rowName: 'TADs' },
  { op: '=' },
  { id: 'A', sym: 'A[k]', rows: NT, cols: NT, rowName: 'TADs', colName: 'TADs', color: '#1a5fb4' },
  { id: 'x0', sym: 'x[k]', rows: NT, cols: 1, rowName: 'TADs', gap: 10 },
  { op: '+' },
  { id: 'B', sym: 'B_R', rows: NT, cols: R, rowName: 'TADs', colName: 'recipe TFs', color: '#e8501a', cellCols: true },
  { id: 'u', sym: 'u[k] \\ge 0', rows: R, cols: 1, rowName: 'recipe TFs', gap: 10, cellRows: true },
];
// Which terms share a dimension (inner dimensions of the two products, and the common TAD rows).
const PAIRS = { A: ['x0'], x0: ['A'], B: ['u'], u: ['B'], x1: ['A', 'B'] };

// A small sketch of the full B with the recipe's columns picked out: B_R is that slice.
function sliceSketch() {
  const wrap = document.createElement('div');
  wrap.className = 'de-slice';
  const svg = s('svg', { width: 74, height: 46, viewBox: '0 0 74 46' }, wrap);
  s('rect', { x: 1, y: 1, width: 72, height: 44, class: 'de-slice-box' }, svg);
  for (const x of [9, 22, 38, 47, 63]) s('rect', { x, y: 1, width: 3, height: 44, class: 'de-slice-col' }, svg);
  const t = document.createElement('div');
  t.innerHTML = `slice of <i>B</i><br>(${fmtN(MS)} signed TFs)`;
  wrap.append(t);
  return wrap;
}

export function create(el) {
  el.classList.add('de-widget');
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
    if (T.cellCols) box.querySelector('.de-top').prepend(sliceSketch());
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
    setTex(sym, T.color ? `\\textcolor{${T.color}}{${T.sym}}` : T.sym);
    box.append(sym);
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
      const y = rel(termEls[m].querySelector('.de-sym')).y + 44;
      const x0 = a.x + 2, x1 = b.x + b.w - 2;
      s('path', { d: `M${x0},${y - 8} V${y} H${x1} V${y - 8}`, class: 'de-bracket' }, brackets);
      s('text', { x: (x0 + x1) / 2, y: y + 18, class: 'de-bracket-text' }, brackets).textContent = `inner dimensions match: ${label}`;
    }
  }

  const NOTE = `<span class="dim">Hover a term to see which dimensions it shares. B<sub>R</sub> and u[k] are drawn one cell per column and entry; at the scale of the other shapes, ${R} columns would be under a pixel wide.</span>`;
  const TEXT = {
    x1: `The next state: one value per TAD (${fmtN(NT)}). Both terms on the right produce a vector of this length.`,
    A: `A[k] is ${fmtN(NT)} × ${fmtN(NT)}: its ${fmtN(NT)} columns meet the ${fmtN(NT)} entries of x[k]. It carries the cell forward one step on its own.`,
    x0: `The current state, ${fmtN(NT)} entries: one per column of A[k].`,
    B: `B_R is ${fmtN(NT)} × ${R}: a recipe, ${R} columns sliced from the ${fmtN(MS)} signed-TF columns of B. Its columns meet the entries of u[k].`,
    u: `The input at step k: one nonnegative dose per TF in the recipe, ${R} entries, one per column of B_R.`,
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
