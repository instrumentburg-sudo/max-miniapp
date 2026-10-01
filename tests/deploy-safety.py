#!/usr/bin/env python3
"""Offline deploy exercise. SSH/SCP/CURL/NPM are stubs; no production/network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
REMOTE = '/home/c50684/instrumentburg.ru'
BASELINE = '''<?php
function dirty_catalog_handler() { return 'uncommitted server handler'; }
function process_bot_update(array $update): void
{
    $GLOBALS['calls'][] = $update;
}
'''

def run(args, env=None, ok=True):
    r = subprocess.run(args, env=env, text=True, capture_output=True)
    if ok:
        assert r.returncode == 0, (args, r.stdout, r.stderr)
    else:
        assert r.returncode != 0, (args, r.stdout, r.stderr)
    return r

with tempfile.TemporaryDirectory(prefix='max-deploy-test-') as tmp:
    temp = Path(tmp)
    root = temp / 'remote'
    for name in ('max-app', 'max-api'):
        path = root / 'www' / name
        path.mkdir(parents=True)
        (path / '.htaccess').write_text(f'original {name} rules\n')
        (path / '.hidden-handler').write_text(f'hidden {name}\n')
    (root / 'www/max-app/index.html').write_text('old frontend\n')
    (root / 'www/max-api/index.php').write_text(BASELINE)
    (root / 'www/max-api/dirty-catalog.php').write_text('<?php /* server only */\n')
    commands = temp / 'commands'
    commands.mkdir()
    log = temp / 'calls.jsonl'
    ssh = commands / 'ssh'
    ssh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = os.environ['MOCK_ROOT']; remote = '/home/c50684/instrumentburg.ru'
args = [a.replace(remote, root) for a in sys.argv[2:]]
with open(os.environ['MOCK_LOG'], 'a') as f: f.write(json.dumps(['ssh'] + args) + '\\n')
if os.environ.get('FAIL_BACKUP') and 'backup' in args: sys.exit(73)
if len(args) == 1:
 assert args[0].startswith('mkdir -p '), 'Unexpected remote shell command'
 args = ['bash', '-c', args[0]]
r = subprocess.run(args, input=sys.stdin.buffer.read(), capture_output=True)
sys.stdout.buffer.write(r.stdout.replace(root.encode(), remote.encode()))
sys.stderr.buffer.write(r.stderr)
sys.exit(r.returncode)
''')
    scp = commands / 'scp'
    scp.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['MOCK_ROOT'])
assert list((root/'max-deploy-backups').glob('snapshot-*.tar.gz.sha256')), 'scp before backup'
with open(os.environ['MOCK_LOG'], 'a') as f: f.write(json.dumps(['scp'] + sys.argv[1:]) + '\\n')
''')
    curl = commands / 'curl'
    curl.write_text('#!/bin/sh\nprintf \'{"ok":true}\\n\'\n')
    for command in commands.iterdir():
        command.chmod(0o755)
    env = dict(os.environ, PATH=str(commands)+os.pathsep+os.environ['PATH'], MOCK_ROOT=str(root), MOCK_LOG=str(log))
    # API-only still saves the ENTIRE frontend and PHP, before SCP.
    result = run(['bash', str(REPO/'deploy.sh'), '--api-only'], env)
    archive_remote = next(line.split('=', 1)[1] for line in result.stdout.splitlines() if line.startswith('BACKUP_ARCHIVE='))
    archive = Path(archive_remote.replace(REMOTE, str(root)))
    assert archive.is_file()
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert calls[0][0] == 'ssh' and 'backup' in calls[0]
    assert any(c[0] == 'scp' for c in calls)
    # A failed backup prevents every upload and handoff write.
    for mode in ('--api-only', '--handoff-only'):
        log.write_text('')
        run(['bash', str(REPO/'deploy.sh'), mode], dict(env, FAIL_BACKUP='1'), ok=False)
        assert all(json.loads(line)[0] != 'scp' for line in log.read_text().splitlines())
        assert (root/'www/max-api/index.php').read_text() == BASELINE
    # Narrow handoff preserves arbitrary uncommitted PHP and dotfiles.
    result = run(['bash', str(REPO/'deploy.sh'), '--handoff-only'], env)
    patched = (root/'www/max-api/index.php').read_text()
    assert "function dirty_catalog_handler()" in patched
    assert "IB_MAX_OWNERSHIP_GUARD_V1" in patched
    assert (root/'www/max-api/dirty-catalog.php').read_text() == '<?php /* server only */\n'
    run(['bash', str(REPO/'deploy.sh'), '--handoff-only'], env)
    assert (root/'www/max-api/index.php').read_text() == patched  # idempotent
    # Execute only the pure fixture dispatcher: no bot HTTP functions exist here.
    probe = temp/'probe.php'
    probe.write_text('''<?php
require $argv[1];
$fixtures = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixtures as $fixture) {
 if (ib_handoff_is_start($fixture['text']) !== $fixture['start']) { fwrite(STDERR, 'Fixture mismatch: ' . json_encode($fixture)); exit(3); }
}
$GLOBALS['calls'] = [];
foreach (['/start', 'start', '/START', ' /start', '/start@id662337117117_bot=token'] as $text) {
 process_bot_update(['update_type'=>'message_created','message'=>['body'=>['text'=>$text]]]);
}
process_bot_update(['update_type'=>'bot_started']);
process_bot_update(['update_type'=>'message_created','message'=>['body'=>['text'=>'A023222','attachments'=>[['type'=>'contact']]]]]);
if (count($GLOBALS['calls']) !== 0) exit(1);
foreach (['A023222', '/starting', 'Здравствуйте'] as $text) process_bot_update(['update_type'=>'message_created','message'=>['body'=>['text'=>$text]]]);
if (count($GLOBALS['calls']) !== 3) exit(2);
''')
    run(['php', str(probe), str(root/'www/max-api/index.php'), str(REPO/'tests/start-commands.json')])
    # Exact restore removes newly added files, and recovers hidden/dirty files.
    (root/'www/max-app/new.js').write_text('new')
    (root/'www/max-app/.htaccess').write_text('changed')
    run(['bash', str(REPO/'deploy.sh'), '--restore', archive_remote], env)
    assert (root/'www/max-api/index.php').read_text() == BASELINE
    assert (root/'www/max-app/.htaccess').read_text() == 'original max-app rules\n'
    assert not (root/'www/max-app/new.js').exists()
    assert (root/'www/max-api/.hidden-handler').read_text() == 'hidden max-api\n'
    assert list((root/'max-deploy-backups').glob('replaced-*'))
    # Tampered snapshot fails before restore, current files remain unchanged.
    archive.write_bytes(archive.read_bytes()+b'corruption')
    run(['bash', str(REPO/'scripts/max-snapshot.sh'), str(root), 'restore', str(archive)], ok=False)
    assert (root/'www/max-api/index.php').read_text() == BASELINE
    # Invalid targets (symlink) are rejected before backup/deploy writes.
    path = root/'www/max-api'
    path.rename(root/'www/actual-api')
    path.symlink_to(root/'www/actual-api', target_is_directory=True)
    run(['bash', str(REPO/'scripts/max-snapshot.sh'), str(root), 'backup'], ok=False)
print('PASS offline backup-before-upload, backup failure, narrow handoff, idempotence, ownership, exact restore, corruption and symlink refusal; no production/network')
