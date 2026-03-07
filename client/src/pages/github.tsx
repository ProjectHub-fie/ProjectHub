import { useState, useEffect } from "react";
import { Github, Star, GitFork, Users, Code, ExternalLink, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";

// Configuration: Set to false to disable the GitHub page
const GITHUB_PAGE_ENABLED = true;

interface RepoData {
  id: number;
  name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  language: string;
  updated_at: string;
  watchers_count: number;
  size: number;
  default_branch: string;
  private: boolean; // Add private field
}

export default function GithubPage() {
  const [, setLocation] = useLocation();
  const [repos, setRepos] = useState<RepoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const username = "ProjectHub-fie";

  useEffect(() => {
    if (!GITHUB_PAGE_ENABLED) {
      setLoading(false);
      return;
    }

    // Fetch organization profile
    fetch(`https://api.github.com/orgs/${username}`)
      .then((res) => res.json())
      .then((data) => {
        setProfile(data);
      })
      .catch((err) => {
        console.error("Failed to fetch GitHub organization:", err);
      });

    // Fetch repositories
    fetch(`https://api.github.com/orgs/${username}/repos?sort=updated&per_page=50`)
      .then((res) => res.json())
      .then((data) => {
        // Filter out private repositories
        const publicRepos = data.filter((repo: RepoData) => !repo.private);
        setRepos(publicRepos);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch GitHub organization repos:", err);
        setLoading(false);
      });
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getTotalStars = () => {
    return repos.reduce((acc, repo) => acc + repo.stargazers_count, 0);
  };

  const getTotalForks = () => {
    return repos.reduce((acc, repo) => acc + repo.forks_count, 0);
  };

  return (
    <div className="min-h-screen bg-background">
      {!GITHUB_PAGE_ENABLED ? (
        <div className="min-h-screen flex items-center justify-center">
          <Card className="max-w-md mx-auto p-6">
            <CardContent className="text-center space-y-4">
              <Github className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
              <h1 className="text-2xl font-bold text-muted-foreground">GitHub Page is Disabled</h1>
              <p className="text-muted-foreground">This feature is currently not available.</p>
              <Button onClick={() => setLocation("/")} className="mt-4">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-secondary/50 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <Button 
                variant="ghost" 
                onClick={() => setLocation("/")}
                className="mb-4 hover:bg-secondary"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Home
              </Button>
              
              <div className="flex items-center gap-4 mb-6">
                <Github className="h-12 w-12 text-primary" />
                <div>
                  <h1 className="text-3xl font-bold">GitHub Organization</h1>
                  <p className="text-muted-foreground">@{username}</p>
                </div>
              </div>

              {profile && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                  {/* GitHub Readme Stats Widget */}
                  <div className="md:col-span-4 flex justify-center mb-4">
                    <img 
                      src="https://github-readme-stats.vercel.app/api?username=ProjectHub-fie&show_icons=true&theme=default" 
                      alt="GitHub stats for ProjectHub-fie"
                      className="max-w-full h-auto"
                    />
                  </div>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Code className="h-6 w-6 text-primary" />
                        <div>
                          <p className="text-sm text-muted-foreground">Repositories</p>
                          <p className="text-2xl font-bold">{profile.public_repos || repos.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Star className="h-6 w-6 text-yellow-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Total Stars</p>
                          <p className="text-2xl font-bold">{getTotalStars()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <GitFork className="h-6 w-6 text-blue-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Total Forks</p>
                          <p className="text-2xl font-bold">{getTotalForks()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Users className="h-6 w-6 text-green-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Members</p>
                          <p className="text-2xl font-bold">{profile.members_visible?.length || 0}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4">
                <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground animate-pulse">Loading GitHub repositories...</p>
              </div>
            ) : repos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {repos.map((repo) => (
                  <Card key={repo.id} className="hover:shadow-lg transition-all duration-200 hover:-translate-y-1 border-border/50">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 flex-1">
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
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {repo.description || "No description available"}
                      </p>
                      
                      <div className="space-y-3">
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
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span>{repo.watchers_count} watching</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Code className="h-3 w-3" />
                            <span>{repo.size} KB</span>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-border/50">
                          <p className="text-xs text-muted-foreground">
                            Updated on {formatDate(repo.updated_at)}
                          </p>
                        </div>

                        <Button 
                          className="w-full mt-3 bg-[#333] hover:bg-[#24292e] text-white"
                          size="sm"
                          onClick={() => window.open(repo.html_url, '_blank')}
                        >
                          <Github className="mr-2 h-4 w-4" />
                          View on GitHub
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center space-y-4">
                <p className="text-destructive font-medium">Failed to load repositories</p>
                <Button variant="link" onClick={() => window.location.reload()}>Try Again</Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
