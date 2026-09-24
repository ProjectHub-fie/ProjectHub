/**
 * Mail UI invariants.
 *
 * Like the other portal-UI tests, there is no DOM renderer installed, so these
 * read the source and assert the behaviours a real defect would break: the
 * responsive panes, the notification permission flow, and the guarantee that no
 * provider credential can reach the browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the mail workspace is a three-pane layout that collapses for smaller screens', () => {
  const page = source('client/src/pages/mail-page.tsx');

  // Desktop: folder rail, list, reader. Tablet: the rail is hidden and the list
  // keeps a fixed width. Mobile: one pane at a time.
  assert.match(page, /hidden w-44 shrink-0 flex-col border-r border-border p-2 md:flex/,
    'the folder rail must be a desktop-only column');
  assert.match(page, /w-full md:w-\[340px\] md:shrink-0 lg:w-\[380px\]/,
    'the message list must be full width on mobile and fixed on larger screens');
  assert.match(page, /mobilePane === "reader" && "hidden md:flex"/,
    'the list must be replaced by the reader on mobile, not squeezed beside it');
  assert.match(page, /mobilePane === "list" && !showSettings && "hidden md:flex"/,
    'the reader must take the full screen on mobile');
});

test('mobile navigation is a real transition, not a shrunken desktop', () => {
  const page = source('client/src/pages/mail-page.tsx');

  assert.match(page, /setMobilePane\("reader"\)/, 'opening a message switches to the reader pane');
  assert.match(page, /setMobilePane\("list"\)/, 'a back control returns to the list pane');
  // The composer is full-screen on mobile and a panel on desktop.
  assert.match(page, /fixed inset-0 z-40 flex items-stretch justify-center/, 'the composer covers the viewport on mobile');
  assert.match(page, /md:h-\[85vh\] md:max-w-2xl md:rounded-xl/, 'the composer becomes a panel on desktop');
});

test('the composer is reachable from the sidebar and the header', () => {
  const page = source('client/src/pages/mail-page.tsx');
  assert.match(page, /data-testid="mail-compose"/, 'a Compose action must exist');
  assert.match(page, /onClick=\{startNew\}/, 'Compose opens a new message');
});

test('search is debounced and runs server-side', () => {
  const page = source('client/src/pages/mail-page.tsx');
  assert.match(page, /const SEARCH_DEBOUNCE_MS = 350/, 'a debounce interval must be defined');
  assert.match(page, /setTimeout\(\(\) => setSearch\(searchInput\.trim\(\)\), SEARCH_DEBOUNCE_MS\)/,
    'typing must debounce before it becomes a query');

  const api = source('client/src/lib/mail-api.ts');
  assert.match(api, /\/messages\$\{query\(params\)\}/, 'the list query is sent to the server');
});

test('the message list is paginated and loads bodies lazily', () => {
  const page = source('client/src/pages/mail-page.tsx');
  assert.match(page, /const PAGE_SIZE = 25/, 'a page size must be defined');
  assert.match(page, /mailApi\.listMessages\(/, 'the list uses the paginated endpoint');
  // Bodies come from the thread endpoint, only when a conversation is opened.
  assert.match(page, /mailApi\.getThread\(/, 'bodies are fetched per conversation, not with the list');
  assert.match(page, /page: targetPage,/, 'the page number is part of the request');
});

test('the viewer renders sanitised HTML and keeps a text fallback', () => {
  const viewer = source('client/src/components/mail/MailThreadViewer.tsx');
  assert.match(viewer, /dangerouslySetInnerHTML=\{\{ __html: message\.html \}\}/,
    'the reader renders the server-sanitised html field');
  assert.match(viewer, /message\.text \|\| "This message has no body\.\"/,
    'a text-only message still renders');
  // The render path must document why rendering HTML is safe here.
  assert.match(viewer, /Sanitised server-side|sanitizeEmailHtml/,
    'the render path must document that the value is sanitised server-side');
});

test('threads collapse older messages and expand the newest', () => {
  const viewer = source('client/src/components/mail/MailThreadViewer.tsx');
  assert.match(viewer, /map\[message\.id\] = index === messages\.length - 1/,
    'the newest message starts expanded and the rest collapsed');
  assert.match(viewer, /aria-expanded=\{isOpen\}/, 'expansion state is exposed to assistive tech');
});

test('notification permission is requested only from an explicit action', () => {
  const prompt = source('client/src/components/mail/MailNotificationPrompt.tsx');
  const lib = source('client/src/lib/mail-notifications.ts');

  // The prompt offers the choice; nothing calls requestPermission on mount.
  assert.match(prompt, /Enable Notifications/, 'the prompt offers an explicit enable action');
  assert.match(prompt, /Not Now/, 'the prompt offers a dismissal');
  assert.match(prompt, /const handleEnable = async \(\) => \{[\s\S]*?requestPermission\(\)/,
    'permission is requested from the button handler');

  // The mount effect must not ask for permission. Slice from the hook body, not
  // from the import line, which is where `useEffect` first appears.
  const mountEffect = prompt.slice(prompt.indexOf('const [visible, setVisible]'), prompt.indexOf('const handleEnable'));
  assert.ok(!/requestPermission\(\)/.test(mountEffect),
    'permission must not be requested when the page loads');

  // A dismissal is remembered, and a denial is not re-asked.
  assert.match(lib, /setItem\(PROMPT_KEY, "dismissed"\)/, 'a dismissal is persisted');
  assert.match(prompt, /currentPermission\(\) === "default"/, 'the prompt is hidden once permission is decided');
});

test('notification click routes into the mail workspace', () => {
  const worker = source('client/public/mail-sw.js');
  assert.match(worker, /self\.addEventListener\("notificationclick"/, 'the worker handles clicks');
  assert.match(worker, /\/pbad/, 'a click targets the dashboard');
  assert.match(worker, /function safeTargetUrl/, 'the target URL is validated');

  // A push payload must not be able to navigate off-origin.
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return ADMIN_MAIL_URL/,
    'an off-origin target falls back to the default mail route');
  assert.match(worker, /if \(!url\.pathname\.startsWith\("\/pbad"\)\) return ADMIN_MAIL_URL/,
    'a non-dashboard path falls back to the default mail route');
});

test('the service worker holds no credentials and caches nothing', () => {
  const worker = source('client/public/mail-sw.js');
  for (const secret of ['MAILJET', 'MJ_APIKEY', 'RESEND', 'SESSION_SECRET', 'VAPID_PRIVATE', 'API_KEY']) {
    assert.ok(!worker.includes(secret), `the service worker must not reference ${secret}`);
  }
  assert.ok(!/caches\.|addEventListener\("fetch"/.test(worker),
    'the worker must not cache responses, which could leak one admin mail to another');
});

test('polling stops while the tab is hidden and resumes on return', () => {
  const hook = source('client/src/hooks/useMailNotifications.ts');
  assert.match(hook, /if \(typeof document !== "undefined" && document\.hidden\) return/,
    'a hidden tab must not poll');
  assert.match(hook, /addEventListener\("visibilitychange", onVisibility\)/,
    'visibility changes are observed');
  assert.match(hook, /const POLL_INTERVAL_MS = 60_000/, 'the poll interval is deliberately slow');
});

test('no provider secret is exposed to the browser bundle', () => {
  // Vite only inlines VITE_-prefixed variables, so a bare provider name in client
  // code would be a bug even if it were referenced.
  const clientFiles = [
    'client/src/lib/mail-api.ts',
    'client/src/lib/mail-notifications.ts',
    'client/src/hooks/useMailNotifications.ts',
    'client/src/pages/mail-page.tsx',
    'client/src/components/mail/MailComposer.tsx',
    'client/src/components/mail/MailSettingsPanel.tsx',
    'client/src/components/mail/MailEditor.tsx',
    'client/src/components/mail/MailThreadViewer.tsx',
  ];

  for (const file of clientFiles) {
    const body = source(file);
    for (const secret of ['MJ_APIKEY', 'MJ_SENDER_EMAIL', 'RESEND_API_KEY', 'SESSION_SECRET', 'MAIL_INBOUND_WEBHOOK_SECRET', 'VAPID_PRIVATE_KEY']) {
      assert.ok(!body.includes(secret), `${file} must not reference ${secret}`);
    }
    assert.ok(!/VITE_[A-Z_]*API_KEY|VITE_[A-Z_]*SECRET/.test(body),
      `${file} must not read a VITE_-prefixed credential`);
  }
});

test('the mail page is behind an owner/admin guard in the dashboard router', () => {
  const app = source('client/src/AdminApp.tsx');
  assert.match(app, /<Route path="\/mail">\s*<AdminPage permission="mail">/,
    'the mail route must be wrapped in the permission guard');
  assert.match(app, /if \(permission === "mail" && !canUseMail\) return <AdminAccessDenied \/>/,
    'a moderator must be denied in the UI');

  const hook = source('client/src/hooks/useAdminAuth.ts');
  assert.match(hook, /const canUseMail = adminRole === 'owner' \|\| adminRole === 'admin'/,
    'mail is owner/admin only');
});

test('the sidebar exposes every mailbox view and a live unread count', () => {
  const sidebar = source('client/src/components/admin/admin-sidebar.tsx');

  for (const label of ['Inbox', 'Starred', 'Drafts', 'Sent', 'Trash']) {
    assert.ok(sidebar.includes(`title: "${label}"`), `the sidebar must list ${label}`);
  }
  // The badge comes from the shared poll, so it updates without a page reload.
  assert.match(sidebar, /useMailNotifications\(\)/, 'the sidebar reads live counts');
  assert.match(sidebar, /SidebarMenuBadge/, 'the unread count is rendered as a badge');
  assert.match(sidebar, /Mail/, 'a Mail entry exists in the navigation');
});

test('the composer guards against a double send with a synchronous ref', () => {
  const composer = source('client/src/components/mail/MailComposer.tsx');
  assert.match(composer, /const sendingRef = useRef\(false\)/, 'a ref, not only state, guards the send');
  assert.match(composer, /if \(sendingRef\.current\) return; \/\/ A second click before re-render\./,
    'the guard is checked before any network work');
  assert.match(composer, /sendingRef\.current = true;/, 'the guard is set synchronously');
});

test('drafts autosave on a debounce, not on every keystroke', () => {
  const composer = source('client/src/components/mail/MailComposer.tsx');
  assert.match(composer, /setTimeout\(\(\) => void saveDraft\(true\), 1200\)/,
    'autosave is debounced');
  assert.match(composer, /clearTimeout\(timer\)/, 'the pending save is cancelled on the next edit');
});

test('the editor offers the required formatting and email blocks', () => {
  const editor = source('client/src/components/mail/MailEditor.tsx');

  for (const command of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'createLink', 'hiliteColor', 'foreColor']) {
    assert.ok(editor.includes(`"${command}"`), `the editor must expose ${command}`);
  }
  for (const block of ['Header', 'Logo', 'Greeting', 'Text section', 'Image', 'CTA button', 'Divider', 'Spacer', 'Footer', 'Signature']) {
    assert.ok(editor.includes(`label: "${block}"`), `the block palette must include ${block}`);
  }
});

test('the composer rejects an unsafe link scheme before inserting it', () => {
  const editor = source('client/src/components/mail/MailEditor.tsx');
  assert.match(editor, /if \(\/\^\\s\*\(javascript\|data\|vbscript\):\/i\.test\(url\)\)/,
    'a javascript:/data: link must be refused at entry');
});

test('inserting a link restores the selection a dialog stole', () => {
  const editor = source('client/src/components/mail/MailEditor.tsx');

  // The prompt takes focus, so the caret must be captured while the editor still
  // owns the selection and put back before `createLink` runs.
  assert.match(editor, /document\.addEventListener\("selectionchange", remember\)/,
    'the editor selection must be tracked');
  assert.match(editor, /savedRange\.current = range\.cloneRange\(\)/,
    'the tracked range must be a snapshot, not the live one');
  assert.match(editor, /selection\.addRange\(range\)/,
    'the saved range must be restored before the link is applied');

  const linkHandler = editor.slice(editor.indexOf('const promptForLink'), editor.indexOf('const promptForImage'));
  assert.ok(
    linkHandler.indexOf('restoreSelection()') < linkHandler.indexOf('execCommand("createLink"'),
    'the selection must be restored before createLink',
  );
});

test('a link inserted with no selection is still a link', () => {
  const editor = source('client/src/components/mail/MailEditor.tsx');
  const linkHandler = editor.slice(editor.indexOf('const promptForLink'), editor.indexOf('const promptForImage'));

  // `createLink` with an empty selection is a no-op, which is what made the
  // toolbar button appear broken. A link is inserted as fallback instead.
  assert.match(linkHandler, /hasSelectedText/, 'the empty-selection case must be handled');
  assert.match(linkHandler, /insertHtml\(/, 'a link must be inserted when nothing is selected');
  assert.match(linkHandler, /<a href="\$\{href\}"/, 'the fallback inserts a real anchor');
});

test('link and image URLs are escaped before they reach the message', () => {
  const editor = source('client/src/components/mail/MailEditor.tsx');
  assert.match(editor, /function escapeLinkPart/, 'an escaping helper must exist');
  assert.match(editor, /escapeLinkPart\(url\)/, 'the entered URL must be escaped before insertion');
});

test('notification settings are per-admin and include every required toggle', () => {
  const panel = source('client/src/components/mail/MailSettingsPanel.tsx');
  for (const label of ['New incoming email', 'New project request', 'Email reply', 'Mention / important notification', 'Desktop notifications', 'Sound', 'Badge count']) {
    assert.ok(panel.includes(label), `notification settings must include "${label}"`);
  }
  assert.match(panel, /mailApi\.saveNotificationSettings/, 'preferences are saved through the per-admin endpoint');
});

test('the signature panel covers the requested fields', () => {
  const panel = source('client/src/components/mail/MailSettingsPanel.tsx');
  for (const field of ['Name', 'Position', 'Company', 'Website', 'GitHub', 'LinkedIn']) {
    assert.ok(
      panel.includes(`>${field}<`) || panel.includes(`"${field}"`) || panel.includes(`placeholder="${field}`),
      `the signature form must include ${field}`,
    );
  }
});

test('template management exposes create, duplicate and delete', () => {
  const panel = source('client/src/components/mail/MailSettingsPanel.tsx');
  assert.match(panel, /mailApi\.createTemplate/, 'templates can be created');
  assert.match(panel, /mailApi\.duplicateTemplate/, 'templates can be duplicated');
  assert.match(panel, /mailApi\.deleteTemplate/, 'templates can be deleted');
  assert.match(panel, /mailApi\.templates\(\)/, 'templates are reusable from the composer');
});

test('interactive controls carry accessible names and keyboard affordances', () => {
  const files = [
    'client/src/components/mail/MailListRow.tsx',
    'client/src/components/mail/MailThreadViewer.tsx',
    'client/src/components/mail/MailEditor.tsx',
    'client/src/pages/mail-page.tsx',
  ];

  for (const file of files) {
    const body = source(file);
    assert.match(body, /aria-label=/, `${file} must label its controls`);
    assert.match(body, /focus-visible:ring/, `${file} must show a visible focus state`);
  }

  // The list is a keyboard-navigable listbox, and rows respond to Enter/Space.
  const list = source('client/src/components/mail/MailListRow.tsx');
  assert.match(list, /role="option"/, 'list rows are options in a listbox');
  assert.match(list, /event\.key === "Enter" \|\| event\.key === " "/, 'rows activate from the keyboard');
});

test('the theme system is used rather than hard-coded colours', () => {
  const files = [
    'client/src/pages/mail-page.tsx',
    'client/src/components/mail/MailListRow.tsx',
    'client/src/components/mail/MailThreadViewer.tsx',
    'client/src/components/mail/MailComposer.tsx',
    'client/src/components/mail/MailEditor.tsx',
    'client/src/components/mail/MailSettingsPanel.tsx',
  ];

  for (const file of files) {
    const body = source(file);
    // Only class names are checked. Inline styles in this module legitimately use
    // literal colours: the composer writes markup that mail clients receive, and
    // those clients strip stylesheets, so a theme token would arrive unstyled.
    const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)]
      .map((match) => match[1] || match[2] || match[3] || '')
      .join(' ');

    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(classNames), `${file} must use theme tokens in class names`);
    assert.ok(!/\brgb\(|\bhsl\(/.test(classNames), `${file} must not hard-code a colour function`);
  }

  // Spot-check that the tokens are actually in use, so the assertion above is
  // meaningful rather than vacuous.
  const page = source('client/src/pages/mail-page.tsx');
  for (const token of ['bg-background', 'border-border', 'text-muted-foreground', 'bg-card']) {
    assert.ok(page.includes(token), `the mail page must use the ${token} token`);
  }
});

test('animations are subtle and restrained', () => {
  const page = source('client/src/pages/mail-page.tsx');
  assert.match(page, /animate-in fade-in slide-in-from-bottom-2 duration-200/,
    'the composer animates briefly and subtly');
  assert.ok(!/animate-bounce|animate-ping/.test(page), 'no attention-grabbing animation');
});
