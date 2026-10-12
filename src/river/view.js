// RiverView: one interactive river on the page. Owns a WebGL canvas (water + streaks), a 2D overlay canvas
// (labels, boat, plans), a camera with pan/zoom, and the animation loop.
//
// All coordinates handed to overlay code are *layout* pixels, so slides that Reveal.js scales up or down keep
// every overlay proportional to the slide text. `view.k` converts layout px to device px.

import { Camera } from './camera.js';
import { colormapCSS, COLORMAP_NAMES, DEFAULT_COLORMAP } from './colormaps.js';
import { loadFlow } from './flowLoader.js';
import { ParticleSystem } from './particles.js';
import { DEFAULT_STYLE, RiverRenderer } from './renderer.js';
import { getScenario, WORLD } from './scenarios.js';
import katex from 'katex';
import { computeStreamlines } from './streamlines.js';

// Faint static streamlines under the moving streaks, a cue that the flow is deterministic.
// Set to false to turn them off everywhere.
const SHOW_STREAMLINES = true;

export class RiverView {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = { interactive: true, legend: true, labels: true, colormap: DEFAULT_COLORMAP, scenario: 'straight', ...opts };
    el.classList.add('rv');
    el.innerHTML = '';
    this.glCanvas = Object.assign(document.createElement('canvas'), { className: 'rv-gl' });
    this.overlay = Object.assign(document.createElement('canvas'), { className: 'rv-overlay' });
    this.loading = Object.assign(document.createElement('div'), { className: 'rv-loading', textContent: 'Solving flow…' });
    el.append(this.glCanvas, this.overlay, this.loading);
    this.ctx = this.overlay.getContext('2d');

    this.renderer = new RiverRenderer(this.glCanvas);
    this.camera = new Camera(WORLD);
    this.particles = null;
    this.flow = null;
    this.scenario = null;
    this.colormap = this.opts.colormap;
    this.style = {};
    this.active = false;
    this.k = 1;
    this.tools = [];
    this.onDraw = null;
    this.onFlow = null;
    this._raf = 0;
    this._last = 0;
    this._rectW = 0;
    this._pointers = new Map();
    this._tool = null;

