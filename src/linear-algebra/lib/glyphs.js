// Small schematic diagrams of DGC's arrays: matrices as boxes with column rules, vectors as thin bars.
// Shared by the data → arrays and variables slides so every array is drawn the same way everywhere.
import { s } from './svg.js';

export function glyph(id) {
  const svg = s('svg', { class: `dm-glyph dm-glyph-${id}` });
  const box = (x, y, w, h) => s('rect', { x, y, width: w, height: h, class: 'dm-box' }, svg);
  const rule = (x1, y1, x2, y2) => s('line', { x1, y1, x2, y2, class: 'dm-rule' }, svg);
  const set = (w, h) => { svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h); };
  if (id === 'G' || id === 'B') {
    const [w, h] = id === 'G' ? [92, 104] : [128, 104];
    set(w + 2, h + 2); box(1, 1, w, h);
    const n = id === 'G' ? 5 : 7;
    for (let i = 1; i <= n; i++) if (i !== n - 1) rule(1 + (i * w) / (n + 1), 10, 1 + (i * w) / (n + 1), h - 8);
    s('text', { x: 1 + ((n - 0.6) * w) / (n + 1), y: h / 2 + 5, class: 'dm-dots' }, svg).textContent = '⋯';
  } else if (id === 's') {
    set(130, 18); box(1, 1, 128, 14); rule(10, 8, 120, 8);
  } else if (id === 'lab') {
    set(160, 20);
    for (let i = 0; i < 8; i++) s('rect', { x: 1 + i * 19.5, y: 1, width: 17, height: 16, class: 'dm-chip' + (i > 5 ? ' alt' : '') }, svg);
  } else if (id === 'tad') {
    set(150, 60);
    const genes = 14, tads = 4;
    for (let i = 0; i < genes; i++) {
      const j = Math.min(tads - 1, Math.floor((i * tads) / genes));
      const x0 = 6 + i * 10, x1 = 25 + j * 34;
      s('line', { x1: x0, y1: 6, x2: x1, y2: 50, class: 'dm-map' }, svg);
      s('circle', { cx: x0, cy: 6, r: 2.6, class: 'dm-gene' }, svg);
    }
    for (let j = 0; j < tads; j++) s('rect', { x: 13 + j * 34, y: 48, width: 24, height: 10, class: 'dm-tad' }, svg);
  } else {
    set(16, 104); box(1, 1, 14, 102); rule(8, 10, 8, 94);
  }
  return svg;
}

