const PROFILE_PREFIX = 'overcurrent:profile:';
const AWARD_PREFIX = 'overcurrent:award:';

export function normalizeName(value) {
  return value.replace(/[\uD800-\uDFFF]/gu, '\uFFFD').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

const profileId = name => encodeURIComponent(normalizeName(name).toLowerCase());

export function createProfileStore(storage) {
  const memory = new Map();

  function get(key) {
    try { return storage?.getItem(key) ?? memory.get(key); }
    catch { return memory.get(key); }
  }

  function put(key, value) {
    if (!storage) return memory.set(key, value);
    try {
      storage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  }

  function keys() {
    const existing = new Set(memory.keys());
    try {
      for (let index = 0; index < (storage?.length ?? 0); index++) {
        const key = storage.key(index);
        if (key !== null) existing.add(key);
      }
    } catch { /* In-memory profiles still work. */ }
    return existing;
  }

  function list() {
    const profiles = new Map();
    const awards = [];
    for (const key of keys()) {
      if (key.startsWith(PROFILE_PREFIX)) {
        const name = get(key);
        if (name) profiles.set(key.slice(PROFILE_PREFIX.length), { name, totalXp: 0 });
      } else if (key.startsWith(AWARD_PREFIX)) {
        awards.push(key);
      }
    }
    for (const key of awards) {
      const end = key.indexOf(':', AWARD_PREFIX.length);
      if (end < 0) continue;
      const profile = profiles.get(key.slice(AWARD_PREFIX.length, end));
      const xp = Number(get(key));
      if (profile && Number.isInteger(xp) && xp > 0 && xp <= 100) profile.totalXp += xp;
    }
    return [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function find(name) {
    const id = profileId(name);
    return list().find(profile => profileId(profile.name) === id);
  }

  function ensure(name) {
    const normalized = normalizeName(name);
    if (!normalized) throw new RangeError('Enter a player name');
    const existing = find(normalized);
    if (existing) return existing;
    put(PROFILE_PREFIX + profileId(normalized), normalized);
    return { name: normalized, totalXp: 0 };
  }

  function award(name, eventId, xp) {
    const profile = ensure(name);
    const key = `${AWARD_PREFIX}${profileId(profile.name)}:${eventId}`;
    if ([100, 75, 50, 25].includes(xp) && get(key) === undefined) put(key, String(xp));
    return find(profile.name);
  }

  return { ensure, find, list, award };
}
