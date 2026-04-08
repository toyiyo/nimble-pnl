interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 32, className = '' }: AppLogoProps) {
  return (
    <img
      src="/icon-192.png"
      alt="EasyShiftHQ"
      width={size}
      height={size}
      className={`rounded-lg ${className}`.trim()}
    />
  );
}
