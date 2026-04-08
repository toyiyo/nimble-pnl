import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';

interface GeofenceSettingsProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  enforcement: 'off' | 'warn' | 'block';
  onSave: (values: {
    latitude: number | null;
    longitude: number | null;
    geofence_radius_meters: number;
    geofence_enforcement: string;
  }) => void;
  saving: boolean;
}

export function GeofenceSettings({
  latitude, longitude, radiusMeters, enforcement, onSave, saving
}: GeofenceSettingsProps) {
  const [lat, setLat] = useState(latitude?.toString() ?? '');
  const [lng, setLng] = useState(longitude?.toString() ?? '');
  const [radius, setRadius] = useState(radiusMeters);
  const [mode, setMode] = useState(enforcement);

  const handleUseCurrentLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
    });
  };

  const handleSave = () => {
    onSave({
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null,
      geofence_radius_meters: radius,
      geofence_enforcement: mode,
    });
  };

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h3 className="text-[13px] font-semibold text-foreground">Geofence Settings</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Require employees to be at the restaurant when clocking in
        </p>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Enforcement Mode
          </Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="warn">Warn (allow but flag)</SelectItem>
              <SelectItem value="block">Block (prevent clock-in)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode !== 'off' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Latitude
                </Label>
                <Input
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="40.7128"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Longitude
                </Label>
                <Input
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-74.006"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleUseCurrentLocation}
              className="w-full h-9 text-[13px] font-medium rounded-lg"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Use Current Location
            </Button>
            <div>
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Radius (meters): {radius}m
              </Label>
              <input
                type="range"
                min={50}
                max={500}
                step={25}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full mt-2"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>50m</span>
                <span>500m</span>
              </div>
            </div>
          </>
        )}

        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
        >
          {saving ? 'Saving...' : 'Save Geofence Settings'}
        </Button>
      </div>
    </div>
  );
}
