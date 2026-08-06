# Original-file hash verification

Source compared: supplied `Hydrogen Hub Config (4).zip`.

Result: **29 of 29 immutable files are exact SHA-256 matches** between the
supplied archive and this release:

- `backend/solver/HSC_operational.py`
- `backend/solver/requirements.original.txt`
- all 27 baseline CSV files in `backend/solver/data/johor118/`

Key hashes:

```text
f40efb27052e18e0590c2280d444404919cf136c4064029804eeae352941a015  backend/solver/HSC_operational.py
9ba6a03be2633e59689e3494b6f3f0c2192a43e48e1877516110d2d966779ab7  backend/solver/requirements.original.txt
f3b0b7956b10460d1e11149dfbe952221d7997c0032713e7986e3ba636c37bb0  backend/solver/manifest.sha256
```

The complete 29-entry checksum list is
`backend/solver/manifest.sha256`. It was rechecked successfully with:

```text
sha256sum -c backend/solver/manifest.sha256
```

No claim in this report depends on file names or sizes alone; the comparison
uses file-content SHA-256 digests.
