import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Bell,
  ChevronLeft,
  Mail,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  mailApi, MailApiError,
  type MailListItem, type MailSignature, type MailTemplate, type ThreadPayload,
} from "@/lib/mail-api";
import { useMailNotifications } from "@/hooks/useMailNotifications";
import { MailListEmpty, MailListRow, MailListSkeleton } from "@/components/mail/MailListRow";
import { MailThreadViewer } from "@/components/mail/MailThreadViewer";
import { MailComposer, type ComposeSeed } from "@/components/mail/MailComposer";
import { MailSettingsPanel } from "@/components/mail/MailSettingsPanel";
import { MailNotificationPrompt } from "@/components/mail/MailNotificationPrompt";

/**
 * ProjectHub Mail.
 *
 * Layout:
 *   desktop  — folder rail, message list and reader side by side
 *   tablet   — list and reader, rail collapses
 *   mobile   — one pane at a time, with the reader and composer full-screen
 *
 * The mobile flow is not a squeezed desktop: the list, the reader and the
 * settings panel each take the whole viewport and are swapped with a transition,
 * which is what makes the back button and full-screen reading sensible on a phone.
 *
 * Search is debounced and runs on the server. The list is paginated, and message
 * bodies are fetched only when a conversation is opened.
 */

type View = "inbox" | "starred" | "drafts" | "sent" | "trash";
type Filter = "unread" | "attachments" | "starred";

const VALID_VIEWS: View[] = ["inbox", "starred", "drafts", "sent", "trash"];
const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

const VIEW_TITLES: Record<View, string> = {
  inbox: "Inbox",
  starred: "Starred",
  drafts: "Drafts",
  sent: "Sent",
  trash: "Trash",
};

