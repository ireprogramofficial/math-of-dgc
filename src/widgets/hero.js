// Title-slide background: the meandering fork, drifting slowly between views.
import { RiverView } from '../river/view.js';

export function create(el) {
  const view = new RiverView(el, { scenario: 'fork', interactive: false, legend: false, labels: false, density: 0.006 });
  view.style = { trailPx: 56 };
  let i = 0, timer = 0;
  const tour = [0, 1, 2, 0, 3, 0];
  const next = () => { view.goto(tour[i++ % tour.length], 7000); timer = setTimeout(next, 9500); };
  return {
    setActive(on) {
      view.setActive(on);
      clearTimeout(timer);
      if (on) view.ready.then(() => { i = 0; view.goto(0, 0); timer = setTimeout(next, 3500); });
    },
    destroy() { clearTimeout(timer); view.destroy(); },
  };
}
