import { emptyState, validateState, migrateState } from './domain.js';
export const STATE_KEY = 'backburner.v1';

// The review page holds an exclusive Web Lock for its lifetime. Only one writer.
export function createStore(storage) {
  let current;
  let writes = Promise.resolve();
  return {
    async load() {
      const result = await storage.get(STATE_KEY);
      const original=result[STATE_KEY] ?? emptyState();
      const migrated=migrateState(original);
      if(original.version!==migrated.version)await storage.set({[STATE_KEY]:migrated});
      current = migrated;
      return structuredClone(current);
    },
    update(transform) {
      const pending = writes.then(async () => {
        if (!current) throw new Error('Load saved data first.');
        const next = validateState(transform(structuredClone(current)));
        await storage.set({[STATE_KEY]: next});
        current = structuredClone(next);
        return structuredClone(current);
      });
      writes = pending.catch(() => {});
      return pending;
    }
  };
}

export async function fingerprintUrl(url) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,'0')).join('');
}
