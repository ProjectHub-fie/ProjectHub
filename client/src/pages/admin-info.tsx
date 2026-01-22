import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, UserPlus, ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function AdminInfo() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: admins, isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/admin/list"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/delete/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete admin");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/list"] });
      toast({ title: "Admin deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete admin",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) return <div className="p-6">Loading admins...</div>;
  if (error) return <div className="p-6 text-destructive">Error loading admins: {(error as Error).message}</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/admin")}
            data-testid="button-back-to-admin"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Admin Information</h1>
        </div>
        <Link href="/admin/create">
          <Button data-testid="button-create-admin">
            <UserPlus className="mr-2 h-4 w-4" />
            Add New Admin
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(!admins || admins.length === 0) ? (
          <div className="col-span-full text-center py-10 text-muted-foreground">
            No administrators found.
          </div>
        ) : (
          admins.map((admin) => (
            <Card key={admin.id} className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">PIN: {admin.pin}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to delete admin with PIN ${admin.pin}?`)) {
                      deleteMutation.mutate(admin.id);
                    }
                  }}
                  disabled={admins.length <= 1 || deleteMutation.isPending}
                  data-testid={`button-delete-admin-${admin.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Last updated: {admin.updatedAt ? new Date(admin.updatedAt).toLocaleString() : 'Never'}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
