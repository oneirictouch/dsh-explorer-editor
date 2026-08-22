import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText } from '../src/decode.ts';

test('decodeText: UTF-8 文件按 UTF-8 解码', () => {
  const buf = new TextEncoder().encode('hello 中文 abc');
  assert.equal(decodeText(buf), 'hello 中文 abc');
});

test('decodeText: GBK 字节流回退到 GBK 解码', () => {
  // "中文" 的 GBK 编码: 中=D6D0, 文=CEC4
  const gbk = new Uint8Array([0xD6, 0xD0, 0xCE, 0xC4, 0x20, 0x41]);
  assert.equal(decodeText(gbk), '中文 A');
});

test('decodeText: 空缓冲区', () => {
  assert.equal(decodeText(new Uint8Array(0)), '');
});
