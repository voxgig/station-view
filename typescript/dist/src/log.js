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
            let fd = appendable(path);
            if (undefined === fd) {
                return;
            }
            try {
                const size = (0, fs_1.fstatSync)(fd).size;
                if (0 < size && maxBytes < size + Buffer.byteLength(line)) {
                    (0, fs_1.renameSync)(path, path + '.1');
                    (0, fs_1.closeSync)(fd);
                    fd = appendable(path);
                    if (undefined === fd) {
                        return;
                    }
                }
                (0, fs_1.writeFileSync)(fd, line);
            }
            catch (_err) { /* a log that cannot be written never fails the call */ }
            finally {
                if (undefined !== fd) {
                    (0, fs_1.closeSync)(fd);
                }
            }
        },
    };
}
const APPEND = fs_1.constants.O_WRONLY | fs_1.constants.O_APPEND | fs_1.constants.O_CREAT | (fs_1.constants.O_NOFOLLOW ?? 0);
// The log may sit in a shared directory, so a link is refused, a file
// another user owns is left alone, and one others can read is narrowed,
// all before it is written or moved to `.1`.
function appendable(path) {
    let fd;
    try {
        fd = (0, fs_1.openSync)(path, APPEND, 0o600);
    }
    catch (_err) {
        return undefined;
    }
    try {
        if ('win32' !== process.platform) {
            const st = (0, fs_1.fstatSync)(fd);
            if (null != process.getuid && st.uid !== process.getuid()) {
                (0, fs_1.closeSync)(fd);
                return undefined;
            }
            if (0 !== (st.mode & 0o077)) {
                (0, fs_1.fchmodSync)(fd, 0o600);
            }
        }
        return fd;
    }
    catch (_err) {
        (0, fs_1.closeSync)(fd);
        return undefined;
    }
}
// The stat and the read go through one descriptor, so a rotation
// between them cannot swap the file being read.
function opened(path) {
    let fd;
    try {
        fd = (0, fs_1.openSync)(path, 'r');
    }
    catch (_err) {
        return undefined;
    }
    try {
        const st = (0, fs_1.fstatSync)(fd);
        return { fd, ino: st.ino, size: st.size };
    }
    catch (_err) {
        (0, fs_1.closeSync)(fd);
        return undefined;
    }
}
// The complete lines from `from` on, and the byte offset after the last.
function linesfrom(fd, from, size) {
    const buf = Buffer.alloc(size - from);
    const got = (0, fs_1.readSync)(fd, buf, 0, buf.length, from);
    const last = buf.subarray(0, got).lastIndexOf(0x0a);
    if (last < 0) {
        return { lines: [], next: from };
    }
    return { lines: buf.subarray(0, last).toString('utf8').split('\n'), next: from + last + 1 };
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
    const file = opened(path);
    if (undefined === file) {
        return;
    }
    try {
        parse(linesfrom(file.fd, 0, file.size).lines, take);
    }
    catch (_err) { /* unreadable, so skipped */ }
    finally {
        (0, fs_1.closeSync)(file.fd);
    }
}
// Reads the log, then polls for what is appended. A replaced file has
// rotated: its unread tail is read from `.1`, its replacement from the start.
function followlog(path, take, every = 200) {
    let offset = 0;
    let ino = -1;
    const pump = () => {
        const file = opened(path);
        if (undefined === file) {
            return;
        }
        try {
            if (file.ino !== ino && -1 !== ino) {
                const old = opened(path + '.1');
                if (undefined !== old) {
                    try {
                        if (old.ino === ino && offset < old.size) {
                            parse(linesfrom(old.fd, offset, old.size).lines, take);
                        }
                    }
                    finally {
                        (0, fs_1.closeSync)(old.fd);
                    }
                }
                offset = 0;
            }
            if (file.size < offset) {
                offset = 0;
            }
            ino = file.ino;
            if (file.size === offset) {
                return;
            }
            const out = linesfrom(file.fd, offset, file.size);
            offset = out.next;
            parse(out.lines, take);
        }
        catch (_err) { /* read again at the next poll */ }
        finally {
            (0, fs_1.closeSync)(file.fd);
        }
    };
    pump();
    const timer = setInterval(pump, every);
    timer.unref();
    return () => clearInterval(timer);
}
//# sourceMappingURL=log.js.map