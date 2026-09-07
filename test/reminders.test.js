import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, LATER_DELAY, REFERENCE_DELAY } from '../domain.js';
import { fingerprintUrl, STATE_KEY } from '../store.js';
import { ALARM_NAME, createReminders, deliveryWindow, emptyReminderState, NOTIFICATION_ID, REMINDER_KEY, WEEK } from '../reminders.js';
import { node } from './fixtures.js';

const HOUR = 3600000;
const local = (day = 1, hour = 10) => new Date(2026, 0, day, hour).getTime();
const copy = value => structuredClone(value);

async function harness({ at = local(), granted = true, tree = [node()], reminder, lifecycle = emptyState() } = {}) {
  const data = { [STATE_KEY]: copy(lifecycle) };
  if (reminder !== undefined) data[REMINDER_KEY] = copy(reminder);
  let clock = at, visible = false, savedAlarm, controller;
  const log = [], active = {};
  const failures = { save: null, create: false, tree: false, permission: false, afterCreate: false };
  const api = {
    now: () => clock,
    storage: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter(key => Object.hasOwn(data, key)).map(key => [key, copy(data[key])])),
      set: async values => {
        log.push(['save', copy(values)]);
        assert.deepEqual(Object.keys(values), [REMINDER_KEY], 'worker must never write lifecycle data');
        if (failures.save?.(values)) throw new Error('Storage unavailable');
        Object.assign(data, copy(values));
      }
    },
    bookmarks: {
      getTree: async () => {
        if (failures.tree) throw new Error('Native tree unavailable');
        return copy(tree);
      },
      get: async id => copy(tree.filter(item => item.id === id))
    },
    permissions: { contains: async () => {
      if (failures.permission) throw new Error('Permission unavailable');
      return granted;
    } },
    notifications: {
      getPermissionLevel: async () => granted ? 'granted' : 'denied',
      getAll: async () => copy(active),
      clear: async id => { log.push(['clear', id]); delete active[id]; },
      create: async (id, options) => {
        log.push(['create', id, copy(options)]);
        assert.equal(data[REMINDER_KEY].pending.delivery, 'reserved', 'reservation must precede native creation');
        assert.equal(data[REMINDER_KEY].lastAttemptAt, clock);
        if (failures.create) throw new Error('Notification rejected');
        active[id] = copy(options);
        if (failures.afterCreate) failures.save = () => true;
        return id;
      }
    },
    alarms: {
      get: async name => { assert.equal(name, ALARM_NAME); return copy(savedAlarm); },
      create: async (name, options) => {
        assert.equal(name, ALARM_NAME);
        log.push(['alarm', options.when]);
        savedAlarm = { name, scheduledTime: options.when };
      },
      clear: async name => { assert.equal(name, ALARM_NAME); savedAlarm = undefined; }
    },
    action: {
      setBadgeText: async options => { log.push(['badge', options.text]); },
      setTitle: async () => {}
    },
    isReviewVisible: async () => visible
  };
  controller = createReminders(api);
  return {
    data, tree, log, api, failures, active,
    get controller() { return controller; },
    get alarm() { return savedAlarm; },
    get at() { return clock; },
    advance: at => { clock = at; },
    visible: value => { visible = value; },
    permission: value => { granted = value; },
    reload: () => { controller = createReminders(api); },
    loseAlarm: () => { savedAlarm = undefined; },
    attempts: () => log.filter(row => row[0] === 'create'),
    writes: () => log.filter(row => row[0] === 'save'),
    async later(id, at) {
      const item = tree.find(item => item.id === id);
      data[STATE_KEY].entries[id] = { fingerprint: await fingerprintUrl(item.url), at, disposition: 'later', deferrals: 1 };
    },
    async enableDue() {
      await controller.setEnabled(true);
      clock += WEEK;
      return controller.check();
    }
  };
}

test('absent state is off, status is read-only, and permission never opts in', async () => {
  for (const granted of [true, false]) {
    const h = await harness({ granted });
    assert.deepEqual(await h.controller.status(), { enabled: false, status: 'off', nextAt: null, pending: null, permission: granted });
    assert.equal((await h.controller.check()).status, 'off');
    assert.equal(h.writes().length, 0);
    assert.equal(h.alarm, undefined);
    assert.equal(h.attempts().length, 0);
    if (!granted) await assert.rejects(h.controller.setEnabled(true), /Allow notifications/);
    assert.equal(h.data[REMINDER_KEY], undefined);
  }
});

