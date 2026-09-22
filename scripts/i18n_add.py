#!/usr/bin/env python3
"""Merge translation pairs into src/i18n/{fr,ar}.json.
Input (stdin): lines `key | français | عربي`. Blank lines and # comments ignored."""
import json, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'i18n'
d = {l: json.loads((root / f'{l}.json').read_text()) for l in ('fr', 'ar')}
n = 0
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    key, fr, ar = [p.strip() for p in line.split('|', 2)]
    d['fr'][key], d['ar'][key] = fr, ar
    n += 1
for l in d:
    (root / f'{l}.json').write_text(json.dumps(dict(sorted(d[l].items())), ensure_ascii=False, indent=2) + '\n')
print(f'{n} keys merged; fr={len(d["fr"])} ar={len(d["ar"])}')
