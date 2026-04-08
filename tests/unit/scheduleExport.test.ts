import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockText, mockSave, mockAutoTable } = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSave: vi.fn(),
  mockAutoTable: vi.fn(),
}));

vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 792, getHeight: () => 612 } };
    setFontSize = vi.fn();
    setFont = vi.fn();
    setTextColor = vi.fn();
    text = mockText;
    save = mockSave;
    lastAutoTable = { finalY: 500 };
  },
}));

vi.mock("jspdf-autotable", () => ({ default: mockAutoTable }));

import { generateSchedulePDF } from "@/utils/scheduleExport";
import type { Shift, Employee } from "@/types/scheduling";

const makeEmployee = (id: string, name: string, position = "Cook"): Employee =>
  ({
    id,
    name,
    position,
    restaurant_id: "r1",
    status: "active",
    is_active: true,
    compensation_type: "hourly",
    hourly_rate: 1500,
    created_at: "",
    updated_at: "",
  }) as Employee;

const makeShift = (employeeId: string, dayOffset: number): Shift =>
  ({
    id: `s-${employeeId}-${dayOffset}`,
    restaurant_id: "r1",
    employee_id: employeeId,
    start_time: `2026-03-${String(24 + dayOffset).padStart(2, "0")}T14:00:00.000Z`,
    end_time: `2026-03-${String(24 + dayOffset).padStart(2, "0")}T22:00:00.000Z`,
    break_duration: 0,
    position: "Cook",
    status: "scheduled",
    is_published: false,
    locked: false,
    created_at: "",
    updated_at: "",
  }) as Shift;

describe("generateSchedulePDF", () => {
  const employees = [
    makeEmployee("e1", "Ana Garcia"),
    makeEmployee("e2", "Bob Smith"),
    makeEmployee("e3", "Carlos Rivera"),
  ];

  const shifts = [
    makeShift("e1", 0),
    makeShift("e2", 0),
    makeShift("e3", 0),
    makeShift("e1", 1),
    makeShift("e2", 1),
  ];

  const baseOptions = {
    shifts,
    employees,
    weekStart: new Date("2026-03-24"),
    weekEnd: new Date("2026-03-30"),
    restaurantName: "Test Restaurant",
  };

  beforeEach(() => {
    mockAutoTable.mockClear();
    mockText.mockClear();
    mockSave.mockClear();
  });

  it("includes all employees when selectedEmployeeIds is not provided", () => {
    generateSchedulePDF(baseOptions);

    expect(mockAutoTable).toHaveBeenCalledTimes(1);
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body).toHaveLength(3);
  });

  it("filters to only selected employees when selectedEmployeeIds is provided", () => {
    generateSchedulePDF({
      ...baseOptions,
      selectedEmployeeIds: new Set(["e1", "e3"]),
    });

    expect(mockAutoTable).toHaveBeenCalledTimes(1);
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body).toHaveLength(2);
    const names = body.map((row: any[]) => row[0].content);
    expect(names[0]).toContain("Ana Garcia");
    expect(names[1]).toContain("Carlos Rivera");
  });

  it("shows correct staff count in footer when employees are filtered", () => {
    generateSchedulePDF({
      ...baseOptions,
      selectedEmployeeIds: new Set(["e2"]),
    });

    const staffCall = mockText.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("staff")
    );
    expect(staffCall).toBeDefined();
    expect(staffCall![0]).toContain("1 staff");
  });

  it("produces empty table when selectedEmployeeIds is an empty set", () => {
    generateSchedulePDF({
      ...baseOptions,
      selectedEmployeeIds: new Set(),
    });

    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body).toHaveLength(0);
  });
});