test('default-off status works when optional notification APIs are absent', async () => {
  const h = await harness({ granted: false });
  delete h.api.notifications;
  h.reload();
  assert.deepEqual(await h.controller.status(), {
    enabled: false, status: 'off', nextAt: null, pending: null, permission: false
  });
  assert.equal((await h.controller.check()).status, 'off');
  assert.equal(h.writes().length, 0);
  assert.equal(h.attempts().length, 0);
  assert.equal(h.alarm, undefined);
});

test('enable persists a first slot seven elapsed days later and repeated enable does not reset it', async () => {
  const h = await harness();
  const first = await h.controller.setEnabled(true);
  assert.equal(first.nextAt, local() + WEEK);
  assert.equal(first.status, 'scheduled');
  h.advance(local() + HOUR);
  await h.controller.setEnabled(true);
  assert.equal(h.data[REMINDER_KEY].enabledAt, local());
  h.advance(first.nextAt - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  h.advance(first.nextAt);
  assert.equal((await h.controller.check()).status, 'pending');
  assert.equal(h.attempts().length, 1);
});

test('delivery window includes 09:00, excludes 18:00, and moves forward using local dates', async () => {
  assert.equal(deliveryWindow(local(1, 8)), local(1, 9));
  assert.equal(deliveryWindow(local(1, 9)), local(1, 9));
  assert.equal(deliveryWindow(local(1, 17) + HOUR - 1), local(1, 17) + HOUR - 1);
  assert.equal(deliveryWindow(local(1, 18)), local(2, 9));
  const h = await harness({ at: local(1, 18) });
  assert.equal((await h.controller.setEnabled(true)).nextAt, local(9, 9));
  h.advance(local(8, 18));
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  h.advance(local(9, 9));
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
});

test('local-window alignment preserves elapsed weekly caps across DST changes', async () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const start of [new Date(2026, 2, 1, 17, 30).getTime(), new Date(2026, 9, 25, 9).getTime()]) {
      const h = await harness({ at: start });
      const result = await h.controller.setEnabled(true);
      assert.ok(result.nextAt >= start + WEEK);
      const scheduled = new Date(result.nextAt);
      assert.ok(scheduled.getHours() >= 9 && scheduled.getHours() < 18);
      assert.equal(result.nextAt, deliveryWindow(start + WEEK));
      h.advance(start + WEEK - 1);
      await h.controller.check();
      assert.equal(h.attempts().length, 0);
      h.advance(result.nextAt);
      await h.controller.check();
      assert.equal(h.attempts().length, 1);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('Later waits exactly fourteen elapsed days and a new Later decision resets eligibility', async () => {
  const h = await harness();
  await h.later('1', h.at);
  await h.controller.setEnabled(true);
  assert.equal(h.alarm.scheduledTime, local() + LATER_DELAY);
  h.advance(local() + LATER_DELAY - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  h.advance(local() + LATER_DELAY);
  const result = await h.controller.check();
  assert.equal(result.pending.pool, 'later');
  await h.later('1', h.at);
  assert.equal((await h.controller.check()).status, 'stale');
  assert.equal(h.data[REMINDER_KEY].nextAt, local() + 2 * LATER_DELAY);
});

test('serialized double checks reserve and create once with private, quiet notification copy', async () => {
  const h = await harness({ tree: [node('1', { title: 'Private title', url: 'https://example.com/private-bookmark' }), node('2')] });
  await h.controller.setEnabled(true);
  h.advance(local() + WEEK);
  await Promise.all([h.controller.check(), h.controller.check(), h.controller.check()]);
  assert.equal(h.attempts().length, 1);
  const [, id, options] = h.attempts()[0];
  assert.equal(id, NOTIFICATION_ID);
  assert.deepEqual(options, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Backburner',
    message: 'A saved bookmark is ready for another look.', silent: true, requireInteraction: false, priority: 0 });
  assert.doesNotMatch(JSON.stringify(h.data[REMINDER_KEY]), /Private title|https:|private-bookmark/);
  h.advance(local() + 2 * WEEK - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  h.advance(local() + 2 * WEEK);
  await h.controller.check();
  assert.equal(h.attempts().length, 2);
});

test('reservation-save failure prevents send and leaves prior data untouched', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  const before = copy(h.data);
  h.advance(local() + WEEK);
  h.failures.save = values => values[REMINDER_KEY].pending?.delivery === 'reserved';
  await assert.rejects(h.controller.check(), /Storage unavailable/);
  assert.deepEqual(h.data, before);
  assert.equal(h.attempts().length, 0);
  assert.ok(h.log.some(row => row[0] === 'badge' && row[1] === '!'));
  assert.ok(h.alarm.scheduledTime > h.at);
});

test('save failure after successful creation leaves durable reservation and does not replay on reload', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  h.advance(local() + WEEK);
  h.failures.afterCreate = true;
  await assert.rejects(h.controller.check(), /Storage unavailable/);
  assert.equal(h.data[REMINDER_KEY].pending.delivery, 'reserved');
  h.failures.save = null;
  h.failures.afterCreate = false;
  h.reload();
  assert.equal((await h.controller.check()).status, 'uncertain');
  assert.equal(h.attempts().length, 1);
});

test('worker death after reservation but before create consumes slot even with no native notification', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  h.advance(local() + WEEK);
  const original = h.api.storage.set;
  h.api.storage.set = async values => {
    await original(values);
    if (values[REMINDER_KEY].pending?.delivery === 'reserved') throw new Error('Worker stopped');
  };
  await assert.rejects(h.controller.check(), /Worker stopped/);
  assert.equal(h.attempts().length, 0);
  h.api.storage.set = original;
  h.reload();
  assert.equal((await h.controller.check()).status, 'uncertain');
  h.advance(h.at + WEEK - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, local() + WEEK);
});

