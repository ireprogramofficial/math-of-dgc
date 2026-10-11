// Speed colormaps. "none" disables the speed coloring entirely (plain water + streaks).

const STOPS = {
  // Close to the rainbow in the reference video: slow blue -> fast red/purple.
  'river-rainbow': ['#1d2a9e', '#2a5fd6', '#1fa8e0', '#2fd0a5', '#7be04a', '#e8e03a', '#f6a02a', '#ee4b2b', '#b5288f', '#7a2bb8'],
  // Perceptually uniform, colorblind-friendly.
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  turbo: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c7ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'],
  // Calm, one-hue ramp for a light page. The default everywhere in the deck.
  blues: ['#d3e5f6', '#a9cbe8', '#7fb0dc', '#5594cd', '#3376b5', '#1d5a9b', '#10407c', '#0a2a55'],
};

export const DEFAULT_COLORMAP = 'blues';
export const COLORMAP_NAMES = ['blues', ...Object.keys(STOPS).filter((n) => n !== 'blues'), 'none'];
export const COLORMAP_LABELS = {
  none: 'None',
  'river-rainbow': 'Rainbow',
  viridis: 'Viridis',
  plasma: 'Plasma',
  turbo: 'Turbo',
  blues: 'Blues',
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** t in [0, 1] -> [r, g, b] (0-255). */
export function colormapAt(name, t) {
  const stops = STOPS[name];
  if (!stops) return [255, 255, 255];
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return a.map((c, k) => c + (b[k] - c) * f);
}

/** 256x1 RGBA8 lookup table for the GPU. */
export function colormapLUT(name, n = 256) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colormapAt(name === 'none' ? 'viridis' : name, i / (n - 1));
    out.set([r, g, b, 255], i * 4);
  }
  return out;
}

export function colormapCSS(name) {
  const stops = STOPS[name];
  return stops ? `linear-gradient(90deg, ${stops.join(', ')})` : 'none';
}
