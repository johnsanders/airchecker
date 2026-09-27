import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';
import { useLiveQuery } from '../useLiveQuery.js';

interface Props {
	onClose: () => void;
	onError: (message: string) => void;
	onOpened: (file: string) => void;
	open: boolean;
}

// The TEST source picker: the recordings in recordings/video. Picking one opens it
// paused in the debug Chrome and points capture at it. The body only mounts while
// open, so the list is fetched fresh each time (a file dropped in mid-session shows).
const TestVideoDialog: React.FC<Props> = (props) => (
	<Dialog fullWidth={true} maxWidth="xs" onClose={props.onClose} open={props.open}>
		<DialogTitle>Test with a recording</DialogTitle>
		<DialogContent dividers={true}>{props.open && <TestVideoList {...props} />}</DialogContent>
	</Dialog>
);

const TestVideoList: React.FC<Props> = (props) => {
	const { data, error } = useLiveQuery(() => api.getTestVideos());
	const [opening, setOpening] = React.useState(false);

	const pick = async (file: string): Promise<void> => {
		setOpening(true);
		try {
			await api.openTestVideo(file);
			props.onOpened(file);
		} catch (e) {
			props.onError(e instanceof Error ? e.message : String(e));
		} finally {
			setOpening(false);
			props.onClose();
		}
	};

	if (error !== undefined) return <Typography color="error">{error}</Typography>;
	if (data === undefined) return <Typography color="text.secondary">loading…</Typography>;
	if (data.files.length === 0)
		return <Typography color="text.secondary">No videos in recordings/video.</Typography>;
	return (
		<List dense={true}>
			{data.files.map((file) => (
				<ListItemButton disabled={opening} key={file} onClick={() => void pick(file)}>
					<ListItemText primary={file} />
				</ListItemButton>
			))}
		</List>
	);
};

export default TestVideoDialog;
