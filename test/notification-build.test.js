import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyState } from '../domain.js';
import { STATE_KEY } from '../store.js';
import { node } from './fixtures.js';
import {
  PACKAGE_FILES,
  TRANSFORMED_RUNTIME_FILES,
  buildNotificationTest,
  replaceExactlyOnce,
  transformNotificationTestSources
} from '../scripts/notification-test.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = path.join(root, 'dist', 'notification-test', `fixture-${process.pid}`);
const runnerRoot = path.join(root, 'dist', 'notification-test', `runner-${process.pid}`);
const TEST_WEEK = 30000;
const LATER_DELAY_LITERAL = 'export const LATER_DELAY = 14 * 24 * 60 * 60 * 1000;';
const REFERENCE_DELAY_LITERAL = 'export const REFERENCE_DELAY = 365 * 24 * 60 * 60 * 1000;';

const copy = value => structuredClone(value);
const textFiles = PACKAGE_FILES.filter(file => !file.endsWith('.png'));
const textSources = Object.fromEntries(textFiles.map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
const transformedSources = transformNotificationTestSources(textSources);

rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(runnerRoot, { recursive: true, force: true });
mkdirSync(runnerRoot, { recursive: true });
for (const relativePath of ['domain.js', 'store.js']) {
  const target = path.join(runnerRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, textSources[relativePath], 'utf8');
}
writeFileSync(path.join(runnerRoot, 'reminders.js'), transformedSources['reminders.js'], 'utf8');
const transformedReminders = await import(`${pathToFileURL(path.join(runnerRoot, 'reminders.js')).href}?pid=${process.pid}`);

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(runnerRoot, { recursive: true, force: true });
});

function relativeFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? relativeFiles(target, relative) : [relative];
  });
}

async function reminderHarness({ at = 0, granted = true, tree = [node()], reminder, lifecycle = emptyState(), visible = false } = {}) {
  const data = { [STATE_KEY]: copy(lifecycle) };
  if (reminder !== undefined) data[transformedReminders.REMINDER_KEY] = copy(reminder);
  let clock = at;
  let allowed = granted;
  let isVisible = visible;
  let alarm;
  const active = {};
  const log = [];
  const api = {
    now: () => clock,
    random: () => 0,
    storage: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter(key => Object.hasOwn(data, key)).map(key => [key, copy(data[key])])),
      set: async values => {
        log.push(['save', copy(values)]);
        assert.deepEqual(Object.keys(values), [transformedReminders.REMINDER_KEY], 'worker must never write lifecycle data');
        Object.assign(data, copy(values));
      }
    },
    bookmarks: {
      getTree: async () => copy(tree),
      get: async id => copy(tree.filter(item => item.id === id))
    },
    permissions: { contains: async () => allowed },
    notifications: {
      getPermissionLevel: async () => allowed ? 'granted' : 'denied',
      getAll: async () => copy(active),
      clear: async id => { log.push(['clear', id]); delete active[id]; },
      create: async (id, options) => {
        log.push(['create', id, copy(options)]);
        active[id] = copy(options);
        return id;
      }
    },
    alarms: {
      get: async name => {
        assert.equal(name, transformedReminders.ALARM_NAME);
        return alarm ? copy(alarm) : undefined;
      },
      create: async (name, options) => {
        assert.equal(name, transformedReminders.ALARM_NAME);
        log.push(['alarm', options.when]);
        alarm = { name, scheduledTime: options.when };
      },
      clear: async name => {
        assert.equal(name, transformedReminders.ALARM_NAME);
        log.push(['alarm-clear', name]);
        alarm = undefined;
      }
    },
    action: {
      setBadgeText: async options => { log.push(['badge', options.text]); },
      setTitle: async () => {}
    },
    isReviewVisible: async () => isVisible
  };
  const controller = transformedReminders.createReminders(api);
  return {
    active,
    data,
    log,
    controller,
    get alarm() { return alarm; },
    advance(to) { clock = to; },
    attempts() { return log.filter(row => row[0] === 'create'); },
    permission(value) { allowed = value; },
    visible(value) { isVisible = value; }
  };
}

test('exact-anchor transforms fail closed on missing and duplicate matches', () => {
  assert.throws(() => replaceExactlyOnce('alpha', 'beta', 'gamma', 'missing check'), /not found exactly as expected/);
  assert.throws(() => replaceExactlyOnce('alpha alpha', 'alpha', 'gamma', 'duplicate check'), /appeared more than once/);
});

