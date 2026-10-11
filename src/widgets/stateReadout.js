// A live readout of the state vector x = (p_x, p_y, v_x, v_y), typeset with KaTeX, overlaid on a map.
// Numbers are padded to fixed widths so the box does not jitter as values change.
import katex from 'katex';
import { h } from './ui.js';

const pad = (v, digits, width) => {
  const s = Math.abs(v).toFixed(digits);
  const lead = '\\phantom{0}'.repeat(Math.max(0, width - s.length));
  return (v < 0 && Number(s) !== 0 ? '-' : '\\phantom{-}') + lead + s;
};

export function createStateReadout(parent) {
  const el = h('div', { class: 'state-readout' });
  el.style.display = 'none';
  parent.append(el);
  let last = 0;
  return {
    el,
    /** Show x (length 4); updates the typesetting at most ~12 times a second. */
    set(x, opacity = 1) {
      el.style.display = 'block';
      el.style.opacity = String(opacity);
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      const tex =
        'x = \\begin{bmatrix} p_x \\\\ p_y \\\\ v_x \\\\ v_y \\end{bmatrix} = \\begin{bmatrix} ' +
        [pad(x[0], 0, 4), pad(x[1], 0, 4), pad(x[2], 2, 4), pad(x[3], 2, 4)].join(' \\\\ ') +
        ' \\end{bmatrix} \\begin{matrix} \\text{m} \\\\ \\text{m} \\\\ \\text{m/s} \\\\ \\text{m/s} \\end{matrix}';
      el.innerHTML = katex.renderToString(tex, { throwOnError: false });
    },
    hide() { el.style.display = 'none'; },
  };
}
