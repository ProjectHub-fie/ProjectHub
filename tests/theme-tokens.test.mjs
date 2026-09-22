/**
 * Theme tokens.
 *
 * The Tailwind colour definitions have to wrap the CSS custom properties in
 * `hsl(...)`. The variables hold bare HSL triplets (`222.2 84% 4.9%`), so
 * emitting `var(--background)` on its own produces a declaration the browser
 * rejects, and every token-based surface — which is every dialog, popover,
 * dropdown and sheet in both portals — paints transparent instead of taking the
 * theme colour. This test pins the format so that regression cannot return.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const config = source('tailwind.config.ts');

// Every `token: "var(--token)"` / `DEFAULT: "var(--token)"` mapping in the
// colours block, minus the ones that are already wrapped.
test('every theme colour wraps its variable in hsl()', () => {
  const colours = config.slice(
    config.indexOf('colors: {'),
    config.indexOf('fontFamily:'),
  );

  const bare = [...colours.matchAll(/"var\(--[a-z0-9-]+\)"/g)].map((m) => m[0]);
  assert.deepEqual(
    bare,
    [],
    `unwrapped variable(s) render transparent: ${bare.join(', ')}`,
  );
});

test('the shared surface tokens resolve through hsl()', () => {
  for (const token of [
    'background',
    'foreground',
    'card',
    'popover',
    'primary',
    'secondary',
    'muted',
    'accent',
    'destructive',
    'border',
    'input',
    'ring',
  ]) {
    assert.match(
      config,
      new RegExp(`"hsl\\(var\\(--${token}\\)\\)"`),
      `${token} must be defined as hsl(var(--${token}))`,
    );
  }
});

test('sidebar tokens used by the shared portals are defined', () => {
  for (const token of [
    'sidebar-background',
    'sidebar-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
  ]) {
    assert.match(config, new RegExp(`"hsl\\(var\\(--${token}\\)\\)"`));
  }
});

test('the variables the config references are declared in index.css', () => {
  const css = source('client/src/index.css');

  for (const token of [
    '--background',
    '--foreground',
    '--card',
    '--popover',
    '--primary',
    '--border',
    '--ring',
    '--chart-1',
    '--chart-2',
    '--font-sans',
    '--font-mono',
  ]) {
    assert.match(
      css,
      new RegExp(`${token}:\\s*[^;]+;`),
      `${token} is referenced by the theme but never declared`,
    );
  }
});
