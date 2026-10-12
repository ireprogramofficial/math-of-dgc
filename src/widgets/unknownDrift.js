// Slide: unknown drift. The same river as before, but the flow is hidden: all we have are samples.
//   basin 2: a time series of states that roughly circles the basin's fixed point (the gyre)
//   basin 1: a single sample
// The samples come from the true (hidden) flow, with a little measurement jitter.
// Buttons show the actual drift, or one of three drifts *fitted* to the same samples, each consistent with the data
// and very different away from it:
//   fit 1  one linear model  x' = A x + b  fit to basin 2, extrapolated everywhere (as DGC does with its A[k])
//   fit 2  a kernel average of the sampled velocities: the gyre where there is data, still water everywhere else
//   fit 3  a quadratic polynomial drift (12 parameters) fit by least squares to the same samples: more flexible
//          than fit 1, equally consistent with the data, and it extrapolates very differently
// All three use only the samples: no knowledge of the channels, inlet, outlets, or the other basins.
import katex from 'katex';
import { FlowField } from '../river/flowfield.js';
import { RiverView } from '../river/view.js';
import { COLORS } from './draw.js';
import { h } from './ui.js';

const SERIES = { count: 26, every: 28, from: -40 }; // samples, seconds apart, start offset (m) below the fixed point
const JITTER = 3;            // meters of measurement noise
const APPEAR_SECONDS = 0.18; // the samples arrive one by one
const MAX_SPEED = 1.6;       // fitted fields are clipped to a plausible speed (m/s) when extrapolated

/** Point of slowest flow near (x, y): the basin's fixed point. */
function fixedPoint(flow, x, y, r = 60) {
  let best = [x, y, Infinity];
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) {
    const s = flow.speedAt(x + dx, y + dy);
    if (s < best[2]) best = [x + dx, y + dy, s];
  }
  return best;
}

/** Positions along the true flow, p' = w(p), every `every` seconds (RK4, 4 s steps). */
function sampleSeries(flow, p, count, every) {
  const w = [0, 0], f = (q) => { flow.velocity(q[0], q[1], w); return [w[0], w[1]]; };
  const out = [p.slice()], h = 4, steps = Math.round(every / h);
  for (let i = 1; i < count; i++) {
    for (let s = 0; s < steps; s++) {
      const k1 = f(p), k2 = f([p[0] + 0.5 * h * k1[0], p[1] + 0.5 * h * k1[1]]);
      const k3 = f([p[0] + 0.5 * h * k2[0], p[1] + 0.5 * h * k2[1]]), k4 = f([p[0] + h * k3[0], p[1] + h * k3[1]]);
      p = [p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    }
    out.push(p.slice());
  }
  return out;
}

// deterministic jitter, so the "data" is the same on every visit
function jitter(points, amp) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return points.map(([x, y]) => [x + amp * rnd(), y + amp * rnd()]);
}

/** Velocity estimates from the time series (central differences): [{ x, y, vx, vy }]. */
function velocitySamples(series, dt) {
  const out = [];
  for (let i = 1; i < series.length - 1; i++) {
    out.push({ x: series[i][0], y: series[i][1], vx: (series[i + 1][0] - series[i - 1][0]) / (2 * dt), vy: (series[i + 1][1] - series[i - 1][1]) / (2 * dt) });
  }
  return out;
}

/** Least-squares fit of w(p) = A (p - m) + b. Returns (x, y, out) -> out = [u, v]. */
function fitLinear(samples) {
  const n = samples.length, mx = samples.reduce((s, q) => s + q.x, 0) / n, my = samples.reduce((s, q) => s + q.y, 0) / n;
  // normal equations for [dx dy 1] theta = v, one per velocity component
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (const q of samples) {
    const r = [q.x - mx, q.y - my, 1];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; rx[a] += r[a] * q.vx; ry[a] += r[a] * q.vy; }
  }
  const solve = (A, y) => { // 3x3 Gaussian elimination
    const m = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return m.map((row, i) => row[3] / row[i]);
  };
  const tx = solve(M, rx), ty = solve(M, ry);
  return (x, y, out) => { out[0] = tx[0] * (x - mx) + tx[1] * (y - my) + tx[2]; out[1] = ty[0] * (x - mx) + ty[1] * (y - my) + ty[2]; return out; };
}

