import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { VerifiedProject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Search, CheckCircle, Pencil, Globe, Github, Upload, X, ImageIcon, Smartphone, Monitor, AlertCircle } from "lucide-react";
import { downloadUrlProblem, sha256Problem, MEGA_DOWNLOAD_HOSTS } from "@/lib/download-links";

const CATEGORIES = ["websites", "bots", "utilities"] as const;
const STATUSES = ["active", "developing", "live", "beta", "archived"] as const;

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  live: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  beta: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  developing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const CATEGORY_COLORS: Record<string, string> = {
  websites: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  bots: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  utilities: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
};

type FormData = {
  slug: string;
  title: string;
  description: string;
  longDescription: string;
  imageUrl: string;
  category: string;
  technologies: string;
  features: string;
  highlights: string;
  liveUrl: string;
  githubUrl: string;
  status: string;
  authorName: string;
  authorAvatar: string;
  architecture: string;
  timeline: string;
  teamSize: string;
  userCount: string;
  appVersion: string;
  appSize: string;
  platforms: string;
  requirements: string;
  releaseNotes: string;
  screenshots: string;
  androidDownloadUrl: string;
  windowsDownloadUrl: string;
  androidPackageName: string;
  androidSha256: string;
  androidReleaseDate: string;
  windowsPackageName: string;
  windowsSha256: string;
  windowsReleaseDate: string;
  githubReleasesFallback: boolean;
  isActive: boolean;
  sortOrder: number;
};

const emptyForm: FormData = {
  slug: "",
  title: "",
  description: "",
  longDescription: "",
  imageUrl: "",
  category: "websites",
  technologies: "",
  features: "",
  highlights: "",
  liveUrl: "",
  githubUrl: "",
  status: "active",
  authorName: "",
  authorAvatar: "",
  architecture: "",
  timeline: "",
  teamSize: "",
  userCount: "",
  appVersion: "",
  appSize: "",
  platforms: "",
  requirements: "",
  releaseNotes: "",
  screenshots: "",
  androidDownloadUrl: "",
  windowsDownloadUrl: "",
  androidPackageName: "",
  androidSha256: "",
  androidReleaseDate: "",
  windowsPackageName: "",
  windowsSha256: "",
  windowsReleaseDate: "",
  githubReleasesFallback: false,
  isActive: true,
  sortOrder: 0,
};

