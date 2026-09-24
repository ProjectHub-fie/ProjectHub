import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Check,
  Eye,
  EyeOff,
  Gauge,
  Hash,
  Loader2,
  Power,
  RefreshCw,
  Save,
  Webhook,
} from "lucide-react";
import { FaDiscord } from "react-icons/fa";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Discord bot configuration.
 *
 * The bot itself runs as a separate long-running process — a gateway connection
 * cannot live in a serverless function — so this page is the control plane: it
 * stores the channel, the webhook, the thresholds and the tier limits that the
 * bot reads, and it can exercise the configuration with a read-only usage preview
 * before any alert is allowed to fire.
 *
 * Secrets are never entered here. The bot token and the Neon API key are
 * environment configuration; this page only reports whether each one is present,
 * the same way the mail diagnostics report the Mailjet keys.
 */
type BotStatus = {
  enabled: boolean;
  prefix: string;
  botTokenConfigured: boolean;
  neonKeyConfigured: boolean;
  projectIdConfigured: boolean;
  destinations: { channel: boolean; webhook: boolean };
  neon: boolean;
};

type BotSettings = {
  enabled: boolean;
  prefix: string;
  alertChannelId: string | null;
  webhookConfigured: boolean;
  webhookPreview: string | null;
  alertThresholdPercent: number;
  alertCooldownMinutes: number;
  computeLimitSeconds: number;
  storageLimitBytes: number;
  transferLimitBytes: number;
  projectName: string | null;
  botTokenConfigured: boolean;
  neonKeyConfigured: boolean;
  alertState: Record<string, string>;
};

/** GB <-> bytes, so the tier limits can be edited in the units Neon reports. */
const BYTES_PER_GB = 1024 ** 3;
const bytesToGb = (bytes: number) => Number((Number(bytes || 0) / BYTES_PER_GB).toFixed(2));
const gbToBytes = (gb: string) => Math.max(0, Math.round(Number(gb || 0) * BYTES_PER_GB));

type UsagePreview = {
  projectId: string;
  window: { from: string; to: string };
  usage: Record<string, { used: number; formatted: string; limit: number; percent: number; level: string }>;
  level: string;
  wouldAlert: boolean;
  thresholdPercent: number;
  unavailable: { key: string; message: string }[];
};

