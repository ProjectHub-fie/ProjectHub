/**
 * Password show/hide control.
 *
 * There is no DOM/JSX test environment (Node strips types but not JSX), so the
 * invariants are read from source, like client-auth.test.mjs. These pin the two
 * things that actually matter: every password field offers the toggle, and the
 * toggle really swaps the input type instead of only swapping its icon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const component = source('client/src/components/ui/password-input.tsx');

test('the toggle swaps the input type between password and text', () => {
  assert.match(
    component,
    /type=\{visible \? "text" : "password"\}/,
    'revealing a password must switch the input type, not just its icon',
  );
});

test('the toggle uses the eye icons and reports its state accessibly', () => {
  assert.match(component, /from "lucide-react"/, 'the icon set is lucide-react');
  assert.match(component, /\bEye\b/, 'a visible-state eye icon is required');
  assert.match(component, /\bEyeOff\b/, 'a hidden-state eye-off icon is required');
  assert.match(component, /aria-label=\{visible \? "Hide password" : "Show password"\}/);
  assert.match(component, /aria-pressed=\{visible\}/);
});

test('the toggle button cannot submit the surrounding form', () => {
  // A bare <button> inside a <form> defaults to type="submit", which would send
  // the form every time someone revealed their password.
  assert.match(component, /type="button"/, 'the toggle must not submit the form');
});

test('the component forwards refs and props like the shared Input', () => {
  assert.match(component, /React\.forwardRef<HTMLInputElement/, 'form libraries need the ref');
  assert.match(component, /\{\.\.\.props\}/, 'value/onChange/name must reach the input');
});

test('no page still renders a bare type="password" input', () => {
  const pagesDir = fileURLToPath(new URL('../client/src/pages', import.meta.url));
  const offenders = readdirSync(pagesDir)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => /type="password"/.test(source(`client/src/pages/${name}`)));

  assert.deepEqual(
    offenders,
    [],
    `these pages bypass PasswordInput and offer no reveal toggle: ${offenders.join(', ')}`,
  );
});

test('every page that collects a password imports PasswordInput', () => {
  const pagesDir = fileURLToPath(new URL('../client/src/pages', import.meta.url));
  const users = readdirSync(pagesDir)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => /<PasswordInput/.test(source(`client/src/pages/${name}`)));

  assert.ok(users.length > 0, 'the password fields should be using PasswordInput');

  for (const name of users) {
    assert.match(
      source(`client/src/pages/${name}`),
      /from "@\/components\/ui\/password-input"/,
      `${name} uses PasswordInput but does not import it`,
    );
  }
});
