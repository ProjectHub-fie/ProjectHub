import { useEffect, useState } from "react";
import { Bell, Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { mailApi, type MailSignature, type MailTemplate, type NotificationSettings } from "@/lib/mail-api";
import {
  currentPermission,
  ensurePushSubscription,
  requestPermission,
  resetPromptDismissal,
} from "@/lib/mail-notifications";

/**
 * Mail settings: signature, templates and notification preferences.
 *
 * Notification preferences are written per administrator. The server derives the
 * admin id from the session, so one administrator can neither read nor change
 * another's settings from here.
 */
export function MailSettingsPanel({ onTemplatesChanged }: { onTemplatesChanged?: () => void }) {
  const { toast } = useToast();
  const [signature, setSignature] = useState<MailSignature | null>(null);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [permission, setPermission] = useState(currentPermission());
  const [savingSignature, setSavingSignature] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState({ name: "", category: "general", subject: "", bodyHtml: "" });
  const [mailjetRecipient, setMailjetRecipient] = useState("");
  const [testingMailjet, setTestingMailjet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sig, tpl, notif] = await Promise.all([
          mailApi.signature(),
          mailApi.templates(),
          mailApi.notificationSettings(),
        ]);
        if (cancelled) return;
        setSignature(sig);
        setTemplates(tpl);
        setSettings(notif);
      } catch {
        // A moderator session receives 403 here; the panel simply stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSignature = async () => {
    if (!signature) return;
    setSavingSignature(true);
    try {
      const saved = await mailApi.saveSignature(signature);
      setSignature(saved);
      toast({ title: "Signature saved", variant: "success" });
    } catch (error: any) {
      toast({ title: "Could not save signature", description: error.message, variant: "error" });
    } finally {
      setSavingSignature(false);
    }
  };

  const saveSettings = async (next: NotificationSettings) => {
    // Optimistic: the switch is local UI state until the server confirms.
    setSettings(next);
    setSavingSettings(true);
    try {
      const saved = await mailApi.saveNotificationSettings(next);
      setSettings(saved);
    } catch (error: any) {
      toast({ title: "Could not save preferences", description: error.message, variant: "error" });
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleSetting = (key: keyof NotificationSettings) => {
    if (!settings) return;
    void saveSettings({ ...settings, [key]: !settings[key] });
  };

  const enableDesktop = async () => {
    resetPromptDismissal();
    const result = await requestPermission();
    setPermission(result);
    if (result !== "granted" || !settings) return;

    // Permission, the stored preference and a real subscription move together:
    // flipping the preference without registering a subscription is what made
    // desktop alerts silently never arrive.
    const subscribed = await ensurePushSubscription();
    await saveSettings({ ...settings, desktopEnabled: subscribed });
    if (!subscribed) {
      toast({
        title: "Desktop alerts unavailable",
        description: "Push could not be set up in this browser. The in-app badge still works.",
        variant: "error",
      });
    }
  };

  const disableDesktop = async () => {
    // Drop the browser subscription as well as the preference, so a later
    // re-enable starts from a clean subscription rather than a stale one.
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await mailApi.pushUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
    } catch {
      // A failure here only leaves a subscription the preference now suppresses.
    }
    if (settings) await saveSettings({ ...settings, desktopEnabled: false });
  };

  const createTemplate = async () => {
    if (!draftTemplate.name.trim()) return;
    try {
      const created = await mailApi.createTemplate(draftTemplate);
      setTemplates((current) => [...current, created]);
      setDraftTemplate({ name: "", category: "general", subject: "", bodyHtml: "" });
      onTemplatesChanged?.();
      toast({ title: "Template created", variant: "success" });
    } catch (error: any) {
      toast({ title: "Could not create template", description: error.message, variant: "error" });
    }
  };

  const duplicateTemplate = async (id: string) => {
    try {
      const copy = await mailApi.duplicateTemplate(id);
      setTemplates((current) => [...current, copy]);
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({ title: "Could not duplicate", description: error.message, variant: "error" });
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      await mailApi.deleteTemplate(id);
      setTemplates((current) => current.filter((template) => template.id !== id));
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({ title: "Could not delete", description: error.message, variant: "error" });
    }
  };

  /**
   * Sends a real message through Mailjet and reports what Mailjet answered.
   * A throw here is the server saying Mailjet did not accept it, so the toast
   * must never claim the message was sent.
   */
  const runMailjetTest = async () => {
    const recipient = mailjetRecipient.trim();
    if (!recipient) {
      toast({ title: "Enter a test recipient", variant: "error" });
      return;
    }
    setTestingMailjet(true);
    try {
      const result = await mailApi.mailjetTest(recipient);
      toast({
        title: "Mailjet accepted the test",
        description: `Message ID ${result.messageId ?? "unknown"} from ${result.sender ?? "the configured sender"}. Delivery is reported in Mailjet statistics.`,
        variant: "success",
      });
    } catch (error: any) {
      toast({
        title: "Mailjet did not accept the test",
        description: error.message || "The request was rejected",
        variant: "error",
      });
    } finally {
      setTestingMailjet(false);
    }
  };

  return (
    <Tabs defaultValue="signature" className="flex h-full min-h-0 flex-col">
      <TabsList className="mx-4 mt-4 w-fit shrink-0">
        <TabsTrigger value="signature">Signature</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="diagnostics" data-testid="mail-diagnostics-tab">Diagnostics</TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* ---------------------------------------------------------- signature */}
        <TabsContent value="signature" className="mt-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Email signature</CardTitle>
              <p className="text-xs text-muted-foreground">
                Appended to messages when "Signature" is enabled in the composer.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sig-name">Name</Label>
                  <Input id="sig-name" value={signature?.name || ""} onChange={(event) => setSignature((current) => current && { ...current, name: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sig-position">Position</Label>
                  <Input id="sig-position" value={signature?.position || ""} onChange={(event) => setSignature((current) => current && { ...current, position: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sig-company">Company</Label>
                  <Input id="sig-company" value={signature?.company || ""} onChange={(event) => setSignature((current) => current && { ...current, company: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sig-website">Website</Label>
                  <Input id="sig-website" value={signature?.website || ""} onChange={(event) => setSignature((current) => current && { ...current, website: event.target.value })} placeholder="projecthub.example" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sig-github">GitHub</Label>
                  <Input
                    id="sig-github"
                    value={signature?.socialLinks?.GitHub || ""}
                    onChange={(event) => setSignature((current) => current && { ...current, socialLinks: { ...current.socialLinks, GitHub: event.target.value } })}
                    placeholder="https://github.com/…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sig-linkedin">LinkedIn</Label>
                  <Input
                    id="sig-linkedin"
                    value={signature?.socialLinks?.LinkedIn || ""}
                    onChange={(event) => setSignature((current) => current && { ...current, socialLinks: { ...current.socialLinks, LinkedIn: event.target.value } })}
                    placeholder="https://linkedin.com/in/…"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Append by default</p>
                  <p className="text-xs text-muted-foreground">The composer can still turn it off per message.</p>
                </div>
                <Switch
                  checked={signature?.enabled !== false}
                  onCheckedChange={(checked) => setSignature((current) => current && { ...current, enabled: checked })}
                  aria-label="Append signature by default"
                />
              </div>

              <Button size="sm" onClick={saveSignature} disabled={savingSignature || !signature}>
                {savingSignature ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save signature
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- templates */}
        <TabsContent value="templates" className="mt-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">New template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-name">Name</Label>
                  <Input id="tpl-name" value={draftTemplate.name} onChange={(event) => setDraftTemplate((current) => ({ ...current, name: event.target.value }))} placeholder="Project Request Response" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-category">Category</Label>
                  <Input id="tpl-category" value={draftTemplate.category} onChange={(event) => setDraftTemplate((current) => ({ ...current, category: event.target.value }))} placeholder="general" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-subject">Subject</Label>
                  <Input id="tpl-subject" value={draftTemplate.subject} onChange={(event) => setDraftTemplate((current) => ({ ...current, subject: event.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-body">Body (HTML)</Label>
                <Textarea
                  id="tpl-body"
                  rows={5}
                  value={draftTemplate.bodyHtml}
                  onChange={(event) => setDraftTemplate((current) => ({ ...current, bodyHtml: event.target.value }))}
                  placeholder="<p>Thanks for reaching out…</p>"
                  className="font-mono text-xs"
                />
              </div>
              <Button size="sm" onClick={createTemplate} disabled={!draftTemplate.name.trim()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Create template
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {templates.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">No templates yet.</p>
            )}
            {templates.map((template) => (
              <Card key={template.id}>
                <CardContent className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{template.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {template.category} {template.subject ? `· ${template.subject}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateTemplate(template.id)} aria-label={`Duplicate ${template.name}`}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteTemplate(template.id)} aria-label={`Delete ${template.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ------------------------------------------------------ notifications */}
        <TabsContent value="notifications" className="mt-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Notify me about</CardTitle>
              <p className="text-xs text-muted-foreground">These apply to your account only.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {settings &&
                ([
                  ["notifyNewEmail", "New incoming email"],
                  ["notifyProjectRequest", "New project request"],
                  ["notifyReply", "Email reply"],
                  ["notifyImportant", "Mention / important notification"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between border-b border-border pb-3 last:border-b-0 last:pb-0">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={Boolean(settings[key])}
                      onCheckedChange={() => toggleSetting(key)}
                      aria-label={label}
                    />
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <p className="text-sm">Desktop notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {permission === "granted"
                      ? "Allowed by this browser."
                      : permission === "denied"
                        ? "Blocked in this browser. Re-enable it in the site's notification settings."
                        : permission === "unsupported"
                          ? "This browser does not support notifications."
                          : "The browser will ask for permission once you enable this."}
                  </p>
                </div>
                {permission === "granted" ? (
                  <Switch
                    checked={Boolean(settings?.desktopEnabled)}
                    // Turning it on re-ensures a subscription; turning it off
                    // removes both the subscription and the preference, so the
                    // two can never drift apart.
                    onCheckedChange={(next) => void (next ? enableDesktop() : disableDesktop())}
                    aria-label="Desktop notifications"
                  />
                ) : (
                  <Button size="sm" variant="outline" onClick={enableDesktop} disabled={permission === "unsupported"} data-testid="mail-enable-desktop">
                    <Bell className="mr-1.5 h-3.5 w-3.5" /> Enable
                  </Button>
                )}
              </div>

              {settings &&
                ([
                  ["soundEnabled", "Sound"],
                  ["badgeEnabled", "Badge count"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between border-b border-border pb-3 last:border-b-0 last:pb-0">
                    <span className="text-sm">{label}</span>
                    <Switch checked={Boolean(settings[key])} onCheckedChange={() => toggleSetting(key)} aria-label={label} />
                  </div>
                ))}

              {savingSettings && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- diagnostics */}
        <TabsContent value="diagnostics" className="mt-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Mailjet test send</CardTitle>
              <p className="text-xs text-muted-foreground">
                Sends one minimal message through the deployed Mailjet credentials and reports what
                Mailjet answered. Acceptance is not the same as delivery — open the Mailjet dashboard
                for that.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mailjet-test-recipient">Test recipient</Label>
                <Input
                  id="mailjet-test-recipient"
                  type="email"
                  value={mailjetRecipient}
                  onChange={(event) => setMailjetRecipient(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button size="sm" onClick={runMailjetTest} disabled={testingMailjet}>
                {testingMailjet ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Send test through Mailjet
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </div>
    </Tabs>
  );
}


