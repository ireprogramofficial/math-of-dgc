// The closed- vs open-loop demo must actually show the distinction: a gust ruins the open-loop plan,
// while the closed-loop autopilot still reaches the target.
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/control/autopilot.js';
import { BoatModel, NU } from '../src/control/boat.js';
import { LiveBoat } from '../src/control/liveBoat.js';
import { makeProblem, TrajectoryOptimizer } from '../src/control/optimizer.js';
import { computeFlow } from '../src/river/solver.js';
import { getScenario } from '../src/river/scenarios.js';

function run(id, gust) {
  const scn = getScenario(id), flow = computeFlow(id).flow, model = new BoatModel(flow);
  const problem = makeProblem(model, scn);
  const opt = new TrajectoryOptimizer(problem); opt.run(3000);
  const ol = new LiveBoat(model), cl = new LiveBoat(model);
  ol.reset(scn.boat.start); cl.reset(scn.boat.start);
  const pilot = new Autopilot(flow, scn, model, { cruise: 3.2 }); pilot.goTo(problem.target, scn.boat.start);
  const T = problem.T, h = T / (problem.N * problem.sub), dtU = T / problem.N, u = new Float64Array(NU);
  let g = null;
  for (let t = 0; t < T * 1.3; t += h) {
    if (gust && !g && t >= 0.3 * T) g = { left: 40, ax: 0, ay: 0.55 * gust };
    const k = Math.floor(t / dtU);
    for (let c = 0; c < NU; c++) u[c] = k < problem.N ? opt.U[NU * k + c] : 0;
    ol.step(u, h); cl.step(pilot.control(cl.x, h), h);
    if (g && g.left > 0) { for (const b of [ol, cl]) { b.x[2] += g.ax * h; b.x[3] += g.ay * h; b.constrain(); } g.left -= h; }
    if (Math.abs(t + h - T) < h / 2) ol.atT = [ol.x[0], ol.x[1]];
  }
  const d = (p) => Math.hypot(p[0] - problem.target[0], p[1] - problem.target[1]);
  return { openMiss: d(ol.atT), closedMiss: d([cl.x[0], cl.x[1]]) };
}

describe('closed- vs open-loop demo', () => {
  it('meander: without a gust, the open-loop plan reaches the target', () => {
    const r = run('meander', 0);
    console.log('no gust', r);
    expect(r.openMiss).toBeLessThan(20);
    expect(r.closedMiss).toBeLessThan(20);
  });
  for (const dir of [1, -1]) {
    it(`meander: a gust (${dir > 0 ? 'north' : 'south'}) makes open loop miss; closed loop still arrives`, () => {
      const r = run('meander', dir);
      console.log('gust', dir, r);
      expect(r.openMiss).toBeGreaterThan(50);
      expect(r.closedMiss).toBeLessThan(20);
    });
  }
});
