import { randomBytes } from 'crypto'
import {
  closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readSync, renameSync, writeFileSync,
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
      let fd = appendable(path)
      if (undefined === fd) { return }
      try {
        const size = fstatSync(fd).size
        if (0 < size && maxBytes < size + Buffer.byteLength(line)) {
          renameSync(path, path + '.1')
          closeSync(fd)
          fd = appendable(path)
          if (undefined === fd) { return }
        }
        writeFileSync(fd, line)
      }
      catch (_err) { /* a log that cannot be written never fails the call */ }
      finally {
        if (undefined !== fd) { closeSync(fd) }
      }
    },
  }
}

const APPEND = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)

// The log may sit in a shared directory, so a link is refused, a file
// another user owns is left alone, and one others can read is narrowed,
// all before it is written or moved to `.1`.
function appendable(path: string): number | undefined {
  let fd: number
  try { fd = openSync(path, APPEND, 0o600) }
  catch (_err) { return undefined }
  try {
    if ('win32' !== process.platform) {
      const st = fstatSync(fd)
      if (null != process.getuid && st.uid !== process.getuid()) { closeSync(fd); return undefined }
      if (0 !== (st.mode & 0o077)) { fchmodSync(fd, 0o600) }
    }
    return fd
  }
  catch (_err) {
    closeSync(fd)
    return undefined
  }
}

type Opened = { fd: number, ino: number, size: number }

// The stat and the read go through one descriptor, so a rotation
// between them cannot swap the file being read.
function opened(path: string): Opened | undefined {
  let fd: number
  try { fd = openSync(path, 'r') }
  catch (_err) { return undefined }
  try {
    const st = fstatSync(fd)
    return { fd, ino: st.ino, size: st.size }
  }
  catch (_err) {
    closeSync(fd)
    return undefined
  }
}

// The complete lines from `from` on, and the byte offset after the last.
function linesfrom(fd: number, from: number, size: number): { lines: string[], next: number } {
  const buf = Buffer.alloc(size - from)
  const got = readSync(fd, buf, 0, buf.length, from)
  const last = buf.subarray(0, got).lastIndexOf(0x0a)
  if (last < 0) { return { lines: [], next: from } }
  return { lines: buf.subarray(0, last).toString('utf8').split('\n'), next: from + last + 1 }
}

function parse(lines: string[], take: (rec: any) => void): void {
  for (const line of lines) {
    if ('' === line) { continue }
    try { take(JSON.parse(line)) }
    catch (_err) { /* a torn or foreign line is skipped */ }
  }
}

export function readlog(path: string, take: (rec: any) => void): void {
  const file = opened(path)
  if (undefined === file) { return }
  try { parse(linesfrom(file.fd, 0, file.size).lines, take) }
  catch (_err) { /* unreadable, so skipped */ }
  finally { closeSync(file.fd) }
}

// Reads the log, then polls for what is appended. A replaced file has
// rotated: its unread tail is read from `.1`, its replacement from the start.
export function followlog(path: string, take: (rec: any) => void, every = 200): () => void {
  let offset = 0
  let ino = -1
  const pump = () => {
    const file = opened(path)
    if (undefined === file) { return }
    try {
      if (file.ino !== ino && -1 !== ino) {
        const old = opened(path + '.1')
        if (undefined !== old) {
          try {
            if (old.ino === ino && offset < old.size) { parse(linesfrom(old.fd, offset, old.size).lines, take) }
          }
          finally { closeSync(old.fd) }
        }
        offset = 0
      }
      if (file.size < offset) { offset = 0 }
      ino = file.ino
      if (file.size === offset) { return }
      const out = linesfrom(file.fd, offset, file.size)
      offset = out.next
      parse(out.lines, take)
    }
    catch (_err) { /* read again at the next poll */ }
    finally { closeSync(file.fd) }
  }
  pump()
  const timer = setInterval(pump, every)
  timer.unref()
  return () => clearInterval(timer)
}
