import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleSlash,
  GitBranch,
  Hash,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Discord Forum ↔ GitHub Issues integration.
 *
 * One Forum channel whose only tags denote repositories; a post becomes one
 * GitHub issue and the thread stays in sync both ways. This page is the control
 * plane: it edits the switches, the repository mappings and the labels, and it
 * shows the health, the linked issues and the sync log. The bot process does the
 * actual synchronization.
 *
 * No secret is entered here. The GitHub App id, private key, installation id and
 * webhook secret are environment configuration; this page only reports whether
 * each is present, the same way the mail diagnostics report the Mailjet keys.
 */
type GithubForumSettings = {
  enabled: boolean;
  guildId: string | null;
  forumChannelId: string | null;
  syncDiscordToGithub: boolean;
  syncGithubToDiscord: boolean;
  createIssues: boolean;
  notifyStateChanges: boolean;
  syncAttachments: boolean;
  issueLabels: string[];
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  installationIdConfigured: boolean;
  webhookSecretConfigured: boolean;
};

type Mapping = {
  id: string;
  discordTagId: string;
  discordTagName: string | null;
  githubOwner: string;
  githubRepository: string;
  repository: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type Overview = {
  enabled: boolean;
  forumConfigured: boolean;
  appConfigured: boolean;
  webhookConfigured: boolean;
  mappingCount: number;
  healthy: boolean;
  problems: string[];
  forumChannelId: string | null;
  stats: {
    linkedIssues: number;
    openIssues: number;
    syncedMessages: number;
    successfulSyncs: number;
    failedSyncs: number;
    lastSuccessAt: string | null;
    jobs: Record<string, number>;
  };
  recentLinks: {
    threadId: string;
    repository: string;
    issueNumber: number;
    issueUrl: string | null;
    state: string;
    createdAt: string;
  }[];
};

type SyncLog = {
  id: string;
  eventId: string | null;
  eventType: string;
  source: string | null;
  destination: string | null;
  repository: string | null;
  issueNumber: number | null;
  status: string;
  direction: string | null;
  attempts: number;
  errorSummary: string | null;
  createdAt: string;
};

type Job = {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
};

type ValidateResult = {
  ok: boolean;
  reason: string;
  message: string;
  fullName?: string;
  htmlUrl?: string;
};

const STATUS_STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failure: "bg-red-500/15 text-red-600 dark:text-red-400",
  skipped: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export default function AdminGithubPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<GithubForumSettings>({
    queryKey: ["github-forum-settings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/github-forum/settings", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load GitHub integration settings");
      return response.json();
    },
  });

  const { data: overview } = useQuery<Overview>({
    queryKey: ["github-forum-overview"],
    queryFn: async () => {
      const response = await fetch("/api/admin/github-forum/overview", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load the overview");
      return response.json();
    },
  });

  const { data: mappings } = useQuery<{ mappings: Mapping[] }>({
    queryKey: ["github-forum-mappings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/github-forum/mappings", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load repository mappings");
      return response.json();
    },
  });

  const { data: logs } = useQuery<{ logs: SyncLog[] }>({
    queryKey: ["github-forum-logs"],
    queryFn: async () => {
      const response = await fetch("/api/admin/github-forum/logs?limit=50", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load synchronization logs");
      return response.json();
    },
  });

  const { data: jobs } = useQuery<{ jobs: Job[] }>({
    queryKey: ["github-forum-jobs"],
    queryFn: async () => {
      const response = await fetch("/api/admin/github-forum/jobs?limit=50", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load synchronization jobs");
      return response.json();
    },
  });

  const [form, setForm] = useState({
    enabled: false,
    forumChannelId: "",
    guildId: "",
    syncDiscordToGithub: true,
    syncGithubToDiscord: true,
    createIssues: true,
    notifyStateChanges: true,
    syncAttachments: true,
    issueLabels: "",
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      forumChannelId: settings.forumChannelId || "",
      guildId: settings.guildId || "",
      syncDiscordToGithub: settings.syncDiscordToGithub,
      syncGithubToDiscord: settings.syncGithubToDiscord,
      createIssues: settings.createIssues,
      notifyStateChanges: settings.notifyStateChanges,
      syncAttachments: settings.syncAttachments,
      issueLabels: (settings.issueLabels || []).join(", "),
    });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/github-forum/settings", "PUT", {
        enabled: form.enabled,
        forumChannelId: form.forumChannelId.trim(),
        guildId: form.guildId.trim(),
        syncDiscordToGithub: form.syncDiscordToGithub,
        syncGithubToDiscord: form.syncGithubToDiscord,
        createIssues: form.createIssues,
        notifyStateChanges: form.notifyStateChanges,
        syncAttachments: form.syncAttachments,
        issueLabels: form.issueLabels,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to save");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "The bot picks these up on its next refresh.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["github-forum-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["github-forum-overview"] });
    },
    onError: (error: any) => toast({ title: "Could not save", description: error.message, variant: "error" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest(`/api/admin/github-forum/jobs/${jobId}/retry`, "POST", {});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to retry");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Job queued", description: "The worker will retry it shortly.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["github-forum-jobs"] });
    },
    onError: (error: any) => toast({ title: "Retry failed", description: error.message, variant: "error" }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = overview?.stats;
  const secretCount = [settings?.appIdConfigured, settings?.privateKeyConfigured, settings?.installationIdConfigured, settings?.webhookSecretConfigured].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="admin-github-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FaGithub className="h-6 w-6" />
            GitHub Forum Integration
          </h1>
          <p className="text-muted-foreground">
            One Discord Forum channel, one repository per tag. Posts become GitHub issues; the thread stays in sync both ways.
          </p>
        </div>
        <Badge variant={overview?.healthy ? "default" : "outline"} className="gap-1">
          {overview?.healthy ? <BadgeCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {overview?.healthy ? "Healthy" : settings?.enabled ? "Needs attention" : "Disabled"}
        </Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="mappings">Repository Mapping</TabsTrigger>
          <TabsTrigger value="settings">Synchronization</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Overview ------------------------------------------------------- */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatusTile
              ok={Boolean(overview?.appConfigured)}
              label="GitHub App"
              detail={overview?.appConfigured ? "Credentials configured" : "Set GITHUB_APP_ID and the key"}
            />
            <StatusTile
              ok={Boolean(overview?.forumConfigured)}
              label="Forum channel"
              detail={overview?.forumChannelId ? `ID ${overview.forumChannelId}` : "No Forum channel set"}
            />
            <StatusTile
              ok={Boolean(overview?.webhookConfigured)}
              label="Webhook secret"
              detail={overview?.webhookConfigured ? "GITHUB_WEBHOOK_SECRET set" : "Set GITHUB_WEBHOOK_SECRET"}
            />
            <StatusTile
              ok={(overview?.mappingCount ?? 0) > 0}
              label="Repositories"
              detail={`${overview?.mappingCount ?? 0} enabled mapping(s)`}
            />
          </div>

          {overview?.problems?.length ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Before this integration is fully healthy:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {overview.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Linked issues" value={stats?.linkedIssues ?? 0} icon={<Link2 className="h-4 w-4" />} />
            <StatTile label="Open issues" value={stats?.openIssues ?? 0} icon={<GitBranch className="h-4 w-4" />} />
            <StatTile label="Synced messages" value={stats?.syncedMessages ?? 0} icon={<Send className="h-4 w-4" />} />
            <StatTile label="Successful syncs" value={stats?.successfulSyncs ?? 0} icon={<Check className="h-4 w-4" />} />
            <StatTile label="Failed syncs" value={stats?.failedSyncs ?? 0} icon={<CircleSlash className="h-4 w-4" />} />
            <StatTile label="Queued jobs" value={stats?.jobs?.pending ?? 0} icon={<Activity className="h-4 w-4" />} />
            <StatTile label="Parked jobs" value={stats?.jobs?.dead ?? 0} icon={<AlertTriangle className="h-4 w-4" />} />
            <StatTile
              label="Last success"
              value={stats?.lastSuccessAt ? relativeAge(stats.lastSuccessAt) : "never"}
              icon={<RefreshCw className="h-4 w-4" />}
              small
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recently linked issues</CardTitle>
              <CardDescription>The most recent Forum posts that became GitHub issues.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {overview?.recentLinks?.length ? (
                overview.recentLinks.map((link) => (
                  <div key={link.threadId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {link.repository}#{link.issueNumber}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">Thread {link.threadId}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={link.state === "open" ? "default" : "secondary"}>{link.state}</Badge>
                      {link.issueUrl ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={link.issueUrl} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No issues linked yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mappings ------------------------------------------------------- */}
        <TabsContent value="mappings" className="space-y-4">
          <MappingEditor mappings={mappings?.mappings || []} />
        </TabsContent>

        {/* Settings ------------------------------------------------------- */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Hash className="h-5 w-5 text-primary" />
                Forum channel
              </CardTitle>
              <CardDescription>The single Discord Forum channel that accepts submissions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Enable the integration</p>
                  <p className="text-xs text-muted-foreground">Turns issue creation and both sync directions on or off.</p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
                  data-testid="github-forum-enabled-switch"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="forumChannelId">Forum channel ID</Label>
                  <Input
                    id="forumChannelId"
                    placeholder="123456789012345678"
                    value={form.forumChannelId}
                    onChange={(e) => setForm((prev) => ({ ...prev, forumChannelId: e.target.value }))}
                    data-testid="input-forum-channel"
                  />
                  <p className="text-xs text-muted-foreground">Right-click the Forum channel with Developer Mode on, then Copy Channel ID.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guildId">Server (guild) ID — optional</Label>
                  <Input
                    id="guildId"
                    placeholder="123456789012345678"
                    value={form.guildId}
                    onChange={(e) => setForm((prev) => ({ ...prev, guildId: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Restricts the integration to one server. Leave blank to accept the configured Forum in any server.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="issueLabels">Default issue labels</Label>
                <Input
                  id="issueLabels"
                  placeholder="discord, triage"
                  value={form.issueLabels}
                  onChange={(e) => setForm((prev) => ({ ...prev, issueLabels: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Comma-separated. Labels that do not exist in the repository are ignored by GitHub.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Synchronization switches</CardTitle>
              <CardDescription>Each direction can be turned off independently.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <SwitchRow
                label="Create GitHub issues from Forum posts"
                description="A new post with exactly one repository tag opens one issue."
                checked={form.createIssues}
                onChange={(checked) => setForm((prev) => ({ ...prev, createIssues: checked }))}
              />
              <Separator />
              <SwitchRow
                label="Discord messages → GitHub comments"
                description="Every eligible reply in a linked thread becomes an issue comment."
                checked={form.syncDiscordToGithub}
                onChange={(checked) => setForm((prev) => ({ ...prev, syncDiscordToGithub: checked }))}
              />
              <Separator />
              <SwitchRow
                label="GitHub comments → Discord replies"
                description="A GitHub comment is posted back into the corresponding thread."
                checked={form.syncGithubToDiscord}
                onChange={(checked) => setForm((prev) => ({ ...prev, syncGithubToDiscord: checked }))}
              />
              <Separator />
              <SwitchRow
                label="Issue close/reopen notifications"
                description="Closing or reopening a linked issue posts a notice in the thread."
                checked={form.notifyStateChanges}
                onChange={(checked) => setForm((prev) => ({ ...prev, notifyStateChanges: checked }))}
              />
              <Separator />
              <SwitchRow
                label="Attachment-link synchronization"
                description="Include Discord attachment links in the issue and comment bodies."
                checked={form.syncAttachments}
                onChange={(checked) => setForm((prev) => ({ ...prev, syncAttachments: checked }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Webhook className="h-5 w-5 text-primary" />
                GitHub App credentials
              </CardTitle>
              <CardDescription>
                Environment-only. {secretCount}/4 configured. No value is ever shown here.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <SecretRow ok={Boolean(settings?.appIdConfigured)} label="GITHUB_APP_ID" />
              <SecretRow ok={Boolean(settings?.privateKeyConfigured)} label="GITHUB_APP_PRIVATE_KEY" />
              <SecretRow ok={Boolean(settings?.installationIdConfigured)} label="GITHUB_APP_INSTALLATION_ID" />
              <SecretRow ok={Boolean(settings?.webhookSecretConfigured)} label="GITHUB_WEBHOOK_SECRET" />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Set the webhook URL in the GitHub App to <code className="rounded bg-muted px-1">{`{origin}`}/api/admin/github/webhook</code>{" "}
                and subscribe to the <code className="rounded bg-muted px-1">issues</code> and{" "}
                <code className="rounded bg-muted px-1">issue_comment</code> events.
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-github-settings">
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save settings
            </Button>
          </div>
        </TabsContent>

        {/* Logs ----------------------------------------------------------- */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Failed and parked jobs</CardTitle>
              <CardDescription>Retryable synchronization jobs. A retry re-queues the job without duplicating it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(jobs?.jobs || []).filter((job) => job.status === "dead" || job.status === "pending").length ? (
                (jobs?.jobs || [])
                  .filter((job) => job.status === "dead" || job.status === "pending")
                  .map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {job.eventType} · <span className="text-muted-foreground">{job.status}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {job.lastError || "no error"} · attempt {job.attempts}/{job.maxAttempts}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryMutation.mutate(job.id)}
                        disabled={retryMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-3.5 w-3.5" />
                        Retry
                      </Button>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">No failed or pending jobs.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Synchronization log</CardTitle>
              <CardDescription>Newest first. Every event, both directions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {(logs?.logs || []).length ? (
                logs!.logs.map((log) => (
                  <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge className={STATUS_STYLES[log.status] || ""}>{log.status}</Badge>
                      <span className="font-medium">{log.eventType}</span>
                      <span className="text-muted-foreground">
                        {log.source || "?"} → {log.destination || "?"}
                      </span>
                      {log.repository ? (
                        <span className="truncate text-muted-foreground">
                          {log.repository}
                          {log.issueNumber ? `#${log.issueNumber}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {log.attempts ? <span>try {log.attempts}</span> : null}
                      <span>{relativeAge(log.createdAt)}</span>
                    </div>
                    {log.errorSummary ? (
                      <p className="w-full truncate text-red-600 dark:text-red-400">{log.errorSummary}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No synchronization activity yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------- mapping editor */

function MappingEditor({ mappings }: { mappings: Mapping[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ discordTagId: "", discordTagName: "", repository: "" });
  const [validation, setValidation] = useState<Record<string, ValidateResult>>({});

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["github-forum-mappings"] });
    void queryClient.invalidateQueries({ queryKey: ["github-forum-overview"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const [owner, repository] = splitRepo(draft.repository);
      const response = await apiRequest("/api/admin/github-forum/mappings", "POST", {
        discordTagId: draft.discordTagId.trim(),
        discordTagName: draft.discordTagName.trim(),
        githubOwner: owner,
        githubRepository: repository,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to add the mapping");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Mapping added", description: "A post with that tag now opens an issue in the repository.", variant: "success" });
      setDraft({ discordTagId: "", discordTagName: "", repository: "" });
      invalidate();
    },
    onError: (error: any) => toast({ title: "Could not add the mapping", description: error.message, variant: "error" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (mapping: Mapping) => {
      const response = await apiRequest(`/api/admin/github-forum/mappings/${mapping.id}`, "PUT", {
        discordTagId: mapping.discordTagId,
        discordTagName: mapping.discordTagName || "",
        githubOwner: mapping.githubOwner,
        githubRepository: mapping.githubRepository,
        enabled: !mapping.enabled,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to update the mapping");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Mapping updated", variant: "success" });
      invalidate();
    },
    onError: (error: any) => toast({ title: "Could not update", description: error.message, variant: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest(`/api/admin/github-forum/mappings/${id}`, "DELETE");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to remove the mapping");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Mapping removed", variant: "success" });
      invalidate();
    },
    onError: (error: any) => toast({ title: "Could not remove", description: error.message, variant: "error" }),
  });

  const validateMutation = useMutation({
    mutationFn: async (repository: string) => {
      const response = await apiRequest("/api/admin/github-forum/validate", "POST", { repository });
      const data: ValidateResult = await response.json();
      return { repository, result: data };
    },
    onSuccess: ({ repository, result }) => {
      setValidation((prev) => ({ ...prev, [repository]: result }));
      toast({
        title: result.ok ? "Repository reachable" : "Repository not reachable",
        description: result.message,
        variant: result.ok ? "success" : "error",
      });
    },
    onError: (error: any) => toast({ title: "Validation failed", description: error.message, variant: "error" }),
  });

  const duplicateTag = useMemo(
    () => mappings.some((mapping) => mapping.discordTagId === draft.discordTagId.trim() && draft.discordTagId.trim()),
    [mappings, draft.discordTagId],
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <GitBranch className="h-5 w-5 text-primary" />
            Repository mappings
          </CardTitle>
          <CardDescription>
            Each Forum tag maps to exactly one repository. Only repository tags are used — no category or status tags.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mappings.length ? (
            mappings.map((mapping) => (
              <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-2 font-medium">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    {mapping.discordTagName || mapping.discordTagId}
                    <span className="text-xs text-muted-foreground">{mapping.discordTagId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">→ {mapping.repository}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {validation[mapping.repository] ? (
                    <Badge variant={validation[mapping.repository].ok ? "default" : "outline"}>
                      {validation[mapping.repository].ok ? "reachable" : validation[mapping.repository].reason}
                    </Badge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => validateMutation.mutate(mapping.repository)}
                    disabled={validateMutation.isPending}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Validate
                  </Button>
                  <Switch checked={mapping.enabled} onCheckedChange={() => toggleMutation.mutate(mapping)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(mapping.id)}
                    disabled={deleteMutation.isPending}
                    aria-label="Remove mapping"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No mappings yet. Add one below.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" />
            Add a mapping
          </CardTitle>
          <CardDescription>Copy the tag ID from Discord, and name the GitHub repository as owner/name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tagId">Discord tag ID</Label>
              <Input
                id="tagId"
                placeholder="123456789012345678"
                value={draft.discordTagId}
                onChange={(e) => setDraft((prev) => ({ ...prev, discordTagId: e.target.value }))}
                data-testid="input-tag-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tagName">Tag name (snapshot)</Label>
              <Input
                id="tagName"
                placeholder="ProjectHub"
                value={draft.discordTagName}
                onChange={(e) => setDraft((prev) => ({ ...prev, discordTagName: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Stored for display. Routing uses the tag ID, so a rename does not break it.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo">GitHub repository</Label>
            <Input
              id="repo"
              placeholder="ProjectHub-fie/ProjectHub"
              value={draft.repository}
              onChange={(e) => setDraft((prev) => ({ ...prev, repository: e.target.value }))}
              data-testid="input-repository"
            />
            <p className="text-xs text-muted-foreground">The App installation must be granted access to this repository.</p>
          </div>
          {duplicateTag ? (
            <p className="text-xs text-red-600 dark:text-red-400">That tag is already mapped. Remove the existing mapping first.</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => validateMutation.mutate(draft.repository.trim())}
              disabled={!draft.repository.trim() || validateMutation.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Validate access
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || duplicateTag || !draft.discordTagId.trim() || !draft.repository.trim()}
              data-testid="button-add-mapping"
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add mapping
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- small bits */

function splitRepo(value: string): [string, string] {
  const [owner, ...rest] = String(value || "").split("/");
  return [owner?.trim() || "", rest.join("/").trim()];
}

function relativeAge(iso: string | null | undefined) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusTile({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div className={`mt-0.5 rounded-full p-1 ${ok ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  small = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className={`mt-1 font-bold ${small ? "text-base" : "text-2xl"}`}>{value}</p>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SecretRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
      {ok ? <Check className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
      <code className="truncate">{label}</code>
      <span className="ml-auto text-xs text-muted-foreground">{ok ? "set" : "not set"}</span>
    </div>
  );
}
