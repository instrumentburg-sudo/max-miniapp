import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Compile the real bridge using the repo's installed compiler; no network or browser required.
const source = ts.transpileModule(readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const auth = user => `auth_date=${Math.floor(Date.now() / 1000)}&user=${user}&hash=server-verifies`;
function load({ search = '', hash = '', stored = auth('A'), live = '', blocked = false } = {}) {
  const storage = new Map([['ib_max_init', stored]]);
  const window = { location: { search, hash }, WebApp: { initData: live } };
  const exports = {};
  vm.runInNewContext(source, { exports, window, URLSearchParams, Date,
    sessionStorage: {
      getItem(key) { if (blocked) throw Error('storage blocked'); return storage.get(key); },
      setItem(key, value) { if (blocked) throw Error('storage blocked'); storage.set(key, value); },
      removeItem(key) { if (blocked) throw Error('storage blocked'); storage.delete(key); },
    },
  });
  return { get: exports.getInitData, window, storage };
}

test('new launch without live Bridge cannot reuse A, even after route navigation', () => {
  for (const location of [{ search: '?WebAppPlatform=android' }, { hash: '#WebAppData=untrusted-B' }, { search: '?%57ebAppData=untrusted-B' }]) {
    const ctx = load(location);
    ctx.window.location.search = '';
    ctx.window.location.hash = '';
    assert.equal(ctx.get(), '');
    assert.equal(ctx.storage.has('ib_max_init'), false);
  }
});
test('ordinary same-origin navigation restores a fresh session', () => {
  const a = auth('A');
  assert.equal(load({ stored: a }).get(), a);
});
test('live B overrides old A on a new launch', () => {
  const b = auth('B');
  const ctx = load({ search: '?WebAppData=untrusted', live: b });
  assert.equal(ctx.get(), b);
  assert.equal(ctx.storage.get('ib_max_init'), b);
});
test('expired live data cannot fall back to old fresh A', () => {
  assert.equal(load({ live: 'auth_date=1&user=B' }).get(), '');
});
test('storage failure is fail-closed on launch; valid live Bridge still works', () => {
  assert.equal(load({ blocked: true, search: '?WebAppPlatform=android' }).get(), '');
  const b = auth('B');
  assert.equal(load({ blocked: true, live: b }).get(), b);
});
