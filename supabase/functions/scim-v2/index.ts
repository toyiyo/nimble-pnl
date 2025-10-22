import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScimUser {
  id?: string;
  externalId?: string;
  userName: string;
  name?: {
    givenName?: string;
    familyName?: string;
    formatted?: string;
  };
  emails: Array<{
    value: string;
    primary?: boolean;
  }>;
  active?: boolean;
  groups?: Array<{
    value: string;
    display?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
  };
}

interface ScimGroup {
  id?: string;
  displayName: string;
  externalId?: string;
  members?: Array<{
    value: string;
    display?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
  };
}

const scimError = (status: number, scimType: string, detail: string) => {
  return new Response(
    JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: status.toString(),
      scimType,
      detail,
    }),
    {
      status,
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      },
    }
  );
};

const getRestaurantFromToken = async (supabase: any, token: string): Promise<string | null> => {
  // Extract restaurant ID from SCIM token format: scim_{restaurant_id_prefix}_{token}
  const tokenParts = token.split('_');
  if (tokenParts.length < 3 || !token.startsWith('scim_')) {
    return null;
  }

  // Get the restaurant ID prefix (first 8 chars)
  const restaurantPrefix = tokenParts[1];
  
  // Find the restaurant with matching SCIM token
  const { data: settings, error } = await supabase
    .from('enterprise_settings')
    .select('restaurant_id')
    .eq('scim_token', token)
    .eq('scim_enabled', true)
    .single();

  if (error || !settings) {
    console.log('Token validation failed:', error);
    return null;
  }

  return settings.restaurant_id;
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Extract the path after /scim/v2/
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(p => p);
    const scimPath = pathParts.slice(2).join('/'); // Remove 'functions' and 'scim-v2'

    // SCIM Authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return scimError(401, 'invalidCredentials', 'Missing or invalid Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const restaurantId = await getRestaurantFromToken(supabase, token);
    
    if (!restaurantId) {
      return scimError(401, 'invalidCredentials', 'Invalid SCIM token');
    }

    console.log(`SCIM request: ${req.method} /${scimPath} for restaurant ${restaurantId}`);

    // Handle different SCIM endpoints
    switch (scimPath) {
      case 'ServiceProviderConfig':
        if (req.method === 'GET') {
          return new Response(JSON.stringify({
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            documentationUri: "https://docs.restaurantops.app/scim",
            patch: {
              supported: true
            },
            bulk: {
              supported: false,
              maxOperations: 0,
              maxPayloadSize: 0
            },
            filter: {
              supported: true,
              maxResults: 200
            },
            changePassword: {
              supported: false
            },
            sort: {
              supported: true
            },
            etag: {
              supported: false
            },
            authenticationSchemes: [{
              type: "httpbasic",
              name: "HTTP Basic",
              description: "Authentication via HTTP Basic",
              specUri: "http://www.rfc-editor.org/info/rfc2617",
              primary: true
            }],
            meta: {
              location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/ServiceProviderConfig`,
              resourceType: "ServiceProviderConfig"
            }
          }), {
            headers: { 
              'Content-Type': 'application/scim+json',
              ...corsHeaders 
            }
          });
        }
        break;

      case 'ResourceTypes':
        if (req.method === 'GET') {
          return new Response(JSON.stringify([
            {
              schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
              id: "User",
              name: "User",
              endpoint: "/Users",
              description: "User Account",
              schema: "urn:ietf:params:scim:schemas:core:2.0:User",
              meta: {
                location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/ResourceTypes/User`,
                resourceType: "ResourceType"
              }
            },
            {
              schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
              id: "Group",
              name: "Group",
              endpoint: "/Groups",
              description: "Group",
              schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
              meta: {
                location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/ResourceTypes/Group`,
                resourceType: "ResourceType"
              }
            }
          ]), {
            headers: { 
              'Content-Type': 'application/scim+json',
              ...corsHeaders 
            }
          });
        }
        break;

      case 'Schemas':
        if (req.method === 'GET') {
          return new Response(JSON.stringify([
            {
              id: "urn:ietf:params:scim:schemas:core:2.0:User",
              name: "User",
              description: "User Account",
              attributes: [
                {
                  name: "userName",
                  type: "string",
                  multiValued: false,
                  description: "Unique identifier for the User",
                  required: true,
                  caseExact: false,
                  mutability: "readWrite",
                  returned: "default",
                  uniqueness: "server"
                },
                {
                  name: "name",
                  type: "complex",
                  multiValued: false,
                  description: "The components of the user's real name.",
                  required: false,
                  subAttributes: [
                    {
                      name: "formatted",
                      type: "string",
                      multiValued: false,
                      description: "The full name",
                      required: false,
                      caseExact: false,
                      mutability: "readWrite",
                      returned: "default",
                      uniqueness: "none"
                    },
                    {
                      name: "familyName",
                      type: "string",
                      multiValued: false,
                      description: "The family name of the User",
                      required: false,
                      caseExact: false,
                      mutability: "readWrite",
                      returned: "default",
                      uniqueness: "none"
                    },
                    {
                      name: "givenName",
                      type: "string",
                      multiValued: false,
                      description: "The given name of the User",
                      required: false,
                      caseExact: false,
                      mutability: "readWrite",
                      returned: "default",
                      uniqueness: "none"
                    }
                  ],
                  mutability: "readWrite",
                  returned: "default",
                  uniqueness: "none"
                },
                {
                  name: "emails",
                  type: "complex",
                  multiValued: true,
                  description: "Email addresses for the user",
                  required: false,
                  subAttributes: [
                    {
                      name: "value",
                      type: "string",
                      multiValued: false,
                      description: "Email addresses for the user",
                      required: false,
                      caseExact: false,
                      mutability: "readWrite",
                      returned: "default",
                      uniqueness: "none"
                    },
                    {
                      name: "primary",
                      type: "boolean",
                      multiValued: false,
                      description: "A Boolean value indicating the 'primary' or preferred attribute value for this attribute",
                      required: false,
                      mutability: "readWrite",
                      returned: "default"
                    }
                  ],
                  mutability: "readWrite",
                  returned: "default",
                  uniqueness: "none"
                },
                {
                  name: "active",
                  type: "boolean",
                  multiValued: false,
                  description: "A Boolean value indicating the User's administrative status",
                  required: false,
                  mutability: "readWrite",
                  returned: "default"
                }
              ],
              meta: {
                resourceType: "Schema",
                location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`
              }
            }
          ]), {
            headers: { 
              'Content-Type': 'application/scim+json',
              ...corsHeaders 
            }
          });
        }
        break;

      case 'Users':
        return await handleUsers(req, supabase, restaurantId);

      case 'Groups':
        return await handleGroups(req, supabase, restaurantId);

      default:
        // Handle specific user/group by ID
        if (scimPath.startsWith('Users/')) {
          const userId = scimPath.split('/')[1];
          return await handleUserById(req, supabase, restaurantId, userId);
        }
        if (scimPath.startsWith('Groups/')) {
          const groupId = scimPath.split('/')[1];
          return await handleGroupById(req, supabase, restaurantId, groupId);
        }
        
        return scimError(404, 'invalidPath', `Endpoint /${scimPath} not found`);
    }

    return scimError(405, 'invalidMethod', `Method ${req.method} not supported for /${scimPath}`);

  } catch (error: any) {
    console.error('SCIM Error:', error);
    return scimError(500, 'internalError', error.message);
  }
};

