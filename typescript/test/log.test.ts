import { beforeEach, test } from 'node:test'
import * as Assert from 'node:assert'
import * as Fs from 'node:fs'
import { request } from 'node:http'
import * as Os from 'node:os'
import * as Path from 'node:path'

import * as StationLib from '@voxgig/station'
import { Station } from '@voxgig/station'

import { StationView, defaultlog, logpath, servelog } from '../src'
import type { TrafficRecord } from '../src'
import { makelog } from '../src/log'

import { FEATURES, fakeSDK } from './support'

beforeEach(() => StationLib.resetFactories())

function tmplog(): { dir: string, log: string } {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'station-view-log-'))
  return { dir, log: Path.join(dir, 'view', 'records.jsonl') }
}

function lines(log: string): any[] {
  return Fs.readFileSync(log, 'utf8').split('\n').filter((l) => '' !== l).map((l) => JSON.parse(l))
}

// A process that calls its SDK and logs what the view saw. Each run
// stands for its own process, so it registers its own build of the SDK.
function run(log: string, instance: string, redact?: (text: string) => string): Station {
  StationLib.resetFactories()
  const full = fakeSDK('solar', FEATURES)
  const st = new Station({ config: null, proxy: 'off', load: false })
  if (null != redact) {
    const own = st.redact.bind(st)
    st.redact = (text: string) => redact(own(text))
  }
  st.use(StationView, { log })
  const client = st.connect(full.SDK, { instance })
  client.call('planet.list', 200)
  client.call('planet.list', 503)
  return st
}

function rec(i: number): TrafficRecord {
  return { seq: i, t: i, source: 'debug', kind: 'call', sdk: 'solar', op: 'planet.list', detail: { i } }
}

function get(port: number, path: string): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: '127.0.0.1:' + port } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function until(what: string, check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) { return }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('waited too long for ' + what)
}

