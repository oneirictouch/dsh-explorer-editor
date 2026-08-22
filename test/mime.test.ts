import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mimeOf, BINARY_EXTENSIONS } from '../src/mime.ts';

test('mimeOf: 常见图片扩展名', () => {
  assert.equal(mimeOf('hero.svg'), 'image/svg+xml');
  assert.equal(mimeOf('a.PNG'), 'image/png');
  assert.equal(mimeOf('photo.jpg'), 'image/jpeg');
  assert.equal(mimeOf('photo.jpeg'), 'image/jpeg');
  assert.equal(mimeOf('anim.gif'), 'image/gif');
  assert.equal(mimeOf('pic.webp'), 'image/webp');
  assert.equal(mimeOf('icon.ico'), 'image/x-icon');
});

test('mimeOf: 字体/媒体/未知扩展名', () => {
  assert.equal(mimeOf('font.woff2'), 'font/woff2');
  assert.equal(mimeOf('a.mp4'), 'video/mp4');
  assert.equal(mimeOf('a.mp3'), 'audio/mpeg');
  assert.equal(mimeOf('unknown.xyz'), 'application/octet-stream');
  assert.equal(mimeOf('noext'), 'application/octet-stream');
});

test('BINARY_EXTENSIONS: 常见二进制扩展名在集合内、文本扩展名不在', () => {
  for (const ext of ['png', 'jpg', 'pdf', 'zip', 'wasm', 'mp4', 'wav', 'woff2', 'xlsx', 'exe']) {
    assert.ok(BINARY_EXTENSIONS.has(ext), `expected binary: ${ext}`);
  }
  for (const ext of ['ts', 'tsx', 'js', 'md', 'json', 'css', 'py', 'yaml']) {
    assert.ok(!BINARY_EXTENSIONS.has(ext), `expected text: ${ext}`);
  }
});
