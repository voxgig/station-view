
import { beforeEach, test } from 'node:test'
import * as Assert from 'node:assert'
import { request } from 'node:http'
import * as Net from 'node:net'

import * as StationLib from '@voxgig/station'
import { Station } from '@voxgig/station'

import { StationView, select } from '../src'
import { hostok, listen, outbox } from '../src/server'

import { FEATURES, fakeSDK } from './support'

beforeEach(() => StationLib.resetFactories())


function station(): Station {
  return new Station({ config: null, proxy: 'off', load: false })
}

function get(port: number, path: string, host = '127.0.0.1:' + port, method = 'GET'):
  Promise<{ status: number, headers: any, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('the view switches its features on in an SDK that has them, and in no other', () => {
  const full = fakeSDK('solar', FEATURES)
  const bare = fakeSDK('plain', { retry: {} })
  const st = station().use(StationView)
  st.connect(full.SDK, { instance: 'solar$a' })
  st.connect(bare.SDK, { instance: 'plain$a' })

  const got = full.seen[0]
  Assert.strictEqual(got.telemetry.active, true)
  Assert.strictEqual(typeof got.telemetry.exporter, 'function')
  Assert.strictEqual(typeof got.debug.onEntry, 'function')
  Assert.strictEqual(typeof got.audit.sink, 'function')
  Assert.deepStrictEqual(got.metrics, { active: true })
  Assert.strictEqual(got.retry, undefined)
  Assert.deepStrictEqual(Object.keys(bare.seen[0]), ['station'])
  st.close()
})

test('each call is a record from each source, labelled with its client', () => {
  const full = fakeSDK('solar', FEATURES)
  const st = station().use(StationView)
  const client = st.connect(full.SDK, { instance: 'solar$a' })
  client.call('planet.list', 200)
  client.call('planet.list', 503)
  const view = st.extension('view/view')

  const calls = view.records({ source: 'debug' })
  Assert.deepStrictEqual(calls.map((r: any) => [r.sdk, r.api, r.op, r.method, r.path, r.status, r.ok, r.ms]), [
    ['solar$a', 'solar', 'planet.list', 'GET', '/api/planet', 200, true, 12],
    ['solar$a', 'solar', 'planet.list', 'GET', '/api/planet', 503, false, 12],
  ])
  Assert.deepStrictEqual(view.records({ source: 'telemetry' }).map((r: any) => [r.op, r.ok]),
    [['planet.list', true], ['planet.list', false]])
  Assert.deepStrictEqual(view.records({ source: 'audit' }).map((r: any) => [r.op, r.status, r.ok]),
    [['planet.list', 200, true], ['planet.list', 503, false]])
  Assert.ok(view.records({ source: 'station' }).some((r: any) => 'construct' === r.kind && 'solar$a' === r.sdk))
  Assert.deepStrictEqual(view.sdks(), [{ name: 'solar$a', api: 'solar', metrics: { total: { count: 1, ok: 1, err: 0 } } }])
  st.close()
})

test('records filter by source, client, operation, status class and sequence', () => {
  const base = { t: 0, kind: 'call', detail: {} }
  const recs: any[] = [
    { ...base, seq: 1, source: 'debug', sdk: 'a', op: 'planet.list', status: 200, ok: true },
    { ...base, seq: 2, source: 'debug', sdk: 'b', op: 'moon.load', status: 404, ok: false },
    { ...base, seq: 3, source: 'audit', sdk: 'a', op: 'planet.load', status: 503, ok: false },
    { ...base, seq: 4, source: 'telemetry', sdk: 'a', op: 'planet.list', ok: true },
  ]
  const seqs = (f: any) => select(recs, f).map((r) => r.seq)
  Assert.deepStrictEqual(seqs({ source: 'debug' }), [1, 2])
  Assert.deepStrictEqual(seqs({ sdk: 'a' }), [1, 3, 4])
  Assert.deepStrictEqual(seqs({ op: 'planet' }), [1, 3, 4])
  Assert.deepStrictEqual(seqs({ status: '4xx' }), [2])
  Assert.deepStrictEqual(seqs({ status: '503' }), [3])
  Assert.deepStrictEqual(seqs({ status: 'failed' }), [2, 3])
  Assert.deepStrictEqual(seqs({ since: 2 }), [3, 4])
  Assert.deepStrictEqual(seqs({ limit: 2 }), [3, 4])
})

test('the view keeps the newest records, counts what it dropped, and switches on only what it is asked', () => {
  const full = fakeSDK('solar', FEATURES)
  const st = station().use(StationView, { max: 3, features: ['debug'] })
  const client = st.connect(full.SDK, { instance: 'solar$a' })
  for (let i = 0; i < 5; i++) { client.call('planet.list', 200) }
  const view = st.extension('view/view')

  Assert.deepStrictEqual(Object.keys(full.seen[0]).sort(), ['debug', 'station'])
  Assert.strictEqual(view.records().length, 3)
  Assert.ok(view.records().every((r: any) => 'debug' === r.source))
  Assert.strictEqual(view.snapshot().dropped, view.records()[0].seq - 1)
  st.close()
})

test('the page and the API are served on loopback, read-only, to a loopback Host only', async () => {
  const full = fakeSDK('solar', FEATURES)
  const st = station()
  const redact = st.redact.bind(st)
  st.redact = (text: string) => redact(text).replace(/q=1/g, 'q=[redacted]')
  st.use(StationView)
  st.connect(full.SDK, { instance: 'solar$a' }).call('planet.list', 200)
  const view = st.extension('view/view')
  const live = await view.listen()

  try {
    Assert.match(live.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const pagehit = await get(live.port, '/')
    Assert.strictEqual(pagehit.status, 200)
    const nonce = /script-src 'nonce-([^']+)'/.exec(pagehit.headers['content-security-policy'])?.[1]
    Assert.ok(nonce && pagehit.body.includes('<script nonce="' + nonce + '">'))

    const calls = await get(live.port, '/api/records?source=debug')
    const parsed = JSON.parse(calls.body)
    Assert.deepStrictEqual(parsed.map((r: any) => r.status), [200])
    Assert.strictEqual(parsed[0].detail.url, 'http://api.test/api/planet?q=[redacted]')

    Assert.strictEqual(JSON.parse((await get(live.port, '/api/sdks')).body)[0].name, 'solar$a')
    Assert.strictEqual((await get(live.port, '/api/records', undefined, 'POST')).status, 405)
    Assert.strictEqual((await get(live.port, '/nothing')).status, 404)
    Assert.strictEqual((await get(live.port, '/', 'evil.test:' + live.port)).status, 403)
    Assert.strictEqual((await get(live.port, '/', 'localhost:' + live.port)).status, 200)
    await Assert.rejects(view.listen({ host: '0.0.0.0' }), /loopback only/)
  }
  finally {
    await live.close()
    st.close()
    StationLib.resetFactories()
  }
})

