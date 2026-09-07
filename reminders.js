import { candidates, eligibleAt, emptyState, flatten, LATER_DELAY, matches, migrateState, randomOrder } from './domain.js';
import { fingerprintUrl, STATE_KEY } from './store.js';

export const REMINDER_KEY = 'backburner.reminders.v1';
export const ALARM_NAME = 'backburner-reminder';
export const NOTIFICATION_ID = 'backburner-reminder';
export const WEEK = 7 * 86400000;
const RETRY = 3600000;
const time = value => Number.isSafeInteger(value) && value >= 0;
const nullableTime = value => value === null || time(value);
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const pool = value => value === 'later' || value === 'other';
const identity = value => value && typeof value.id === 'string' && /^\d+$/.test(value.id) && fingerprint(value.fingerprint);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const emptyReminderState = () => ({
  version: 1, enabled: false, enabledAt: null, lastAttemptAt: null,
  nextAt: null, retryAt: null, lastPool: null, offers: {}, pending: null
});

export function validateReminderState(value) {
  if (!record(value) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
      !nullableTime(value.enabledAt) || !nullableTime(value.lastAttemptAt) ||
      !nullableTime(value.nextAt) || !nullableTime(value.retryAt) ||
      !(value.lastPool === null || pool(value.lastPool)) || !record(value.offers) ||
      (value.enabled && value.enabledAt === null)) {
    throw new Error('Saved reminder data is not compatible. Nothing has been reset.');
  }
  for (const [id, offer] of Object.entries(value.offers)) {
    if (!/^\d+$/.test(id) || !record(offer) || !fingerprint(offer.fingerprint) ||
        !time(offer.at) || value.lastAttemptAt === null || offer.at > value.lastAttemptAt) {
      throw new Error('Saved reminder offers could not be read. Nothing has been reset.');
    }
  }
  const p = value.pending;
  if (p !== null && (!identity(p) || !time(p.attemptAt) || !pool(p.pool) ||
      typeof p.clicked !== 'boolean' || !['reserved', 'pending', 'uncertain'].includes(p.delivery) ||
      (p.stale !== undefined && typeof p.stale !== 'boolean') ||
      p.attemptAt !== value.lastAttemptAt || value.offers[p.id]?.fingerprint !== p.fingerprint ||
      value.offers[p.id]?.at !== p.attemptAt)) {
    throw new Error('Saved reminder handoff could not be read. Nothing has been reset.');
  }
  return value;
}

export function deliveryWindow(at) {
  const date = new Date(at);
  if (date.getHours() < 9) date.setHours(9, 0, 0, 0);
  else if (date.getHours() >= 18) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return date.getTime();
}

const inRecovery = (state, id) => Object.values(state.recovery).some(entry => entry.id === id);
const pendingStatus = pending => !pending ? null : pending.stale ? 'stale' :
  pending.delivery === 'pending' ? 'pending' : 'uncertain';
const sanitized = pending => pending && ({
  id: pending.id, fingerprint: pending.fingerprint, attemptAt: pending.attemptAt,
  pool: pending.pool, clicked: pending.clicked, ...(pending.stale ? { stale: true } : {})
});

