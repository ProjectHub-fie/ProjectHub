/**
 * Email validation shared by the contact form and the API.
 *
 * A single source of truth matters here: the browser can be bypassed entirely,
 * so the server must enforce the same rule the form does. Anything that only
 * checks `includes("@")` accepts `a@b`, `@x.com`, `a b@x.com` and worse.
 */

// Local part and domain as separate, anchored groups. The previous permissive
// patterns are deliberately not reused: they match on substrings and therefore
// accept trailing junk.
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit on a whole address.
const MAX_LOCAL_LENGTH = 64;

// Domains that never receive mail; sending to them wastes a send and can be
// used to probe the endpoint.
const DISPOSABLE_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "invalid.com",
  "localhost",
]);

export type EmailValidation =
  | { valid: true; email: string }
  | { valid: false; reason: string };

export function validateEmail(value: unknown): EmailValidation {
  if (typeof value !== "string") {
    return { valid: false, reason: "Email is required" };
  }

  const email = value.trim();
  if (!email) return { valid: false, reason: "Email is required" };

  if (email.length > MAX_EMAIL_LENGTH) {
    return { valid: false, reason: "Email address is too long" };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { valid: false, reason: "Enter a valid email address" };
  }

  const [local, domain] = email.split("@");
  if (local.length > MAX_LOCAL_LENGTH) {
    return { valid: false, reason: "Email address is too long" };
  }

  // Consecutive dots pass no reasonable reading of an address and are a common
  // sign of a typo such as "name..surname@x.com".
  if (local.includes("..") || domain.includes("..")) {
    return { valid: false, reason: "Enter a valid email address" };
  }

  if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) {
    return { valid: false, reason: "Please use a real email address" };
  }

  return { valid: true, email };
}

export function isValidEmail(value: unknown): boolean {
  return validateEmail(value).valid;
}