const handleUsers = async (req: Request, supabase: any, restaurantId: string): Promise<Response> => {
  if (req.method === 'GET') {
    // List users with pagination and filtering
    const url = new URL(req.url);
    const startIndex = parseInt(url.searchParams.get('startIndex') || '1');
    const count = Math.min(parseInt(url.searchParams.get('count') || '20'), 200);
    const filter = url.searchParams.get('filter');

    let query = supabase
      .from('scim_users')
      .select('*')
      .eq('restaurant_id', restaurantId);

    // Apply filter if provided (basic email filtering)
    if (filter) {
      const emailMatch = filter.match(/emails\s+eq\s+"([^"]+)"/);
      if (emailMatch) {
        query = query.eq('email', emailMatch[1]);
      }
    }

    const { data: users, error } = await query
      .range(startIndex - 1, startIndex + count - 2);

    if (error) {
      console.error('Error fetching users:', error);
      return scimError(500, 'internalError', 'Failed to fetch users');
    }

    const scimUsers = users.map((user: any) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.scim_id,
      externalId: user.external_id,
      userName: user.user_name,
      name: {
        givenName: user.given_name,
        familyName: user.family_name,
        formatted: user.given_name && user.family_name ? `${user.given_name} ${user.family_name}` : undefined
      },
      emails: [{
        value: user.email,
        primary: true
      }],
      active: user.active,
      meta: {
        resourceType: "User",
        created: user.created_at,
        lastModified: user.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Users/${user.scim_id}`
      }
    }));

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: scimUsers.length,
      itemsPerPage: count,
      startIndex,
      Resources: scimUsers
    }), {
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      }
    });
  }

  if (req.method === 'POST') {
    // Create new user
    const user: ScimUser = await req.json();
    
    if (!user.userName || !user.emails || user.emails.length === 0) {
      return scimError(400, 'invalidValue', 'userName and emails are required');
    }

    const email = user.emails[0].value;
    const scimId = crypto.randomUUID();

    try {
      const { data: newUser, error } = await supabase
        .from('scim_users')
        .insert({
          restaurant_id: restaurantId,
          scim_id: scimId,
          external_id: user.externalId,
          user_name: user.userName,
          email: email,
          given_name: user.name?.givenName,
          family_name: user.name?.familyName,
          active: user.active !== false
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating user:', error);
        if (error.code === '23505') { // Unique violation
          return scimError(409, 'uniqueness', 'User already exists');
        }
        return scimError(500, 'internalError', 'Failed to create user');
      }

      // Create corresponding auth user if auto-provisioning is enabled
      const { data: settings } = await supabase
        .from('enterprise_settings')
        .select('auto_provisioning, default_role')
        .eq('restaurant_id', restaurantId)
        .single();

      if (settings?.auto_provisioning) {
        // Create auth user (this would typically be done via admin API)
        console.log(`Auto-provisioning user ${email} with role ${settings.default_role}`);
        
        // Add to user_restaurants table
        await supabase
          .from('user_restaurants')
          .insert({
            user_id: newUser.user_id, // This would be set from actual auth user creation
            restaurant_id: restaurantId,
            role: settings.default_role || 'staff'
          });
      }

      const responseUser = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: scimId,
        externalId: user.externalId,
        userName: user.userName,
        name: user.name,
        emails: user.emails,
        active: newUser.active,
        meta: {
          resourceType: "User",
          created: newUser.created_at,
          lastModified: newUser.updated_at,
          location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Users/${scimId}`
        }
      };

      return new Response(JSON.stringify(responseUser), {
        status: 201,
        headers: { 
          'Content-Type': 'application/scim+json',
          'Location': `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Users/${scimId}`,
          ...corsHeaders 
        }
      });
    } catch (error: any) {
      console.error('Error in user creation:', error);
      return scimError(500, 'internalError', error.message);
    }
  }

  return scimError(405, 'invalidMethod', `Method ${req.method} not supported`);
};

