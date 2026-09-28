import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Gamepad2,
  Link2,
  Loader2,
  Plug,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Roblox integration via Bloxlink.
 *
 * Bloxlink owns Roblox account verification and linking; this page configures
 * what the private server does *with* that information — which channels or
 * commands require a verified link, whether Roblox appears on profiles, and
 * where link notifications go. Nothing here stores or displays a Bloxlink key:
 * `BLOXLINK_API_KEY` (and the guild it is scoped to) is environment-only, and
 * this page reports only whether each is present.
 *
 * The sections mirror the navigation: Overview, Bloxlink, Linked Accounts,
 * Member Lookup, Verification, Roblox Profile, Notifications and Settings.
 */

type RobloxSettings = {
  enabled: boolean;
  bloxlinkEnabled: boolean;
  showOnProfiles: boolean;
  requireVerification: boolean;
  verifiedOnlyChannels: string;
  verifiedRoleId: string | null;
  unverifiedRoleId: string | null;
  verificationChannelId: string | null;
  notifyOnLink: boolean;
  notifyChannelId: string | null;
  displayMode: "compact" | "full";
  bloxlinkKeyConfigured: boolean;
  bloxlinkGuildConfigured: boolean;
};

type Overview = {
  enabled: boolean;
  bloxlinkEnabled: boolean;
  requireVerification: boolean;
  bloxlinkKeyConfigured: boolean;
  bloxlinkGuildConfigured: boolean;
  connected: boolean;
  provider: string;
  stats: {
    tracked: number;
    linked: number;
    verified: number;
    unlinked: number;
    unavailable: number;
    totalLinks: number;
    totalUnlinks: number;
    failures: number;
    linkedLast24h: number;
  };
  recentLinks: { discordId: string; robloxId: string | null; at: string }[];
};

type LinkRow = {
  guildId: string;
  discordId: string;
  robloxId: string | null;
  status: string;
  statusLabel: string;
  source: string;
  linkedAt: string | null;
  lastCheckedAt: string;
};

type MemberResult = {
  discordId: string;
  status: string;
  statusLabel: string;
  cached: boolean;
  checkedAt: string | null;
  profile: {
    userId: string;
    username: string | null;
    displayName: string | null;
    created: string | null;
    avatarUrl: string | null;
    profileUrl: string;
  } | null;
};

type PublicLookup = {
  found: boolean;
  unavailable?: boolean;
  message?: string;
  note?: string;
  profile?: {
    userId: string;
    username: string | null;
    displayName: string | null;
    created: string | null;
    avatarUrl: string | null;
    profileUrl: string;
  };
};

