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
- the record itself, as the SDK cleaned it.

The view keeps the newest 1000. `use(StationView, { max, features })`
changes the count, and which of the four features it switches on.

## The page and its API

`listen({ port, host })` serves on loopback only: `127.0.0.1` by default,
or `localhost` or `::1`. Port 0, the default, takes a free port. It is
read-only, and answers only a request whose `Host` names the loopback
address it listens on.

| path | answers |
| --- | --- |
| `/` | the page: a table of records, with filters by source, SDK, operation and status, and each record's detail |
| `/api/records` | the records as JSON. Query: `source`, `sdk`, `op` (a substring), `status` (`2xx`, `4xx`, `5xx`, `failed` or a code), `since` (a record's `seq`), `limit` |
| `/api/stream` | server-sent events: the records after `since`, or after `Last-Event-ID`, then each new one |
| `/api/sdks` | each bound SDK, with its `metrics` counters |

Everything the server writes passes through the Station's `redact()`.

## Develop

The package is not on npm. It takes `@voxgig/station` as a peer
dependency, at the version that carries station's extension points. The
tests run against a voxgig/station checkout, `STATION_HOME` or a sibling
`../station`, which `make build` links into `node_modules`; build that
checkout first.

```sh
make test      # install, link station, build, test, comment gate, stale dist/ check
```

One test drives the page in Chromium through Playwright where Playwright
is installed, and is skipped, saying so, where it is not. Set
`STATION_VIEW_SCREENSHOT=<file>` to keep a screenshot of the page.