test('the stream sends the records after the one asked for, then each new one', async () => {
  const full = fakeSDK('solar', FEATURES)
  const st = station().use(StationView, { features: ['debug'] })
  const client = st.connect(full.SDK, { instance: 'solar$a' })
  client.call('planet.list', 200)
  const view = st.extension('view/view')
  const first = view.records({ source: 'debug' })[0].seq
  const live = await view.listen()

  const events: any[] = []
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: live.port, path: '/api/stream?since=' + first,
      headers: { host: '127.0.0.1:' + live.port } }, (res) => {
      Assert.strictEqual(res.headers['content-type'], 'text/event-stream')
      let pending = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        pending += chunk
        const parts = pending.split('\n\n')
        pending = parts.pop() as string
        for (const part of parts) {
          const data = part.split('\n').find((l) => l.startsWith('data: '))
          if (data) { events.push(JSON.parse(data.slice(6))) }
        }
        if (2 === events.length) { req.destroy(); resolve() }
      })
      setTimeout(() => client.call('planet.list', 404), 20)
      setTimeout(() => client.call('planet.list', 500), 40)
    })
    req.on('error', (err: any) => ('ECONNRESET' === err.code ? resolve() : reject(err)))
    req.end()
  })

  Assert.deepStrictEqual(events.map((e) => e.status), [404, 500])
  Assert.ok(events.every((e) => first < e.seq))
  await live.close()
  st.close()
})

// A feed the server tests drive directly, counting live subscriptions.
function feedof(records: any[] = []) {
  const subs = new Set<(rec: any) => void>()
  return {
    subs,
    feed: {
      records: (filter: any = {}) => records.filter((r) => null == filter.since || filter.since < r.seq),
      subscribe: (fn: (rec: any) => void) => { subs.add(fn); return () => { subs.delete(fn) } },
      sdks: () => [],
      redact: (text: string) => text,
    },
  }
}

function raw(port: number, text: string, pause = false): Promise<{ head: string, closed: Promise<void>, socket: Net.Socket }> {
  return new Promise((resolve) => {
    const socket = Net.connect(port, '127.0.0.1', () => socket.write(text))
    let got = ''
    const closed = new Promise<void>((done) => socket.on('close', () => done()))
    socket.once('data', (d) => {
      got += d.toString('utf8')
      if (pause) { socket.pause() }
      resolve({ head: got.split('\r\n')[0], closed, socket })
    })
  })
}

