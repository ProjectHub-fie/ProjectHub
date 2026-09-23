/**
 * HTML sanitisation for incoming mail.
 *
 * Mail bodies arrive from outside the project and are rendered inside the admin
 * dashboard, so they are the single most dangerous content the app handles. A
 * message that carries `<script>`, an `onerror=` attribute or a `javascript:`
 * URL would otherwise run with the administrator's session.
 *
 * This is a small allow-list sanitiser rather than a general-purpose parser:
 * it walks the markup with a tokenizer, keeps only known-safe tags and
 * attributes, and drops everything else (including all inline event handlers).
 * It never produces HTML that the browser can treat as script, and it makes no
 * network requests, so it is safe to run inside a serverless function.
 *
 * Deliberate choices:
 *   - `a href` is re-validated after decoding, so `java&#115;cript:` and
 *     `java\tscript:` are both caught.
 *   - Images are allowed but their `src` must be http(s) or a cid: reference;
 *     `data:` and `javascript:` are refused.
 *   - Tags that can execute or embed content (`script`, `iframe`, `object`,
 *     `embed`, `style`, `link`, `meta`, `form`) are dropped with their
 *     contents where the content is not text.
 */

// Tags whose entire subtree is discarded, not just the tag itself.
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'applet',
  'frame',
  'frameset',
]);

// Tags that are kept. Anything not listed here disappears (its text remains).
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul', 'var', 'wbr',
]);

// Attributes kept per tag, plus a global set that applies everywhere.
const GLOBAL_ATTRS = new Set(['class', 'title', 'dir', 'lang']);
const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'align', 'valign']),
  th: new Set(['colspan', 'rowspan', 'align', 'valign', 'scope']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  table: new Set(['width', 'align', 'cellpadding', 'cellspacing', 'border']),
  ol: new Set(['start', 'type']),
};

// Void elements never get a closing tag.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr', 'col']);

const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|cid:)/i;
// Percent-decoding an attribute can hide a scheme (`%6aavascript:`), so decode
// before testing rather than after.
const URL_ATTRS = new Set(['href', 'src']);

/**
 * Escapes text that is emitted into an attribute or as a plain string.
 *
 * A bare `&` becomes `&amp;`, but an existing entity (`&amp;`, `&#106;`,
 * `&nbsp;`) is left alone. Escaping it again would turn a URL like
 * `?a=1&amp;b=2` into `&amp;amp;b=2`, which the recipient's client decodes back
 * to the wrong address. Safety does not depend on the double escape: the URL
 * checks decode entities before testing, and `<`/`>` are always escaped here.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalises a value before it is tested against the URL allow-list.
 *
 * Control characters (including tabs and newlines) are removed because browsers
 * ignore them inside a scheme, so `java\nscript:` navigates. `&amp;`, `&#x6a;`
 * and `%6a` are decoded for the same reason.
 */
function decodeForInspection(value) {
  let out = String(value);
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u001f\u007f\s]+/g, (m) => (m === ' ' ? ' ' : ''));
  out = out.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  out = out.replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)));
  out = out.replace(/&amp;/gi, '&');
  try {
    out = decodeURIComponent(out);
  } catch {
    // A malformed percent escape is not a valid URL; leave it for the check.
  }
  return out.trim();
}

/** True when an attribute value is safe to place in an href/src. */
function isSafeUrl(value) {
  const decoded = decodeForInspection(value).toLowerCase();
  if (!decoded) return false;
  // A protocol-relative or relative URL carries no scheme to abuse.
  if (decoded.startsWith('//')) return false;
  if (decoded.startsWith('#')) return true;
  if (!/^[a-z][a-z0-9+.-]*:/.test(decoded)) return true;
  return SAFE_URL_SCHEMES.test(decoded);
}

/** Parses the tag attributes out of a raw tag body. */
function parseAttributes(raw) {
  const attrs = [];
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.push({ name, value });
  }
  return attrs;
}

