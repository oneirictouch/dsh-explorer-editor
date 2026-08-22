import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPath, parentDirOf } from '../src/parentDir.ts';

test('normPath: 反斜杠与尾斜杠统一', () => {
  assert.equal(normPath('D:\\work\\src'), 'D:/work/src');
  assert.equal(normPath('D:/work/'), 'D:/work');
  assert.equal(normPath('D:/work'), 'D:/work');
});

test('parentDirOf: 根级文件映射到根', () => {
  assert.equal(parentDirOf('D:/work', 'a.txt'), 'D:/work');
  assert.equal(parentDirOf('D:/work', 'src'), 'D:/work');
});

test('parentDirOf: 子目录文件映射到其父目录', () => {
  assert.equal(parentDirOf('D:/work', 'src/a.ts'), 'D:/work/src');
  assert.equal(parentDirOf('D:/work', 'src/sub/b.ts'), 'D:/work/src/sub');
});

test('parentDirOf: Windows 反斜杠文件名', () => {
  assert.equal(parentDirOf('D:\\work', 'src\\a.ts'), 'D:/work/src');
});

test('parentDirOf: 目录自身变化映射到其父目录', () => {
  assert.equal(parentDirOf('D:/work', 'src/sub'), 'D:/work/src');
});