const handleUserById = async (req: Request, supabase: any, restaurantId: string, userId: string): Promise<Response> => {
  if (req.method === 'GET') {
    const { data: user, error } = await supabase
      .from('scim_users')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('scim_id', userId)
      .single();

    if (error || !user) {
      return scimError(404, 'invalidValue', 'User not found');
    }

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.scim_id,
      externalId: user.external_id,
      userName: user.user_name,
      name: {
        givenName: user.given_name,
        familyName: user.family_name,
        formatted: user.given_name && user.family_name ? `${user.given_name} ${user.family_name}` : undefined
      },
      emails: [{
        value: user.email,
        primary: true
      }],
      active: user.active,
      meta: {
        resourceType: "User",
        created: user.created_at,
        lastModified: user.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Users/${user.scim_id}`
      }
    }), {
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      }
    });
  }

  if (req.method === 'PUT') {
    const updatedUser: ScimUser = await req.json();
    
    const { data: user, error } = await supabase
      .from('scim_users')
      .update({
        external_id: updatedUser.externalId,
        user_name: updatedUser.userName,
        email: updatedUser.emails?.[0]?.value,
        given_name: updatedUser.name?.givenName,
        family_name: updatedUser.name?.familyName,
        active: updatedUser.active
      })
      .eq('restaurant_id', restaurantId)
      .eq('scim_id', userId)
      .select()
      .single();

    if (error || !user) {
      return scimError(404, 'invalidValue', 'User not found');
    }

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.scim_id,
      externalId: user.external_id,
      userName: user.user_name,
      name: {
        givenName: user.given_name,
        familyName: user.family_name,
        formatted: user.given_name && user.family_name ? `${user.given_name} ${user.family_name}` : undefined
      },
      emails: [{
        value: user.email,
        primary: true
      }],
      active: user.active,
      meta: {
        resourceType: "User",
        created: user.created_at,
        lastModified: user.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Users/${user.scim_id}`
      }
    }), {
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      }
    });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('scim_users')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('scim_id', userId);

    if (error) {
      return scimError(404, 'invalidValue', 'User not found');
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return scimError(405, 'invalidMethod', `Method ${req.method} not supported`);
};

