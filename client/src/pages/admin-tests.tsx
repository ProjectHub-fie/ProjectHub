/**
 * Test runner console.
 *
 * Runs the repository's test suite on GitHub Actions and shows the workflow's
 * progress and outcome. The server dispatches a fixed workflow
 * (`docker-tests.yml`) whose input is a server-generated `request_id`; it
 * accepts nothing from this page except the click itself. Docker execution
 * happens on GitHub-hosted runners, never on Vercel.
 *
 * Owner only. Triggering CI from a dashboard is a different class of action from
 * configuring the bot or the mailbox, so the server guards these routes with
 * `requireRole('owner')`.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TestStatus = {
  available: boolean;
  running: boolean;
  mode?: "github-actions" | "local" | "docker" | "unavailable" | string;
  configured: boolean;
  repository: string;
  workflowFile: string;
  workflowBranch: string;
  command: string;
  repositoryId: string;
  repositories: Array<{
    id: string;
    name: string;
    repository: string;
    testRunner: string;
    command: string;
  }>;
  timeoutMs: number;
  pollIntervalMs: number;
  activeRun?: TestRun;
  lastRun?: TestRun;
};

type TestRun = {
  requestId: string;
  runId: number | null;
  repositoryId: string | null;
  repository: string | null;
  branch: string | null;
  headSha: string | null;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | string | null;
  running: boolean;
  completed: boolean;
  timedOut: boolean;
  htmlUrl: string | null;
  displayTitle: string | null;
  createdAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: { tests: number | null; pass: number | null; fail: number | null; skipped: number | null };
  failures: string[];
  output: string;
  resultsUnavailable?: boolean;
  poll: { intervalMs: number; timeoutMs: number };
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

/** Reads a run's failure/success into a headline, or null while still running. */
function headlineFor(run: TestRun | undefined): { tone: keyof typeof TILE_STYLES; text: string } | null {
  if (!run) return null;
  if (run.timedOut) return { tone: "fail", text: `Timed out after ${Math.round((run.durationMs ?? 0) / 1000)}s` };
  if (!run.completed) return { tone: "neutral", text: run.status === "queued" ? "Queued on GitHub Actions…" : "Running on GitHub Actions…" };
  if (run.conclusion === "success") {
    const seconds = run.durationMs ? (run.durationMs / 1000).toFixed(2) : null;
    return { tone: "ok", text: seconds ? `Passed in ${seconds}s` : "Passed" };
  }
  if (run.conclusion === "cancelled") return { tone: "neutral", text: "Cancelled" };
  return { tone: "fail", text: run.conclusion === "timed_out" ? "Timed out on GitHub" : `Failed (${run.conclusion ?? "unknown"})` };
}

