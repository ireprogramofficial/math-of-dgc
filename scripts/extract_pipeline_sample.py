"""Extract the small real-data sample the linear-algebra deck's pipeline widget draws.

Reads the (git-ignored) DGC variable dump and writes src/linear-algebra/data/pipeline.json:
  * a window of adjacent TADs (by TAD index) and every gene in them: raw expression over 48 h,
  * those TADs' raw sums e, centered sums e~, and the rank-1 factors of A_k restricted to them,
  * coarse thumbnails of the full G (genes sorted by TAD) and E, for the zoomed-out view.

Run with an environment that has h5py and numpy:
  python scripts/extract_pipeline_sample.py example-dgc-linear-algebra/2026_10_11_DGC_VarDump/data/group_1__group_1__dgc_vars.h5
"""
import json, sys
from pathlib import Path
import h5py, numpy as np

N_TADS, MIN_G, MAX_G, THUMB_ROWS = 8, 2, 12, 240

def rnd(a, d=3):
    return np.round(np.asarray(a, float), d).tolist()

def thumb(M, rows):
    """Average consecutive row blocks down to `rows` rows."""
    edges = np.linspace(0, M.shape[0], rows + 1).astype(int)
    return np.stack([M[a:b].mean(0) for a, b in zip(edges[:-1], edges[1:])])

f = h5py.File(sys.argv[1], 'r')
genes = f['labels/genes'][:].astype(str)
gtad = f['labels/gene_tad_index'][:]
tads = f['labels/tads'][:]
hours = f['labels/timepoints_hour'][:]
G = f['gene/g_timeseries'][:]
X = f['tad/x_timeseries'][:]          # centered TAD sums (e~)
D, C = f['tad/A_Delta'][:], f['tad/A_c'][:]
xss = f['tad/x_steadystate'][:]       # e-bar
sizes = np.array([(gtad == t).sum() for t in tads])

# Choose the run of N_TADS adjacent TADs (all with MIN_G..MAX_G genes) whose e~ varies most over the cycle.
best, best_j = -1, None
for j in range(len(tads) - N_TADS):
    s = sizes[j:j + N_TADS]
    if s.min() < MIN_G or s.max() > MAX_G:
        continue
    if np.any(np.diff(tads[j:j + N_TADS]) <= 0):
        continue
    score = X[j:j + N_TADS].std(1).sum()
    if score > best:
        best, best_j = score, j
win = list(range(best_j, best_j + N_TADS))

tad_rows, gene_rows = [], []
for j in win:
    t = tads[j]
    gi = np.where(gtad == t)[0]
    gi = gi[np.argsort(-G[gi].mean(1))]
    e = G[gi].sum(0)
    tad_rows.append(dict(tad=int(t), genes=len(gi), e=rnd(e), ebar=round(float(xss[j]), 3), etilde=rnd(X[j]),
                         delta=rnd(D[j], 5), c=rnd(C[j], 5)))
    for i in gi:
        gene_rows.append(dict(gene=genes[i], tad=int(t), g=rnd(G[i])))

order = np.argsort(gtad, kind='stable')
out = dict(
    source='DGC variable dump, Fib->HSC 1h, TAD reduction (chronological hours)',
    dims=dict(N=int(G.shape[0]), Ntilde=int(len(tads)), K=int(G.shape[1]), M=int(f['labels/tfs_raw'].shape[0]),
              M_expanded=int(f['labels/tfs_expanded'].shape[0])),
    hours=hours.tolist(),
    window=dict(first_tad_row=best_j, gene_offset=int((gtad < tads[best_j]).sum()), tads=tad_rows, genes=gene_rows),
    thumbs=dict(G=rnd(thumb(G[order], THUMB_ROWS), 2), E=rnd(thumb(X + xss[:, None], THUMB_ROWS), 2),
                Etilde=rnd(thumb(X, THUMB_ROWS), 2)),
)
dst = Path(__file__).resolve().parents[1] / 'src/linear-algebra/data/pipeline.json'
dst.write_text(json.dumps(out, separators=(',', ':')))
print(dst, dst.stat().st_size // 1024, 'KB;', 'window TAD rows', win, 'genes', len(gene_rows), 'sizes', sizes[win].tolist())
