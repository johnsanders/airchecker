import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';
import { sourceLabel } from '../api.js';
import type { RaceCell, RaceDetailResponse, SourceName } from '../api.js';
import { usePolling } from '../usePolling.js';

interface Props {
  raceKey: string;
}

const SOURCES: SourceName[] = ['DDHQ', 'Ross', 'air'];

const fmtCell = (cell: RaceCell | undefined): React.ReactNode => {
  if (cell === undefined) return <Typography variant="caption" color="text.secondary">—</Typography>;
  return (
    <>
      {cell.votes.toLocaleString()} · {cell.pct}%{cell.called ? ' ✓' : ''}
    </>
  );
};

// The core view: DDHQ / Ross / air side by side for one race. Each candidate is one
// row, aligned across sources (server matches by normalized name). A discrepancy —
// different votes, or a ✓ in one column but not another — is visible at a glance.
const RaceDetail: React.FC<Props> = (props) => {
  const { data, error } = usePolling<RaceDetailResponse>(
    () => api.getRace(props.raceKey),
    3000,
    [props.raceKey],
  );

  if (error !== undefined)
    return <Typography color="error">Failed to load race: {error}</Typography>;
  if (data === undefined) return <Typography color="text.secondary">Loading…</Typography>;

  return (
    <Box>
      <Typography sx={{ fontWeight: 600, mb: 1 }}>{data.raceKey}</Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {data.sources.map((s) => (
          <Box key={s.source} sx={{ fontSize: 12, color: s.present ? 'text.primary' : 'text.secondary' }}>
            <b>{sourceLabel(s.source)}</b>: {s.present ? `${s.pctIn ?? '—'}% in` : 'no data'}
          </Box>
        ))}
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Candidate</TableCell>
            {SOURCES.map((s) => (
              <TableCell key={s} align="right">
                {sourceLabel(s)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.candidates.map((row) => (
            <TableRow key={row.name}>
              <TableCell>{row.name}</TableCell>
              {SOURCES.map((s) => (
                <TableCell key={s} align="right">
                  {fmtCell(row.cells[s])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {data.candidates.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography variant="caption" color="text.secondary">
                  No candidate data yet for this race.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {data.anomalies.length > 0 && (
        <Paper sx={{ mt: 2, p: 1.5, borderLeft: '3px solid', borderColor: 'error.main' }}>
          <Typography variant="caption" color="text.secondary">
            {data.anomalies.length} anomaly(ies)
          </Typography>
          {data.anomalies.map((a, i) => (
            <Typography key={i} variant="body2" sx={{ color: 'error.light' }}>
              [{a.severity}] {a.type}: {a.detail}
            </Typography>
          ))}
        </Paper>
      )}
    </Box>
  );
};

export default RaceDetail;
