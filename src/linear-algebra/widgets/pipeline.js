// Data → TADs → A_k, on real values from the DGC variable dump (src/linear-algebra/data/pipeline.json).
// The slide's fragments drive five stages:
//   0  G: the whole gene × time matrix (as a thumbnail)
//   1  zoom into 36 genes from 8 adjacent TADs
//   2  pool: gene rows fly into their TAD bands and sum into rows of E
//   3  center: subtract each TAD's cycle average ē, so E becomes Ẽ (signed)
//   4  fit: one A_k per consecutive pair of columns; k sweeps 1…47
// Hover a gene or TAD row to see its partners; hover a column to see the hour.
import data from '../data/pipeline.json';
import { setTex } from '../lib/svg.js';
import { SEC, TAD_GREYS, blend, div, rgb, seq } from '../lib/colors.js';
import { rankOneUpdate } from '../lib/linalg.js';

const STAGES = 4;
const fmtN = (n) => n.toLocaleString('en-US');
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const CAPTIONS = [
  {
    items: [
      ['Measurement', 'scRNA-seq snapshots, every hour for 48 hours.'],
      ['Shape', `${fmtN(data.dims.N)} genes by ${data.dims.K} time points (each column g<sub>k</sub> is one snapshot).`],
      ['Nothing derived yet', 'this is the table fed into DGC.'],
    ],
  },
  {
    items: [
      ['Zoom', `36 real genes from 8 adjacent TADs (rows ${data.window.first_tad_row + 1}–${data.window.first_tad_row + 8} of ${fmtN(data.dims.Ntilde)}), log CP10K.`],
      ['Hover', 'a gene to see its name and TAD; a column to see the hour.'],
    ],
  },
  {
    items: [
      ['Grouping', `genes are summed within each TAD, taking ${fmtN(data.dims.N)} numbers down to ${fmtN(data.dims.Ntilde)}.`],
      ['Basis', 'a TAD is one physical fold of the genome, so the genes inside it move together.'],
    ],
    eq: 'e_{j,k} = \\sum_{i\\,:\\,\\mathrm{tad}(i) = j} g_{i,k}',
  },
  {
    items: [['Centering', 'the cycle average ē is subtracted, so the model describes variation, not level. Blue is below average, orange above.']],
    eq: '\\tilde e_k = e_k - \\bar e, \\qquad \\bar e = \\tfrac{1}{K}\\textstyle\\sum_{k=1}^{K} e_k',
  },
  {
    items: [
      ['Fit', 'one transition matrix A<sub>k</sub> per consecutive pair of columns, chosen as close to the identity as possible.'],
      ['Shown', `A<sub>k</sub> − I for these 8 TADs (an 8 × 8 block of ${fmtN(data.dims.Ntilde)} × ${fmtN(data.dims.Ntilde)}) as k sweeps the cycle. Every A<sub>k</sub> is the identity plus this rank-one update.`],
    ],
    eq: 'A_k = I_{\\tilde N} + \\frac{(\\tilde e_{k+1} - \\tilde e_k)\\,\\tilde e_k^{\\mathsf T}}{\\tilde e_k^{\\mathsf T}\\tilde e_k}',
  },
];

// ---- data prep ----
const K = data.dims.K;
const tads = data.window.tads;
const genes = data.window.genes;
const nT = tads.length, nG = genes.length;
const tadIndex = new Map(tads.map((t, j) => [t.tad, j]));
genes.forEach((g) => { g.j = tadIndex.get(g.tad); });
// position of each gene inside its TAD
const within = tads.map(() => 0);
genes.forEach((g) => { g.w = within[g.j]++; });
const quantile = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(q * (a.length - 1))]; };
const gMax = quantile(genes.flatMap((g) => g.g), 0.97);
const eMax = Math.max(...tads.flatMap((t) => t.e));
const etMax = Math.max(...tads.flatMap((t) => t.etilde.map(Math.abs)));
// Square-root color scale: a few highly expressed genes would otherwise wash every other row out to white.
const sq = (x, m) => seq(Math.sqrt(Math.max(0, x)), Math.sqrt(m));
const gCol = genes.map((g) => g.g.map((x) => rgb(sq(x, gMax))));
const eCol = tads.map((t) => t.e.map((x) => sq(x, eMax)));
const etCol = tads.map((t) => t.etilde.map((x) => div(x, etMax)));
const ebarMax = Math.max(...tads.map((t) => t.ebar));
// A_k restricted to the window is I + Δ cᵀ on the window's rows/columns. Within one 8 × 8 block A_k is almost exactly I,
// so the widget draws the rank-one part A_k − I on its own color scale.
const AK = Array.from({ length: K - 1 }, (_, k) => rankOneUpdate(tads.map((t) => t.delta[k]), tads.map((t) => t.c[k])).map((row, i) => row.map((v, j) => v - (i === j))));
const akMax = quantile(AK.map((A) => Math.max(...A.flat().map(Math.abs))), 0.8);

