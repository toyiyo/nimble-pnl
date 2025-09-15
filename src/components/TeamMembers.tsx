import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MoreHorizontal, Crown, Shield, User, ChefHat, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

interface TeamMembersProps {
  restaurantId: string;
  userRole: string;
}

const roleIcons = {
  owner: Crown,
  manager: Shield,
  chef: ChefHat,
  staff: User,
};

const roleColors = {
  owner: "default",
  manager: "secondary",
  chef: "outline",
  staff: "outline",
} as const;

export const TeamMembers = ({ restaurantId, userRole }: TeamMembersProps) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const canManageMembers = userRole === 'owner' || userRole === 'manager';

  useEffect(() => {
    fetchTeamMembers();
  }, [restaurantId]);

  const fetchTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('user_restaurants')
        .select(`
          id,
          user_id,
          role,
          created_at
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch profile data separately
      const userIds = data?.map(ur => ur.user_id) || [];
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      if (profilesError) throw profilesError;

      // Combine the data
      const membersWithProfiles = data?.map(member => ({
        ...member,
        profiles: profilesData?.find(p => p.user_id === member.user_id) || null
      })) || [];

      setMembers(membersWithProfiles);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load team members",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('user_restaurants')
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Member role updated successfully",
      });

      fetchTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update member role",
        variant: "destructive",
      });
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const { error } = await supabase
        .from('user_restaurants')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Member removed from team",
      });

      fetchTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to remove member",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Loading team members...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
        <CardDescription>
          Manage your restaurant team members and their roles
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {members.map((member) => {
            const RoleIcon = roleIcons[member.role as keyof typeof roleIcons] || User;
            const isOwner = member.role === 'owner';
            
            return (
              <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {member.profiles?.full_name 
                        ? member.profiles.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
                        : member.profiles?.email?.[0]?.toUpperCase() || 'U'
                      }
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {member.profiles?.full_name || 'Unknown User'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {member.profiles?.email}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Badge variant={roleColors[member.role as keyof typeof roleColors]} className="flex items-center gap-1">
                    <RoleIcon className="h-3 w-3" />
                    {member.role}
                  </Badge>
                  
                  {canManageMembers && !isOwner && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <div className="px-2 py-1">
                          <p className="text-sm font-medium">Change Role</p>
                          <Select
                            value={member.role}
                            onValueChange={(newRole) => updateMemberRole(member.id, newRole)}
                          >
                            <SelectTrigger className="w-full mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="staff">Staff</SelectItem>
                              <SelectItem value="chef">Chef</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              {userRole === 'owner' && (
                                <SelectItem value="owner">Owner</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove Member
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {member.profiles?.full_name || member.profiles?.email} from the team? 
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMember(member.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
          
          {members.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No team members found</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};