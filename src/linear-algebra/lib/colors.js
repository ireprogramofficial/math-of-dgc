// Section colors (from the pptx) and the two heatmap colormaps.

export const SEC = {
  terrain: '#1a5fb4',
  control: '#d6246e',
  optimization: '#e8501a',
  metrics: '#1a5fb4',
  ink: '#1d1d1f',
  muted: '#6b7280',
  line: '#d7dde5',
  wash: '#f3f6fa',
};

// TF colors used by the control and optimization widgets (TF1 magenta, TF2 cyan, TF3 purple, as in the pptx).
export const TF_COLORS = ['#d6246e', '#0ea5c6', '#7c3aed'];

// Eight distinguishable TAD colors for the gene → TAD strip.
export const TAD_COLORS = ['#1a5fb4', '#e8501a', '#2e8b57', '#d6246e', '#7c3aed', '#b8860b', '#0ea5c6', '#6b7280'];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
const ramp = (stops, t) => {
  t = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
};

// Raw expression: white → deep blue.
const SEQ = [[255, 255, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
// Centered values: blue (below average) → white → orange (above average).
const DIV = [[24, 78, 160], [125, 165, 220], [247, 247, 247], [244, 165, 120], [200, 60, 20]];

/** RGB triple for a raw (nonnegative) value on [0, vmax]. */
export const seq = (v, vmax) => ramp(SEQ, v / vmax);
/** RGB triple for a signed value on [−vmax, vmax]. */
export const div = (v, vmax) => ramp(DIV, 0.5 + v / (2 * vmax));
export const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const blend = mix;
