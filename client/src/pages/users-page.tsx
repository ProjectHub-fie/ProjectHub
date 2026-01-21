import { useQuery, useMutation } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

export default function UsersPage() {
  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const toggleBlockMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/users/${id}/toggle-block`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.firstName} {user.lastName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.isBlocked ? "Blocked" : "Active"}</TableCell>
                  <TableCell>
                    <Button 
                      variant={user.isBlocked ? "outline" : "destructive"}
                      onClick={() => toggleBlockMutation.mutate(user.id)}
                    >
                      {user.isBlocked ? <ShieldCheck className="mr-2 h-4 w-4" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                      {user.isBlocked ? "Unblock" : "Block"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
