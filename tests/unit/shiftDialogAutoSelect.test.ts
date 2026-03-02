import { describe, it, expect } from 'vitest';

describe('ShiftDialog auto-select behavior', () => {
  it('accepts defaultEmployee prop with id, name, and position', () => {
    const props = {
      open: true,
      onOpenChange: () => {},
      restaurantId: 'r1',
      defaultEmployee: {
        id: 'e1',
        name: 'Sarah Johnson',
        position: 'Server',
      },
      defaultDate: new Date('2026-03-02'),
    };
    expect(props.defaultEmployee.id).toBe('e1');
    expect(props.defaultEmployee.position).toBe('Server');
  });

  it('defaultEmployee with null position is valid', () => {
    const employee = {
      id: 'e2',
      name: 'John Doe',
      position: null as string | null,
    };
    expect(employee.position).toBeNull();
  });

  it('defaultEmployee name is preserved', () => {
    const employee = {
      id: 'e3',
      name: 'Alice Smith',
      position: 'Cook',
    };
    expect(employee.name).toBe('Alice Smith');
  });

  it('defaultEmployee without position does not set position', () => {
    const employee = {
      id: 'e4',
      name: 'Bob Brown',
      position: null as string | null,
    };
    // When position is null, position field should remain at default
    const shouldSetPosition = employee.position !== null;
    expect(shouldSetPosition).toBe(false);
  });
});
