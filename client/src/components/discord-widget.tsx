import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiscordWidgetProps {
  onClose: () => void;
}

export function DiscordWidget({ onClose }: DiscordWidgetProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-md shadow-2xl border-primary/20 animate-in zoom-in-95 duration-200 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 bg-secondary/30">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Discord Server
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-4 w-4" />
          </Button>
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
