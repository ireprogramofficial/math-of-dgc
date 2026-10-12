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
  const opt = new TrajectoryOptimizer(problem);
  opt.run(4000);
  const boat = new LiveBoat(new BoatModel(flow)), u = new Float64Array(NU), M = problem.N * problem.sub;
  boat.x.set(start);
  for (let j = 0; j < M; j++) { const k = Math.floor(j / problem.sub); for (let c = 0; c < NU; c++) u[c] = opt.U[NU * k + c]; boat.step(u, T / M); }
  return { planned: opt.last.miss, actual: Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1]) };
}

describe('drift fits', () => {
  it('the time series circles the initial basin; the single sample sits in the target basin', () => {
    const near = (p, b) => Math.hypot(p[0] - b.x, p[1] - b.y) < b.R;
    expect(data.series.length).toBe(SERIES.count);
    expect(data.series.every((p) => near(p, data.basinInitial))).toBe(true);
    expect(near(data.single, data.basinTarget)).toBe(true);
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

describe('fit 4: rank-one LTV (DGC-style)', async () => {
  const { fitRankOneLTV, planLTV, rolloutLTV, thrustMatrix } = await import('../src/control/rankOneLTV.js');
  const ltv = fitRankOneLTV(data.series, SERIES.every);
  const B = thrustMatrix(new BoatModel(flow), SERIES.every);

  it('is centered on the samples\' average, and each A[k] maps x[k] exactly onto x[k+1]', () => {
    const n = data.series.length;
    expect(ltv.pbar[0]).toBeCloseTo(data.series.reduce((s, p) => s + p[0], 0) / n, 9);
    expect(ltv.steps).toBe(n - 1);
    const replay = rolloutLTV(ltv, B, data.series[0], new Float64Array(NU * ltv.steps), ltv.steps);
    for (let i = 0; i < n; i++) expect(Math.hypot(replay[i][0] - data.series[i][0], replay[i][1] - data.series[i][1])).toBeLessThan(1e-6);
  });

  it('its plan is (nearly) exact in the model but misses badly on the actual drift', () => {
    const K = Math.round(500 / SERIES.every), start = data.series[0], target = data.single;
    const plan = planLTV(ltv, B, start, target, K);
    expect(plan.plannedMiss).toBeLessThan(5);
    for (const v of plan.U) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const boat = new LiveBoat(new BoatModel(flow)), u = new Float64Array(NU);
    boat.x.set(start);
    for (let k = 0; k < K; k++) { for (let c = 0; c < NU; c++) u[c] = plan.U[NU * k + c]; for (let j = 0; j < 56; j++) boat.step(u, 0.5); }
    expect(Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1])).toBeGreaterThan(100);
  });

  it('refuses a horizon longer than the data', () => {
    expect(() => planLTV(ltv, B, data.series[0], data.single, ltv.steps + 1)).toThrow();
  });
});