/** Kernel (Nadaraya-Watson) average of the samples; `conf` is how much data supports each point (0..1). */
function fitKernel(samples, sigma = 35, eps = 0.4) {
  return (x, y, out) => {
    let sw = 0, su = 0, sv = 0;
    for (const q of samples) {
      const k = Math.exp(-((x - q.x) ** 2 + (y - q.y) ** 2) / (2 * sigma * sigma));
      sw += k; su += k * q.vx; sv += k * q.vy;
    }
    out[0] = su / (sw + eps); out[1] = sv / (sw + eps); out[2] = sw / (sw + eps);
    return out;
  };
}

/**
 * Least-squares fit of a quadratic polynomial drift: each velocity component is
 * c0 + c1 dx + c2 dy + c3 dx^2 + c4 dx dy + c5 dy^2, with (dx, dy) centered and scaled.
 * The samples lie close to a circle, which makes dx^2 + dy^2 nearly constant (nearly redundant with c0),
 * so a tiny ridge penalty on the quadratic terms keeps the problem well-posed.
 */
function fitQuadratic(samples, ridge = 1e-3) {
  const n = samples.length;
  const mx = samples.reduce((a, q) => a + q.x, 0) / n, my = samples.reduce((a, q) => a + q.y, 0) / n;
  const sc = Math.sqrt(samples.reduce((a, q) => a + (q.x - mx) ** 2 + (q.y - my) ** 2, 0) / n) || 1;
  const feat = (x, y) => { const a = (x - mx) / sc, b = (y - my) / sc; return [1, a, b, a * a, a * b, b * b]; };
  const d = 6, M = Array.from({ length: d }, () => new Array(d).fill(0)), rx = new Array(d).fill(0), ry = new Array(d).fill(0);
  for (const q of samples) {
    const f = feat(q.x, q.y);
    for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) M[i][j] += f[i] * f[j]; rx[i] += f[i] * q.vx; ry[i] += f[i] * q.vy; }
  }
  for (let i = 3; i < d; i++) M[i][i] += ridge * n;
  const solve = (A, y) => { // Gaussian elimination with partial pivoting
    const m = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < d; c++) {
      let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < d; r++) if (r !== c) { const k = m[r][c] / m[c][c]; for (let j = c; j <= d; j++) m[r][j] -= k * m[c][j]; }
    }
    return m.map((row, i) => row[d] / row[i]);
  };
  const cx = solve(M, rx), cy = solve(M, ry);
  return (x, y, out) => {
    const f = feat(x, y);
    out[0] = 0; out[1] = 0;
    for (let i = 0; i < d; i++) { out[0] += cx[i] * f[i]; out[1] += cy[i] * f[i]; }
    return out;
  };
}

/** RMS mismatch (m/s) between a fitted drift and the sampled velocities. */
export function fitResidual(fn, samples) {
  const o = [0, 0, 0];
  let s2 = 0;
  for (const q of samples) { fn(q.x, q.y, o); s2 += (o[0] - q.vx) ** 2 + (o[1] - q.vy) ** 2; }
  return Math.sqrt(s2 / samples.length);
}

/** A FlowField on the actual river's grid, from a velocity function (clipped to MAX_SPEED). */
function fieldFrom(actual, fn) {
  const { nx, ny, cell } = actual, u = new Float32Array(nx * ny), v = new Float32Array(nx * ny), o = [0, 0, 0];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    fn((i + 0.5) * cell, (j + 0.5) * cell, o, k);
    const s = Math.hypot(o[0], o[1]), c = s > MAX_SPEED ? MAX_SPEED / s : 1;
    u[k] = o[0] * c; v[k] = o[1] * c;
  }
  return new FlowField({ ...actual, u, v });
}

function buildFits(actual, series, dt) {
  const samples = velocitySamples(series, dt);
  const lin = fitLinear(samples), ker = fitKernel(samples), quad = fitQuadratic(samples);
  const fit1 = fieldFrom(actual, (x, y, o) => lin(x, y, o));
  const fit2 = fieldFrom(actual, (x, y, o) => ker(x, y, o));
  const fit3 = fieldFrom(actual, (x, y, o) => quad(x, y, o));
  const residuals = { fit1: fitResidual(lin, samples), fit2: fitResidual(ker, samples), fit3: fitResidual(quad, samples) };
  return { fit1, fit2, fit3, residuals };
}

