import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { TeamInvitations } from '@/components/TeamInvitations';
import { TeamMembers } from '@/components/TeamMembers';
import { MetricIcon } from '@/components/MetricIcon';
import { UserPlus, Building, ArrowLeft, Users } from 'lucide-react';

const Team = () => {
  const { user, loading } = useAuth();
  const { selectedRestaurant, restaurants } = useRestaurantContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <p className="text-center text-sm text-muted-foreground sr-only">Loading team management...</p>
        </div>
      </div>
    );
  }

  if (!user || !selectedRestaurant) {
    return null;
  }

  const isOwner = selectedRestaurant.role === 'owner';

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" role="navigation" aria-label="Team management navigation">
        <div className="w-full px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate('/')}
                className="p-2 md:px-3 hover:bg-accent transition-colors"
                aria-label="Navigate back to dashboard"
              >
                <ArrowLeft className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Back to Dashboard</span>
              </Button>
              <div className="hidden sm:block h-4 w-px bg-border" aria-hidden="true" />
              <h1 className="text-lg md:text-xl font-semibold truncate">Team Management</h1>
              {selectedRestaurant && (
                <div className="hidden lg:flex items-center gap-2">
                  <span className="text-sm text-muted-foreground" aria-hidden="true">•</span>
                  <span className="text-sm font-medium truncate">{selectedRestaurant.restaurant.name}</span>
                  <Badge variant={isOwner ? "default" : "secondary"} aria-label={`Your role: ${selectedRestaurant.role}`}>
                    {selectedRestaurant.role}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden md:block text-sm text-muted-foreground truncate">
                Welcome, {user.email}
              </span>
            </div>
          </div>
          
          {/* Mobile restaurant info */}
          {selectedRestaurant && (
            <div className="lg:hidden py-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{selectedRestaurant.restaurant.name}</span>
                  <Badge variant={isOwner ? "default" : "secondary"} className="text-xs" aria-label={`Your role: ${selectedRestaurant.role}`}>
                    {selectedRestaurant.role}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>
      
      <main className="w-full px-4 py-4 md:py-6" role="main">
        {/* Hero Section with Gradient */}
        <Card className="mb-6 md:mb-8 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <MetricIcon icon={Users} variant="blue" />
              <div className="flex-1">
                <h2 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Team Management
                </h2>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  Manage your restaurant team, send invitations, and configure team settings
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="members" className="space-y-4 md:space-y-6">
          <TabsList className="grid w-full grid-cols-2 h-auto">
            <TabsTrigger 
              value="members" 
              id="members-tab"
              className="flex-col py-2 px-1 text-center transition-all duration-200 data-[state=active]:shadow-sm"
              aria-label="View team members"
            >
              <UserPlus className="h-4 w-4 mb-1" aria-hidden="true" />
              <span className="text-xs md:text-sm">Team Members</span>
            </TabsTrigger>
            <TabsTrigger 
              value="invitations" 
              id="invitations-tab"
              className="flex-col py-2 px-1 text-center transition-all duration-200 data-[state=active]:shadow-sm"
              aria-label="View pending invitations"
            >
              <Building className="h-4 w-4 mb-1" aria-hidden="true" />
              <span className="text-xs md:text-sm">Invitations</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" role="tabpanel" aria-labelledby="members-tab">
            <TeamMembers 
              restaurantId={selectedRestaurant.restaurant_id}
              userRole={selectedRestaurant.role}
            />
          </TabsContent>

          <TabsContent value="invitations" role="tabpanel" aria-labelledby="invitations-tab">
            <TeamInvitations 
              restaurantId={selectedRestaurant.restaurant_id}
              userRole={selectedRestaurant.role}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Team;
