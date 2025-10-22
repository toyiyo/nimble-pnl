import { Building2 } from "lucide-react";

interface BankAccountInfoProps {
  institutionName?: string;
  accountMask?: string;
  className?: string;
  showIcon?: boolean;
  layout?: 'inline' | 'stacked';
}

export function BankAccountInfo({ 
  institutionName, 
  accountMask, 
  className = "",
  showIcon = true,
  layout = 'inline'
}: BankAccountInfoProps) {
  if (layout === 'stacked') {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <span className="text-sm">{institutionName || '—'}</span>
        {accountMask && (
          <span className="text-xs text-muted-foreground">
            ••••{accountMask}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      {showIcon && <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      <span>{institutionName || '—'}</span>
      {accountMask && (
        <span className="text-xs text-muted-foreground">
          (••••{accountMask})
        </span>
      )}
    </div>
  );
}