test('notification rejection records uncertainty and preserves the cap and lifecycle', async () => {
  const h = await harness({ tree: [node('1'), node('2')] });
  const lifecycle = copy(h.data[STATE_KEY]);
  h.failures.create = true;
  assert.equal((await h.enableDue()).status, 'uncertain');
  assert.equal(h.data[REMINDER_KEY].pending.delivery, 'uncertain');
  h.reload();
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  assert.deepEqual(h.data[STATE_KEY], lifecycle);
  assert.ok(h.log.some(row => row[0] === 'badge' && row[1] === '!'));
});

test('malformed reminder and lifecycle snapshots fail closed without overwriting storage', async () => {
  for (const [key, value] of [
    [REMINDER_KEY, null], [REMINDER_KEY, {}], [REMINDER_KEY, { ...emptyReminderState(), version: 9 }],
    [REMINDER_KEY, { ...emptyReminderState(), offers: { 1: { fingerprint: 'bad', at: 0 } } }],
    [STATE_KEY, null], [STATE_KEY, { ...emptyState(), recovery: { corrupt: {} } }]
  ]) {
    const h = await harness();
    h.data[key] = value;
    const before = copy(h.data);
    await assert.rejects(h.controller.check());
    await assert.rejects(h.controller.status());
    await assert.rejects(h.controller.setEnabled(true));
    assert.deepEqual(h.data, before);
    assert.equal(h.writes().length, 0);
    assert.equal(h.attempts().length, 0);
    assert.ok(h.alarm.scheduledTime > h.at);
  }
});

test('revoked and OS-denied permission block sending without disabling or erasing history', async () => {
  for (const revoke of ['optional', 'level']) {
    const h = await harness({ tree: [node('1'), node('2')] });
    await h.enableDue();
    const cap = h.data[REMINDER_KEY].lastAttemptAt;
    if (revoke === 'optional') h.permission(false);
    else h.api.notifications.getPermissionLevel = async () => 'denied';
    h.advance(h.at + WEEK);
    const before = copy(h.data);
    assert.equal((await h.controller.status()).status, 'blocked');
    assert.deepEqual(h.data, before);
    assert.equal((await h.controller.check()).status, 'blocked');
    assert.equal(h.attempts().length, 1);
    assert.equal(h.data[REMINDER_KEY].enabled, true);
    assert.equal(h.data[REMINDER_KEY].lastAttemptAt, cap);
    assert.equal(h.active[NOTIFICATION_ID], undefined);
  }
});

test('visible focused review defers one hour without reservation; background review does not suppress', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  h.advance(local() + WEEK);
  h.visible(true);
  assert.equal((await h.controller.check()).nextAt, h.at + HOUR);
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, null);
  assert.equal(h.attempts().length, 0);
  h.reload();
  h.visible(false);
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  h.advance(h.at + HOUR);
  assert.equal((await h.controller.check()).status, 'pending');
  assert.equal(h.attempts().length, 1);
});