const handleGroups = async (req: Request, supabase: any, restaurantId: string): Promise<Response> => {
  if (req.method === 'GET') {
    const { data: groups, error } = await supabase
      .from('scim_groups')
      .select(`
        *,
        scim_group_members(
          scim_users(scim_id, user_name, email)
        )
      `)
      .eq('restaurant_id', restaurantId);

    if (error) {
      return scimError(500, 'internalError', 'Failed to fetch groups');
    }

    const scimGroups = groups.map((group: any) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.scim_id,
      displayName: group.display_name,
      externalId: group.external_id,
      members: group.scim_group_members?.map((member: any) => ({
        value: member.scim_users.scim_id,
        display: member.scim_users.user_name
      })) || [],
      meta: {
        resourceType: "Group",
        created: group.created_at,
        lastModified: group.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Groups/${group.scim_id}`
      }
    }));

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: scimGroups.length,
      itemsPerPage: scimGroups.length,
      startIndex: 1,
      Resources: scimGroups
    }), {
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      }
    });
  }

  if (req.method === 'POST') {
    const group: ScimGroup = await req.json();
    
    if (!group.displayName) {
      return scimError(400, 'invalidValue', 'displayName is required');
    }

    const scimId = crypto.randomUUID();

    const { data: newGroup, error } = await supabase
      .from('scim_groups')
      .insert({
        restaurant_id: restaurantId,
        scim_id: scimId,
        display_name: group.displayName,
        external_id: group.externalId
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return scimError(409, 'uniqueness', 'Group already exists');
      }
      return scimError(500, 'internalError', 'Failed to create group');
    }

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: scimId,
      displayName: group.displayName,
      externalId: group.externalId,
      members: [],
      meta: {
        resourceType: "Group",
        created: newGroup.created_at,
        lastModified: newGroup.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Groups/${scimId}`
      }
    }), {
      status: 201,
      headers: { 
        'Content-Type': 'application/scim+json',
        'Location': `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Groups/${scimId}`,
        ...corsHeaders 
      }
    });
  }

  return scimError(405, 'invalidMethod', `Method ${req.method} not supported`);
};

const handleGroupById = async (req: Request, supabase: any, restaurantId: string, groupId: string): Promise<Response> => {
  if (req.method === 'GET') {
    const { data: group, error } = await supabase
      .from('scim_groups')
      .select(`
        *,
        scim_group_members(
          scim_users(scim_id, user_name, email)
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('scim_id', groupId)
      .single();

    if (error || !group) {
      return scimError(404, 'invalidValue', 'Group not found');
    }

    return new Response(JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.scim_id,
      displayName: group.display_name,
      externalId: group.external_id,
      members: group.scim_group_members?.map((member: any) => ({
        value: member.scim_users.scim_id,
        display: member.scim_users.user_name
      })) || [],
      meta: {
        resourceType: "Group",
        created: group.created_at,
        lastModified: group.updated_at,
        location: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2/Groups/${group.scim_id}`
      }
    }), {
      headers: { 
        'Content-Type': 'application/scim+json',
        ...corsHeaders 
      }
    });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('scim_groups')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('scim_id', groupId);

    if (error) {
      return scimError(404, 'invalidValue', 'Group not found');
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return scimError(405, 'invalidMethod', `Method ${req.method} not supported`);
};

serve(handler);