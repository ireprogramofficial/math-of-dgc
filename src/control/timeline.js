// Linked timeline: one row per thruster (N, E, S, W), one bar per control interval, plus a playhead.
// Drag in a row to paint thrust (height = fraction of full thrust); click the axis to scrub.

import { DIRS, NU } from './boat.js';

const COLORS = { N: '#d8572a', E: '#d8572a', S: '#d8572a', W: '#d8572a' };

export class Timeline {
  /**
   * @param {HTMLElement} wrap container (the canvas is created inside)
   * @param {object} o { N, T, getU(): Float64Array, getEnabled(): bool[], onEdit(U), onSeek(t), editable }
   */
  constructor(wrap, o) {
    this.o = { editable: true, ...o };
    this.canvas = document.createElement('canvas');
    wrap.append(this.canvas);
    this.wrap = wrap;
    this.rowH = 26;
    this.axisH = 24;
    this.labelW = 34;
    this.t = 0;
    this.height = NU * this.rowH + this.axisH + 8;
    this.canvas.style.height = this.height + 'px';
    this.canvas.style.touchAction = 'none';
    this._bind();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(wrap);
  }

  setHorizon(N, T) { this.o.N = N; this.o.T = T; this.draw(); }
  setTime(t) { this.t = t; this.draw(); }
  destroy() { this._ro.disconnect(); this.canvas.remove(); }

  _metrics() {
    const w = this.canvas.clientWidth, rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / (w || 1) || 1, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = scale * dpr;
    const bw = Math.round(w * k), bh = Math.round(this.height * k);
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    return { w, k, scale, rect };
  }

  draw() {
    const { w, k } = this._metrics();
    if (!w) return;
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, w, this.height);
    const { N, T } = this.o, U = this.o.getU(), en = this.o.getEnabled();
    const x0 = this.labelW, plotW = w - x0 - 6, colW = plotW / N;
    ctx.font = '600 12px "Source Sans Pro", system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (let c = 0; c < NU; c++) {
      const y0 = c * this.rowH;
      ctx.fillStyle = en[c] ? '#ffffff' : '#eceff3';
      ctx.fillRect(x0, y0 + 2, plotW, this.rowH - 4);
      ctx.strokeStyle = '#d5dde6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 2.5, plotW - 1, this.rowH - 5);
      // half-thrust guide
      ctx.beginPath(); ctx.moveTo(x0, y0 + this.rowH / 2); ctx.lineTo(x0 + plotW, y0 + this.rowH / 2);
      ctx.strokeStyle = 'rgba(86,102,121,0.15)'; ctx.stroke();
      ctx.fillStyle = en[c] ? '#16283d' : '#9aa7b6';
      ctx.textAlign = 'center';
      ctx.fillText(DIRS[c], this.labelW / 2 - 2, y0 + this.rowH / 2);
      if (!en[c]) continue;
      for (let kk = 0; kk < N; kk++) {
        const u = U[NU * kk + c];
        if (u <= 0.004) continue;
        const bh = u * (this.rowH - 6);
        ctx.fillStyle = COLORS[DIRS[c]];
        ctx.globalAlpha = 0.35 + 0.65 * u;
        ctx.fillRect(x0 + kk * colW + 0.5, y0 + this.rowH - 3 - bh, Math.max(colW - 1, 1), bh);
        ctx.globalAlpha = 1;
      }
    }

    // axis
    const ay = NU * this.rowH + 4;
    ctx.fillStyle = '#566679';
    ctx.textAlign = 'center';
    const step = T > 700 ? 120 : T > 300 ? 60 : 30;
    ctx.font = '12px "Source Sans Pro", system-ui, sans-serif';
    for (let s = 0; s <= T + 1e-6; s += step) {
      const x = x0 + (s / T) * plotW;
      ctx.fillRect(x - 0.5, ay, 1, 4);
      ctx.fillText(`${s}s`, Math.min(Math.max(x, x0 + 10), x0 + plotW - 10), ay + 14);
    }

    // playhead
    const px = x0 + (this.t / T) * plotW;
    ctx.strokeStyle = '#16283d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, NU * this.rowH + 2); ctx.stroke();
    ctx.fillStyle = '#16283d';
    ctx.beginPath(); ctx.moveTo(px - 5, ay + 2); ctx.lineTo(px + 5, ay + 2); ctx.lineTo(px, ay - 4); ctx.closePath(); ctx.fill();
  }

  _local(e) {
    const { scale, rect } = this._metrics();
    return [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale];
  }

  _hit(x, y) {
    const { w } = this._metrics();
    const x0 = this.labelW, plotW = w - x0 - 6, { N } = this.o;
    const col = Math.floor(((x - x0) / plotW) * N);
    const row = Math.floor(y / this.rowH);
    return { col: Math.min(Math.max(col, 0), N - 1), row, inAxis: y >= NU * this.rowH, inPlot: x >= x0 - 2, t: Math.min(Math.max(((x - x0) / plotW) * this.o.T, 0), this.o.T), plotW, x0 };
  }

  _paint(e) {
    const [x, y] = this._local(e), h = this._hit(x, y);
    if (this._mode === 'seek') { this.o.onSeek?.(h.t); return; }
    const c = this._row;
    if (!this.o.getEnabled()[c]) return;
    const U = this.o.getU();
    const rowTop = c * this.rowH + 3;
    let v = 1 - (y - rowTop) / (this.rowH - 6);
    v = Math.min(Math.max(v, 0), 1);
    if (e.shiftKey || v < 0.06) v = 0;
    // paint every column between the last and current pointer positions
    const a = this._lastCol ?? h.col, b = h.col;
    for (let kk = Math.min(a, b); kk <= Math.max(a, b); kk++) U[NU * kk + c] = v;
    this._lastCol = h.col;
    this.o.onEdit?.(U);
  }

  _bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      const [x, y] = this._local(e), h = this._hit(x, y);
      cv.setPointerCapture(e.pointerId);
      this._down = true;
      if (h.inAxis) this._mode = 'seek';
      else if (this.o.editable && h.inPlot && h.row >= 0 && h.row < NU) { this._mode = 'paint'; this._row = h.row; this._lastCol = null; }
      else this._mode = null;
      if (this._mode) this._paint(e);
    });
    cv.addEventListener('pointermove', (e) => { if (this._down && this._mode) this._paint(e); });
    const up = () => { this._down = false; this._mode = null; this._lastCol = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.style.cursor = this.o.editable ? 'crosshair' : 'default';
  }
}
