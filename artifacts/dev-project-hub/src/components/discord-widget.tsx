import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Users, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiscordWidgetProps {
  onClose: () => void;
}

interface DiscordData {
  name: string;
  presence_count: number;
  instant_invite: string;
  members: Array<{
    username: string;
    avatar_url: string;
    status: string;
  }>;
}

export function DiscordWidget({ onClose }: DiscordWidgetProps) {
  const [data, setData] = useState<DiscordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullWidget, setShowFullWidget] = useState(false);

  useEffect(() => {
    fetch("https://discord.com/api/guilds/1317411980625313893/widget.json")
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch Discord widget:", err);
        setLoading(false);
      });
  }, []);

  if (showFullWidget) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
        <Card className="w-full max-w-md shadow-2xl border-primary/20 animate-in zoom-in-95 duration-200 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 bg-secondary/30">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Discord Server
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
          <CardContent className="p-0 flex justify-center bg-[#313338]">
            <iframe 
              src="https://discord.com/widget?id=1317411980625313893&theme=dark" 
              width="350" 
              height="500" 
              allowTransparency={true} 
              frameBorder="0" 
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              className="w-full h-[500px]"
            ></iframe>
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
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Discord Server Status
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-4">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-muted-foreground animate-pulse">Connecting to Discord...</p>
            </div>
          ) : data ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-secondary/50 rounded-xl border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Server Name</p>
                  <p className="text-lg font-bold">{data.name}</p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Online</p>
                  <div className="flex items-center gap-2 justify-end">
                    <Users className="h-4 w-4 text-emerald-500" />
                    <p className="text-lg font-bold text-emerald-500">{data.presence_count}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground px-1">Online Members</p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {data.members
                    .filter(member => !member.username.toLowerCase().includes('bot'))
                    .slice(0, 10)
                    .map((member, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border/50">
                      <div className="relative">
                        <img src={member.avatar_url} alt="" className="w-8 h-8 rounded-full bg-secondary" />
                        <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background ${
                          member.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500'
                        }`} />
                      </div>
                      <span className="text-xs font-medium truncate">{member.username}</span>
                    </div>
                  ))}
                  {data.members.filter(member => !member.username.toLowerCase().includes('bot')).length > 10 && (
                    <div className="col-span-2 text-center py-2 text-xs text-muted-foreground italic">
                      + {data.members.filter(member => !member.username.toLowerCase().includes('bot')).length - 10} more members online
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Button 
                    className="flex-1 bg-[#5865F2] hover:bg-[#4752C4] text-white" 
                    onClick={() => window.open(data.instant_invite, '_blank')}
                  >
                    Join Server
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowFullWidget(true)}>
                    Show More <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" className=" hover:bg-[#4752C4]: bg-blue-600" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center space-y-4">
              <p className="text-destructive font-medium">Failed to load server status</p>
              <Button variant="link" onClick={() => window.location.reload()}>Try Again</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
