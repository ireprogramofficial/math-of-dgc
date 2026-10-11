// The reachable cone and NNLS, as a live version of the pptx's "conceptual visual".
// Toy 2-D linear time-varying system: x(k+1) = A_k x(k) + B u(k), u ≥ 0, with A_k a slow inward spiral (the
// "inferred dynamics" of the cycle). Every column of R is Φ(K, j+1) b_m: TF m dosed at step j, carried to the end by
// the drift. NNLS picks the nonnegative doses U* whose endpoint x_drift + R U* is closest to the target.
//
// "Last step only" keeps only the j = K−1 columns (Φ = I), so each TF is a single ray, as drawn in the pptx.
// "Every step" uses all of R, and the drift fans each TF out into a wedge.
import { arrow, draggable, fmt, s, setTex, view } from '../lib/svg.js';
import { add, matmul, matvec, nnls, norm, scale, sub } from '../lib/linalg.js';
import { SEC, TF_COLORS } from '../lib/colors.js';

const W = 1240, H = 600, PW = 900;      // svg size; the plane is centered in the left PW px
const K = 10;                           // time points, so K − 1 steps
const DEG = Math.PI / 180;
const R_DATA = 1.55;                    // radius of the region the dynamics were inferred from

// A_k: rotate clockwise ~11° and shrink a little, varying with k (time-varying, like the real A_k).
function Ak(k) {
  const th = -(11 + 4 * Math.sin(0.9 * k)) * DEG, r = 0.965 + 0.015 * Math.sin(1.3 * k);
  return [[r * Math.cos(th), -r * Math.sin(th)], [r * Math.sin(th), r * Math.cos(th)]];
}
const A = Array.from({ length: K }, (_, k) => Ak(k));          // A[k] for k = 1..K−1
// PHI[j] = Φ(K, j+1) = A_{K−1} ⋯ A_{j+1}  (identity for j = K−1)
const PHI = [];
for (let j = K - 1; j >= 1; j--) PHI[j] = j === K - 1 ? [[1, 0], [0, 1]] : matmul(PHI[j + 1], A[j + 1]);

const DEFAULT = () => ({
  x1: [1.3 * Math.cos(165 * DEG), 1.3 * Math.sin(165 * DEG)],
  xT: [2.7, 1.9],
  tfs: [{ b: [1, 0.12], on: true }, { b: [0.45, 0.9], on: false }, { b: [-0.35, 0.95], on: false }],
  every: false,
  showCols: false,
});

