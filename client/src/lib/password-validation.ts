/**
 * Password strength rules shared by the register and reset forms.
 *
 * The rules are returned as a list of individual checks rather than one regex so
 * the form can show every unmet requirement at once instead of revealing them
 * one failure at a time.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordCheck = {
  id: string;
  label: string;
  test: (value: string) => boolean;
};

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "letmein",
  "welcome",
  "admin123",
  "iloveyou",
  "monkey123",
  "dragon123",
  "football1",
  "abc12345",
  "passw0rd",
  "projecthub",
]);

export const PASSWORD_CHECKS: PasswordCheck[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "lower", label: "One lowercase letter", test: (v) => /[a-z]/.test(v) },
  { id: "upper", label: "One uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { id: "number", label: "One number", test: (v) => /[0-9]/.test(v) },
  {
    id: "special",
    label: "One special character (!@#$%^&*)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
  { id: "nospace", label: "No spaces", test: (v) => v.length > 0 && !/\s/.test(v) },
];

export type PasswordStrength = {
  /** 0-4, for a four-segment meter. */
  score: number;
  label: "Too weak" | "Weak" | "Fair" | "Good" | "Strong";
  /** Every rule that is still unmet. */
  failed: string[];
  valid: boolean;
};

export function evaluatePassword(value: string): PasswordStrength {
  const password = typeof value === "string" ? value : "";
  const failed = PASSWORD_CHECKS.filter((check) => !check.test(password));

  const meetsRules = failed.length === 0;
  const isCommon = COMMON_PASSWORDS.has(password.toLowerCase());

  // Long passphrases are allowed to score on length alone rather than being
  // forced to add punctuation, which is what tends to push people toward
  // predictable substitutions like a trailing "!".
  const lengthBonus = password.length >= 12 ? 1 : 0;
  const variety = PASSWORD_CHECKS.filter((c) => c.id !== "length" && c.id !== "nospace" && c
    .test(password)).length;

  let score = 0;
  if (password.length > 0) {
    score = Math.min(4, Math.floor(variety / 2) + lengthBonus);
    if (meetsRules) score = Math.max(score, 2);
    if (isCommon) score = 0;
  }

  const labels: PasswordStrength["label"][] = ["Too weak", "Weak", "Fair", "Good", "Strong"];

  return {
    score,
    label: labels[score],
    failed: failed.map((check) => check.label),
    valid: meetsRules && password.length > 0 && !isCommon,
  };
}

export function passwordProblem(value: string): string | null {
  if (typeof value !== "string" || !value) return "Password is required";
  const { valid, failed } = evaluatePassword(value);
  if (valid) return null;
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return "That password is too common; choose something less predictable";
  }
  if (!PASSWORD_CHECKS[0].test(value)) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  return `Password must include ${failed.map((f) => f.toLowerCase()).join(", ")}`;
}