function toArrayField(val: string | null | undefined): string[] | null {
  if (!val || val.trim() === "") return null;
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

function fromArrayField(arr: string[] | null | undefined): string {
  if (!arr) return "";
  return arr.join(", ");
}

/** Reads one per-platform fact out of the stored `downloadDetails` blob. */
function platformDetailField(
  p: VerifiedProject,
  platform: "android" | "windows",
  field: string,
): string {
  const details = p.downloadDetails;
  if (!details || typeof details !== "object") return "";
  const entry = (details as Record<string, Record<string, unknown>>)[platform];
  const value = entry?.[field];
  return typeof value === "string" ? value : "";
}

/**
 * Builds the per-platform fact blob from the form.
 *
 * Only the platforms that have a link are written: facts for a platform with no
 * installer would never be shown, and keeping them would mean a stale package
 * name reappearing if the link is removed and added back.
 */
function buildDownloadDetails(f: FormData): Record<string, Record<string, string>> | null {
  const details: Record<string, Record<string, string>> = {};

  const add = (platform: "android" | "windows", packageName: string, sha256: string, releaseDate: string) => {
    const entry: Record<string, string> = {};
    if (packageName.trim()) entry.packageName = packageName.trim();
    if (releaseDate.trim()) entry.releaseDate = releaseDate.trim();
    if (sha256.trim()) entry.sha256 = sha256.trim().toLowerCase();
    if (Object.keys(entry).length > 0) details[platform] = entry;
  };

  if (f.androidDownloadUrl.trim()) {
    add("android", f.androidPackageName, f.androidSha256, f.androidReleaseDate);
  }
  if (f.windowsDownloadUrl.trim()) {
    add("windows", f.windowsPackageName, f.windowsSha256, f.windowsReleaseDate);
  }

  return Object.keys(details).length > 0 ? details : null;
}

function projectToForm(p: VerifiedProject): FormData {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    longDescription: p.longDescription || "",
    imageUrl: p.imageUrl || "",
    category: p.category,
    technologies: fromArrayField(p.technologies),
    features: fromArrayField(p.features),
    highlights: fromArrayField(p.highlights),
    liveUrl: p.liveUrl || "",
    githubUrl: p.githubUrl || "",
    status: p.status,
    authorName: p.authorName || "",
    authorAvatar: p.authorAvatar || "",
    architecture: p.architecture || "",
    timeline: p.timeline || "",
    teamSize: p.teamSize || "",
    userCount: p.userCount || "",
    appVersion: p.appVersion || "",
    appSize: p.appSize || "",
    platforms: fromArrayField(p.platforms),
    requirements: fromArrayField(p.requirements),
    releaseNotes: p.releaseNotes || "",
    screenshots: fromArrayField(p.screenshots),
    // Existing links are loaded back into the form unchanged, so opening the
    // edit dialog and saving without touching them preserves both the URL and
    // its MEGA decryption key.
    androidDownloadUrl: p.androidDownloadUrl || "",
    windowsDownloadUrl: p.windowsDownloadUrl || "",
    androidPackageName: platformDetailField(p, "android", "packageName"),
    androidSha256: platformDetailField(p, "android", "sha256"),
    androidReleaseDate: platformDetailField(p, "android", "releaseDate"),
    windowsPackageName: platformDetailField(p, "windows", "packageName"),
    windowsSha256: platformDetailField(p, "windows", "sha256"),
    windowsReleaseDate: platformDetailField(p, "windows", "releaseDate"),
    githubReleasesFallback: p.githubReleasesFallback === true,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}

function formToPayload(f: FormData) {
  return {
    slug: f.slug,
    title: f.title,
    description: f.description,
    longDescription: f.longDescription || null,
    imageUrl: f.imageUrl || null,
    category: f.category,
    technologies: toArrayField(f.technologies),
    features: toArrayField(f.features),
    highlights: toArrayField(f.highlights),
    liveUrl: f.liveUrl || null,
    githubUrl: f.githubUrl || null,
    status: f.status,
    authorName: f.authorName || null,
    authorAvatar: f.authorAvatar || null,
    architecture: f.architecture || null,
    timeline: f.timeline || null,
    teamSize: f.teamSize || null,
    userCount: f.userCount || null,
    appVersion: f.appVersion || null,
    appSize: f.appSize || null,
    platforms: toArrayField(f.platforms),
    requirements: toArrayField(f.requirements),
    releaseNotes: f.releaseNotes || null,
    screenshots: toArrayField(f.screenshots),
    // Sent as null when blank, which is how a link is cleared. The API
    // re-validates both links and refuses a bad one rather than storing it.
    androidDownloadUrl: f.androidDownloadUrl.trim() || null,
    windowsDownloadUrl: f.windowsDownloadUrl.trim() || null,
    downloadDetails: buildDownloadDetails(f),
    githubReleasesFallback: f.githubReleasesFallback,
    isActive: f.isActive,
    sortOrder: f.sortOrder,
  };
}

/**
 * One platform's download fields.
 *
 * Extracted because Android and Windows need the identical four inputs and the
 * identical live validation, and a copy per platform is how the two drift: the
 * Windows field ends up accepting something the Android field rejects. The
 * `platform` prop selects both the test ids and the field keys, so the caller
 * only supplies the current values.
 *
 * The validation runs on every keystroke but only complains once something has
 * been typed, so an untouched empty field is not shown as an error.
 */
function DownloadPlatformFields({
  platform,
  icon,
  url,
  packageName,
  sha256,
  releaseDate,
  onChange,
}: {
  platform: "android" | "windows";
  icon: React.ReactNode;
  url: string;
  packageName: string;
  sha256: string;
  releaseDate: string;
  onChange: (patch: Partial<FormData>) => void;
}) {
  const label = platform === "windows" ? "Windows" : "Android";
  const example = `https://mega.nz/file/AbCdEf12#${"K".repeat(22)}`;
  const urlProblem = url.trim() ? downloadUrlProblem(url) : null;
  const checksumProblem = url.trim() ? sha256Problem(sha256) : null;

  const fields = {
    url: platform === "windows" ? "windowsDownloadUrl" : "androidDownloadUrl",
    packageName: platform === "windows" ? "windowsPackageName" : "androidPackageName",
    sha256: platform === "windows" ? "windowsSha256" : "androidSha256",
    releaseDate: platform === "windows" ? "windowsReleaseDate" : "androidReleaseDate",
  } as const;

  return (
    <div
      className="sm:col-span-2 rounded-xl border p-4 space-y-3 bg-secondary/10"
      data-testid={`section-download-${platform}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h5 className="text-sm font-semibold">{label} download</h5>
        {url.trim() && !urlProblem && (
          <Badge variant="outline" className="ml-auto text-[10px] gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            Link set
          </Badge>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`vp-${platform}-download-url`}>{label} Download URL (MEGA)</Label>
        <Input
          id={`vp-${platform}-download-url`}
          value={url}
          onChange={(e) => onChange({ [fields.url]: e.target.value } as Partial<FormData>)}
          placeholder={example}
          aria-invalid={urlProblem ? true : undefined}
          className={urlProblem ? "border-red-500 focus-visible:ring-red-500" : undefined}
          data-testid={`input-project-${platform}-download-url`}
        />
        {urlProblem ? (
          <p className="text-xs text-red-500 flex items-center gap-1" data-testid={`error-${platform}-download-url`}>
            <AlertCircle className="h-3 w-3" />
            {urlProblem}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Complete MEGA share link, e.g. <code className="break-all">{example}</code>. Trusted
            hosts: {MEGA_DOWNLOAD_HOSTS.join(", ")}.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`vp-${platform}-package-name`}>Package name</Label>
          <Input
            id={`vp-${platform}-package-name`}
            value={packageName}
            onChange={(e) => onChange({ [fields.packageName]: e.target.value } as Partial<FormData>)}
            placeholder={platform === "windows" ? "ClearCut-Setup-1.1.0.exe" : "clearcut-1.1.0.apk"}
            data-testid={`input-project-${platform}-package-name`}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`vp-${platform}-release-date`}>Release date</Label>
          <Input
            id={`vp-${platform}-release-date`}
            value={releaseDate}
            onChange={(e) => onChange({ [fields.releaseDate]: e.target.value } as Partial<FormData>)}
            placeholder="2026-03-14"
            data-testid={`input-project-${platform}-release-date`}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`vp-${platform}-sha256`}>SHA-256 checksum</Label>
          <Input
            id={`vp-${platform}-sha256`}
            value={sha256}
            onChange={(e) => onChange({ [fields.sha256]: e.target.value } as Partial<FormData>)}
            placeholder="64 hex characters"
            aria-invalid={checksumProblem ? true : undefined}
            className={checksumProblem ? "border-red-500 focus-visible:ring-red-500" : undefined}
            data-testid={`input-project-${platform}-sha256`}
          />
          {checksumProblem && (
            <p className="text-xs text-red-500 flex items-center gap-1" data-testid={`error-${platform}-sha256`}>
              <AlertCircle className="h-3 w-3" />
              {checksumProblem}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifiedProjectsPage() {
  const { canManageProjects, canDeleteProjects } = useAdminAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<VerifiedProject | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setForm(f => ({ ...f, imageUrl: data.url }));
      toast({ title: "Image uploaded successfully" });
    } catch (err: any) {
      toast({ title: "Image upload failed", description: err.message, variant: "error" });
    } finally {
      setImageUploading(false);
    }
  };

  const { data: projects, isLoading } = useQuery<VerifiedProject[]>({
    queryKey: ["/api/admin/verified-projects"],
    enabled: canManageProjects,
  });

  const createMutation = useMutation({
    mutationFn: async (data: ReturnType<typeof formToPayload>) => {
      const res = await apiRequest("/api/admin/verified-projects", "POST", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verified-projects"] });
      toast({ title: "Project added successfully" });
      setDialogOpen(false);
      setForm(emptyForm);
    },
    onError: (error: Error) => {
      toast({ title: "Error adding project", description: error.message, variant: "error" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ReturnType<typeof formToPayload> }) => {
      const res = await apiRequest(`/api/admin/verified-projects/${id}`, "PUT", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verified-projects"] });
      toast({ title: "Project updated successfully" });
      setDialogOpen(false);
      setEditingProject(null);
      setForm(emptyForm);
    },
    onError: (error: Error) => {
      toast({ title: "Error updating project", description: error.message, variant: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/admin/verified-projects/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verified-projects"] });
      toast({ title: "Project deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting project", description: error.message, variant: "error" });
    },
  });

  const filtered = (projects || []).filter((p) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q) ||
      (p.authorName || "").toLowerCase().includes(q)
    );
  });

  const openAdd = () => {
    setEditingProject(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (project: VerifiedProject) => {
    setEditingProject(project);
    setForm(projectToForm(project));
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = formToPayload(form);
    if (!payload.slug || !payload.title || !payload.description || !payload.category || !payload.status) {
      toast({ title: "Missing required fields", description: "Slug, title, description, category and status are required.", variant: "error" });
      return;
    }

    // Installer links are checked before the request so the administrator gets
    // the reason immediately. The server checks again — this is convenience,
    // not the boundary — and neither message repeats the link, because the
    // link carries the MEGA decryption key.
    for (const [label, value] of [
      ["Android", form.androidDownloadUrl],
      ["Windows", form.windowsDownloadUrl],
    ] as const) {
      const problem = downloadUrlProblem(value);
      if (problem) {
        toast({ title: `${label} download link is not valid`, description: problem, variant: "error" });
        return;
      }
    }

    for (const [label, value] of [
      ["Android", form.androidSha256],
      ["Windows", form.windowsSha256],
    ] as const) {
      const problem = sha256Problem(value);
      if (problem) {
        toast({ title: `${label} checksum is not valid`, description: problem, variant: "error" });
        return;
      }
    }

    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!canManageProjects) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader><CardTitle>Access Denied</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">You don't have permission to manage verified projects.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const counts = { total: projects?.length || 0, active: projects?.filter(p => p.isActive).length || 0 };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Verified Projects</h1>
          <p className="text-muted-foreground">Manage projects listed in the verified projects showcase</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-verified-projects"
            />
          </div>
          <Button onClick={openAdd} data-testid="button-add-project">
            <Plus className="h-4 w-4 mr-1" />
            Add Project
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{counts.total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{counts.active}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Websites</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-purple-600">{projects?.filter(p => p.category === "websites").length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Bots</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-cyan-600">{projects?.filter(p => p.category === "bots").length || 0}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Verified Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm ? "No projects match your search." : "No verified projects yet. Add your first one!"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Links</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((project) => (
                    <TableRow key={project.id} data-testid={`row-project-${project.id}`} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {project.imageUrl ? (
                            <img src={project.imageUrl} alt={project.title} className="h-10 w-10 rounded-lg object-cover" />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <CheckCircle className="h-5 w-5 text-primary" />
                            </div>
                          )}
                          <div>
                            <div className="font-medium max-w-[180px] truncate" data-testid={`text-project-title-${project.id}`}>{project.title}</div>
                            <div className="text-xs text-muted-foreground font-mono">/{project.slug}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${CATEGORY_COLORS[project.category] || ""}`}>
                          {project.category}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[project.status] || ""}`}>
                          {project.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{project.authorName || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {project.liveUrl && (
                            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" data-testid={`link-live-${project.id}`}>
                              <Globe className="h-4 w-4" />
                            </a>
                          )}
                          {project.githubUrl && (
                            <a href={project.githubUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" data-testid={`link-github-${project.id}`}>
                              <Github className="h-4 w-4" />
                            </a>
                          )}
                          {!project.liveUrl && !project.githubUrl && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={project.isActive ? "text-green-600 font-medium text-sm" : "text-muted-foreground text-sm"}>
                          {project.isActive ? "Yes" : "No"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(project)}
                            data-testid={`button-edit-project-${project.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          {canDeleteProjects && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete "${project.title}"? This cannot be undone.`)) {
                                  deleteMutation.mutate(project.id);
                                }
                              }}
                              data-testid={`button-delete-project-${project.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditingProject(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProject ? "Edit Verified Project" : "Add Verified Project"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="vp-title">Title <span className="text-red-500">*</span></Label>
              <Input id="vp-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="My Awesome Project" data-testid="input-project-title" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vp-slug">Slug <span className="text-red-500">*</span></Label>
              <Input id="vp-slug" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="my-awesome-project" data-testid="input-project-slug" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-description">Description <span className="text-red-500">*</span></Label>
              <Textarea id="vp-description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description..." rows={2} data-testid="input-project-description" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-long-description">Long Description</Label>
              <Textarea id="vp-long-description" value={form.longDescription} onChange={e => setForm(f => ({ ...f, longDescription: e.target.value }))} placeholder="Detailed description..." rows={3} data-testid="input-project-long-description" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-category">Category <span className="text-red-500">*</span></Label>
              <Select value={form.category} onValueChange={val => setForm(f => ({ ...f, category: val }))}>
                <SelectTrigger data-testid="select-project-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-status">Status <span className="text-red-500">*</span></Label>
              <Select value={form.status} onValueChange={val => setForm(f => ({ ...f, status: val }))}>
                <SelectTrigger data-testid="select-project-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-live-url">Live URL</Label>
              <Input id="vp-live-url" value={form.liveUrl} onChange={e => setForm(f => ({ ...f, liveUrl: e.target.value }))} placeholder="https://..." data-testid="input-project-live-url" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-github-url">GitHub URL</Label>
              <Input id="vp-github-url" value={form.githubUrl} onChange={e => setForm(f => ({ ...f, githubUrl: e.target.value }))} placeholder="https://github.com/..." data-testid="input-project-github-url" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>Project Image</Label>
              <div className="flex flex-col gap-3">
                {form.imageUrl && (
                  <div className="relative w-full h-36 rounded-lg overflow-hidden border bg-muted">
                    <img src={form.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, imageUrl: "" })); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                      data-testid="button-remove-image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    data-testid="input-project-image-file"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={imageUploading}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-choose-image"
                  >
                    {imageUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                    {imageUploading ? "Uploading..." : form.imageUrl ? "Change Image" : "Upload Image"}
                  </Button>
                  {!form.imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const url = window.prompt("Or paste an image URL:");
                        if (url) setForm(f => ({ ...f, imageUrl: url }));
                      }}
                      title="Paste URL instead"
                      data-testid="button-paste-image-url"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {form.imageUrl && (
                  <p className="text-xs text-muted-foreground truncate">{form.imageUrl}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-technologies">Technologies (comma-separated)</Label>
              <Input id="vp-technologies" value={form.technologies} onChange={e => setForm(f => ({ ...f, technologies: e.target.value }))} placeholder="React, Node.js, PostgreSQL" data-testid="input-project-technologies" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-features">Features (comma-separated)</Label>
              <Input id="vp-features" value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} placeholder="Auth, Dashboard, API" data-testid="input-project-features" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-highlights">Highlights (comma-separated)</Label>
              <Input id="vp-highlights" value={form.highlights} onChange={e => setForm(f => ({ ...f, highlights: e.target.value }))} placeholder="Fast, Scalable" data-testid="input-project-highlights" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-author-name">Author Name</Label>
              <Input id="vp-author-name" value={form.authorName} onChange={e => setForm(f => ({ ...f, authorName: e.target.value }))} placeholder="John Doe" data-testid="input-project-author-name" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-author-avatar">Author Avatar URL</Label>
              <Input id="vp-author-avatar" value={form.authorAvatar} onChange={e => setForm(f => ({ ...f, authorAvatar: e.target.value }))} placeholder="https://..." data-testid="input-project-author-avatar" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-timeline">Timeline</Label>
              <Input id="vp-timeline" value={form.timeline} onChange={e => setForm(f => ({ ...f, timeline: e.target.value }))} placeholder="3 months" data-testid="input-project-timeline" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-team-size">Team Size</Label>
              <Input id="vp-team-size" value={form.teamSize} onChange={e => setForm(f => ({ ...f, teamSize: e.target.value }))} placeholder="2" data-testid="input-project-team-size" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-user-count">User Count</Label>
              <Input id="vp-user-count" value={form.userCount} onChange={e => setForm(f => ({ ...f, userCount: e.target.value }))} placeholder="500+" data-testid="input-project-user-count" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-sort-order">Sort Order</Label>
              <Input id="vp-sort-order" type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} data-testid="input-project-sort-order" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-architecture">Architecture / Notes</Label>
              <Textarea id="vp-architecture" value={form.architecture} onChange={e => setForm(f => ({ ...f, architecture: e.target.value }))} placeholder="Architecture details..." rows={2} data-testid="input-project-architecture" />
            </div>

            {/* App-store metadata. Only used by installable utilities, where
                the detail page renders an application-style layout. */}
            <div className="sm:col-span-2 pt-2 border-t">
              <h4 className="text-sm font-semibold">App details (installable utilities)</h4>
              <p className="text-xs text-muted-foreground">Shown on the application-style detail page for utilities.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-app-version">App Version</Label>
              <Input id="vp-app-version" value={form.appVersion} onChange={e => setForm(f => ({ ...f, appVersion: e.target.value }))} placeholder="1.1.0" data-testid="input-project-app-version" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="vp-app-size">App Size</Label>
              <Input id="vp-app-size" value={form.appSize} onChange={e => setForm(f => ({ ...f, appSize: e.target.value }))} placeholder="3.3 MB" data-testid="input-project-app-size" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-platforms">Platforms (comma-separated)</Label>
              <Input id="vp-platforms" value={form.platforms} onChange={e => setForm(f => ({ ...f, platforms: e.target.value }))} placeholder="Android 8.0+, Windows 10+" data-testid="input-project-platforms" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-requirements">Requirements (comma-separated)</Label>
              <Input id="vp-requirements" value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} placeholder="Android 8.0 (API 26) or newer, 100 MB free space" data-testid="input-project-requirements" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-release-notes">Release Notes / What's New</Label>
              <Textarea id="vp-release-notes" value={form.releaseNotes} onChange={e => setForm(f => ({ ...f, releaseNotes: e.target.value }))} placeholder="What changed in this version..." rows={3} data-testid="input-project-release-notes" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vp-screenshots">Screenshots (comma-separated image URLs)</Label>
              <Input id="vp-screenshots" value={form.screenshots} onChange={e => setForm(f => ({ ...f, screenshots: e.target.value }))} placeholder="https://..., https://..." data-testid="input-project-screenshots" />
            </div>

            {/* Per-platform installer links. Each is optional: a platform with
                no link shows no download button on the detail page, so an app
                that only ships for Android does not advertise Windows. */}
            <div className="sm:col-span-2 pt-2 border-t">
              <h4 className="text-sm font-semibold">Downloads (installable utilities)</h4>
              <p className="text-xs text-muted-foreground">
                Paste the complete MEGA share link, including the part after <code>#</code> — that is
                the decryption key, and the download only works with it. Leave a field empty to hide
                that platform's download button. Links are never shown on the public page.
              </p>
            </div>

            <DownloadPlatformFields
              platform="android"
              icon={<Smartphone className="h-4 w-4" />}
              url={form.androidDownloadUrl}
              packageName={form.androidPackageName}
              sha256={form.androidSha256}
              releaseDate={form.androidReleaseDate}
              onChange={(patch) => setForm(f => ({ ...f, ...patch }))}
            />

            <DownloadPlatformFields
              platform="windows"
              icon={<Monitor className="h-4 w-4" />}
              url={form.windowsDownloadUrl}
              packageName={form.windowsPackageName}
              sha256={form.windowsSha256}
              releaseDate={form.windowsReleaseDate}
              onChange={(patch) => setForm(f => ({ ...f, ...patch }))}
            />

            <div className="flex items-start gap-2 sm:col-span-2">
              <input
                id="vp-github-releases-fallback"
                type="checkbox"
                checked={form.githubReleasesFallback}
                onChange={e => setForm(f => ({ ...f, githubReleasesFallback: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 mt-0.5"
                data-testid="checkbox-project-github-releases-fallback"
              />
              <div>
                <Label htmlFor="vp-github-releases-fallback">Fall back to GitHub Releases</Label>
                <p className="text-xs text-muted-foreground">
                  Only used when no Android or Windows link is set. Off by default, so an app with no
                  installer does not offer a download button.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="vp-is-active"
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
                data-testid="checkbox-project-is-active"
              />
              <Label htmlFor="vp-is-active">Active (visible in showcase)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingProject(null); setForm(emptyForm); }} data-testid="button-cancel-project">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="button-save-project">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingProject ? "Save Changes" : "Add Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteMutation.isPending && (
        <div className="fixed bottom-4 right-4">
          <Card className="p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Deleting project...</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