function thumbCanvas(M, colorOf) {
  const c = document.createElement('canvas');
  c.width = M[0].length; c.height = M.length;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  M.forEach((row, i) => row.forEach((x, k) => {
    const [r, g, b] = colorOf(x);
    const o = 4 * (i * c.width + k);
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }));
  ctx.putImageData(img, 0, 0);
  return c;
}
const thMaxG = Math.max(...data.thumbs.G.flat());
const thMaxE = Math.max(...data.thumbs.E.flat());
const thMaxEt = Math.max(...data.thumbs.Etilde.flat().map(Math.abs)) * 0.6;
const TH = { G: thumbCanvas(data.thumbs.G, (x) => seq(x, thMaxG * 0.8)), E: thumbCanvas(data.thumbs.E, (x) => seq(x, thMaxE * 0.8)), Et: thumbCanvas(data.thumbs.Etilde, (x) => div(x, thMaxEt)) };

// ---- layout (CSS px within the widget's canvas) ----
const PANEL_H = 388, TOP = 58, HM_H = 270;
const P = [0, 1, 2].map((i) => ({ x: 4 + i * 418, w: 410 }));
const G_TH = { x: P[0].x + 62, y: TOP, w: 64, h: HM_H };
const G_Z = { x: P[0].x + 186, y: TOP, w: 200, h: HM_H };
const E_TH = { x: P[1].x + 70, y: TOP, w: 64, h: HM_H };
const E_Z = { x: P[1].x + 176, y: TOP, w: 200, h: HM_H };
const EBAR = { x: E_Z.x + E_Z.w + 8, w: 12 };
const A_Z = { x: P[2].x + 196, y: TOP + 46, s: 196 };
const cw = G_Z.w / K, gh = G_Z.h / nG, th = E_Z.h / nT;

