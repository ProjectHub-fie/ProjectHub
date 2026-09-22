import { Check, X } from "lucide-react";
import { evaluatePassword, PASSWORD_CHECKS } from "@/lib/password-validation";

const BAR_COLOURS = [
  "bg-destructive",
  "bg-destructive",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-emerald-600",
];

const TEXT_COLOURS = [
  "text-destructive",
  "text-destructive",
  "text-amber-600",
  "text-emerald-600",
  "text-emerald-600",
];

/**
 * Live password strength meter with a per-rule checklist.
 *
 * Each rule is shown individually so the user can see what is still missing
 * rather than being rejected one rule at a time on submit.
 */
export function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;

  const { score, label, valid } = evaluatePassword(value);
  const passed = new Set(
    PASSWORD_CHECKS.filter((check) => check.test(value)).map((check) => check.id),
  );

  return (
    <div
      className="space-y-3 pt-1 animate-in fade-in-0 slide-in-from-top-2 duration-300 ease-out"
      data-testid="password-strength"
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ease-out ${
                i < Math.max(score, 1) && value ? BAR_COLOURS[score] : "bg-muted"
              }`}
            />
          ))}
        </div>
        <span
          key={label}
          className={`text-xs font-medium animate-in fade-in-0 duration-200 ${TEXT_COLOURS[score]}`}
          data-testid="password-strength-label"
        >
          {label}
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {PASSWORD_CHECKS.map((check, index) => {
          const ok = passed.has(check.id);
          return (
            <li
              key={check.id}
              style={{ animationDelay: `${index * 40}ms`, animationFillMode: "backwards" }}
              className={`flex items-center gap-1.5 text-xs animate-in fade-in-0 slide-in-from-left-2 duration-300 ease-out transition-colors ${
                ok ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {ok ? (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{check.label}</span>
            </li>
          );
        })}
      </ul>

      <p className="sr-only" aria-live="polite">
        {valid ? "Password meets all requirements" : "Password is missing some requirements"}
      </p>
    </div>
  );
}
