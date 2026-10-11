// Slide: a control system. A boat steers itself between points; hold W A S D (or the on-screen pad) to take over.
import { DIRS } from '../control/boat.js';
import { COLORS } from './draw.js';
import { createMapControls } from './mapControls.js';
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
  stage.append(chip, pad);

  const controls = createMapControls(scene.view, { onScenario: (id) => scene.setScenario(id) });
  scene.view.setLegendItems([
    { color: COLORS.water, text: 'drift', tex: 'f(x)' },
    { color: COLORS.thrust, text: 'thrust', tex: 'G(x)\,u' },
  ]);
  el.append(stage, controls.el);

  let lastMode = '', lastText = '';
  function update({ mode, secondsLeft, u, holding }) {
    padBtns.forEach((b, c) => b.style.setProperty('--u', u[c].toFixed(2)));
    if (mode !== lastMode) { chip.dataset.mode = mode; lastMode = mode; }
    const text = mode === 'manual' ? `Manual steering · autopilot resumes in ${Math.ceil(secondsLeft)} s` : holding ? 'Autopilot · arrived, pausing' : 'Autopilot · steering to a new point';
    if (text !== lastText) { chip.textContent = text; lastText = text; }
  }

  if (import.meta.env?.DEV) window.__steer = scene; // dev-only debugging hook
  return { setActive: (on) => scene.setActive(on), destroy: () => scene.destroy(), scene };
}
