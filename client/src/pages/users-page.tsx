import { useQuery, useMutation } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ShieldAlert, ShieldCheck, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";

export default function UsersPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    if (!searchTerm) return users;
    const lowerSearch = searchTerm.toLowerCase();
    return users.filter(user => 
      user.firstName?.toLowerCase().includes(lowerSearch) || 
      user.lastName?.toLowerCase().includes(lowerSearch) || 
      user.email?.toLowerCase().includes(lowerSearch)
    );
  }, [users, searchTerm]);

  const toggleBlockMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/users/${id}/toggle-block`, "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User status updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center gap-4 max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-users"
          />
        </div>
      </div>
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
              {filteredUsers.map((user) => (
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
