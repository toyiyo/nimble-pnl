// Roles that can use the Claude connector (MCP). Shared by the mcp edge
// function and the consent page, so the two cannot disagree.
//
// Staff and kiosk are refused. The in-app assistant is hidden for the same
// roles (AiChatBubble), but canUseTool gives the basic tools, get_kpis
// included, to every role.

export const CONNECTOR_EXCLUDED_ROLES: ReadonlySet<string> = new Set(['staff', 'kiosk']);

export function isConnectorRole(role: unknown): role is string {
  return typeof role === 'string' && role.length > 0 && !CONNECTOR_EXCLUDED_ROLES.has(role);
}
