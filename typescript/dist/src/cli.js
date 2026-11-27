"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.servelog = servelog;
exports.main = main;
const fs_1 = require("fs");
const collect_1 = require("./collect");
const log_1 = require("./log");
const server_1 = require("./server");
// The page and its API over a record log rather than one process's
// records. What it serves was redacted by the process that wrote it.
async function servelog(opts = {}) {
    const log = (0, log_1.logpath)(opts.log ?? true);
    const collector = (0, collect_1.makecollector)(opts.max ?? 10000);
    const sdks = new Map();
    const take = (line) => {
        const rec = collector.logged(line);
        if (null != rec?.sdk) {
            sdks.set(rec.sdk, rec.api);
        }
    };
    if ((0, fs_1.existsSync)(log + '.1')) {
        (0, log_1.readlog)(log + '.1', take);
    }
    const stop = (0, log_1.followlog)(log, take, opts.every);
    try {
        const live = await (0, server_1.listen)({
            records: collector.records,
            subscribe: collector.subscribe,
            sdks: () => Array.from(sdks, ([name, api]) => ({ name, api, metrics: null })),
            redact: (text) => text,
        }, { port: opts.port ?? 8960, host: opts.host });
        return { ...live, log, close: async () => { stop(); await live.close(); } };
    }
    catch (err) {
        stop();
        throw err;
    }
}
const USAGE = 'usage: station-view [--log <file>] [--port <n>] [--host <loopback>]\n';
async function main(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if ('--help' === flag) {
            process.stdout.write(USAGE);
            return;
        }
        if (!['--log', '--port', '--host'].includes(flag) || undefined === value) {
            process.stderr.write('station-view: not understood: ' + flag + '\n' + USAGE);
            process.exitCode = 2;
            return;
        }
        i++;
        if ('--log' === flag) {
            opts.log = value;
        }
        else if ('--host' === flag) {
            opts.host = value;
        }
        else if (/^\d+$/.test(value) && Number(value) <= 65535) {
            opts.port = Number(value);
        }
        else {
            process.stderr.write('station-view: not a port: ' + value + '\n');
            process.exitCode = 2;
            return;
        }
    }
    const live = await servelog(opts);
    process.stderr.write('station-view: ' + live.url + ', reading ' + live.log + '\n');
    const close = () => { live.close().catch(() => undefined); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}
//# sourceMappingURL=cli.js.map