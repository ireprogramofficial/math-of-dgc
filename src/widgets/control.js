// Slide: a control system. An open-loop schedule u(t) cycles the thrust direction; hold W A S D (or the on-screen pad) to take over.
import { DIRS } from '../control/boat.js';
import { COLORS } from './draw.js';
import { createMapControls } from './mapControls.js';
import katex from 'katex';
import { createInputReadout, createStateReadout } from './stateReadout.js';
import { SteerScene } from './steerScene.js';
import { h } from './ui.js';

const PAD_KEYS = ['W', 'D', 'S', 'A']; // N, E, S, W

export function create(el) {
  el.classList.add('map-widget', 'boat-widget', 'steer-widget');
  const stage = h('div', { class: 'stage' });
  const scene = new SteerScene(stage, { scenario: 'meander', onStatus: update });

  // status chip (top-left of the map)
  const chip = h('div', { class: 'steer-chip' });
  // on-screen thruster pad (bottom-right of the map): lights up with the thrust actually being applied
  const padBtns = DIRS.map((d, c) => {
    const b = h('button', { type: 'button', class: `pad pad-${d}`, title: `Thruster ${d} (key ${PAD_KEYS[c]})` }, d);
    b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); scene.press(c); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => scene.release(c));
    return b;
  });
  const pad = h('div', { class: 'steer-pad', 'data-prevent-swipe': '' }, ...padBtns);
  // the dynamics, labeled on the map (top-left), like the dynamical-system slide
  const label = h('div', { class: 'map-math' });
  label.innerHTML = katex.renderToString(String.raw`\dot{x} = f(x) + G(x)\,u(t)`, { throwOnError: false })
    + `<div class="map-math-note">boat: ${katex.renderToString(String.raw`x \in \mathbb{R}^2,\ u \in [0,1]^4`, { throwOnError: false })}</div>`;
  // live input u and state x side by side (top-right)
  const readouts = h('div', { class: 'map-readouts' });
  stage.append(label, chip, pad, readouts);
  const uReadout = createInputReadout(readouts);
  const readout = createStateReadout(readouts);

  const controls = createMapControls(scene.view, { onScenario: (id) => scene.setScenario(id) });
  scene.view.setLegendItems([
    { color: COLORS.water, text: 'drift', tex: 'f(x)' },
    { color: COLORS.thrust, text: 'thrust', tex: 'G(x)\,u' },
  ]);
  el.append(stage, controls.el);

  let lastMode = '', lastText = '';
  function update({ mode, secondsLeft, u, dir }) {
    padBtns.forEach((b, c) => b.style.setProperty('--u', u[c].toFixed(2)));
    uReadout.set(u);
    readout.set(scene.boat.x);
    if (mode !== lastMode) { chip.dataset.mode = mode; lastMode = mode; }
    const text = mode === 'manual' ? `Manual steering · schedule resumes in ${Math.ceil(secondsLeft)} s` : `Schedule u(t) (open loop) · full thrust ${dir}`;
    if (text !== lastText) { chip.textContent = text; lastText = text; }
  }

  if (import.meta.env?.DEV) window.__steer = scene; // dev-only debugging hook
  return { setActive: (on) => scene.setActive(on), destroy: () => scene.destroy(), scene };
}
