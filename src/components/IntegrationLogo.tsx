import * as SimpleIcons from 'simple-icons';

interface IntegrationLogoProps {
  integrationId: string;
  size?: number;
  className?: string;
}

// Image-based logos (stored in public/logos/)
const imageLogoMap: Record<string, string> = {
  'clover-pos': '/logos/clover.png',
};

// SVG icon-based logos from simple-icons
const logoMap: Record<string, { icon: any; color: string }> = {
  'square-pos': { icon: SimpleIcons.siSquare, color: '#000000' },
  'quickbooks': { icon: SimpleIcons.siQuickbooks, color: '#2CA01C' },
  'sysco': { icon: SimpleIcons.siWebmoney, color: '#0072CE' },
};

// Emoji fallbacks for logos not available as images or SVG icons
const emojiMap: Record<string, string> = {
  'toast-pos': '🍞',
  'square-pos': '⬜',
  'clover-pos': '🍀',
  '7shifts': '📅',
  'when-i-work': '⏰',
  'quickbooks': '💼',
  'sysco': '🚚',
};

export const IntegrationLogo = ({ integrationId, size = 24, className = '' }: IntegrationLogoProps) => {
  // Check for image logo first
  const imagePath = imageLogoMap[integrationId];
  if (imagePath) {
    return (
      <img 
        src={imagePath} 
        alt={`${integrationId} logo`}
        width={size}
        height={size}
        className={className}
      />
    );
  }
  
  // Then check for SVG icon
  const logo = logoMap[integrationId];
  if (logo?.icon) {
    const iconPath = logo.icon.path;
    const iconColor = logo.color;
    
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <svg
          role="img"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          style={{ color: iconColor }}
        >
          <path d={iconPath} />
        </svg>
      </div>
    );
  }
  
  // Fallback to emoji
  return (
    <div className={`flex items-center justify-center text-2xl ${className}`}>
      {emojiMap[integrationId] || '🔌'}
    </div>
  );
};
