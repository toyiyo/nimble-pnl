import { describe, it, expect } from 'vitest';
import { isConnectorRole } from '../../supabase/functions/_shared/connectorRoles';

describe('isConnectorRole', () => {
  it.each(['owner', 'manager', 'chef', 'collaborator_accountant'])('accepts %s', (role) => {
    expect(isConnectorRole(role)).toBe(true);
  });

  it.each(['staff', 'kiosk', '', null, undefined, 3])('refuses %s', (role) => {
    expect(isConnectorRole(role)).toBe(false);
  });
});
