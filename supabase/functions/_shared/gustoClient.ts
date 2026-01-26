// Gusto API Client Utility
// Shared utility for all Gusto Edge Functions

import { getEncryptionService } from './encryption.ts';

// Environment configuration
const GUSTO_DEMO_BASE_URL = 'https://api.gusto-demo.com';
const GUSTO_PROD_BASE_URL = 'https://api.gusto.com';

export interface GustoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl: string;
  environment: 'demo' | 'production';
}

export interface GustoTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface GustoApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Get Gusto configuration based on environment
 * @param origin - The origin header from the request
 * @returns Gusto configuration object
 */
export function getGustoConfig(origin?: string): GustoConfig {
  // Determine environment based on origin
  let isDemo = true; // Default to demo for safety

  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname.toLowerCase();
      // Only use production for the actual production domain
      isDemo = hostname !== 'app.easyshifthq.com';
    } catch {
      console.warn('Invalid origin URL:', origin);
    }
  }

  const clientId = isDemo
    ? Deno.env.get('GUSTO_DEMO_CLIENT_ID')
    : Deno.env.get('GUSTO_CLIENT_ID');

  const clientSecret = isDemo
    ? Deno.env.get('GUSTO_DEMO_CLIENT_SECRET')
    : Deno.env.get('GUSTO_CLIENT_SECRET');

  const redirectUri = isDemo
    ? `${origin || 'http://localhost:5173'}/gusto/callback`
    : 'https://app.easyshifthq.com/gusto/callback';

  if (!clientId || !clientSecret) {
    throw new Error(`Gusto credentials not configured for ${isDemo ? 'demo' : 'production'} environment`);
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    baseUrl: isDemo ? GUSTO_DEMO_BASE_URL : GUSTO_PROD_BASE_URL,
    environment: isDemo ? 'demo' : 'production',
  };
}

/**
 * Gusto API Client class for making authenticated API calls
 */
export class GustoClient {
  private accessToken: string;
  private baseUrl: string;
  private apiVersion: string = '2025-06-15'; // Gusto API version

  constructor(accessToken: string, baseUrl: string = GUSTO_DEMO_BASE_URL) {
    this.accessToken = accessToken;
    this.baseUrl = baseUrl;
  }

  /**
   * Make an authenticated API call to Gusto
   */
  async request<T>(
    endpoint: string,
    options: GustoApiOptions = {}
  ): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const url = `${this.baseUrl}${endpoint}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'X-Gusto-API-Version': this.apiVersion,
      ...headers,
    };

    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && method !== 'GET') {
      requestOptions.body = JSON.stringify(body);
    }

    console.log(`[GUSTO-API] ${method} ${endpoint}`);

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GUSTO-API] Error ${response.status}:`, errorText);

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }

      throw new GustoApiError(
        response.status,
        errorData.error || errorData.message || 'Unknown error',
        errorData
      );
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // ============================================================================
  // Company Methods
  // ============================================================================

  async getCompany(companyUuid: string) {
    return this.request<GustoCompanyResponse>(`/v1/companies/${companyUuid}`);
  }

  async getCompanyLocations(companyUuid: string) {
    return this.request<GustoLocation[]>(`/v1/companies/${companyUuid}/locations`);
  }

  // ============================================================================
  // Employee Methods
  // ============================================================================

  async getEmployees(companyUuid: string) {
    return this.request<GustoEmployee[]>(`/v1/companies/${companyUuid}/employees`);
  }

  async getEmployee(employeeUuid: string) {
    return this.request<GustoEmployee>(`/v1/employees/${employeeUuid}`);
  }

  async createEmployee(companyUuid: string, employeeData: CreateEmployeeRequest) {
    return this.request<GustoEmployee>(`/v1/companies/${companyUuid}/employees`, {
      method: 'POST',
      body: employeeData as unknown as Record<string, unknown>,
    });
  }

  async updateEmployee(employeeUuid: string, version: string, updates: UpdateEmployeeRequest) {
    return this.request<GustoEmployee>(`/v1/employees/${employeeUuid}`, {
      method: 'PUT',
      body: { ...updates, version } as unknown as Record<string, unknown>,
    });
  }

  // ============================================================================
  // Contractor Methods
  // ============================================================================

  async getContractors(companyUuid: string) {
    return this.request<GustoContractor[]>(`/v1/companies/${companyUuid}/contractors`);
  }

  async createContractor(companyUuid: string, contractorData: CreateContractorRequest) {
    return this.request<GustoContractor>(`/v1/companies/${companyUuid}/contractors`, {
      method: 'POST',
      body: contractorData as unknown as Record<string, unknown>,
    });
  }

  // ============================================================================
  // Time Activity Methods
  // ============================================================================

  async createTimeActivities(companyUuid: string, timeActivities: TimeActivityBatch) {
    return this.request<TimeActivityResponse>(`/v1/companies/${companyUuid}/time_activities`, {
      method: 'POST',
      body: timeActivities as unknown as Record<string, unknown>,
    });
  }

  async getTimeActivities(companyUuid: string, startDate: string, endDate: string) {
    return this.request<TimeActivity[]>(
      `/v1/companies/${companyUuid}/time_activities?start_date=${startDate}&end_date=${endDate}`
    );
  }

  // ============================================================================
  // Payroll Methods
  // ============================================================================

  async getPayrolls(companyUuid: string) {
    return this.request<GustoPayroll[]>(`/v1/companies/${companyUuid}/payrolls`);
  }

  async getPayroll(companyUuid: string, payrollUuid: string) {
    return this.request<GustoPayroll>(`/v1/companies/${companyUuid}/payrolls/${payrollUuid}`);
  }

  // ============================================================================
  // Flow Methods
  // ============================================================================

  async createFlow(companyUuid: string, flowType: string, entityUuid?: string, entityType?: string) {
    const body: Record<string, unknown> = {
      flow_type: flowType,
    };

    // Only include entity fields for flows that require a specific employee/contractor
    // employee_self_management requires the employee UUID
    if (flowType === 'employee_self_management' && entityUuid) {
      body.entity_uuid = entityUuid;
      body.entity_type = entityType || 'Employee';
    }

    console.log('[GUSTO-API] Creating flow with body:', JSON.stringify(body));

    return this.request<FlowResponse>(`/v1/companies/${companyUuid}/flows`, {
      method: 'POST',
      body,
    });
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class GustoApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'GustoApiError';
    this.status = status;
    this.data = data;
  }
}

