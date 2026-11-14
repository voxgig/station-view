# station-view

A [voxgig/station](https://github.com/voxgig/station) extension: a view of
a Station's state. **It is a stub for now.** It snapshots what one
process's Station holds. What the real view shows, and whether it reads a
process or station's proxy, is not designed yet (station's decision
D-2026-11-14-1).

## Use

```ts
import { Station } from '@voxgig/station'
import { StationView } from '@voxgig/station-view'

const station = new Station({ profile: 'default' }).use(StationView)

station.extension('view/view').snapshot()
// { stub: true, mode: 'solo', profile: 'default',
//   instances: [{ name, api, active }, ...],
//   events: { buffered, dropped, kinds: { <kind>: <count> } } }
```

A Station loads it only when handed it. It needs a Station that hosts
extensions, with `Station.use()`, which no released `@voxgig/station` has
yet.

The package is not on npm. Take it from this repository: `typescript/`
holds it, with `dist/src/` committed, so a checkout needs no build step.

## Layout

`typescript/` is the canonical port, and the only one so far. It has no
runtime dependencies.

## Develop

```sh
make test      # build, test, comment gate, and a stale dist/ check
```
