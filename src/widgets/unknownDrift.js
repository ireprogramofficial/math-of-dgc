// Slide: unknown drift. The same river as before, but the flow is hidden: all we have are samples.
//   initial basin: a time series of states that roughly circles the basin's fixed point (the gyre)
//   target basin: a single sample
// The samples come from the true (hidden) flow, with a little measurement jitter.
// Buttons show the actual drift, or one of three drifts *fitted* to the same samples, each consistent with the data
// and very different away from it:
//   fit 1  a kernel average of the sampled velocities: the gyre where there is data, still water everywhere else
//   fit 2  one linear model  x' = A x + b  fit to the initial basin, extrapolated everywhere (as DGC does with its A[k])
//   fit 3  a quadratic polynomial drift (12 parameters) fit by least squares to the same samples: more flexible
//          than fit 1, equally consistent with the data, and it extrapolates very differently
// All three use only the samples: no knowledge of the channels, inlet, outlets, or the other basins.
import katex from 'katex';
import { FIT_METHODS, makeDriftData } from '../control/driftFits.js';
import { RiverView } from '../river/view.js';
import { COLORS } from './draw.js';
import { h } from './ui.js';

const APPEAR_SECONDS = 0.18; // the samples arrive one by one

const MODES = {
  hidden: { tex: String.raw`\dot{x} = f(x), \quad f = \textcolor{#c0392b}{?}`, note: '' },
  actual: { button: 'Reveal actual drift', tex: String.raw`\dot{x} = f(x)`, note: 'The actual drift' },
  fit1: { button: 'Fit drift 1', tex: String.raw`\dot{x} = \hat{f}_1(x)`, note: 'Only where there is data; still water everywhere else' },
  fit2: { button: 'Fit drift 2', tex: String.raw`\dot{x} = \hat{f}_2(x) = A\,x`, note: 'One linear model fit to the initial basin, extrapolated everywhere' },
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
    label.innerHTML = katex.renderToString(m.tex, { throwOnError: false })
      + (FIT_METHODS[mode] ? `<div class="map-math-method">Method: <b>${FIT_METHODS[mode]}</b></div>` : '')
      + (m.note ? `<div class="map-math-note">${m.note}</div>` : '');
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (!actual) return;
    view.setFlowHidden(mode === 'hidden');
    view.showField(mode === 'hidden' || mode === 'actual' ? actual : fits[mode]);
  }
  setMode('hidden');

  view.onFlow = ((prev) => (flow, scn) => {
    prev?.(flow, scn);
    actual = flow;
    ({ series, single, fits } = makeDriftData(flow, scn));
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
    caption('initial basin: time series', sc[2].x + sc[2].R + 12, sc[2].y);
    caption('target basin: one sample', sc[1].x + sc[1].R + 12, sc[1].y);
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
