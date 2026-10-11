// Solves a scenario's flow off the main thread and transfers the arrays back.
import { computeFlow } from './solver.js';

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    const { flow, stats } = computeFlow(id);
    const { nx, ny, cell, width, height, u, v, inside, speedRef } = flow;
    self.postMessage({ id, ok: true, stats, flow: { nx, ny, cell, width, height, u, v, inside, speedRef } }, [u.buffer, v.buffer, inside.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
