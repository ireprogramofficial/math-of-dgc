// "A family of rivers": the shared map controls plus a caption, over a big map.
import { RiverView } from '../river/view.js';
import { createMapControls } from './mapControls.js';
import { h } from './ui.js';

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: 'meander' });
  const controls = createMapControls(view, { caption: true });
  el.append(h('div', { class: 'map-top' }, controls.el, controls.caption), stage);
  view.ready.then(() => controls.refresh());
  return { setActive: (on) => view.setActive(on), destroy: () => view.destroy(), view };
}
