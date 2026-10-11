// Synthetic river scenarios, ordered by complexity. Units: meters, seconds; y is UP.
//
// Every scenario is a water region (signed-distance shape) plus where water enters (`sources`)
// and leaves (`sinks`). Flow is the solution of potential flow in that region (see solver.js), so
// water speeds up in narrow channels and slows in basins, like the real flow in the reference video.
// The gyre is the exception: its field is analytic (a vortex), which makes it a clean linear-dynamics example.
//
// Camera views are { cx, cy, span } where span is the visible width in meters.

import { channel, disc, ellipse, rect, union } from './geometry.js';

export const WORLD = { width: 1600, height: 900 };

// Each scenario's first view ("Overview") frames its own content: span x spanY must fit entirely on any stage shape.
const home = { cx: 800, cy: 450, span: 1640 };

// ---- 1. straight channel -----------------------------------------------------------------
const straight = {
  id: 'straight',
  name: 'Straight channel',
  blurb: 'Uniform width. Fastest at the center, slow at the banks.',
  complexity: 1,
  water: channel([[-100, 450], [1700, 450]], 260, 2),
  sources: [rect(-200, 0, 20, 900)],
  sinks: [rect(1580, 0, 1800, 900)],
  speedRef: 1.6,
  boat: { start: [150, 450], target: [1100, 545], horizon: 300 },
  views: [
    { name: 'Overview', cx: 640, cy: 450, span: 1360, spanY: 340 },
    { name: 'Near the start', cx: 280, cy: 450, span: 420 },
    { name: 'The banks', cx: 600, cy: 380, span: 140 },
  ],
  labels: [{ x: 800, y: 560, text: 'flow →', size: 15 }],
};

// ---- 2. meandering channel ---------------------------------------------------------------
const meanderY = (x) => 450 + 215 * Math.sin((2 * Math.PI * x) / 1000);
const meanderPts = [];
for (let x = -100; x <= 1700; x += 60) meanderPts.push([x, meanderY(x)]);
const meander = {
  id: 'meander',
  name: 'Meandering channel',
  blurb: 'The drift now curves, so the best route is not a straight line.',
  complexity: 2,
  water: channel(meanderPts, 110, 4),
  sources: [rect(-200, 0, 20, 900)],
  sinks: [rect(1580, 0, 1800, 900)],
  speedRef: 1.5,
  boat: { start: [120, meanderY(120)], target: [1330, meanderY(1330)], horizon: 420 },
  views: [
    { name: 'Overview', cx: 800, cy: 450, span: 1640, spanY: 640 },
    { name: 'First bend', cx: 300, cy: 650, span: 380 },
    { name: 'Second bend', cx: 770, cy: 270, span: 380 },
  ],
  labels: [],
};

// ---- 3. river into a lake ----------------------------------------------------------------
const lake = {
  id: 'lake',
  name: 'River into a lake',
  blurb: 'A fast jet spreads into slow, diffuse water, then drains out the far side.',
  complexity: 3,
  water: union(
    channel([[-100, 300], [250, 300], [420, 330], [560, 400]], 80, 8),
    ellipse(900, 450, 390, 270, 0),
    channel([[1160, 520], [1290, 600], [1420, 640], [1700, 640]], 80, 8),
  ),
  sources: [rect(-200, 0, 20, 900)],
  sinks: [rect(1580, 0, 1800, 900)],
  speedRef: 1.4,
  boat: { start: [120, 300], target: [1400, 640], horizon: 600 },
  views: [
    { name: 'Overview', cx: 800, cy: 450, span: 1640, spanY: 600 },
    { name: 'Inlet jet', cx: 520, cy: 370, span: 520 },
    { name: 'Open lake', cx: 900, cy: 450, span: 820 },
  ],
  labels: [{ x: 900, y: 470, text: 'LAKE', size: 22 }, { x: 160, y: 235, text: 'inlet', size: 15 }, { x: 1470, y: 575, text: 'outlet', size: 15 }],
};

