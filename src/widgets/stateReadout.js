// Live readouts of a vector, typeset with KaTeX and overlaid on a map: the state x = (p_x, p_y)
// and the control u = (u_N, u_E, u_S, u_W). Numbers are padded to fixed widths so a box does not jitter.
import katex from 'katex';
import { h } from './ui.js';

const pad = (v, digits, width) => {
  const s = Math.abs(v).toFixed(digits);
  const lead = '\\phantom{0}'.repeat(Math.max(0, width - s.length));
  return (v < 0 && Number(s) !== 0 ? '-' : '\\phantom{-}') + lead + s;
};

/**
 * @param {HTMLElement} parent
 * @param {object} o { symbol: 'x', rows: [{ label, digits, width, unit }] }
 */
export function createVectorReadout(parent, { symbol, rows }) {
  const el = h('div', { class: 'state-readout' });
  el.style.display = 'none';
  parent.append(el);
  const labels = rows.map((r) => r.label).join(' \\\\ ');
  const units = rows.some((r) => r.unit)
    ? ' \\begin{matrix} ' + rows.map((r) => (r.unit ? `\\text{${r.unit}}` : '')).join(' \\\\ ') + ' \\end{matrix}'
    : '';
  let last = 0;
  return {
    el,
    /** Show the values; updates the typesetting at most ~12 times a second. */
    set(values, opacity = 1) {
      el.style.display = 'block';
      el.style.opacity = String(opacity);
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      const nums = rows.map((r, i) => pad(values[i], r.digits, r.width)).join(' \\\\ ');
      const tex = `${symbol} = \\begin{bmatrix} ${labels} \\end{bmatrix} = \\begin{bmatrix} ${nums} \\end{bmatrix}${units}`;
      el.innerHTML = katex.renderToString(tex, { throwOnError: false });
    },
    hide() { el.style.display = 'none'; },
  };
}

/** The boat's state: its position x = (p_x, p_y). */
export const createStateReadout = (parent) => createVectorReadout(parent, {
  symbol: 'x',
  rows: [
    { label: 'p_x', digits: 0, width: 4, unit: 'm' },
    { label: 'p_y', digits: 0, width: 4, unit: 'm' },
  ],
});

/** The thruster input u = (u_N, u_E, u_S, u_W), each a fraction of full thrust in [0, 1]. */
export const createInputReadout = (parent) => createVectorReadout(parent, {
  symbol: 'u',
  rows: ['N', 'E', 'S', 'W'].map((d) => ({ label: `u_${d}`, digits: 2, width: 4 })),
});
