// A river as a vector field: the map, an optional math label on it, and the shared (quiet) controls below.
// With data-probe, a click in the water starts a trajectory x(t) = phi_t(x0) from that point (at rest),
// shown with its live state vector; it fades out after PROBE_SECONDS. One trajectory at a time.
import katex from 'katex';
import { BoatModel, NU } from '../control/boat.js';
import { LiveBoat } from '../control/liveBoat.js';
import { RiverView } from '../river/view.js';
import { COLORS } from './draw.js';
import { createMapControls } from './mapControls.js';
import { createStateReadout } from './stateReadout.js';
import { h } from './ui.js';

const PROBE_SECONDS = 5, FADE_SECONDS = 1.5, TIME_SCALE = 40, MAX_STEP = 0.5;

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: el.dataset.scenario ?? 'meander' });
  if (el.dataset.label) {
    const label = h('div', { class: 'map-math' });
    label.innerHTML = katex.renderToString(el.dataset.label, { throwOnError: false });
    stage.append(label);
  }
  const controls = createMapControls(view);
  el.append(stage, controls.el);
  view.ready.then(() => controls.refresh());
  if ('probe' in el.dataset) addProbe(view, stage);
  if (import.meta.env?.DEV) window.__gallery = view; // dev-only debugging hook
  return { setActive: (on) => view.setActive(on), destroy: () => view.destroy(), view };
}

function addProbe(view, stage) {
  const readout = createStateReadout(stage);
  const hint = h('div', { class: 'map-hint' }, 'Click the river to choose ', h('span', { html: katex.renderToString('x_0', { throwOnError: false }) }));
  stage.append(hint);
  const zero = new Float64Array(NU);
  let model = null, probe = null;

  view.onFlow = ((prev) => (flow, scn) => { prev?.(flow, scn); model = new BoatModel(flow); probe = null; readout.hide(); })(view.onFlow);
  if (view.flow) model = new BoatModel(view.flow);

  view.onClick = (w) => {
    if (!model || !view.flow.isWater(w[0], w[1], 3)) return;
    const boat = new LiveBoat(model);
    boat.x.set([w[0], w[1], 0, 0]); // start at rest
    probe = { boat, x0: [w[0], w[1]], pts: [[w[0], w[1]]], age: 0 };
    hint.style.display = 'none';
  };

  view.addTool({ hover: (w) => (view.flow?.isWater(w[0], w[1], 3) ? 'crosshair' : null) });

  view.onDraw = (ctx, v, now, dt) => {
    if (!probe) return;
    dt = Math.min(dt, 0.12);
    probe.age += dt;
    if (probe.age > PROBE_SECONDS) { probe = null; readout.hide(); return; }
    const sim = dt * TIME_SCALE, n = Math.max(1, Math.ceil(sim / MAX_STEP));
    for (let i = 0; i < n; i++) probe.boat.step(zero, sim / n);
    const x = probe.boat.x, last = probe.pts[probe.pts.length - 1];
    if (Math.hypot(x[0] - last[0], x[1] - last[1]) > 3) probe.pts.push([x[0], x[1]]);

    const alpha = Math.min(1, (PROBE_SECONDS - probe.age) / FADE_SECONDS);
    const cam = view.camera, p = [0, 0];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, col] of [[6, 'rgba(22,40,61,0.85)'], [3, '#ffffff']]) {
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
      probe.pts.forEach((q, i) => { cam.worldToScreen(q[0], q[1], p); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      cam.worldToScreen(x[0], x[1], p); ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    // x0 marker and the current state
    const s0 = cam.worldToScreen(probe.x0[0], probe.x0[1], [0, 0]);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s0[0], s0[1], 6, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.font = 'italic 700 15px "KaTeX_Math", "Times New Roman", serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.fillStyle = COLORS.ink;
    ctx.strokeText('x₀', s0[0] + 9, s0[1] - 9); ctx.fillText('x₀', s0[0] + 9, s0[1] - 9);
    const sx = cam.worldToScreen(x[0], x[1], [0, 0]);
    ctx.fillStyle = COLORS.thrust; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx[0], sx[1], 6.5, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.restore();
    readout.set(x, alpha);
  };
}