    if (this.opts.legend) {
      this.legend = document.createElement('div');
      this.legend.className = 'rv-legend';
      el.append(this.legend);
    }
    this._bindPointer();
    this._resize();
    this.setColormap(this.colormap);
    this.ready = this.setScenario(this.opts.scenario);
  }

  // ---------- scenario / appearance ----------
  async setScenario(id, { view } = {}) {
    const token = (this._token = Symbol());
    this.scenario = getScenario(id);
    this.loading.style.display = 'flex';
    let flow;
    try {
      flow = await loadFlow(id);
    } catch (e) {
      this.loading.textContent = 'Could not compute flow';
      console.error(e);
      return;
    }
    if (token !== this._token) return; // superseded
    this.flow = flow;
    this.renderer.setFlow(flow);
    this.renderer.setStreamlines(SHOW_STREAMLINES && this.opts.streamlines !== false ? computeStreamlines(flow) : new Float32Array(0));
    if (this.particles) this.particles.setFlow(flow);
    else this.particles = new ParticleSystem(flow, { density: this.opts.density ?? 0.0075 });
    this.camera.set(view ?? this._homeView());
    this.loading.style.display = 'none';
    this._updateLegend();
    this.onFlow?.(flow, this.scenario);
  }

  setColormap(name) {
    if (!COLORMAP_NAMES.includes(name)) name = 'none';
    this.colormap = name;
    this.renderer.setColormap(name);
    this._updateLegend();
  }

  _streakStyle() {
    return this.colormap === 'none' ? { streakAlpha: 0.65, widthPx: 1.6 } : { streakAlpha: 0.92 };
  }

  /** Hide (or show) everything that reveals the drift: streaks, speed colors, streamlines, legend. */
  setFlowHidden(hidden) { this.flowHidden = hidden; this._updateLegend(); }

  /**
   * Display a different field on the same river (e.g. a fitted drift), keeping the scenario and camera.
   * Pass the scenario's own flow to go back. The field must share the scenario's grid (nx, ny, cell, inside).
   */
  showField(flow, { streamlines = true, keepParticles = false } = {}) {
    this.flow = flow;
    this.renderer.setFlow(flow);
    // keepParticles: the streaks carry on into the new field (for fields that change every step)
    if (this.particles) { if (keepParticles) this.particles.flow = flow; else this.particles.setFlow(flow); }
    const lines = streamlines && SHOW_STREAMLINES && this.opts.streamlines !== false;
    this.renderer.setStreamlines(lines ? computeStreamlines(flow) : new Float32Array(0));
    this._updateLegend();
  }

  /** Extra legend rows: [{ color, tex, text }] drawn as an arrow plus a (KaTeX) label. */
  setLegendItems(items) { this.legendItems = items; this._updateLegend(); }

  _legendItemsHTML() {
    return (this.legendItems ?? []).map((it) => {
      const label = it.tex ? katex.renderToString(it.tex, { throwOnError: false }) : '';
      const icon = it.dash
        ? `<path d="M1 5H25" stroke="${it.color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 5"/>`
        : `<path d="M1 5H19" stroke="${it.color}" stroke-width="3" stroke-linecap="round"/><path d="M25 5L17 0.5V9.5Z" fill="${it.color}"/>`;
      return `<div class="rv-legend-item"><svg width="26" height="10" viewBox="0 0 26 10">${icon}</svg>${it.text ?? ''} ${label}</div>`;
    }).join('');
  }

  _updateLegend() {
    if (!this.legend) return;
    const items = this._legendItemsHTML();
    if (!this.flow || this.flowHidden || (this.colormap === 'none' && !items)) { this.legend.style.display = 'none'; return; }
    if (this.colormap === 'none') { this.legend.style.display = 'block'; this.legend.innerHTML = items; return; }
    const st = { ...DEFAULT_STYLE, ...this.style };
    const vmax = this.flow.speedRef * st.speedMaxFactor;
    const ticks = [0, 0.25, 0.5, 1, 1.5, 2].filter((v) => v <= vmax + 1e-9);
    const pos = (v) => (Math.pow(v / vmax, st.gamma) * 100).toFixed(1);
    this.legend.style.display = 'block';
    // ticks near the right end are right-aligned so they never run past the bar; the unit lives in the title
    const tick = (v) => { const x = +pos(v); return `<span style="left:${x}%;${x > 88 ? 'transform:translateX(-100%)' : x < 4 ? 'transform:none' : ''}">${v}</span>`; };
    this.legend.innerHTML = `<div class="rv-legend-title">Water speed <span class="rv-legend-unit">(m/s)</span></div>
      <div class="rv-legend-bar" style="background:${colormapCSS(this.colormap)}"></div>
      <div class="rv-legend-ticks">${ticks.map(tick).join('')}</div>${items}`;
  }

  // ---------- camera helpers ----------
  goto(viewOrIndex, ms = 1800) {
    const v = typeof viewOrIndex === 'number' ? this.scenario.views[viewOrIndex] : viewOrIndex;
    if (ms <= 0) this.camera.set(v); else this.camera.animateTo(v, ms);
  }
  /** The scenario's first view ("Overview") is home everywhere: initial view, reset, and resize re-fit. */
  _homeView() {
    const v = this.scenario?.views?.[0];
    return v ? this.camera.resolve(v) : this.camera.homeView();
  }
  home(ms = 1200) { ms <= 0 ? this.camera.set(this._homeView()) : this.camera.animateTo(this._homeView(), ms); }

  // ---------- lifecycle ----------
  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    cancelAnimationFrame(this._raf);
    if (on) {
      this._resize();
      this._last = performance.now();
      const loop = (t) => { this._frame(t); if (this.active) this._raf = requestAnimationFrame(loop); };
      this._raf = requestAnimationFrame(loop);
    }
  }

  destroy() {
    this.setActive(false);
    this.renderer.dispose();
    this.el.innerHTML = '';
  }

  _resize() {
    const rect = this.el.getBoundingClientRect();
    const lw = this.el.clientWidth, lh = this.el.clientHeight;
    if (!lw || !lh) return false;
    const scale = rect.width / lw || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = scale;
    this.k = scale * dpr;
    const dw = Math.round(lw * this.k), dh = Math.round(lh * this.k);
    for (const c of [this.glCanvas, this.overlay]) if (c.width !== dw || c.height !== dh) { c.width = dw; c.height = dh; }
    if (this.camera.w !== lw || this.camera.h !== lh) {
      const hadHome = this._atHome();
      this.camera.resize(lw, lh);
      if (hadHome || !this.flow) this.camera.set(this._homeView());
    }
    this._rectW = rect.width;
    return true;
  }

  _atHome() {
    const h = this._homeView(), c = this.camera;
    return Math.abs(Math.log(c.zoom / h.zoom)) < 0.02 && Math.abs(c.cx - h.cx) < 5;
  }

  _frame(now) {
    const dt = (now - this._last) / 1000;
    this._last = now;
    const rect = this.el.getBoundingClientRect();
    if (Math.abs(rect.width - this._rectW) > 0.5 || this.glCanvas.width === 0) this._resize();
    if (!this.flow) return;
    this.camera.update(now);
    const hidden = this.flowHidden;
    const count = hidden ? 0 : this.particles.update(dt, this.camera);
    this.renderer.render({
      camera: this.camera, k: this.k, particles: this.particles.data, count,
      style: { ...this._streakStyle(), ...this.style, hideFlow: hidden },
    });
    this._drawOverlay(now, dt);
  }

  _drawOverlay(now, dt) {
    const ctx = this.ctx, cam = this.camera;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.clearRect(0, 0, cam.w, cam.h);
    if (this.opts.labels && this.scenario.labels) this._drawLabels(ctx);
    this.onDraw?.(ctx, this, now, dt);
  }

  _drawLabels(ctx) {
    const cam = this.camera, p = [0, 0];
    const fade = Math.min(Math.max(1.2 - cam.zoom / 4, 0), 1) * Math.min(Math.max((cam.zoom - 0.12) / 0.2, 0), 1);
    if (fade <= 0.02) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of this.scenario.labels) {
      cam.worldToScreen(l.x, l.y, p);
      if (p[0] < -80 || p[1] < -30 || p[0] > cam.w + 80 || p[1] > cam.h + 30) continue;
      ctx.font = `600 ${l.size ?? 14}px "Source Sans Pro", system-ui, sans-serif`;
      ctx.globalAlpha = 0.9 * fade;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(l.text, p[0], p[1]);
      ctx.fillStyle = '#26384d';
      ctx.fillText(l.text, p[0], p[1]);
    }
    ctx.restore();
  }

  // ---------- pointer interaction: tools first, then pan/zoom ----------
  /** A tool: { pointerDown(world, ev, view) -> bool, pointerMove(world, ev, view), pointerUp(world, ev, view), hover?(world, view) } */
  addTool(tool) { this.tools.push(tool); return tool; }

  _local(e) {
    const r = this.el.getBoundingClientRect();
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
  }

  _bindPointer() {
    const c = this.overlay;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      const [sx, sy] = this._local(e);
      c.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: sx, y: sy });
      if (this._pointers.size === 1) {
        this._down = { x: sx, y: sy, t: performance.now() };
        const w = this.camera.screenToWorld(sx, sy);
        this._tool = this.tools.find((t) => t.pointerDown?.(w, e, this)) ?? null;
      } else this._tool = null;
      this._pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const [sx, sy] = this._local(e);
      const prev = this._pointers.get(e.pointerId);
      if (!prev) { // hover
        const w = this.camera.screenToWorld(sx, sy);
        let cursor = '';
        for (const t of this.tools) { const cur = t.hover?.(w, this); if (cur) { cursor = cur; break; } }
        c.style.cursor = cursor || (this.opts.interactive ? 'grab' : '');
        return;
      }
      if (this._tool) { this._tool.pointerMove?.(this.camera.screenToWorld(sx, sy), e, this); prev.x = sx; prev.y = sy; return; }
      if (!this.opts.interactive) return;
      if (this._pointers.size === 1) {
        this.camera.panBy(sx - prev.x, sy - prev.y);
      } else if (this._pointers.size === 2) {
        const other = [...this._pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(sx - other.x, sy - other.y);
        if (d0 > 1) this.camera.zoomAt((sx + other.x) / 2, (sy + other.y) / 2, d1 / d0);
      }
      prev.x = sx; prev.y = sy;
    });
    const up = (e) => {
      const [sx, sy] = this._local(e);
      if (this._tool) this._tool.pointerUp?.(this.camera.screenToWorld(sx, sy), e, this);
      // a click: a short press that barely moved, not consumed by a tool (otherwise it was a pan)
      else if (this._down && this._pointers.size === 1 && Math.hypot(sx - this._down.x, sy - this._down.y) < 5 && performance.now() - this._down.t < 600) {
        this.onClick?.(this.camera.screenToWorld(sx, sy), e);
      }
      this._tool = null;
      this._down = null;
      this._pointers.delete(e.pointerId);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      if (!this.opts.interactive) return;
      e.preventDefault();
      const [sx, sy] = this._local(e);
      this.camera.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
    c.addEventListener('dblclick', () => { if (this.opts.interactive) this.home(900); });
  }
}
