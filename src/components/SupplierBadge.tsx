import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Building2, ExternalLink, Phone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface Supplier {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  website: string | null;
  is_active: boolean;
}

interface SupplierBadgeProps {
  supplier: Supplier | null;
  className?: string;
}

export const SupplierBadge: React.FC<SupplierBadgeProps> = ({ 
  supplier, 
  className = "" 
}) => {
  if (!supplier) {
    return (
      <Badge variant="outline" className={`${className} text-muted-foreground`}>
        <Building2 className="h-3 w-3 mr-1" />
        No Supplier
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={`h-auto p-0 hover:bg-transparent ${className}`}
        >
          <Badge 
            variant={supplier.is_active ? "secondary" : "outline"} 
            className="cursor-pointer hover:bg-primary/10"
          >
            <Building2 className="h-3 w-3 mr-1" />
            {supplier.name}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {supplier.name}
            </h4>
            {!supplier.is_active && (
              <Badge variant="outline" className="text-xs mt-1">
                Inactive
              </Badge>
            )}
          </div>

          <div className="space-y-2 text-sm">
            {supplier.contact_email && (
              <div className="flex items-center gap-2">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <a 
                  href={`mailto:${supplier.contact_email}`}
                  className="text-blue-600 hover:underline"
                >
                  {supplier.contact_email}
                </a>
              </div>
            )}

            {supplier.contact_phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <a 
                  href={`tel:${supplier.contact_phone}`}
                  className="text-blue-600 hover:underline"
                >
                  {supplier.contact_phone}
                </a>
              </div>
            )}

            {supplier.address && (
              <div className="text-muted-foreground">
                {supplier.address}
              </div>
            )}

            {supplier.website && (
              <div className="flex items-center gap-2">
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                <a 
                  href={supplier.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Visit Website
                </a>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};