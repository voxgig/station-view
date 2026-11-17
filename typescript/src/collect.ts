
export type Source = 'telemetry' | 'debug' | 'audit' | 'station'

// One thing the view saw: a span, a debug entry, an audit record, or one
// of the Station's own events. `detail` is the record as its source made
// it, which the SDK has already cleaned and the Station already scrubbed.
export type TrafficRecord = {
  seq: number
  t: number
  source: Source
  kind: string
  sdk?: string
  api?: string
  op?: string
  method?: string
  path?: string
  status?: number
  ok?: boolean
  ms?: number
  detail: any
}

export type Filter = {
  source?: string
  sdk?: string
  op?: string
  status?: string
  since?: number
  limit?: number
}

export type Watched = { name?: string, api?: string }

export type Collector = {
  add(source: Source, from: Watched, raw: any): TrafficRecord
  station(ev: any): TrafficRecord
  records(filter?: Filter): TrafficRecord[]
  subscribe(fn: (rec: TrafficRecord) => void): () => void
  dropped(): number
}

export function makecollector(max = 1000): Collector {
  const ring: TrafficRecord[] = []
  const subs = new Set<(rec: TrafficRecord) => void>()
  let seq = 0
  let dropped = 0

  function keep(rec: Omit<TrafficRecord, 'seq'>): TrafficRecord {
    const out = { seq: ++seq, ...rec }
    ring.push(out)
    if (max < ring.length) {
      dropped += ring.splice(0, ring.length - max).length
    }
    for (const fn of subs) {
      try { fn(out) }
      catch (_err) { /* a subscriber does not stop the others */ }
    }
    return out
  }

  return {
    add(source, from, raw) {
      return keep({ ...normalize(source, raw), sdk: from.name, api: from.api, detail: raw })
    },

    station(ev) {
      const http = ev?.http || {}
      return keep({
        t: num(ev?.t) ?? Date.now(),
        source: 'station',
        kind: String(ev?.kind ?? ''),
        sdk: ev?.plugin,
        api: ev?.api,
        op: ev?.op,
        method: http.method,
        path: http.path,
        status: num(http.status),
        ok: null == http.status ? undefined : 0 < http.status && http.status < 400,
        ms: num(http.durationMs),
        detail: ev,
      })
    },

    records: (filter) => select(ring, filter || {}),

    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },

    dropped: () => dropped,
  }
}

function normalize(source: Source, raw: any): Omit<TrafficRecord, 'seq' | 'sdk' | 'api' | 'detail'> {
  if ('telemetry' === source) {
    return {
      t: num(raw?.start) ?? Date.now(), source, kind: 'span',
      op: raw?.name, ok: raw?.ok, ms: num(raw?.durationMs),
    }
  }
  if ('debug' === source) {
    return {
      t: num(raw?.start) ?? Date.now(), source, kind: 'call',
      op: raw?.op, method: raw?.method, path: pathof(raw?.url),
      status: num(raw?.status), ok: raw?.ok, ms: num(raw?.durationMs),
    }
  }
  return {
    t: num(raw?.ts) ?? Date.now(), source, kind: 'audit',
    op: null == raw?.entity ? raw?.op : raw.entity + '.' + raw.op,
    status: num(raw?.status), ok: null == raw?.outcome ? undefined : 'error' !== raw.outcome,
  }
}

export function select(records: TrafficRecord[], filter: Filter): TrafficRecord[] {
  const out = records.filter((rec) =>
    (null == filter.source || '' === filter.source || filter.source === rec.source) &&
    (null == filter.sdk || '' === filter.sdk || filter.sdk === rec.sdk) &&
    (null == filter.op || '' === filter.op || String(rec.op ?? '').includes(filter.op)) &&
    (null == filter.since || filter.since < rec.seq) &&
    statusmatch(filter.status, rec))
  const limit = null == filter.limit ? out.length : Math.max(0, filter.limit)
  return out.slice(Math.max(0, out.length - limit))
}

function statusmatch(want: string | undefined, rec: TrafficRecord): boolean {
  if (null == want || '' === want) { return true }
  if ('failed' === want) { return false === rec.ok }
  const cls = /^([1-5])xx$/.exec(want)
  if (null != cls) { return null != rec.status && cls[1] === String(rec.status)[0] }
  return String(rec.status) === want
}

function pathof(url: any): string | undefined {
  if ('string' !== typeof url) { return undefined }
  try { return new URL(url).pathname }
  catch (_err) { return url }
}

function num(v: any): number | undefined {
  return 'number' === typeof v && Number.isFinite(v) ? v : undefined
}