test('notification-test transforms are non-mutating and preserve untouched production files', () => {
  const original = copy(textSources);
  const transformed = transformNotificationTestSources(textSources);
  assert.deepEqual(textSources, original);
  for (const relativePath of textFiles.filter(file => !TRANSFORMED_RUNTIME_FILES.includes(file))) {
    assert.equal(transformed[relativePath], textSources[relativePath], `${relativePath} should stay byte-for-byte unchanged`);
  }
  for (const relativePath of TRANSFORMED_RUNTIME_FILES) assert.notEqual(transformed[relativePath], textSources[relativePath]);

  const productionManifest = JSON.parse(textSources['manifest.json']);
  assert.equal(productionManifest.minimum_chrome_version, '114');
  assert.deepEqual([...(productionManifest.permissions ?? [])].sort(), ['alarms', 'bookmarks', 'storage']);
  assert.deepEqual([...(productionManifest.optional_permissions ?? [])].sort(), ['notifications']);
  assert.match(textSources['domain.js'], /export const LATER_DELAY = 14 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(textSources['domain.js'], /export const REFERENCE_DELAY = 365 \* 24 \* 60 \* 60 \* 1000;/);

  const manifest = JSON.parse(transformed['manifest.json']);
  assert.equal(manifest.name, 'Backburner Notification Test — NOT FOR PUBLICATION');
  assert.equal(manifest.version_name, `${productionManifest.version}-notification-test`);
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.deepEqual([...(manifest.permissions ?? [])].sort(), ['alarms', 'bookmarks', 'storage']);
  assert.deepEqual([...(manifest.optional_permissions ?? [])].sort(), ['notifications']);
  assert.match(transformed['review.html'], /notification-test-banner/);
  assert.doesNotMatch(transformed['review.html'], /\sstyle\s*=/i,'test banner must obey the unchanged self-only style CSP');
  assert.match(transformed['review.html'], /TEST BUILD ONLY · NOT FOR PUBLICATION/);
  assert.match(transformed['review.html'], /at most once every 30 seconds, starting after 30 seconds in this test build/);
  assert.match(transformed['review.html'], /at most every 30 elapsed seconds, only when something is eligible, at any local hour in this test build/);
  assert.match(transformed['review.html'], /that item waits at least 30 seconds before another offer/);
  assert.match(transformed['review.html'], /Later still waits 14 days, Keep still waits 365 days, and Stop still has no expiry/);
  assert.doesNotMatch(transformed['review.html'], /at most once per 7 days, starting after one week/);
  assert.doesNotMatch(transformed['review.html'], /between 09:00 and 18:00 local time\. First opportunity is after one week/);
  assert.doesNotMatch(transformed['review.html'], /that item waits at least 14 days before another offer/);
  assert.match(transformed['review.js'], /30-second test-build limit/);
  assert.match(transformed['review.js'], /at most once every 30 seconds, at any hour in this test build/);
  assert.doesNotMatch(transformed['review.js'], /weekly limit/);
  assert.doesNotMatch(transformed['review.js'], /at most once per 7 days, between 09:00 and 18:00/);
  assert.match(transformed['reminders.js'], /export const WEEK = 30000;/);
  assert.match(transformed['reminders.js'], /const RETRY = 30000;\nconst UNANSWERED_COOLDOWN = 30000;/);
  assert.match(transformed['reminders.js'], /export function deliveryWindow\(at\) {\n  return at;\n}/);
  assert.match(transformed['reminders.js'], /offer\.at \+ UNANSWERED_COOLDOWN/);
  assert.match(transformed['reminders.js'], /Backburner TEST ONLY — NOT FOR PUBLICATION/);
});

test('test generation refuses source and production output paths before writing',async()=>{
  const before=readFileSync(path.join(root,'manifest.json'));
  for(const outputRoot of [root,path.join(root,'dist','unpacked'),path.join(root,'dist','notification-test')]) {
    await assert.rejects(buildNotificationTest({sourceRoot:root,outputRoot}),/must be a subdirectory/);
  }
  assert.deepEqual(readFileSync(path.join(root,'manifest.json')),before);
});

test('regenerating a named output file never writes through a hard link to source',async()=>{
  const outputRoot=path.join(fixtureRoot,'linked','unpacked');
  mkdirSync(outputRoot,{recursive:true});
  const source=path.join(root,'manifest.json'),before=readFileSync(source);
  linkSync(source,path.join(outputRoot,'manifest.json'));
  await buildNotificationTest({sourceRoot:root,outputRoot});
  assert.deepEqual(readFileSync(source),before);
  assert.match(readFileSync(path.join(outputRoot,'manifest.json'),'utf8'),/NOT FOR PUBLICATION/);
});

test('notification-test artifact generation is separated, marked, and rejects stale extra files', async () => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  const outputRoot = path.join(fixtureRoot, 'unpacked');
  const result = await buildNotificationTest({ sourceRoot: root, outputRoot });
  assert.equal(result.outputRoot, outputRoot);
  assert.deepEqual(relativeFiles(outputRoot).sort(), [...PACKAGE_FILES].sort());
  assert.match(readFileSync(path.join(outputRoot, 'manifest.json'), 'utf8'), /NOT FOR PUBLICATION/);
  assert.match(readFileSync(path.join(outputRoot, 'review.html'), 'utf8'), /notification-test-banner/);
  assert.match(readFileSync(path.join(outputRoot, 'review.js'), 'utf8'), /30-second test-build limit/);
  const builtDomain = readFileSync(path.join(outputRoot, 'domain.js'), 'utf8');
  assert.equal(builtDomain, textSources['domain.js']);
  assert.ok(builtDomain.includes(LATER_DELAY_LITERAL));
  assert.ok(builtDomain.includes(REFERENCE_DELAY_LITERAL));
  assert.equal(readFileSync(path.join(outputRoot, 'background.js'), 'utf8'), textSources['background.js']);

  writeFileSync(path.join(outputRoot, 'unexpected.txt'), 'stale', 'utf8');
  await assert.rejects(
    buildNotificationTest({ sourceRoot: root, outputRoot }),
    /Unexpected notification-test artifact file: unexpected\.txt/
  );
});

