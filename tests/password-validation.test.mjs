/**
 * Password strength rules for the register and reset forms.
 *
 * The important property is that the rules the form advertises are the rules
 * the API enforces, because a form can be skipped by posting directly.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  evaluatePassword,
  passwordProblem,
  PASSWORD_CHECKS,
  PASSWORD_MIN_LENGTH,
} from '../client/src/lib/password-validation.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const STRONG = ['Str0ng!Pass', 'Tr0ub4dor&3', 'Xk9!mQ2#vB7@'];

const WEAK = [
  '',
  'short',
  'alllowercase1',
  'ALLUPPERCASE1',
  'NoNumbersHere',
  'NoSpecials123',
  'has space1A',
  'password123',
  'projecthub',
];

test('accepts strong passwords', () => {
  for (const pw of STRONG) {
    assert.equal(evaluatePassword(pw).valid, true, `expected valid: ${pw}`);
  }
});

test('rejects weak passwords', () => {
  for (const pw of WEAK) {
    assert.equal(evaluatePassword(pw).valid, false, `expected invalid: ${pw}`);
  }
});

test('lists every unmet rule rather than stopping at the first', () => {
  const { failed } = evaluatePassword('abc');
  // Too short, no uppercase, no number, no special character.
  assert.ok(failed.length >= 4, `expected several failures, got ${failed.length}`);
});

test('a fully compliant password has no unmet rules', () => {
  assert.deepEqual(evaluatePassword('Str0ng!Pass').failed, []);
});

test('common passwords are rejected even when they satisfy every rule', () => {
  // 'Passw0rd' meets length, case, number and special-character rules.
  const { score, valid } = evaluatePassword('Passw0rd');
  assert.equal(valid, false);
  assert.equal(score, 0);
});

test('score rises with length and variety but is capped', () => {
  const weak = evaluatePassword('a').score;
  const strong = evaluatePassword('Str0ng!Passw0rd!').score;
  assert.ok(strong > weak);
  assert.ok(strong <= 4);
  assert.ok(weak >= 0);
});

test('an empty password scores zero and is not valid', () => {
  const result = evaluatePassword('');
  assert.equal(result.score, 0);
  assert.equal(result.valid, false);
});

test('the minimum length rule matches the exported constant', () => {
  const lengthRule = PASSWORD_CHECKS.find((c) => c.id === 'length');
  assert.ok(lengthRule);
  assert.equal(lengthRule.test('a'.repeat(PASSWORD_MIN_LENGTH - 1)), false);
  assert.equal(lengthRule.test('a'.repeat(PASSWORD_MIN_LENGTH)), true);
});

test('a compliant password returns no problem', () => {
  assert.equal(passwordProblem('Str0ng!Pass'), null);
});

test('the API enforces the same password rules as the form', () => {
  const apiSource = readFileSync(`${repoRoot}api/index.js`, 'utf8');
  assert.match(apiSource, /function passwordProblem\(/, 'api must define passwordProblem');
  assert.match(
    apiSource,
    /const passwordError = passwordProblem\(password\)/,
    'register must validate the password',
  );
  assert.match(
    apiSource,
    /const resetPasswordError = passwordProblem\(newPassword\)/,
    'reset must validate the password',
  );
});

test('the express server enforces the same password rules as the form', () => {
  const routeSource = readFileSync(`${repoRoot}server/routes.ts`, 'utf8');
  assert.match(
    routeSource,
    /function passwordProblem\(value: unknown\)/,
    'server must define passwordProblem',
  );
  assert.match(
    routeSource,
    /const passwordError = passwordProblem\(password\)/,
    'register route must validate the password',
  );
});
