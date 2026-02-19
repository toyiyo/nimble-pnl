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
  // Job Methods
  // ============================================================================

  async updateJob(jobUuid: string, version: string, updates: UpdateJobRequest) {
    return this.request<GustoJob>(`/v1/jobs/${jobUuid}`, {
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
  // Time Tracking Methods (New API - replaces deprecated time_activities)
  // ============================================================================

  /**
   * Create a time sheet entry for an employee shift
   * This is the new endpoint replacing the deprecated time_activities
   */
  async createTimeSheet(companyUuid: string, timeSheet: TimeSheetRequest) {
    return this.request<TimeSheetResponse>(`/v1/companies/${companyUuid}/time_tracking/time_sheets`, {
      method: 'POST',
      body: timeSheet as unknown as Record<string, unknown>,
    });
  }

  /**
   * Get time sheets for a company within a date range
   */
  async getTimeSheets(companyUuid: string, startDate: string, endDate: string) {
    return this.request<TimeSheetResponse[]>(
      `/v1/companies/${companyUuid}/time_tracking/time_sheets?start_date=${startDate}&end_date=${endDate}`
    );
  }

  // Legacy method - deprecated but kept for reference
  async createTimeActivities(companyUuid: string, timeActivities: TimeActivityBatch) {
    console.warn('[GUSTO-API] time_activities endpoint is deprecated, use createTimeSheet instead');
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

  /**
   * Get all payrolls for a company
   * By default returns only processed payrolls
   */
  async getPayrolls(companyUuid: string, processingStatuses?: string[]) {
    const params = processingStatuses
      ? `?processing_statuses=${processingStatuses.join(',')}`
      : '';
    return this.request<GustoPayroll[]>(`/v1/companies/${companyUuid}/payrolls${params}`);
  }

  /**
   * Get unprocessed (upcoming) payrolls that can be updated
   */
  async getUnprocessedPayrolls(companyUuid: string) {
    return this.request<GustoPayroll[]>(
      `/v1/companies/${companyUuid}/payrolls?processing_statuses=unprocessed`
    );
  }

  async getPayroll(companyUuid: string, payrollUuid: string) {
    return this.request<GustoPayrollDetailed>(`/v1/companies/${companyUuid}/payrolls/${payrollUuid}`);
  }

  /**
   * Prepare a payroll for updates - returns the current state and version
   * Must be called before updating payroll
   */
  async preparePayroll(companyUuid: string, payrollUuid: string) {
    return this.request<PreparedPayroll>(`/v1/companies/${companyUuid}/payrolls/${payrollUuid}/prepare`, {
      method: 'PUT',
    });
  }

  /**
   * Update a payroll with employee compensations (hours, tips, bonuses, etc.)
   * Requires the version from preparePayroll to handle conflicts
   */
  async updatePayroll(companyUuid: string, payrollUuid: string, updates: PayrollUpdate) {
    return this.request<GustoPayrollDetailed>(`/v1/companies/${companyUuid}/payrolls/${payrollUuid}`, {
      method: 'PUT',
      body: updates as unknown as Record<string, unknown>,
    });
  }

  /**
   * Calculate payroll totals after updates
   */
  async calculatePayroll(companyUuid: string, payrollUuid: string) {
    return this.request<GustoPayrollDetailed>(`/v1/companies/${companyUuid}/payrolls/${payrollUuid}/calculate`, {
      method: 'PUT',
    });
  }

  // ============================================================================
  // Earning Types Methods
  // ============================================================================

  /**
   * Get all earning types for a company (including custom ones)
   */
  async getEarningTypes(companyUuid: string) {
    return this.request<EarningTypesResponse>(`/v1/companies/${companyUuid}/earning_types`);
  }

  /**
   * Create a custom earning type for the company
   */
  async createEarningType(companyUuid: string, name: string) {
    return this.request<EarningType>(`/v1/companies/${companyUuid}/earning_types`, {
      method: 'POST',
      body: { name },
    });
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

/**
 * Connection data from gusto_connections table
 */
export interface GustoConnection {
  id: string;
  restaurant_id: string;
  company_uuid: string;
  access_token: string;  // encrypted
  refresh_token: string; // encrypted
  created_at?: string;
  updated_at?: string;
}

/**
 * Create a Gusto client with automatic token refresh
 * This will refresh the token if it's expired and update the database
 */
export async function createGustoClientWithRefresh(
  connection: GustoConnection,
  config: GustoConfig,
  supabaseClient: { from: (table: string) => unknown }
): Promise<GustoClient> {
  const encryption = await getEncryptionService();

  // First, try with the current access token
  let accessToken = await encryption.decrypt(connection.access_token);

  // Test if token is valid with a simple API call
  const testClient = new GustoClient(accessToken, config.baseUrl);

  try {
    // Quick test - get company info (lightweight call)
    await testClient.getCompany(connection.company_uuid);
    console.log('[GUSTO-CLIENT] Access token is valid');
    return testClient;
  } catch (error) {
    // Check if it's a 401 (unauthorized/expired token)
    if (error instanceof GustoApiError && error.status === 401) {
      console.log('[GUSTO-CLIENT] Access token expired, refreshing...');

      if (!connection.refresh_token) {
        throw new Error('No refresh token available. User needs to re-authenticate with Gusto.');
      }

      // Decrypt refresh token and get new tokens
      const refreshToken = await encryption.decrypt(connection.refresh_token);
      const newTokens = await refreshAccessToken(refreshToken, config);

      // Encrypt new tokens
      const { encryptedAccessToken, encryptedRefreshToken } = await encryptTokens(newTokens);

      // Update database with new tokens
      // Using type assertion since we just need the basic from().update() pattern
      const updateResult = await (supabaseClient.from('gusto_connections') as {
        update: (data: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: Error | null }> }
      })
        .update({
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken || connection.refresh_token,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

      if (updateResult.error) {
        console.error('[GUSTO-CLIENT] Failed to update tokens in database:', updateResult.error);
        // Continue anyway - we have valid tokens in memory
      } else {
        console.log('[GUSTO-CLIENT] Tokens refreshed and saved to database');
      }

      // Return client with new access token
      return new GustoClient(newTokens.access_token, config.baseUrl);
    }

    // Re-throw other errors
    throw error;
  }
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

interface UpdateJobRequest {
  title?: string;
  rate?: string;
  payment_unit?: 'Hour' | 'Year' | 'Paycheck' | 'Month';
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

// ============================================================================
// Time Sheet Types (New API)
// ============================================================================

interface TimeSheetRequest {
  entity_uuid: string; // Employee UUID
  entity_type: 'Employee';
  job_uuid: string;
  time_zone: string; // IANA timezone, e.g., "America/New_York"
  shift_started_at: string; // ISO 8601 UTC timestamp
  shift_ended_at: string; // ISO 8601 UTC timestamp
  entries: TimeSheetEntry[];
}

interface TimeSheetEntry {
  hours_worked: number;
  pay_classification: 'Regular' | 'Overtime' | 'Double Overtime';
}

interface TimeSheetResponse {
  uuid: string;
  entity_uuid: string;
  entity_type: string;
  job_uuid: string;
  shift_started_at: string;
  shift_ended_at: string;
  entries: TimeSheetEntry[];
}

// ============================================================================
// Payroll Types (Extended)
// ============================================================================

interface GustoPayrollDetailed extends GustoPayroll {
  version: string;
  payroll_deadline: string;
  totals?: PayrollTotals;
  employee_compensations: EmployeeCompensation[];
}

interface PreparedPayroll extends GustoPayrollDetailed {
  fixed_compensation_types: FixedCompensationType[];
}

interface PayrollTotals {
  company_debit: string;
  net_pay: string;
  tax_debit: string;
  gross_pay: string;
  reimbursements: string;
  employer_taxes: string;
  employee_taxes: string;
  benefits: string;
}

interface EmployeeCompensation {
  employee_uuid: string;
  gross_pay?: string;
  net_pay?: string;
  payment_method?: string;
  fixed_compensations: FixedCompensation[];
  hourly_compensations: HourlyCompensation[];
  paid_time_off?: PaidTimeOff[];
}

interface FixedCompensation {
  name: string;
  amount: string;
  job_uuid: string;
}

interface HourlyCompensation {
  name: string;
  hours: string;
  job_uuid: string;
  compensation_multiplier: number;
}

interface PaidTimeOff {
  name: string;
  hours: string;
}

interface FixedCompensationType {
  name: string;
}

interface PayrollUpdate {
  version: string;
  employee_compensations: EmployeeCompensationUpdate[];
}

interface EmployeeCompensationUpdate {
  employee_uuid: string;
  fixed_compensations?: FixedCompensation[];
  hourly_compensations?: HourlyCompensation[];
  paid_time_off?: PaidTimeOff[];
}

// ============================================================================
// Earning Types
// ============================================================================

interface EarningTypesResponse {
  default: EarningType[];
  custom: EarningType[];
}

interface EarningType {
  uuid: string;
  name: string;
  is_active: boolean;
}
