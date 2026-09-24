import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Rich-text composer for business email.
 *
 * Built on `contentEditable` with `execCommand`. `execCommand` is deprecated but
 * it is the only formatting API every browser still implements without pulling in
 * an editor dependency (and this repository deliberately carries no rich-text
 * package). The output is HTML, which the server wraps in the branded shell and
 * Mailjet sends — so nothing here needs to be a React-controlled value.
 *
 * Reusable blocks insert real email structure: a header, a greeting, a CTA
 * button, a divider and a footer, each as inline-styled markup that survives
 * Gmail and Outlook.
 */

type EditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

const FONT_SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "15px" },
  { label: "Large", value: "18px" },
  { label: "Heading", value: "24px" },
];

const TEXT_COLORS = ["#0f172a", "#334155", "#1d4ed8", "#047857", "#b91c1c", "#7c3aed", "#b45309"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#ffffff"];

/**
 * Email blocks.
 *
 * Inline styles only: mail clients strip `<style>` blocks, so a class-based block
 * would arrive unstyled in the recipient's inbox.
 */
const EMAIL_BLOCKS: Array<{ label: string; description: string; html: string }> = [
  {
    label: "Header",
    description: "Branded title bar",
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;"><tr><td style="background:#0f172a;border-radius:10px;padding:18px 22px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;">&lt;Project<span style="color:#10b981;">Hub</span>/&gt;</td></tr></table><p><br /></p>`,
  },
  {
    label: "Logo",
    description: "Centered logo image",
    html: `<p style="text-align:center;"><img src="https://projecthub-me.vercel.app/public/Project.jpg" alt="ProjectHub" width="120" style="max-width:160px;height:auto;border-radius:8px;" /></p>`,
  },
  {
    label: "Greeting",
    description: "Salutation line",
    html: `<p>Hello,</p>`,
  },
  {
    label: "Text section",
    description: "Heading with a paragraph",
    html: `<h3 style="margin:0 0 8px 0;font-size:17px;color:#0f172a;">Section heading</h3><p style="margin:0 0 16px 0;">Write your content here.</p>`,
  },
  {
    label: "Image",
    description: "Inline image placeholder",
    html: `<p style="text-align:center;"><img src="https://placehold.co/560x220?text=ProjectHub" alt="" style="max-width:100%;height:auto;border-radius:8px;" /></p>`,
  },
  {
    label: "CTA button",
    description: "Call-to-action link",
    html: `<p style="text-align:center;margin:22px 0;"><a href="https://projecthub-me.vercel.app" style="display:inline-block;padding:12px 26px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">Get started</a></p>`,
  },
  {
    label: "Divider",
    description: "Horizontal rule",
    html: `<hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0;" />`,
  },
  {
    label: "Spacer",
    description: "Vertical space",
    html: `<p style="height:24px;margin:0;">&nbsp;</p>`,
  },
  {
    label: "Footer",
    description: "Closing + small print",
    html: `<p style="margin:26px 0 0 0;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:14px;">ProjectHub &middot; <a href="https://projecthub-me.vercel.app" style="color:#2563eb;text-decoration:none;">projecthub-me.vercel.app</a></p>`,
  },
  {
    label: "Signature",
    description: "Sign-off block",
    html: `<p style="margin-top:26px;">Best regards,<br /><strong>Your name</strong><br />ProjectHub</p>`,
  },
];

/** Escapes text placed inside an attribute or between tags in inserted markup. */
function escapeLinkPart(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function MailEditor({ value, onChange, placeholder = "Write your message…", className }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // The last HTML this component emitted. Used to tell our own change apart from
  // an external one (loading a temporary template), so typing does not fight the
  // parent's state.
  const lastEmitted = useRef(value);
  // The caret/selection inside the editor. `window.prompt` moves focus to the
  // dialog, and a `createLink` issued afterwards has nothing to act on, so the
  // range is captured while the document still owns it and restored before the
  // link is applied.
  const savedRange = useRef<Range | null>(null);
  const [isEmpty, setIsEmpty] = useState(!value);

  useEffect(() => {
    const remember = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      // Only a range inside the editor is meaningful here; anything else (the
      // toolbar, the page) is ignored rather than clobbering the saved one.
      if (editor.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    if (value !== lastEmitted.current) {
      element.innerHTML = value || "";
      lastEmitted.current = value;
      setIsEmpty(!element.textContent?.trim());
    }
  }, [value]);

  const emit = useCallback(() => {
    const element = editorRef.current;
    if (!element) return;
    const html = element.innerHTML;
    lastEmitted.current = html;
    setIsEmpty(!element.textContent?.trim());
    onChange(html);
  }, [onChange]);

  // `execCommand` keeps focus in the editor, so the current selection is what
  // gets formatted without any manual range bookkeeping.
  const command = useCallback(
    (name: string, argument?: string) => {
      editorRef.current?.focus();
      document.execCommand(name, false, argument);
      emit();
    },
    [emit],
  );

  const insertHtml = useCallback(
    (html: string) => {
      editorRef.current?.focus();
      document.execCommand("insertHTML", false, html);
      emit();
    },
    [emit],
  );

  // Restores the range captured before a dialog stole focus. `execCommand`
  // operates on the live selection, so without this `createLink` has no target.
  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    editor.focus();
    const range = savedRange.current;
    if (!range) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const promptForLink = () => {
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    // A `javascript:` link in an outbound email is a phishing payload, so an
    // obviously unsafe scheme is refused at the point of entry.
    if (/^\s*(javascript|data|vbscript):/i.test(url)) {
      window.alert("That link type is not allowed.");
      return;
    }

    // A selection was captured, so wrap the highlighted words in the link.
    restoreSelection();
    const hasSelectedText = Boolean(window.getSelection()?.toString());
    if (hasSelectedText) {
      document.execCommand("createLink", false, url);
      emit();
      return;
    }

    // Nothing selected: `createLink` would be a no-op and the toolbar button
    // would appear broken. Insert an anchor whose text is the URL instead, so a
    // link always lands in the message.
    const href = escapeLinkPart(url);
    insertHtml(
      `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${href}</a>`,
    );
  };

  const promptForImage = () => {
    const url = window.prompt("Image URL", "https://");
    if (!url || !/^https?:\/\//i.test(url)) return;
    restoreSelection();
    insertHtml(`<img src="${escapeLinkPart(url)}" alt="" style="max-width:100%;height:auto;border-radius:8px;" />`);
  };

  const ToolbarButton = ({
    label,
    onClick,
    active,
    children,
  }: {
    label: string;
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      // `onMouseDown` + preventDefault keeps the selection in the editor; a plain
      // click would move focus to the button and the format would be lost.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        role="toolbar"
        aria-label="Email formatting"
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5"
      >
        <ToolbarButton label="Undo" onClick={() => command("undo")}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => command("redo")}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Text style"
            >
              Style
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Headings</DropdownMenuLabel>
            {[1, 2, 3].map((level) => (
              <DropdownMenuItem key={level} onClick={() => command("formatBlock", `<h${level}>`)}>
                Heading {level}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Blocks</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => command("formatBlock", "<p>")}>Paragraph</DropdownMenuItem>
            <DropdownMenuItem onClick={() => command("formatBlock", "<blockquote>")}>Quote</DropdownMenuItem>
            <DropdownMenuItem onClick={() => command("formatBlock", "<pre>")}>Code block</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <ToolbarButton label="Bold" onClick={() => command("bold")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => command("italic")}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Underline" onClick={() => command("underline")}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" onClick={() => command("strikeThrough")}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Font size"
            >
              <span className="text-xs font-medium">A</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {FONT_SIZES.map((size) => (
              <DropdownMenuItem key={size.value} onClick={() => command("fontSize", size.value === "13px" ? "2" : size.value === "15px" ? "3" : size.value === "18px" ? "5" : "6")}>
                {size.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Text color"
            >
              <Palette className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Text colour</p>
            <div className="flex gap-1.5">
              {TEXT_COLORS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={`Text colour ${colour}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => command("foreColor", colour)}
                  className="h-6 w-6 rounded border border-border"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Highlight"
            >
              <Highlighter className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Highlight</p>
            <div className="flex gap-1.5">
              {HIGHLIGHTS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={`Highlight ${colour}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => command("hiliteColor", colour)}
                  className="h-6 w-6 rounded border border-border"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <ToolbarButton label="Align left" onClick={() => command("justifyLeft")}>
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Align center" onClick={() => command("justifyCenter")}>
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Align right" onClick={() => command("justifyRight")}>
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <ToolbarButton label="Bullet list" onClick={() => command("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => command("insertOrderedList")}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Quote" onClick={() => command("formatBlock", "<blockquote>")}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Code" onClick={() => command("formatBlock", "<pre>")}>
          <Code2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Divider" onClick={() => insertHtml('<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />')}>
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <ToolbarButton label="Insert link" onClick={promptForLink}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Insert image" onClick={promptForImage}>
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Insert block
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Email blocks</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {EMAIL_BLOCKS.map((block) => (
                <DropdownMenuItem key={block.label} onClick={() => insertHtml(block.html)} className="flex-col items-start gap-0.5">
                  <span className="text-sm">{block.label}</span>
                  <span className="text-xs text-muted-foreground">{block.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {isEmpty && (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-3 text-sm text-muted-foreground"
          >
            {placeholder}
          </p>
        )}
        <div
          ref={editorRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Message body"
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          className="min-h-full w-full px-4 py-3 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:text-base [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          data-testid="mail-editor-body"
        />
      </div>
    </div>
  );
}