export default function AdminTestsPage() {
  const [result, setResult] = useState<TestRun | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const activeRunRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<TestStatus>({
    queryKey: ["tests-status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/tests/status", { credentials: "include" });
      if (!response.ok) {
        let message = `Failed to read test-runner status (${response.status})`;
        try {
          const body = await response.json();
          if (body?.message) message = body.message;
        } catch {
          /* non-JSON body */
        }
        setStatusError(message);
        throw new Error(message);
      }
      setStatusError(null);
      const body: TestStatus = await response.json();

      // Reconcile the local result with the server's active/last run so a page
      // refresh shows the latest state and a completed run becomes `result`.
      if (body.activeRun) {
        setResult(body.activeRun);
        activeRunRef.current = body.activeRun.requestId;
      } else if (body.lastRun && body.lastRun.completed) {
        setResult(body.lastRun);
        activeRunRef.current = null;
      }
      return body;
    },
    // While a run is active the page polls; a run that is terminal but whose
    // summary has not been read yet keeps polling too, because the artifact can
    // appear a moment after the run completes. Once the results are in, polling
    // stops.
    refetchInterval: (query) => {
      const active = query.state.data?.activeRun;
      if (active && !active.completed) return active.poll.intervalMs || 4000;
      const last = query.state.data?.lastRun;
      if (!active && last?.completed && last.resultsUnavailable) {
        return last.poll?.intervalMs || 4000;
      }
      return false;
    },
  });

  // The repository the next run dispatches against. Defaults to the server's
  // configured profile; the selector below overrides it before dispatch.
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const activeRepoId =
    status?.activeRun?.repositoryId ||
    status?.lastRun?.repositoryId ||
    status?.repositoryId ||
    null;
  const repositoryId = selectedRepoId || activeRepoId || status?.repositories?.[0]?.id || "projecthub";

  const runMutation = useMutation({
    mutationFn: async (repoId: string) => {
      const response = await fetch("/api/admin/tests/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: repoId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || `The run failed (${response.status})`);
      }
      return body as TestRun;
    },
    onSuccess: (data) => {
      setResult(data);
      activeRunRef.current = data.requestId;
      // The dispatch response has no `activeRun` yet (get status would show
      // running once the poll finds the run). Refetch immediately so the query
      // cache carries `activeRun` and the interval polling below takes over.
      queryClient.invalidateQueries({ queryKey: ["tests-status"] });
    },
    onError: (error) => setStatusError((error as Error).message),
  });

  // Clear the result while a fresh dispatch is in flight, but keep an already
  // running workflow visible so a stale summary never sits under the spinner.
  const dispatchPending = runMutation.isPending && !status?.activeRun;
  useEffect(() => {
    if (dispatchPending) setResult(null);
  }, [dispatchPending]);

  // Derive what to show from the freshest source: the running server state, the
  // dispatch response, or the last completed run.
  const shown = status?.activeRun || result || status?.lastRun || null;
  const showError = Boolean(statusError);

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
            Run a connected repository's test suite on GitHub Actions.
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate(repositoryId)}
          disabled={runMutation.isPending || !status?.available || Boolean(status?.activeRun)}
          data-testid="button-run-tests"
        >
          {runMutation.isPending || status?.activeRun ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {runMutation.isPending || status?.activeRun ? "Running…" : "Run tests"}
        </Button>
      </div>

      {/* Repository selection, driven by the server's profile registry. The
          chosen repository is the only thing the page sends; workflow, branch
          and command all come from the server profile. */}
      {Array.isArray(status?.repositories) && status.repositories.length > 1 && (
        <div className="grid gap-1.5" data-testid="repository-selector">
          <Label htmlFor="test-repository" className="text-sm font-medium">
            Repository
          </Label>
          <Select
            value={repositoryId}
            onValueChange={(id) => setSelectedRepoId(id)}
            disabled={Boolean(status.activeRun) || runMutation.isPending}
          >
            <SelectTrigger id="test-repository" className="w-full sm:w-80 md:max-w-xs">
              <SelectValue placeholder="Choose a repository" />
            </SelectTrigger>
            <SelectContent>
              {status.repositories.map((repo) => (
                <SelectItem key={repo.id} value={repo.id}>
                  {repo.name}
                  <span className="ml-1 font-mono text-muted-foreground">({repo.repository})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* The exact command the GitHub runner fragments. The workflow runs the
          same command with no inputs from this page, other than the selected
          repository id. */}
      <div className="rounded-md border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          Runs exactly this on a GitHub-hosted runner, with no arguments from this page:
        </p>
        <code className="mt-1 block font-mono text-xs" data-testid="tests-command">
          {status?.command || "docker compose --profile tests run --rm --build tests"}
        </code>
      </div>

      {status?.mode === "github-actions" && status?.configured && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-700 dark:text-sky-400">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Execution happens on <strong>GitHub Actions</strong>, not on Vercel. The workflow{" "}
            <code>{status.workflowFile}</code> checks out <code>{status.repository}</code>{" "}
            ({status.workflowBranch}) and runs the command above.
          </span>
        </div>
      )}

      {status && !status.available && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            GitHub Actions is not configured for this deployment. Set{" "}
            <code>GITHUB_ACTIONS_TOKEN</code> on the Vercel function to enable the test runner.
          </span>
        </div>
      )}

      {showError && statusError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusError}</span>
        </div>
      )}

      {shown && (
        <Card data-testid="test-run-result">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {shown.completed && shown.conclusion === "success" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : shown.completed ? (
                  <XCircle className="h-5 w-5 text-red-500" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                {headlineFor(shown)?.text}
              </CardTitle>
              <div className="flex items-center gap-2">
                {shown.htmlUrl && (
                  <a
                    href={shown.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                    data-testid="github-run-link"
                  >
                    GitHub run {shown.runId ?? ""}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {shown.durationMs != null && <Badge variant="outline">{(shown.durationMs / 1000).toFixed(2)}s</Badge>}
              </div>
            </div>
            <CardDescription>
              {shown.completed
                ? shown.resultsUnavailable
                  ? "The run finished, but its test summary could not be read from GitHub."
                  : `Test runner finished with ${shown.conclusion ?? "unknown conclusion"}.`
                : "The suite runs on GitHub Actions; the dashboard polls until it finishes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Run identity: repository, branch, commit SHA, and the GitHub link. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground" data-testid="run-repository">
                {shown.repositoryId ? shown.repository : (status?.repository ?? "repository")}
              </span>
              {shown.branch && (
                <Badge variant="outline" className="font-mono">branch {shown.branch}</Badge>
              )}
              {shown.headSha && (
                <span className="font-mono" data-testid="run-commit-sha">{shown.headSha.slice(0, 7)}</span>
              )}
              <span>{new Date(shown.createdAt || Date.now()).toLocaleString()}</span>
            </div>
            {shown.resultsUnavailable && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
                data-testid="tests-results-unavailable"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  The run's conclusion is above, but its per-test counts are not available. The
                  TAP artifact may have expired, or the job log could not be read. Open the GitHub
                  run for the full output.
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Tests" value={shown.summary.tests} tone="neutral" />
              <StatTile label="Passed" value={shown.summary.pass} tone="ok" />
              <StatTile label="Failed" value={shown.summary.fail} tone={shown.summary.fail ? "fail" : "neutral"} />
              <StatTile label="Skipped" value={shown.summary.skipped} tone="skipped" />
            </div>

            {Array.isArray(shown.failures) && shown.failures.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Failing tests</p>
                {shown.failures.map((name) => (
                  <p key={name} className="font-mono text-xs text-muted-foreground">
                    {name}
                  </p>
                ))}
              </div>
            )}

            {/* Skipped tests are normal: auth/mail flows need a database and admin
                credentials, which the compose db supplies. */}
            <p className="text-xs text-muted-foreground">
              Skipped tests are expected when a database or admin credentials are not
              configured in this environment.
            </p>

            {shown.output && (
              <details className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Raw output</summary>
                <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                  {shown.output}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