// ---- 4. confluence -----------------------------------------------------------------------
const confluence = {
  id: 'confluence',
  name: 'Confluence',
  blurb: 'Two tributaries merge. Two routes, and the water they carry differs.',
  complexity: 4,
  water: union(
    channel([[-100, 175], [300, 205], [600, 320], [800, 425]], 60, 8),
    channel([[-100, 745], [300, 700], [600, 570], [800, 475]], 84, 8),
    channel([[740, 450], [1100, 450], [1700, 450]], 124, 4),
  ),
  sources: [rect(-200, 0, 20, 900)],
  sinks: [rect(1580, 0, 1800, 900)],
  speedRef: 1.5,
  boat: { start: [120, 190], target: [1400, 450], horizon: 560 },
  views: [
    { name: 'Overview', cx: 800, cy: 465, span: 1640, spanY: 700 },
    { name: 'The junction', cx: 780, cy: 450, span: 460 },
    { name: 'Main channel', cx: 1250, cy: 450, span: 520 },
  ],
  labels: [{ x: 360, y: 255, text: 'tributary A', size: 15 }, { x: 360, y: 660, text: 'tributary B', size: 15 }],
};

// ---- 5. gyre (analytic vortex) -----------------------------------------------------------
const GYRE = { cx: 800, cy: 450, R: 400, r0: 170, V0: 1.3 };
const gyre = {
  id: 'gyre',
  name: 'Gyre',
  blurb: 'A rotating lake. Near its center the flow is linear with complex eigenvalues.',
  complexity: 5,
  type: 'analytic',
  water: disc(GYRE.cx, GYRE.cy, GYRE.R),
  field: (x, y) => {
    const dx = x - GYRE.cx, dy = y - GYRE.cy, r = Math.hypot(dx, dy) || 1e-6;
    const s = r / GYRE.r0;
    const vt = GYRE.V0 * s * Math.exp(0.5 * (1 - s * s));
    return [(-vt * dy) / r, (vt * dx) / r];
  },
  speedRef: GYRE.V0,
  boat: { start: [1000, 450], target: [800, 760], horizon: 480 },
  views: [
    { name: 'Overview', cx: 800, cy: 450, span: 900, spanY: 880 },
    { name: 'The core', cx: 800, cy: 450, span: 420 },
    { name: 'The edge', cx: 1090, cy: 450, span: 300 },
  ],
  labels: [{ x: 800, y: 450, text: 'core', size: 15 }],
};


// ---- 6. meandering fork: one source basin -> two terminal basins, each with a gyre ---------
const FORK = {
  src: { x: 150, y: 450, r: 125 },
  basins: [{ x: 1420, y: 270, r: 125 }, { x: 1420, y: 630, r: 125 }],
};
const fork = {
  id: 'fork',
  name: 'Fork with gyres',
  blurb: 'One source basin splits into two meandering channels. Each basin has its own gyre on top of the through-flow.',
  complexity: 6,
  water: union(
    disc(FORK.src.x, FORK.src.y, FORK.src.r),
    channel([[150, 450], [300, 472], [430, 430], [560, 450]], [100, 92, 92, 90], 8),
    channel([[540, 450], [660, 420], [780, 352], [900, 330], [1010, 368], [1120, 322], [1230, 302], [1330, 286], [1410, 270]], [78, 72, 68, 64, 62, 60, 58, 58, 58], 8),
    channel([[540, 450], [660, 480], [780, 548], [900, 572], [1010, 534], [1120, 580], [1230, 600], [1330, 616], [1410, 630]], [78, 72, 68, 64, 62, 60, 58, 58, 58], 8),
    ...FORK.basins.map((b) => disc(b.x, b.y, b.r)),
  ),
  sources: [disc(FORK.src.x - FORK.src.r + 16, FORK.src.y, 24)],
  sinks: FORK.basins.map((b) => disc(b.x + b.r - 14, b.y, 22)),
  // Potential flow cannot rotate, so each basin gets an explicit vortex added to the through-flow.
  swirls: [
    { x: FORK.src.x, y: FORK.src.y, R: FORK.src.r, r0: 55, V: 0.5, dir: 1 },
    { x: FORK.basins[0].x, y: FORK.basins[0].y, R: FORK.basins[0].r, r0: 60, V: 0.55, dir: -1 },
    { x: FORK.basins[1].x, y: FORK.basins[1].y, R: FORK.basins[1].r, r0: 60, V: 0.55, dir: 1 },
  ],
  speedRef: 1.2,
  boat: { start: [150, 450], target: [1400, 270], horizon: 700 },
  targets: [{ name: 'Basin 1', x: 1400, y: 270 }, { name: 'Basin 2', x: 1400, y: 630 }],
  views: [
    { name: 'Overview', cx: 790, cy: 450, span: 1580, spanY: 660 },
    { name: 'The fork', cx: 600, cy: 450, span: 520 },
    { name: 'Basin 1 gyre', cx: 1420, cy: 270, span: 340 },
    { name: 'Basin 2 gyre', cx: 1420, cy: 630, span: 340 },
  ],
  labels: [
    { x: 150, y: 450, text: 'source', size: 16 },
    { x: 1420, y: 270, text: 'basin 1', size: 15 },
    { x: 1420, y: 630, text: 'basin 2', size: 15 },
  ],
};

