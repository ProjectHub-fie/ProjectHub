import { memo } from "react";
import { ArrowUpRight, Loader2, Paperclip, Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { MailListItem } from "@/lib/mail-api";

/**
 * A single row in the message list.
 *
 * Unread state is carried by weight and colour rather than a coloured dot alone,
 * so it reads correctly with a screen reader and in a monochrome theme.
 */
type Props = {
  item: MailListItem;
  selected: boolean;
  checked: boolean;
  onSelect: (item: MailListItem) => void;
  onToggleCheck: (id: string, checked: boolean) => void;
  onToggleStar: (item: MailListItem) => void;
};

function initials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** Formats a timestamp the way a mail list does: time today, date otherwise. */
function formatListDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function MailListRowBase({ item, selected, checked, onSelect, onToggleCheck, onToggleStar }: Props) {
  const displayName = item.direction === "outbound"
    ? `To: ${item.toEmails[0] || item.participants[0] || "recipient"}`
    : item.fromName || item.fromEmail || "Unknown sender";

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={cn(
        "group relative flex cursor-pointer gap-3 border-b border-border px-3 py-2.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
      data-testid="mail-list-row"
    >
      {/* Unread indicator: a slim rail, which is quieter than a filled dot. */}
      {!item.isRead && <span aria-hidden="true" className="absolute left-0 top-0 h-full w-0.5 bg-primary" />}

      <div className="flex items-center pt-0.5" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggleCheck(item.id, value === true)}
          aria-label={`Select message from ${displayName}`}
        />
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
          item.isRead ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        {initials(item.fromName, item.fromEmail)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-sm", item.isRead ? "text-foreground" : "font-semibold text-foreground")}>
            {displayName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatListDate(item.date)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("truncate text-sm", item.isRead ? "text-foreground/80" : "font-medium text-foreground")}>
            {item.subject || "(no subject)"}
          </span>
          {item.messageCount > 1 && (
            <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              {item.messageCount}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{item.snippet || "No preview available"}</span>
          {item.hasAttachments && (
            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has attachment" />
          )}
          {item.provider === "mailjet" && (
            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Sent via Mailjet" />
          )}
        </div>
      </div>

      <button
        type="button"
        aria-label={item.isStarred ? "Remove star" : "Star this conversation"}
        aria-pressed={item.isStarred}
        onClick={(event) => {
          event.stopPropagation();
          onToggleStar(item);
        }}
        className={cn(
          "mt-0.5 h-6 w-6 shrink-0 rounded transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          item.isStarred ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
        )}
      >
        <Star className={cn("mx-auto h-4 w-4", item.isStarred && "fill-current")} />
      </button>
    </div>
  );
}

export const MailListRow = memo(MailListRowBase);

export function MailListSkeleton() {
  return (
    <div className="space-y-0" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex gap-3 border-b border-border px-3 py-2.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MailListEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
        <Loader2 className="hidden" />
        <span aria-hidden="true" className="text-lg">📭</span>
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="text-xs text-muted-foreground">Messages will appear here as they arrive.</p>
    </div>
  );
}

export { formatListDate };