test('a view with a log appends each record, redacted, to a file only its owner can read', () => {
  const { dir, log } = tmplog()
  try {
    const st = run(log, 'solar$a', (text) => text.replace(/q=1/g, 'q=[redacted]'))
    Assert.strictEqual(st.extension('view/view').logfile(), log)
    st.close()

    const written = lines(log)
    Assert.deepStrictEqual(written.map((l) => l.source).filter((s) => 'station' !== s).sort(),
      ['audit', 'audit', 'debug', 'debug', 'telemetry', 'telemetry'])
    for (const line of written) {
      Assert.strictEqual(line.v, 1)
      Assert.match(line.run, /^[0-9a-f]{12}$/)
      Assert.strictEqual(line.pid, process.pid)
      Assert.strictEqual(line.seq, undefined)
    }
    Assert.strictEqual(new Set(written.map((l) => l.run)).size, 1)
    const text = Fs.readFileSync(log, 'utf8')
    Assert.ok(text.includes('q=[redacted]'))
    Assert.ok(!text.includes('q=1'))
    if ('win32' !== process.platform) {
      Assert.strictEqual(Fs.statSync(log).mode & 0o777, 0o600)
      Assert.strictEqual(Fs.statSync(Path.dirname(log)).mode & 0o777, 0o700)
    }
  }
  finally {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the command serves a log\'s history, then each record another process appends', async () => {
  const { dir, log } = tmplog()
  try {
    run(log, 'solar$a').close()
    const before = lines(log).length

    const live = await servelog({ log, port: 0, every: 10 })
    try {
      const records = async () => JSON.parse((await get(live.port, '/api/records')).body)
      Assert.strictEqual((await records()).length, before)

      run(log, 'solar$b').close()
      await until('the second process\'s records', async () => 2 * before === (await records()).length)
      const all = await records()
      Assert.deepStrictEqual(Array.from(new Set(all.map((r: any) => r.sdk))), ['solar$a', 'solar$b'])
      Assert.strictEqual(new Set(all.map((r: any) => r.run)).size, 2)
      Assert.deepStrictEqual(all.map((r: any) => r.seq), all.map((_r: any, i: number) => i + 1))
      Assert.deepStrictEqual(JSON.parse((await get(live.port, '/api/sdks')).body),
        [{ name: 'solar$a', api: 'solar', metrics: null }, { name: 'solar$b', api: 'solar', metrics: null }])
      Assert.strictEqual((await get(live.port, '/')).status, 200)
    }
    finally {
      await live.close()
    }
  }
  finally {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a log past its size moves to .1, and the command reads both', async () => {
  const { dir, log } = tmplog()
  try {
    const writer = makelog(log, (text) => text, 600)
    for (let i = 0; i < 12; i++) { writer.write(rec(i)) }
    Assert.ok(Fs.existsSync(log + '.1'))
    const kept = lines(log + '.1').length + lines(log).length
    Assert.ok(0 < kept && kept <= 12)

    const live = await servelog({ log, port: 0, every: 10 })
    try {
      Assert.strictEqual(JSON.parse((await get(live.port, '/api/records')).body).length, kept)
    }
    finally {
      await live.close()
    }
  }
  finally {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the command follows a log across its rotation, and misses nothing written just before it', async () => {
  const { dir, log } = tmplog()
  try {
    const writer = makelog(log, (text) => text, 600)
    writer.write(rec(0))
    const live = await servelog({ log, port: 0, every: 10 })
    try {
      const seen = async () => JSON.parse((await get(live.port, '/api/records')).body).map((r: any) => r.detail.i)
      Assert.deepStrictEqual(await seen(), [0])

      // No poll runs inside this loop, so the lines before the rotation
      // are read from the moved file or not at all.
      let i = 1
      while (!Fs.existsSync(log + '.1')) { writer.write(rec(i++)) }
      writer.write(rec(i++))
      Assert.ok(2 < i)
      const all = Array.from({ length: i }, (_v, n) => n)
      await until('every record', async () => all.length === (await seen()).length)
      Assert.deepStrictEqual(await seen(), all)
    }
    finally {
      await live.close()
    }
  }
  finally {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a log others can read is narrowed to its owner, and a link or another user\'s file is not written',
  { skip: 'win32' === process.platform }, () => {
    const { dir, log } = tmplog()
    try {
      Fs.mkdirSync(Path.dirname(log), { recursive: true })
      Fs.writeFileSync(log, '')
      Fs.chmodSync(log, 0o644)
      makelog(log, (text) => text).write(rec(1))
      Assert.strictEqual(Fs.statSync(log).mode & 0o777, 0o600)
      Assert.deepStrictEqual(lines(log).map((l) => l.detail.i), [1])

      const target = Path.join(dir, 'elsewhere.txt')
      Fs.writeFileSync(target, '')
      const linked = Path.join(dir, 'linked.jsonl')
      Fs.symlinkSync(target, linked)
      makelog(linked, (text) => text).write(rec(2))
      Assert.strictEqual(Fs.readFileSync(target, 'utf8'), '')

      if (0 === process.getuid?.()) {
        const theirs = Path.join(dir, 'theirs.jsonl')
        Fs.writeFileSync(theirs, '')
        Fs.chownSync(theirs, 12345, 12345)
        makelog(theirs, (text) => text).write(rec(3))
        Assert.strictEqual(Fs.readFileSync(theirs, 'utf8'), '')
      }
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })

test('a log is checked before it rotates: a readable one is narrowed first, another user\'s is not moved',
  { skip: 'win32' === process.platform }, () => {
    const { dir, log } = tmplog()
    const full = 'x'.repeat(590) + '\n'
    try {
      Fs.mkdirSync(Path.dirname(log), { recursive: true })
      Fs.writeFileSync(log, full)
      Fs.chmodSync(log, 0o644)
      makelog(log, (text) => text, 600).write(rec(1))
      Assert.strictEqual(Fs.readFileSync(log + '.1', 'utf8'), full)
      Assert.strictEqual(Fs.statSync(log + '.1').mode & 0o777, 0o600)
      Assert.deepStrictEqual(lines(log).map((l) => l.detail.i), [1])

      if (0 === process.getuid?.()) {
        const theirs = Path.join(dir, 'theirs.jsonl')
        Fs.writeFileSync(theirs, full)
        Fs.chownSync(theirs, 12345, 12345)
        makelog(theirs, (text) => text, 600).write(rec(2))
        Assert.strictEqual(Fs.existsSync(theirs + '.1'), false)
        Assert.strictEqual(Fs.readFileSync(theirs, 'utf8'), full)
      }
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })

test('the command outlasts a log it cannot read, and reads the one that replaces it', async () => {
  const { dir, log } = tmplog()
  try {
    const writer = makelog(log, (text) => text)
    writer.write(rec(0))
    const live = await servelog({ log, port: 0, every: 10 })
    try {
      const seen = async () => JSON.parse((await get(live.port, '/api/records')).body).map((r: any) => r.detail.i)
      Assert.deepStrictEqual(await seen(), [0])

      Fs.renameSync(log, log + '.away')
      Fs.mkdirSync(log)
      await new Promise((resolve) => setTimeout(resolve, 100))
      Fs.rmdirSync(log)
      writer.write(rec(1))
      await until('the record in the replacement', async () => 2 === (await seen()).length)
      Assert.deepStrictEqual(await seen(), [0, 1])
    }
    finally {
      await live.close()
    }
  }
  finally {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the log is named by the option, else by STATION_VIEW_LOG, and is off by default', () => {
  Assert.strictEqual(logpath(undefined, {}), undefined)
  Assert.strictEqual(logpath(false, { STATION_VIEW_LOG: '/tmp/x.jsonl' }), undefined)
  Assert.strictEqual(logpath('/tmp/a.jsonl', { STATION_VIEW_LOG: '/tmp/x.jsonl' }), '/tmp/a.jsonl')
  Assert.strictEqual(logpath(undefined, { STATION_VIEW_LOG: '/tmp/x.jsonl' }), '/tmp/x.jsonl')
  Assert.strictEqual(logpath(true, {}), defaultlog())
  Assert.strictEqual(logpath(undefined, { STATION_VIEW_LOG: '1' }), defaultlog())
  Assert.ok(defaultlog().startsWith(Os.homedir()))
})
