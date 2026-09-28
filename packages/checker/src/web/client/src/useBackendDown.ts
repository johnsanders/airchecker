import React from 'react';

import { isBackendDown, subscribeToBackendDown } from './changeFeed.js';

export const useBackendDown = (): boolean =>
	React.useSyncExternalStore(subscribeToBackendDown, isBackendDown);
