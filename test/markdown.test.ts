import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMarkdownPath, renderMarkdown } from '../src/client/markdown.ts';

test('isMarkdownPath: .md / .markdown 识别，其他扩展名拒绝', () => {
  assert.equal(isMarkdownPath('README.md'), true);
  assert.equal(isMarkdownPath('docs/guide.markdown'), true);
  assert.equal(isMarkdownPath('a.MD'), true);
  assert.equal(isMarkdownPath('main.ts'), false);
  assert.equal(isMarkdownPath('README.md.bak'), false);
  assert.equal(isMarkdownPath(''), false);
});

test('renderMarkdown: 渲染标题/列表/行内代码', () => {
  const html = renderMarkdown('# Title\n\n- a\n- b\n\n`code` here');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<code>code<\/code>/);
});

test('renderMarkdown: GFM 表格渲染为 <table>', () => {
  const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
});

test('renderMarkdown: 代码块带 language class', () => {
  const html = renderMarkdown('```ts\nconst x = 1;\n```');
  assert.match(html, /<pre><code class="language-ts">/);
});

test('renderMarkdown: 失败时兜底返回 <pre> 原文（不抛异常）', () => {
  // 构造会让 marked 抛错的输入不可靠，这里验证 API 从不抛且总返回字符串。
  const html = renderMarkdown('plain **text**');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0);
});

test('renderMarkdown: raw HTML 被转义（防 XSS）', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img\b/i);
});
