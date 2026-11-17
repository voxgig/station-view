
import { randomBytes } from 'crypto'
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'

import type { Filter, TrafficRecord } from './collect'
import { page } from './page'

// What the server reads: the records, new ones as they come, the SDKs
// bound, and the Station's redaction for everything it writes out.
export type Feed = {
  records(filter?: Filter): TrafficRecord[]
  subscribe(fn: (rec: TrafficRecord) => void): () => void
  sdks(): any[]
  redact(text: string): string
}

export type Listening = { url: string, port: number, close(): Promise<void> }

export type ListenOptions = { port?: number, host?: string }

const LOOPBACK = ['127.0.0.1', 'localhost', '::1']

// A loopback server, read-only. It answers only a Host it is reachable
// as, so a page elsewhere cannot rebind a name onto it.
export function listen(feed: Feed, opts: ListenOptions = {}): Promise<Listening> {
  const host = opts.host ?? '127.0.0.1'
  if (!LOOPBACK.includes(host)) {
    return Promise.reject(new Error('station-view listens on loopback only, not ' + host))
  }

  const streams = new Set<ServerResponse>()
  let port = 0

  const server = createServer((req, res) => {
    if (!hostok(req, port)) { return send(res, 403, 'text/plain', 'forbidden host\n') }
    if ('GET' !== req.method && 'HEAD' !== req.method) {
      res.setHeader('Allow', 'GET, HEAD')
      return send(res, 405, 'text/plain', 'read-only\n')
    }
    const url = new URL(req.url || '/', 'http://localhost')
    if ('/' === url.pathname) {
      const nonce = randomBytes(16).toString('base64')
      res.setHeader('Content-Security-Policy',
        "default-src 'none'; connect-src 'self'; script-src 'nonce-" + nonce +
        "'; style-src 'nonce-" + nonce + "'")
      return send(res, 200, 'text/html; charset=utf-8', page(nonce))
    }
    if ('/api/records' === url.pathname) {
      return send(res, 200, 'application/json',
        feed.redact(JSON.stringify(feed.records(filterof(url)))))
    }
    if ('/api/sdks' === url.pathname) {
      return send(res, 200, 'application/json', feed.redact(JSON.stringify(feed.sdks())))
    }
    if ('/api/stream' === url.pathname) {
      return stream(req, res, url)
    }
    return send(res, 404, 'text/plain', 'not found\n')
  })

  function stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.write(': open\n\n')
    const out = (rec: any) =>
      res.write('id: ' + rec.seq + '\ndata: ' + feed.redact(JSON.stringify(rec)) + '\n\n')
    const since = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0)
    for (const rec of feed.records({ since: Number.isFinite(since) ? since : 0 })) { out(rec) }
    const stop = feed.subscribe(out)
    streams.add(res)
    req.on('close', () => { stop(); streams.delete(res) })
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      const addr: any = server.address()
      port = addr.port
      const shown = addr.family === 'IPv6' || 6 === addr.family ? '[' + addr.address + ']' : addr.address
      resolve({
        url: 'http://' + shown + ':' + port + '/',
        port,
        close: () => new Promise<void>((done) => {
          for (const res of streams) { res.end() }
          server.close(() => done())
          server.closeAllConnections?.()
        }),
      })
    })
  })
}

function hostok(req: IncomingMessage, port: number): boolean {
  const given = String(req.headers.host ?? '')
  return LOOPBACK.some((name) => given === name + ':' + port || given === '[' + name + ']:' + port)
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function filterof(url: URL): Filter {
  const q = url.searchParams
  const num = (name: string) => null == q.get(name) ? undefined : Number(q.get(name))
  return {
    source: q.get('source') ?? undefined,
    sdk: q.get('sdk') ?? undefined,
    op: q.get('op') ?? undefined,
    status: q.get('status') ?? undefined,
    since: num('since'),
    limit: num('limit'),
  }
}
