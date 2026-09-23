import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Paperclip, Send, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MailEditor } from "@/components/mail/MailEditor";
import { mailApi, MailApiError, type MailSignature, type MailTemplate, type OutgoingAttachment } from "@/lib/mail-api";

/**
 * The compose window.
 *
 * Responsibilities that matter for correctness:
 *
 *   - Recipient validation happens on blur and on send, using the same pattern
 *     the backend enforces. The form is not the security boundary, so a bad
 *     address is rejected server-side too.
 *   - Drafts autosave on a debounce (1.2 s after the last edit) and never on a
 *     keystroke, so typing does not produce a database write per character.
 *   - Sending is guarded by a ref, not only by `disabled`: a double-click can
 *     deliver two click events before React re-renders, and one of them would
 *     get through. The ref closes that window.
 */

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export type ComposeSeed = {
  mode: ComposeMode;
  threadId?: string | null;
  replyToMessageId?: string | null;
  draftId?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyHtml?: string;
};

type Props = {
  seed: ComposeSeed;
  signature: MailSignature | null;
  templates: MailTemplate[];
  onClose: () => void;
  onSent: () => void;
  onDraftSaved?: () => void;
  className?: string;
};

const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Reads a file into a base64 payload, rejecting an oversized file up front. */
function readFileAsBase64(file: File): Promise<OutgoingAttachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(`${file.name} is larger than the 5 MB limit`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Content = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      resolve({ filename: file.name, contentType: file.type || "application/octet-stream", base64Content, sizeBytes: file.size });
    };
    reader.readAsDataURL(file);
  });
}

