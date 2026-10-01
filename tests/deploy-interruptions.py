#!/usr/bin/env python3
"""Local signal matrix for restore. No SSH, production, API or bot messages."""
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'scripts/max-snapshot.sh'


def digest(web):
    return {str(p.relative_to(web)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in web.rglob('*') if p.is_file()}


def invoke(root, action, archive=None, env=None):
    args = ['bash', str(SCRIPT), str(root), action]
    if archive:
        args.append(str(archive))
    return subprocess.run(args, capture_output=True, text=True, env=env, timeout=15)


with tempfile.TemporaryDirectory(prefix='max-restore-signals-') as folder:
    top = Path(folder)
    commands = top / 'bin'
    commands.mkdir()
    wrapper = commands / 'mv'
    wrapper.write_text('''#!/usr/bin/env python3
import os, pathlib, signal, subprocess, sys, time
counter = pathlib.Path(os.environ['MV_COUNTER'])
count = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(count))
trigger = int(os.environ['MV_TRIGGER'])
sig = int(os.environ['MV_SIGNAL'])
phase = os.environ['MV_PHASE']
def interrupt():
 os.kill(os.getppid(), sig)
 time.sleep(.025)
if count == trigger and phase == 'before':
 interrupt(); sys.exit(79)
if count > trigger and os.environ.get('MV_REPEAT') == '1':
 # Repeat different signals while the parent's rollback invokes external mv.
 for repeated in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
  os.kill(os.getppid(), repeated)
 time.sleep(.025)
 pathlib.Path(os.environ['REPEAT_SEEN']).write_text('yes')
code = subprocess.call(['/bin/mv'] + sys.argv[1:])
if count == trigger and phase == 'after':
 interrupt(); sys.exit(79)
sys.exit(code)
''')
    wrapper.chmod(0o755)
    passed = 0
    repeats_exercised = 0
    for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        for phase in ('before', 'after'):
            for move in range(1, 5):
                for repeat in (False, True):
                    name = f'{sig.name}-{phase}-{move}-repeat-{repeat}'
                    root = top / name
                    for tree in ('max-app', 'max-api'):
                        path = root / 'www' / tree
                        path.mkdir(parents=True)
                        (path / '.htaccess').write_text('archived ' + tree)
                        (path / '.hidden').write_text('hidden original')
                    (root/'www/max-app/index.html').write_text('archive frontend')
                    (root/'www/max-api/index.php').write_text('<?php // archived\n')
                    r = invoke(root, 'backup')
                    assert r.returncode == 0, (name, r.stdout, r.stderr)
                    archive = next(line.split('=', 1)[1] for line in r.stdout.splitlines() if line.startswith('BACKUP_ARCHIVE='))
                    (root/'www/max-app/index.html').write_text('current frontend')
                    (root/'www/max-api/index.php').write_text('<?php // current dirty handler\n')
                    (root/'www/max-api/new-handler.php').write_text('<?php // keep on failed restore\n')
                    expected = digest(root/'www')
                    env = dict(os.environ, PATH=str(commands)+os.pathsep+os.environ['PATH'],
                               MV_COUNTER=str(root/'moves'), MV_TRIGGER=str(move), MV_SIGNAL=str(int(sig)),
                               MV_PHASE=phase, MV_REPEAT='1' if repeat else '0', REPEAT_SEEN=str(root/'repeat-seen'))
                    result = invoke(root, 'restore', archive, env)
                    assert result.returncode == 128 + sig, (name, result.returncode, result.stdout, result.stderr)
                    assert all((root/'www'/tree).is_dir() for tree in ('max-app', 'max-api')), name
                    assert digest(root/'www') == expected, (name, result.stdout, result.stderr)
                    if repeat and (phase != 'before' or move != 1):
                        assert (root/'repeat-seen').is_file(), name
                        repeats_exercised += 1
                    passed += 1
    print(f'PASS {passed} interrupted restores: HUP/INT/TERM before+after each of 4 moves; '
          f'{repeats_exercised} active rollback repeat-signal scenarios; both original trees intact; no network')
