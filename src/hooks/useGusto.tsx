// Gusto Composed Hook
// Combines all Gusto-related hooks for easy access

import { useGustoConnection } from './useGustoConnection';
import { useGustoFlows, GUSTO_FLOW_CONFIGS } from './useGustoFlows';
import { useGustoEmployeeSync } from './useGustoEmployeeSync';
import { GustoFlowType } from '@/types/gusto';

interface CreateCompanyParams {
  companyName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  ein?: string;
  contractorOnly?: boolean;
}

interface UseGustoReturn {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  isCreatingCompany: boolean;
  isDisconnecting: boolean;
  connection: ReturnType<typeof useGustoConnection>['connection'];
  connectionError: Error | null;
  connectionLoading: boolean;

  // Connection actions
  connectGusto: () => Promise<void>;
  createGustoCompany: (params: CreateCompanyParams) => Promise<void>;
  disconnectGusto: (clearEmployeeData?: boolean) => Promise<void>;

  // Flow state
  flowUrl: string | null;
  flowType: GustoFlowType | null;
  flowLoading: boolean;
  flowExpired: boolean;
  flowError: Error | null;

  // Flow actions
  openPayroll: () => Promise<void>;
  openCompanySetup: () => Promise<void>;
  openEmployeeOnboarding: (employeeUuid: string) => Promise<void>;
  openContractorOnboarding: (contractorUuid: string) => Promise<void>;
  openBenefits: () => Promise<void>;
  openTaxes: () => Promise<void>;
  openFlow: (flowType: GustoFlowType, entityUuid?: string, entityType?: string) => Promise<void>;
  clearFlow: () => void;

  // Sync state
  isSyncingEmployees: boolean;
  isSyncingTimePunches: boolean;

  // Sync actions
  syncEmployees: (employeeIds?: string[], selfOnboarding?: boolean) => Promise<unknown>;
  syncTimePunches: (startDate?: string, endDate?: string) => Promise<void>;

  // Flow configurations
  flowConfigs: typeof GUSTO_FLOW_CONFIGS;
}

export const useGusto = (restaurantId: string | null): UseGustoReturn => {
  // Use individual hooks
  const connection = useGustoConnection(restaurantId);
  const flows = useGustoFlows(restaurantId);
  const sync = useGustoEmployeeSync(restaurantId);

  // Convenience methods for common flows
  const openPayroll = async () => {
    await flows.generateFlowUrl('payroll');
  };

  const openCompanySetup = async () => {
    await flows.generateFlowUrl('company_onboarding');
  };

  const openEmployeeOnboarding = async (employeeUuid: string) => {
    await flows.generateFlowUrl('employee_onboarding', employeeUuid, 'Employee');
  };

  const openContractorOnboarding = async (contractorUuid: string) => {
    await flows.generateFlowUrl('contractor_onboarding', contractorUuid, 'Contractor');
  };

  const openBenefits = async () => {
    await flows.generateFlowUrl('benefits');
  };

  const openTaxes = async () => {
    await flows.generateFlowUrl('taxes');
  };

  return {
    // Connection state
    isConnected: connection.isConnected,
    isConnecting: connection.isConnecting,
    isCreatingCompany: connection.isCreatingCompany,
    isDisconnecting: connection.isDisconnecting,
    connection: connection.connection,
    connectionError: connection.error,
    connectionLoading: connection.isLoading,

    // Connection actions
    connectGusto: connection.connectGusto,
    createGustoCompany: connection.createGustoCompany,
    disconnectGusto: connection.disconnectGusto,

    // Flow state
    flowUrl: flows.flowUrl,
    flowType: flows.flowType,
    flowLoading: flows.isLoading,
    flowExpired: flows.isExpired,
    flowError: flows.error,

    // Flow actions
    openPayroll,
    openCompanySetup,
    openEmployeeOnboarding,
    openContractorOnboarding,
    openBenefits,
    openTaxes,
    openFlow: flows.generateFlowUrl,
    clearFlow: flows.clearFlow,

    // Sync state
    isSyncingEmployees: sync.isSyncingEmployees,
    isSyncingTimePunches: sync.isSyncingTimePunches,

    // Sync actions
    syncEmployees: sync.syncEmployees,
    syncTimePunches: sync.syncTimePunches,

    // Flow configurations
    flowConfigs: GUSTO_FLOW_CONFIGS,
  };
};

export default useGusto;