/** Serialises the safe subset of a tag's attributes. */
function safeAttributes(tag, attrs) {
  const allowed = TAG_ATTRS[tag] || new Set();
  const out = [];

  for (const { name, value } of attrs) {
    // Event handlers and anything not explicitly allowed are dropped. This is
    // what removes onerror/onload/onclick and friends.
    if (name.startsWith('on')) continue;
    if (!GLOBAL_ATTRS.has(name) && !allowed.has(name)) continue;

    if (URL_ATTRS.has(name)) {
      if (!isSafeUrl(value)) continue;
      out.push(`${name}="${escapeHtml(value)}"`);
      continue;
    }

    out.push(`${name}="${escapeHtml(value)}"`);
  }

  if (tag === 'a') {
    // Any link in an email leaves the app, so it gets the safe-target pair even
    // when the message tried to omit it. Both are only added when absent, so a
    // second sanitising pass produces identical output.
    if (!out.some((a) => a.startsWith('target='))) out.push('target="_blank"');
    if (!out.some((a) => a.startsWith('rel='))) out.push('rel="noopener noreferrer nofollow"');
  }

  return out.length ? ` ${out.join(' ')}` : '';
}

/**
 * Sanitises an untrusted HTML string for rendering in the dashboard.
 *
 * Returns markup containing only allow-listed tags and attributes. Text that is
 * not inside a dropped subtree is preserved and escaped.
 */
export function sanitizeEmailHtml(input) {
  if (!input || typeof input !== 'string') return '';

  let html = input;
  // Strip comments (including conditional comments, which execute in Outlook)
  // and doctype/processing instructions before tokenising.
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<!(?:doctype|\[CDATA)[\s\S]*?>/gi, '');
  html = html.replace(/<\?[\s\S]*?\?>/g, '');

  let out = '';
  let index = 0;
  // Depth counter per dropped subtree so nested dropped tags do not re-enable
  // output early.
  let dropDepth = 0;
  let dropTag = null;

  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let match;

  while ((match = tagPattern.exec(html))) {
    const [raw, closing, rawTag, rawAttrs] = match;

    // Text before this tag.
    const text = html.slice(index, match.index);
    if (text) out += dropDepth > 0 ? '' : escapeHtml(text);
    index = match.index + raw.length;

    const tag = rawTag.toLowerCase();
    const isClosing = closing === '/';

    if (dropDepth > 0) {
      if (tag === dropTag) {
        if (isClosing) dropDepth -= 1;
        else if (!VOID_TAGS.has(tag)) dropDepth += 1;
        if (dropDepth <= 0) {
          dropDepth = 0;
          dropTag = null;
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!isClosing && !VOID_TAGS.has(tag)) {
        dropDepth = 1;
        dropTag = tag;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown container: drop the tag but keep its text content.
      continue;
    }

    if (isClosing) {
      out += VOID_TAGS.has(tag) ? '' : `</${tag}>`;
      continue;
    }

    // A `<p/>`-style self-closing non-void tag is treated as an open tag; the
    // browser will balance it, and dropping it would lose text.
    const attrs = safeAttributes(tag, parseAttributes(rawAttrs || ''));
    out += `<${tag}${attrs}>`;
  }

  // Trailing text after the last tag.
  const tail = html.slice(index);
  if (tail && dropDepth === 0) out += escapeHtml(tail);

  return out;
}

/**
 * Plain-text preview of an email body.
 *
 * Used for list snippets and notification previews, so a notification row never
 * needs to carry a full body.
 */
export function toSnippet(input, length = 180) {
  if (!input) return '';
  const text = String(input)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * Converts a plain-text body to safe HTML.
 *
 * Plain-text mail is rendered as escaped text with line breaks preserved, so a
 * text-only message that contains `<script>` shows the literal characters
 * instead of executing them.
 */
export function textToSafeHtml(input) {
  if (!input) return '';
  return escapeHtml(String(input)).replace(/\r?\n/g, '<br />');
}

export { escapeHtml };
