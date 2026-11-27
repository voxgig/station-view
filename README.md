# station-view

A [voxgig/station](https://github.com/voxgig/station) extension: a local
page for watching and filtering the API calls made through the SDKs a
Station builds.

## Use

```ts
import { Station } from '@voxgig/station'
import { StationView } from '@voxgig/station-view'

const station = new Station({ profile: 'default' }).use(StationView)
const solar = station.connect(SolardemoSDK, { instance: 'solar' })

const live = await station.extension('view/view').listen()
console.error('traffic at ' + live.url)    // http://127.0.0.1:<port>/
```

Hand the extension to the Station before building SDKs: it switches its
features on as each SDK is built, and hears of each client as it binds.

## What it shows

For each SDK the Station builds, the view switches on those of sdkgen's
features the SDK was generated with, and hands each one a callback:

| feature | what it records | option it fills |
| --- | --- | --- |
| `telemetry` | a span per operation | `exporter` |
| `debug` | each HTTP call: method, URL, status, duration | `onEntry` |
| `audit` | an audit record per operation | `sink` |
| `metrics` | counters, read from the client on request | none |

A caller's own settings for those features win: a feature the caller
switched off stays off, and where the caller set a callback, both run.

The view also takes every event the Station emits, its `http` and `op`
events among them. Those cover an SDK generated without the features.

Each record carries:

- its source, and the SDK instance and API it came from;
- the operation, and the method, path and status where its source knows them;
- the duration;
- `call`, the SDK's id for the operation, where its source carries one;
- the record itself, as the SDK cleaned it.

One call's `telemetry` span, `debug` entry and `audit` record carry the
same `call`: sdkgen puts the operation context's id on each as
`correlationId`. The page shows it in its last column. Clicking an id
keeps only that call's records, and picking a record shows the call's
records together, those of the one SDK. A Station's own `op`, `http`
and `error` events carry its `corr` as their `call`: where the Station
takes the SDK's id as `corr`, they join the call's other records, and
where it counts its own, they group only its events of one operation.

The view keeps the newest 1000. `use(StationView, { max, features })`
changes the count, and which of the four features it switches on.

## The page and its API

`listen({ port, host })` serves on loopback only: `127.0.0.1` by default,
or `localhost` or `::1`. Port 0, the default, takes a free port. It is
read-only, and answers only a request whose `Host` names the loopback
address it listens on.

| path | answers |
| --- | --- |
| `/` | the page: a table of records, with filters by source, SDK, operation, status and call, and each record's detail |
| `/api/records` | the records as JSON. Query: `source`, `sdk`, `op` (a substring), `status` (`2xx`, `4xx`, `5xx`, `failed` or a code), `call` (one call's id), `since` (a record's `seq`), `limit` |
| `/api/stream` | server-sent events: the records after `since`, or after `Last-Event-ID`, then each new one |
| `/api/sdks` | each bound SDK, with its `metrics` counters |

Everything the server writes passes through the Station's `redact()`.
A stream reader that falls more than `maxBuffered` bytes behind, 1 MiB by
default, is cut off; an `EventSource` reconnects by itself, and resumes
after the last record it read.

## A record log, and the `station-view` command

A view's records last as long as its process, and a command-line tool
that exits at once leaves nothing to look at. So a view can also append
each record to a log, and the `station-view` command serves the same page
from that log: what earlier processes wrote, then each record as it
arrives.

```ts
station.use(StationView, { log: true })    // ~/.voxgig/station-view/records.jsonl
```

| `log` | the log |
| --- | --- |
| `true` | `~/.voxgig/station-view/records.jsonl` |
| a path | that file |
| `false` | none, whatever the environment says |
| unset | `STATION_VIEW_LOG` decides: `1` or `true` for the default file, any other value for a path, and no log when it is unset or empty |

So `STATION_VIEW_LOG=1 node app.js` logs an application that loads the
view, with no change to its code.

Each record is one JSON line, passed through the Station's `redact()` and
written before the call that made it returns. The file is created
readable and writable by its owner only, in a directory only its owner
can enter. An existing file that others can read is narrowed to its
owner before it is written or moved to `.1`; a symbolic link, or a file
another user owns, is neither written to nor moved.
Each line carries `v`, the format's version, and `run` and `pid`, which
name the process that wrote it. Past 10 MiB (`logMax`), the log moves to
`<file>.1`, replacing an earlier one, and a new log starts. Two
processes that rotate at the same moment can lose the older file.

```sh
station-view [--log <file>] [--port <n>] [--host <loopback>]
```

The command reads `<file>.1`, then `<file>`, then polls for what is
appended, and serves the page and the API above, on port 8960 by default
and on loopback only. A poll that cannot read the log waits for the
next one. The command redacts nothing itself: it holds no secrets, and
the log holds only what each process already redacted. It numbers
records as it reads them, so `seq` is the command's own, and `/api/sdks`
reports `metrics` as `null`, since those counters live in a client the
command does not have. From a checkout, the command is
`typescript/bin/station-view`.

## Develop

The package is not on npm. It takes `@voxgig/station` 0.4.0 or later as
a peer dependency, the first release that carries station's extension
points, and its tests run against npm's station.

```sh
make test      # install, build, test, comment gate, stale dist/ check
```

One test drives the page in Chromium through Playwright where Playwright
is installed, and is skipped, saying so, where it is not. Set
`STATION_VIEW_SCREENSHOT=<file>` to keep a screenshot of the page.