const STATUS_STYLES: Record<string, string> = {
  linked: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  not_linked: "bg-muted text-muted-foreground",
  verification_unavailable: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  bloxlink_unavailable: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export default function AdminRobloxPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<RobloxSettings>({
    queryKey: ["roblox-settings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/roblox/settings", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load Roblox settings");
      return response.json();
    },
  });

  const { data: overview } = useQuery<Overview>({
    queryKey: ["roblox-overview"],
    queryFn: async () => {
      const response = await fetch("/api/admin/roblox/overview", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load the Roblox overview");
      return response.json();
    },
  });

  const [form, setForm] = useState({
    enabled: false,
    bloxlinkEnabled: true,
    showOnProfiles: true,
    requireVerification: false,
    verifiedOnlyChannels: "",
    verifiedRoleId: "",
    unverifiedRoleId: "",
    verificationChannelId: "",
    notifyOnLink: true,
    notifyChannelId: "",
    displayMode: "compact" as "compact" | "full",
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      bloxlinkEnabled: settings.bloxlinkEnabled,
      showOnProfiles: settings.showOnProfiles,
      requireVerification: settings.requireVerification,
      verifiedOnlyChannels: settings.verifiedOnlyChannels || "",
      verifiedRoleId: settings.verifiedRoleId || "",
      unverifiedRoleId: settings.unverifiedRoleId || "",
      verificationChannelId: settings.verificationChannelId || "",
      notifyOnLink: settings.notifyOnLink,
      notifyChannelId: settings.notifyChannelId || "",
      displayMode: settings.displayMode,
    });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/roblox/settings", "PUT", form);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Roblox settings saved", description: "The bot picks these up on its next read.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["roblox-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["roblox-overview"] });
    },
    onError: (error: any) => toast({ title: "Could not save", description: error.message, variant: "error" }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="admin-roblox-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Gamepad2 className="h-6 w-6 text-primary" />
            Roblox
          </h1>
          <p className="text-muted-foreground">
            Roblox account verification is provided by Bloxlink. Configure what this server does with it.
          </p>
        </div>
        <Badge variant={settings?.enabled ? "default" : "outline"} className="gap-1">
          {settings?.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {/* Bloxlink status card --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5 text-primary" />
            Bloxlink
          </CardTitle>
          <CardDescription>The verification provider for Roblox accounts on Discord.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${settings?.bloxlinkKeyConfigured && settings?.bloxlinkGuildConfigured ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
                  ● {settings?.bloxlinkKeyConfigured && settings?.bloxlinkGuildConfigured ? "Connected" : "Not configured"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Provider</span>
                <span className="font-medium">Bloxlink</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href="#roblox-settings">Manage</a>
              </Button>
              <BloxlinkTestButton />
            </div>
          </div>
          {!settings?.bloxlinkKeyConfigured && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Set <code className="rounded bg-muted px-1">BLOXLINK_API_KEY</code> and{" "}
              <code className="rounded bg-muted px-1">BLOXLINK_GUILD_ID</code> on the server. Keys are never stored
              in the database or shown here.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bloxlink">Bloxlink</TabsTrigger>
          <TabsTrigger value="links">Linked Accounts</TabsTrigger>
          <TabsTrigger value="lookup">Member Lookup</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="profile">Roblox Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview ------------------------------------------------------- */}
        <TabsContent value="overview" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Roblox Integration</CardTitle>
              <CardDescription>Counts cover members the bot has checked; it never polls the whole guild.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatusTile ok={Boolean(overview?.connected)} label="Bloxlink Status" detail={overview?.connected ? "Connected" : "Not configured"} />
                <Stat label="Linked Members" value={overview?.stats.linked ?? 0} />
                <Stat label="Verified Members" value={overview?.stats.verified ?? 0} />
                <Stat label="Unlinked Members" value={overview?.stats.unlinked ?? 0} />
                <Stat label="Unavailable" value={overview?.stats.unavailable ?? 0} />
                <Stat label="Tracked" value={overview?.stats.tracked ?? 0} />
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-sm font-medium">Recent Links</p>
                {overview?.recentLinks?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {overview.recentLinks.map((link) => (
                      <Badge key={`${link.discordId}-${link.at}`} variant="secondary" className="gap-1">
                        <Check className="h-3 w-3" />
                        {link.robloxId ? `Roblox ${link.robloxId}` : "Linked"}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No links recorded yet.</p>
                )}
              </div>

              {overview && overview.stats.failures > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {overview.stats.failures} Bloxlink failure{overview.stats.failures === 1 ? "" : "s"} recorded. These
                  are outages that prevented a check, not proof that a member is unlinked.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bloxlink ------------------------------------------------------- */}
        <TabsContent value="bloxlink" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bloxlink integration</CardTitle>
              <CardDescription>
                Bloxlink is the source of truth. A Discord username that matches a Roblox username is never treated as
                proof of ownership.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Enable Bloxlink integration"
                detail="Turn every Roblox lookup on or off server-side."
                checked={form.bloxlinkEnabled}
                onChange={(checked) => setForm((prev) => ({ ...prev, bloxlinkEnabled: checked }))}
              />
              <ToggleRow
                label="Show Roblox information on profiles"
                detail="Adds a Roblox field to the existing &profile embed when Bloxlink confirms a link."
                checked={form.showOnProfiles}
                onChange={(checked) => setForm((prev) => ({ ...prev, showOnProfiles: checked }))}
              />
              <ToggleRow
                label="Require Bloxlink verification"
                detail="Gate the channels or commands listed under Verification behind a linked account."
                checked={form.requireVerification}
                onChange={(checked) => setForm((prev) => ({ ...prev, requireVerification: checked }))}
              />
              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">Member Lookup</p>
                <p className="text-xs text-muted-foreground">
                  Open the Member Lookup tab to resolve a Discord id through Bloxlink and read its public Roblox
                  profile. The Test button above verifies the configured key and guild.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Linked accounts ------------------------------------------------ */}
        <TabsContent value="links" className="space-y-4 pt-4">
          <LinkedAccounts />
        </TabsContent>

        {/* Member lookup -------------------------------------------------- */}
        <TabsContent value="lookup" className="space-y-4 pt-4">
          <MemberLookup />
        </TabsContent>

        {/* Verification --------------------------------------------------- */}
        <TabsContent value="verification" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Verification requirements</CardTitle>
              <CardDescription>
                The bot does not verify Roblox accounts itself; it points members at Bloxlink and reads the result.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channels">Verified-only channel IDs</Label>
                <Input
                  id="channels"
                  placeholder="123456789012345678, 987654321098765432"
                  value={form.verifiedOnlyChannels}
                  onChange={(e) => setForm((prev) => ({ ...prev, verifiedOnlyChannels: e.target.value }))}
                  data-testid="input-verified-channels"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated channel ids. Leave empty with verification required to gate <em>all</em> commands
                  except the Roblox-linking ones.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="verificationChannel">Verification channel</Label>
                  <Input
                    id="verificationChannel"
                    placeholder="123456789012345678"
                    value={form.verificationChannelId}
                    onChange={(e) => setForm((prev) => ({ ...prev, verificationChannelId: e.target.value }))}
                    data-testid="input-verification-channel"
                  />
                  <p className="text-xs text-muted-foreground">Shown in the &amp;roblox verify reply.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="verifiedRole">Verified role (optional)</Label>
                  <Input
                    id="verifiedRole"
                    placeholder="Role ID"
                    value={form.verifiedRoleId}
                    onChange={(e) => setForm((prev) => ({ ...prev, verifiedRoleId: e.target.value }))}
                    data-testid="input-verified-role"
                  />
                  <p className="text-xs text-muted-foreground">
                    Recorded for reference only. Role assignment stays with Bloxlink; this bot does not sync roles.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Feature Access
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  🎮 Roblox Verified — {form.requireVerification ? "Required" : "Not required"}. Members without a
                  Bloxlink-linked account cannot use the gated features.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Roblox profile ------------------------------------------------- */}
        <TabsContent value="profile" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Roblox profile display</CardTitle>
              <CardDescription>How Roblox information appears in the bot's responses.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayMode">Display mode</Label>
                <Select
                  value={form.displayMode}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, displayMode: value as "compact" | "full" }))}
                >
                  <SelectTrigger id="displayMode" data-testid="select-display-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">Compact — one Roblox line on &amp;profile</SelectItem>
                    <SelectItem value="full">Full — dedicated &amp;roblox profile embed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
{`🎮 Roblox Profile

Discord
@ExampleUser

Roblox
ExamplePlayer

Bloxlink
✓ Linked`}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">
                The compact line is added only when Bloxlink confirms a link. An unlinked member's profile is unchanged.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications -------------------------------------------------- */}
        <TabsContent value="notifications" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Notifications</CardTitle>
              <CardDescription>
                Sent on a link change, not on every check. A stable link posts nothing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Verification notifications"
                detail="Notify when a member links, unlinks, changes status, or Bloxlink fails."
                checked={form.notifyOnLink}
                onChange={(checked) => setForm((prev) => ({ ...prev, notifyOnLink: checked }))}
              />
              <div className="space-y-2">
                <Label htmlFor="notifyChannel">Notification channel ID</Label>
                <Input
                  id="notifyChannel"
                  placeholder="123456789012345678"
                  value={form.notifyChannelId}
                  onChange={(e) => setForm((prev) => ({ ...prev, notifyChannelId: e.target.value }))}
                  data-testid="input-notify-channel"
                />
                <p className="text-xs text-muted-foreground">Leave empty to disable notifications.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings ------------------------------------------------------- */}
        <TabsContent value="settings" className="space-y-4 pt-4">
          <Card id="roblox-settings">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="h-5 w-5 text-primary" />
                Roblox Settings
              </CardTitle>
              <CardDescription>Master switches. Administrator permissions are unchanged by these.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Enable Roblox integration"
                detail="The master switch for every Roblox feature."
                checked={form.enabled}
                onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
              />
              <ToggleRow
                label="Enable Bloxlink integration"
                detail="Whether the bot may ask Bloxlink at all."
                checked={form.bloxlinkEnabled}
                onChange={(checked) => setForm((prev) => ({ ...prev, bloxlinkEnabled: checked }))}
              />
              <ToggleRow
                label="Show Roblox profile information"
                detail="Add the Roblox field to profiles."
                checked={form.showOnProfiles}
                onChange={(checked) => setForm((prev) => ({ ...prev, showOnProfiles: checked }))}
              />
              <ToggleRow
                label="Require Bloxlink verification"
                detail="Gate the configured features behind a linked account."
                checked={form.requireVerification}
                onChange={(checked) => setForm((prev) => ({ ...prev, requireVerification: checked }))}
              />
              <ToggleRow
                label="Verification notifications"
                detail="Post link changes to the notification channel."
                checked={form.notifyOnLink}
                onChange={(checked) => setForm((prev) => ({ ...prev, notifyOnLink: checked }))}
              />
              <div className="space-y-2">
                <Label htmlFor="unverifiedRole">Unverified role (optional)</Label>
                <Input
                  id="unverifiedRole"
                  placeholder="Role ID"
                  value={form.unverifiedRoleId}
                  onChange={(e) => setForm((prev) => ({ ...prev, unverifiedRoleId: e.target.value }))}
                  data-testid="input-unverified-role"
                />
                <p className="text-xs text-muted-foreground">
                  Recorded for reference. Role changes remain Bloxlink's responsibility.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                API keys are never exposed here. The Bloxlink key lives only in the server environment.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Changes are read from the database; the bot does not need a restart.
        </p>
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-roblox-settings"
        >
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Bloxlink test */