test('reconstructs missing/wrong alarm after restart without resetting deadlines or replacing correct alarm', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  const deadline = h.alarm.scheduledTime;
  const alarms = () => h.log.filter(row => row[0] === 'alarm').length;
  const initialCount = alarms();
  await h.controller.check();
  assert.equal(alarms(), initialCount);
  h.loseAlarm();
  h.reload();
  await h.controller.check();
  assert.equal(h.alarm.scheduledTime, deadline);
  assert.equal(alarms(), initialCount + 1);
  await h.api.alarms.create(ALARM_NAME, { when: deadline + HOUR });
  await h.controller.check();
  assert.equal(h.alarm.scheduledTime, deadline);
  h.advance(deadline + 5 * WEEK);
  await h.controller.check();
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  assert.ok(h.data[REMINDER_KEY].nextAt >= h.at + WEEK);
});

test('weekly pool fairness alternates due Later and other unresolved items', async () => {
  const h = await harness({ tree: [node('1'), node('2'), node('3'), node('4')] });
  await h.later('1', h.at - LATER_DELAY);
  await h.later('2', h.at - LATER_DELAY + 1);
  const offered = [];
  await h.controller.setEnabled(true);
  for (let i = 1; i <= 4; i++) {
    h.advance(local() + i * WEEK);
    offered.push((await h.controller.check()).pending.id);
  }
  assert.deepEqual(offered, ['1', '3', '2', '4']);
});

