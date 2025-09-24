import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants } from '@/hooks/useRestaurants';
import { TeamInvitations } from '@/components/TeamInvitations';
import { TeamMembers } from '@/components/TeamMembers';
import { EnterpriseSettings } from '@/components/EnterpriseSettings';
import { UserPlus, Building, Settings, ArrowLeft } from 'lucide-react';

const Team = () => {
  const { user, loading } = useAuth();
  const { restaurants, loading: restaurantsLoading } = useRestaurants();
  const navigate = useNavigate();
  const [selectedRestaurant, setSelectedRestaurant] = useState(restaurants[0]);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (restaurants.length > 0 && !selectedRestaurant) {
      setSelectedRestaurant(restaurants[0]);
    }
  }, [restaurants, selectedRestaurant]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
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
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate('/')}
                className="p-2 md:px-3"
              >
                <ArrowLeft className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Back to Dashboard</span>
              </Button>
              <div className="hidden sm:block h-4 w-px bg-border" />
              <h1 className="text-lg md:text-xl font-semibold truncate">Team Management</h1>
              {selectedRestaurant && (
                <div className="hidden lg:flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">•</span>
                  <span className="text-sm font-medium truncate">{selectedRestaurant.restaurant.name}</span>
                  <Badge variant={isOwner ? "default" : "secondary"}>
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
                  <Badge variant={isOwner ? "default" : "secondary"} className="text-xs">
                    {selectedRestaurant.role}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>
      
      <main className="container px-4 py-4 md:py-6">
        <div className="mb-6 md:mb-8 text-center md:text-left">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Team Management</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            Manage your restaurant team, send invitations, and configure enterprise settings
          </p>
        </div>

        <Tabs defaultValue="members" className="space-y-4 md:space-y-6">
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="members" className="flex-col py-2 px-1 text-center">
              <UserPlus className="h-4 w-4 mb-1" />
              <span className="text-xs md:text-sm">Team Members</span>
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex-col py-2 px-1 text-center">
              <Building className="h-4 w-4 mb-1" />
              <span className="text-xs md:text-sm">Invitations</span>
            </TabsTrigger>
            <TabsTrigger value="enterprise" className="flex-col py-2 px-1 text-center" disabled={!isOwner}>
              <Settings className="h-4 w-4 mb-1" />
              <span className="text-xs md:text-sm">Enterprise</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <TeamMembers 
              restaurantId={selectedRestaurant.restaurant_id}
              userRole={selectedRestaurant.role}
            />
          </TabsContent>

          <TabsContent value="invitations">
            <TeamInvitations 
              restaurantId={selectedRestaurant.restaurant_id}
              userRole={selectedRestaurant.role}
            />
          </TabsContent>

          <TabsContent value="enterprise">
            {isOwner ? (
              <EnterpriseSettings 
                restaurantId={selectedRestaurant.restaurant_id}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Access Restricted</CardTitle>
                  <CardDescription>
                    Only restaurant owners can access enterprise settings.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Team;