"""Summary statistics of DGC's original (gene-level) variables for the linear-algebra deck's variables slide.
The dump's connection matrix (gene/B_aligned) is called B in the deck.

Reads the (git-ignored) DGC variable dump and writes src/linear-algebra/data/variables.json: for each variable its
shape, dimension labels, and min / median / mean / max entry and sparsity (share of zero entries), or 0/1 counts
for logical vectors and sign counts for s. Only these summaries are
published, never the arrays.

  python scripts/extract_variable_stats.py example-dgc-linear-algebra/2026_10_11_DGC_VarDump/data/group_1__group_1__dgc_vars.h5
"""
import json, sys
from collections import Counter
from pathlib import Path
import h5py, numpy as np


def summary(a):
    a = np.asarray(a, float)
    return dict(min=float(a.min()), median=float(np.median(a)), mean=float(a.mean()), max=float(a.max()),
                zero_pct=float(100 * (a == 0).mean()))


f = h5py.File(sys.argv[1], 'r')
G = f['gene/g_timeseries'][:]
C = f['gene/B_aligned'][:]
cls = Counter(f['labels/tfs_expanded_class'][:].astype(str))
N, K = G.shape
M = C.shape[1]

A = f['gene/g_accessibility'][:]
g0 = f['gene/g_initial'][:]
assert np.array_equal(g0, G[:, 0]), 'g_initial is expected to be the first (hour 1) column of G'
assert set(np.unique(A)) <= {0.0, 1.0}, 'a is expected to be logical'

out = [
    # g_initial is G's first column (hour 1), so it is shown on G rather than as its own variable.
    dict(id='G', sym='G', shape=[N, K], dims=['genes', 'time points'], what='expression over the time course (log CP10K)', **summary(G)),
    dict(id='gtarget', sym=r'g_{\text{target}}', shape=[N], dims=['genes'], what='target cell type (log CP10K)', **summary(f['gene/g_target'][:])),
    dict(id='a', sym='a', shape=[N], dims=['genes'], what='accessibility in the initial cell type',
         logical=dict(ones=int((A == 1).sum()), zeros=int((A == 0).sum()))),
    dict(id='B', sym='B', shape=[N, M], dims=['genes', 'TFs'], what='TF → gene connections (1 = connected)', **summary(C)),
    # Signs: each TF is a known activator, a known repressor, or unknown (then tried both ways as two columns).
    dict(id='s', sym='s', shape=[M], dims=['TFs'], what='TF direction', signs=dict(
        activator=cls['Activator'], repressor=cls['Repressor'], unknown=cls['Hypothetical Activator'],
        expanded_columns=sum(cls.values()))),
]
dst = Path(__file__).resolve().parents[1] / 'src/linear-algebra/data/variables.json'
dst.write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
