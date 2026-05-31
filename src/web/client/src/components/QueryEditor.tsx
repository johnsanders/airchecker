import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';

// Editable DDHQ query list — one /api/v4/races query string per line. Runtime
// state on the server (queryStore); the poller picks up edits on its next tick.
const QueryEditor: React.FC = () => {
  const [text, setText] = React.useState('');
  const [msg, setMsg] = React.useState('');

  React.useEffect(() => {
    void api.getQueries().then((r) => setText(r.queries.join('\n')));
  }, []);

  const save = async (): Promise<void> => {
    const queries = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await api.setQueries(queries);
    setText(r.queries.join('\n'));
    setMsg(`saved ${r.queries.length}`);
  };

  return (
    <Box>
      <TextField
        multiline
        minRows={3}
        fullWidth
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'race_ids=123,456\nstate=TX&office_id=3'}
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
      />
      <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => void save()}>
          Save queries
        </Button>
        <Typography variant="caption" color="text.secondary">
          {msg}
        </Typography>
      </Box>
    </Box>
  );
};

export default QueryEditor;
