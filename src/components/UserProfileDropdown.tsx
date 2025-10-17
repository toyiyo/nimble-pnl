import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, Users, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export const UserProfileDropdown = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const userInitial = user.email?.charAt(0).toUpperCase() || 'U';
  const userEmail = user.email || 'User';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          className="hidden md:flex items-center gap-2 h-9 px-3 hover:bg-accent/50 transition-all duration-200"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-semibold text-sm shadow-lg">
            {userInitial}
          </div>
          <div className="hidden lg:flex flex-col items-start">
            <span className="text-xs font-medium leading-none">{userEmail.split('@')[0]}</span>
            <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
              {userEmail.includes('@') ? `@${userEmail.split('@')[1]}` : ''}
            </span>
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-56 bg-background/95 backdrop-blur-xl border-border/50 shadow-xl"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{userEmail.split('@')[0]}</p>
            <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => { navigate('/settings'); setOpen(false); }}
          className="cursor-pointer hover:bg-accent/50 transition-colors duration-200"
        >
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => { navigate('/team'); setOpen(false); }}
          className="cursor-pointer hover:bg-accent/50 transition-colors duration-200"
        >
          <Users className="mr-2 h-4 w-4" />
          <span>Team</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => { signOut(); setOpen(false); }}
          className="cursor-pointer text-destructive hover:bg-destructive/10 transition-colors duration-200"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
