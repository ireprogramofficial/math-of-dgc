// "From data to arrays": which Active data types become which of DGC's original variables.
// Left: the Active data types, grouped by category as in the data-type inventory, plus the curated references
// that are not data types. Right: the arrays, drawn as shapes. Links draw in when the slide opens; hover either
// end to trace it.
import { s, setTex } from '../lib/svg.js';
import { glyph } from '../lib/glyphs.js';

const fmtN = (n) => n.toLocaleString('en-US');
const DIMS = { N: 14950, K: 48, M: 1606 };

const SOURCES = [
  { cat: 'Transcriptomics', items: [
    { id: 'sc', name: 'Gene expression (single cell)', color: '#1a5fb4' },
    { id: 'sn', name: 'Gene expression (single nucleus)', color: '#3d8bd9' },
    { id: 'tss', name: 'Transcription start sites', color: '#7c3aed' },
  ] },
  { cat: 'Clinical / Metadata', items: [{ id: 'meta', name: 'Phenotype & clinical records', color: '#e8501a' }] },
  { cat: 'Epigenomics: Accessibility', items: [{ id: 'atac', name: 'Chromatin accessibility (single cell)', color: '#2e8b57' }] },
  { cat: 'Epigenomics: Protein–DNA', items: [{ id: 'chip', name: 'TF binding & histone modifications', color: '#d6246e' }] },
  { cat: 'Curated references', ref: true, items: [{ id: 'ref', name: 'TF motifs & regulatory databases', color: '#6b7280' }] },
  { cat: '3D Genome', items: [{ id: 'hic', name: 'Genome-wide chromatin conformation', color: '#b8860b' }] },
];

// Arrays whose links arrive from above, so they don't cut across the array to their left.
const TOP_ENTRY = new Set(['g0', 'gtarget', 'a']);

const ARRAYS = {
  G: { sym: 'G', dims: `N \\times K`, sizes: `${fmtN(DIMS.N)} × ${DIMS.K}`, what: 'Expression over the time course: one column per hourly snapshot.' },
  g0: { sym: 'g_{\\text{initial}}', dims: 'N', sizes: fmtN(DIMS.N), what: 'The starting cell type’s expression.' },
  gtarget: { sym: 'g_{\\text{target}}', dims: 'N', sizes: fmtN(DIMS.N), what: 'The target cell type’s expression.' },
  lab: { sym: '\\text{labels}', dims: '', sizes: 'per sample', what: 'Which hour each column of G is, and which cells are the initial and the target type. They order and select samples; they add no numbers.' },
  a: { sym: 'a', dims: 'N', sizes: fmtN(DIMS.N), what: 'Accessibility per gene in the initial cell type: closed chromatin zeroes the gene’s row of the input.' },
  C: { sym: 'C', dims: 'N \\times M', sizes: `${fmtN(DIMS.N)} × ${fmtN(DIMS.M)}`, what: 'Connections: which transcription factors target which genes.' },
  s: { sym: 's', dims: 'M', sizes: `${fmtN(DIMS.M)}, ±1`, what: 'Each factor’s direction: activator (+1) or repressor (−1).' },
  tad: { sym: '\\mathrm{tad}(i)', dims: 'N \\to \\tilde N', sizes: `${fmtN(DIMS.N)} genes → 2,095 TADs`, what: 'Which TAD each gene sits in. Used later to pool G, g_target and C into TAD-level arrays.' },
};

const LINKS = [
  ['sc', 'G'], ['sc', 'g0'], ['sc', 'gtarget'],
  ['sn', 'G'], ['sn', 'g0'], ['sn', 'gtarget'],
  ['atac', 'a'],
  ['chip', 'C'], ['tss', 'C'], ['ref', 'C'], ['ref', 's'],
  ['hic', 'tad'],
  ['meta', 'lab'],
];

const NOTES = {
  sc: 'Single-cell expression: averaged per time point into the columns of G, and over the initial and target cell types into g_initial and g_target.',
  sn: 'Single-nucleus expression is interchangeable with single-cell here: whichever assay a dataset used feeds G, g_initial and g_target.',
  tss: 'Transcription start sites define each gene’s promoter window, which decides which TF binding peaks count toward that gene’s row of C.',
  atac: 'Single-cell chromatin accessibility, measured in the initial cell type, gives a.',
  chip: 'TF binding (ChIP-seq style) peaks near a gene are the core evidence for a connection in C.',
  hic: 'Chromatin conformation calls the TAD boundaries; each gene falls in one TAD, giving tad(i).',
  meta: 'Phenotype and clinical records label the samples: the hour of each snapshot and the initial and target cell types.',
  ref: 'Not a data type: motif counts and regulatory databases add evidence to C, and the curated literature sets each factor’s sign s.',
};