export function create(el) {
  el.classList.add('cone-widget');
  el.innerHTML = `
    <div class="cone-stage"></div>
    <div class="cone-inset"><div class="cone-inset-title">Transcription factors <span>(drag the tips)</span></div><div class="cone-inset-plot"></div><div class="cone-chips"></div></div>
    <div class="cone-bar">
      <span class="cone-seg"><button data-every="0" class="on">Dose at last step only</button><button data-every="1">Dose at every step</button></span>
      <label class="cone-cols"><input type="checkbox" /> Show every column of 𝓡</label>
      <button class="cone-reset">Reset</button>
    </div>
    <div class="cone-read">
      <div class="cone-d0"></div><div class="cone-ds"></div><div class="cone-mu"></div>
      <div class="cone-bars-title">Doses U* (rows: TFs, columns: steps)</div>
      <svg class="cone-bars" viewBox="0 0 300 92"></svg>
    </div>
    <div class="cone-eq"></div>`;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cone-svg' }, el.querySelector('.cone-stage'));
  const v = view(PW, H, 122, [0.7, 0.85]);
  const defs = s('defs', {}, svg);
  const grad = s('radialGradient', { id: 'cone-glow' }, defs);
  s('stop', { offset: '0%', 'stop-color': '#dbe6f3', 'stop-opacity': 0.9 }, grad);
  s('stop', { offset: '100%', 'stop-color': '#dbe6f3', 'stop-opacity': 0 }, grad);
  const O = v.px([0, 0]);

  // ---- static backdrop: glow, contour rings, the drift field ----
  s('circle', { cx: O[0], cy: O[1], r: 2.3 * v.scale, fill: 'url(#cone-glow)' }, svg);
  for (let r = 0.3; r < 5; r += 0.3) s('circle', { cx: O[0], cy: O[1], r: r * v.scale, class: 'cone-ring' }, svg);
  const field = s('g', { class: 'cone-field' }, svg);
  for (let gx = -3; gx <= 5; gx += 0.3) {
    for (let gy = -2.5; gy <= 3; gy += 0.3) {
      const p = [gx, gy], d = norm(p);
      const q = add(p, scale(sub(matvec(A[3], p), p), 1.15));
      const inside = d < R_DATA;
      const op = inside ? 0.6 : Math.max(0, 0.42 - (d - R_DATA) * 0.12);
      if (op <= 0.02) continue;
      const a = arrow(field, { width: 1.2, head: 5, color: inside ? '#4a78b5' : '#9fb0c6' });
      a.set(v.px(p), v.px(q));
      a.g.setAttribute('opacity', op);
    }
  }
  s('circle', { cx: O[0], cy: O[1], r: R_DATA * v.scale, class: 'cone-data' }, svg);
  const lp = v.px([R_DATA * 1.06 * Math.cos(232 * DEG), R_DATA * 1.06 * Math.sin(232 * DEG)]);
  const t1 = s('text', { x: lp[0], y: lp[1], class: 'cone-note strong', 'text-anchor': 'end' }, svg);
  t1.textContent = 'inferred dynamics';
  const t2 = s('text', { ...Object.fromEntries(['x', 'y'].map((k, i) => [k, v.px([3.0, -0.9])[i]])), class: 'cone-note', 'text-anchor': 'middle' }, svg);
  t2.textContent = 'extrapolated dynamics';

  // ---- dynamic layers ----
  const conePoly = s('path', { class: 'cone-region' }, svg);
  const rays = s('g', { class: 'cone-rays' }, svg);
  const driftPath = s('path', { class: 'cone-drift' }, svg);
  const driftDots = s('g', {}, svg);
  const trajPath = s('path', { class: 'cone-traj' }, svg);
  const pushes = s('g', {}, svg);
  const d0Line = s('line', { class: 'cone-d0line' }, svg);
  const dsLine = s('line', { class: 'cone-dsline' }, svg);
  const endDot = s('circle', { r: 7, class: 'cone-end' }, svg);
  const endLab = s('text', { class: 'cone-label', 'text-anchor': 'middle' }, svg);
  const driftDot = s('circle', { r: 9, class: 'cone-driftdot' }, svg);
  const driftLab = s('text', { class: 'cone-label', 'text-anchor': 'middle' }, svg);
  driftLab.textContent = 'drift';
  const initDot = s('circle', { r: 10, class: 'cone-init' }, svg);
  const initLab = s('text', { class: 'cone-label', 'text-anchor': 'end' }, svg);
  initLab.textContent = 'initial';
  const target = s('g', { class: 'cone-target' }, svg);
  s('path', { d: 'M0,-9L9,0L0,9L-9,0Z', fill: SEC.optimization }, target);
  s('rect', { x: 14, y: -58, width: 62, height: 50, class: 'cone-target-box' }, target);
  const tl = s('text', { x: 45, y: -26, class: 'cone-target-text', 'text-anchor': 'middle' }, target);
  tl.innerHTML = 'x<tspan baseline-shift="sub" font-size="15">T</tspan>';

  // ---- inset: TF directions ----
  const IW = 200, IH = 132, IS = 52;
  const isvg = s('svg', { viewBox: `0 0 ${IW} ${IH}` }, el.querySelector('.cone-inset-plot'));
  const IO = [IW / 2 - 20, IH / 2 + 22];
  s('line', { x1: 10, y1: IO[1], x2: IW - 10, y2: IO[1], class: 'cone-axis' }, isvg);
  s('line', { x1: IO[0], y1: 6, x2: IO[0], y2: IH - 6, class: 'cone-axis' }, isvg);
  const insetArrows = TF_COLORS.map((c) => arrow(isvg, { width: 3, head: 11, color: c }));
  const insetHandles = TF_COLORS.map((c) => s('circle', { r: 9, fill: c, 'fill-opacity': 0.15, stroke: c, 'stroke-width': 1.5 }, isvg));
  const insetPx = (b) => [IO[0] + b[0] * IS, IO[1] - b[1] * IS];

  let st = DEFAULT();
  let sol = null;
  let grow = 1, growing = false, growStart = 0; // trajectory reveal progress

  const chips = el.querySelector('.cone-chips');
  st.tfs.forEach((_, m) => {
    const b = document.createElement('button');
    b.className = 'chip cone-chip';
    b.style.setProperty('--c', TF_COLORS[m]);
    b.textContent = `TF ${m + 1}`;
    b.onclick = () => { st.tfs[m].on = !st.tfs[m].on; changed(true); };
    chips.append(b);
  });
  const segBtns = [...el.querySelectorAll('.cone-seg button')];
  segBtns.forEach((b) => (b.onclick = () => { st.every = b.dataset.every === '1'; changed(true); }));
  const colsBox = el.querySelector('.cone-cols input');
  colsBox.onchange = () => { st.showCols = colsBox.checked; changed(false); };
  el.querySelector('.cone-reset').onclick = () => { st = DEFAULT(); changed(true); };

  draggable(svg, target, { onMove: (q) => { st.xT = v.math(q); changed(false); } });
  draggable(svg, initDot, { onMove: (q) => { st.x1 = v.math(q); changed(false); } });
  insetHandles.forEach((h, m) => draggable(isvg, h, {
    onMove: ([x, y]) => {
      let b = [(x - IO[0]) / IS, (IO[1] - y) / IS];
      const L = norm(b);
      if (L < 0.35) b = scale(b, 0.35 / (L || 1));
      if (L > 1.5) b = scale(b, 1.5 / L);
      st.tfs[m].b = b;
      changed(false);
    },
  }));

  function solve() {
    const steps = st.every ? [...Array(K - 1).keys()].map((i) => i + 1) : [K - 1];
    const cols = [];
    st.tfs.forEach((tf, m) => { if (tf.on) for (const j of steps) cols.push({ m, j, vec: matvec(PHI[j], tf.b) }); });
    const drift = [st.x1];
    for (let k = 1; k < K; k++) drift.push(matvec(A[k], drift[k - 1]));
    const xd = drift[K - 1];
    const z = sub(st.xT, xd);
    const U = cols.length ? nnls([cols.map((c) => c.vec[0]), cols.map((c) => c.vec[1])], z) : [];
    // Controlled trajectory: apply each dose at its step.
    const u = Array.from({ length: K }, () => st.tfs.map(() => 0));
    cols.forEach((c, i) => { u[c.j][c.m] += U[i]; });
    const traj = [st.x1];
    for (let k = 1; k < K; k++) {
      let x = matvec(A[k], traj[k - 1]);
      st.tfs.forEach((tf, m) => { x = add(x, scale(tf.b, u[k][m])); });
      traj.push(x);
    }
    const end = traj[K - 1];
    return { cols, U, u, drift, xd, traj, end, d0: norm(z), ds: norm(sub(end, st.xT)) };
  }

  // Chaikin corner cutting: a smooth path through the step points that never overshoots or loops.
  function smooth(pts, iters = 3) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      const q = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const [a, b] = [p[i], p[i + 1]];
        q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  }
  const pathD = (pts) => 'M' + pts.map((p) => v.px(p).map((q) => q.toFixed(1)).join(',')).join('L');
  const setLine = (ln, p, q) => { const [a, b] = [v.px(p), v.px(q)]; ln.setAttribute('x1', a[0]); ln.setAttribute('y1', a[1]); ln.setAttribute('x2', b[0]); ln.setAttribute('y2', b[1]); };
  const place = (node, p, dx = 0, dy = 0) => { const q = v.px(p); node.setAttribute('x', q[0] + dx); node.setAttribute('y', q[1] + dy); };

  // The cone {x_drift + R U : U ≥ 0}: find the widest empty angular gap between column directions.
  function coneShape(cols) {
    if (!cols.length) return null;
    const angs = cols.map((c) => Math.atan2(c.vec[1], c.vec[0])).sort((a, b) => a - b);
    let gap = 2 * Math.PI - (angs[angs.length - 1] - angs[0]), from = angs[0], to = angs[angs.length - 1];
    for (let i = 0; i < angs.length - 1; i++) {
      const g = angs[i + 1] - angs[i];
      if (g > gap) { gap = g; from = angs[i + 1]; to = angs[i] + 2 * Math.PI; }
    }
    if (gap <= Math.PI) return { all: true };
    return { from, to };
  }

  function draw() {
    const { cols, U, drift, xd, traj, end, d0, ds } = sol;
    const L = 14;
    // cone region
    const cone = coneShape(cols);
    if (!cone) conePoly.setAttribute('d', '');
    else if (cone.all) conePoly.setAttribute('d', `M0,0H${W}V${H}H0Z`);
    else {
      const pts = [xd];
      for (let a = cone.from; a <= cone.to + 1e-9; a += Math.max(0.02, (cone.to - cone.from) / 40)) pts.push(add(xd, [L * Math.cos(a), L * Math.sin(a)]));
      pts.push(add(xd, [L * Math.cos(cone.to), L * Math.sin(cone.to)]));
      conePoly.setAttribute('d', pathD(pts) + 'Z');
    }
    // rays: all columns when asked, otherwise one per TF (its least-rotated column, the last-step one)
    rays.replaceChildren();
    const shown = st.showCols && st.every ? cols : cols.filter((c) => c.j === K - 1);
    for (const c of shown) {
      const dir = scale(c.vec, 1 / norm(c.vec));
      const ln = s('line', { class: 'cone-ray', stroke: TF_COLORS[c.m] }, rays);
      if (st.showCols && st.every) ln.setAttribute('opacity', 0.35 + (0.65 * c.j) / (K - 1));
      setLine(ln, xd, add(xd, scale(dir, L)));
      if (c.j === K - 1) {
        const lab = s('text', { class: 'cone-raylab', fill: TF_COLORS[c.m] }, rays);
        lab.textContent = `TF ${c.m + 1}`;
        const p = add(xd, scale(dir, 2.15));
        place(lab, p, 8, -6);
      }
    }
    if (st.showCols && st.every && cols.length) {
      const lab = s('text', { class: 'cone-raylab dim' }, rays);
      lab.textContent = 'paler = dosed earlier, rotated further by the drift';
      place(lab, add(xd, [0.15, -0.55]), 0, 0);
    }
    // drift (no input)
    driftPath.setAttribute('d', pathD(smooth(drift)));
    driftDots.replaceChildren();
    drift.slice(1, -1).forEach((p) => { const q = v.px(p); s('circle', { cx: q[0], cy: q[1], r: 4.5, class: 'cone-dot' }, driftDots); });
    // optimal trajectory, revealed progressively
    const sm = smooth(traj);
    const nShow = Math.max(2, Math.round(grow * (sm.length - 1)) + 1);
    trajPath.setAttribute('d', cols.length ? pathD(sm.slice(0, nShow)) : '');
    pushes.replaceChildren();
    const maxU = Math.max(1e-9, ...sol.u.flat());
    for (let k = 1; k < K; k++) {
      if ((k - 1) / (K - 1) > grow) break;
      st.tfs.forEach((tf, m) => {
        const uk = sol.u[k][m];
        if (uk <= 1e-6) return;
        const len = 0.18 + 0.42 * (uk / maxU);
        const dir = scale(tf.b, 1 / norm(tf.b));
        const p = traj[k - 1];
        arrow(pushes, { width: 2.5, head: 9, color: TF_COLORS[m] }).set(v.px(p), v.px(add(p, scale(dir, len))));
      });
    }
    // distances
    setLine(d0Line, xd, st.xT);
    const showEnd = cols.length && grow >= 1;
    dsLine.style.display = endDot.style.display = endLab.style.display = showEnd ? '' : 'none';
    if (showEnd) {
      setLine(dsLine, end, st.xT);
      const q = v.px(end);
      endDot.setAttribute('cx', q[0]); endDot.setAttribute('cy', q[1]);
      endLab.textContent = ds < 1e-3 ? 'reaches the target' : 'closest reachable endpoint';
      place(endLab, end, 0, ds < 1e-3 ? 30 : 26);
    }
    // points
    const [dx, dy] = v.px(xd);
    driftDot.setAttribute('cx', dx); driftDot.setAttribute('cy', dy);
    place(driftLab, xd, 0, 28);
    const [ix, iy] = v.px(st.x1);
    initDot.setAttribute('cx', ix); initDot.setAttribute('cy', iy);
    place(initLab, st.x1, -14, 5);
    const [tx, ty] = v.px(st.xT);
    target.setAttribute('transform', `translate(${tx},${ty})`);
    // inset
    st.tfs.forEach((tf, m) => {
      insetArrows[m].set(IO, insetPx(tf.b));
      insetArrows[m].g.setAttribute('opacity', tf.on ? 1 : 0.25);
      const [hx, hy] = insetPx(tf.b);
      insetHandles[m].setAttribute('cx', hx); insetHandles[m].setAttribute('cy', hy);
    });
  }

  const d0El = el.querySelector('.cone-d0'), dsEl = el.querySelector('.cone-ds'), muEl = el.querySelector('.cone-mu');
  const bars = el.querySelector('.cone-bars'), eqEl = el.querySelector('.cone-eq');
  function readout() {
    const { d0, ds } = sol;
    setTex(d0El, `d_0 = \\|x_{\\text{drift}} - x_T\\| = ${fmt(d0)}`);
    setTex(dsEl, `d_* = \\min_{U \\ge 0} \\|\\mathcal{R}U - z\\| = ${fmt(ds)}`);
    setTex(muEl, `\\mu = d_0 - d_* = ${fmt(d0 - ds)}, \\quad \\hat\\mu = ${Math.round((100 * (d0 - ds)) / (d0 || 1))}\\%`);
    // dose bars
    bars.replaceChildren();
    const on = st.tfs.map((tf, m) => m).filter((m) => st.tfs[m].on);
    const maxU = Math.max(1e-9, ...sol.u.flat());
    const rowH = 92 / 3, cw = 300 / (K - 1);
    st.tfs.forEach((tf, m) => {
      const y0 = m * rowH;
      s('line', { x1: 0, x2: 300, y1: y0 + rowH - 3, y2: y0 + rowH - 3, class: 'cone-bar-base' }, bars);
      for (let k = 1; k < K; k++) {
        const h = (sol.u[k][m] / maxU) * (rowH - 6);
        if (h > 0.3) s('rect', { x: (k - 1) * cw + 3, y: y0 + rowH - 3 - h, width: cw - 6, height: h, fill: TF_COLORS[m] }, bars);
      }
      if (!tf.on) s('text', { x: 4, y: y0 + rowH - 8, class: 'cone-bar-off' }, bars).textContent = `TF ${m + 1} off`;
    });
    const sub = on.length ? on.map((m) => `\\textcolor{${TF_COLORS[m]}}{${m + 1}}`).join('') : '\\varnothing';
    setTex(eqEl, `x(k+1) = A_k\\,x(k) + B_{${sub}}\\,u(k), \\quad u(k) \\ge 0`, true);
  }

  function changed(animate) {
    sol = solve();
    chips.querySelectorAll('button').forEach((b, m) => b.classList.toggle('on', st.tfs[m].on));
    segBtns.forEach((b) => b.classList.toggle('on', (b.dataset.every === '1') === st.every));
    colsBox.disabled = !st.every;
    colsBox.checked = st.showCols;
    el.querySelector('.cone-cols').classList.toggle('disabled', !st.every);
    if (animate) { grow = 0; growing = true; growStart = performance.now(); } else if (!growing) grow = 1;
    readout();
    draw();
  }

  let raf = 0, active = false;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!growing) return;
    grow = Math.min(1, (now - growStart) / 1600);
    if (grow >= 1) growing = false;
    draw();
  }

  changed(false);
  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) { grow = 0; growing = true; growStart = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
    },
    destroy() { cancelAnimationFrame(raf); el.innerHTML = ''; },
  };
}