test('unanswered item cooldown is fourteen days, not the global seven-day cap', async () => {
  const h = await harness();
  const first = await h.enableDue();
  const at = first.pending.attemptAt;
  assert.equal(first.nextAt, at + LATER_DELAY);
  h.advance(at + WEEK);
  await h.controller.check();
  h.advance(at + LATER_DELAY - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  h.advance(at + LATER_DELAY);
  await h.controller.check();
  assert.equal(h.attempts().length, 2);
});

test('other pool prefers never-offered items then oldest offers in existing stable order', async () => {
  const h = await harness({ tree: [node('1'), node('2'), node('3')] });
  const offered = [];
  await h.controller.setEnabled(true);
  for (let i = 1; i <= 5; i++) {
    h.advance(local() + i * WEEK);
    offered.push((await h.controller.check()).pending.id);
  }
  assert.deepEqual(offered, ['1', '2', '3', '1', '2']);
});

test('click journals clicked before handoff and ignores only the offer cooldown', async () => {
  const h = await harness();
  const first = await h.enableDue();
  const clicked = await h.controller.click();
  assert.equal(clicked.status, 'pending');
  assert.equal(clicked.pending.clicked, true);
  assert.equal(h.data[REMINDER_KEY].pending.clicked, true);
  assert.equal(clicked.pending.id, first.pending.id);
  assert.deepEqual(Object.keys(clicked).sort(), ['enabled', 'nextAt', 'pending', 'permission', 'status']);
  assert.equal('delivery' in clicked.pending, false);
  assert.equal(h.attempts().length, 1);
});

test('missing, URL-changed, resolved and newly-snoozed pending targets are stale, never substituted', async () => {
  for (const kind of ['missing', 'changed', 'reference', 'dismissed', 'later']) {
    const h = await harness({ tree: [node('1'), node('2')] });
    const first = await h.enableDue();
    if (kind === 'missing') h.tree.splice(0, 1);
    else if (kind === 'changed') h.tree[0].url = 'https://example.com/changed';
    else {
      await h.later('1', h.at);
      h.data[STATE_KEY].entries['1'].disposition = kind;
    }
    const clicked = await h.controller.click();
    assert.equal(clicked.status, 'stale', kind);
    assert.equal(clicked.pending.id, first.pending.id);
    assert.equal(clicked.pending.stale, true);
    assert.equal(clicked.pending.clicked, true);
    assert.equal(h.active[NOTIFICATION_ID], undefined);
    assert.equal(h.attempts().length, 1);
    assert.equal((await h.controller.check()).status, 'stale');
  }
});

test('all recovery journal statuses exclude candidates and invalidate pending without changing recovery', async () => {
  for (const status of ['prepared', 'removed', 'restoring']) {
    const h = await harness();
    await h.enableDue();
    h.data[STATE_KEY].recovery['12345678-1234-1234-1234-123456789abc'] = {
      id: '1', parentId: '0', index: 0, title: 'Recovery copy', url: h.tree[0].url,
      fingerprint: await fingerprintUrl(h.tree[0].url), at: h.at, status, counted: false,
      ...(status === 'restoring' ? { restoreParent: '0', beforeIds: [] } : {})
    };
    const lifecycle = copy(h.data[STATE_KEY]);
    assert.equal((await h.controller.check()).status, 'stale');
    assert.equal((await h.controller.click()).status, 'stale');
    assert.equal(h.alarm, undefined);
    h.advance(h.at + 3 * WEEK);
    await h.controller.check();
    assert.equal(h.attempts().length, 1);
    assert.deepEqual(h.data[STATE_KEY], lifecycle);
  }
});

test('pending resolution clears the owned notification even without a click', async () => {
  const h = await harness();
  await h.enableDue();
  await h.later('1', h.at);
  h.data[STATE_KEY].entries['1'].disposition = 'reference';
  assert.equal((await h.controller.check()).status, 'stale');
  assert.equal(h.active[NOTIFICATION_ID], undefined);
  assert.equal(h.data[REMINDER_KEY].pending.clicked, false);
});

test('annual references reconstruct their deadline, return in the other pool, and reset on Keep',async()=>{
  const h=await harness({tree:[node('1'),node('2')]});
  await h.later('1',h.at);h.data[STATE_KEY].entries['1'].disposition='reference';
  await h.later('2',h.at);h.data[STATE_KEY].entries['2'].disposition='dismissed';
  const due=h.at+REFERENCE_DELAY,before=copy(h.data[STATE_KEY]);
  await h.controller.setEnabled(true);
  assert.equal(h.alarm.scheduledTime,deliveryWindow(due));
  h.advance(due-1);h.reload();h.loseAlarm();await h.controller.check();
  assert.equal(h.attempts().length,0);
  assert.equal(h.alarm.scheduledTime,deliveryWindow(due));
  assert.deepEqual(h.data[STATE_KEY],before);
  h.advance(due);const offer=await h.controller.check();
  assert.equal(offer.pending.id,'1');assert.equal(offer.pending.pool,'other');
  assert.equal(h.attempts().length,1);
  h.data[STATE_KEY].entries['1'].at=h.at;
  assert.equal((await h.controller.check()).status,'stale');
  assert.equal(h.alarm.scheduledTime,deliveryWindow(due+REFERENCE_DELAY));
  h.data[STATE_KEY].entries['1'].disposition='dismissed';
  h.advance(due+10*REFERENCE_DELAY);await h.controller.check();
  assert.equal(h.attempts().length,1);assert.equal(h.alarm,undefined);
});

test('annual eligibility cannot bypass the weekly notification cap or explicit opt-in',async()=>{
  const h=await harness(),at=h.at,due=at+REFERENCE_DELAY;
  await h.later('1',at);h.data[STATE_KEY].entries['1'].disposition='reference';
  h.advance(due);assert.equal((await h.controller.check()).status,'off');
  assert.equal(h.attempts().length,0);
  h.data[REMINDER_KEY]={...emptyReminderState(),enabled:true,enabledAt:at,lastAttemptAt:due-3*86400000};
  const allowed=due+4*86400000;
  await h.controller.check();assert.equal(h.attempts().length,0);
  assert.equal(h.alarm.scheduledTime,deliveryWindow(allowed));
  h.advance(allowed);await h.controller.check();assert.equal(h.attempts().length,1);
});

test('empty candidates clear alarm and resume on new bookmark event', async () => {
  const h = await harness({ tree: [] });
  assert.equal((await h.controller.setEnabled(true)).status, 'empty');
  assert.equal(h.alarm, undefined);
  h.advance(h.at + WEEK);
  assert.equal((await h.controller.check()).status, 'empty');
  h.tree.push(node());
  assert.equal((await h.controller.check()).status, 'pending');
});

test('native and permission read failures are errors, not empty or destructive defaults', async () => {
  for (const failure of ['tree', 'permission']) {
    const h = await harness();
    await h.controller.setEnabled(true);
    const before = copy(h.data);
    h.failures[failure] = true;
    h.advance(h.at + WEEK);
    await assert.rejects(h.controller.check(), /unavailable/);
    assert.deepEqual(h.data, before);
    assert.equal(h.attempts().length, 0);
    assert.ok(h.log.some(row => row[0] === 'badge' && row[1] === '!'));
  }
});

test('acknowledge rejects old/mismatched identities and preserves attention history on valid acknowledgement', async () => {
  const h = await harness({ tree: [node('1'), node('2')] });
  const first = await h.enableDue();
  for (const target of [null, { ...first.pending, id: '2' }, { ...first.pending, attemptAt: h.at - 1 },
    { ...first.pending, fingerprint: 'b'.repeat(64) }]) {
    const before = copy(h.data);
    await assert.rejects(h.controller.acknowledge(target), /no longer the pending/);
    assert.deepEqual(h.data, before);
  }
  const history = copy(h.data[REMINDER_KEY].offers);
  const result = await h.controller.acknowledge(first.pending);
  assert.equal(result.pending, null);
  assert.equal(h.active[NOTIFICATION_ID], undefined);
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, first.pending.attemptAt);
  assert.deepEqual(h.data[REMINDER_KEY].offers, history);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  await assert.rejects(h.controller.acknowledge(first.pending), /no longer the pending/);
});

