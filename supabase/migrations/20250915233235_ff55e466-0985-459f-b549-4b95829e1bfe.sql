-- Create enterprise_settings table to store SCIM and SSO configuration
CREATE TABLE public.enterprise_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  scim_enabled BOOLEAN NOT NULL DEFAULT false,
  scim_endpoint TEXT,
  scim_token TEXT,
  sso_enabled BOOLEAN NOT NULL DEFAULT false,
  sso_provider TEXT,
  sso_domain TEXT,
  auto_provisioning BOOLEAN NOT NULL DEFAULT false,
  default_role TEXT DEFAULT 'staff',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS on enterprise_settings
ALTER TABLE public.enterprise_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for enterprise_settings
CREATE POLICY "Restaurant owners can manage enterprise settings"
ON public.enterprise_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = enterprise_settings.restaurant_id 
    AND user_id = auth.uid() 
    AND role = 'owner'
  )
);

-- Create scim_users table to track SCIM provisioned users
CREATE TABLE public.scim_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  scim_id TEXT NOT NULL, -- External SCIM ID from identity provider
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT, -- External ID from identity provider
  user_name TEXT NOT NULL,
  email TEXT NOT NULL,
  given_name TEXT,
  family_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, scim_id),
  UNIQUE(restaurant_id, email)
);

-- Enable RLS on scim_users
ALTER TABLE public.scim_users ENABLE ROW LEVEL SECURITY;

-- Create policies for scim_users
CREATE POLICY "Restaurant members can view SCIM users for their restaurant"
ON public.scim_users
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = scim_users.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "SCIM can manage users (bypassed via service role in edge functions)"
ON public.scim_users
FOR ALL
USING (false); -- This will be bypassed in edge functions using service role

-- Create scim_groups table for group management
CREATE TABLE public.scim_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  scim_id TEXT NOT NULL, -- External SCIM ID from identity provider
  display_name TEXT NOT NULL,
  external_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, scim_id),
  UNIQUE(restaurant_id, display_name)
);

-- Enable RLS on scim_groups
ALTER TABLE public.scim_groups ENABLE ROW LEVEL SECURITY;

-- Create policies for scim_groups
CREATE POLICY "Restaurant members can view SCIM groups for their restaurant"
ON public.scim_groups
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE restaurant_id = scim_groups.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "SCIM can manage groups (bypassed via service role in edge functions)"
ON public.scim_groups
FOR ALL
USING (false); -- This will be bypassed in edge functions using service role

-- Create scim_group_members table for group membership
CREATE TABLE public.scim_group_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.scim_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Enable RLS on scim_group_members
ALTER TABLE public.scim_group_members ENABLE ROW LEVEL SECURITY;

-- Create policies for scim_group_members
CREATE POLICY "Restaurant members can view SCIM group members for their restaurant"
ON public.scim_group_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM scim_groups sg
    JOIN user_restaurants ur ON sg.restaurant_id = ur.restaurant_id
    WHERE sg.id = scim_group_members.group_id 
    AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "SCIM can manage group members (bypassed via service role in edge functions)"
ON public.scim_group_members
FOR ALL
USING (false); -- This will be bypassed in edge functions using service role

-- Create triggers for updated_at columns
CREATE TRIGGER update_enterprise_settings_updated_at
  BEFORE UPDATE ON public.enterprise_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scim_users_updated_at
  BEFORE UPDATE ON public.scim_users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scim_groups_updated_at
  BEFORE UPDATE ON public.scim_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();