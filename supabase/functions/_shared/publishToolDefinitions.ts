/**
 * Definitions of the publish and notification tools for the AI chat and the
 * MCP connector. The handlers are in mcpPublishTools.ts.
 *
 * Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
 *
 * This module is pure (no Deno imports), so tools-registry.ts can include it.
 */
import type { ToolDefinition } from './tools-registry.ts';

/** Owner and manager only (canUseTool). */
export const PUBLISH_TOOL_NAMES = ['publish_week', 'get_week_change_log', 'get_pending_notifications'] as const;

/** The tools of this set that change data (WRITE_TOOLS, WRITE_TOOL_NAMES). */
export const PUBLISH_WRITE_TOOL_NAMES = ['publish_week'] as const;

const WEEK_START = {
  type: 'string',
  format: 'date',
  description: 'First day of the week to act on (YYYY-MM-DD), in the restaurant time zone. The week is 7 days.',
};

export const PUBLISH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'publish_week',
    description:
      'Publish the schedule of one week, the same as the Publish button on the Scheduling page. ' +
      'With preview:true, it changes nothing and lists each employee who gets a notification and the shifts in it. ' +
      'With confirmed:true, it publishes and notifies only the employees with a change that has no notification yet. ' +
      'A second publish with no change sends nothing.',
    parameters: {
      type: 'object',
      properties: {
        week_start: WEEK_START,
        notify: {
          type: 'boolean',
          description: 'Send notifications (default: true). With false, the changes stay in get_pending_notifications.',
          default: true,
        },
        preview: { type: 'boolean', description: 'If true, returns the plan and publishes nothing.', default: false },
        confirmed: { type: 'boolean', description: 'If true, publishes the week.', default: false },
      },
      required: ['week_start'],
    },
  },
  {
    name: 'get_week_change_log',
    description:
      'Every change to the shifts of one week: what changed, who made it (from the app or from Claude), when, ' +
      'and which employees got a notification about it. Times are local to the restaurant, with a tz field.',
    parameters: {
      type: 'object',
      properties: { week_start: WEEK_START },
      required: ['week_start'],
    },
  },
  {
    name: 'get_pending_notifications',
    description:
      'Changes to published shifts that did not send a notification yet, one row per employee and change, ' +
      'with a state: pending, failed, retrying, in_doubt, or sending. Without week_start, it covers today and the next 8 weeks.',
    parameters: {
      type: 'object',
      properties: {
        week_start: { ...WEEK_START, description: `${WEEK_START.description} Optional.` },
      },
    },
  },
];
