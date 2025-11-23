import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Clock } from 'lucide-react';

interface TimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

export const TimeInput = ({
  id,
  label,
  value,
  onChange,
  required = true,
}: TimeInputProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} {required && '*'}
      </Label>
      <div className="relative">
        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id={id}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
        />
      </div>
    </div>
  );
};
