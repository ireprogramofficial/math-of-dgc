"""Summary statistics of DGC's original (gene-level) variables, for the linear-algebra deck's variables slide.

Reads the (git-ignored) DGC variable dump and writes src/linear-algebra/data/variables.json: for each variable its
shape, dimension labels, min / median / mean / max entry and sparsity (share of zero entries). Only these summaries are
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
gtad = f['labels/gene_tad_index'][:]
cls = Counter(f['labels/tfs_expanded_class'][:].astype(str))
N, K = G.shape
M = C.shape[1]

out = [
    dict(id='G', sym='G', shape=[N, K], dims=['genes', 'time points'], what='expression over the time course (log CP10K)', **summary(G)),
    dict(id='g0', sym='g_{\\text{initial}}', shape=[N], dims=['genes'], what='initial cell type (log CP10K)', **summary(f['gene/g_initial'][:])),
    dict(id='gtarget', sym='g_{\\text{target}}', shape=[N], dims=['genes'], what='target cell type (log CP10K)', **summary(f['gene/g_target'][:])),
    dict(id='a', sym='a', shape=[N], dims=['genes'], what='accessibility in the initial cell type (1 = open)', **summary(f['gene/g_accessibility'][:])),
    dict(id='C', sym='C', shape=[N, M], dims=['genes', 'TFs'], what='TF → gene connections (1 = connected)', **summary(C)),
    # Signs: each TF is a known activator, a known repressor, or unknown (then tried both ways as two columns).
    dict(id='s', sym='s', shape=[M], dims=['TFs'], what='TF direction', signs=dict(
        activator=cls['Activator'], repressor=cls['Repressor'], unknown=cls['Hypothetical Activator'],
        expanded_columns=sum(cls.values()))),
    # tad(i) entries are TAD ids, so summarize genes per TAD instead.
    dict(id='tad', sym='\\mathrm{tad}(i)', shape=[N], dims=['genes'], what='TAD containing each gene',
         n_tads=int(len(np.unique(gtad))), genes_per_tad=summary(np.unique(gtad, return_counts=True)[1])),
]
dst = Path(__file__).resolve().parents[1] / 'src/linear-algebra/data/variables.json'
dst.write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
