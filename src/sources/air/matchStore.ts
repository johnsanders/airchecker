// Which browser tab the air capturer grabs, as a URL substring — runtime state so
// the web UI can switch between surfaces (DirecTV stream vs the Actus playback)
// without a restart. The capturer reads get() fresh each capture; the web server
// calls set() from the preset buttons.
export type MatchStore = {
  get: () => string;
  set: (match: string) => void;
};

export const makeMatchStore = (initial = 'actus'): MatchStore => {
  let match = initial;
  return {
    get: () => match,
    set: (next) => {
      const trimmed = next.trim();
      if (trimmed.length > 0) match = trimmed;
    },
  };
};
