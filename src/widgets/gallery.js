// "A family of rivers": scenario picker, colormap picker, and scripted camera moves + free pan/zoom.
import { COLORMAP_LABELS, COLORMAP_NAMES } from '../river/colormaps.js';
import { SCENARIOS } from '../river/scenarios.js';
import { RiverView } from '../river/view.js';
import { h, select } from './ui.js';

export function create(el) {
  const stage = h('div', { class: 'stage' });
  const panel = h('div', { class: 'panel' });
  el.append(stage, panel);
  const view = new RiverView(stage, { scenario: 'delta', colormap: 'river-rainbow' });
  view.style = { cmapMix: 0.85 };

  const title = h('div', { class: 'panel-title' }, 'River');
  const blurb = h('div', { class: 'panel-blurb' });
  const views = h('div', { class: 'panel-views' });
  const scnButtons = SCENARIOS.map((s) => {
    const b = h('button', { type: 'button', class: 'scn' },
      h('span', { class: 'scn-dots' }, '●'.repeat(s.complexity) + '○'.repeat(6 - s.complexity)), h('span', {}, s.name));
    b.addEventListener('click', () => choose(s.id));
    return b;
  });

  function choose(id) {
    const s = SCENARIOS.find((x) => x.id === id);
    scnButtons.forEach((b, i) => b.classList.toggle('on', SCENARIOS[i].id === id));
    title.textContent = s.name;
    blurb.textContent = s.blurb;
    views.replaceChildren(...s.views.map((v, i) => {
      const b = h('button', { type: 'button', class: 'chip' }, v.name);
      b.addEventListener('click', () => view.goto(i, 1800));
      return b;
    }));
    view.setScenario(id);
  }

  panel.append(
    h('div', { class: 'panel-head' }, 'Scenario ', h('small', {}, '(simple → complex)')),
    h('div', { class: 'scn-list' }, scnButtons),
    title, blurb,
    h('div', { class: 'panel-head' }, 'Camera'), views,
    h('div', { class: 'panel-head' }, 'Speed colormap'),
    select(COLORMAP_NAMES.map((n) => ({ value: n, label: COLORMAP_LABELS[n] })), 'river-rainbow', (v) => {
      view.setColormap(v);
    }),
    h('div', { class: 'hint' }, 'Drag to pan · scroll to zoom · double-click to reset'),
  );
  choose('delta');

  return { setActive: (on) => view.setActive(on), destroy: () => view.destroy(), view };
}
