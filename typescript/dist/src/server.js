"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listen = listen;
exports.outbox = outbox;
exports.hostok = hostok;
const crypto_1 = require("crypto");
const http_1 = require("http");
const page_1 = require("./page");
// A stream subscriber whose unsent output passes this is cut off; its
// client reconnects from the last id it read.
const MAX_BUFFERED = 1 << 20;
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
// A loopback server, read-only. It answers only a Host it is reachable
// as, so a page elsewhere cannot rebind a name onto it.
function listen(feed, opts = {}) {
    const host = opts.host ?? '127.0.0.1';
    if (!LOOPBACK.includes(host)) {
        return Promise.reject(new Error('station-view listens on loopback only, not ' + host));
    }
    const streams = new Set();
    let port = 0;
    const server = (0, http_1.createServer)((req, res) => {
        if (!hostok(req, port)) {
            return send(res, 403, 'text/plain', 'forbidden host\n');
        }
        if ('GET' !== req.method && 'HEAD' !== req.method) {
            res.setHeader('Allow', 'GET, HEAD');
            return send(res, 405, 'text/plain', 'read-only\n');
        }
        let url;
        try {
            url = new URL(req.url || '/', 'http://localhost');
        }
        catch (_err) {
            return send(res, 400, 'text/plain', 'bad request target\n');
        }
        if ('/' === url.pathname) {
            const nonce = (0, crypto_1.randomBytes)(16).toString('base64');
            res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; script-src 'nonce-" + nonce +
                "'; style-src 'nonce-" + nonce + "'");
            return send(res, 200, 'text/html; charset=utf-8', (0, page_1.page)(nonce));
        }
        if ('/api/records' === url.pathname) {
            return send(res, 200, 'application/json', feed.redact(JSON.stringify(feed.records(filterof(url)))));
        }
        if ('/api/sdks' === url.pathname) {
            return send(res, 200, 'application/json', feed.redact(JSON.stringify(feed.sdks())));
        }
        if ('/api/stream' === url.pathname) {
            return stream(req, res, url);
        }
        return send(res, 404, 'text/plain', 'not found\n');
    });
    function stream(req, res, url) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        if ('HEAD' === req.method) {
            res.end();
            return;
        }
        res.write(': open\n\n');
        const max = opts.maxBuffered ?? MAX_BUFFERED;
        const frame = (rec) => 'id: ' + rec.seq + '\ndata: ' + feed.redact(JSON.stringify(rec)) + '\n\n';
        const since = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0);
        // The backlog drains at the reader's pace; only live records queued
        // behind a reader that has stopped reading count against the bound.
        const box = outbox(feed.records({ since: Number.isFinite(since) ? since : 0 }).map(frame));
        let flowing = true;
        const pump = () => {
            flowing = true;
            let chunk = flowing ? box.take() : undefined;
            while (undefined !== chunk) {
                flowing = res.write(chunk);
                chunk = flowing ? box.take() : undefined;
            }
            if (!flowing) {
                res.once('drain', pump);
            }
        };
        const stop = feed.subscribe((rec) => {
            if (max < box.push(frame(rec))) {
                stop();
                res.destroy();
                return;
            }
            if (flowing) {
                pump();
            }
        });
        streams.add(res);
        res.on('close', () => { stop(); streams.delete(res); });
        pump();
    }
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 0, host, () => {
            const addr = server.address();
            port = addr.port;
            const shown = addr.family === 'IPv6' || 6 === addr.family ? '[' + addr.address + ']' : addr.address;
            resolve({
                url: 'http://' + shown + ':' + port + '/',
                port,
                close: () => new Promise((done) => {
                    for (const res of streams) {
                        res.end();
                    }
                    server.close(() => done());
                    server.closeAllConnections?.();
                }),
            });
        });
    });
}
// The frames one stream reader has yet to receive: its backlog, released
// as it is written, then live frames, counted in bytes on the wire.
function outbox(backlog) {
    let replay = backlog;
    let next = 0;
    const live = [];
    let queued = 0;
    return {
        take() {
            if (next < replay.length) {
                const chunk = replay[next];
                replay[next++] = '';
                if (next === replay.length) {
                    replay = [];
                    next = 0;
                }
                return chunk;
            }
            const chunk = live.shift();
            if (undefined !== chunk) {
                queued -= Buffer.byteLength(chunk, 'utf8');
            }
            return chunk;
        },
        push(chunk) {
            live.push(chunk);
            queued += Buffer.byteLength(chunk, 'utf8');
            return queued;
        },
        held: () => replay.length + live.length,
    };
}
// A client leaves the port out of Host when it is HTTP's own.
function hostok(req, port) {
    const given = String(req.headers.host ?? '');
    return LOOPBACK.some((name) => {
        const named = name.includes(':') ? '[' + name + ']' : name;
        return given === named + ':' + port || (80 === port && given === named);
    });
}
function send(res, status, type, body) {
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}
function filterof(url) {
    const q = url.searchParams;
    const num = (name) => null == q.get(name) ? undefined : Number(q.get(name));
    return {
        source: q.get('source') ?? undefined,
        sdk: q.get('sdk') ?? undefined,
        op: q.get('op') ?? undefined,
        status: q.get('status') ?? undefined,
        call: q.get('call') ?? undefined,
        since: num('since'),
        limit: num('limit'),
    };
}
//# sourceMappingURL=server.js.map