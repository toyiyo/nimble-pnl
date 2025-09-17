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
import { SecuritySettings } from '@/components/SecuritySettings';
import { UserPlus, Building, Settings, ArrowLeft, Shield } from 'lucide-react';

const Team = () => {
  const { user, loading } = useAuth();
  const { restaurants } = useRestaurants();
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
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigate('/')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-xl font-semibold">Team Management</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">•</span>
              <span className="text-sm font-medium">{selectedRestaurant.restaurant.name}</span>
              <Badge variant={isOwner ? "default" : "secondary"}>
                {selectedRestaurant.role}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.email}
            </span>
          </div>
        </div>
      </nav>
      
      <main className="container py-6">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Team Management</h2>
          <p className="text-muted-foreground">
            Manage your restaurant team, send invitations, and configure enterprise settings
          </p>
        </div>

        <Tabs defaultValue="members" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="members" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Team Members
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              Invitations
            </TabsTrigger>
            <TabsTrigger value="enterprise" className="flex items-center gap-2" disabled={!isOwner}>
              <Settings className="h-4 w-4" />
              Enterprise
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2" disabled={!isOwner}>
              <Shield className="h-4 w-4" />
              Security
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

          <TabsContent value="security">
            {isOwner ? (
              <SecuritySettings />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Access Restricted</CardTitle>
                  <CardDescription>
                    Only restaurant owners can access security settings.
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