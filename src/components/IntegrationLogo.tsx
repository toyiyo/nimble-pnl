import * as SimpleIcons from 'simple-icons';

interface IntegrationLogoProps {
  integrationId: string;
  size?: number;
  className?: string;
}

const logoMap: Record<string, { icon: any; color: string }> = {
  // Toast POS - no direct icon available, using emoji fallback
  'square-pos': { icon: SimpleIcons.siSquare, color: '#000000' },
  'clover-pos': { icon: SimpleIcons.siCashapp, color: '#3FA142' },
  '7shifts': { icon: SimpleIcons.siCalendly, color: '#137CBD' },
  'when-i-work': { icon: SimpleIcons.siClockify, color: '#FF6B6B' },
  'quickbooks': { icon: SimpleIcons.siQuickbooks, color: '#2CA01C' },
  'sysco': { icon: SimpleIcons.siWebmoney, color: '#0072CE' },
};

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
