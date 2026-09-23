import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Forward,
  Loader2,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { mailApi, type ThreadPayload } from "@/lib/mail-api";

/**
 * Thread reader.
 *
 * The newest message is expanded and earlier ones collapse, which is the
 * behaviour a business mail client is expected to have for a long conversation.
 *
 * HTML is rendered with `dangerouslySetInnerHTML` — that is unavoidable for a
 * mail reader — but only ever with the server-sanitised `html` field. The server
 * strips scripts, event handlers and unsafe URL schemes before the value is sent,
 * so no untrusted markup reaches this component.
 */
type Props = {
  thread: ThreadPayload;
  isStarred: boolean;
  onReply: (message: ThreadPayload["messages"][number], all: boolean) => void;
  onForward: (message: ThreadPayload["messages"][number]) => void;
  onDelete: () => void;
  onToggleStar: () => void;
  loading?: boolean;
};

function formatFullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function MailThreadViewer({ thread, isStarred, onReply, onForward, onDelete, onToggleStar, loading }: Props) {
  const messages = thread.messages;
  // Everything but the newest message starts collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    messages.forEach((message, index) => {
      map[message.id] = index === messages.length - 1;
    });
    return map;
  });

  const newest = messages[messages.length - 1];
  const latest = useMemo(() => newest, [newest]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">This conversation has no messages.</p>
      </div>
    );
  }

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label="Email conversation">
      {/* Header: subject, participants, and the action bar. */}
      <header className="shrink-0 border-b border-border px-4 py-3 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold md:text-lg">
              {thread.thread.subject || latest.subject || "(no subject)"}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="truncate">
                {thread.thread.participants.length
                  ? thread.thread.participants.join(", ")
                  : latest.fromEmail}
              </span>
              {thread.thread.messageCount > 1 && (
                <Badge variant="secondary" className="ml-1 h-5 text-[10px]">
                  {thread.thread.messageCount} messages
                </Badge>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleStar}
              aria-label={isStarred ? "Remove star" : "Star conversation"}
              aria-pressed={isStarred}
              className={cn("h-8 w-8", isStarred && "text-amber-500")}
            >
              <Star className={cn("h-4 w-4", isStarred && "fill-current")} />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                  <span className="text-lg leading-none">⋮</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onReply(latest, true)}>
                  <ReplyAll className="mr-2 h-4 w-4" /> Reply all
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onForward(latest)}>
                  <Forward className="mr-2 h-4 w-4" /> Forward
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Move to trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onReply(latest, false)} data-testid="mail-reply">
            <Reply className="mr-1.5 h-3.5 w-3.5" /> Reply
          </Button>
          <Button size="sm" variant="outline" onClick={() => onReply(latest, true)} data-testid="mail-reply-all">
            <ReplyAll className="mr-1.5 h-3.5 w-3.5" /> Reply All
          </Button>
          <Button size="sm" variant="outline" onClick={() => onForward(latest)} data-testid="mail-forward">
            <Forward className="mr-1.5 h-3.5 w-3.5" /> Forward
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.map((message, index) => {
          const isOpen = expanded[message.id] ?? index === messages.length - 1;
          const isOwn = message.direction === "outbound";

          return (
            <section key={message.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => setExpanded((current) => ({ ...current, [message.id]: !isOpen }))}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !isOpen && index !== messages.length - 1 && "bg-muted/30",
                )}
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                    isOwn ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {initials(message.fromName, message.fromEmail)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {message.fromName || message.fromEmail || "Unknown"}
                      {isOwn && <span className="ml-2 text-xs font-normal text-muted-foreground">(sent)</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatFullDate(message.date)}</span>
                  </div>
                  {!isOpen && <p className="truncate text-xs text-muted-foreground">{message.snippet}</p>}
                </div>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 md:px-5">
                  <dl className="mb-3 space-y-0.5 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    <div className="flex gap-2">
                      <dt className="w-10 shrink-0">From</dt>
                      <dd className="truncate text-foreground">
                        {message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-10 shrink-0">To</dt>
                      <dd className="truncate text-foreground">{message.toEmails.join(", ") || "—"}</dd>
                    </div>
                    {message.ccEmails?.length > 0 && (
                      <div className="flex gap-2">
                        <dt className="w-10 shrink-0">CC</dt>
                        <dd className="truncate text-foreground">{message.ccEmails.join(", ")}</dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="w-10 shrink-0">Date</dt>
                      <dd className="text-foreground">{formatFullDate(message.date)}</dd>
                    </div>
                    {message.provider && (
                      <div className="flex gap-2">
                        <dt className="w-10 shrink-0">Via</dt>
                        <dd className="text-foreground">{message.provider === "mailjet" ? "Mailjet" : "Resend"}</dd>
                      </div>
                    )}
                  </dl>

                  {/*
                    Sanitised server-side. `message.html` has already passed through
                    sanitizeEmailHtml, which drops scripts, event handlers and unsafe
                    URL schemes; `message.text` is rendered as escaped text.
                  */}
                  {message.html ? (
                    <div
                      className="prose prose-sm max-w-none break-words text-sm text-foreground [&_img]:max-w-full [&_img]:rounded [&_table]:w-full [&_table]:border-collapse"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: message.html }}
                      data-testid="mail-message-body"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground" data-testid="mail-message-body">
                      {message.text || "This message has no body."}
                    </p>
                  )}

                  {message.attachments?.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {message.attachments.map((file) => (
                        <li key={file.id}>
                          <a
                            href={mailApi.attachmentUrl(file.id)}
                            className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            // Downloads never navigate the SPA away.
                            download={file.filename}
                            rel="noopener noreferrer"
                          >
                            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            <span className="font-medium">{file.filename}</span>
                            {file.sizeBytes ? <span className="text-muted-foreground">{formatBytes(file.sizeBytes)}</span> : null}
                            <Download className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}
