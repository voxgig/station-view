
import { BOUND_POINT, FEATURE_POINT, withfeature } from '@voxgig/station'

import { makecollector, select } from './collect'
import type { Filter, Source, TrafficRecord } from './collect'
import { listen } from './server'
import type { Listening, ListenOptions } from './server'

export { select }
export type { Filter, Listening, ListenOptions, Source, TrafficRecord }

// The slice of a voxgig/station Station that the view reads.
export type StationLike = {
  status(): { mode: string, profile: string, events: { buffered: number, dropped: number } }
  instances(): { name: string, api: string, active: boolean }[]
  events(): any[]
  tap(fn: (ev: any) => void): () => void
  redact(text: string): string
}

export type BoundSdk = { name: string, api: string, descriptor: any, client: any }

export type ViewOptions = { max?: number, features?: string[] }

export type View = {
  records(filter?: Filter): TrafficRecord[]
  sdks(): { name: string, api: string, metrics: any }[]
  snapshot(): {
    mode: string
    profile: string
    instances: { name: string, api: string, active: boolean }[]
    records: number
    dropped: number
  }
  listen(opts?: ListenOptions): Promise<Listening>
  follow(): () => void
}

// The sdkgen features the view switches on, and the option each one
// hands its records to.
const CALLBACK: { [feature: string]: string | undefined } = {
  telemetry: 'exporter',
  debug: 'onEntry',
  audit: 'sink',
  metrics: undefined,
}

export function makeview(station: StationLike, options: ViewOptions = {}): View & {
  watch(feature: any, info: any): any
  bound(sdk: BoundSdk): void
} {
  const collector = makecollector(options.max ?? 1000)
  const features = (options.features ?? Object.keys(CALLBACK)).filter((f) => f in CALLBACK)
  const bound: BoundSdk[] = []

  const view = {
    records: (filter?: Filter) => collector.records(filter),

    sdks: () => bound.map((sdk) => ({
      name: sdk.name, api: sdk.api, metrics: sdk.client?._metrics ?? null,
    })),

    snapshot() {
      const status = station.status()
      return {
        mode: status.mode,
        profile: status.profile,
        instances: station.instances().map((i) => ({ name: i.name, api: i.api, active: i.active })),
        records: collector.records().length,
        dropped: collector.dropped(),
      }
    },

    listen: (opts?: ListenOptions) => listen({
      records: collector.records,
      subscribe: collector.subscribe,
      sdks: view.sdks,
      redact: (text) => station.redact(text),
    }, opts),

    // The Station's own events, those already buffered first.
    follow() {
      for (const ev of station.events()) { collector.station(ev) }
      return station.tap((ev) => { collector.station(ev) })
    },

    watch(feature: any, info: any) {
      let out = feature
      for (const name of features) {
        const key = CALLBACK[name]
        const entry: any = { active: true }
        if (undefined !== key) {
          entry[key] = (raw: any) => { collector.add(name as Source, info, raw) }
        }
        out = withfeature(out, name, entry, info?.descriptor)
      }
      return out
    },

    bound(sdk: BoundSdk) { bound.push(sdk) },
  }
  return view
}

// A voxgig/plugin definition. A Station loads it only when handed it:
// `station.use(StationView, { max, features })`, then
// `station.extension('view/view')`.
export const StationView = {
  name: 'view',
  define(inst: any): void {
    const view = makeview(inst.host().exports('station/station'), inst.options || {})
    inst.bind(FEATURE_POINT, (next: any, feature: any, info: any) => next(view.watch(feature, info), info))
    inst.bind(BOUND_POINT, (sdk: BoundSdk) => view.bound(sdk))
    inst.export('view', view)
  },
  activate(inst: any): void {
    inst.release(inst.host().exports('view/view').follow())
  },
}