test('disable clears controls, survives unavailable APIs, and reenable cannot defeat either cap', async () => {
  const h = await harness({ tree: [node('1'), node('2')] });
  const first = await h.enableDue();
  const history = copy(h.data[REMINDER_KEY].offers);
  const clear = h.api.notifications.clear;
  h.api.notifications.clear = async () => { throw new Error('API unavailable'); };
  assert.equal((await h.controller.setEnabled(false)).status, 'off');
  assert.equal(h.alarm, undefined);
  assert.equal(h.data[REMINDER_KEY].pending, null);
  assert.equal((await h.controller.click()).pending, null);
  assert.deepEqual(h.data[REMINDER_KEY].offers, history);
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, first.pending.attemptAt);
  h.api.notifications.clear = clear;
  h.advance(h.at + HOUR);
  const enabledAt = h.at;
  assert.equal((await h.controller.setEnabled(true)).nextAt, enabledAt + WEEK);
  h.advance(enabledAt + WEEK - 1);
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  h.advance(enabledAt + WEEK);
  assert.equal((await h.controller.check()).pending.id, '2');
  assert.equal(h.attempts().length, 2);
});

test('legacy lifecycle migration is pure and ordinary obsolete offers are pruned without touching recovery', async () => {
  const lifecycle = emptyState();
  lifecycle.version = 1;
  delete lifecycle.recovery;
  delete lifecycle.totals.removed;
  const h = await harness({ lifecycle, tree: [node('1'), node('2')] });
  await h.enableDue();
  const pending = (await h.controller.status()).pending;
  await h.controller.acknowledge(pending);
  h.tree.shift();
  const before = copy(h.data[STATE_KEY]);
  await h.controller.check();
  assert.equal(h.data[REMINDER_KEY].offers['1'], undefined);
  assert.deepEqual(h.data[STATE_KEY], before);
  assert.equal(h.data[STATE_KEY].version, 1);
});

test('latest lifecycle/native and permission checks veto targets that change during asynchronous selection', async () => {
  for (const change of ['native', 'decision', 'permission']) {
    const h = await harness();
    await h.controller.setEnabled(true);
    h.advance(h.at + WEEK);
    if (change === 'permission') {
      h.api.isReviewVisible = async () => { h.permission(false); return false; };
      h.reload();
      assert.equal((await h.controller.check()).status, 'blocked');
    } else {
      const get = h.api.bookmarks.get;
      h.api.bookmarks.get = async id => {
        if (change === 'native') h.tree[0].url = 'https://example.com/new-identity';
        else {
          await h.later('1', h.at);
          h.data[STATE_KEY].entries['1'].disposition = 'reference';
        }
        return get(id);
      };
      await assert.rejects(h.controller.check(), /changed|no longer waiting/);
    }
    assert.equal(h.attempts().length, 0);
    assert.equal(h.data[REMINDER_KEY].lastAttemptAt, null);
  }
});

test('window is checked again after native validation crosses 18:00', async () => {
  const h = await harness();
  await h.controller.setEnabled(true);
  h.advance(local(8, 17) + HOUR - 1);
  const get = h.api.bookmarks.get;
  h.api.bookmarks.get = async id => {
    h.advance(local(8, 18));
    return get(id);
  };
  await h.controller.check();
  assert.equal(h.attempts().length, 0);
  assert.equal(h.alarm.scheduledTime, local(9, 9));
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, null);
});