const MODES = {
  hidden: { tex: String.raw`\dot{x} = f(x), \quad f = \textcolor{#c0392b}{?}`, note: '' },
  actual: { button: 'Reveal actual drift', tex: String.raw`\dot{x} = f(x)`, note: 'The actual drift' },
  fit1: { button: 'Fit drift 1', tex: String.raw`\dot{x} = \hat{f}_1(x) = A\,x + b`, note: 'One linear model fit to basin 2, extrapolated everywhere' },
  fit2: { button: 'Fit drift 2', tex: String.raw`\dot{x} = \hat{f}_2(x)`, note: 'Only where there is data; still water everywhere else' },
  fit3: { button: 'Fit drift 3', tex: String.raw`\dot{x} = \hat{f}_3(x) = \text{quadratic in } x`, note: 'A richer model fit to the same samples, extrapolated everywhere' },
};

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: 'triangle', interactive: true, labels: false });
  view.setFlowHidden(true);
  const label = h('div', { class: 'map-math' });
  const buttons = Object.entries(MODES).filter(([, m]) => m.button).map(([key, m]) => {
    const b = h('button', { type: 'button', class: 'map-action', 'data-mode': key }, m.button);
    b.addEventListener('click', () => setMode(mode === key ? 'hidden' : key));
    return b;
  });
  stage.append(label, h('div', { class: 'map-actions' }, ...buttons));
  el.append(stage);

  let series = [], single = null, shownAt = 0, actual = null, fits = null, mode = 'hidden';

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    label.innerHTML = katex.renderToString(m.tex, { throwOnError: false }) + (m.note ? `<div class="map-math-note">${m.note}</div>` : '');
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (!actual) return;
    view.setFlowHidden(mode === 'hidden');
    view.showField(mode === 'hidden' || mode === 'actual' ? actual : fits[mode]);
  }
  setMode('hidden');

  view.onFlow = ((prev) => (flow, scn) => {
    prev?.(flow, scn);
    actual = flow;
    const [, b1, b2] = scn.swirls;
    const c2 = fixedPoint(flow, b2.x, b2.y), c1 = fixedPoint(flow, b1.x, b1.y);
    series = jitter(sampleSeries(flow, [c2[0], c2[1] + SERIES.from], SERIES.count, SERIES.every), JITTER);
    single = jitter([[c1[0] + 30, c1[1] + 22]], JITTER)[0];
    fits = buildFits(flow, series, SERIES.every);
    shownAt = performance.now();
    setMode(mode);
  })(view.onFlow);

  view.onDraw = (ctx) => {
    if (!series.length) return;
    const cam = view.camera, p = [0, 0];
    const n = Math.min(series.length, Math.floor((performance.now() - shownAt) / 1000 / APPEAR_SECONDS) + 1);
    ctx.save();
    // time series: light (early) to dark (late)
    for (let i = 0; i < n; i++) {
      cam.worldToScreen(series[i][0], series[i][1], p);
      const t = i / (series.length - 1);
      ctx.fillStyle = `rgb(${Math.round(150 - 128 * t)}, ${Math.round(175 - 135 * t)}, ${Math.round(205 - 144 * t)})`;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, 6.283); ctx.fill(); ctx.stroke();
    }
    // the single sample
    cam.worldToScreen(single[0], single[1], p);
    ctx.fillStyle = COLORS.ink; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 6.283); ctx.fill(); ctx.stroke();
    // captions
    const caption = (text, x, y) => {
      cam.worldToScreen(x, y, p);
      ctx.font = '600 13px "Source Sans Pro", system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.fillStyle = COLORS.ink;
      ctx.strokeText(text, p[0], p[1]); ctx.fillText(text, p[0], p[1]);
    };
    const sc = view.scenario.swirls;
    caption('basin 2: time series', sc[2].x + sc[2].R + 12, sc[2].y);
    caption('basin 1: one sample', sc[1].x + sc[1].R + 12, sc[1].y);
    caption('source', sc[0].x - 22, sc[0].y + 4);
    ctx.restore();
  };

  if (import.meta.env?.DEV) window.__unknown = { view, get fits() { return fits; }, setMode }; // dev-only debugging hook
  return {
    setActive(on) {
      view.setActive(on);
      if (on) { shownAt = performance.now(); setMode('hidden'); } // always start not knowing f
    },
    destroy: () => view.destroy(),
  };
}
