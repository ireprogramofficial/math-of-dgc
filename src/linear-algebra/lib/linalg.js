// Small dense linear algebra for the widgets: 2-D vectors, the rank-one A_k fit, and NNLS.
// Matrices are arrays of rows. Nothing here is sized for the real problem; it is for pictures.

export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => Math.hypot(...a);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const scale = (a, s) => a.map((v) => v * s);
export const matvec = (M, x) => M.map((row) => dot(row, x));
export const matmul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
export const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));

/**
 * The DGC transition fit: A = I + (b − a) aᵀ / (aᵀa).
 * It is the matrix closest to the identity (in Frobenius norm) that sends a exactly to b,
 * and it fixes every vector orthogonal to a. `t` in [0, 1] blends from I (t = 0) to A (t = 1).
 */
export function fitTransition(a, b, t = 1) {
  const n = a.length;
  const aa = dot(a, a) || 1e-300;
  const d = sub(b, a);
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j) + (t * d[i] * a[j]) / aa));
}

/** A = I + Δ cᵀ from its rank-one factors (how the dump stores A_k). */
export const rankOneUpdate = (delta, c) => delta.map((di, i) => c.map((cj, j) => +(i === j) + di * cj));

/** Solve the square system M x = y by Gaussian elimination with partial pivoting. */
export function solve(M, y) {
  const n = y.length;
  const A = M.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c] || 1e-300;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-300);
  }
  return x;
}

/** Least squares on the chosen columns of A (normal equations; the passive sets here are tiny). */
function lstsqCols(A, b, cols) {
  const Ap = A.map((row) => cols.map((j) => row[j]));
  const AtA = cols.map((_, i) => cols.map((_, j) => Ap.reduce((s, row) => s + row[i] * row[j], 0)));
  const Atb = cols.map((_, i) => Ap.reduce((s, row, r) => s + row[i] * b[r], 0));
  return solve(AtA, Atb);
}

/**
 * Nonnegative least squares, min ‖A x − b‖ subject to x ≥ 0 (Lawson and Hanson's active-set method).
 * A is m×n as rows. Returns x (length n).
 */
export function nnls(A, b, { tol = 1e-10, maxIter = 500 } = {}) {
  const n = A[0].length;
  const x = new Array(n).fill(0);
  const passive = new Set();
  const At = transpose(A);
  const grad = () => {
    const r = sub(b, matvec(A, x));
    return At.map((col) => dot(col, r));
  };
  let w = grad();
  for (let it = 0; it < maxIter; it++) {
    let j = -1, best = tol;
    for (let k = 0; k < n; k++) if (!passive.has(k) && w[k] > best) { best = w[k]; j = k; }
    if (j < 0) break;
    passive.add(j);
    for (let inner = 0; inner < maxIter; inner++) {
      const cols = [...passive];
      const s = lstsqCols(A, b, cols);
      if (s.every((v) => v > tol)) {
        x.fill(0);
        cols.forEach((c, i) => { x[c] = s[i]; });
        break;
      }
      // Step from x toward s until the first passive variable hits zero, then drop it.
      let alpha = Infinity;
      cols.forEach((c, i) => { if (s[i] <= tol) alpha = Math.min(alpha, x[c] / (x[c] - s[i])); });
      cols.forEach((c, i) => { x[c] += alpha * (s[i] - x[c]); });
      for (const c of cols) if (x[c] <= tol) { x[c] = 0; passive.delete(c); }
      if (!passive.size) break;
    }
    w = grad();
  }
  return x;
}