test('transformed scheduler stays off or blocked without permission and never sends', async () => {
  const off = await reminderHarness({ granted: false });
  assert.equal((await off.controller.check()).status, 'off');
  assert.equal(off.attempts().length, 0);
  await assert.rejects(off.controller.setEnabled(true), /Allow notifications before enabling reminders/);

  const blocked = await reminderHarness();
  await blocked.controller.setEnabled(true);
  blocked.permission(false);
  blocked.advance(TEST_WEEK);
  assert.equal((await blocked.controller.check()).status, 'blocked');
  assert.equal(blocked.attempts().length, 0);
});

test('transformed scheduler fires at 30 seconds and repeats one unchanged bookmark after another 30 seconds', async () => {
  const h = await reminderHarness();
  const firstSchedule = await h.controller.setEnabled(true);
  assert.equal(firstSchedule.nextAt, TEST_WEEK);
  h.advance(29999);
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  h.advance(TEST_WEEK);
  const first = await h.controller.check();
  assert.equal(first.pending.id, '1');
  assert.equal(first.nextAt, TEST_WEEK * 2);
  assert.equal(h.attempts().length, 1);
  h.advance(TEST_WEEK * 2 - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  h.advance(TEST_WEEK * 2);
  const second = await h.controller.check();
  assert.equal(second.pending.id, '1');
  assert.equal(h.attempts().length, 2);
  assert.equal(h.alarm.scheduledTime, TEST_WEEK * 3);
});

test('turning the transformed scheduler off clears pending notification state and alarms', async () => {
  const h = await reminderHarness();
  await h.controller.setEnabled(true);
  h.advance(TEST_WEEK);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  const result = await h.controller.setEnabled(false);
  assert.equal(result.status, 'off');
  assert.equal(h.data[transformedReminders.REMINDER_KEY].pending, null);
  assert.equal(h.alarm, undefined);
  assert.ok(h.log.some(row => row[0] === 'clear' && row[1] === transformedReminders.NOTIFICATION_ID));
});

test('test reminders use every hour and defer visible reviews for only the test retry period',async()=>{
  for(const hour of [0,8,18,23]) {
    const at=new Date(2026,0,1,hour).getTime();
    assert.equal(transformedReminders.deliveryWindow(at),at);
  }
  const h=await reminderHarness({visible:true});
  await h.controller.setEnabled(true);
  h.advance(30000);
  assert.equal((await h.controller.check()).nextAt,60000);
  assert.equal(h.attempts().length,0);
  h.visible(false);h.advance(59999);await h.controller.check();
  assert.equal(h.attempts().length,0);
  h.advance(60000);await h.controller.check();
  assert.equal(h.attempts().length,1);
});

test('transformed native notification stays private, click targets the pending bookmark, and lifecycle data stays untouched', async () => {
  const tree = [node('1', { title: 'Private bookmark title', url: 'https://example.com/private-secret' })];
  const h = await reminderHarness({ tree });
  const lifecycle = copy(h.data[STATE_KEY]);
  await h.controller.setEnabled(true);
  h.advance(TEST_WEEK);
  const snapshot = await h.controller.check();
  const [, id, options] = h.attempts()[0];
  assert.equal(id, transformedReminders.NOTIFICATION_ID);
  assert.equal(snapshot.pending.id, '1');
  assert.equal(options.title, 'Backburner TEST ONLY — NOT FOR PUBLICATION');
  assert.doesNotMatch(JSON.stringify(options), /Private bookmark title|private-secret|https:/);
  const clicked = await h.controller.click();
  assert.equal(clicked.pending.id, '1');
  assert.equal(h.data[transformedReminders.REMINDER_KEY].pending.clicked, true);
  assert.deepEqual(h.data[STATE_KEY], lifecycle);
});
