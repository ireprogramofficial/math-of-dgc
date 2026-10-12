// The "Unknown drift?" and "Optimal control?" slides depend on these claims holding.
import { describe, expect, it } from 'vitest';
import { BoatModel, NU } from '../src/control/boat.js';
import { fitResidual, makeDriftData, velocitySamples, SERIES } from '../src/control/driftFits.js';
import { LiveBoat } from '../src/control/liveBoat.js';
import { makeProblem, TrajectoryOptimizer } from '../src/control/optimizer.js';
import { computeFlow } from '../src/river/solver.js';
import { getScenario } from '../src/river/scenarios.js';

const scn = getScenario('triangle');
const { flow } = computeFlow('triangle');
const data = makeDriftData(flow, scn);

function planAndRun(field) {
  const start = data.series[0], target = data.single, T = 500;
  const problem = makeProblem(new BoatModel(field), { ...scn, boat: { start, target, horizon: T } });
  problem.x0 = Float64Array.of(start[0], start[1], 0, 0);
  const opt = new TrajectoryOptimizer(problem);
  opt.run(4000);
  const boat = new LiveBoat(new BoatModel(flow)), u = new Float64Array(NU), M = problem.N * problem.sub;
  boat.x.set([start[0], start[1], 0, 0]);
  for (let j = 0; j < M; j++) { const k = Math.floor(j / problem.sub); for (let c = 0; c < NU; c++) u[c] = opt.U[NU * k + c]; boat.step(u, T / M); }
  return { planned: opt.last.miss, actual: Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1]) };
}

describe('drift fits', () => {
  it('the time series circles basin A; the single sample sits in basin B', () => {
    const near = (p, b) => Math.hypot(p[0] - b.x, p[1] - b.y) < b.R;
    expect(data.series.length).toBe(SERIES.count);
    expect(data.series.every((p) => near(p, data.basinA))).toBe(true);
    expect(near(data.single, data.basinB)).toBe(true);
  });

  it('richer models match the samples better: quadratic < linear < local average', () => {
    const r = data.fits.residuals;
    expect(r.fit3).toBeLessThan(r.fit2);
    expect(r.fit2).toBeLessThan(r.fit1);
    expect(velocitySamples(data.series, SERIES.every).length).toBe(SERIES.count - 2);
    expect(typeof fitResidual).toBe('function');
  });

  it('planning with the actual drift reaches the target in reality', () => {
    const r = planAndRun(flow);
    expect(r.planned).toBeLessThan(10);
    expect(r.actual).toBeLessThan(10);
  });

  for (const key of ['fit1', 'fit2', 'fit3']) {
    it(`${key}: the plan looks good in its own model but misses on the actual drift`, () => {
      const r = planAndRun(data.fits[key]);
      expect(r.planned).toBeLessThan(10);
      expect(r.actual).toBeGreaterThan(30);
    });
  }
});
