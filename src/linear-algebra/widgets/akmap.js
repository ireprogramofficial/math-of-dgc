// "What one A_k does": a 2-D plane deformed by A = I + (b − a)aᵀ/(aᵀa), with a = ẽ_k and b = ẽ_{k+1}.
// Drag either snapshot (or the gray probe vector). The grid morphs from I to A_k and back, showing that
// ẽ_k lands exactly on ẽ_{k+1}, everything orthogonal to ẽ_k stays put, and the only stretch is λ = ẽ_kᵀẽ_{k+1}/‖ẽ_k‖²
// along b − a.
import { arrow, draggable, fmt, s, setTex, view } from '../lib/svg.js';
import { dot, fitTransition, matvec, norm, sub } from '../lib/linalg.js';
import { SEC } from '../lib/colors.js';

const W = 780, H = 560;
const COL_A = SEC.terrain, COL_B = '#e8501a', COL_PERP = '#2e8b57', COL_EIG = '#7c3aed';

export function create(el) {
  el.classList.add('ak-widget');
  el.innerHTML = `
    <div class="ak-stage"></div>
    <div class="ak-bar">
      <button class="ak-play">Pause</button>
      <label class="ak-t">I <input type="range" min="0" max="1000" value="1000" /> A<sub>k</sub></label>
      <button class="ak-reset">Reset</button>
      <span class="ak-hint">Drag the arrow tips</span>
    </div>
    <div class="ak-read">
      <div class="ak-mat"></div>
      <div class="ak-lam"></div>
      <div class="ak-fro"></div>
    </div>`;
  const stage = el.querySelector('.ak-stage');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-svg' }, stage);
  const v = view(W, H, 105, [0.9, 0.55]);
  const defs = s('defs', {}, svg);
  const clip = s('clipPath', { id: 'ak-clip' }, defs);
  s('rect', { x: 0, y: 0, width: W, height: H, rx: 12 }, clip);
  const root = s('g', { 'clip-path': 'url(#ak-clip)' }, svg);
  s('rect', { x: 0, y: 0, width: W, height: H, fill: '#fbfcfe' }, root);

  const R = 9; // grid half-extent in math units
  const baseGrid = s('g', { class: 'ak-grid-base' }, root);
  const grid = s('g', { class: 'ak-grid' }, root);
  for (let i = -R; i <= R; i++) {
    for (const g of [baseGrid, grid]) {
      s('line', { 'data-i': i, 'data-dir': 'v' }, g);
      s('line', { 'data-i': i, 'data-dir': 'h' }, g);
    }
  }
  const square = s('path', { class: 'ak-square' }, root);
  const perpLine = s('line', { class: 'ak-perp', stroke: COL_PERP }, root);
  const eigLine = s('line', { class: 'ak-eig', stroke: COL_EIG }, root);
  const perpLabel = s('text', { class: 'ak-label', fill: COL_PERP }, root);
  const eigLabel = s('text', { class: 'ak-label', fill: COL_EIG }, root);
  perpLabel.textContent = 'fixed: everything ⟂ ẽₖ';
  eigLabel.textContent = 'stretched by λ';

  const probeLink = s('line', { class: 'ak-link' }, root);
  const probe = arrow(root, { width: 2, color: '#9aa3ad' });
  const probeImg = arrow(root, { width: 2.5, color: '#4b5563' });
  const moving = arrow(root, { width: 3, color: '#94a3b8' });
  const arA = arrow(root, { width: 4, head: 14, color: COL_A });
  const arB = arrow(root, { width: 4, head: 14, color: COL_B });
  const labA = s('text', { class: 'ak-vlabel', fill: COL_A }, root);
  const labB = s('text', { class: 'ak-vlabel', fill: COL_B }, root);
  const labP = s('text', { class: 'ak-vlabel small', fill: '#4b5563' }, root);
  labA.textContent = 'ẽₖ';
  labB.textContent = 'ẽₖ₊₁';
  labP.textContent = 'Aₜ v';
  s('circle', { cx: v.px([0, 0])[0], cy: v.px([0, 0])[1], r: 3.5, fill: SEC.ink }, root);

  const handles = {};
  for (const [key, color] of [['a', COL_A], ['b', COL_B], ['p', '#9aa3ad']]) {
    handles[key] = s('circle', { r: key === 'p' ? 9 : 12, class: 'ak-handle', fill: color, 'fill-opacity': 0.18, stroke: color, 'stroke-width': 2 }, svg);
  }

  const DEFAULT = { a: [2, 0.6], b: [1.6, 2.2], p: [-1.2, 1.6] };
  const st = { ...structuredClone(DEFAULT), t: 1, playing: true, phase: 0 };

  const playBtn = el.querySelector('.ak-play');
  const slider = el.querySelector('.ak-t input');
  playBtn.onclick = () => { st.playing = !st.playing; playBtn.textContent = st.playing ? 'Pause' : 'Play'; };
  slider.oninput = () => { st.playing = false; playBtn.textContent = 'Play'; st.t = slider.value / 1000; draw(); };
  el.querySelector('.ak-reset').onclick = () => { Object.assign(st, structuredClone(DEFAULT)); readout(); draw(); };

  for (const key of ['a', 'b', 'p']) {
    draggable(svg, handles[key], {
      onMove: (q) => {
        let m = v.math(q);
        if (key === 'a' && norm(m) < 0.25) m = [0.25 * Math.sign(m[0] || 1), 0];
        st[key] = m;
        readout();
        draw();
      },
    });
  }

  function lineThrough(elm, p, d) {
    const L = 30;
    const [x1, y1] = v.px([p[0] - d[0] * L, p[1] - d[1] * L]);
    const [x2, y2] = v.px([p[0] + d[0] * L, p[1] + d[1] * L]);
    elm.setAttribute('x1', x1); elm.setAttribute('y1', y1); elm.setAttribute('x2', x2); elm.setAttribute('y2', y2);
  }

  function drawGrid(g, M) {
    for (const ln of g.children) {
      const i = +ln.dataset.i;
      const [p, q] = ln.dataset.dir === 'v' ? [[i, -R], [i, R]] : [[-R, i], [R, i]];
      const [x1, y1] = v.px(matvec(M, p));
      const [x2, y2] = v.px(matvec(M, q));
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1); ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      ln.classList.toggle('axis', i === 0);
    }
  }

  function labelAt(t, p, off = [10, -10]) {
    const [x, y] = v.px(p);
    t.setAttribute('x', x + off[0]);
    t.setAttribute('y', y + off[1]);
  }

  function draw() {
    const { a, b, p, t } = st;
    const I = [[1, 0], [0, 1]];
    const M = fitTransition(a, b, t);
    drawGrid(baseGrid, I);
    drawGrid(grid, M);
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]].map((q) => v.px(matvec(M, q)));
    square.setAttribute('d', `M${sq.map((q) => q.join(',')).join('L')}Z`);

    const na = norm(a);
    const perp = [-a[1] / na, a[0] / na];
    lineThrough(perpLine, [0, 0], perp);
    labelAt(perpLabel, [-perp[0] * 2.2, -perp[1] * 2.2], [10, 4]);
    const d = sub(b, a);
    const nd = norm(d);
    eigLine.style.display = eigLabel.style.display = nd < 1e-6 ? 'none' : '';
    if (nd > 1e-6) {
      lineThrough(eigLine, [0, 0], [d[0] / nd, d[1] / nd]);
      labelAt(eigLabel, [(-d[0] / nd) * 2.6, (-d[1] / nd) * 2.6], [8, 14]);
    }

    const O = v.px([0, 0]);
    const Ma = matvec(M, a);
    moving.set(O, v.px(Ma));
    arA.set(O, v.px(a));
    arB.set(O, v.px(b));
    probe.set(O, v.px(p));
    const Mp = matvec(M, p);
    probeImg.set(O, v.px(Mp));
    const [px1, py1] = v.px(p), [px2, py2] = v.px(Mp);
    probeLink.setAttribute('x1', px1); probeLink.setAttribute('y1', py1);
    probeLink.setAttribute('x2', px2); probeLink.setAttribute('y2', py2);
    labelAt(labA, a, [8, 22]);
    labelAt(labB, b, [10, -8]);
    labelAt(labP, Mp, [8, -8]);
    for (const k of ['a', 'b', 'p']) {
      const [x, y] = v.px(st[k]);
      handles[k].setAttribute('cx', x);
      handles[k].setAttribute('cy', y);
    }
    slider.value = Math.round(t * 1000);
  }

  const mat = el.querySelector('.ak-mat'), lam = el.querySelector('.ak-lam'), fro = el.querySelector('.ak-fro');
  function readout() {
    const { a, b } = st;
    const A = fitTransition(a, b);
    setTex(mat, `A_k = \\begin{bmatrix} ${fmt(A[0][0])} & ${fmt(A[0][1])} \\\\ ${fmt(A[1][0])} & ${fmt(A[1][1])} \\end{bmatrix}`);
    const l = dot(a, b) / dot(a, a);
    setTex(lam, `\\lambda = \\frac{\\tilde e_k^{\\mathsf T}\\tilde e_{k+1}}{\\|\\tilde e_k\\|^2} = ${fmt(l)} = \\det A_k`);
    setTex(fro, `\\|A_k - I\\|_F = \\frac{\\|\\tilde e_{k+1}-\\tilde e_k\\|}{\\|\\tilde e_k\\|} = ${fmt(norm(sub(b, a)) / norm(a))}`);
  }

  // Morph I → A_k → I: ease, then hold at each end so the eye can compare.
  let raf = 0, last = 0, active = false;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.5, (now - (last || now)) / 1000); // tolerate throttled frames
    last = now;
    if (!st.playing) return;
    st.phase = (st.phase + dt / 6) % 1; // 6 s per cycle
    const ph = st.phase;
    const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    st.t = ph < 0.35 ? ease(ph / 0.35) : ph < 0.5 ? 1 : ph < 0.85 ? 1 - ease((ph - 0.5) / 0.35) : 0;
    draw();
  }

  readout();
  draw();
  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) { last = 0; raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
    },
    destroy() { cancelAnimationFrame(raf); el.innerHTML = ''; },
  };
}
