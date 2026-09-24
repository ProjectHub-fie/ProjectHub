/**
 * Test runner console.
 *
 * Runs the repository's `tests/` folder from the admin dashboard and shows the
 * result. The server runs one fixed command — `node --test tests/` — and accepts
 * no input from this page, so there is nothing here to configure: a button, the
 * summary, and the raw output for when a test fails.
 *
 * Owner only. Executing code on the host is a different class of action from
 * configuring the bot or the mailbox, so the server guards these routes with
 * `requireRole('owner')`.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TestStatus = {
  available: boolean;
  running: boolean;
  command: string;
  timeoutMs: number;
};

type TestResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  summary: { tests: number | null; pass: number | null; fail: number | null; skipped: number | null };
  failures: string[];
  output: string;
  stderr: string;
};

/** Static Tailwind classes, looked up by severity, for the summary tiles. */
const TILE_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  fail: "bg-red-500/15 text-red-600 dark:text-red-400",
  skipped: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  neutral: "bg-muted text-muted-foreground",
};

function StatTile({ label, value, tone }: { label: string; value: number | null; tone: keyof typeof TILE_STYLES }) {
  return (
    <div className={`rounded-md p-3 ${TILE_STYLES[tone]}`}>
      <div className="text-2xl font-bold tabular-nums">{value ?? "—"}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

export default function AdminTestsPage() {
  const [result, setResult] = useState<TestResult | null>(null);

  const { data: status, isLoading } = useQuery<TestStatus>({
    queryKey: ["tests-status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/tests/status", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to read test-runner status");
      return response.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/tests/run", {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `The run failed (${response.status})`);
      return body as TestResult;
    },
    onSuccess: (data) => setResult(data),
  });

  // Clear the previous result when a new run starts, so a stale green summary is
  // never visible next to a spinner.
  useEffect(() => {
    if (runMutation.isPending) setResult(null);
  }, [runMutation.isPending]);

  const headline = useMemo(() => {
    if (!result) return null;
    if (result.timedOut) return { tone: "fail" as const, text: `Timed out after ${Math.round(result.durationMs / 1000)}s` };
    if (result.ok) return { tone: "ok" as const, text: `Passed in ${(result.durationMs / 1000).toFixed(2)}s` };
    return { tone: "fail" as const, text: `Failed (exit ${result.exitCode})` };
  }, [result]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="admin-tests-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FlaskConical className="h-6 w-6 text-primary" />
            Tests
          </h1>
          <p className="text-muted-foreground">
            Run the repository's test folder against this deployment.
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !status?.available}
          data-testid="button-run-tests"
        >
          {runMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {runMutation.isPending ? "Running…" : "Run tests"}
        </Button>
      </div>

      {/* The exact command, shown so there is no doubt what the button does. */}
      <div className="rounded-md border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Runs exactly this, with no arguments from this page:</p>
        <code className="mt-1 block font-mono text-xs" data-testid="tests-command">
          {status?.command || "node --test tests/"}
        </code>
      </div>

      {status && !status.available && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The <code>tests/</code> folder is excluded from this deployment, so the suite
            cannot run here. This works on a long-lived host or locally.
          </span>
        </div>
      )}

      {runMutation.isError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{(runMutation.error as Error).message}</span>
        </div>
      )}

      {result && (
        <Card data-testid="test-run-result">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {result.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                {headline?.text}
              </CardTitle>
              <Badge variant="outline">{(result.durationMs / 1000).toFixed(2)}s</Badge>
            </div>
            <CardDescription>
              Node test runner, run once. The list below is what this deployment reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Tests" value={result.summary.tests} tone="neutral" />
              <StatTile label="Passed" value={result.summary.pass} tone="ok" />
              <StatTile label="Failed" value={result.summary.fail} tone={result.summary.fail ? "fail" : "neutral"} />
              <StatTile label="Skipped" value={result.summary.skipped} tone="skipped" />
            </div>

            {result.failures.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Failing tests</p>
                {result.failures.map((name) => (
                  <p key={name} className="font-mono text-xs text-muted-foreground">
                    {name}
                  </p>
                ))}
              </div>
            )}

            {/* Skipped tests are normal here: the auth and mail flows need a real
                database, and admin login needs credentials. */}
            <p className="text-xs text-muted-foreground">
              Skipped tests are expected when a database or admin credentials are not
              configured in this environment.
            </p>

            <details className="rounded-md border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Raw output</summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                {result.output}
              </pre>
            </details>

            {result.stderr && (
              <details className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">stderr</summary>
                <pre className="max-h-48 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                  {result.stderr}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
