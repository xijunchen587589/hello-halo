/**
 * @module tools/cron/schema
 * Cron tools description and input schemas.
 * @license MIT
 */

// --- CronCreate ---

export const CRON_CREATE_TOOL_NAME = 'CronCreate';

export const CRON_CREATE_TOOL_DESCRIPTION =
  'Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.\n\n' +
  'Uses standard 5-field cron in the user\'s local timezone: minute hour day-of-month month day-of-week. ' +
  '"0 9 * * *" means 9am local — no timezone conversion needed.\n\n' +
  '## One-shot tasks (recurring: false)\n\n' +
  'For "remind me at X" or "at <time>, do Y" requests — fire once then auto-delete.\n' +
  'Pin minute/hour/day-of-month/month to specific values:\n' +
  '  "remind me at 2:30pm today to check the deploy" → cron: "30 14 <today_dom> <today_month> *", recurring: false\n' +
  '  "tomorrow morning, run the smoke test" → cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false\n\n' +
  '## Recurring jobs (recurring: true, the default)\n\n' +
  'For "every N minutes" / "every hour" / "weekdays at 9am" requests:\n' +
  '  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)\n\n' +
  '## Avoid the :00 and :30 minute marks when the task allows it\n\n' +
  'Every user who asks for "9am" gets `0 9`, and every user who asks for "hourly" gets `0 *` — ' +
  'which means requests from across the planet land on the API at the same instant. When the user\'s ' +
  'request is approximate, pick a minute that is NOT 0 or 30:\n' +
  '  "every morning around 9" → "57 8 * * *" or "3 9 * * *" (not "0 9 * * *")\n' +
  '  "hourly" → "7 * * * *" (not "0 * * * *")\n' +
  '  "in an hour or so, remind me to..." → pick whatever minute you land on, don\'t round\n\n' +
  'Only use minute 0 or 30 when the user names that exact time and clearly means it ' +
  '("at 9:00 sharp", "at half past", coordinating with a meeting). When in doubt, nudge a few minutes ' +
  'early or late — the user will not notice, and the fleet will.\n\n' +
  '## Durability\n\n' +
  'By default (durable: false) the job lives only in this Claude session — nothing is written to disk, ' +
  'and the job is gone when Claude exits. Pass durable: true to write to .claude/scheduled_tasks.json ' +
  'so the job survives restarts. Only use durable: true when the user explicitly asks for the task to persist ' +
  '("keep doing this every day", "set this up permanently"). Most "remind me in 5 minutes" / "check back ' +
  'in an hour" requests should stay session-only.\n\n' +
  '## Runtime behavior\n\n' +
  'Jobs only fire while the REPL is idle (not mid-query). Durable jobs persist to ' +
  '.claude/scheduled_tasks.json and survive session restarts — on next launch they resume automatically. ' +
  'One-shot durable tasks that were missed while the REPL was closed are surfaced for catch-up. ' +
  'Session-only jobs die with the process. The scheduler adds a small deterministic jitter on top of ' +
  'whatever you pick: recurring tasks fire up to 10% of their period late (max 15 min); one-shot tasks ' +
  'landing on :00 or :30 fire up to 90 s early. Picking an off-minute is still the bigger lever.\n\n' +
  'Recurring tasks auto-expire after 7 days — they fire one final time, then are deleted. ' +
  'This bounds session lifetime. Tell the user about the 7-day limit when scheduling recurring jobs.\n\n' +
  'Returns a job ID you can pass to CronDelete.';

export const CRON_CREATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    cron: {
      type: 'string',
      description:
        'Standard 5-field cron expression in local time: "M H DoM Mon DoW" ' +
        '(e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
    },
    prompt: {
      type: 'string',
      description: 'The prompt to enqueue at each fire time.',
    },
    recurring: {
      type: 'boolean',
      description:
        'true (default) = fire on every cron match until deleted or auto-expired after 7 days. ' +
        'false = fire once at the next match, then auto-delete. ' +
        'Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.',
    },
    durable: {
      type: 'boolean',
      description:
        'true = persist to .claude/scheduled_tasks.json and survive restarts. ' +
        'false (default) = in-memory only, dies when this Claude session ends. ' +
        'Use true only when the user asks the task to survive across sessions.',
    },
  },
  required: ['cron', 'prompt'],
} as const;

// --- CronDelete ---

export const CRON_DELETE_TOOL_NAME = 'CronDelete';

export const CRON_DELETE_TOOL_DESCRIPTION =
  'Cancel a cron job previously scheduled with CronCreate. ' +
  'Removes it from .claude/scheduled_tasks.json (durable jobs) or the in-memory session store (session-only jobs).';

export const CRON_DELETE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Job ID returned by CronCreate.',
    },
  },
  required: ['id'],
} as const;

// --- CronList ---

export const CRON_LIST_TOOL_NAME = 'CronList';

export const CRON_LIST_TOOL_DESCRIPTION =
  'List all cron jobs scheduled via CronCreate, both durable (.claude/scheduled_tasks.json) and session-only.';

export const CRON_LIST_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
} as const;
