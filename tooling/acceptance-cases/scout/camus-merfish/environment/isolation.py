import sys,json,sqlite3,ssl
from pathlib import Path
root=Path(sys.executable).parent.parent.resolve()
assert Path(sys.prefix).resolve()==root
assert not any('omics-camus-' in path or 'omics-stamo-' in path for path in sys.path)
report={'prefix':sys.prefix,'executable':sys.executable,'python':sys.version,'site_paths':[path for path in sys.path if 'site-packages' in path],'sqlite':sqlite3.sqlite_version,'ssl':ssl.OPENSSL_VERSION}
(root/'isolation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