const LEVEL_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  critical: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  exceeded: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export default function AdminBotPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<BotSettings>({
    queryKey: ["bot-settings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/bot/settings", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load bot settings");
      return response.json();
    },
  });

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["bot-status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/bot/status", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load bot status");
      return response.json();
    },
  });

  const [form, setForm] = useState({
    enabled: false,
    prefix: "&",
    alertChannelId: "",
    alertThresholdPercent: 80,
    alertCooldownMinutes: 360,
    computeLimitSeconds: 360000,
    storageGb: 0.5,
    transferGb: 5,
    projectName: "",
  });
  // The webhook is write-only: the server sends back a masked preview, and a new
  // value is only transmitted when the operator actually types one. Revealing it
  // toggles that off.
  const [webhook, setWebhook] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      prefix: settings.prefix || "&",
      alertChannelId: settings.alertChannelId || "",
      alertThresholdPercent: settings.alertThresholdPercent,
      alertCooldownMinutes: settings.alertCooldownMinutes,
      computeLimitSeconds: settings.computeLimitSeconds,
      storageGb: bytesToGb(settings.storageLimitBytes),
      transferGb: bytesToGb(settings.transferLimitBytes),
      projectName: settings.projectName || "",
    });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        enabled: form.enabled,
        prefix: form.prefix,
        alertChannelId: form.alertChannelId.trim(),
        alertThresholdPercent: form.alertThresholdPercent,
        alertCooldownMinutes: form.alertCooldownMinutes,
        computeLimitSeconds: form.computeLimitSeconds,
        storageLimitBytes: gbToBytes(String(form.storageGb)),
        transferLimitBytes: gbToBytes(String(form.transferGb)),
        projectName: form.projectName.trim(),
      };
      // Only send the webhook when a new value was typed, so saving another card
      // cannot clear it.
      if (webhook.trim()) body.alertWebhookUrl = webhook.trim();

      const response = await apiRequest("/api/admin/bot/settings", "PUT", body);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to save");
      return data;
    },
    onSuccess: () => {
      setWebhook("");
      toast({ title: "Bot settings saved", description: "The bot picks these up on its next refresh.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["bot-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["bot-status"] });
    },
    onError: (error: any) =>
      toast({ title: "Could not save", description: error.message, variant: "error" }),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/bot/usage-preview", "POST", {});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to read usage");
      return data as UsagePreview;
    },
    onError: (error: any) =>
      toast({ title: "Usage check failed", description: error.message, variant: "error" }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const preview = previewMutation.data;
  const ready = Boolean(status?.botTokenConfigured && status?.neonKeyConfigured && status?.projectIdConfigured);
  const hasDestination = Boolean(form.alertChannelId.trim() || settings?.webhookConfigured);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="admin-bot-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Bot className="h-6 w-6 text-primary" />
            Discord Bot
          </h1>
          <p className="text-muted-foreground">
            Configure the private server bot: usage alerts and the <code className="rounded bg-muted px-1">{form.prefix || "&"}dev</code> command.
          </p>
        </div>
        <Badge variant={status?.enabled ? "default" : "outline"} className="gap-1">
          <Power className="h-3 w-3" />
          {status?.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {/* Runtime readiness ------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile
          ok={Boolean(status?.botTokenConfigured)}
          label="Bot token"
          detail={status?.botTokenConfigured ? "DISCORD_BOT_TOKEN is set" : "Set DISCORD_BOT_TOKEN"}
        />
        <StatusTile
          ok={Boolean(status?.neonKeyConfigured)}
          label="Neon API key"
          detail={status?.neonKeyConfigured ? "NEON_API_KEY is set" : "Set NEON_API_KEY"}
        />
        <StatusTile
          ok={Boolean(status?.projectIdConfigured)}
          label="Neon project"
          detail={status?.projectIdConfigured ? "NEON_PROJECT_ID is set" : "Set NEON_PROJECT_ID"}
        />
      </div>

      {!ready && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The bot process needs the environment variables above. Until they are set the
            alert cannot read usage and the bot will not sign in.
          </span>
        </div>
      )}

      {/* General ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FaDiscord className="h-5 w-5 text-[#5865F2]" />
            General
          </CardTitle>
          <CardDescription>The command prefix and whether the bot answers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Enable the bot</p>
              <p className="text-xs text-muted-foreground">
                Turns message commands and the usage alert on or off.
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
              data-testid="bot-enabled-switch"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prefix">Command prefix</Label>
              <Input
                id="prefix"
                value={form.prefix}
                maxLength={4}
                onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
                data-testid="input-bot-prefix"
              />
              <p className="text-xs text-muted-foreground">
                Commands read <code className="rounded bg-muted px-1">{form.prefix || "&"}dev</code>.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectName">Project label</Label>
              <Input
                id="projectName"
                placeholder="ProjectHub database"
                value={form.projectName}
                onChange={(e) => setForm((prev) => ({ ...prev, projectName: e.target.value }))}
                data-testid="input-project-name"
              />
              <p className="text-xs text-muted-foreground">Shown in the alert embed. Falls back to Neon's name.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Destinations ----------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Webhook className="h-5 w-5 text-primary" />
            Alert destinations
          </CardTitle>
          <CardDescription>
            The embed is posted to both. They are independent, so one failing does not stop the other.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel" className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              Discord channel ID
            </Label>
            <Input
              id="channel"
              placeholder="123456789012345678"
              value={form.alertChannelId}
              onChange={(e) => setForm((prev) => ({ ...prev, alertChannelId: e.target.value }))}
              data-testid="input-alert-channel"
            />
            <p className="text-xs text-muted-foreground">
              Right-click a channel in Discord with Developer Mode on, then Copy Channel ID.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook">Webhook URL</Label>
            {settings?.webhookConfigured && !webhook && (
              <div className="flex items-center gap-2 rounded-md border border-border p-3">
                <Check className="h-4 w-4 text-emerald-500" />
                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {showWebhook ? "Configured (value is not sent to the browser)" : settings.webhookPreview}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowWebhook((v) => !v)}>
                  {showWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            )}
            <Input
              id="webhook"
              placeholder={settings?.webhookConfigured ? "Type a new URL to replace the existing one" : "https://discord.com/api/webhooks/..."}
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              data-testid="input-alert-webhook"
            />
            <p className="text-xs text-muted-foreground">
              The URL is a credential. It is stored server-side and never returned to the browser.
            </p>
          </div>

          {!hasDestination && form.enabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Set a channel or a webhook, otherwise the alert has nowhere to go.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Thresholds ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge className="h-5 w-5 text-primary" />
            Tier limits and threshold
          </CardTitle>
          <CardDescription>
            Neon reports what was consumed, not the plan ceiling, so the limits are entered here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="threshold">Alert threshold (%)</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={100}
                value={form.alertThresholdPercent}
                onChange={(e) => setForm((prev) => ({ ...prev, alertThresholdPercent: Number(e.target.value) }))}
                data-testid="input-threshold"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input
                id="cooldown"
                type="number"
                min={0}
                value={form.alertCooldownMinutes}
                onChange={(e) => setForm((prev) => ({ ...prev, alertCooldownMinutes: Number(e.target.value) }))}
                data-testid="input-cooldown"
              />
              <p className="text-xs text-muted-foreground">
                How long a metric stays quiet after it alerts. Without it, a sustained overage posts every poll.
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="compute">Compute limit (CU-seconds)</Label>
              <Input
                id="compute"
                type="number"
                min={0}
                value={form.computeLimitSeconds}
                onChange={(e) => setForm((prev) => ({ ...prev, computeLimitSeconds: Number(e.target.value) }))}
                data-testid="input-compute-limit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storage">Storage limit (GB)</Label>
              <Input
                id="storage"
                type="number"
                min={0}
                step="0.1"
                value={form.storageGb}
                onChange={(e) => setForm((prev) => ({ ...prev, storageGb: Number(e.target.value) }))}
                data-testid="input-storage-limit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer">Transfer limit (GB)</Label>
              <Input
                id="transfer"
                type="number"
                min={0}
                step="0.1"
                value={form.transferGb}
                onChange={(e) => setForm((prev) => ({ ...prev, transferGb: Number(e.target.value) }))}
                data-testid="input-transfer-limit"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Defaults match the Neon Free tier. Adjust these to the plan the project is actually on.
          </p>
        </CardContent>
      </Card>

      {/* Usage preview ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-primary" />
            Usage check
          </CardTitle>
          <CardDescription>
            Reads the live figures and shows what the alert would do, without sending anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !status?.neonKeyConfigured}
            data-testid="button-usage-preview"
          >
            {previewMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Check usage now
          </Button>

          {preview && (
            <div className="space-y-4" data-testid="usage-preview-result">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Overall</span>
                <Badge className={LEVEL_STYLES[preview.level] || ""}>{preview.level}</Badge>
                <span className="text-xs text-muted-foreground">
                  {preview.wouldAlert ? "An alert would fire at this level." : "Below the alert threshold."}
                </span>
              </div>

              {Object.entries(preview.usage).map(([key, metric]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                    <span className="text-muted-foreground">
                      {metric.formatted} · {metric.percent}%
                    </span>
                  </div>
                  <Progress value={Math.min(100, metric.percent)} className="h-2" />
                </div>
              ))}

              {preview.unavailable?.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Some metrics were unavailable: {preview.unavailable.map((u) => u.key).join(", ")}.
                  They are reported as zero this poll.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          The bot runs as a separate process; these settings are read from the database, so no restart is needed.
        </p>
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-bot-settings"
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save settings
        </Button>
      </div>
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
