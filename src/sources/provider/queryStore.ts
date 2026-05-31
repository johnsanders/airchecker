// The DDHQ query list is runtime state, edited via the web UI. It starts EMPTY
// (no env source) — nothing is polled until queries are added. The poller reads
// get() fresh each tick; the web server calls set(). Returns copies so callers
// can't mutate internal state.
export type QueryStore = {
  get: () => string[];
  set: (queries: string[]) => void;
};

export const makeQueryStore = (initial: string[] = []): QueryStore => {
  let queries = [...initial];
  return {
    get: () => [...queries],
    set: (next) => {
      queries = next.filter((q) => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim());
    },
  };
};
