// Shared UI for the boat slides: map + toolbar (scenario, thrusters, presets, play, solve) + linked timeline.
import { DIRS } from '../control/boat.js';
import { BoatScene, COLORS } from './boatScene.js';
import { createMapControls } from './mapControls.js';
import { h } from './ui.js';

const PRESETS = {
  drift: { label: 'Drift only', fn: () => [0, 0, 0, 0] },
  east: { label: 'Steady east', fn: () => [0, 0.6, 0, 0] },
  northEast: { label: 'North → east', fn: (k, n) => (k < n * 0.18 ? [1, 0, 0, 0] : [0, 0.7, 0, 0]) },
};

/**
 * @param {HTMLElement} el
 * @param {object} cfg { scenarios: string[], scenario, solve: bool, presets: string[], draggableTarget: bool, colormap }
 */
export function createBoatWidget(el, cfg) {
  el.classList.add('map-widget', 'boat-widget');
  const stage = h('div', { class: 'stage' });
  const timelineWrap = h('div', { class: 'timeline-wrap' });
  const readout = h('span', { class: 'readout' });
  const note = h('span', { class: 'readout', style: { color: COLORS.bad, fontWeight: 700 } });
  const playBtn = h('button', { type: 'button', class: 'map-action map-play' }, '▶ Play');
  const solveBtn = cfg.solve ? h('button', { type: 'button', class: 'primary' }, 'Solve') : null;

  const scene = new BoatScene(stage, timelineWrap, {
    scenario: cfg.scenario, draggableTarget: !!cfg.draggableTarget, editable: true,
    autoplayAfterSolve: true, onUpdate: update,
  });

  // thrusters
  const dirBtns = DIRS.map((d, c) => {
    const b = h('button', { type: 'button', class: 'on', title: `Thruster ${d}: click to ${'disable/enable'}` }, d);
    b.addEventListener('click', () => { b.classList.toggle('on'); scene.setEnabled(c, b.classList.contains('on')); });
    return b;
  });

  const targetChips = h('span', { class: 'legend-inline' });
  function refreshTargetChips() {
    const scn = scene.scenario;
    targetChips.replaceChildren();
    if (!cfg.draggableTarget || !scn?.targets) return;
    targetChips.append(h('span', { class: 'readout' }, 'Target:'),
      ...scn.targets.map((t) => {
        const b = h('button', { type: 'button', class: 'chip' }, t.name.replace('Basin ', ''));
        b.title = `Move the target to ${t.name}`;
        b.addEventListener('click', () => { scene.setTarget(t.x, t.y); scene.startSolve(); });
        return b;
      }));
  }

  const controls = h('div', { class: 'boat-toolbar' },
    h('span', { class: 'legend-inline' }, h('span', { class: 'readout' }, 'Thrusters'), h('span', { class: 'dirs' }, dirBtns)),
    ...(cfg.presets ?? []).map((k) => {
      const b = h('button', { type: 'button' }, PRESETS[k].label);
      b.addEventListener('click', () => { scene.fill(PRESETS[k].fn); scene.restart(); });
      return b;
    }),
    solveBtn,
    targetChips,
  );
  const info = h('div', { class: 'boat-toolbar info' },
    readout, note,
  );
  const toolbar = h('div', { class: 'toolbars' }, controls, info);
  scene.view.setLegendItems([
    { color: COLORS.water, text: 'water velocity' },
    { color: COLORS.thrust, text: 'thrust' },
    { color: COLORS.ink, text: 'boat velocity' },
    { color: COLORS.ink, text: 'drift-only path', dash: true },
  ]);

  playBtn.addEventListener('click', () => (scene.playing ? scene.pause() : scene.play()));
  solveBtn?.addEventListener('click', () => scene.startSolve());
  const mapControls = createMapControls(scene.view, {
    onScenario: async (id) => {
      await scene.setScenario(id);
      dirBtns.forEach((b) => b.classList.add('on'));
      scene.enabled.fill(true);
      refreshTargetChips();
      update();
    },
  });
  stage.append(h('div', { class: 'map-actions' }, playBtn));
  el.append(stage, h('div', {}, timelineWrap, toolbar), mapControls.el);

  function update() {
    const s = scene.stats();
    if (!s) return;
    playBtn.textContent = scene.playing ? '⏸ Pause' : '▶ Play';
    const parts = [`t = <b>${s.t.toFixed(0)}</b> / ${s.T.toFixed(0)} s`, `miss <b>${s.miss.toFixed(1)}</b> m`];
    if (cfg.solve) { parts.push(`effort <b>${s.effort.toFixed(0)}</b>`); if (s.iter) parts.push(`iter <b>${s.iter}</b>`); }
    readout.innerHTML = parts.join(' · ');
    let msg = '';
    if (s.grounded > 0.002) msg = 'Aground: the path leaves the water';
    else if (cfg.solve && !s.solving && s.iter && s.miss > 25) msg = 'Out of reach with these thrusters in this time';
    note.textContent = msg;
    solveBtn && (solveBtn.textContent = s.solving ? 'Solving…' : 'Solve');
  }

  scene.view.ready.then(() => { refreshTargetChips(); update(); });
  return { setActive: (on) => scene.setActive(on), destroy: () => scene.destroy(), scene };
}
