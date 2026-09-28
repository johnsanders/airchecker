// A tiny pub/sub the web server uses to push "something changed" signals to live
// websocket clients. Kept free of the ws library so it's unit-testable and so
// makeWebServer's return type stays a plain FastifyInstance.

export type ChangeBus = {
	broadcast: (message: ChangeMessage) => void;
	subscribe: (listener: (message: ChangeMessage) => void) => () => void;
};

// The signal carried over the socket: not the data itself, just a nudge to refetch.
// raceKeys (when present) are the canonical keys that changed, so a client can skip
// a refetch it doesn't care about — advisory only.
export type ChangeMessage = { raceKeys?: string[]; type: 'changed' };

export const makeChangeBus = (): ChangeBus => {
	const listeners = new Set<(message: ChangeMessage) => void>();
	return {
		broadcast: (message) => listeners.forEach((listener) => listener(message)),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};
