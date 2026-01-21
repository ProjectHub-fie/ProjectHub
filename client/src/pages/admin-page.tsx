import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, Clock, ShieldAlert } from "lucide-react";

export default function AdminPage() {
  const { data: stats } = useQuery<{
    totalUsers: number;
    totalRequests: number;
    pendingRequests: number;
    blockedUsers: number;
  }>({ queryKey: ["/api/admin/stats"] });

  const statCards = [
    { title: "Total Users", value: stats?.totalUsers, icon: Users },
    { title: "Total Requests", value: stats?.totalRequests, icon: FileText },
    { title: "Pending Requests", value: stats?.pendingRequests, icon: Clock },
    { title: "Blocked Users", value: stats?.blockedUsers, icon: ShieldAlert },
  ];

  return (
    <div className="p-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statCards.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            <stat.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value ?? 0}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
