#!/usr/bin/env python3
"""Every t('key') used in src/ must exist in fr.json and ar.json."""
import json, re, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
fr = json.loads((root / 'src/i18n/fr.json').read_text())
ar = json.loads((root / 'src/i18n/ar.json').read_text())
used = set()
for f in (root / 'src').rglob('*.tsx'):
    used |= set(re.findall(r"""\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]""", f.read_text()))
for f in (root / 'src').rglob('*.ts'):
    used |= set(re.findall(r"""\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]""", f.read_text()))
missing_fr = sorted(k for k in used if k not in fr)
missing_ar = sorted(k for k in fr if k not in ar)
print('missing in fr:', missing_fr or 'none')
print('missing in ar:', missing_ar or 'none')
sys.exit(1 if missing_fr or missing_ar else 0)
