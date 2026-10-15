# Verified Pilot Corridor

This file documents the smallest scoped corridor used to validate signal-aware routing. It is not a Seoul-wide activation record.

## Scope

- Scope token candidate: `field:pilot-corridor-20260917`
- Public activation: not enabled
- Public flag: do not set `SIGNAL_PUBLIC_PREDICTION=true` from this file alone
- Source document: `data/signals/verified/pilot-corridor.md`
- Source retrieved at: `2026-09-17T15:00:00+09:00`
- Verified at: `2026-09-17T15:00:00+09:00`
- Verified by: `manual-field-pilot`
- Verification method: manual route survey plus fixed-cycle forecast replay
- Notes: no personal data or provider secrets are included

## Route Survey

The survey is complete only for this exact eastbound pilot route:

```json
[
  [126.97216, 37.5665],
  [126.98353, 37.5665]
]
```

Expected crossing IDs:

- `field:pilot-corridor-a-eastbound`
- `field:pilot-corridor-b-eastbound`

`complete=true` applies only because the full pilot route geometry above was reviewed and both expected crossing IDs are present in the survey. It must not be copied to adjacent streets, reverse travel, other TMAP options, or Seoul-wide scopes.

## Forecast Replay

Fixed replay input:

- Departure: `2026-09-17T15:00:00+09:00`
- Pace: `6:00/km`
- Crossing A distance: about `500m`
- Crossing A arrival: `15:03:00`
- Crossing width: `22m`
- Walking speed: `1.2m/s`
- Buffer: `3s`

Crossing A calculation:

```text
crossSec = 22 / 1.2 + 3 = 21.333...
phase = 180 % 60 = 0
entryStart = 30
latestEntry = min(55, 60 - crossSec) = 38.666...
wait = 30
```

Cumulative wait check:

```text
signal A ETA = 15:03:00
wait A = 30s
signal B ETA includes wait A
```

The replay proves engine arithmetic only for this scoped pilot corridor. Freshness still depends on a current applied-plan confirmation; stale static records must remain excluded from live prediction.
