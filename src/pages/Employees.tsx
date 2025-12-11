import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { EmployeeList } from '@/components/EmployeeList';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { DeactivateEmployeeDialog } from '@/components/DeactivateEmployeeDialog';
import { ReactivateEmployeeDialog } from '@/components/ReactivateEmployeeDialog';
import { MetricIcon } from '@/components/MetricIcon';
import { ArrowLeft, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Employee } from '@/types/scheduling';

const Employees = () => {
  const { user, loading } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
  const [isReactivateDialogOpen, setIsReactivateDialogOpen] = useState(false);

  const handleEmployeeEdit = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsEmployeeDialogOpen(true);
  };

  const handleEmployeeDeactivate = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsDeactivateDialogOpen(true);
  };

  const handleEmployeeReactivate = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsReactivateDialogOpen(true);
  };

  const handleAddEmployee = () => {
    setSelectedEmployee(null);
    setIsEmployeeDialogOpen(true);
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading || !user || !selectedRestaurant) {
    return null;
  }

  const isOwner = selectedRestaurant.role === 'owner';

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" role="navigation" aria-label="Employee management navigation">
        <div className="container px-4">
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
              <h1 className="text-lg md:text-xl font-semibold truncate">Employees</h1>
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
      
      <main className="container px-4 py-4 md:py-6" role="main">
        {/* Hero Section */}
        <Card className="mb-6 md:mb-8 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <MetricIcon icon={Users} variant="blue" />
              <div className="flex-1">
                <h2 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Employee Management
                </h2>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  Manage your restaurant employees, track their status, and handle seasonal staff
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <EmployeeList 
          restaurantId={selectedRestaurant.restaurant_id} 
          onAddEmployee={handleAddEmployee}
          onEmployeeEdit={handleEmployeeEdit}
          onEmployeeDeactivate={handleEmployeeDeactivate}
          onEmployeeReactivate={handleEmployeeReactivate}
        />

        <EmployeeDialog
          open={isEmployeeDialogOpen}
          onOpenChange={setIsEmployeeDialogOpen}
          restaurantId={selectedRestaurant.restaurant_id}
          employee={selectedEmployee}
        />

        {selectedEmployee && (
          <>
            <DeactivateEmployeeDialog
              open={isDeactivateDialogOpen}
              onOpenChange={setIsDeactivateDialogOpen}
              employee={selectedEmployee}
            />
            
            <ReactivateEmployeeDialog
              open={isReactivateDialogOpen}
              onOpenChange={setIsReactivateDialogOpen}
              employee={selectedEmployee}
            />
          </>
        )}
      </main>
    </div>
  );
};

export default Employees;