function BloxlinkTestButton() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/roblox/test", "POST", {});
      return response.json();
    },
    onSuccess: (data: any) => {
      setResult({ ok: Boolean(data.ok), message: data.message || "No response" });
      toast({
        title: data.ok ? "Bloxlink reachable" : "Bloxlink not reachable",
        description: data.message,
        variant: data.ok ? "success" : "error",
      });
    },
    onError: (error: any) => {
      setResult({ ok: false, message: error.message });
      toast({ title: "Test failed", description: error.message, variant: "error" });
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => testMutation.mutate()}
        disabled={testMutation.isPending}
        data-testid="button-bloxlink-test"
      >
        {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
        Test
      </Button>
      {result && (
        <span className={`text-[11px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ linked accounts */

function LinkedAccounts() {
  const [status, setStatus] = useState("all");
  const { data, isLoading } = useQuery<{ links: LinkRow[] }>({
    queryKey: ["roblox-links", status],
    queryFn: async () => {
      const query = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
      const response = await fetch(`/api/admin/roblox/links${query}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load linked accounts");
      return response.json();
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Linked accounts</CardTitle>
          <CardDescription>Cached Bloxlink results. A check refreshes after the cache TTL.</CardDescription>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="select-link-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
            <SelectItem value="not_linked">Not Linked</SelectItem>
            <SelectItem value="verification_unavailable">Verification unavailable</SelectItem>
            <SelectItem value="bloxlink_unavailable">Bloxlink unavailable</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data?.links?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Discord User</TableHead>
                  <TableHead>Roblox User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Linked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.links.map((link) => (
                  <TableRow key={`${link.guildId}-${link.discordId}`}>
                    <TableCell className="font-mono text-xs">{link.discordId}</TableCell>
                    <TableCell>{link.robloxId || "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[link.status] || ""}`}>
                        {link.statusLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeDay(link.linkedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No accounts cached yet. They appear as members join or open their profile.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- member lookup */

function MemberLookup() {
  const [discordId, setDiscordId] = useState("");
  const [username, setUsername] = useState("");

  const memberMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const response = await fetch(
        `/api/admin/roblox/member/${encodeURIComponent(discordId.trim())}${force ? "?force=1" : ""}`,
        { credentials: "include" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Lookup failed");
      return body as MemberResult;
    },
  });

  const publicMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/roblox/public-lookup?username=${encodeURIComponent(username.trim())}`, {
        credentials: "include",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Lookup failed");
      return body as PublicLookup;
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            Member lookup (Bloxlink)
          </CardTitle>
          <CardDescription>Resolve a Discord member id to the Roblox account Bloxlink has linked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-2">
              <Label htmlFor="lookupDiscordId">Discord member ID</Label>
              <Input
                id="lookupDiscordId"
                placeholder="123456789012345678"
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                data-testid="input-member-discord-id"
              />
            </div>
            <Button
              type="button"
              onClick={() => memberMutation.mutate(false)}
              disabled={memberMutation.isPending || !discordId.trim()}
              data-testid="button-member-lookup"
            >
              {memberMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Look up
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => memberMutation.mutate(true)}
              disabled={memberMutation.isPending || !discordId.trim()}
              data-testid="button-member-lookup-live"
            >
              Live (bypass cache)
            </Button>
          </div>

          {memberMutation.data && <MemberResultCard result={memberMutation.data} />}
          {memberMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">{(memberMutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            Public Roblox lookup
          </CardTitle>
          <CardDescription>
            Resolves a Roblox username to a public account. This does <strong>not</strong> link it to Discord.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-2">
              <Label htmlFor="lookupUsername">Roblox username</Label>
              <Input
                id="lookupUsername"
                placeholder="builderman"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                data-testid="input-roblox-username"
              />
            </div>
            <Button
              type="button"
              onClick={() => publicMutation.mutate()}
              disabled={publicMutation.isPending || !username.trim()}
              data-testid="button-public-lookup"
            >
              {publicMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
          </div>

          {publicMutation.data && (
            <div className="rounded-lg border border-border p-4 text-sm">
              {publicMutation.data.found && publicMutation.data.profile ? (
                <div className="space-y-1">
                  <p className="font-medium">{publicMutation.data.profile.displayName || publicMutation.data.profile.username}</p>
                  <p className="text-xs text-muted-foreground">
                    Username: {publicMutation.data.profile.username} · ID: {publicMutation.data.profile.userId}
                  </p>
                  <p className="text-xs text-muted-foreground">Created: {formatDate(publicMutation.data.profile.created)}</p>
                  <a className="text-xs text-primary underline" href={publicMutation.data.profile.profileUrl} target="_blank" rel="noreferrer">
                    Open on Roblox
                  </a>
                </div>
              ) : (
                <p className={publicMutation.data.unavailable ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                  {publicMutation.data.message || "No results."}
                </p>
              )}
            </div>
          )}
          {publicMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">{(publicMutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberResultCard({ result }: { result: MemberResult }) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="member-lookup-result">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Bloxlink</span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[result.status] || ""}`}>
          {result.statusLabel}
        </span>
        <span className="text-xs text-muted-foreground">{result.cached ? "cached" : "checked just now"}</span>
      </div>

      {result.profile ? (
        <div className="flex items-start gap-3">
          {result.profile.avatarUrl && (
            <img src={result.profile.avatarUrl} alt="" className="h-12 w-12 rounded-lg" />
          )}
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">{result.profile.displayName || result.profile.username}</p>
            <p className="text-xs text-muted-foreground">
              Username: {result.profile.username} · ID: {result.profile.userId}
            </p>
            <p className="text-xs text-muted-foreground">Created: {formatDate(result.profile.created)}</p>
            <a className="text-xs text-primary underline" href={result.profile.profileUrl} target="_blank" rel="noreferrer">
              Open on Roblox
            </a>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {result.status === "linked"
            ? "Linked, but the public Roblox profile could not be read right now."
            : "No Roblox profile to show."}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- helpers */

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
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

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().slice(0, 10);
}

function relativeDay(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toISOString().slice(0, 10);
}
