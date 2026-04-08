import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { matchEmployees } from '@/utils/shiftEmployeeMatching';
import type { Employee } from '@/types/scheduling';
import type { ShiftImportEmployee } from '@/utils/shiftEmployeeMatching';

interface SlingUser {
  sling_user_id: number;
  name: string | null;
  lastname: string | null;
  email: string | null;
  position: string | null;
  is_active: boolean;
}

function getSlingUserFullName(u: SlingUser): string {
  return [u.name, u.lastname].filter(Boolean).join(' ').trim() || u.email || '';
}

export function useSlingEmployeeMapping(restaurantId: string) {
  const [slingUsers, setSlingUsers] = useState<SlingUser[]>([]);
  const [existingEmployees, setExistingEmployees] = useState<Employee[]>([]);
  const [employeeMatches, setEmployeeMatches] = useState<ShiftImportEmployee[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const fetchSlingUsersAndEmployees = useCallback(async () => {
    const [usersResult, employeesResult] = await Promise.all([
      supabase
        .from('sling_users' as any)
        .select('sling_user_id, name, lastname, email, position, is_active')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true),
      supabase
        .from('employees')
        .select('id, name, position, restaurant_id, status, email, phone, hire_date, notes, created_at, updated_at, is_active, compensation_type, hourly_rate')
        .eq('restaurant_id', restaurantId),
    ]);

    if (usersResult.error) {
      throw new Error(`Failed to fetch Sling users: ${usersResult.error.message}`);
    }
    if (employeesResult.error) {
      throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);
    }

    const fetchedUsers = (usersResult.data || []) as unknown as SlingUser[];
    const fetchedEmployees = (employeesResult.data || []) as Employee[];

    setSlingUsers(fetchedUsers);
    setExistingEmployees(fetchedEmployees);

    const csvNames = fetchedUsers.map((u) => ({
      name: getSlingUserFullName(u),
      position: u.position || '',
    }));

    const matches = matchEmployees(csvNames, fetchedEmployees);
    setEmployeeMatches(matches);
  }, [restaurantId]);

  const updateMatch = useCallback(
    (normalizedName: string, employeeId: string | null, action: 'link' | 'create' | 'skip') => {
      setEmployeeMatches((prev) =>
        prev.map((m) => {
          if (m.normalizedName !== normalizedName) return m;
          if (action === 'link' && employeeId) {
            const matchedEmp = existingEmployees.find((e) => e.id === employeeId);
            return {
              ...m,
              matchedEmployeeId: employeeId,
              matchedEmployeeName: matchedEmp?.name || null,
              matchConfidence: 'exact' as const,
              action: 'link',
            };
          }
          return { ...m, matchedEmployeeId: null, matchedEmployeeName: null, action };
        })
      );
    },
    [existingEmployees]
  );

  const createEmployeeAndMap = useCallback(
    async (match: ShiftImportEmployee): Promise<void> => {
      const { data: newEmp, error: createError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restaurantId,
          name: match.csvName,
          position: match.csvPosition || 'Team Member',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 0,
        })
        .select('id, name, position, restaurant_id')
        .single();

      if (createError) {
        throw new Error(`Failed to create employee ${match.csvName}: ${createError.message}`);
      }

      const slingUser = slingUsers.find(
        (u) => getSlingUserFullName(u) === match.csvName
      );

      if (slingUser) {
        const { error: mappingError } = await supabase
          .from('employee_integration_mappings' as any)
          .upsert(
            {
              restaurant_id: restaurantId,
              employee_id: newEmp.id,
              integration_type: 'sling',
              external_user_id: slingUser.sling_user_id.toString(),
              external_user_name: match.csvName,
            },
            { onConflict: 'restaurant_id,integration_type,external_user_id' }
          );
        if (mappingError) {
          throw new Error(`Failed to create integration mapping for ${match.csvName}: ${mappingError.message}`);
        }
      }

      setExistingEmployees((prev) => [...prev, newEmp as unknown as Employee]);
      setEmployeeMatches((prev) =>
        prev.map((m) =>
          m.normalizedName === match.normalizedName
            ? {
                ...m,
                matchedEmployeeId: newEmp.id,
                matchedEmployeeName: newEmp.name,
                matchConfidence: 'exact' as const,
                action: 'link' as const,
              }
            : m
        )
      );
    },
    [restaurantId, slingUsers]
  );

  const createSingle = useCallback(
    async (normalizedName: string): Promise<void> => {
      const match = employeeMatches.find((m) => m.normalizedName === normalizedName);
      if (!match) return;

      setIsCreating(true);
      try {
        await createEmployeeAndMap(match);
      } finally {
        setIsCreating(false);
      }
    },
    [employeeMatches, createEmployeeAndMap]
  );

  const bulkCreateAll = useCallback(async (): Promise<void> => {
    const unmatched = employeeMatches.filter(
      (m) => m.matchConfidence === 'none' && m.action !== 'link'
    );
    if (unmatched.length === 0) return;

    setIsCreating(true);
    try {
      for (const match of unmatched) {
        await createEmployeeAndMap(match);
      }
    } finally {
      setIsCreating(false);
    }
  }, [employeeMatches, createEmployeeAndMap]);

  const confirmMappings = useCallback(async (): Promise<number> => {
    const mappingsToWrite = employeeMatches
      .filter((m): m is typeof m & { matchedEmployeeId: string } =>
        !!m.matchedEmployeeId && m.action === 'link'
      )
      .map((m) => {
        const slingUser = slingUsers.find(
          (u) => getSlingUserFullName(u) === m.csvName
        );
        return {
          restaurant_id: restaurantId,
          employee_id: m.matchedEmployeeId,
          integration_type: 'sling',
          external_user_id: slingUser?.sling_user_id?.toString() || '',
          external_user_name: m.csvName,
        };
      })
      .filter((m) => m.external_user_id);

    if (mappingsToWrite.length > 0) {
      const { error } = await supabase
        .from('employee_integration_mappings' as any)
        .upsert(mappingsToWrite, { onConflict: 'restaurant_id,integration_type,external_user_id' });

      if (error) {
        throw new Error(`Failed to save mappings: ${error.message}`);
      }
    }

    return mappingsToWrite.length;
  }, [employeeMatches, slingUsers, restaurantId]);

  return {
    slingUsers,
    existingEmployees,
    employeeMatches,
    isCreating,
    fetchSlingUsersAndEmployees,
    updateMatch,
    createSingle,
    bulkCreateAll,
    confirmMappings,
  };
}