// ---- 7. branching delta: one source basin -> five terminal basins -----------------------
const TERMINALS = [110, 280, 450, 620, 790].map((y) => ({ x: 1420, y, r: 75 }));
const deltaPaths = [
  channel([[140, 450], [300, 450], [430, 450], [520, 450]], [100, 92, 92, 92], 8),
  // upper branch, then two leaves
  channel([[490, 450], [600, 405], [700, 325], [780, 292]], [80, 72, 66, 62], 8),
  channel([[760, 296], [900, 205], [1100, 150], [1400, 110]], [60, 54, 50, 48], 8),
  channel([[760, 296], [900, 302], [1100, 292], [1400, 280]], [60, 54, 50, 48], 8),
  // lower branch: one leaf, then a sub-branch with two more
  channel([[490, 450], [600, 500], [700, 578], [780, 610]], [80, 72, 66, 62], 8),
  channel([[760, 606], [950, 525], [1150, 470], [1400, 450]], [60, 54, 50, 48], 8),
  channel([[760, 614], [900, 688], [1000, 700], [1080, 700]], [60, 54, 50, 50], 8),
  channel([[1060, 700], [1200, 655], [1300, 625], [1400, 620]], [52, 48, 46, 46], 8),
  channel([[1060, 700], [1200, 758], [1300, 788], [1400, 790]], [52, 48, 46, 46], 8),
];
const delta = {
  id: 'delta',
  name: 'Branching delta',
  blurb: 'One source basin splits through a tree of channels into five terminal basins.',
  complexity: 7,
  water: union(disc(140, 450, 110), ...deltaPaths, ...TERMINALS.map((t) => disc(t.x, t.y, t.r))),
  sources: [disc(52, 450, 22)],
  sinks: TERMINALS.map((t) => disc(t.x + t.r - 12, t.y, 20)),
  speedRef: 1.3,
  boat: { start: [140, 450], target: [TERMINALS[2].x - 20, TERMINALS[2].y], horizon: 900 },
  targets: TERMINALS.map((t, i) => ({ name: `Basin ${TERMINALS.length - i}`, x: t.x - 20, y: t.y })), // numbered top to bottom
  views: [
    { name: 'Overview', cx: 770, cy: 450, span: 1520, spanY: 880 },
    { name: 'First split', cx: 560, cy: 450, span: 460 },
    { name: 'Terminal basins', cx: 1330, cy: 450, span: 640 },
  ],
  labels: [
    { x: 140, y: 450, text: 'source', size: 16 },
    ...TERMINALS.map((t, i) => ({ x: t.x - 6, y: t.y, text: `basin ${TERMINALS.length - i}`, size: 14 })),
  ],
};

export const SCENARIOS = [straight, meander, lake, confluence, gyre, fork, delta];
export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
export const getScenario = (id) => {
  const s = SCENARIO_BY_ID[id];
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
};
