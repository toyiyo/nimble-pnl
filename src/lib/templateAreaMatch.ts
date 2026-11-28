// The area match rule lives in the edge code, so the planner UI and the MCP
// coverage (supabase/functions/_shared/templateShiftMatch.ts) use one copy.
export {
  isAreaCompatible,
  pickAreaPreferredMatch,
  findAreaAwareTemplate,
  type ShiftMatchKey,
  type MatchableTemplate,
} from '../../supabase/functions/_shared/templateAreaMatch.ts';
