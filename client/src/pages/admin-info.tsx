import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, UserPlus } from "lucide-react";
import { Link } from "wouter";

export default function AdminInfo() {
  const { toast } = useToast();
  const { data: admins, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/list"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/list"] });
      toast({ title: "Admin deleted successfully" });
    },
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Admin Information</h1>
        <Link href="/admin/create">
          <Button data-testid="button-create-admin">
            <UserPlus className="mr-2 h-4 w-4" />
            Add New Admin
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {admins?.map((admin) => (
          <Card key={admin.id} className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">PIN: {admin.pin}</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteMutation.mutate(admin.id)}
                disabled={admins.length <= 1}
                data-testid={`button-delete-admin-${admin.id}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(admin.updatedAt).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
