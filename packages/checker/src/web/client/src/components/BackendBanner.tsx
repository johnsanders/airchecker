import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import React from 'react';

import { useBackendDown } from '../useBackendDown.js';

// Sticky so it stays in view while scrolling: nothing on the page is live while it shows.
const BackendBanner: React.FC = () => {
	const backendDown = useBackendDown();
	if (!backendDown) return null;
	return (
		<Alert
			severity="error"
			square={true}
			sx={{ position: 'sticky', top: 0, zIndex: (theme) => theme.zIndex.appBar + 1 }}
			variant="filled"
		>
			<AlertTitle>Can&apos;t reach the backend</AlertTitle>
			Nothing below is live: alerts, races and source health won&apos;t update until it&apos;s back.
			Start it with <code>npm run backend</code> if it isn&apos;t running; this page reconnects on
			its own.
		</Alert>
	);
};

export default BackendBanner;
