import { Button } from '@/components/ui/button';
import googleLogo from '@/assets/google-logo.png';
import { useTheme } from 'next-themes';

interface GoogleSignInButtonProps {
  onClick: () => void;
  disabled?: boolean;
  text?: 'signin' | 'signup' | 'continue';
}

export const GoogleSignInButton = ({ 
  onClick, 
  disabled, 
  text = 'continue' 
}: GoogleSignInButtonProps) => {
  const { theme } = useTheme();
  
  const buttonText = {
    signin: 'Sign in with Google',
    signup: 'Sign up with Google',
    continue: 'Continue with Google'
  }[text];

  // Google's branding guidelines colors
  const isDark = theme === 'dark';
  
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="w-full h-10 relative overflow-hidden group"
      style={{
        backgroundColor: isDark ? '#131314' : '#FFFFFF',
        borderColor: isDark ? '#8E918F' : '#747775',
        borderWidth: '1px',
        color: isDark ? '#E3E3E3' : '#1F1F1F',
        fontFamily: 'Roboto, system-ui, -apple-system, sans-serif',
        fontWeight: 500,
        fontSize: '14px',
        lineHeight: '20px',
        padding: 0,
      }}
    >
      <div className="flex items-center justify-center w-full">
        {/* Google Logo with proper padding: 12px left, 10px right */}
        <div 
          className="flex items-center justify-center"
          style={{ 
            paddingLeft: '12px',
            paddingRight: '10px',
            height: '100%'
          }}
        >
          <img 
            src={googleLogo} 
            alt="Google logo" 
            className="w-[18px] h-[18px]"
            style={{ display: 'block' }}
          />
        </div>
        
        {/* Text with proper padding: 12px right */}
        <span 
          style={{ 
            paddingRight: '12px',
            whiteSpace: 'nowrap'
          }}
        >
          {disabled ? 'Redirecting...' : buttonText}
        </span>
      </div>
    </Button>
  );
};
