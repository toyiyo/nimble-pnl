-- Add missing measurement unit enum values for comprehensive unit support
-- These units are already used in the application logic but missing from the enum

-- Add volume units
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'L';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'gal';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'qt';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'pint';

-- Add container units
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'jar';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'container';

-- Add other count units
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'case';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'package';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'dozen';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'each';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'unit';

-- Add length units (for completeness)
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'inch';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'cm';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'mm';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'ft';
ALTER TYPE public.measurement_unit ADD VALUE IF NOT EXISTS 'meter';