"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LOG_BYTES = exports.LOG_VERSION = void 0;
exports.defaultlog = defaultlog;
exports.logpath = logpath;
exports.makelog = makelog;
exports.readlog = readlog;
exports.followlog = followlog;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
exports.LOG_VERSION = 1;
exports.MAX_LOG_BYTES = 10 << 20;
function defaultlog() {
    return (0, path_1.join)((0, os_1.homedir)(), '.voxgig', 'station-view', 'records.jsonl');
}
// `true` names the default log, and a string names a file. Left unset,
// STATION_VIEW_LOG decides, so an application can be watched unchanged.
function logpath(option, env = process.env) {
    if (false === option) {
        return undefined;
    }
    if ('string' === typeof option && '' !== option) {
        return option;
    }
    if (true === option) {
        return defaultlog();
    }
    const named = env.STATION_VIEW_LOG;
    if (null == named || '' === named) {
        return undefined;
    }
    return '1' === named || 'true' === named ? defaultlog() : named;
}
// One JSON line per record, written before the call that made it returns,
// so a process that exits at once has already left its records.
function makelog(path, redact, maxBytes = exports.MAX_LOG_BYTES) {
    const run = (0, crypto_1.randomBytes)(6).toString('hex');
    (0, fs_1.mkdirSync)((0, path_1.dirname)(path), { recursive: true, mode: 0o700 });
    return {
        path,
        run,
        write(rec) {
            const { seq: _seq, ...rest } = rec;
            const line = redact(JSON.stringify({ v: exports.LOG_VERSION, run, pid: process.pid, ...rest })) + '\n';
            try {
                const size = (0, fs_1.existsSync)(path) ? (0, fs_1.statSync)(path).size : 0;
                if (0 < size && maxBytes < size + Buffer.byteLength(line)) {
                    (0, fs_1.renameSync)(path, path + '.1');
                }
                append(path, line);
            }
            catch (_err) { /* a log that cannot be written never fails the call */ }
        },
    };
}
const APPEND = fs_1.constants.O_WRONLY | fs_1.constants.O_APPEND | fs_1.constants.O_CREAT | (fs_1.constants.O_NOFOLLOW ?? 0);
// The log may sit in a shared directory, so a link is refused, a file
// another user owns is left alone, and one others can read is narrowed.
function append(path, line) {
    const fd = (0, fs_1.openSync)(path, APPEND, 0o600);
    try {
        if ('win32' !== process.platform) {
            const st = (0, fs_1.fstatSync)(fd);
            if (null != process.getuid && st.uid !== process.getuid()) {
                return;
            }
            if (0 !== (st.mode & 0o077)) {
                (0, fs_1.fchmodSync)(fd, 0o600);
            }
        }
        (0, fs_1.writeFileSync)(fd, line);
    }
    finally {
        (0, fs_1.closeSync)(fd);
    }
}
// The complete lines from `from` on, and the byte offset after the last.
function linesfrom(path, from, size) {
    const fd = (0, fs_1.openSync)(path, 'r');
    try {
        const buf = Buffer.alloc(size - from);
        const got = (0, fs_1.readSync)(fd, buf, 0, buf.length, from);
        const last = buf.subarray(0, got).lastIndexOf(0x0a);
        if (last < 0) {
            return { lines: [], next: from };
        }
        return { lines: buf.subarray(0, last).toString('utf8').split('\n'), next: from + last + 1 };
    }
    finally {
        (0, fs_1.closeSync)(fd);
    }
}
function parse(lines, take) {
    for (const line of lines) {
        if ('' === line) {
            continue;
        }
        try {
            take(JSON.parse(line));
        }
        catch (_err) { /* a torn or foreign line is skipped */ }
    }
}
function readlog(path, take) {
    if (!(0, fs_1.existsSync)(path)) {
        return;
    }
    parse(linesfrom(path, 0, (0, fs_1.statSync)(path).size).lines, take);
}
// Reads the log, then polls for what is appended. A replaced file has
// rotated: its unread tail is read from `.1`, its replacement from the start.
function followlog(path, take, every = 200) {
    let offset = 0;
    let ino = -1;
    const pump = () => {
        let st;
        try {
            st = (0, fs_1.statSync)(path);
        }
        catch (_err) {
            return;
        }
        if (st.ino !== ino && -1 !== ino) {
            try {
                const old = (0, fs_1.statSync)(path + '.1');
                if (old.ino === ino && offset < old.size) {
                    parse(linesfrom(path + '.1', offset, old.size).lines, take);
                }
            }
            catch (_err) { /* rotated again, or removed */ }
            offset = 0;
        }
        if (st.size < offset) {
            offset = 0;
        }
        ino = st.ino;
        if (st.size === offset) {
            return;
        }
        const out = linesfrom(path, offset, st.size);
        offset = out.next;
        parse(out.lines, take);
    };
    pump();
    const timer = setInterval(pump, every);
    timer.unref();
    return () => clearInterval(timer);
}
//# sourceMappingURL=log.js.map