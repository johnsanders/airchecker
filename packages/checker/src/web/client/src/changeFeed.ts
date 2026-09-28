// One app-wide websocket to the server's /ws endpoint. Components never open their
// own socket — they subscribe here, and useLiveQuery refetches on each nudge. The
// server pushes a "changed" message on every state change; we treat any message as
// "something changed, refetch". Auto-reconnects with capped backoff, and fires a
// synthetic nudge on every (re)connect so the UI resyncs after a drop.

type Listener = () => void;

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

const listeners = new Set<Listener>();
let socket: undefined | WebSocket;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = RECONNECT_MIN_MS;

// True from a socket closing (or failing to open) until the next one opens. This is the
// "can the UI reach the backend" signal: it flips the moment the server goes away, where
// a failed fetch would only surface on the next fallback refetch. Not set while the
// first socket is still connecting, so a normal page load never flashes it.
let backendDown = false;
const backendDownListeners = new Set<Listener>();

const setBackendDown = (next: boolean): void => {
	if (backendDown === next) return;
	backendDown = next;
	backendDownListeners.forEach((listener) => listener());
};

const wsUrl = (): string => {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${window.location.host}/ws`;
};

const notify = (): void => listeners.forEach((listener) => listener());

const scheduleReconnect = (): void => {
	if (reconnectTimer !== undefined || listeners.size === 0) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = undefined;
		connect();
	}, reconnectDelay);
	reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
};

const connect = (): void => {
	const next = new WebSocket(wsUrl());
	socket = next;
	next.onopen = () => {
		reconnectDelay = RECONNECT_MIN_MS;
		setBackendDown(false);
		notify(); // resync on (re)connect — covers anything missed while disconnected
	};
	next.onmessage = () => notify();
	next.onclose = () => {
		if (socket === next) socket = undefined;
		setBackendDown(true);
		scheduleReconnect();
	};
	next.onerror = () => next.close();
};

export const isBackendDown = (): boolean => backendDown;

export const subscribeToBackendDown = (listener: Listener): (() => void) => {
	backendDownListeners.add(listener);
	return () => {
		backendDownListeners.delete(listener);
	};
};

// Returns an unsubscribe. The socket opens lazily on the first subscriber and stays
// up for the life of the page (the dashboard's hooks live for the whole session).
export const subscribeToChanges = (listener: Listener): (() => void) => {
	listeners.add(listener);
	if (socket === undefined && reconnectTimer === undefined) connect();
	return () => {
		listeners.delete(listener);
	};
};
