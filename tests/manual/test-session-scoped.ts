/**
 * Manual test for session-scoped calendar events, tasks, and cron jobs
 *
 * Run with: npx ts-node tests/manual/test-session-scoped.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Test database path
const testDbPath = path.join(os.tmpdir(), 'pocket-agent-session-test.db');

// Clean up any existing test db
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

console.log('Test database:', testDbPath);
console.log('---');

// Create database and tables
const db = new Database(testDbPath);

// Create sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Insert default session
db.prepare("INSERT OR IGNORE INTO sessions (id, name) VALUES ('default', 'Default')").run();
db.prepare("INSERT OR IGNORE INTO sessions (id, name) VALUES ('work', 'Work')").run();
db.prepare("INSERT OR IGNORE INTO sessions (id, name) VALUES ('personal', 'Personal')").run();

// Create calendar_events table WITH session_id
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    all_day INTEGER DEFAULT 0,
    location TEXT,
    reminder_minutes INTEGER DEFAULT 15,
    reminded INTEGER DEFAULT 0,
    channel TEXT DEFAULT 'desktop',
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create tasks table WITH session_id
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    reminder_minutes INTEGER,
    reminded INTEGER DEFAULT 0,
    channel TEXT DEFAULT 'desktop',
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create cron_jobs table WITH session_id
db.exec(`
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    schedule TEXT,
    prompt TEXT NOT NULL,
    channel TEXT DEFAULT 'desktop',
    enabled INTEGER DEFAULT 1,
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

console.log('✓ Tables created with session_id columns\n');

// Test 1: Insert calendar events for different sessions
console.log('Test 1: Calendar events per session');
console.log('---');

db.prepare(`
  INSERT INTO calendar_events (title, start_time, session_id)
  VALUES (?, datetime('now', '+1 hour'), ?)
`).run('Default Meeting', 'default');

db.prepare(`
  INSERT INTO calendar_events (title, start_time, session_id)
  VALUES (?, datetime('now', '+2 hours'), ?)
`).run('Work Standup', 'work');

db.prepare(`
  INSERT INTO calendar_events (title, start_time, session_id)
  VALUES (?, datetime('now', '+3 hours'), ?)
`).run('Work Review', 'work');

db.prepare(`
  INSERT INTO calendar_events (title, start_time, session_id)
  VALUES (?, datetime('now', '+4 hours'), ?)
`).run('Personal Gym', 'personal');

// Query events per session
const defaultEvents = db.prepare('SELECT * FROM calendar_events WHERE session_id = ?').all('default');
const workEvents = db.prepare('SELECT * FROM calendar_events WHERE session_id = ?').all('work');
const personalEvents = db.prepare('SELECT * FROM calendar_events WHERE session_id = ?').all('personal');

console.log(`  Default session: ${defaultEvents.length} event(s) - ${defaultEvents.map((e: any) => e.title).join(', ')}`);
console.log(`  Work session: ${workEvents.length} event(s) - ${workEvents.map((e: any) => e.title).join(', ')}`);
console.log(`  Personal session: ${personalEvents.length} event(s) - ${personalEvents.map((e: any) => e.title).join(', ')}`);

const test1Pass = defaultEvents.length === 1 && workEvents.length === 2 && personalEvents.length === 1;
console.log(test1Pass ? '  ✓ PASS\n' : '  ✗ FAIL\n');

// Test 2: Insert tasks for different sessions
console.log('Test 2: Tasks per session');
console.log('---');

db.prepare(`
  INSERT INTO tasks (title, priority, session_id)
  VALUES (?, 'medium', ?)
`).run('Default Task', 'default');

db.prepare(`
  INSERT INTO tasks (title, priority, session_id)
  VALUES (?, 'high', ?)
`).run('Work Bug Fix', 'work');

db.prepare(`
  INSERT INTO tasks (title, priority, session_id)
  VALUES (?, 'medium', ?)
`).run('Work Feature', 'work');

db.prepare(`
  INSERT INTO tasks (title, priority, session_id)
  VALUES (?, 'low', ?)
`).run('Work Docs', 'work');

db.prepare(`
  INSERT INTO tasks (title, priority, session_id)
  VALUES (?, 'high', ?)
`).run('Personal Groceries', 'personal');

// Query tasks per session
const defaultTasks = db.prepare('SELECT * FROM tasks WHERE session_id = ?').all('default');
const workTasks = db.prepare('SELECT * FROM tasks WHERE session_id = ?').all('work');
const personalTasks = db.prepare('SELECT * FROM tasks WHERE session_id = ?').all('personal');

console.log(`  Default session: ${defaultTasks.length} task(s) - ${defaultTasks.map((t: any) => t.title).join(', ')}`);
console.log(`  Work session: ${workTasks.length} task(s) - ${workTasks.map((t: any) => t.title).join(', ')}`);
console.log(`  Personal session: ${personalTasks.length} task(s) - ${personalTasks.map((t: any) => t.title).join(', ')}`);

const test2Pass = defaultTasks.length === 1 && workTasks.length === 3 && personalTasks.length === 1;
console.log(test2Pass ? '  ✓ PASS\n' : '  ✗ FAIL\n');

// Test 3: Insert cron jobs for different sessions
console.log('Test 3: Cron jobs per session');
console.log('---');

db.prepare(`
  INSERT INTO cron_jobs (name, schedule, prompt, session_id)
  VALUES (?, '0 9 * * *', 'Morning greeting', ?)
`).run('default_morning', 'default');

db.prepare(`
  INSERT INTO cron_jobs (name, schedule, prompt, session_id)
  VALUES (?, '0 9 * * 1-5', 'Work standup reminder', ?)
`).run('work_standup', 'work');

db.prepare(`
  INSERT INTO cron_jobs (name, schedule, prompt, session_id)
  VALUES (?, '0 17 * * 1-5', 'Work EOD summary', ?)
`).run('work_eod', 'work');

db.prepare(`
  INSERT INTO cron_jobs (name, schedule, prompt, session_id)
  VALUES (?, '0 8 * * 0', 'Sunday planning', ?)
`).run('personal_planning', 'personal');

// Query cron jobs per session
const defaultJobs = db.prepare('SELECT * FROM cron_jobs WHERE session_id = ?').all('default');
const workJobs = db.prepare('SELECT * FROM cron_jobs WHERE session_id = ?').all('work');
const personalJobs = db.prepare('SELECT * FROM cron_jobs WHERE session_id = ?').all('personal');

console.log(`  Default session: ${defaultJobs.length} job(s) - ${defaultJobs.map((j: any) => j.name).join(', ')}`);
console.log(`  Work session: ${workJobs.length} job(s) - ${workJobs.map((j: any) => j.name).join(', ')}`);
console.log(`  Personal session: ${personalJobs.length} job(s) - ${personalJobs.map((j: any) => j.name).join(', ')}`);

const test3Pass = defaultJobs.length === 1 && workJobs.length === 2 && personalJobs.length === 1;
console.log(test3Pass ? '  ✓ PASS\n' : '  ✗ FAIL\n');

// Test 4: Verify reminder query includes session_id
console.log('Test 4: Reminder query with session_id');
console.log('---');

// Add an event that's due for reminder
const now = new Date();
const reminderTime = new Date(now.getTime() + 5 * 60000); // 5 minutes from now
db.prepare(`
  INSERT INTO calendar_events (title, start_time, reminder_minutes, session_id)
  VALUES (?, ?, 15, ?)
`).run('Imminent Work Meeting', reminderTime.toISOString(), 'work');

// Query for due reminders (should include session_id)
const dueReminders = db.prepare(`
  SELECT id, title, session_id FROM calendar_events
  WHERE reminded = 0
    AND datetime(start_time, '-' || reminder_minutes || ' minutes') <= datetime(?)
`).all(now.toISOString()) as Array<{id: number; title: string; session_id: string}>;

console.log(`  Due reminders: ${dueReminders.length}`);
for (const r of dueReminders) {
  console.log(`    - "${r.title}" (session: ${r.session_id})`);
}

const test4Pass = dueReminders.length === 1 && dueReminders[0].session_id === 'work';
console.log(test4Pass ? '  ✓ PASS\n' : '  ✗ FAIL\n');

// Test 5: Migration simulation - add session_id to existing records
console.log('Test 5: Migration simulation');
console.log('---');

// Insert a record without session_id (simulating old data)
db.prepare(`
  INSERT INTO calendar_events (title, start_time)
  VALUES (?, datetime('now', '+5 hours'))
`).run('Legacy Event');

// Check for NULL session_id
const nullSessionEvents = db.prepare('SELECT COUNT(*) as count FROM calendar_events WHERE session_id IS NULL').get() as {count: number};
console.log(`  Events with NULL session_id: ${nullSessionEvents.count}`);

// Migrate to default session
db.prepare("UPDATE calendar_events SET session_id = 'default' WHERE session_id IS NULL").run();

const nullSessionEventsAfter = db.prepare('SELECT COUNT(*) as count FROM calendar_events WHERE session_id IS NULL').get() as {count: number};
console.log(`  Events with NULL session_id after migration: ${nullSessionEventsAfter.count}`);

const test5Pass = nullSessionEvents.count === 1 && nullSessionEventsAfter.count === 0;
console.log(test5Pass ? '  ✓ PASS\n' : '  ✗ FAIL\n');

// Summary
console.log('===');
const allPassed = test1Pass && test2Pass && test3Pass && test4Pass && test5Pass;
console.log(allPassed ? '✓ All tests passed!' : '✗ Some tests failed');

// Cleanup
db.close();
fs.unlinkSync(testDbPath);
console.log('\nTest database cleaned up.');
