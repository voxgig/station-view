import { existsSync } from 'fs'

import { makecollector } from './collect'
import { followlog, logpath, readlog } from './log'
import { listen } from './server'
import type { Listening } from './server'

export type ServeLogOptions = { log?: string, port?: number, host?: string, max?: number, every?: number }

// The page and its API over a record log rather than one process's
// records. What it serves was redacted by the process that wrote it.
export async function servelog(opts: ServeLogOptions = {}): Promise<Listening & { log: string }> {
  const log = logpath(opts.log ?? true) as string
  const collector = makecollector(opts.max ?? 10000)
  const sdks = new Map<string, string | undefined>()
  const take = (line: any) => {
    const rec = collector.logged(line)
    if (null != rec?.sdk) { sdks.set(rec.sdk, rec.api) }
  }
  if (existsSync(log + '.1')) { readlog(log + '.1', take) }
  const stop = followlog(log, take, opts.every)
  try {
    const live = await listen({
      records: collector.records,
      subscribe: collector.subscribe,
      sdks: () => Array.from(sdks, ([name, api]) => ({ name, api, metrics: null })),
      redact: (text) => text,
    }, { port: opts.port ?? 8960, host: opts.host })
    return { ...live, log, close: async () => { stop(); await live.close() } }
  }
  catch (err) {
    stop()
    throw err
  }
}

const USAGE = 'usage: station-view [--log <file>] [--port <n>] [--host <loopback>]\n'

export async function main(argv: string[]): Promise<void> {
  const opts: ServeLogOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if ('--help' === flag) { process.stdout.write(USAGE); return }
    if (!['--log', '--port', '--host'].includes(flag) || undefined === value) {
      process.stderr.write('station-view: not understood: ' + flag + '\n' + USAGE)
      process.exitCode = 2
      return
    }
    i++
    if ('--log' === flag) { opts.log = value }
    else if ('--host' === flag) { opts.host = value }
    else if (/^\d+$/.test(value) && Number(value) <= 65535) { opts.port = Number(value) }
    else { process.stderr.write('station-view: not a port: ' + value + '\n'); process.exitCode = 2; return }
  }
  const live = await servelog(opts)
  process.stderr.write('station-view: ' + live.url + ', reading ' + live.log + '\n')
  const close = () => { live.close().catch(() => undefined) }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