export default function MailPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const searchString = useSearch();

  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const view = (VALID_VIEWS.includes(params.get("view") as View) ? params.get("view") : "inbox") as View;
  const deepLinkThread = params.get("thread");

  const [items, setItems] = useState<MailListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<Filter, boolean>>({ unread: false, attachments: false, starred: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<MailListItem | null>(null);
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeSeed | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [signature, setSignature] = useState<MailSignature | null>(null);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [mobilePane, setMobilePane] = useState<"list" | "reader">("list");

  const { counts, notifications, refresh: refreshNotifications, markAllLocal } = useMailNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Debounced server-side search: typing does not query on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadList = useCallback(
    async (targetPage = page) => {
      setListLoading(true);
      try {
        const result = await mailApi.listMessages({
          view,
          search,
          page: targetPage,
          pageSize: PAGE_SIZE,
          unread: filters.unread,
          attachments: filters.attachments,
          starred: filters.starred,
        });
        setItems(result.rows);
        setSelectedIds([]);
      } catch (error) {
        if (error instanceof MailApiError && (error.status === 401 || error.status === 403)) {
          // The guard in AdminApp should prevent this; if a session lapses
          // mid-use, send the administrator back to sign in.
          setLocation("/login", { replace: true });
          return;
        }
        toast({ title: "Could not load mail", description: (error as Error).message, variant: "error" });
      } finally {
        setListLoading(false);
      }
    },
    [view, search, filters, page, toast, setLocation],
  );

  useEffect(() => {
    void loadList(page);
  }, [loadList, page]);

  // Settings and signature load once; they rarely change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sig, tpl] = await Promise.all([mailApi.signature(), mailApi.templates()]);
        if (!cancelled) {
          setSignature(sig);
          setTemplates(tpl);
        }
      } catch {
        /* a non-owner/admin session gets 403; nothing to show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openThread = useCallback(
    async (item: MailListItem) => {
      setSelectedMessage(item);
      setThreadLoading(true);
      setMobilePane("reader");
      try {
        const data = await mailApi.getThread(item.threadId);
        setThread(data);
        // Opening marks it read server-side; reflect that locally so the badge
        // and the row style update without a refetch.
        setItems((current) => current.map((row) => (row.threadId === item.threadId ? { ...row, isRead: true } : row)));
        markAllLocal();
      } catch (error) {
        toast({ title: "Could not open conversation", description: (error as Error).message, variant: "error" });
      } finally {
        setThreadLoading(false);
      }
    },
    [toast, markAllLocal],
  );

  // A deep link (a notification click, or a refresh) opens the target thread.
  useEffect(() => {
    if (!deepLinkThread || thread?.thread.id === deepLinkThread) return;
    const match = items.find((item) => item.threadId === deepLinkThread);
    if (match) {
      void openThread(match);
      return;
    }
    // The thread is not on the current page; load it directly.
    void (async () => {
      setThreadLoading(true);
      setMobilePane("reader");
      try {
        setThread(await mailApi.getThread(deepLinkThread));
      } catch {
        /* a stale link is not worth an error toast */
      } finally {
        setThreadLoading(false);
      }
    })();
    // `items` is intentionally not a dependency: this should react to the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkThread]);

  /** Keeps the URL in step with the open conversation so it stays shareable. */
  const setThreadInUrl = (threadId: string | null) => {
    const next = new URLSearchParams(searchString);
    if (threadId) next.set("thread", threadId);
    else next.delete("thread");
    const query = next.toString();
    setLocation(`${location}${query ? `?${query}` : ""}`, { replace: true });
  };

  /* ----------------------------------------------------------- row actions */

  const toggleStar = async (item: MailListItem) => {
    const next = !item.isStarred;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, isStarred: next } : row)));
    if (thread && thread.thread.id === item.threadId) {
      setThread({ ...thread, thread: { ...thread.thread, isStarred: next } });
    }
    try {
      await mailApi.updateMessage(item.id, { isStarred: next, thread: true });
    } catch {
      // Roll back so the UI never claims a change the server refused.
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, isStarred: !next } : row)));
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      await mailApi.deleteMessage(id);
      setItems((current) => current.filter((row) => row.id !== id));
      setThread(null);
      setSelectedMessage(null);
      setMobilePane("list");
      setThreadInUrl(null);
      toast({ title: "Moved to trash" });
    } catch (error) {
      toast({ title: "Could not delete", description: (error as Error).message, variant: "error" });
    }
  };

  const runBulk = async (action: string) => {
    if (!selectedIds.length) return;
    try {
      const result = await mailApi.bulk(selectedIds, action);
      toast({ title: `${result.updated} message${result.updated === 1 ? "" : "s"} updated` });
      setSelectedIds([]);
      await loadList(page);
    } catch (error) {
      toast({ title: "Bulk action failed", description: (error as Error).message, variant: "error" });
    }
  };

  const markNotificationsRead = async () => {
    try {
      await mailApi.markNotificationsRead();
      markAllLocal();
      await refreshNotifications();
    } catch {
      /* the badge will catch up on the next poll */
    }
  };

  /* ------------------------------------------------------------- composing */

  const startReply = (message: ThreadPayload["messages"][number], all: boolean) => {
    const self = new Set(["dev.projecthub.fie@gmail.com"]);
    const others = [...message.toEmails, ...message.ccEmails].filter((email) => !self.has(email));
    const recipient = message.fromEmail ? [message.fromEmail] : [];
    setCompose({
      mode: all ? "replyAll" : "reply",
      threadId: thread?.thread.id || null,
      replyToMessageId: message.id,
      to: recipient,
      cc: all ? others.filter((email) => email !== message.fromEmail) : [],
      subject: /^re:/i.test(message.subject || "") ? message.subject || "" : `Re: ${message.subject || ""}`,
      bodyHtml: buildQuotedBody(message),
    });
  };

  const startForward = (message: ThreadPayload["messages"][number]) => {
    setCompose({
      mode: "forward",
      threadId: thread?.thread.id || null,
      to: [],
      subject: /^fwd:/i.test(message.subject || "") ? message.subject || "" : `Fwd: ${message.subject || ""}`,
      bodyHtml: buildForwardBody(message),
    });
  };

  const startNew = () => setCompose({ mode: "new" });

  /** Opens a draft saved earlier, in the composer. */
  const openDraft = async (draftId: string) => {
    try {
      const draft = await mailApi.getDraft(draftId);
      setCompose({
        mode: (draft.mode as ComposeSeed["mode"]) || "new",
        threadId: draft.threadId,
        draftId: draft.id,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject || "",
        bodyHtml: draft.bodyHtml || "",
      });
    } catch (error) {
      toast({ title: "Could not open draft", description: (error as Error).message, variant: "error" });
    }
  };

  const afterSend = async () => {
    await loadList(page);
    await refreshNotifications();
  };

  const isDraftsView = view === "drafts";
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col bg-background">
      {/* Header: search, notifications, settings. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 md:px-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Mail</span>
        </div>

        <div className="relative ml-1 min-w-0 flex-1 md:max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search mail…"
            aria-label="Search mail"
            className="h-8 pl-8 pr-8 text-sm"
            data-testid="mail-search"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Filters">
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Filter</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(filters) as Filter[]).map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={filters[key]}
                onCheckedChange={(checked) => setFilters((current) => ({ ...current, [key]: checked === true }))}
                onSelect={(event) => event.preventDefault()}
              >
                {key === "unread" ? "Unread only" : key === "attachments" ? "With attachments" : "Starred only"}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void loadList(page)}
          aria-label="Refresh mailbox"
        >
          <RefreshCw className={cn("h-4 w-4", listLoading && "animate-spin")} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          onClick={() => {
            setNotificationsOpen((open) => !open);
            if (!notificationsOpen) void markNotificationsRead();
          }}
          aria-label={counts && counts.inbox > 0 ? `Notifications, ${counts.inbox} unread` : "Notifications"}
          aria-expanded={notificationsOpen}
        >
          <Bell className="h-4 w-4" />
          {counts && counts.inbox > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {counts.inbox > 9 ? "9+" : counts.inbox}
            </span>
          )}
        </Button>

        <Button
          variant={showSettings ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowSettings((open) => !open)}
          aria-label="Mail settings"
          aria-pressed={showSettings}
        >
          <Settings className={cn("h-4 w-4", showSettings && "rotate-90 transition-transform")} />
        </Button>
      </header>

      {notificationsOpen && (
        <MailNotificationPanel notifications={notifications} onClose={() => setNotificationsOpen(false)} />
      )}

      <MailNotificationPrompt onEnabled={() => void refreshNotifications()} />

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------- folder rail (desktop) */}
        <nav
          aria-label="Mail folders"
          className="hidden w-44 shrink-0 flex-col border-r border-border p-2 md:flex lg:w-52"
        >
          <Button size="sm" className="mb-2 w-full justify-start" onClick={startNew} data-testid="mail-compose">
            <PenLine className="mr-2 h-3.5 w-3.5" />
            Compose
          </Button>
          <Separator className="my-1" />
          <ul className="space-y-0.5">
            {(Object.keys(VIEW_TITLES) as View[]).map((key) => {
              const count = counts ? (key === "inbox" ? counts.inbox : key === "starred" ? counts.starred : key === "drafts" ? counts.drafts : 0) : 0;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocation(`/mail?view=${key}`);
                      setThreadInUrl(null);
                      setThread(null);
                      setSelectedMessage(null);
                      setMobilePane("list");
                    }}
                    aria-current={view === key ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      view === key ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{VIEW_TITLES[key]}</span>
                    {count > 0 && (
                      <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ------------------------------------------------------- message list */}
        <section
          aria-label={`${VIEW_TITLES[view]} messages`}
          className={cn(
            "flex min-w-0 flex-col border-r border-border",
            // Mobile: full width, hidden once a reader is open.
            "w-full md:w-[340px] md:shrink-0 lg:w-[380px]",
            mobilePane === "reader" && "hidden md:flex",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])}
                aria-label="Select all messages on this page"
                className="h-3.5 w-3.5 rounded border-border"
              />
              <span className="text-sm font-medium">{VIEW_TITLES[view]}</span>
              {counts && view === "inbox" && counts.inbox > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                  {counts.inbox}
                </span>
              )}
            </div>

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{selectedIds.length}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void runBulk("read")} aria-label="Mark as read">
                  ✓
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void runBulk("star")} aria-label="Star selected">
                  <Star className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => void runBulk("trash")} aria-label="Move selected to trash">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Messages">
            {listLoading ? (
              <MailListSkeleton />
            ) : items.length === 0 ? (
              <MailListEmpty
                message={
                  search
                    ? `No messages match "${search}"`
                    : view === "drafts"
                      ? "No drafts saved"
                      : `${VIEW_TITLES[view]} is empty`
                }
              />
            ) : isDraftsView ? (
              <DraftList onOpen={(id) => void openDraft(id)} onChanged={() => void loadList(page)} />
            ) : (
              items.map((item) => (
                <MailListRow
                  key={item.id}
                  item={item}
                  selected={selectedMessage?.threadId === item.threadId}
                  checked={selectedIds.includes(item.id)}
                  onSelect={(row) => {
                    setThreadInUrl(row.threadId);
                    void openThread(row);
                  }}
                  onToggleCheck={(id, checked) =>
                    setSelectedIds((current) =>
                      checked
                        ? (current.includes(id) ? current : [...current, id])
                        : current.filter((value) => value !== id),
                    )
                  }
                  onToggleStar={(row) => void toggleStar(row)}
                />
              ))
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Button variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Newer
            </Button>
            <span>Page {page}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              disabled={items.length < PAGE_SIZE}
              onClick={() => setPage((current) => current + 1)}
            >
              Older
            </Button>
          </div>
        </section>

        {/* ----------------------------------------------------- reader / settings */}
        <section
          aria-label="Message content"
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            mobilePane === "list" && !showSettings && "hidden md:flex",
          )}
        >
          {showSettings ? (
            <MailSettingsPanel onTemplatesChanged={() => void mailApi.templates().then(setTemplates).catch(() => {})} />
          ) : thread ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 md:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    setMobilePane("list");
                    setThreadInUrl(null);
                  }}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
                </Button>
              </div>
              <MailThreadViewer
                thread={thread}
                isStarred={thread.thread.isStarred}
                loading={threadLoading}
                onReply={startReply}
                onForward={startForward}
                onDelete={() => {
                  if (selectedMessage) void deleteMessage(selectedMessage.id);
                }}
                onToggleStar={() => selectedMessage && void toggleStar(selectedMessage)}
              />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Mail className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm font-medium">No conversation selected</p>
              <p className="text-xs text-muted-foreground">
                Choose a message to read it, or start a new one.
              </p>
              <Button size="sm" variant="outline" className="mt-2 hidden md:inline-flex" onClick={startNew}>
                <PenLine className="mr-1.5 h-3.5 w-3.5" /> Compose
              </Button>
            </div>
          )}
        </section>
      </div>

      {/* Compose: a dialog on the right for desktop, full-screen on mobile. */}
      {compose && (
        <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-background/60 p-0 backdrop-blur-sm md:items-end md:justify-end md:p-4">
          <div className="flex w-full flex-col overflow-hidden border border-border bg-card shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200 md:h-[85vh] md:max-w-2xl md:rounded-xl">
            <MailComposer
              seed={compose}
              signature={signature}
              templates={templates}
              onClose={() => setCompose(null)}
              onSent={() => void afterSend()}
              onDraftSaved={() => void loadList(page)}
              className="flex min-h-0 flex-1 flex-col"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ draft list */

function DraftList({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Array<{ id: string; subject: string | null; to: string[]; updatedAt: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await mailApi.drafts();
        if (!cancelled) setDrafts(result);
      } catch {
        /* nothing to show */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <MailListSkeleton />;
  if (drafts.length === 0) return <MailListEmpty message="No drafts saved" />;

  return (
    <div>
      {drafts.map((draft) => (
        <div key={draft.id} className="group flex items-center gap-2 border-b border-border px-3 py-2.5 hover:bg-accent/60">
          <button type="button" onClick={() => onOpen(draft.id)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium">{draft.subject || "(no subject)"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.to.length ? `To: ${draft.to.join(", ")}` : "No recipient"}
            </p>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            aria-label="Discard draft"
            onClick={async () => {
              try {
                await mailApi.deleteDraft(draft.id);
                setDrafts((current) => current.filter((item) => item.id !== draft.id));
                onChanged();
              } catch (error) {
                toast({ title: "Could not discard draft", description: (error as Error).message, variant: "error" });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------- notification popover */

function MailNotificationPanel({ notifications, onClose }: { notifications: Array<{ id: string; title: string | null; preview: string | null; threadId: string | null }>; onClose: () => void }) {
  const [, setLocation] = useLocation();

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="border-b border-border bg-card px-3 py-2 md:px-4"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notifications</span>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
      {notifications.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">You're all caught up.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {notifications.slice(0, 10).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  if (item.threadId) setLocation(`/mail?view=inbox&thread=${item.threadId}`);
                  onClose();
                }}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <p className="truncate text-sm">{item.title || "New email"}</p>
                <p className="truncate text-xs text-muted-foreground">{item.preview}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ quote helpers */

/** Builds the quoted body a reply starts from. */
function buildQuotedBody(message: ThreadPayload["messages"][number]) {
  const original = message.html || (message.text ? escapeForQuote(message.text) : "");
  return `<p><br /></p><p style="font-size:12px;color:#64748b;">On ${new Date(message.date).toLocaleString()}, ${escapeForQuote(
    message.fromName || message.fromEmail || "someone",
  )} wrote:</p><blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #e2e8f0;color:#475569;">${original}</blockquote>`;
}

/** Builds a forwarded body, with the original header block. */
function buildForwardBody(message: ThreadPayload["messages"][number]) {
  const original = message.html || (message.text ? escapeForQuote(message.text) : "");
  return `<p><br /></p><p style="font-size:12px;color:#64748b;">---------- Forwarded message ----------<br />From: ${escapeForQuote(
    message.fromEmail || "",
  )}<br />Date: ${new Date(message.date).toLocaleString()}<br />Subject: ${escapeForQuote(
    message.subject || "",
  )}<br />To: ${escapeForQuote(message.toEmails.join(", "))}</p>${original}`;
}

function escapeForQuote(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
