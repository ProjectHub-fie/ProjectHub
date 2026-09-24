/**
 * ProjectHub Mail — API client.
 *
 * Every call goes through `/api/admin/mail/*` with `credentials: 'include'`, so
 * it carries the dashboard session cookie. There is no token handling here on
 * purpose: the mail workspace reuses the existing admin session rather than
 * introducing a second authentication mechanism.
 */

export type MailListItem = {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  status: string;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  subject: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  isRead: boolean;
  isStarred: boolean;
  isTrashed: boolean;
  provider: string | null;
  messageCount: number;
  participants: string[];
  date: string;
  lastMessageAt: string;
};

export type MailAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  available: boolean;
};

export type MailMessage = {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  status: string;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  replyTo: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  isRead: boolean;
  isStarred: boolean;
  isTrashed: boolean;
  provider: string | null;
  sourceType: string | null;
  sourceId: string | null;
  date: string;
  attachments: MailAttachment[];
};

export type ThreadPayload = {
  thread: { id: string; subject: string | null; participants: string[]; isStarred: boolean; messageCount: number };
  messages: Array<
    Pick<
      MailMessage,
      | "id" | "direction" | "status" | "fromName" | "fromEmail" | "toEmails" | "ccEmails"
      | "subject" | "html" | "text" | "snippet" | "provider" | "isRead" | "isStarred" | "date" | "attachments"
    >
  >;
};

export type MailCounts = {
  inbox: number;
  inboxTotal: number;
  drafts: number;
  starred: number;
  sent: number;
  trash: number;
};

export type MailTemplate = {
  id: string;
  name: string;
  category: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  updatedAt: string;
};

export type MailSignature = {
  name: string | null;
  position: string | null;
  company: string | null;
  website: string | null;
  socialLinks: Record<string, string>;
  logoUrl: string | null;
  enabled: boolean;
};

export type MailDraft = {
  id: string;
  threadId: string | null;
  templateId: string | null;
  mode: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  bodyHtml: string | null;
  attachments: Array<{ filename: string; contentType: string; sizeBytes: number }>;
  updatedAt: string;
};

export type NotificationSettings = {
  notifyNewEmail: boolean;
  notifyProjectRequest: boolean;
  notifyReply: boolean;
  notifyImportant: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  badgeEnabled: boolean;
};

export type MailNotification = {
  id: string;
  type: string;
  title: string | null;
  preview: string | null;
  messageId: string | null;
  threadId: string | null;
  isRead: boolean;
  createdAt: string;
};

export type OutgoingAttachment = {
  filename: string;
  contentType: string;
  base64Content: string;
  sizeBytes: number;
};

/** Raised for a non-2xx response, carrying the server's own message. */
export class MailApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MailApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/mail${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new MailApiError(payload?.message || "Mail request failed", response.status);
  }
  return payload as T;
}

const query = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const mailApi = {
  status: () => request<{ mailjetConfigured: boolean; resendConfigured: boolean }>("/status"),
  counts: () => request<MailCounts>("/counts"),

  listMessages: (params: {
    view?: string; search?: string; unread?: boolean; attachments?: boolean;
    starred?: boolean; page?: number; pageSize?: number;
  }) => request<{ rows: MailListItem[]; page: number; pageSize: number }>(`/messages${query(params)}`),

  getMessage: (id: string) => request<MailMessage>(`/messages/${id}`),
  getThread: (id: string) => request<ThreadPayload>(`/threads/${id}`),

  updateMessage: (id: string, patch: { isRead?: boolean; isStarred?: boolean; isTrashed?: boolean; thread?: boolean }) =>
    request<{ success: boolean }>(`/messages/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteMessage: (id: string) => request<{ success: boolean }>(`/messages/${id}`, { method: "DELETE" }),

  bulk: (ids: string[], action: string) =>
    request<{ success: boolean; updated: number }>("/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),

  send: (payload: Record<string, unknown>) =>
    request<{ success: boolean; messageId: string; threadId: string }>("/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  drafts: () => request<MailDraft[]>("/drafts"),
  getDraft: (id: string) => request<MailDraft>(`/drafts/${id}`),
  saveDraft: (payload: Record<string, unknown>) =>
    request<{ success: boolean; id: string; updatedAt: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteDraft: (id: string) => request<{ success: boolean }>(`/drafts/${id}`, { method: "DELETE" }),

  templates: () => request<MailTemplate[]>("/templates"),
  createTemplate: (payload: Partial<MailTemplate>) =>
    request<MailTemplate>("/templates", { method: "POST", body: JSON.stringify(payload) }),
  updateTemplate: (id: string, payload: Partial<MailTemplate>) =>
    request<MailTemplate>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  duplicateTemplate: (id: string) => request<MailTemplate>(`/templates/${id}/duplicate`, { method: "POST" }),
  deleteTemplate: (id: string) => request<{ success: boolean }>(`/templates/${id}`, { method: "DELETE" }),

  signature: () => request<MailSignature>("/signature"),
  saveSignature: (payload: MailSignature) =>
    request<MailSignature>("/signature", { method: "PUT", body: JSON.stringify(payload) }),

  notifications: (unreadOnly = false) =>
    request<{ items: MailNotification[]; settings: NotificationSettings; counts: MailCounts }>(
      `/notifications${query({ unreadOnly })}`,
    ),
  markNotificationsRead: (ids?: string[]) =>
    request<{ success: boolean }>("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids: ids || null }),
    }),
  notificationSettings: () => request<NotificationSettings>("/notification-settings"),
  saveNotificationSettings: (payload: NotificationSettings) =>
    request<NotificationSettings>("/notification-settings", { method: "PUT", body: JSON.stringify(payload) }),

  pushPublicKey: () => request<{ publicKey: string | null }>("/push/public-key"),
  pushSubscribe: (payload: { endpoint: string; keys: Record<string, string> }) =>
    request<{ success: boolean }>("/push/subscribe", { method: "POST", body: JSON.stringify(payload) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ success: boolean }>("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),

  backfill: () => request<{ success: boolean; scanned: number; created: number }>("/backfill", { method: "POST" }),

  attachmentUrl: (id: string) => `/api/admin/mail/attachments/${id}`,
};
