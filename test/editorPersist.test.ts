import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldPersistContent,
  filterByRoot,
  serialize,
  deserialize,
  MAX_PERSIST_CONTENT,
  type PersistSnapshot,
} from '../src/client/editorPersist.ts';

test('shouldPersistContent: 阈值边界', () => {
  assert.equal(shouldPersistContent({ content: 'a'.repeat(MAX_PERSIST_CONTENT) }), true);
  assert.equal(shouldPersistContent({ content: 'a'.repeat(MAX_PERSIST_CONTENT + 1) }), false);
  assert.equal(shouldPersistContent({ content: '' }), true);
});

test('filterByRoot: 保留 root 下的路径', () => {
  const tabs = [
    { path: 'D:/work/src/a.ts' },
    { path: 'D:/work/package.json' },
    { path: 'D:/other/b.ts' },
    { path: 'D:/workspace2/c.ts' }, // 前缀误匹配防御
  ];
  const kept = filterByRoot(tabs, 'D:/work');
  assert.deepEqual(kept.map((t) => t.path), ['D:/work/src/a.ts', 'D:/work/package.json']);
});

test('filterByRoot: root 自身与反斜杠路径', () => {
  const kept = filterByRoot([{ path: 'D:\\work' }, { path: 'D:\\work\\x.txt' }], 'D:\\work');
  assert.equal(kept.length, 2);
});

test('serialize/deserialize: 往返一致（JSON 级）', () => {
  const snapshot: PersistSnapshot = {
    root: 'D:/work',
    activePath: 'D:/work/a.ts',
    tabs: [
      { path: 'D:/work/a.ts', mtimeMs: 123, dirty: true, content: 'hello', savedContent: 'hell' },
      { path: 'D:/work/b.ts', mtimeMs: 456, dirty: false },
    ],
  };
  // JSON.stringify 会丢弃 undefined 字段，故以序列化结果为准做往返比较。
  const once = serialize(snapshot);
  assert.equal(serialize(deserialize(once) as PersistSnapshot), once);
  // 关键字段保持。
  const parsed = deserialize(once) as PersistSnapshot;
  assert.equal(parsed.root, 'D:/work');
  assert.equal(parsed.activePath, 'D:/work/a.ts');
  assert.equal(parsed.tabs.length, 2);
  assert.equal(parsed.tabs[0].content, 'hello');
  assert.equal(parsed.tabs[0].dirty, true);
  assert.equal(parsed.tabs[1].dirty, false);
});

test('deserialize: 损坏数据回退 null', () => {
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{"root": 1}'), null);
  assert.equal(deserialize('{"root": "x", "tabs": "nope"}'), null);
  assert.equal(deserialize('{"root": "x", "tabs": [{"noPath": 1}]}')?.tabs.length, 0);
  assert.equal(deserialize('null'), null);
});

test('deserialize: 无 activePath 时回退 null', () => {
  const parsed = deserialize('{"root":"D:/work","tabs":[{"path":"D:/work/a.ts"}]}');
  assert.equal(parsed?.activePath, null);
  assert.equal(parsed?.tabs[0].mtimeMs, 0);
  assert.equal(parsed?.tabs[0].dirty, false);
});
