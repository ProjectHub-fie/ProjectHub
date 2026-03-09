import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Github, Star, GitFork, Users, ExternalLink, Code } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GithubWidgetProps {
  onClose: () => void;
}

interface RepoData {
  id: number;
  name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  language: string;
  updated_at: string;
  private: boolean; // Add private field
}

export function GithubWidget({ onClose }: GithubWidgetProps) {
  const [repos, setRepos] = useState<RepoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFullWidget, setShowFullWidget] = useState(false);
  const username = "ProjectHub-fie";

  useEffect(() => {

    fetch(`https://api.github.com/orgs/${username}/repos?sort=updated&per_page=20`)
      .then((res) => res.json())
      .then((data) => {
        // Filter out private repositories
        const publicRepos = data.filter((repo: RepoData) => !repo.private);
        setRepos(publicRepos.slice(0, 6)); // Take top 6 after filtering
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch GitHub organization repos:", err);
        setLoading(false);
      });
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  if (showFullWidget) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
        <Card className="w-full max-w-2xl shadow-2xl border-primary/20 animate-in zoom-in-95 duration-200 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 bg-secondary/30">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Repositories
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowFullWidget(false)} className="text-xs">
                ←
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 max-h-[600px] overflow-y-auto custom-scrollbar">
            <div className="grid gap-4">
              {repos.map((repo, index) => (
                <div key={repo.id} className="p-4 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-all duration-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Code className="h-5 w-5 text-primary" />
                      <a 
                        href={repo.html_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="font-semibold text-lg hover:text-primary transition-colors flex items-center gap-1"
                      >
                        {repo.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{repo.description || "No description available"}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {repo.language && (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span>{repo.language}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      <span>{repo.stargazers_count}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <GitFork className="h-3 w-3" />
                      <span>{repo.forks_count}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      <span>Updated {formatDate(repo.updated_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-md shadow-2xl border-primary/20 animate-in zoom-in-95 duration-200">
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Organization
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-4">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-muted-foreground animate-pulse">Fetching GitHub repositories...</p>
            </div>
          ) : repos.length > 0 ? (
            <div className="space-y-6">
              {/* Organization Stats Widget */}
              <div className="p-4 bg-secondary/50 rounded-xl border border-border flex justify-center">
                <img 
                  src="https://github-readme-stats.vercel.app/api?username=ProjectHub-fie&show_icons=true&theme=default" 
                 
                  className="max-w-full h-auto"
                />

              </div>

              {/* Profile Summary */}
              <div className="p-4 bg-secondary/50 rounded-xl border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Organization</p>
                    <a 
                      href={`https://github.com/${username}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-lg font-bold hover:text-primary transition-colors flex items-center gap-1"
                    >
                      @{username}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <Github className="h-10 w-10 text-primary opacity-50" />
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Code className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{repos.length} Repos</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">{repos.reduce((acc, repo) => acc + repo.stargazers_count, 0)} Stars</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <GitFork className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">{repos.reduce((acc, repo) => acc + repo.forks_count, 0)} Forks</span>
                  </div>
                </div>
              </div>

              {/* Top Repositories */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground px-1">Recent Repositories</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {repos.slice(0, 5).map((repo) => (
                    <div key={repo.id} className="p-3 rounded-lg bg-background border border-border/50 hover:border-primary/50 transition-all duration-200">
                      <div className="flex items-start justify-between mb-1">
                        <a 
                          href={repo.html_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="font-medium text-sm hover:text-primary transition-colors flex items-center gap-1 flex-1"
                        >
                          <Code className="h-3 w-3 text-primary" />
                          {repo.name}
                        </a>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            <span>{repo.stargazers_count}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <GitFork className="h-3 w-3" />
                            <span>{repo.forks_count}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{repo.description || "No description"}</p>
                      {repo.language && (
                        <div className="flex items-center gap-1 mt-1 text-xs">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span>{repo.language}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Button 
                    className="flex-1 bg-[#333] hover:bg-[#24292e] text-white" 
                    onClick={() => window.open(`https://github.com/${username}`, '_blank')}
                  >
                    <Github className="mr-2 h-4 w-4" />
                    View Organization
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowFullWidget(true)}>
                    Show All <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center space-y-4">
              <p className="text-destructive font-medium">Failed to load repositories</p>
              <Button variant="link" onClick={() => window.location.reload()}>Try Again</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
