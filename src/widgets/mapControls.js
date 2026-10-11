// The one set of map controls used on every interactive slide: river, speed colormap, and camera.
// Keeping it in one place is what keeps the slides consistent.

import { COLORMAP_LABELS, COLORMAP_NAMES } from '../river/colormaps.js';
import { SCENARIOS } from '../river/scenarios.js';
import { h, select } from './ui.js';

/**
 * @param {RiverView} view
 * @param {object} o { onScenario(id): async handler (default: view.setScenario), caption: show the scenario blurb }
 * @returns {{ el: HTMLElement, caption: HTMLElement|null, refresh: Function }}
 */
export function createMapControls(view, { onScenario, caption = false } = {}) {
  const riverSel = select(
    SCENARIOS.map((s, i) => ({ value: s.id, label: `${i + 1} · ${s.name}` })),
    view.scenario?.id,
    async (id) => { await (onScenario ? onScenario(id) : view.setScenario(id)); },
  );
  const colorSel = select(COLORMAP_NAMES.map((n) => ({ value: n, label: COLORMAP_LABELS[n] })), view.colormap, (n) => view.setColormap(n));
  const cameraBox = h('span', { class: 'map-cam' });
  const captionEl = caption ? h('div', { class: 'map-caption' }) : null;

  const refresh = () => {
    const scn = view.scenario;
    if (!scn) return;
    riverSel.value = scn.id;
    colorSel.value = view.colormap;
    cameraBox.replaceChildren(...scn.views.map((v, i) => {
      const b = h('button', { type: 'button', class: 'chip', title: i === 0 ? 'Reset the view (or double-click the map)' : `Fly to: ${v.name}` }, v.name);
      b.addEventListener('click', () => view.goto(i, i === 0 ? 1200 : 1800));
      return b;
    }));
    if (captionEl) {
      const c = scn.complexity, n = SCENARIOS.length;
      captionEl.replaceChildren(
        h('span', { class: 'map-dots', title: `Complexity ${c} of ${n}` }, '●'.repeat(c) + '○'.repeat(n - c)),
        h('span', {}, scn.blurb),
      );
    }
  };

  const prev = view.onFlow;
  view.onFlow = (flow, scn) => { prev?.(flow, scn); refresh(); };
  if (view.flow) refresh();

  const el = h('div', { class: 'map-controls' },
    h('label', {}, 'River', riverSel),
    h('label', {}, 'Color', colorSel),
    h('span', { class: 'map-cam-wrap' }, h('span', { class: 'map-label' }, 'Camera'), cameraBox),
  );
  return { el, caption: captionEl, refresh };
}
