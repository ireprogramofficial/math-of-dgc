// The open- vs closed-loop demo must actually show the distinction: both boats share one plan; without a gust they
// coincide, and a gust ruins the open-loop run while the closed-loop (plan + feedback) boat still reaches the target.
import { describe, expect, it } from 'vitest';
import { BoatModel } from '../src/control/boat.js';
import { LiveBoat } from '../src/control/liveBoat.js';
import { evaluate, makeProblem, TrajectoryOptimizer } from '../src/control/optimizer.js';
import { makeLoops } from '../src/control/tracking.js';
import { autopilotGuess } from '../src/control/warmStart.js';
import { computeFlow } from '../src/river/solver.js';
import { getScenario } from '../src/river/scenarios.js';

function run(id, gust) {
  const scn = getScenario(id), flow = computeFlow(id).flow, model = new BoatModel(flow);
  const problem = makeProblem(model, scn);
  const opt = new TrajectoryOptimizer(problem, null, { fallback: () => autopilotGuess(problem, scn) }); opt.run(3000);
  const loops = makeLoops(model, problem, opt.U, evaluate(problem, opt.U).X);
  const ol = new LiveBoat(model), cl = new LiveBoat(model);
  ol.reset(scn.boat.start); cl.reset(scn.boat.start);
  const h = problem.T / loops.M;
  let g = null, apart = 0, olT = null, clT = null;
  for (let j = 0; j < loops.M; j++) {
    if (gust && !g && j >= 0.3 * loops.M) g = { left: 40, vx: 0, vy: 2 * gust };
    ol.step(loops.uPlan(j), h); cl.step(loops.track(j, cl.x), h);
    if (g && g.left > 0) { ol.push(g.vx * h, g.vy * h); cl.push(g.vx * h, g.vy * h); g.left -= h; }
    apart = Math.max(apart, Math.hypot(ol.x[0] - cl.x[0], ol.x[1] - cl.x[1]));
    if (j + 1 === loops.M) { olT = [ol.x[0], ol.x[1]]; clT = [cl.x[0], cl.x[1]]; }
  }
  const d = (p) => Math.hypot(p[0] - problem.target[0], p[1] - problem.target[1]);
  return { openMiss: d(olT), closedMiss: d(clT), apart };
}

describe('open- vs closed-loop demo', () => {
  it('meander: without a gust, both boats follow the plan together and reach the target', () => {
    const r = run('meander', 0);
    console.log('no gust', r);
    expect(r.apart).toBeLessThan(1e-6);
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
