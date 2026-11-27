"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makecollector = makecollector;
exports.select = select;
const log_1 = require("./log");
function makecollector(max = 1000) {
    const ring = [];
    const subs = new Set();
    let seq = 0;
    let dropped = 0;
    function keep(rec) {
        const out = { seq: ++seq, ...rec };
        ring.push(out);
        if (max < ring.length) {
            dropped += ring.splice(0, ring.length - max).length;
        }
        for (const fn of subs) {
            try {
                fn(out);
            }
            catch (_err) { /* a subscriber does not stop the others */ }
        }
        return out;
    }
    return {
        add(source, from, raw) {
            return keep({ ...normalize(source, raw), sdk: from.name, api: from.api, detail: raw });
        },
        station(ev) {
            const http = ev?.http || {};
            const op = null != ev?.op && 'object' === typeof ev.op ? ev.op : {};
            return keep({
                call: idof(ev?.corr),
                t: num(ev?.t) ?? Date.now(),
                source: 'station',
                kind: String(ev?.kind ?? ''),
                sdk: ev?.plugin,
                api: ev?.api,
                op: null == op.op ? undefined : (null == op.entity ? '' : op.entity + '.') + op.op,
                method: http.method,
                path: http.path,
                status: num(http.status) ?? num(ev?.err?.status),
                ok: stationok(ev),
                ms: num(http.durationMs) ?? num(op.durationMs),
                detail: ev,
            });
        },
        logged(line) {
            if (null == line || 'object' !== typeof line || log_1.LOG_VERSION !== line.v || 'string' !== typeof line.source) {
                return undefined;
            }
            const { v: _v, seq: _seq, ...rec } = line;
            return keep({ ...rec, t: num(rec.t) ?? Date.now(), detail: rec.detail });
        },
        records: (filter) => select(ring, filter || {}),
        subscribe(fn) {
            subs.add(fn);
            return () => { subs.delete(fn); };
        },
        dropped: () => dropped,
    };
}
function normalize(source, raw) {
    const call = idof(raw?.correlationId);
    if ('telemetry' === source) {
        return {
            t: num(raw?.start) ?? Date.now(), source, kind: 'span',
            op: raw?.name, ok: raw?.ok, ms: num(raw?.durationMs), call,
        };
    }
    if ('debug' === source) {
        return {
            t: num(raw?.start) ?? Date.now(), source, kind: 'call',
            op: raw?.op, method: raw?.method, path: pathof(raw?.url),
            status: num(raw?.status), ok: raw?.ok, ms: num(raw?.durationMs), call,
        };
    }
    return {
        t: num(raw?.ts) ?? Date.now(), source, kind: 'audit',
        op: null == raw?.entity ? raw?.op : raw.entity + '.' + raw.op,
        status: num(raw?.status), ok: null == raw?.outcome ? undefined : 'error' !== raw.outcome, call,
    };
}
function select(records, filter) {
    const out = records.filter((rec) => (null == filter.source || '' === filter.source || filter.source === rec.source) &&
        (null == filter.sdk || '' === filter.sdk || filter.sdk === rec.sdk) &&
        (null == filter.op || '' === filter.op || String(rec.op ?? '').includes(filter.op)) &&
        (null == filter.call || '' === filter.call || filter.call === rec.call) &&
        (null == filter.since || filter.since < rec.seq) &&
        statusmatch(filter.status, rec));
    const limit = null == filter.limit ? out.length : Math.max(0, filter.limit);
    return out.slice(Math.max(0, out.length - limit));
}
function statusmatch(want, rec) {
    if (null == want || '' === want) {
        return true;
    }
    if ('failed' === want) {
        return false === rec.ok;
    }
    const cls = /^([1-5])xx$/.exec(want);
    if (null != cls) {
        return null != rec.status && cls[1] === String(rec.status)[0];
    }
    return String(rec.status) === want;
}
// An `op` event settles with its outcome: ok, err, unexpected or unknown.
function stationok(ev) {
    const status = ev?.http?.status;
    if (null != status) {
        return 0 < status && status < 400;
    }
    if ('error' === ev?.kind) {
        return false;
    }
    const outcome = ev?.op?.outcome;
    return 'ok' === outcome ? true : ('err' === outcome || 'unexpected' === outcome ? false : undefined);
}
// A debug entry's URL may be relative to the SDK's base, and may still
// hold the route's parameters, which a URL parse would percent-encode.
function pathof(url) {
    if ('string' !== typeof url) {
        return undefined;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        try {
            return new URL(url).pathname;
        }
        catch (_err) {
            return url;
        }
    }
    const path = url.replace(/[?#].*$/, '');
    return path.startsWith('/') ? path : '/' + path;
}
function idof(v) {
    return 'string' === typeof v && '' !== v ? v : undefined;
}
function num(v) {
    return 'number' === typeof v && Number.isFinite(v) ? v : undefined;
}
//# sourceMappingURL=collect.js.map