test('a request target that does not parse is a 400, and the server stays up', async () => {
  const { feed } = feedof()
  const live = await listen(feed)
  try {
    const bad = await raw(live.port, 'GET // HTTP/1.1\r\nHost: 127.0.0.1:' + live.port + '\r\n\r\n')
    Assert.strictEqual(bad.head, 'HTTP/1.1 400 Bad Request')
    bad.socket.destroy()
    Assert.strictEqual((await get(live.port, '/api/sdks')).status, 200)
  }
  finally { await live.close() }
})

test('HEAD on the stream answers with its headers and opens no subscription', async () => {
  const { feed, subs } = feedof()
  const live = await listen(feed)
  try {
    const head = await get(live.port, '/api/stream', undefined, 'HEAD')
    Assert.strictEqual(head.status, 200)
    Assert.strictEqual(head.headers['content-type'], 'text/event-stream')
    Assert.strictEqual(subs.size, 0)
  }
  finally { await live.close() }
})

test('a stream reader that stops reading is cut off once its unsent output passes the bound', async () => {
  const { feed, subs } = feedof()
  const live = await listen(feed, { maxBuffered: 64 * 1024 })
  try {
    const reader = await raw(live.port,
      'GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1:' + live.port + '\r\n\r\n', true)
    Assert.strictEqual(reader.head, 'HTTP/1.1 200 OK')
    Assert.strictEqual(subs.size, 1)
    const big = 'x'.repeat(16 * 1024)
    for (let seq = 1; seq <= 2000 && 0 < subs.size; seq++) {
      for (const fn of [...subs]) { fn({ seq, detail: big }) }
    }
    Assert.strictEqual(subs.size, 0, 'the subscription is released')
    reader.socket.resume()
    await reader.closed
  }
  finally { await live.close() }
})

test('a reader that keeps reading gets the whole backlog, however large', async () => {
  const big = 'x'.repeat(2048)
  const { feed } = feedof(Array.from({ length: 1000 }, (_, i) => ({ seq: i + 1, detail: big })))
  const live = await listen(feed)
  try {
    const seqs: number[] = await new Promise((resolve, reject) => {
      const got: number[] = []
      const req = request({ host: '127.0.0.1', port: live.port, path: '/api/stream?since=0',
        headers: { host: '127.0.0.1:' + live.port } }, (res) => {
        res.setEncoding('utf8')
        let pending = ''
        res.on('data', (chunk) => {
          pending += chunk
          const frames = pending.split('\n\n')
          pending = frames.pop() as string
          for (const f of frames) {
            const id = /^id: (\d+)$/m.exec(f)
            if (id) { got.push(Number(id[1])) }
          }
          if (1000 === got.length) { req.destroy(); resolve(got) }
        })
      })
      req.on('error', (err: any) => ('ECONNRESET' === err.code && 1000 === got.length ? resolve(got) : reject(err)))
      req.end()
    })
    Assert.deepStrictEqual(seqs, Array.from({ length: 1000 }, (_, i) => i + 1))
  }
  finally { await live.close() }
})

test('a stream reader\'s outbox lets go of its backlog as it is written, and counts bytes', () => {
  const box = outbox(['a', 'b', 'c'])
  Assert.strictEqual(box.held(), 3)
  Assert.deepStrictEqual([box.take(), box.take()], ['a', 'b'])
  Assert.strictEqual(box.take(), 'c')
  Assert.strictEqual(box.held(), 0)
  Assert.strictEqual(box.take(), undefined)

  const wide = '\u6f22'.repeat(50000)
  Assert.strictEqual(box.push(wide), 150000)
  Assert.strictEqual(box.push('ab'), 150002)
  Assert.strictEqual(box.take(), wide)
  Assert.strictEqual(box.push('c'), 3)
  Assert.strictEqual(box.held(), 2)
})

test('a Host may leave the port out only when it is HTTP\'s own', () => {
  Assert.strictEqual(hostok({ headers: { host: '127.0.0.1' } }, 80), true)
  Assert.strictEqual(hostok({ headers: { host: '[::1]' } }, 80), true)
  Assert.strictEqual(hostok({ headers: { host: 'localhost:80' } }, 80), true)
  Assert.strictEqual(hostok({ headers: { host: '127.0.0.1' } }, 8080), false)
  Assert.strictEqual(hostok({ headers: { host: 'evil.test' } }, 80), false)
  Assert.strictEqual(hostok({ headers: { host: '[::1]:8080' } }, 8080), true)
})
