import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativePath, baseName } from '../src/client/paths.ts';

test('relativePath: 常规相对路径', () => {
  assert.equal(relativePath('/work', '/work/src/a.ts'), 'src/a.ts');
  assert.equal(relativePath('/work', '/work/package.json'), 'package.json');
});

test('relativePath: 根自身返回空串（含尾斜杠差异）', () => {
  assert.equal(relativePath('/work', '/work'), '');
  assert.equal(relativePath('/work/', '/work'), '');
  assert.equal(relativePath('/work', '/work/'), '');
});

test('relativePath: Windows 反斜杠统一为 /', () => {
  assert.equal(relativePath('D:\\work', 'D:\\work\\src\\a.ts'), 'src/a.ts');
});

test('relativePath: 不在根下的路径原样返回（防御）', () => {
  assert.equal(relativePath('/work', '/other/file.ts'), '/other/file.ts');
  assert.equal(relativePath('/work', '/workspace2/a.ts'), '/workspace2/a.ts');
});

test('baseName: 提取文件名', () => {
  assert.equal(baseName('/work/src/a.ts'), 'a.ts');
  assert.equal(baseName('a.ts'), 'a.ts');
  assert.equal(baseName('/work/dir/'), 'dir');
  assert.equal(baseName('D:\\work\\a.txt'), 'a.txt');
});
