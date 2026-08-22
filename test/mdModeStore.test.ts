import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMdMode,
  persistMdMode,
  DEFAULT_MD_MODE,
  MD_MODE_STORAGE_KEY,
} from '../src/client/mdModeStore.ts';

/** In-memory Storage double (Node has no localStorage). */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  };
}

test('DEFAULT_MD_MODE 是 source', () => {
  assert.equal(DEFAULT_MD_MODE, 'source');
});

test('loadMdMode: 无存储值返回默认 source', () => {
  assert.equal(loadMdMode(fakeStorage()), 'source');
});

test('loadMdMode: 读取持久化的 source', () => {
  const storage = fakeStorage({ [MD_MODE_STORAGE_KEY]: 'source' });
  assert.equal(loadMdMode(storage), 'source');
});

test('loadMdMode: 损坏值回退默认', () => {
  const storage = fakeStorage({ [MD_MODE_STORAGE_KEY]: 'banana' });
  assert.equal(loadMdMode(storage), 'source');
});

test('persistMdMode: 写入存储', () => {
  const storage = fakeStorage();
  persistMdMode('source', storage);
  assert.equal(storage.getItem(MD_MODE_STORAGE_KEY), 'source');
});
