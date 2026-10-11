import { describe, expect, it } from 'vitest';
import { dot, fitTransition, matvec, nnls, norm, rankOneUpdate, sub } from '../src/linear-algebra/lib/linalg.js';

// Deterministic pseudo-random numbers so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

describe('fitTransition (A = I + (b − a)aᵀ/aᵀa)', () => {
  const r = rng(7);
  const a = Array.from({ length: 5 }, r);
  const b = Array.from({ length: 5 }, r);
  const A = fitTransition(a, b);

  it('sends a exactly to b', () => {
    matvec(A, a).forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
  });

  it('fixes every vector orthogonal to a', () => {
    const v = Array.from({ length: 5 }, r);
    const vPerp = sub(v, a.map((x) => (x * dot(a, v)) / dot(a, a)));
    matvec(A, vPerp).forEach((x, i) => expect(x).toBeCloseTo(vPerp[i], 12));
  });

  it('is the closest map to I that sends a to b: ‖A − I‖_F = ‖b − a‖/‖a‖', () => {
    const fro = Math.sqrt(A.flat().reduce((s, v, k) => s + (v - +(k % 6 === 0)) ** 2, 0));
    expect(fro).toBeCloseTo(norm(sub(b, a)) / norm(a), 12);
  });

  it('matches the rank-one factor form the dump stores', () => {
    const c = a.map((x) => x / dot(a, a));
    const B = rankOneUpdate(sub(b, a), c);
    B.flat().forEach((v, k) => expect(v).toBeCloseTo(A.flat()[k], 12));
  });
});

describe('nnls', () => {
  // Brute force for tiny problems: try every subset of columns as the passive set, keep feasible optima.
  function bruteForce(A, b) {
    const n = A[0].length;
    let best = { x: new Array(n).fill(0), r: norm(b) };
    for (let mask = 1; mask < 1 << n; mask++) {
      const cols = [...Array(n).keys()].filter((j) => mask & (1 << j));
      const Ap = A.map((row) => cols.map((j) => row[j]));
      const AtA = cols.map((_, i) => cols.map((_, j) => Ap.reduce((s, row) => s + row[i] * row[j], 0)));
      const Atb = cols.map((_, i) => Ap.reduce((s, row, k) => s + row[i] * b[k], 0));
      let s;
      if (cols.length === 1) s = [Atb[0] / AtA[0][0]];
      else if (cols.length === 2) {
        const det = AtA[0][0] * AtA[1][1] - AtA[0][1] * AtA[1][0];
        if (Math.abs(det) < 1e-12) continue;
        s = [(AtA[1][1] * Atb[0] - AtA[0][1] * Atb[1]) / det, (AtA[0][0] * Atb[1] - AtA[1][0] * Atb[0]) / det];
      } else continue; // 2-row problems never need more than 2 passive columns
      if (s.some((v) => v < 0)) continue;
      const x = new Array(n).fill(0);
      cols.forEach((c, i) => { x[c] = s[i]; });
      const r = norm(sub(matvec(A, x), b));
      if (r < best.r - 1e-12) best = { x, r };
    }
    return best;
  }

  it('matches brute force on random 2-D problems', () => {
    const r = rng(42);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + (trial % 6);
      const A = [Array.from({ length: n }, r), Array.from({ length: n }, r)];
      const b = [3 * r(), 3 * r()];
      const x = nnls(A, b);
      expect(x.every((v) => v >= 0)).toBe(true);
      expect(norm(sub(matvec(A, x), b))).toBeCloseTo(bruteForce(A, b).r, 8);
    }
  });

  it('solves exactly when b is inside the cone', () => {
    const A = [[1, 0], [0, 1]];
    nnls(A, [2, 3]).forEach((v, i) => expect(v).toBeCloseTo([2, 3][i], 12));
  });

  it('returns zero when b points away from every column', () => {
    const A = [[1, 0.5], [0, 1]];
    expect(nnls(A, [-1, -1])).toEqual([0, 0]);
  });
});
