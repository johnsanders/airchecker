import { describe, expect, it } from 'vitest';

import { makeQueryStore } from '../../src/sources/provider/queryStore.js';

describe('makeQueryStore', () => {
  it('starts empty by default', () => {
    expect(makeQueryStore().get()).toEqual([]);
  });

  it('set() replaces the list and get() reflects it', () => {
    const store = makeQueryStore();
    store.set(['race_ids=1', 'state=TX']);
    expect(store.get()).toEqual(['race_ids=1', 'state=TX']);
  });

  it('trims and drops empty/whitespace entries on set', () => {
    const store = makeQueryStore();
    store.set(['  race_ids=1  ', '', '   ', 'state=TX']);
    expect(store.get()).toEqual(['race_ids=1', 'state=TX']);
  });

  it('returns copies so callers cannot mutate internal state', () => {
    const store = makeQueryStore(['race_ids=1']);
    store.get().push('injected');
    expect(store.get()).toEqual(['race_ids=1']);
  });
});
