import { describe, expect, it } from 'vitest';
import { BoatModel } from '../src/control/boat.js';
import { evaluate, makeProblem, project, TrajectoryOptimizer } from '../src/control/optimizer.js';
import { computeFlow } from '../src/river/solver.js';
import { getScenario } from '../src/river/scenarios.js';

const flows = {};
const flowOf = (id) => (flows[id] ??= computeFlow(id).flow);

function setup(id, overrides) {
  const flow = flowOf(id), scn = getScenario(id);
  const model = new BoatModel(flow);
  return { flow, scn, model, problem: makeProblem(model, scn, overrides) };
}

describe('boat dynamics', () => {
  it('with no thrust, the boat is carried downstream by the current', () => {
    const { model, problem } = setup('straight');
    const U = new Float64Array(problem.N * 4);
    const { X, M } = model.rollout(problem.x0, U, problem, false);
    expect(X[4 * M]).toBeGreaterThan(problem.x0[0] + 300);
    expect(Math.abs(X[4 * M + 1] - problem.x0[1])).toBeLessThan(5);
  });

  it('thrust east speeds the boat up; thrust north moves it north', () => {
    const { model, problem } = setup('straight');
    const run = (c) => { const U = new Float64Array(problem.N * 4); for (let k = 0; k < problem.N; k++) U[4 * k + c] = 1; return model.rollout(problem.x0, U, problem, false); };
    const base = run(-1 + 4 /* none: index 3 W */);
    const east = run(1), north = run(0);
    expect(east.X[4 * east.M]).toBeGreaterThan(base.X[4 * base.M]);
    expect(north.X[4 * north.M + 1]).toBeGreaterThan(problem.x0[1] + 50);
  });

  it('sensitivities A_j, B_j match finite differences of the step map', () => {
    const { model, problem } = setup('meander');
    const x = Float64Array.of(400, 560, 0.7, -0.2), u = Float64Array.of(0.3, 0.8, 0.1, 0.0), h = 2;
    const xo = new Float64Array(4), A = new Float64Array(16), B = new Float64Array(16);
    model.stepSens(x, u, h, xo, A, B);
    const f = (xx, uu) => { const o = new Float64Array(4); model.step(xx, uu, h, o); return o; };
    for (let i = 0; i < 4; i++) {
      const e = i < 2 ? 0.05 : 1e-3;
      const xp = Float64Array.from(x), xm = Float64Array.from(x); xp[i] += e; xm[i] -= e;
      const fp = f(xp, u), fm = f(xm, u);
      for (let r = 0; r < 4; r++) expect(A[4 * r + i]).toBeCloseTo((fp[r] - fm[r]) / (2 * e), 2);
      const up = Float64Array.from(u), um = Float64Array.from(u); up[i] += 1e-3; um[i] -= 1e-3;
      const gp = f(x, up), gm = f(x, um);
      for (let r = 0; r < 4; r++) expect(B[4 * r + i]).toBeCloseTo((gp[r] - gm[r]) / 2e-3, 3);
    }
  });
});

describe('optimizer', () => {
  it('adjoint gradient matches finite differences (including the land penalty)', () => {
    // Bank clearance is wanted far from the channel center, so the penalty is active along the path.
    const { problem } = setup('meander', { N: 12, sub: 4, T: 240, weights: { margin: 60, kappa: 2 } });
    const U = new Float64Array(12 * 4).map((_, i) => 0.2 + 0.5 * Math.abs(Math.sin(i * 1.7)));
    const r = evaluate(problem, U, true);
    expect(r.land).toBeGreaterThan(0);
    for (const i of [0, 5, 13, 22, 30, 46]) {
      const e = 1e-4, Up = Float64Array.from(U), Um = Float64Array.from(U);
      Up[i] += e; Um[i] -= e;
      const fd = (evaluate(problem, Up).J - evaluate(problem, Um).J) / (2 * e);
      expect(r.grad[i]).toBeCloseTo(fd, 3 - Math.floor(Math.log10(Math.abs(fd) + 1e-9)) > 4 ? 0 : 2);
      expect(Math.abs(r.grad[i] - fd)).toBeLessThan(2e-3 * Math.max(1, Math.abs(fd)));
    }
  });

  for (const id of ['straight', 'meander', 'lake', 'confluence', 'gyre', 'delta']) {
    it(`${id}: reaches the default target`, () => {
      const { problem, scn } = setup(id);
      const opt = new TrajectoryOptimizer(problem);
      const j0 = opt.cost;
      const t0 = performance.now();
      opt.run(1500);
      const r = opt.last;
      console.log(`${id}: iters=${opt.iter} ${(performance.now() - t0).toFixed(0)}ms J ${j0.toFixed(0)} -> ${r.J.toFixed(1)} miss=${r.miss.toFixed(1)}m land=${r.land.toFixed(2)} effort=${r.effort.toFixed(1)} gmap=${opt.gmap.toExponential(1)} T=${scn.boat.horizon}`);
      expect(r.J).toBeLessThan(j0);
      expect(r.miss).toBeLessThan(25);
      expect(r.land).toBeLessThan(5);
    });
  }

  it('disabling the thrusters it needs makes the target unreachable (controllability)', () => {
    // Straight channel, target east + slightly north. With only W and S available the boat cannot get there.
    const free = setup('straight');
    const a = new TrajectoryOptimizer(free.problem); a.run(800);
    const blocked = setup('straight', { enabled: [false, false, true, true] });
    const b = new TrajectoryOptimizer(blocked.problem); b.run(800);
    expect(a.last.miss).toBeLessThan(15);
    expect(b.last.miss).toBeGreaterThan(a.last.miss + 40);
    for (let k = 0; k < blocked.problem.N; k++) { expect(b.U[4 * k]).toBe(0); expect(b.U[4 * k + 1]).toBe(0); }
  });

  it('project clamps to the box and zeroes disabled thrusters', () => {
    const { problem } = setup('straight', { enabled: [true, false, true, true] });
    const U = project(Float64Array.of(2, 0.5, -1, 0.3), { ...problem, N: 1 });
    expect(Array.from(U)).toEqual([1, 0, 0, 0.3]);
  });
});
