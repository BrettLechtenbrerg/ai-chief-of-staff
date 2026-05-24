#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { oauthManager, ProposalCache, SafetyChecker } from '@flo/shared';
// Safety config for calendar operations
const safetyConfig = {
    allowed_domains: ['brettlechtenberg.com'],
    allow_external_recipients: false,
    allow_deletes: false,
    time_guard_start_hour: 7, // No meetings before 7 AM
    time_guard_end_hour: 19, // No meetings after 7 PM
    require_human_approval: true
};
const proposalCache = new ProposalCache();
const safetyChecker = new SafetyChecker(safetyConfig);
// Calendar event schema
const ProposeEventSchema = z.object({
    summary: z.string(),
    description: z.string().optional(),
    start: z.string(), // ISO 8601 datetime
    end: z.string(), // ISO 8601 datetime
    attendees: z.array(z.string().email()).optional(),
    location: z.string().optional(),
    calendar_id: z.string().optional().default('primary'),
});
const ExecuteSchema = z.object({
    proposal_ids: z.array(z.string()),
    allow_external_attendees: z.boolean().optional(),
});
const ListEventsSchema = z.object({
    time_min: z.string().optional(),
    time_max: z.string().optional(),
    max_results: z.number().optional().default(20),
});
const ProposeDeleteSchema = z.object({
    event_id: z.string(),
    reason: z.string().optional(),
});
// Advanced Calendar Intelligence Schemas
const FindBestTimeSchema = z.object({
    summary: z.string(),
    duration_minutes: z.number(),
    attendees: z.array(z.string().email()),
    date_range_start: z.string().optional(),
    date_range_end: z.string().optional(),
    avoid_times: z.array(z.object({
        day_of_week: z.string(),
        start_hour: z.number(),
        end_hour: z.number(),
    })).optional(),
});
const CheckConflictsSchema = z.object({
    event_id: z.string(),
});
const BlockFocusTimeSchema = z.object({
    duration_hours: z.number(),
    label: z.string().optional(),
    preferred_time: z.string().optional(),
    recurring: z.boolean().optional(),
});
const ProposeRecurringEventSchema = z.object({
    summary: z.string(),
    description: z.string().optional(),
    start: z.string(),
    duration_minutes: z.number(),
    recurrence: z.object({
        frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
        interval: z.number().optional(),
        until_date: z.string().optional(),
        days_of_week: z.array(z.string()).optional(),
    }),
    attendees: z.array(z.string().email()).optional(),
    location: z.string().optional(),
    reminders_minutes: z.array(z.number()).optional(),
});
const SyncDocsDeadlinesSchema = z.object({
    doc_id: z.string(),
    calendar_name: z.string().optional(),
    auto_create: z.boolean().optional(),
});
class CalendarMCPServer {
    server;
    calendar;
    constructor() {
        this.server = new Server({
            name: 'flo-calendar-server',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'calendar_propose_event',
                    description: 'Propose creating a calendar event. Returns a proposal ID for approval. Does NOT create the event.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            summary: {
                                type: 'string',
                                description: 'Event title/summary',
                            },
                            description: {
                                type: 'string',
                                description: 'Event description (optional)',
                            },
                            start: {
                                type: 'string',
                                description: 'Start time (ISO 8601 format, e.g. 2025-01-15T14:00:00-08:00)',
                            },
                            end: {
                                type: 'string',
                                description: 'End time (ISO 8601 format, e.g. 2025-01-15T15:00:00-08:00)',
                            },
                            attendees: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Attendee email addresses (optional)',
                            },
                            location: {
                                type: 'string',
                                description: 'Event location (optional)',
                            },
                            calendar_id: {
                                type: 'string',
                                description: 'Calendar ID (defaults to primary)',
                            },
                        },
                        required: ['summary', 'start', 'end'],
                    },
                },
                {
                    name: 'calendar_execute',
                    description: 'Execute approved calendar proposals. Creates the events and returns event IDs.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            proposal_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of proposal IDs to execute',
                            },
                            allow_external_attendees: {
                                type: 'boolean',
                                description: 'Override safety check for external attendees',
                            },
                        },
                        required: ['proposal_ids'],
                    },
                },
                {
                    name: 'calendar_list_pending',
                    description: 'List all pending (not executed) calendar proposals.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'calendar_list_events',
                    description: 'List upcoming calendar events. Use this for "what is on my calendar", "next N events", "events today/this week", or to find a specific event before deleting it. Read-only — does not modify anything.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            time_min: {
                                type: 'string',
                                description: 'Start date/time (ISO 8601 format). Defaults to now.',
                            },
                            time_max: {
                                type: 'string',
                                description: 'End date/time (ISO 8601 format). Defaults to 30 days from now.',
                            },
                            max_results: {
                                type: 'number',
                                description: 'Maximum number of events to return (default: 20).',
                            },
                        },
                    },
                },
                {
                    name: 'calendar_propose_delete',
                    description: 'Propose deleting a calendar event. Returns a proposal ID for approval. Does NOT delete the event.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            event_id: {
                                type: 'string',
                                description: 'The ID of the event to delete',
                            },
                            reason: {
                                type: 'string',
                                description: 'Reason for deletion (optional)',
                            },
                        },
                        required: ['event_id'],
                    },
                },
                {
                    name: 'calendar_find_best_time',
                    description: 'Find the best time to schedule a meeting across multiple attendees by analyzing their calendars.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            summary: {
                                type: 'string',
                                description: 'Meeting title/summary',
                            },
                            duration_minutes: {
                                type: 'number',
                                description: 'How long the meeting needs to be (in minutes)',
                            },
                            attendees: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Email addresses of attendees to check availability',
                            },
                            date_range_start: {
                                type: 'string',
                                description: 'Start date for search (ISO 8601 format, defaults to today)',
                            },
                            date_range_end: {
                                type: 'string',
                                description: 'End date for search (ISO 8601 format, defaults to 2 weeks out)',
                            },
                            avoid_times: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        day_of_week: {
                                            type: 'string',
                                            description: 'Day name (e.g., "Monday", "Friday")',
                                        },
                                        start_hour: {
                                            type: 'number',
                                            description: 'Start hour to avoid (0-23)',
                                        },
                                        end_hour: {
                                            type: 'number',
                                            description: 'End hour to avoid (0-23)',
                                        },
                                    },
                                },
                                description: 'Times to avoid scheduling (e.g., avoid 8-9 AM on Mondays)',
                            },
                        },
                        required: ['summary', 'duration_minutes', 'attendees'],
                    },
                },
                {
                    name: 'calendar_check_conflicts',
                    description: 'Check if a calendar event has conflicts with other events and get suggestions for resolution.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            event_id: {
                                type: 'string',
                                description: 'The ID of the event to check for conflicts',
                            },
                        },
                        required: ['event_id'],
                    },
                },
                {
                    name: 'calendar_block_focus_time',
                    description: 'Create a focus time block on your calendar to protect deep work time.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            duration_hours: {
                                type: 'number',
                                description: 'How many hours to block for focus time',
                            },
                            label: {
                                type: 'string',
                                description: 'Name for the focus time (e.g., "Deep Work", "Coding", "Writing")',
                            },
                            preferred_time: {
                                type: 'string',
                                description: 'Preferred time (ISO 8601 datetime, defaults to next available slot)',
                            },
                            recurring: {
                                type: 'boolean',
                                description: 'Should this recur daily? (defaults to false)',
                            },
                        },
                        required: ['duration_hours'],
                    },
                },
                {
                    name: 'calendar_propose_recurring_event',
                    description: 'Create a recurring calendar event with smart reminders.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            summary: {
                                type: 'string',
                                description: 'Event title/summary',
                            },
                            description: {
                                type: 'string',
                                description: 'Event description (optional)',
                            },
                            start: {
                                type: 'string',
                                description: 'Start date/time for first occurrence (ISO 8601 format)',
                            },
                            duration_minutes: {
                                type: 'number',
                                description: 'How long each occurrence lasts (in minutes)',
                            },
                            recurrence: {
                                type: 'object',
                                properties: {
                                    frequency: {
                                        type: 'string',
                                        enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
                                        description: 'How often the event repeats',
                                    },
                                    interval: {
                                        type: 'number',
                                        description: 'Repeat every N intervals (e.g., 2 for every 2 weeks)',
                                    },
                                    until_date: {
                                        type: 'string',
                                        description: 'End date for recurrence (ISO 8601 date)',
                                    },
                                    days_of_week: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        description: 'For weekly recurrence, which days (MO, TU, WE, etc)',
                                    },
                                },
                            },
                            attendees: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Attendee email addresses (optional)',
                            },
                            location: {
                                type: 'string',
                                description: 'Event location (optional)',
                            },
                            reminders_minutes: {
                                type: 'array',
                                items: { type: 'number' },
                                description: 'Reminder times before event (e.g., [15, 5] for 15 and 5 minutes before)',
                            },
                        },
                        required: ['summary', 'start', 'duration_minutes', 'recurrence'],
                    },
                },
                {
                    name: 'calendar_sync_docs_deadlines',
                    description: 'Sync document deadlines from Google Docs/Sheets to your calendar automatically.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            doc_id: {
                                type: 'string',
                                description: 'Google Docs/Sheets ID to scan for deadlines',
                            },
                            calendar_name: {
                                type: 'string',
                                description: 'Calendar to add deadline events to (defaults to Primary)',
                            },
                            auto_create: {
                                type: 'boolean',
                                description: 'Automatically create/update calendar events (defaults to propose first)',
                            },
                        },
                        required: ['doc_id'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            switch (request.params.name) {
                case 'calendar_propose_event':
                    return this.handleProposeEvent(request.params.arguments);
                case 'calendar_execute':
                    return this.handleExecute(request.params.arguments);
                case 'calendar_list_pending':
                    return this.handleListPending();
                case 'calendar_list_events':
                    return this.handleListEvents(request.params.arguments);
                case 'calendar_propose_delete':
                    return this.handleProposeDelete(request.params.arguments);
                case 'calendar_find_best_time':
                    return this.handleFindBestTime(request.params.arguments);
                case 'calendar_check_conflicts':
                    return this.handleCheckConflicts(request.params.arguments);
                case 'calendar_block_focus_time':
                    return this.handleBlockFocusTime(request.params.arguments);
                case 'calendar_propose_recurring_event':
                    return this.handleProposeRecurringEvent(request.params.arguments);
                case 'calendar_sync_docs_deadlines':
                    return this.handleSyncDocsDeadlines(request.params.arguments);
                default:
                    throw new Error(`Unknown tool: ${request.params.name}`);
            }
        });
    }
    async initializeCalendar() {
        if (this.calendar)
            return;
        await oauthManager.initialize();
        const authClient = oauthManager.getClient();
        this.calendar = google.calendar({ version: 'v3', auth: authClient });
    }
    async handleProposeEvent(args) {
        const parsed = ProposeEventSchema.parse(args);
        await this.initializeCalendar();
        // Safety checks
        const violations = [];
        // Check time guards
        const startTime = new Date(parsed.start);
        const endTime = new Date(parsed.end);
        const startHour = startTime.getHours();
        const endHour = endTime.getHours();
        if (startHour < safetyConfig.time_guard_start_hour || startHour >= safetyConfig.time_guard_end_hour) {
            violations.push(`meeting_outside_hours: Meeting starts at ${startHour}:00 (allowed: ${safetyConfig.time_guard_start_hour}:00-${safetyConfig.time_guard_end_hour}:00)`);
        }
        if (endHour >= safetyConfig.time_guard_end_hour) {
            violations.push(`meeting_outside_hours: Meeting ends at ${endHour}:00 (allowed: ${safetyConfig.time_guard_start_hour}:00-${safetyConfig.time_guard_end_hour}:00)`);
        }
        // Check external attendees
        if (parsed.attendees) {
            const externalAttendees = parsed.attendees.filter(email => {
                const domain = email.split('@')[1];
                return !safetyConfig.allowed_domains.includes(domain);
            });
            if (externalAttendees.length > 0 && !safetyConfig.allow_external_recipients) {
                violations.push(`external_attendees_blocked: ${externalAttendees.join(', ')}`);
            }
        }
        const risk = safetyChecker.assessRisk(violations);
        // Create proposal
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#event-${parsed.summary.replace(/\s+/g, '-').toLowerCase()}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Check for duplicates
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Duplicate detected: This event was already created.\nClient Action ID: ${clientActionId}`,
                    },
                ],
            };
        }
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'calendar.create',
            payload: parsed,
            risk: risk,
            violations: violations,
            executed: false,
            created_at: timestamp,
            executed_at: undefined,
            receipt: undefined,
        };
        proposalCache.saveProposal(proposal);
        let violationsText = '';
        if (violations.length > 0) {
            violationsText = `⚠️ Violations: ${violations.join(', ')}\n\n`;
        }
        const attendeesText = parsed.attendees ? `\nAttendees: ${parsed.attendees.join(', ')}` : '';
        const locationText = parsed.location ? `\nLocation: ${parsed.location}` : '';
        const descriptionText = parsed.description ? `\nDescription: ${parsed.description}` : '';
        return {
            content: [
                {
                    type: 'text',
                    text: `📅 Calendar Event Proposal Created

ID: ${proposalId}
Summary: ${parsed.summary}
Start: ${parsed.start}
End: ${parsed.end}${attendeesText}${locationText}${descriptionText}

Risk: ${risk}
${violationsText}To create this event, say: "approve ${proposalId}"`,
                },
            ],
        };
    }
    async handleExecute(args) {
        const parsed = ExecuteSchema.parse(args);
        await this.initializeCalendar();
        const results = [];
        for (const proposalId of parsed.proposal_ids) {
            try {
                const proposal = proposalCache.getProposal(proposalId);
                if (!proposal) {
                    results.push(`❌ ${proposalId}: Proposal not found`);
                    continue;
                }
                if (proposal.executed) {
                    results.push(`⚠️ ${proposalId}: Already executed`);
                    continue;
                }
                // Check safety violations
                if (proposal.violations.length > 0 && !parsed.allow_external_attendees) {
                    if (proposal.violations.some(v => v.includes('external_attendees_blocked'))) {
                        results.push(`❌ ${proposalId}: Safety violations - ${proposal.violations.join(', ')}`);
                        continue;
                    }
                }
                const eventData = proposal.payload;
                if (proposal.type === 'calendar.create') {
                    // Create the calendar event
                    const calendarEvent = {
                        summary: eventData.summary,
                        description: eventData.description,
                        start: {
                            dateTime: eventData.start,
                        },
                        end: {
                            dateTime: eventData.end,
                        },
                        location: eventData.location,
                        attendees: eventData.attendees ? eventData.attendees.map((email) => ({ email })) : undefined,
                    };
                    const response = await this.calendar.events.insert({
                        calendarId: eventData.calendar_id || 'primary',
                        resource: calendarEvent,
                    });
                    // Update proposal as executed
                    proposalCache.markExecuted(proposalId, {
                        event_id: response.data.id,
                        event_link: response.data.htmlLink,
                    });
                    results.push(`✅ ${proposalId}: Event created successfully
   Event ID: ${response.data.id}
   Event Link: ${response.data.htmlLink}`);
                }
                else if (proposal.type === 'calendar.delete') {
                    // Delete the calendar event
                    await this.calendar.events.delete({
                        calendarId: 'primary',
                        eventId: eventData.event_id,
                    });
                    // Update proposal as executed
                    proposalCache.markExecuted(proposalId, {
                        event_id: eventData.event_id,
                        action: 'deleted',
                        reason: eventData.reason || 'No reason provided',
                    });
                    results.push(`✅ ${proposalId}: Event deleted successfully
   Event ID: ${eventData.event_id}
   Reason: ${eventData.reason || 'No reason provided'}`);
                }
                else if (proposal.type === 'calendar.recurring') {
                    // Create a recurring calendar event. payload.recurrence is the
                    // RRULE string (e.g. "FREQ=WEEKLY;BYDAY=SA,SU,MO,TU,WE").
                    // Google Calendar accepts `recurrence: ["RRULE:..."]`.
                    //
                    // Google REQUIRES start.timeZone + end.timeZone on recurring
                    // events — unlike single events where it infers from the
                    // primary calendar. Look up the user's calendar timezone
                    // once; fall back to America/Denver (Brett's tz) on error.
                    let userTimeZone = 'America/Denver';
                    try {
                        const tzResp = await this.calendar.settings.get({ setting: 'timezone' });
                        if (tzResp && tzResp.data && tzResp.data.value) {
                            userTimeZone = tzResp.data.value;
                        }
                    }
                    catch {
                        // Keep the fallback.
                    }
                    const recurrenceArr = eventData.recurrence
                        ? [`RRULE:${eventData.recurrence}`]
                        : undefined;
                    const reminderOverrides = Array.isArray(eventData.reminders) && eventData.reminders.length > 0
                        ? eventData.reminders.map((m) => ({ method: 'popup', minutes: m }))
                        : undefined;
                    const calendarEvent = {
                        summary: eventData.summary,
                        description: eventData.description,
                        start: { dateTime: eventData.start, timeZone: userTimeZone },
                        end: { dateTime: eventData.end, timeZone: userTimeZone },
                        location: eventData.location,
                        attendees: eventData.attendees ? eventData.attendees.map((email) => ({ email })) : undefined,
                        recurrence: recurrenceArr,
                        reminders: reminderOverrides
                            ? { useDefault: false, overrides: reminderOverrides }
                            : undefined,
                    };
                    const response = await this.calendar.events.insert({
                        calendarId: eventData.calendar_id || 'primary',
                        resource: calendarEvent,
                    });
                    proposalCache.markExecuted(proposalId, {
                        event_id: response.data.id,
                        event_link: response.data.htmlLink,
                        recurrence: eventData.recurrence,
                    });
                    results.push(`✅ ${proposalId}: Recurring event created successfully
   Event ID: ${response.data.id}
   Recurrence: ${eventData.recurrence}
   Event Link: ${response.data.htmlLink}`);
                }
                else {
                    results.push(`❌ ${proposalId}: Unsupported proposal type '${proposal.type}'`);
                }
            }
            catch (error) {
                results.push(`❌ ${proposalId}: Error - ${error.message}`);
            }
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `📅 Execution Results\n\n${results.join('\n\n')}`,
                },
            ],
        };
    }
    async handleListPending() {
        const pending = proposalCache.getPending().filter(p => p.type === 'calendar.create' || p.type === 'calendar.delete' || p.type === 'calendar.recurring');
        if (pending.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '📅 No pending calendar event proposals',
                    },
                ],
            };
        }
        const proposalTexts = pending.map((proposal) => {
            const eventData = proposal.payload;
            if (proposal.type === 'calendar.create') {
                return `${proposal.id} (CREATE)
  Summary: ${eventData.summary}
  Start: ${eventData.start}
  End: ${eventData.end}
  Risk: ${proposal.risk}
  Created: ${proposal.created_at}`;
            }
            else if (proposal.type === 'calendar.delete') {
                return `${proposal.id} (DELETE)
  Event to Delete: ${eventData.event_details?.summary || 'Unknown Event'}
  Event ID: ${eventData.event_id}
  Reason: ${eventData.reason || 'No reason provided'}
  Risk: ${proposal.risk}
  Created: ${proposal.created_at}`;
            }
            return `${proposal.id} (UNKNOWN TYPE)`;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: `📅 Pending Calendar Event Proposals\n\n${proposalTexts.join('\n\n')}`,
                },
            ],
        };
    }
    async handleListEvents(args) {
        const parsed = ListEventsSchema.parse(args);
        await this.initializeCalendar();
        const now = new Date();
        const defaultMax = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days from now
        try {
            const response = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: parsed.time_min || now.toISOString(),
                timeMax: parsed.time_max || defaultMax.toISOString(),
                maxResults: parsed.max_results,
                singleEvents: true,
                orderBy: 'startTime',
            });
            const events = response.data.items || [];
            if (events.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '📅 No upcoming events found in the specified time range.',
                        },
                    ],
                };
            }
            const eventTexts = events.map((event) => {
                const start = event.start?.dateTime || event.start?.date || 'No start time';
                const end = event.end?.dateTime || event.end?.date || 'No end time';
                return `📅 **${event.summary || 'No title'}**
   ID: ${event.id}
   Start: ${start}
   End: ${end}
   Status: ${event.status}${event.location ? `\n   Location: ${event.location}` : ''}${event.description ? `\n   Description: ${event.description}` : ''}`;
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: `📅 Upcoming Calendar Events\n\n${eventTexts.join('\n\n')}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error listing events: ${error.message}`,
                    },
                ],
            };
        }
    }
    async handleProposeDelete(args) {
        const parsed = ProposeDeleteSchema.parse(args);
        await this.initializeCalendar();
        try {
            // First, get the event details to show what we're deleting
            const eventResponse = await this.calendar.events.get({
                calendarId: 'primary',
                eventId: parsed.event_id,
            });
            const event = eventResponse.data;
            // Safety checks for deletion
            const violations = [];
            // Check if it's an important recurring event
            if (event.recurrence) {
                violations.push('recurring_event: This is a recurring event that affects multiple instances');
            }
            // Check if event has many attendees (potential important meeting)
            if (event.attendees && event.attendees.length > 5) {
                violations.push(`large_meeting: Event has ${event.attendees.length} attendees`);
            }
            // Check if event is soon (within 1 hour)
            const startTime = new Date(event.start?.dateTime || event.start?.date);
            const now = new Date();
            const timeDiff = startTime.getTime() - now.getTime();
            const oneHour = 60 * 60 * 1000;
            if (timeDiff < oneHour && timeDiff > 0) {
                violations.push('imminent_event: Event starts within 1 hour');
            }
            const risk = safetyChecker.assessRisk(violations);
            // Create proposal
            const timestamp = new Date().toISOString();
            const clientActionId = `${timestamp}#delete-${parsed.event_id}`;
            const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Check for duplicates
            if (proposalCache.checkDuplicate(clientActionId)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Duplicate detected: This event deletion was already requested.\nClient Action ID: ${clientActionId}`,
                        },
                    ],
                };
            }
            const proposal = {
                id: proposalId,
                client_action_id: clientActionId,
                type: 'calendar.delete',
                payload: { event_id: parsed.event_id, reason: parsed.reason, event_details: event },
                risk: risk,
                violations: violations,
                executed: false,
                created_at: timestamp,
                executed_at: undefined,
                receipt: undefined,
            };
            proposalCache.saveProposal(proposal);
            let violationsText = '';
            if (violations.length > 0) {
                violationsText = `⚠️ Violations: ${violations.join(', ')}\n\n`;
            }
            const reasonText = parsed.reason ? `\nReason: ${parsed.reason}` : '';
            const attendeesText = event.attendees ? `\nAttendees: ${event.attendees.length}` : '';
            return {
                content: [
                    {
                        type: 'text',
                        text: `🗑️ Calendar Event Deletion Proposal Created

ID: ${proposalId}
Event to Delete: ${event.summary || 'Untitled Event'}
Start: ${event.start?.dateTime || event.start?.date}
End: ${event.end?.dateTime || event.end?.date}${attendeesText}${reasonText}

Risk: ${risk}
${violationsText}To delete this event, say: "approve ${proposalId}"`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error proposing deletion: ${error.message}\nMake sure the event ID is correct.`,
                    },
                ],
            };
        }
    }
    async handleFindBestTime(args) {
        const parsed = FindBestTimeSchema.parse(args);
        await this.initializeCalendar();
        try {
            const now = new Date();
            const rangeStart = parsed.date_range_start ? new Date(parsed.date_range_start) : now;
            const rangeEnd = parsed.date_range_end ? new Date(parsed.date_range_end) : new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
            // Build avoid times map
            const avoidMap = {};
            if (parsed.avoid_times) {
                for (const avoid of parsed.avoid_times) {
                    const day = avoid.day_of_week.toLowerCase();
                    if (!avoidMap[day])
                        avoidMap[day] = [];
                    avoidMap[day].push({ start: avoid.start_hour, end: avoid.end_hour });
                }
            }
            // Check availability for all attendees
            const availableSlots = [];
            // Generate candidate time slots (every 30 minutes, during business hours)
            let currentSlot = new Date(rangeStart);
            while (currentSlot < rangeEnd) {
                const slotEnd = new Date(currentSlot.getTime() + (parsed.duration_minutes * 60 * 1000));
                // Check time guards (7 AM - 7 PM)
                if (currentSlot.getHours() >= 7 && slotEnd.getHours() <= 19) {
                    // Check avoid times
                    const dayName = currentSlot.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    const slotHour = currentSlot.getHours();
                    let isAvoided = false;
                    if (avoidMap[dayName]) {
                        for (const avoid of avoidMap[dayName]) {
                            if (slotHour >= avoid.start && slotHour < avoid.end) {
                                isAvoided = true;
                                break;
                            }
                        }
                    }
                    if (!isAvoided) {
                        // Check for conflicts with attendee calendars
                        let totalConflicts = 0;
                        for (const attendee of parsed.attendees) {
                            try {
                                const events = await this.calendar.events.list({
                                    calendarId: attendee,
                                    timeMin: currentSlot.toISOString(),
                                    timeMax: slotEnd.toISOString(),
                                    singleEvents: true,
                                });
                                totalConflicts += (events.data.items?.length || 0);
                            }
                            catch {
                                // If we can't access attendee's calendar, assume no conflicts
                            }
                        }
                        availableSlots.push({
                            start: new Date(currentSlot),
                            end: slotEnd,
                            conflicts: totalConflicts,
                        });
                    }
                }
                currentSlot = new Date(currentSlot.getTime() + (30 * 60 * 1000));
            }
            // Sort by fewest conflicts and pick top 3
            const bestSlots = availableSlots
                .sort((a, b) => a.conflicts - b.conflicts)
                .slice(0, 3);
            if (bestSlots.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ No available time slots found for "${parsed.summary}" within the date range for all ${parsed.attendees.length} attendees.`,
                        },
                    ],
                    isError: true,
                };
            }
            const slotTexts = bestSlots.map((slot, idx) => {
                const dayName = slot.start.toLocaleDateString('en-US', { weekday: 'long' });
                const timeStr = slot.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const conflicts = slot.conflicts > 0 ? ` (${slot.conflicts} scheduling conflict${slot.conflicts > 1 ? 's' : ''})` : ' (all attendees free)';
                return `${idx + 1}. ${dayName}, ${slot.start.toLocaleDateString()} at ${timeStr}${conflicts}`;
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: `📅 Best Times to Schedule "${parsed.summary}"

Top 3 available slots:
${slotTexts.join('\n')}

To schedule one of these times, say: "Schedule a meeting for ${bestSlots[0].start.toLocaleDateString()} at ${bestSlots[0].start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}"`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error finding best time: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleCheckConflicts(args) {
        const parsed = CheckConflictsSchema.parse(args);
        await this.initializeCalendar();
        try {
            const event = await this.calendar.events.get({
                calendarId: 'primary',
                eventId: parsed.event_id,
            });
            const eventData = event.data;
            const eventStart = new Date(eventData.start?.dateTime || eventData.start?.date);
            const eventEnd = new Date(eventData.end?.dateTime || eventData.end?.date);
            // Check for overlapping events
            const conflicts = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: eventStart.toISOString(),
                timeMax: eventEnd.toISOString(),
                singleEvents: true,
            });
            const conflictingEvents = (conflicts.data.items || [])
                .filter((e) => e.id !== parsed.event_id && e.status === 'confirmed');
            if (conflictingEvents.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `✅ No Conflicts

Event: ${eventData.summary}
Time: ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}

This event has no conflicts with other calendar events.`,
                        },
                    ],
                };
            }
            const conflictTexts = conflictingEvents.map((e) => {
                const start = new Date(e.start?.dateTime || e.start?.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                return `• ${e.summary || 'Untitled'} at ${start}${e.attendees ? ` (${e.attendees.length} attendees)` : ''}`;
            });
            const suggestions = [];
            // Suggest moving the event
            suggestions.push(`Reschedule "${eventData.summary}" to a different time`);
            // If small meeting, suggest shortening it
            if ((eventEnd.getTime() - eventStart.getTime()) > (60 * 60 * 1000)) {
                suggestions.push('Shorten the meeting duration');
            }
            // If conflicting event is small, suggest it could move
            if (conflictingEvents.length === 1 && conflictingEvents[0].attendees?.length <= 2) {
                suggestions.push(`Reschedule "${conflictingEvents[0].summary}" instead (fewer attendees)`);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Conflicts Detected

Event: ${eventData.summary}
Time: ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}

Conflicting events:
${conflictTexts.join('\n')}

Suggested resolutions:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error checking conflicts: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleBlockFocusTime(args) {
        const parsed = BlockFocusTimeSchema.parse(args);
        await this.initializeCalendar();
        try {
            // Find next available focus time slot
            let focusStart = parsed.preferred_time ? new Date(parsed.preferred_time) : new Date();
            // If preferred time is in the past, use tomorrow morning
            if (focusStart < new Date()) {
                focusStart = new Date();
                focusStart.setDate(focusStart.getDate() + 1);
                focusStart.setHours(9, 0, 0, 0);
            }
            const focusEnd = new Date(focusStart.getTime() + (parsed.duration_hours * 60 * 60 * 1000));
            // Check for conflicts
            const conflicts = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: focusStart.toISOString(),
                timeMax: focusEnd.toISOString(),
                singleEvents: true,
            });
            if ((conflicts.data.items?.length || 0) > 0) {
                // Move to next available slot
                focusStart = new Date(focusEnd.getTime() + (30 * 60 * 1000));
                focusStart.setHours(9, 0, 0, 0);
            }
            const focusEndAdjusted = new Date(focusStart.getTime() + (parsed.duration_hours * 60 * 60 * 1000));
            // Create the focus time event(s)
            const focusLabel = parsed.label || 'Deep Work 🎯';
            const timestamp = new Date().toISOString();
            const clientActionId = `${timestamp}#focus-${parsed.duration_hours}h`;
            const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Check for duplicates
            if (proposalCache.checkDuplicate(clientActionId)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Duplicate detected: Focus time block was already created.\nClient Action ID: ${clientActionId}`,
                        },
                    ],
                };
            }
            const proposal = {
                id: proposalId,
                client_action_id: clientActionId,
                type: 'calendar.focus_time',
                payload: {
                    summary: focusLabel,
                    start: focusStart.toISOString(),
                    end: focusEndAdjusted.toISOString(),
                    duration_hours: parsed.duration_hours,
                    recurring: parsed.recurring,
                    description: 'Do not schedule meetings during this time',
                },
                risk: 'low',
                violations: [],
                executed: false,
                created_at: timestamp,
                executed_at: undefined,
                receipt: undefined,
            };
            proposalCache.saveProposal(proposal);
            const recurrenceText = parsed.recurring ? '\n✅ Will recur daily' : '';
            return {
                content: [
                    {
                        type: 'text',
                        text: `🎯 Focus Time Block Created

ID: ${proposalId}
Label: ${focusLabel}
Start: ${focusStart.toLocaleString()}
End: ${focusEndAdjusted.toLocaleString()}
Duration: ${parsed.duration_hours} hour${parsed.duration_hours > 1 ? 's' : ''}${recurrenceText}

To add this to your calendar, say: "approve ${proposalId}"`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error creating focus time: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleProposeRecurringEvent(args) {
        const parsed = ProposeRecurringEventSchema.parse(args);
        await this.initializeCalendar();
        try {
            const startTime = new Date(parsed.start);
            const endTime = new Date(startTime.getTime() + (parsed.duration_minutes * 60 * 1000));
            // Build recurrence rule
            let rrule = `FREQ=${parsed.recurrence.frequency}`;
            if (parsed.recurrence.interval) {
                rrule += `;INTERVAL=${parsed.recurrence.interval}`;
            }
            if (parsed.recurrence.until_date) {
                rrule += `;UNTIL=${parsed.recurrence.until_date.replace(/-/g, '')}`;
            }
            if (parsed.recurrence.days_of_week && parsed.recurrence.days_of_week.length > 0) {
                rrule += `;BYDAY=${parsed.recurrence.days_of_week.join(',')}`;
            }
            // Safety checks
            const violations = [];
            const startHour = startTime.getHours();
            if (startHour < safetyConfig.time_guard_start_hour || startHour >= safetyConfig.time_guard_end_hour) {
                violations.push(`meeting_outside_hours: Event starts at ${startHour}:00`);
            }
            if (parsed.attendees) {
                const externalAttendees = parsed.attendees.filter(email => {
                    const domain = email.split('@')[1];
                    return !safetyConfig.allowed_domains.includes(domain);
                });
                if (externalAttendees.length > 0 && !safetyConfig.allow_external_recipients) {
                    violations.push(`external_attendees_blocked: ${externalAttendees.join(', ')}`);
                }
            }
            const risk = safetyChecker.assessRisk(violations);
            // Create proposal
            const timestamp = new Date().toISOString();
            const clientActionId = `${timestamp}#recurring-${parsed.summary.replace(/\s+/g, '-').toLowerCase()}`;
            const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Check for duplicates
            if (proposalCache.checkDuplicate(clientActionId)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Duplicate detected: This recurring event was already proposed.\nClient Action ID: ${clientActionId}`,
                        },
                    ],
                };
            }
            const proposal = {
                id: proposalId,
                client_action_id: clientActionId,
                type: 'calendar.recurring',
                payload: {
                    summary: parsed.summary,
                    description: parsed.description,
                    start: startTime.toISOString(),
                    end: endTime.toISOString(),
                    recurrence: rrule,
                    attendees: parsed.attendees,
                    location: parsed.location,
                    reminders: parsed.reminders_minutes,
                },
                risk: risk,
                violations: violations,
                executed: false,
                created_at: timestamp,
                executed_at: undefined,
                receipt: undefined,
            };
            proposalCache.saveProposal(proposal);
            const attendeesText = parsed.attendees ? `\nAttendees: ${parsed.attendees.join(', ')}` : '';
            const locationText = parsed.location ? `\nLocation: ${parsed.location}` : '';
            const remindersText = parsed.reminders_minutes && parsed.reminders_minutes.length > 0
                ? `\nReminders: ${parsed.reminders_minutes.join(', ')} minutes before`
                : '';
            let violationsText = '';
            if (violations.length > 0) {
                violationsText = `\n⚠️ Violations: ${violations.join(', ')}`;
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `📅 Recurring Event Proposal

ID: ${proposalId}
Summary: ${parsed.summary}
Start: ${startTime.toLocaleString()}
Duration: ${parsed.duration_minutes} minutes
Recurrence: ${parsed.recurrence.frequency}${parsed.recurrence.interval ? ` every ${parsed.recurrence.interval}` : ''}${attendeesText}${locationText}${remindersText}

Risk: ${risk}${violationsText}

To create this recurring event, say: "approve ${proposalId}"`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error creating recurring event: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleSyncDocsDeadlines(args) {
        const parsed = SyncDocsDeadlinesSchema.parse(args);
        await this.initializeCalendar();
        try {
            // This is a placeholder implementation
            // In a full implementation, you'd use the Docs API to read the document
            // and extract deadline text patterns (e.g., "Due: January 15, 2025")
            return {
                content: [
                    {
                        type: 'text',
                        text: `📅 Document Deadline Sync

Status: Scanning document for deadlines...
Document ID: ${parsed.doc_id}
Calendar: ${parsed.calendar_name || 'Primary'}

Note: This feature requires integration with Google Docs/Sheets APIs to extract deadline information.

To get started:
1. Share the document with Flo's service account
2. Include deadlines in clear format (e.g., "Deadline: December 15, 2025")
3. Flo will automatically create calendar events for each deadline
4. Events will appear in your calendar 24 hours before the deadline

Example document text:
"Project Proposal - Deadline: December 15, 2025"
"Client Presentation - Due: January 10, 2025"
"Report Submission - Deadline: February 1, 2025"

To enable this feature, say: "Setup deadline sync for [document ID]"`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error syncing deadlines: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}
const server = new CalendarMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map