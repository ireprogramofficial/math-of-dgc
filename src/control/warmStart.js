// A feasible first guess for the open-loop schedule: fly the closed-loop autopilot from the start to the target
// and record the thrust it used, averaged over each interval of the schedule. Projected gradient descent from
// zero thrust can settle in a local minimum (e.g. the wrong branch of a fork, pressed against the bank); this
// guess starts it on a path that already goes the right way around the land.
import { Autopilot } from './autopilot.js';
import { NU } from './boat.js';
import { LiveBoat } from './liveBoat.js';

export function autopilotGuess(problem, scenario) {
  const { model, x0, target, N, sub, T } = problem;
  const boat = new LiveBoat(model), pilot = new Autopilot(model.flow, scenario, model);
  boat.x.set(x0);
  pilot.goTo(target, x0);
  const U = new Float64Array(N * NU), h = T / (N * sub);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < sub; j++) {
      const u = pilot.control(boat.x, h);
      for (let c = 0; c < NU; c++) U[NU * k + c] += u[c] / sub;
      boat.step(u, h);
    }
  }
  return U;
}