export function create(el) {
  el.classList.add('dm-widget');
  el.innerHTML = `<svg class="dm-links"></svg><div class="dm-left"></div><div class="dm-right"></div><div class="dm-note"></div>`;
  const left = el.querySelector('.dm-left'), right = el.querySelector('.dm-right');
  const linksSvg = el.querySelector('.dm-links'), note = el.querySelector('.dm-note');

  const srcEls = {};
  const colorOf = {};
  for (const group of SOURCES) {
    const g = document.createElement('div');
    g.className = 'dm-cat' + (group.ref ? ' ref' : '');
    g.innerHTML = `<div class="dm-cat-name">${group.cat}${group.ref ? ' <span>(not a data type)</span>' : ''}</div>`;
    for (const it of group.items) {
      const d = document.createElement('div');
      d.className = 'dm-src';
      d.dataset.id = it.id;
      d.style.setProperty('--c', it.color);
      d.innerHTML = `<span class="dm-swatch"></span>${it.name}`;
      g.append(d);
      srcEls[it.id] = d;
      colorOf[it.id] = it.color;
    }
    left.append(g);
  }

  // Right side: rows of arrays, grouped as they are used.
  // s sits beneath C, as in the pptx; a sits to C's right and takes its one link from above.
  const rows = [['G', 'g0', 'gtarget'], ['lab'], ['C', 'a', 's'], ['tad']];
  const arrEls = {};
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = `dm-row dm-row-${r.join('')}`;
    for (const id of r) {
      const A = ARRAYS[id];
      const d = document.createElement('div');
      d.className = `dm-arr dm-arr-${id}`;
      d.dataset.id = id;
      const sym = document.createElement('div');
      sym.className = 'dm-sym';
      setTex(sym, A.sym);
      const dims = document.createElement('div');
      dims.className = 'dm-dims';
      if (A.dims) { const t = document.createElement('span'); setTex(t, A.dims); dims.append(t, document.createElement('br')); }
      dims.append(A.sizes);
      d.append(glyph(id), sym, dims);
      row.append(d);
      arrEls[id] = d;
    }
    right.append(row);
  }

  // ---- links ----
  const paths = LINKS.map(([src, dst]) => {
    const p = s('path', { class: 'dm-link', stroke: colorOf[src] }, linksSvg);
    return { src, dst, p };
  });
  function layout() {
    // s goes directly under C's glyph
    const aCs = right.querySelector('.dm-row-Cas');
    aCs.style.setProperty('--c-left', `${arrEls.C.offsetLeft}px`);
    const W = el.offsetWidth, H = el.offsetHeight;
    linksSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const wr = el.getBoundingClientRect();
    const k = wr.width / W || 1; // Reveal scales slides with a transform
    const rel = (node) => { const r = node.getBoundingClientRect(); return { x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k }; };
    // spread several links leaving one source / arriving at one array, so they don't overlap at the ends
    const outCount = {}, inCount = {}, outIdx = {}, inIdx = {};
    for (const { src, dst } of paths) { outCount[src] = (outCount[src] || 0) + 1; inCount[dst] = (inCount[dst] || 0) + 1; }
    for (const L of paths) {
      const a = rel(srcEls[L.src]), b = rel(arrEls[L.dst].querySelector('.dm-glyph'));
      const oi = (outIdx[L.src] = (outIdx[L.src] || 0) + 1) - 1, ii = (inIdx[L.dst] = (inIdx[L.dst] || 0) + 1) - 1;
      const y0 = a.y + a.h / 2 + (oi - (outCount[L.src] - 1) / 2) * 5;
      const x0 = a.x + a.w + 6;
      if (TOP_ENTRY.has(L.dst)) {
        const x1 = b.x + b.w * ((ii + 1) / (inCount[L.dst] + 1)), y1 = b.y - 8;
        const cy = Math.min(y0, y1) - 50;
        L.p.setAttribute('d', `M${x0},${y0} C${(x0 + x1) / 2},${y0} ${x1 - 60},${cy} ${x1},${y1}`);
      } else {
        const y1 = b.y + b.h * ((ii + 1) / (inCount[L.dst] + 1)), x1 = b.x - 8;
        const mx = (x0 + x1) / 2;
        L.p.setAttribute('d', `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`);
      }
      L.len = L.p.getTotalLength();
      L.p.style.strokeDasharray = `${L.len}`;
    }
  }

  // ---- hover ----
  function focus(kind, id) {
    const on = (L) => (kind === 'src' ? L.src === id : L.dst === id);
    const live = id ? paths.filter(on) : [];
    const srcOn = new Set(live.map((L) => L.src)), dstOn = new Set(live.map((L) => L.dst));
    el.classList.toggle('dm-focus', !!id);
    for (const L of paths) L.p.classList.toggle('on', on(L));
    for (const [k, e] of Object.entries(srcEls)) e.classList.toggle('on', srcOn.has(k));
    for (const [k, e] of Object.entries(arrEls)) e.classList.toggle('on', dstOn.has(k));
    if (!id) note.innerHTML = '<span class="dim">Hover a data type or an array to trace where it comes from.</span>';
    else if (kind === 'src') note.textContent = NOTES[id];
    else {
      const A = ARRAYS[id];
      note.innerHTML = '';
      const sym = document.createElement('span');
      setTex(sym, A.sym);
      note.append(sym, ` — ${A.what}`);
    }
  }
  for (const [id, e] of Object.entries(srcEls)) { e.onmouseenter = () => focus('src', id); e.onmouseleave = () => focus(); }
  for (const [id, e] of Object.entries(arrEls)) { e.onmouseenter = () => focus('dst', id); e.onmouseleave = () => focus(); }
  focus();

  // ---- draw-in animation ----
  let raf = 0, t0 = 0, active = false;
  function tick(now) {
    const t = (now - t0) / 1000;
    let done = true;
    paths.forEach((L, i) => {
      const f = Math.min(1, Math.max(0, (t - 0.08 * i) / 0.7));
      if (f < 1) done = false;
      L.p.style.strokeDashoffset = `${L.len * (1 - (1 - (1 - f) ** 3))}`;
    });
    if (!done) raf = requestAnimationFrame(tick);
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(el);
  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      cancelAnimationFrame(raf);
      if (on) { layout(); t0 = performance.now(); raf = requestAnimationFrame(tick); }
    },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); el.innerHTML = ''; },
  };
}
