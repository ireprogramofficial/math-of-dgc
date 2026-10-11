// A river as a vector field: the map, an optional math label on it, and the shared (quiet) controls below.
import katex from 'katex';
import { RiverView } from '../river/view.js';
import { createMapControls } from './mapControls.js';
import { h } from './ui.js';

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
  return { setActive: (on) => view.setActive(on), destroy: () => view.destroy(), view };
}
