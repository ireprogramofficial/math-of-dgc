// Slide: unknown drift. The same river as before, but the flow is hidden: all we have are samples.
//   basin 2: a time series of states that roughly circles the basin's fixed point (the gyre)
//   basin 1: a single sample
// The samples come from the true (hidden) flow, with a little measurement jitter. "Reveal f" shows the flow.
import katex from 'katex';
import { RiverView } from '../river/view.js';
import { COLORS } from './draw.js';
import { h } from './ui.js';

const SERIES = { count: 26, every: 28, from: -40 }; // samples, seconds apart, start offset (m) below the fixed point
const JITTER = 3;            // meters of measurement noise
const APPEAR_SECONDS = 0.18; // the samples arrive one by one

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

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: 'triangle', interactive: true, labels: false });
  view.setFlowHidden(true);
  const label = h('div', { class: 'map-math' });
  label.innerHTML = katex.renderToString(String.raw`\dot{x} = f(x), \quad f = \textcolor{#c0392b}{?}`, { throwOnError: false });
  const reveal = h('button', { type: 'button', class: 'map-action' }, 'Reveal f');
  reveal.addEventListener('click', () => {
    view.setFlowHidden(!view.flowHidden);
    reveal.textContent = view.flowHidden ? 'Reveal f' : 'Hide f';
  });
  stage.append(label, h('div', { class: 'map-actions' }, reveal));
  el.append(stage);

  let series = [], single = null, shownAt = 0;
  view.onFlow = ((prev) => (flow, scn) => {
    prev?.(flow, scn);
    const [, b1, b2] = scn.swirls;
    const c2 = fixedPoint(flow, b2.x, b2.y), c1 = fixedPoint(flow, b1.x, b1.y);
    series = jitter(sampleSeries(flow, [c2[0], c2[1] + SERIES.from], SERIES.count, SERIES.every), JITTER);
    single = jitter([[c1[0] + 30, c1[1] + 22]], JITTER)[0];
    shownAt = performance.now();
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

  return {
    setActive(on) {
      view.setActive(on);
      if (on) { shownAt = performance.now(); view.setFlowHidden(true); reveal.textContent = 'Reveal f'; } // always start not knowing f
    },
    destroy: () => view.destroy(),
  };
}
