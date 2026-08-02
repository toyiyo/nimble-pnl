import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RolePicker } from '@/components/roles/RolePicker';
import type { Role } from '@/lib/permissions/types';

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  role_id: string | null;
  created_at: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

interface TeamMembersProps {
  restaurantId: string;
  userRole: Role;
}

export const TeamMembers = ({ restaurantId, userRole }: TeamMembersProps) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Derive from capability system — consistent with ROLE_CAPABILITIES['manage:team']
  const canManageMembers = userRole === 'owner' || userRole === 'manager' || userRole === 'operations_manager';

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
          role_id,
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
          <CardDescription>Manage your restaurant team members and their roles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-4 border border-border/40 rounded-xl">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </CardContent>
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
            const isOwner = member.role === 'owner';
            
            return (
              <div key={member.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border border-border/40 rounded-xl hover:border-border transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar>
                    <AvatarFallback>
                      {member.profiles?.full_name
                        ? member.profiles.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
                        : member.profiles?.email?.[0]?.toUpperCase() || 'U'
                      }
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">
                      {member.profiles?.full_name || 'Unknown User'}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {member.profiles?.email}
                    </p>
                  </div>
                </div>

                {/*
                  On mobile the row stacks: name/email on top, this badge+actions
                  group on its own full-width line below. The role label
                  "Employee (self-service)" plus the dropdown is wider than a
                  375px row's content box, so keeping it on the name's line
                  collapses the name column to zero. At sm+ the row is one line
                  again and this side stays shrink-0.
                */}
                <div className="flex items-center gap-3 shrink-0 pl-[3.25rem] sm:pl-0">
                  <RolePicker
                    membershipId={member.id}
                    restaurantId={restaurantId}
                    personName={member.profiles?.full_name || member.profiles?.email || 'this member'}
                    currentRole={member.role}
                    currentRoleId={member.role_id ?? null}
                    callerRole={userRole}
                    disabled={!canManageMembers || isOwner || member.role === 'kiosk'}
                  />

                  {canManageMembers && !isOwner && member.role !== 'kiosk' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`Manage ${member.profiles?.full_name || member.profiles?.email || 'member'}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
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