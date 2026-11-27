import { randomBytes } from 'crypto'
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, mkdirSync, openSync, readSync, renameSync,
  statSync, writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

import type { TrafficRecord } from './collect'

export const LOG_VERSION = 1
export const MAX_LOG_BYTES = 10 << 20

export function defaultlog(): string {
  return join(homedir(), '.voxgig', 'station-view', 'records.jsonl')
}

// `true` names the default log, and a string names a file. Left unset,
// STATION_VIEW_LOG decides, so an application can be watched unchanged.
export function logpath(option?: string | boolean, env: { [key: string]: string | undefined } = process.env):
  string | undefined {
  if (false === option) { return undefined }
  if ('string' === typeof option && '' !== option) { return option }
  if (true === option) { return defaultlog() }
  const named = env.STATION_VIEW_LOG
  if (null == named || '' === named) { return undefined }
  return '1' === named || 'true' === named ? defaultlog() : named
}

export type LogWriter = { path: string, run: string, write(rec: TrafficRecord): void }

// One JSON line per record, written before the call that made it returns,
// so a process that exits at once has already left its records.
export function makelog(path: string, redact: (text: string) => string, maxBytes = MAX_LOG_BYTES): LogWriter {
  const run = randomBytes(6).toString('hex')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  return {
    path,
    run,
    write(rec) {
      const { seq: _seq, ...rest } = rec
      const line = redact(JSON.stringify({ v: LOG_VERSION, run, pid: process.pid, ...rest })) + '\n'
      try {
        const size = existsSync(path) ? statSync(path).size : 0
        if (0 < size && maxBytes < size + Buffer.byteLength(line)) { renameSync(path, path + '.1') }
        append(path, line)
      }
      catch (_err) { /* a log that cannot be written never fails the call */ }
    },
  }
}

const APPEND = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)

// The log may sit in a shared directory, so a link is refused, a file
// another user owns is left alone, and one others can read is narrowed.
function append(path: string, line: string): void {
  const fd = openSync(path, APPEND, 0o600)
  try {
    if ('win32' !== process.platform) {
      const st = fstatSync(fd)
      if (null != process.getuid && st.uid !== process.getuid()) { return }
      if (0 !== (st.mode & 0o077)) { fchmodSync(fd, 0o600) }
    }
    writeFileSync(fd, line)
  }
  finally {
    closeSync(fd)
  }
}

// The complete lines from `from` on, and the byte offset after the last.
function linesfrom(path: string, from: number, size: number): { lines: string[], next: number } {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(size - from)
    const got = readSync(fd, buf, 0, buf.length, from)
    const last = buf.subarray(0, got).lastIndexOf(0x0a)
    if (last < 0) { return { lines: [], next: from } }
    return { lines: buf.subarray(0, last).toString('utf8').split('\n'), next: from + last + 1 }
  }
  finally {
    closeSync(fd)
  }
}

function parse(lines: string[], take: (rec: any) => void): void {
  for (const line of lines) {
    if ('' === line) { continue }
    try { take(JSON.parse(line)) }
    catch (_err) { /* a torn or foreign line is skipped */ }
  }
}

export function readlog(path: string, take: (rec: any) => void): void {
  if (!existsSync(path)) { return }
  parse(linesfrom(path, 0, statSync(path).size).lines, take)
}

// Reads the log, then polls for what is appended. A replaced file has
// rotated: its unread tail is read from `.1`, its replacement from the start.
export function followlog(path: string, take: (rec: any) => void, every = 200): () => void {
  let offset = 0
  let ino = -1
  const pump = () => {
    let st
    try { st = statSync(path) }
    catch (_err) { return }
    if (st.ino !== ino && -1 !== ino) {
      try {
        const old = statSync(path + '.1')
        if (old.ino === ino && offset < old.size) { parse(linesfrom(path + '.1', offset, old.size).lines, take) }
      }
      catch (_err) { /* rotated again, or removed */ }
      offset = 0
    }
    if (st.size < offset) { offset = 0 }
    ino = st.ino
    if (st.size === offset) { return }
    const out = linesfrom(path, offset, st.size)
    offset = out.next
    parse(out.lines, take)
  }
  pump()
  const timer = setInterval(pump, every)
  timer.unref()
  return () => clearInterval(timer)
}
