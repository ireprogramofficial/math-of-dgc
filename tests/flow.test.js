import { describe, expect, it } from 'vitest';
import { computeFlow } from '../src/river/solver.js';
import { SCENARIOS } from '../src/river/scenarios.js';

const cache = {};
const flowOf = (id) => (cache[id] ??= computeFlow(id));

describe('flow solver', () => {
  for (const scn of SCENARIOS) {
    it(`${scn.id}: converges, has water, and is normalized to speedRef`, () => {
      const t0 = performance.now();
      const { flow, stats } = flowOf(scn.id);
      const ms = performance.now() - t0;
      let water = 0, speeds = [];
      for (let k = 0; k < flow.u.length; k++) if (flow.inside[k] > 0) { water++; speeds.push(Math.hypot(flow.u[k], flow.v[k])); }
      speeds.sort((a, b) => a - b);
      const p95 = speeds[Math.floor(0.95 * (speeds.length - 1))];
      console.log(`${scn.id}: ${ms.toFixed(0)} ms, iters=${stats.iterations}, resid=${stats.residual.toExponential(1)}, water=${(100 * water / flow.u.length).toFixed(1)}%, p95=${p95.toFixed(2)}, max=${speeds.at(-1).toFixed(2)}`);
      expect(water).toBeGreaterThan(1000);
      expect(p95).toBeGreaterThan(0.8 * scn.speedRef);
      // swirls (gyres) are added on top of the normalized through-flow, so they can raise the upper tail
      const swirlV = Math.max(0, ...(scn.swirls ?? []).map((w) => w.V));
      expect(p95).toBeLessThan(1.2 * scn.speedRef + swirlV);
      if (scn.type !== 'analytic') expect(stats.residual).toBeLessThan(5e-5);
      expect(Number.isFinite(speeds.at(-1))).toBe(true);
    });
  }

  it('straight channel: flow runs downstream, fastest at center, slow at the bank', () => {
    const { flow } = flowOf('straight');
    const mid = flow.velocity(800, 450), bank = flow.velocity(800, 328); // channel is 260 m wide: bank at y = 320
    expect(mid[0]).toBeGreaterThan(1.0);
    expect(Math.abs(mid[1])).toBeLessThan(0.05);
    expect(bank[0]).toBeLessThan(0.7 * mid[0]);
  });

  it('straight channel: discharge is conserved along the channel', () => {
    const { flow } = flowOf('straight');
    const q = (x) => { let s = 0; for (let y = 316; y <= 584; y += 2) s += flow.velocity(x, y)[0] * 2; return s; };
    const q1 = q(500), q2 = q(900), q3 = q(1300);
    expect(Math.abs(q2 - q1) / q1).toBeLessThan(0.05);
    expect(Math.abs(q3 - q1) / q1).toBeLessThan(0.05);
  });

  it('delta: flow carries water from the source basin toward every terminal basin', () => {
    const { flow } = flowOf('delta');
    expect(flow.velocity(300, 450)[0]).toBeGreaterThan(0.2);   // trunk flows east
    for (const y of [110, 280, 450, 620, 790]) {
      expect(flow.isWater(1420, y, 5)).toBe(true);
      expect(flow.velocity(1330, y)[0]).toBeGreaterThan(0);    // each leaf channel flows east
    }
  });

  it('fork: through-flow reaches both basins, with a gyre in each (opposite senses)', () => {
    const { flow } = flowOf('fork');
    expect(flow.velocity(300, 470)[0]).toBeGreaterThan(0.3);                    // trunk flows east
    expect(flow.isWater(1420, 270, 20) && flow.isWater(1420, 630, 20)).toBe(true);
    // basin 1 turns clockwise (east of center the water moves south), basin 2 counter-clockwise
    expect(flow.velocity(1465, 270)[1]).toBeLessThan(-0.2);
    expect(flow.velocity(1465, 630)[1]).toBeGreaterThan(0.2);
    // the swirl is confined to the basins: the channels are still dominated by the through-flow
    expect(flow.velocity(900, 330)[0]).toBeGreaterThan(0.3);
  });

  it('fork: a path with only two terminal basins (plus the source basin)', async () => {
    const { SCENARIO_BY_ID } = await import('../src/river/scenarios.js');
    expect(SCENARIO_BY_ID.fork.sinks.length).toBe(2);
    expect(SCENARIO_BY_ID.fork.swirls.length).toBe(3);
  });

  it('gyre: counter-clockwise rotation', () => {
    const { flow } = flowOf('gyre');
    expect(flow.velocity(1000, 450)[1]).toBeGreaterThan(0.5);   // east of center: moving north
    expect(flow.velocity(800, 650)[0]).toBeLessThan(-0.3);      // north of center: moving west
  });

  it('jacobian matches finite differences', () => {
    const { flow } = flowOf('lake');
    const p = [900, 460], e = 0.5;
    const J = flow.velocityAndJacobian(p[0], p[1]);
    const a = flow.velocity(p[0] + e, p[1]), b = flow.velocity(p[0] - e, p[1]);
    expect(J[2]).toBeCloseTo((a[0] - b[0]) / (2 * e), 3);
    expect(J[4]).toBeCloseTo((a[1] - b[1]) / (2 * e), 3);
  });
});
