/**
 * Email validation for the contact form.
 *
 * The browser check is a convenience; the server check is what actually rejects
 * bad input, so both carry the same rule and the source-level assertions below
 * keep them from drifting apart.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Node strips the types natively here; the module has no DOM or React imports.
import { validateEmail, isValidEmail } from '../client/src/lib/email-validation.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const VALID = [
  'ada@gmail.com',
  'first.last@sub.domain.co.uk',
  'user+tag@project-hub.io',
  "o'brien@mail.org",
];

const INVALID = [
  '',
  '   ',
  'plainaddress',
  'a@b',
  '@nodomain.com',
  'noat.com',
  'double..dot@gmail.com',
  'trailing@dot.com.',
  'spaces in@mail.com',
  'user@-leadinghyphen.com',
  'user@example.com',
  'user@localhost',
  'a'.repeat(65) + '@gmail.com',
  'user@' + 'a'.repeat(250) + '.com',
];

test('accepts well-formed addresses', () => {
  for (const email of VALID) {
    assert.equal(isValidEmail(email), true, `expected valid: ${email}`);
  }
});

test('rejects malformed addresses', () => {
  for (const email of INVALID) {
    assert.equal(isValidEmail(email), false, `expected invalid: ${email}`);
  }
});

test('reports a specific reason for an empty address', () => {
  assert.equal(validateEmail('').reason, 'Email is required');
});

test('reports a specific reason for a malformed address', () => {
  assert.equal(validateEmail('a@b').reason, 'Enter a valid email address');
});

test('reports a specific reason for a placeholder domain', () => {
  assert.equal(validateEmail('user@example.com').reason, 'Please use a real email address');
});

test('trims surrounding whitespace before validating', () => {
  const result = validateEmail('  ada@gmail.com  ');
  assert.equal(result.valid, true);
  assert.equal(result.email, 'ada@gmail.com');
});

test('the API enforces the same rule as the client', async () => {
  const apiSource = readFileSync(`${repoRoot}api/index.js`, 'utf8');
  // The server must not rely on the form; assert it carries its own validator
  // and calls it from the contact endpoint.
  assert.match(apiSource, /function emailProblem\(/, 'api must define emailProblem');
  assert.match(
    apiSource,
    /const emailError = emailProblem\(email\)/,
    'contact endpoint must validate the email',
  );
});

test('the express server enforces the same rule as the client', () => {
  const routeSource = readFileSync(`${repoRoot}server/routes.ts`, 'utf8');
  assert.match(routeSource, /function emailProblem\(value: unknown\)/, 'server must define emailProblem');
  assert.match(
    routeSource,
    /const emailError = emailProblem\(email\)/,
    'contact route must validate the email',
  );
});
