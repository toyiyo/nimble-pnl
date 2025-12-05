-- Add employee_id column to invitations table for linking staff invitations to employee records
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_invitations_employee_id ON public.invitations(employee_id);

-- Add comment to explain the column
COMMENT ON COLUMN public.invitations.employee_id IS 'Links invitation to employee record when role is staff. When user accepts invitation, their auth.user.id will be set on the employee record.';