export function createReminders({ storage, bookmarks, alarms, notifications, permissions, action, isReviewVisible, now = Date.now, random = Math.random }) {
  let jobs = Promise.resolve();

  async function permission() {
    if (!permissions?.contains || !notifications?.getPermissionLevel) return false;
    return await permissions.contains({ permissions: ['notifications'] }) &&
      await notifications.getPermissionLevel() === 'granted';
  }

  async function read() {
    const values = await storage.get([REMINDER_KEY, STATE_KEY]);
    const reminder = Object.hasOwn(values, REMINDER_KEY) ? validateReminderState(values[REMINDER_KEY]) : emptyReminderState();
    const lifecycle = Object.hasOwn(values, STATE_KEY) ? migrateState(values[STATE_KEY]) : emptyState();
    return { reminder: structuredClone(reminder), lifecycle };
  }

  async function save(reminder) {
    validateReminderState(reminder);
    await storage.set({ [REMINDER_KEY]: reminder });
  }

  async function badge(status) {
    try {
      await action?.setBadgeText({ text: ['error', 'uncertain', 'blocked'].includes(status) ? '!' :
        status === 'pending' ? '•' : '' });
      await action?.setTitle({ title: `Backburner — reminders ${status}` });
    } catch { /* A diagnostic failure must not change the delivery journal. */ }
  }

  async function alarm(at) {
    if (!alarms) {
      if (at !== null) throw new Error('Reminder alarms are unavailable.');
      return;
    }
    if (at === null) { await alarms.clear(ALARM_NAME); return; }
    const existing = await alarms.get(ALARM_NAME);
    if (!existing || existing.scheduledTime !== at) await alarms.create(ALARM_NAME, { when: at });
  }

  async function clearNotification() {
    if (notifications?.clear) await notifications.clear(NOTIFICATION_ID);
  }

  async function clearControls() {
    try { await clearNotification(); } catch { /* Revocation can make this API unavailable. */ }
    try { await alarm(null); } catch { /* Any late alarm will observe disabled state. */ }
  }

  async function diagnose() {
    await badge('error');
    try { await alarm(deliveryWindow(now() + RETRY)); } catch { /* Retry on another worker event. */ }
  }

  function serialize(job) {
    const result = jobs.then(job).catch(async error => {
      await diagnose();
      throw error;
    });
    jobs = result.catch(() => {});
    return result;
  }

  function snapshot(reminder, allowed, fallback = 'scheduled') {
    return {
      enabled: reminder.enabled,
      status: !reminder.enabled ? 'off' : !allowed ? 'blocked' : pendingStatus(reminder.pending) || fallback,
      nextAt: reminder.nextAt, pending: sanitized(reminder.pending), permission: allowed
    };
  }

  async function nodes() {
    const all = flatten(await bookmarks.getTree()), result = [];
    for (let index = 0; index < all.length; index += 100) {
      result.push(...await Promise.all(all.slice(index, index + 100).map(async node => ({
        ...node, fingerprint: await fingerprintUrl(node.url)
      }))));
    }
    return result;
  }

  function opportunities(all, lifecycle, reminder) {
    return candidates(all, lifecycle, Number.MAX_SAFE_INTEGER)
      .filter(node => Number.isFinite(eligibleAt(lifecycle, node)) && !inRecovery(lifecycle, node.id))
      .map(node => {
        const offer = reminder.offers[node.id];
        const at = Math.max(eligibleAt(lifecycle, node), matches(offer, node) ? offer.at + LATER_DELAY : 0);
        return { node, at, pool: matches(lifecycle.entries[node.id], node) &&
          lifecycle.entries[node.id].disposition === 'later' ? 'later' : 'other',
        offeredAt: matches(offer, node) ? offer.at : null };
      });
  }

  function select(options, reminder, at) {
    const due = options.filter(option => option.at <= at);
    const later = due.filter(option => option.pool === 'later')
      .sort((a, b) => a.at - b.at || a.node.id.localeCompare(b.node.id));
    if(later.length && reminder.lastPool!=='later')return later[0];
    const other = due.filter(option => option.pool === 'other')
      .sort((a, b) => (a.offeredAt ?? -1) - (b.offeredAt ?? -1));
    if(!other.length)return later[0];
    const tied=other.filter(option=>option.offeredAt===other[0].offeredAt);
    const [selected]=randomOrder(tied.map(option=>option.node),at,random);
    return tied.find(option=>option.node===selected);
  }

  function nextTime(options, reminder, at) {
    if (!options.length) return null;
    return deliveryWindow(Math.max(at, reminder.enabledAt + WEEK,
      reminder.lastAttemptAt === null ? 0 : reminder.lastAttemptAt + WEEK,
      reminder.retryAt ?? 0, options.reduce((earliest, option) => Math.min(earliest, option.at), Infinity)));
  }

  async function validPending(pending, lifecycle, all) {
    const node = all.find(node => node.id === pending.id);
    if (!node || !matches(pending, node) || eligibleAt(lifecycle, node) > now() ||
        inRecovery(lifecycle, node.id)) return false;
    const current = await bookmarks.get(pending.id);
    const native = current.find(item => item.id === pending.id);
    return !!native && matches(pending, { fingerprint: await fingerprintUrl(native.url) });
  }

  function prune(reminder, all, lifecycle) {
    const identities = new Map(all.map(node => [node.id, node.fingerprint]));
    for (const [id, offer] of Object.entries(reminder.offers)) {
      // Keep the pending journal's identity until its handoff is acknowledged/replaced.
      if (id !== reminder.pending?.id && !inRecovery(lifecycle, id) &&
          identities.get(id) !== offer.fingerprint) delete reminder.offers[id];
    }
  }

  async function reconcile(reminder, lifecycle, allowed, attempt) {
    if (!reminder.enabled) {
      await clearControls();
      await badge('off');
      return snapshot(reminder, allowed);
    }
    const all = await nodes();
    if (reminder.pending && (reminder.pending.stale || !await validPending(reminder.pending, lifecycle, all))) {
      if (!reminder.pending.stale) {
        reminder.pending.stale = true;
        await save(reminder);
      }
    }
    if (!reminder.pending || reminder.pending.stale || !allowed) {
      try { await clearNotification(); } catch (error) { if (allowed) throw error; }
    }
    prune(reminder, all, lifecycle);
    let options = opportunities(all, lifecycle, reminder);
    if (!allowed) {
      reminder.retryAt = now() + RETRY;
      reminder.nextAt = deliveryWindow(reminder.retryAt);
      await save(reminder);
      await alarm(reminder.nextAt);
      await badge('blocked');
      return snapshot(reminder, false);
    }
    reminder.nextAt = nextTime(options, reminder, now());
    if (attempt && reminder.nextAt !== null && reminder.nextAt <= now()) {
      if (await isReviewVisible()) {
        reminder.retryAt = now() + RETRY;
        reminder.nextAt = nextTime(options, reminder, now());
      } else {
        // Re-read after asynchronous visibility/native work; lifecycle has another writer.
        const latest = await read();
        lifecycle = latest.lifecycle;
        const fresh = await nodes();
        options = opportunities(fresh, lifecycle, reminder);
        const selected = select(options, reminder, now());
        const allowedNow = await permission();
        if (!allowedNow) return reconcile(reminder, lifecycle, false, false);
        reminder.nextAt = nextTime(options, reminder, now());
        if (selected && reminder.nextAt <= now() && deliveryWindow(now()) === now()) {
          const target = { id: selected.node.id, fingerprint: selected.node.fingerprint };
          if (!await validPending(target, lifecycle, fresh)) {
            throw new Error('The reminder bookmark changed before delivery. Try again later.');
          }
          lifecycle = (await read()).lifecycle;
          const at = now();
          options = opportunities(fresh, lifecycle, reminder);
          reminder.nextAt = nextTime(options, reminder, at);
          if (eligibleAt(lifecycle, selected.node) > at || inRecovery(lifecycle, target.id)) {
            throw new Error('The reminder bookmark is no longer waiting. Try again later.');
          }
          if (reminder.nextAt !== null && reminder.nextAt <= at) {
            reminder.lastAttemptAt = at;
            reminder.lastPool = selected.pool;
            reminder.retryAt = null;
            reminder.offers[target.id] = { fingerprint: target.fingerprint, at };
            reminder.pending = { ...target, attemptAt: at, pool: selected.pool, clicked: false, delivery: 'reserved' };
            reminder.nextAt = nextTime(opportunities(fresh, lifecycle, reminder), reminder, at);
            await save(reminder);
            // A reserved attempt consumes the slot even if creation or the following save fails.
            try {
              await notifications.create(NOTIFICATION_ID, {
                type: 'basic', iconUrl: 'icons/icon128.png', title: 'Backburner',
                message: selected.pool === 'later' ? 'A bookmark you left for later is ready to revisit.' :
                  'A saved bookmark is ready for another look.',
                silent: true, requireInteraction: false, priority: 0
              });
              reminder.pending.delivery = 'pending';
            } catch {
              reminder.pending.delivery = 'uncertain';
            }
            await save(reminder);
          }
        }
      }
    }
    await save(reminder);
    await alarm(reminder.nextAt);
    const result = snapshot(reminder, true, options.length ? 'scheduled' : 'empty');
    await badge(result.status);
    return result;
  }

  return {
    check: () => serialize(async () => {
      const { reminder, lifecycle } = await read();
      return reconcile(reminder, lifecycle, await permission(), true);
    }),
    status: () => serialize(async () => {
      const { reminder, lifecycle } = await read();
      const allowed = await permission();
      const all = reminder.enabled ? await nodes() : [];
      if (reminder.pending && !await validPending(reminder.pending, lifecycle, all)) reminder.pending.stale = true;
      const options = reminder.enabled ? opportunities(all, lifecycle, reminder) : [];
      const result = snapshot(reminder, allowed, options.length ? 'scheduled' : 'empty');
      await badge(result.status);
      return result;
    }),
    setEnabled: enabled => serialize(async () => {
      if (typeof enabled !== 'boolean') throw new Error('Reminder enablement must be a boolean.');
      const { reminder, lifecycle } = await read();
      let allowed = false;
      try { allowed = await permission(); } catch (error) { if (enabled) throw error; }
      if (enabled && !allowed) throw new Error('Allow notifications before enabling reminders.');
      if (enabled) {
        if (!reminder.enabled) {
          reminder.enabled = true;
          reminder.enabledAt = now();
          reminder.retryAt = null;
        }
        await save(reminder);
        return reconcile(reminder, lifecycle, allowed, false);
      }
      reminder.enabled = false;
      reminder.pending = null;
      reminder.nextAt = null;
      reminder.retryAt = null;
      await save(reminder);
      await clearControls();
      await badge('off');
      return snapshot(reminder, allowed);
    }),
    click: () => serialize(async () => {
      const { reminder } = await read();
      const allowed = await permission();
      if (!reminder.enabled || !reminder.pending) return snapshot(reminder, allowed);
      reminder.pending.clicked = true;
      await save(reminder);
      const { lifecycle } = await read();
      if (!await validPending(reminder.pending, lifecycle, await nodes())) {
        reminder.pending.stale = true;
        await save(reminder);
        await clearNotification();
      }
      const result = snapshot(reminder, allowed);
      await badge(result.status);
      return result;
    }),
    acknowledge: target => serialize(async () => {
      const { reminder, lifecycle } = await read();
      if (!identity(target) || !reminder.pending || reminder.pending.id !== target.id ||
          reminder.pending.fingerprint !== target.fingerprint || reminder.pending.attemptAt !== target.attemptAt) {
        throw new Error('That reminder is no longer the pending reminder. Nothing has been cleared.');
      }
      reminder.pending = null;
      await save(reminder);
      await clearNotification();
      return reconcile(reminder, lifecycle, await permission(), false);
    })
  };
}