export function create(el, { deck } = {}) {
  el.classList.add('pipe-widget');
  el.innerHTML = `<canvas class="pipe-canvas"></canvas><div class="pipe-tip"></div><div class="pipe-captions"></div>`;
  const canvas = el.querySelector('canvas');
  const tip = el.querySelector('.pipe-tip');
  const capWrap = el.querySelector('.pipe-captions');
  const caps = CAPTIONS.map((c) => {
    const d = document.createElement('div');
    d.className = 'pipe-cap';
    d.innerHTML = c.items.map(([b, t]) => `<p><b>${b}</b> — ${t}</p>`).join('');
    if (c.eq) { const e = document.createElement('div'); e.className = 'pipe-eq'; setTex(e, c.eq, true); d.append(e); }
    capWrap.append(d);
    return d;
  });

  const section = el.closest('section');
  const st = { stage: 0, t: 1, start: 0, k: 0, kStart: 0, hover: null };
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  function resize() {
    W = el.clientWidth; H = PANEL_H;
    const ratio = (window.devicePixelRatio || 1) * Math.max(1, deck?.getScale?.() || 1);
    canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
    canvas.style.height = `${H}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // Progress of each stage's own animation (1 once that stage is fully shown).
  const prog = (n) => (st.stage > n ? 1 : st.stage < n ? 0 : st.t);

  function label(text, x, y, { size = 15, italic = false, color = SEC.ink, align = 'center', alpha = 1, serif = true } = {}) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = `${italic ? 'italic ' : ''}${size}px ${serif ? '"Cambria Math", "Times New Roman", serif' : 'system-ui, sans-serif'}`;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  }
  function dims(box, rowsSym, rowsN, colsSym, colsN, alpha) {
    label(colsSym, box.x + box.w / 2, box.y - 36, { italic: true, size: 19, alpha });
    label(colsN, box.x + box.w / 2, box.y - 17, { size: 13, color: SEC.muted, alpha });
    label(rowsSym, box.x - 10, box.y + box.h / 2 - 10, { italic: true, size: 19, align: 'right', alpha });
    label(rowsN, box.x - 10, box.y + box.h / 2 + 10, { size: 13, color: SEC.muted, align: 'right', alpha });
  }
  function frame(box, alpha, w = 1.5) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = SEC.ink; ctx.lineWidth = w;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // panels
    P.forEach((p, i) => {
      ctx.fillStyle = SEC.wash; ctx.fillRect(p.x, 0, p.w, PANEL_H);
      ctx.strokeStyle = SEC.line; ctx.lineWidth = 1; ctx.strokeRect(p.x + 0.5, 0.5, p.w - 1, PANEL_H - 1);
    });
    const p1 = ease(prog(1)), p2 = prog(2), p3 = ease(prog(3)), p4 = ease(prog(4));
    const hov = st.hover;

    // ---- panel 1: G ----
    const gFocus = st.stage <= 1 ? 1 : 0.55;
    ctx.globalAlpha = gFocus;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(TH.G, G_TH.x, G_TH.y, G_TH.w, G_TH.h);
    ctx.globalAlpha = 1;
    frame(G_TH, gFocus, st.stage === 0 ? 2 : 1.2);
    dims(G_TH, 'N', fmtN(data.dims.N), 'K', String(K), gFocus);
    if (p1 > 0) {
      // lens from the window's position in G to the zoomed heatmap
      const y0 = G_TH.y + (data.window.gene_offset / data.dims.N) * G_TH.h;
      const y1 = y0 + Math.max(2, (nG / data.dims.N) * G_TH.h);
      ctx.globalAlpha = 0.5 * p1;
      ctx.fillStyle = '#c9d7ea';
      ctx.beginPath();
      ctx.moveTo(G_TH.x + G_TH.w, y0 - 1); ctx.lineTo(G_Z.x - 10, G_Z.y); ctx.lineTo(G_Z.x - 10, G_Z.y + G_Z.h); ctx.lineTo(G_TH.x + G_TH.w, y1 + 1);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = p1;
      ctx.strokeStyle = SEC.terrain; ctx.lineWidth = 2;
      ctx.strokeRect(G_TH.x - 3, y0 - 2, G_TH.w + 6, y1 - y0 + 4);
      // zoomed gene rows (stay as a ghost once they have been pooled)
      const ghost = st.stage >= 2 ? 1 - 0.55 * ease(clamp01(p2 / 0.3)) : 1;
      ctx.globalAlpha = p1 * ghost * gFocus;
      genes.forEach((g, i) => {
        for (let k = 0; k < K; k++) { ctx.fillStyle = gCol[i][k]; ctx.fillRect(G_Z.x + k * cw, G_Z.y + i * gh, cw + 0.4, gh + 0.4); }
        ctx.fillStyle = TAD_GREYS[g.j % 2]; ctx.fillRect(G_Z.x - 9, G_Z.y + i * gh, 5, gh + 0.4);
      });
      ctx.globalAlpha = 1;
      frame(G_Z, p1 * gFocus);
      label('36 genes', G_Z.x + G_Z.w / 2, G_Z.y + G_Z.h + 14, { size: 13, color: SEC.muted, alpha: p1, serif: false });
    }
    label('G  (genes × hours)', P[0].x + P[0].w / 2, PANEL_H - 14, { size: 14, color: SEC.muted, serif: false, alpha: 0.9 });

    // ---- panel 2: E (or Ẽ) ----
    const eOn = clamp01(p2 * 3);
    const eAlpha = 0.25 + 0.75 * eOn;
    ctx.globalAlpha = eAlpha * (st.stage >= 2 ? 1 : 0.35);
    ctx.drawImage(TH.E, E_TH.x, E_TH.y, E_TH.w, E_TH.h);
    if (p3 > 0) { ctx.globalAlpha = p3; ctx.drawImage(TH.Et, E_TH.x, E_TH.y, E_TH.w, E_TH.h); }
    ctx.globalAlpha = 1;
    frame(E_TH, st.stage >= 2 ? 1 : 0.3, 1.2);
    dims(E_TH, 'Ñ', fmtN(data.dims.Ntilde), 'K', String(K), st.stage >= 2 ? 1 : 0.3);
    frame(E_Z, st.stage >= 2 ? 1 : 0.25);
    if (st.stage >= 2) {
      const ey0 = E_TH.y + (data.window.first_tad_row / data.dims.Ntilde) * E_TH.h;
      ctx.globalAlpha = 0.45 * eOn; ctx.fillStyle = '#c9d7ea';
      ctx.beginPath(); ctx.moveTo(E_TH.x + E_TH.w, ey0 - 1); ctx.lineTo(E_Z.x - 10, E_Z.y); ctx.lineTo(E_Z.x - 10, E_Z.y + E_Z.h); ctx.lineTo(E_TH.x + E_TH.w, ey0 + 3); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = eOn; ctx.strokeStyle = SEC.terrain; ctx.lineWidth = 2; ctx.strokeRect(E_TH.x - 3, ey0 - 2, E_TH.w + 6, 6);
      ctx.globalAlpha = 1;
      // flying gene rows (pooling)
      const fly = ease(clamp01(p2 / 0.6)), merge = ease(clamp01((p2 - 0.6) / 0.4));
      if (merge < 1) {
        ctx.globalAlpha = 1 - merge;
        genes.forEach((g, i) => {
          const n = tads[g.j].genes;
          const fy = G_Z.y + i * gh, ty = E_Z.y + g.j * th + (g.w * th) / n;
          const y = fy + (ty - fy) * fly, x = G_Z.x + (E_Z.x - G_Z.x) * fly, h = gh + (th / n - gh) * fly;
          for (let k = 0; k < K; k++) { ctx.fillStyle = gCol[i][k]; ctx.fillRect(x + k * cw, y, cw + 0.4, h + 0.4); }
        });
        ctx.globalAlpha = 1;
      }
      if (merge > 0) {
        tads.forEach((t, j) => {
          ctx.globalAlpha = merge;
          for (let k = 0; k < K; k++) { ctx.fillStyle = rgb(blend(eCol[j][k], etCol[j][k], p3)); ctx.fillRect(E_Z.x + k * cw, E_Z.y + j * th, cw + 0.4, th + 0.4); }
          ctx.fillStyle = TAD_GREYS[j % 2]; ctx.fillRect(E_Z.x - 9, E_Z.y + j * th, 5, th);
          // ē column, which is what centering subtracts
          if (p3 > 0) {
            ctx.globalAlpha = merge * p3;
            ctx.fillStyle = rgb(seq(t.ebar, ebarMax)); ctx.fillRect(EBAR.x, E_Z.y + j * th, EBAR.w, th);
          }
        });
        ctx.globalAlpha = 1;
        if (p3 > 0) { ctx.globalAlpha = p3; ctx.strokeStyle = SEC.ink; ctx.lineWidth = 1; ctx.strokeRect(EBAR.x, E_Z.y, EBAR.w, E_Z.h); ctx.globalAlpha = 1; label('ē', EBAR.x + EBAR.w / 2, E_Z.y - 12, { italic: true, size: 17, alpha: p3 }); }
        frame(E_Z, 1, 1.8);
      }
      label('8 TADs', E_Z.x + E_Z.w / 2, E_Z.y + E_Z.h + 14, { size: 13, color: SEC.muted, serif: false, alpha: eOn });
    }
    label(st.stage >= 3 ? 'Ẽ  (TADs × hours, centered)' : 'E  (TADs × hours)', P[1].x + P[1].w / 2, PANEL_H - 14, { size: 14, color: SEC.muted, serif: false, alpha: st.stage >= 2 ? 0.9 : 0.35 });

    // ---- panel 3: the A_k stack ----
    const aOn = p4;
    const S = A_Z.s, cs = S / nT;
    for (let i = 4; i >= 1; i--) {
      ctx.globalAlpha = 0.25 + 0.75 * aOn;
      ctx.fillStyle = '#fff'; ctx.fillRect(A_Z.x - i * 9, A_Z.y - i * 9, S, S);
      ctx.strokeStyle = SEC.ink; ctx.lineWidth = 1.2; ctx.strokeRect(A_Z.x - i * 9, A_Z.y - i * 9, S, S);
    }
    ctx.globalAlpha = 1;
    if (aOn > 0) {
      const A = AK[st.k];
      ctx.globalAlpha = aOn;
      for (let i = 0; i < nT; i++) for (let j = 0; j < nT; j++) { ctx.fillStyle = rgb(div(A[i][j], akMax)); ctx.fillRect(A_Z.x + j * cs, A_Z.y + i * cs, cs + 0.4, cs + 0.4); }
      ctx.globalAlpha = 1;
      label(`A${String(st.k + 1).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d])} − I`, A_Z.x + S / 2, A_Z.y + S + 18, { italic: true, size: 18, alpha: aOn });
      label(`hour ${data.hours[st.k]} → ${data.hours[st.k + 1]}`, A_Z.x + S / 2, A_Z.y + S + 38, { size: 13, color: SEC.muted, serif: false, alpha: aOn });
      // the two columns this A_k is fitted from
      ctx.globalAlpha = aOn; ctx.strokeStyle = SEC.optimization; ctx.lineWidth = 2;
      ctx.strokeRect(E_Z.x + st.k * cw - 1, E_Z.y - 3, 2 * cw + 2, E_Z.h + 6);
      ctx.globalAlpha = 1;
      // arrow E → A
      ctx.globalAlpha = 0.6 * aOn; ctx.fillStyle = '#b9cde6';
      const ax = P[2].x + 12, ay = A_Z.y + S / 2 - 30;
      ctx.beginPath(); ctx.moveTo(ax, ay - 12); ctx.lineTo(ax + 70, ay - 12); ctx.lineTo(ax + 70, ay - 28); ctx.lineTo(ax + 100, ay); ctx.lineTo(ax + 70, ay + 28); ctx.lineTo(ax + 70, ay + 12); ctx.lineTo(ax, ay + 12); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = SEC.ink; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.25 + 0.75 * aOn; ctx.strokeRect(A_Z.x, A_Z.y, S, S); ctx.globalAlpha = 1;
    const aa = 0.3 + 0.7 * aOn;
    label('Ñ', A_Z.x + S / 2 - 18, A_Z.y - 36 - 30, { italic: true, size: 19, alpha: aa });
    label(fmtN(data.dims.Ntilde), A_Z.x + S / 2 - 18, A_Z.y - 36 - 12, { size: 13, color: SEC.muted, alpha: aa });
    label('Ñ', A_Z.x - 46, A_Z.y + S / 2 - 10, { italic: true, size: 19, align: 'right', alpha: aa });
    label(fmtN(data.dims.Ntilde), A_Z.x - 46, A_Z.y + S / 2 + 10, { size: 13, color: SEC.muted, align: 'right', alpha: aa });
    label(`K − 1 = ${K - 1} matrices`, P[2].x + P[2].w / 2, PANEL_H - 14, { size: 14, color: SEC.muted, serif: false, alpha: st.stage >= 4 ? 0.9 : 0.35 });

    // ---- hover highlights ----
    if (hov) {
      ctx.lineWidth = 2; ctx.strokeStyle = SEC.ink;
      if (hov.col != null) {
        for (const box of [G_Z, E_Z]) if ((box === G_Z && st.stage >= 1) || (box === E_Z && st.stage >= 2)) ctx.strokeRect(box.x + hov.col * cw - 0.5, box.y - 2, cw + 1, box.h + 4);
      }
      if (hov.tad != null) {
        if (st.stage >= 2) ctx.strokeRect(E_Z.x - 10, E_Z.y + hov.tad * th, E_Z.w + 10, th);
        const rows = genes.map((g, i) => [g, i]).filter(([g]) => g.j === hov.tad);
        if (st.stage >= 1 && rows.length) ctx.strokeRect(G_Z.x - 10, G_Z.y + rows[0][1] * gh, G_Z.w + 10, rows.length * gh);
      }
      if (hov.gene != null) { ctx.strokeStyle = SEC.optimization; ctx.strokeRect(G_Z.x - 10, G_Z.y + hov.gene * gh, G_Z.w + 10, gh); }
    }
  }

  // ---- hover ----
  function hit(x, y) {
    const inside = (b, h) => x >= b.x - 10 && x < b.x + b.w && y >= b.y && y < b.y + h;
    const col = (b) => Math.min(K - 1, Math.max(0, Math.floor((x - b.x) / cw)));
    if (st.stage >= 1 && inside(G_Z, G_Z.h)) {
      const i = Math.min(nG - 1, Math.floor((y - G_Z.y) / gh));
      const c = x >= G_Z.x ? col(G_Z) : null;
      const g = genes[i];
      return { gene: i, tad: g.j, col: c, text: `<b>${g.gene}</b> · TAD ${g.tad}` + (c != null ? `<br>hour ${data.hours[c]}: ${g.g[c].toFixed(2)}` : '') };
    }
    if (st.stage >= 2 && inside(E_Z, E_Z.h)) {
      const j = Math.min(nT - 1, Math.floor((y - E_Z.y) / th));
      const c = x >= E_Z.x ? col(E_Z) : null;
      const t = tads[j];
      const names = genes.filter((g) => g.j === j).map((g) => g.gene).join(', ');
      const val = c == null ? '' : st.stage >= 3 ? `<br>hour ${data.hours[c]}: ẽ = ${t.etilde[c].toFixed(2)}` : `<br>hour ${data.hours[c]}: e = ${t.e[c].toFixed(2)}`;
      return { tad: j, col: c, text: `<b>TAD ${t.tad}</b> · ${t.genes} genes<br><span class="dim">${names}</span>${val}` };
    }
    return null;
  }
  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const sc = r.width / W;
    const x = (ev.clientX - r.left) / sc, y = (ev.clientY - r.top) / sc;
    st.hover = hit(x, y);
    if (st.hover) {
      tip.innerHTML = st.hover.text;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(W - 230, x + 14)}px`;
      tip.style.top = `${y + 14}px`;
    } else tip.style.display = 'none';
    draw();
  });
  canvas.addEventListener('pointerleave', () => { st.hover = null; tip.style.display = 'none'; draw(); });

  // ---- stages from fragments ----
  function syncStage() {
    const n = section ? section.querySelectorAll('.fragment.visible').length : 0;
    const stage = Math.min(STAGES, n);
    if (stage === st.stage) return;
    st.t = stage > st.stage ? 0 : 1; // animate forward, jump back
    st.start = performance.now();
    if (stage === STAGES) st.kStart = st.start;
    st.stage = stage;
    caps.forEach((c, i) => c.classList.toggle('on', i === stage));
  }
  const onFrag = () => syncStage();
  deck?.on('fragmentshown', onFrag);
  deck?.on('fragmenthidden', onFrag);
  caps[0].classList.add('on');

  let raf = 0, active = false;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    syncStage();
    // Clock-based, so animations keep their pace even when the browser throttles frames.
    const dur = st.stage === 2 ? 2.4 : 1.1;
    if (st.t < 1) st.t = Math.min(1, (now - st.start) / 1000 / dur);
    if (st.stage >= 4) st.k = Math.floor((now - st.kStart) / 450) % (K - 1);
    draw();
  }

  const ro = new ResizeObserver(() => { resize(); draw(); });
  ro.observe(el);
  resize();
  syncStage();
  draw();
  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) { resize(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
    },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      deck?.off('fragmentshown', onFrag); deck?.off('fragmenthidden', onFrag);
      el.innerHTML = '';
    },
  };
}
