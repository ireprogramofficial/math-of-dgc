// Tiny SVG helpers shared by the 2-D widgets: element creation, arrowheads, a math-coordinate view, dragging.
import katex from 'katex';

const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

/** An arrow from p to q (screen px) drawn as a line plus a filled head, so each arrow can have its own color. */
export function arrow(parent, { width = 2, head = 9, cls = '', color } = {}) {
  const g = s('g', { class: `arrow ${cls}` }, parent);
  const line = s('line', { 'stroke-width': width, 'stroke-linecap': 'round' }, g);
  const tip = s('path', {}, g);
  const api = {
    g,
    set(p, q, c = color) {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const L = Math.hypot(dx, dy);
      g.style.display = L < 0.5 ? 'none' : '';
      if (L < 0.5) return api;
      const ux = dx / L, uy = dy / L, h = Math.min(head, L * 0.6);
      const bx = q[0] - ux * h, by = q[1] - uy * h;
      line.setAttribute('x1', p[0]); line.setAttribute('y1', p[1]);
      line.setAttribute('x2', bx + ux * 1); line.setAttribute('y2', by + uy * 1);
      tip.setAttribute('d', `M${q[0]},${q[1]}L${bx - uy * h * 0.45},${by + ux * h * 0.45}L${bx + uy * h * 0.45},${by - ux * h * 0.45}Z`);
      if (c) { line.setAttribute('stroke', c); tip.setAttribute('fill', c); }
      return api;
    },
  };
  return api;
}

/** Maps math coordinates (y up) to screen pixels inside a w×h viewport centered on `center` with `scale` px per unit. */
export function view(w, h, scale, center = [0, 0]) {
  return {
    w, h, scale, center,
    px: ([x, y]) => [w / 2 + (x - center[0]) * scale, h / 2 - (y - center[1]) * scale],
    math: ([X, Y]) => [center[0] + (X - w / 2) / scale, center[1] - (Y - h / 2) / scale],
  };
}

/** Pointer dragging on an SVG element. `onMove` receives the pointer position in the svg's viewBox units. */
export function draggable(svg, el, { onStart, onMove, onEnd } = {}) {
  const toLocal = (ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, q.y];
  };
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.setPointerCapture(ev.pointerId);
    el.style.cursor = 'grabbing';
    onStart?.(toLocal(ev));
    const move = (e) => onMove?.(toLocal(e));
    const up = (e) => {
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'grab';
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

/** A KaTeX string rendered into a fresh element. */
export function tex(src, { display = false, cls = '' } = {}) {
  const e = document.createElement(display ? 'div' : 'span');
  if (cls) e.className = cls;
  katex.render(src, e, { displayMode: display, throwOnError: false });
  return e;
}

export function setTex(el, src, display = false) {
  katex.render(src, el, { displayMode: display, throwOnError: false });
}

export const fmt = (v, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