// ============================================================================
// Token Management Utilities
// ============================================================================

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
  config: GustoConfig
): Promise<GustoTokenResponse> {
  const tokenUrl = `${config.baseUrl}/oauth/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GUSTO-OAUTH] Token exchange failed:', errorText);
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return response.json();
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: GustoConfig
): Promise<GustoTokenResponse> {
  const tokenUrl = `${config.baseUrl}/oauth/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GUSTO-OAUTH] Token refresh failed:', errorText);
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return response.json();
}

/**
 * Create a Gusto client with automatic token decryption
 */
export async function createGustoClient(
  encryptedAccessToken: string,
  baseUrl: string = GUSTO_DEMO_BASE_URL
): Promise<GustoClient> {
  const encryption = await getEncryptionService();
  const accessToken = await encryption.decrypt(encryptedAccessToken);
  return new GustoClient(accessToken, baseUrl);
}

/**
 * Encrypt tokens before storage
 */
export async function encryptTokens(tokens: GustoTokenResponse): Promise<{
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
}> {
  const encryption = await getEncryptionService();

  const encryptedAccessToken = await encryption.encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? await encryption.encrypt(tokens.refresh_token)
    : null;

  return { encryptedAccessToken, encryptedRefreshToken };
}

// ============================================================================
// Type Definitions
// ============================================================================

interface GustoCompanyResponse {
  uuid: string;
  name: string;
  trade_name: string | null;
  ein: string;
  entity_type: string;
  company_status: string;
  is_suspended: boolean;
}

interface GustoLocation {
  uuid: string;
  company_uuid: string;
  version: string;
  phone_number: string | null;
  street_1: string;
  street_2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  active: boolean;
}

interface GustoEmployee {
  uuid: string;
  first_name: string;
  middle_initial: string | null;
  last_name: string;
  email: string | null;
  date_of_birth: string | null;
  company_uuid: string;
  manager_uuid: string | null;
  version: string;
  department: string | null;
  terminated: boolean;
  onboarding_status: string;
  jobs: GustoJob[];
}

interface GustoJob {
  uuid: string;
  version: string;
  employee_uuid: string;
  location_uuid: string;
  title: string;
  primary: boolean;
  rate: string;
  payment_unit: string;
}

interface GustoContractor {
  uuid: string;
  company_uuid: string;
  type: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  is_active: boolean;
  version: string;
}

interface GustoPayroll {
  uuid: string;
  company_uuid: string;
  pay_period: {
    start_date: string;
    end_date: string;
  };
  check_date: string;
  processed: boolean;
}

interface CreateEmployeeRequest {
  first_name: string;
  last_name: string;
  email?: string;
  date_of_birth?: string;
  ssn?: string;
  self_onboarding?: boolean;
}

interface UpdateEmployeeRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface CreateContractorRequest {
  type: 'Individual' | 'Business';
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  self_onboarding?: boolean;
}

interface TimeActivityBatch {
  time_activities: TimeActivity[];
}

interface TimeActivity {
  employee_uuid: string;
  date: string;
  hours: string;
  activity_type: string;
  description?: string;
}

interface TimeActivityResponse {
  created_count: number;
  errors?: Array<{
    employee_uuid: string;
    error: string;
  }>;
}

interface FlowResponse {
  url: string;
  expires_at: string;
}