test('Later pool sorts effective eligibility including past offers rather than decision timestamp alone', async () => {
  const h = await harness({ tree: [node('1'), node('2')] });
  await h.later('1', h.at - 2 * LATER_DELAY);
  await h.later('2', h.at - LATER_DELAY);
  await h.controller.setEnabled(true);
  const reminder = h.data[REMINDER_KEY];
  reminder.lastAttemptAt = h.at - WEEK;
  reminder.offers['1'] = { fingerprint: await fingerprintUrl(h.tree[0].url), at: h.at - WEEK };
  h.advance(h.at + WEEK);
  assert.equal((await h.controller.check()).pending.id, '2');
});

test('status of a delivered reminder is read-only and native closure does not imply resolution', async () => {
  const h = await harness();
  await h.enableDue();
  delete h.active[NOTIFICATION_ID];
  const before = copy(h.data);
  const count = h.writes().length;
  const snapshot = await h.controller.status();
  assert.equal(snapshot.status, 'pending');
  assert.equal(snapshot.pending.clicked, false);
  assert.equal(h.writes().length, count);
  assert.deepEqual(h.data, before);
  h.reload();
  await h.controller.check();
  assert.equal(h.attempts().length, 1);
  assert.deepEqual(h.data[STATE_KEY], before[STATE_KEY]);
});

test('disable remains durable on permission API failure and restart completes interrupted off cleanup', async () => {
  const h = await harness();
  await h.enableDue();
  h.failures.permission = true;
  assert.equal((await h.controller.setEnabled(false)).status, 'off');
  assert.equal(h.data[REMINDER_KEY].enabled, false);
  h.failures.permission = false;
  h.active[NOTIFICATION_ID] = { title: 'Backburner' };
  await h.api.alarms.create(ALARM_NAME, { when: h.at + WEEK });
  h.reload();
  await h.controller.check();
  assert.equal(h.active[NOTIFICATION_ID], undefined);
  assert.equal(h.alarm, undefined);
});

test('only named controls are cleared and changed nonpending offer identities are pruned', async () => {
  const h = await harness();
  const first = await h.enableDue();
  h.active.unrelated = { title: 'Other notification' };
  await h.controller.acknowledge(first.pending);
  h.tree[0].url = 'https://example.com/new-identity';
  await h.controller.check();
  assert.equal(h.data[REMINDER_KEY].offers['1'], undefined);
  assert.equal(h.active.unrelated.title, 'Other notification');
  assert.equal(h.data[REMINDER_KEY].lastAttemptAt, first.pending.attemptAt);
});

test('restart retries interrupted stale and acknowledgement notification cleanup', async () => {
  for (const operation of ['stale', 'acknowledge']) {
    const h = await harness();
    const first = await h.enableDue();
    const clear = h.api.notifications.clear;
    h.api.notifications.clear = async () => { throw new Error('Clear unavailable'); };
    if (operation === 'stale') {
      h.tree.length = 0;
      await assert.rejects(h.controller.check(), /Clear unavailable/);
      assert.equal(h.data[REMINDER_KEY].pending.stale, true);
    } else {
      await assert.rejects(h.controller.acknowledge(first.pending), /Clear unavailable/);
      assert.equal(h.data[REMINDER_KEY].pending, null);
    }
    assert.ok(h.active[NOTIFICATION_ID]);
    h.api.notifications.clear = clear;
    h.reload();
    await h.controller.check();
    assert.equal(h.active[NOTIFICATION_ID], undefined);
    assert.equal(h.attempts().length, 1);
  }
});

test('revocation remains blocked when native notification cleanup is unavailable', async () => {
  const h = await harness();
  await h.enableDue();
  h.permission(false);
  h.api.notifications.clear = async () => { throw new Error('Permission denied'); };
  assert.equal((await h.controller.check()).status, 'blocked');
  assert.ok(h.alarm.scheduledTime > h.at);
  assert.equal(h.attempts().length, 1);
});

test('fingerprints large native trees in bounded batches of one hundred', async t => {
  let concurrent = 0, peak = 0, hashes = 0;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    hashes++;
    concurrent++;
    peak = Math.max(peak, concurrent);
    try { return await digest(...args); }
    finally { concurrent--; }
  });
  const h = await harness({ tree: Array.from({ length: 205 }, (_, index) => node(String(index + 1))) });
  assert.equal((await h.controller.setEnabled(true)).status, 'scheduled');
  assert.equal(hashes, 205);
  assert.ok(peak <= 100);
  assert.equal(concurrent, 0);
});
