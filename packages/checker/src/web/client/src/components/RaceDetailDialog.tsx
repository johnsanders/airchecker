import CloseIcon from '@mui/icons-material/Close';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import React from 'react';

import RaceDetail from './RaceDetail.js';

interface Props {
	onClose: () => void;
	raceKey: string | undefined;
}

// The per-race source comparison in a modal. Open is driven by raceKey; the body
// only mounts while open so RaceDetail's live query starts fresh on each open and
// tears down on close.
const RaceDetailDialog: React.FC<Props> = (props) => (
	<Dialog fullWidth={true} maxWidth="md" onClose={props.onClose} open={props.raceKey !== undefined}>
		{props.raceKey !== undefined && (
			<>
				<DialogTitle sx={{ pr: 6, wordBreak: 'break-all' }}>
					{props.raceKey}
					<IconButton
						aria-label="close"
						onClick={props.onClose}
						sx={{ color: 'text.secondary', position: 'absolute', right: 8, top: 8 }}
					>
						<CloseIcon />
					</IconButton>
				</DialogTitle>
				<DialogContent dividers={true}>
					<RaceDetail raceKey={props.raceKey} />
				</DialogContent>
			</>
		)}
	</Dialog>
);

export default RaceDetailDialog;
