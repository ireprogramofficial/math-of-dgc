// Loads (and caches) a scenario's FlowField, solving in a Web Worker so slides never stall.
// Falls back to solving on the main thread if workers are unavailable.

import { FlowField } from './flowfield.js';
import { computeFlow } from './solver.js';

const cache = new Map();
let worker = null;
const pending = new Map();

function getWorker() {
  if (worker || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./flow.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, flow, error } = e.data;
      const p = pending.get(id);
      pending.delete(id);
      if (!p) return;
      ok ? p.resolve(new FlowField(flow)) : p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      console.warn('flow worker failed, solving on main thread', e.message);
      worker = null;
      for (const [id, p] of pending) p.fallback();
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function loadFlow(id) {
  if (cache.has(id)) return cache.get(id);
  const promise = new Promise((resolve, reject) => {
    const fallback = () => setTimeout(() => { try { resolve(computeFlow(id).flow); } catch (e) { reject(e); } }, 0);
    const w = getWorker();
    if (!w) return fallback();
    pending.set(id, { resolve, reject, fallback });
    w.postMessage({ id });
  });
  cache.set(id, promise);
  return promise;
}
