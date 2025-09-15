-- Create invitations table to store pending team invitations
CREATE TABLE public.invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  invited_by UUID NOT NULL, -- User who sent the invitation
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, expired, cancelled
  token TEXT NOT NULL, -- Unique token for invitation acceptance
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE,
  accepted_by UUID, -- User who accepted (will be set when accepted)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, email, status) -- Prevent duplicate pending invitations for same email
);

-- Enable RLS on invitations
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Create policies for invitations
CREATE POLICY "Restaurant owners and managers can view invitations for their restaurant"
ON public.invitations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = invitations.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Restaurant owners and managers can create invitations"
ON public.invitations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = invitations.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
  AND invited_by = auth.uid()
);

CREATE POLICY "Restaurant owners and managers can update invitations"
ON public.invitations
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = invitations.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Users can accept invitations sent to their email"
ON public.invitations
FOR UPDATE
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status = 'pending'
  AND expires_at > now()
)
WITH CHECK (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status IN ('accepted')
  AND accepted_by = auth.uid()
);

-- Add trigger for updated_at
CREATE TRIGGER update_invitations_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to clean up expired invitations
CREATE OR REPLACE FUNCTION public.cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
  UPDATE public.invitations 
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' 
  AND expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;