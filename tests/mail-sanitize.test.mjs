/**
 * Mail HTML sanitisation.
 *
 * The inbox renders mail bodies that arrive from outside the project, so this
 * module is the boundary that keeps a malicious message from running script with
 * an administrator's dashboard session. Each case below is an attack that a naive
 * "strip <script>" pass would miss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEmailHtml,
  toSnippet,
  textToSafeHtml,
} from '../api/lib/mail-sanitize.js';

test('script tags are removed with their contents', () => {
  const out = sanitizeEmailHtml('<p>Hello</p><script>alert(document.cookie)</script><p>Bye</p>');
  assert.ok(!/script/i.test(out), `script must not survive: ${out}`);
  assert.ok(!out.includes('document.cookie'), 'the script body must be dropped too');
  assert.ok(out.includes('Hello') && out.includes('Bye'), 'surrounding text is preserved');
});

test('event handler attributes are dropped', () => {
  const out = sanitizeEmailHtml('<img src="https://x.test/a.png" onerror="alert(1)" />');
  assert.ok(!/onerror/i.test(out), `event handlers must not survive: ${out}`);
  assert.ok(out.includes('src='), 'the safe attribute is kept');
});

test('javascript: URLs are refused, including obfuscated forms', () => {
  const attempts = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JavaScript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="java&#115;cript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="%6aavascript:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
  ];
  for (const attempt of attempts) {
    const out = sanitizeEmailHtml(attempt);
    assert.ok(
      !/javascript:|vbscript:|data:/i.test(out.replace(/&#\d+;/g, '')),
      `unsafe scheme survived in ${attempt} -> ${out}`,
    );
  }
});

test('safe link schemes are kept and harden the target', () => {
  const out = sanitizeEmailHtml('<a href="https://example.com/x">link</a>');
  assert.ok(out.includes('href="https://example.com/x"'), 'https link preserved');
  assert.ok(out.includes('rel="noopener noreferrer nofollow"'), 'rel is force-added');
  assert.ok(out.includes('target="_blank"'), 'links open in a new tab');

  const mail = sanitizeEmailHtml('<a href="mailto:a@b.com">mail</a>');
  assert.ok(mail.includes('mailto:a@b.com'), 'mailto links remain usable');
});

test('iframe, object, embed, style and form are all removed', () => {
  const dangerous = [
    '<iframe src="https://evil.test"></iframe>',
    '<object data="x.swf"></object>',
    '<embed src="x.swf" />',
    '<style>body{display:none}</style>',
    '<form action="https://evil.test"><input name="x" /></form>',
    '<svg onload="alert(1)"></svg>',
    '<link rel="stylesheet" href="https://evil.test/x.css" />',
    '<meta http-equiv="refresh" content="0;url=https://evil.test" />',
  ];
  for (const html of dangerous) {
    const out = sanitizeEmailHtml(html);
    assert.ok(
      !/<(iframe|object|embed|style|form|input|svg|link|meta)/i.test(out),
      `dangerous tag survived in ${html} -> ${out}`,
    );
  }
});

test('inline images keep http(s) and cid sources but not data: URLs', () => {
  const ok = sanitizeEmailHtml('<img src="https://x.test/a.png" alt="a" width="10" />');
  assert.ok(ok.includes('https://x.test/a.png'));

  const cid = sanitizeEmailHtml('<img src="cid:image1" alt="a" />');
  assert.ok(cid.includes('cid:image1'), 'cid references are legitimate inline images');

  const bad = sanitizeEmailHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="a" />');
  assert.ok(!bad.includes('data:'), 'data: image sources are refused');
});

test('comments and conditional comments are stripped', () => {
  const out = sanitizeEmailHtml('<!-- <script>alert(1)</script> --><p>ok</p><!--[if IE]><script>x</script><![endif]-->');
  assert.ok(!/script/i.test(out), `comments must not carry script: ${out}`);
  assert.ok(out.includes('ok'));
});

test('text content is escaped so markup cannot be smuggled outside a tag', () => {
  const out = sanitizeEmailHtml('<p>5 &lt; 6 &amp;&amp; 7 &gt; 6</p>');
  assert.ok(out.includes('&lt;'), 'less-than stays escaped');
  assert.ok(out.includes('&amp;'), 'ampersand stays escaped');
});

test('plain text bodies are escaped, so a text-only message cannot execute', () => {
  const out = textToSafeHtml('<script>alert(1)</script>\nline two');
  assert.ok(!/<script>/i.test(out), `the literal tag must be escaped: ${out}`);
  assert.ok(out.includes('&lt;script&gt;'), 'the script text is shown as characters');
  assert.ok(out.includes('<br />'), 'line breaks are preserved');
});

test('sanitising is idempotent', () => {
  const once = sanitizeEmailHtml('<p onclick="x">a</p><script>b</script><a href="javascript:1">c</a>');
  const twice = sanitizeEmailHtml(once);
  assert.equal(twice, once, 'a second pass must not change the result');
});

test('an empty or non-string input yields an empty string', () => {
  assert.equal(sanitizeEmailHtml(''), '');
  assert.equal(sanitizeEmailHtml(null), '');
  assert.equal(sanitizeEmailHtml(undefined), '');
  assert.equal(sanitizeEmailHtml(42), '');
});

test('snippets drop markup and collapse whitespace for list previews', () => {
  const snippet = toSnippet('<p>Hello   <strong>there</strong></p><script>bad()</script>\n\nworld');
  assert.ok(!snippet.includes('<'), 'no markup in a snippet');
  assert.ok(!snippet.includes('bad()'), 'script content is excluded');
  assert.equal(snippet, 'Hello there world');
});

test('a snippet is truncated to the requested length', () => {
  const long = 'a'.repeat(500);
  assert.ok(toSnippet(long, 50).length <= 50);
});

test('a plain tag without attributes is still allowed for structure', () => {
  const out = sanitizeEmailHtml('<table><tr><td>cell</td></tr></table>');
  assert.ok(out.includes('<table>') && out.includes('<td>cell</td>'), 'table structure is preserved');
});

test('unknown tags are dropped but their text is kept', () => {
  const out = sanitizeEmailHtml('<custom-tag>visible text</custom-tag>');
  assert.ok(!out.includes('custom-tag'), 'the unknown tag is removed');
  assert.ok(out.includes('visible text'), 'its text content survives');
});