export function MailComposer({ seed, signature, templates, onClose, onSent, onDraftSaved, className }: Props) {
  const { toast } = useToast();

  const [to, setTo] = useState(seed.to?.join(", ") || "");
  const [cc, setCc] = useState(seed.cc?.join(", ") || "");
  const [bcc, setBcc] = useState(seed.bcc?.join(", ") || "");
  const [showCc, setShowCc] = useState(Boolean(seed.cc?.length));
  const [showBcc, setShowBcc] = useState(Boolean(seed.bcc?.length));
  const [subject, setSubject] = useState(seed.subject || "");
  const [body, setBody] = useState(seed.bodyHtml || "");
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([]);
  const [includeSignature, setIncludeSignature] = useState(Boolean(signature && signature.enabled !== false));
  const [sending, setSending] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(seed.draftId || null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: it must flip synchronously to close the double-click race.
  const sendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Skip the first autosave so opening the composer does not immediately write.
  const firstAutosave = useRef(true);

  // Deduplicated without spread/Set iteration: the root tsconfig sets no target,
  // so iterating a Set is rejected there.
  const parseList = (value: string) => {
    const cleaned = value.split(/[,;]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    return cleaned.filter((item, index) => cleaned.indexOf(item) === index);
  };

  const invalid = useMemo(() => {
    const all = [...parseList(to), ...parseList(cc), ...parseList(bcc)];
    return all.filter((email) => !EMAIL_PATTERN.test(email));
  }, [to, cc, bcc]);

  const totalAttachmentBytes = attachments.reduce((sum, file) => sum + file.sizeBytes, 0);

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    if (template.subject) setSubject((current) => current || template.subject!);
    setBody((current) => `${current}${current ? "<p><br /></p>" : ""}${template.bodyHtml || ""}`);
  };

  /* ------------------------------------------------------------- autosave */

  const saveDraft = useCallback(
    async (silent: boolean) => {
      // Nothing worth storing yet.
      if (!to.trim() && !subject.trim() && !body.trim()) return;
      setSaveState("saving");
      try {
        const result = await mailApi.saveDraft({
          id: draftId,
          threadId: seed.threadId || null,
          mode: seed.mode,
          to: parseList(to),
          cc: parseList(cc),
          bcc: parseList(bcc),
          subject,
          bodyHtml: body,
          attachments: attachments.map(({ filename, contentType, sizeBytes }) => ({ filename, contentType, sizeBytes })),
        });
        setDraftId(result.id);
        setSaveState("saved");
        onDraftSaved?.();
        if (!silent) toast({ title: "Draft saved", variant: "success" });
      } catch {
        setSaveState("idle");
        if (!silent) toast({ title: "Could not save draft", variant: "error" });
      }
    },
    // `attachments` metadata is included so a re-save keeps the file list.
    [draftId, seed.threadId, seed.mode, to, cc, bcc, subject, body, attachments, onDraftSaved, toast],
  );

  useEffect(() => {
    if (firstAutosave.current) {
      firstAutosave.current = false;
      return;
    }
    if (sendingRef.current) return;

    // Debounced: one write per pause, never one per keystroke.
    const timer = setTimeout(() => void saveDraft(true), 1200);
    return () => clearTimeout(timer);
  }, [to, cc, bcc, subject, body, saveDraft]);

  /* ----------------------------------------------------------- attachments */

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: OutgoingAttachment[] = [];
    for (const file of Array.from(files)) {
      try {
        next.push(await readFileAsBase64(file));
      } catch (fileError: any) {
        setError(fileError.message);
      }
    }
    const combined = [...attachments, ...next];
    const total = combined.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (total > MAX_TOTAL_BYTES) {
      setError("Attachments exceed the 10 MB total limit");
      return;
    }
    setAttachments(combined);
  };

  /* ------------------------------------------------------------------ send */

  const handleSend = async () => {
    if (sendingRef.current) return; // A second click before re-render.

    const recipients = parseList(to);
    if (!recipients.length) {
      setError("Add at least one recipient");
      return;
    }
    if (invalid.length) {
      setError(`Invalid email address: ${invalid[0]}`);
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject");
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);

    try {
      const result = await mailApi.send({
        to: recipients,
        cc: parseList(cc),
        bcc: parseList(bcc),
        subject,
        bodyHtml: body,
        mode: seed.mode,
        threadId: seed.threadId || null,
        replyToMessageId: seed.replyToMessageId || null,
        draftId,
        attachmentPayload: attachments,
        includeSignature,
      });

      toast({ title: "Message sent", description: `Delivered to ${recipients.join(", ")}`, variant: "success" });
      onSent();
      onClose();
      void result;
    } catch (sendError) {
      // A 4xx/5xx here means Mailjet did not queue the message, so nothing was
      // sent and the composer stays open with the error visible.
      const message = sendError instanceof MailApiError ? sendError.message : "Failed to send message";
      setError(message);
      toast({ title: "Message not sent", description: message, variant: "error" });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleDiscard = async () => {
    if (draftId) {
      try {
        await mailApi.deleteDraft(draftId);
        onDraftSaved?.();
      } catch {
        /* the composer closes either way */
      }
    }
    onClose();
  };

  return (
    <div
      className={className}
      role="dialog"
      aria-label="Compose message"
      aria-modal="false"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          {seed.mode === "reply" ? "Reply" : seed.mode === "replyAll" ? "Reply all" : seed.mode === "forward" ? "Forward" : "New Message"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close composer"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <label htmlFor="compose-to" className="w-12 shrink-0 text-xs text-muted-foreground">To</label>
          <Input
            id="compose-to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="name@company.com, another@company.com"
            className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            aria-invalid={invalid.length > 0}
            data-testid="compose-to"
          />
          {!showCc || !showBcc ? (
            <div className="flex shrink-0 gap-1">
              {!showCc && (
                <button type="button" onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-foreground">
                  CC
                </button>
              )}
              {!showBcc && (
                <button type="button" onClick={() => setShowBcc(true)} className="text-xs text-muted-foreground hover:text-foreground">
                  BCC
                </button>
              )}
            </div>
          ) : null}
        </div>

        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="compose-cc" className="w-12 shrink-0 text-xs text-muted-foreground">CC</label>
            <Input
              id="compose-cc"
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              data-testid="compose-cc"
            />
          </div>
        )}

        {showBcc && (
          <div className="flex items-center gap-2">
            <label htmlFor="compose-bcc" className="w-12 shrink-0 text-xs text-muted-foreground">BCC</label>
            <Input
              id="compose-bcc"
              value={bcc}
              onChange={(event) => setBcc(event.target.value)}
              className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              data-testid="compose-bcc"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="compose-subject" className="w-12 shrink-0 text-xs text-muted-foreground">Subject</label>
          <Input
            id="compose-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            data-testid="compose-subject"
          />
        </div>
      </div>

      <MailEditor value={body} onChange={setBody} className="min-h-0 flex-1" />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
          {attachments.map((file, index) => (
            <Badge key={`${file.filename}-${index}`} variant="secondary" className="gap-1.5 py-1">
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <span className="max-w-[180px] truncate">{file.filename}</span>
              <span className="text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                className="ml-0.5 rounded hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" onClick={handleSend} disabled={sending} data-testid="compose-send">
          {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          {sending ? "Sending…" : "Send"}
        </Button>

        <Button size="sm" variant="outline" onClick={() => void saveDraft(false)} disabled={sending}>
          Save Draft
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label="Attach files"
        >
          <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          Attach
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
          tabIndex={-1}
          aria-hidden="true"
        />

        {templates.length > 0 && (
          <Select onValueChange={applyTemplate}>
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Insert template">
              <SelectValue placeholder="Template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {signature && signature.enabled !== false && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeSignature}
              onChange={(event) => setIncludeSignature(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Signature
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          {totalAttachmentBytes > 0 && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              <Users className="mr-1 inline h-3 w-3" />
              {formatBytes(totalAttachmentBytes)}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={handleDiscard} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };
