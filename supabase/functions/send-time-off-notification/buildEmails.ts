/**
 * Resolves email recipients for a time-off notification.
 *
 * Type-agnostic: accepts any object with a `.from()` method that returns the
 * expected chain shape. This lets the real Deno Supabase client and mocks
 * from Vitest both satisfy the same interface.
 */

export interface BuildEmailsInput {
  supabase: ApproverQueryClient;
  restaurantId: string;
  employeeEmail?: string | null;
  notifyEmployee: boolean;
  notifyManagers: boolean;
}

export interface BuildEmailsResult {
  emails: string[];
  employeeIncluded: boolean;
  managersFound: number;
  managerLookupError?: string;
}

interface ApproverQueryClient {
  from(table: string): ApproverSelectBuilder;
}

interface ApproverSelectBuilder {
  select(columns: string): ApproverEqBuilder;
}

interface ApproverEqBuilder {
  eq(column: string, value: string): ApproverInBuilder;
}

interface ApproverInBuilder {
  in(
    column: string,
    values: string[]
  ): Promise<{
    data: ManagerRow[] | null;
    error: { message: string } | null;
  }>;
}

interface ManagerRow {
  user_id: string;
  profiles: { email?: string | null } | null;
}

export async function buildEmails(
  input: BuildEmailsInput
): Promise<BuildEmailsResult> {
  const {
    supabase,
    restaurantId,
    employeeEmail,
    notifyEmployee,
    notifyManagers,
  } = input;

  const emails: string[] = [];
  let employeeIncluded = false;
  let managersFound = 0;
  let managerLookupError: string | undefined;

  if (notifyEmployee && employeeEmail) {
    emails.push(employeeEmail);
    employeeIncluded = true;
  }

  if (notifyManagers) {
    const { data: managers, error } = await supabase
      .from('user_restaurants')
      .select('user_id, profiles:user_id(email)')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (error) {
      managerLookupError = error.message;
    } else if (managers) {
      for (const m of managers) {
        const email = m?.profiles?.email;
        if (email) {
          emails.push(email);
          managersFound++;
        }
      }
    }
  }

  return {
    emails: [...new Set(emails)],
    employeeIncluded,
    managersFound,
    managerLookupError,
  };
}
