
import * as StationLib from '@voxgig/station'

export const FEATURES = { telemetry: {}, debug: {}, audit: {}, metrics: {}, retry: {} }

// A client as sdkgen generates one, cut down to what the view touches:
// it binds to the Station, and an operation hands its records to the
// callbacks its feature options carry, as the generated features do.
export function fakeSDK(slug: string, feature?: any) {
  const config: any = {
    main: { slug, name: slug, version: '1.0.0' },
    options: { server: {} },
    entity: { planet: { op: { list: {} } } },
    ...(null == feature ? {} : { feature }),
  }
  const seen: any[] = []
  class SDK {
    _features = [{ name: 'station' }]
    _mode = 'test'
    _metrics = { total: { count: 1, ok: 1, err: 0 } }
    feature: any
    constructor(options: any) {
      this.feature = byname(options?.feature)
      seen.push(this.feature)
      StationLib.featureBinding({
        client: this,
        utility: { fetcher: async () => ({ status: 200 }) },
        options: { feature: {} },
        config,
      }, this.feature.station)
    }
    call(op: string, status: number) {
      const t = 1_700_000_000_000
      this.feature.telemetry?.exporter?.({ traceId: 'a1', spanId: 'b2', name: op, start: t, end: t + 12, durationMs: 12, ok: status < 400 })
      this.feature.debug?.onEntry?.({ op, method: 'GET', url: 'http://api.test/api/planet?q=1', headers: {}, start: t, status, ok: status < 400, durationMs: 12 })
      this.feature.audit?.sink?.({ seq: 1, ts: t, actor: 'anonymous', entity: op.split('.')[0], op: op.split('.')[1], outcome: status < 400 ? 'ok' : 'error', status, correlationId: 'c3' })
    }
  }
  StationLib.provide(slug, { construct: (o: any) => new SDK(o), config })
  return { SDK, seen }
}

export function byname(feature: any): any {
  return Array.isArray(feature)
    ? Object.fromEntries(feature.map(({ name, ...rest }: any) => [name, rest]))
    : feature || {}
}
