import React from 'react';

/** Notes the backend writes on movement_history rows that are not real moves. */
const RFID_TAGGED = 'RFID tagged';
const INITIAL_PLACEMENT = 'Initial placement';

/** From / To cell contents for a movement row (RFID tag events and initial placements read naturally). */
export function movementCells(m) {
  if (m.notes === RFID_TAGGED) {
    return {
      from: '—',
      to: (
        <>
          RFID tagged
          {m.to_location && <span style={{ color: '#888', fontWeight: 400 }}> at {m.to_location}</span>}
        </>
      ),
    };
  }
  if (m.notes === INITIAL_PLACEMENT) {
    // Older web-created rows stored the location in from_location_id.
    return { from: '—', to: m.to_location || m.from_location || '—' };
  }
  return { from: m.from_location || '—', to: m.to_location || '—' };
}
