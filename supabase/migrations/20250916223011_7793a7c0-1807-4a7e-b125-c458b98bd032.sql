-- Fix RLS policies for profiles table
-- Drop existing policies first to ensure clean setup
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create secure RLS policies for profiles
CREATE POLICY "Users can view only their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert only their own profile" 
ON public.profiles 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update only their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Deny all access to anonymous users
CREATE POLICY "Deny anonymous access to profiles" 
ON public.profiles 
FOR ALL 
TO anon
USING (false);

-- Fix RLS policies for restaurants table
DROP POLICY IF EXISTS "Users can view restaurants they're associated with" ON public.restaurants;
DROP POLICY IF EXISTS "Users can insert restaurants if they're the owner" ON public.restaurants;
DROP POLICY IF EXISTS "Owners and managers can update their restaurants" ON public.restaurants;

-- Restaurants should only be accessible to authenticated users associated with them
CREATE POLICY "Authenticated users can view associated restaurants" 
ON public.restaurants 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = restaurants.id 
  AND user_id = auth.uid()
));

CREATE POLICY "Authenticated users can insert restaurants with proper ownership" 
ON public.restaurants 
FOR INSERT 
TO authenticated
WITH CHECK (true); -- This will be restricted by trigger that creates user_restaurants association

CREATE POLICY "Owners and managers can update their restaurants" 
ON public.restaurants 
FOR UPDATE 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = restaurants.id 
  AND user_id = auth.uid() 
  AND role IN ('owner', 'manager')
));

CREATE POLICY "Deny anonymous access to restaurants" 
ON public.restaurants 
FOR ALL 
TO anon
USING (false);

-- Fix RLS policies for square_connections table
DROP POLICY IF EXISTS "Restaurant owners can manage Square connections" ON public.square_connections;

CREATE POLICY "Only restaurant owners/managers can access Square connections" 
ON public.square_connections 
FOR ALL 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = square_connections.restaurant_id 
  AND user_id = auth.uid() 
  AND role IN ('owner', 'manager')
));

CREATE POLICY "Deny anonymous access to Square connections" 
ON public.square_connections 
FOR ALL 
TO anon
USING (false);

-- Fix RLS policies for invitations table
DROP POLICY IF EXISTS "Restaurant owners and managers can create invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can update invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can view invitations for their r" ON public.invitations;
DROP POLICY IF EXISTS "Users can accept invitations sent to their email" ON public.invitations;

CREATE POLICY "Restaurant owners and managers can manage invitations" 
ON public.invitations 
FOR ALL 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = invitations.restaurant_id 
  AND user_id = auth.uid() 
  AND role IN ('owner', 'manager')
));

CREATE POLICY "Users can accept invitations sent to their email" 
ON public.invitations 
FOR UPDATE 
TO authenticated
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid()) 
  AND status = 'pending' 
  AND expires_at > now()
)
WITH CHECK (
  email = (SELECT email FROM auth.users WHERE id = auth.uid()) 
  AND status = 'accepted' 
  AND accepted_by = auth.uid()
);

CREATE POLICY "Deny anonymous access to invitations" 
ON public.invitations 
FOR ALL 
TO anon
USING (false);

-- Fix RLS policies for SCIM tables
DROP POLICY IF EXISTS "Restaurant members can view SCIM users for their restaurant" ON public.scim_users;
DROP POLICY IF EXISTS "SCIM can manage users (bypassed via service role in edge functi" ON public.scim_users;

CREATE POLICY "Only restaurant members can view SCIM users" 
ON public.scim_users 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = scim_users.restaurant_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Deny anonymous access to SCIM users" 
ON public.scim_users 
FOR ALL 
TO anon
USING (false);

-- Similar for scim_groups and scim_group_members
DROP POLICY IF EXISTS "Restaurant members can view SCIM groups for their restaurant" ON public.scim_groups;
DROP POLICY IF EXISTS "SCIM can manage groups (bypassed via service role in edge funct" ON public.scim_groups;

CREATE POLICY "Only restaurant members can view SCIM groups" 
ON public.scim_groups 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants 
  WHERE restaurant_id = scim_groups.restaurant_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Deny anonymous access to SCIM groups" 
ON public.scim_groups 
FOR ALL 
TO anon
USING (false);

DROP POLICY IF EXISTS "Restaurant members can view SCIM group members for their restau" ON public.scim_group_members;
DROP POLICY IF EXISTS "SCIM can manage group members (bypassed via service role in edg" ON public.scim_group_members;

CREATE POLICY "Only restaurant members can view SCIM group members" 
ON public.scim_group_members 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.scim_groups sg 
  JOIN public.user_restaurants ur ON sg.restaurant_id = ur.restaurant_id 
  WHERE sg.id = scim_group_members.group_id 
  AND ur.user_id = auth.uid()
));

CREATE POLICY "Deny anonymous access to SCIM group members" 
ON public.scim_group_members 
FOR ALL 
TO anon
USING (false);