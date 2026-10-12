import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/control/autopilot.js';
import { BoatModel } from '../src/control/boat.js';
import { LiveBoat } from '../src/control/liveBoat.js';
import { computeFlow } from '../src/river/solver.js';
import { getScenario, SCENARIOS } from '../src/river/scenarios.js';

function fly(id, simSeconds = 5000, h = 0.4) {
  const scn = getScenario(id), flow = computeFlow(id).flow, model = new BoatModel(flow);
  const boat = new LiveBoat(model), pilot = new Autopilot(flow, scn, model);
  boat.reset(scn.boat.start);
  let arrivals = 0, wasHolding = false, minInside = Infinity, maxSpeed = 0, t = 0;
  const goals = new Set();
  while (t < simSeconds) {
    pilot.tick(h / 25, boat.x); // the live widget runs 25 sim-seconds per real second
    const u = pilot.control(boat.x, h);
    boat.step(u, h);
    t += h;
    if (pilot.goal) goals.add(pilot.goal.join(','));
    const holding = pilot.phase === 'hold';
    if (holding && !wasHolding) arrivals++;
    wasHolding = holding;
    minInside = Math.min(minInside, flow.insideAt(boat.x[0], boat.x[1]));
    maxSpeed = Math.max(maxSpeed, Math.hypot(boat.v[0], boat.v[1]));
  }
  return { arrivals, minInside, goals: goals.size, maxSpeed };
}

describe('autopilot', () => {
  for (const scn of SCENARIOS) {
    it(`${scn.id}: visits several destinations without leaving the water`, () => {
      const r = fly(scn.id);
      console.log(scn.id, JSON.stringify({ ...r, minInside: +r.minInside.toFixed(1), maxSpeed: +r.maxSpeed.toFixed(2) }));
      expect(r.minInside).toBeGreaterThan(0);
      expect(r.arrivals).toBeGreaterThanOrEqual(3);
      expect(r.goals).toBeGreaterThanOrEqual(3);
    }, 60000);
  }

  it('holds position during the pause at an arrival point', () => {
    const scn = getScenario('lake'), flow = computeFlow('lake').flow, model = new BoatModel(flow);
    const boat = new LiveBoat(model), pilot = new Autopilot(flow, scn, model);
    boat.reset(scn.boat.start);
    let guard = 0;
    while (pilot.phase !== 'hold' && guard++ < 20000) { pilot.control(boat.x); boat.step(pilot.control(boat.x, 0.4), 0.4); }
    expect(pilot.phase).toBe('hold');
    const p0 = [boat.x[0], boat.x[1]];
    for (let i = 0; i < 5; i++) boat.step(pilot.control(boat.x, 0.4), 0.4); // 2 sim seconds, no ticks: stays in hold
    expect(Math.hypot(boat.x[0] - p0[0], boat.x[1] - p0[1])).toBeLessThan(15);
  });
});
