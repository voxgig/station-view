"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StationView = exports.servelog = exports.select = exports.readlog = exports.logpath = exports.followlog = exports.defaultlog = void 0;
exports.makeview = makeview;
const station_1 = require("@voxgig/station");
const collect_1 = require("./collect");
Object.defineProperty(exports, "select", { enumerable: true, get: function () { return collect_1.select; } });
const log_1 = require("./log");
Object.defineProperty(exports, "defaultlog", { enumerable: true, get: function () { return log_1.defaultlog; } });
Object.defineProperty(exports, "followlog", { enumerable: true, get: function () { return log_1.followlog; } });
Object.defineProperty(exports, "logpath", { enumerable: true, get: function () { return log_1.logpath; } });
Object.defineProperty(exports, "readlog", { enumerable: true, get: function () { return log_1.readlog; } });
const server_1 = require("./server");
var cli_1 = require("./cli");
Object.defineProperty(exports, "servelog", { enumerable: true, get: function () { return cli_1.servelog; } });
// The sdkgen features the view switches on, and the option each one
// hands its records to.
const CALLBACK = {
    telemetry: 'exporter',
    debug: 'onEntry',
    audit: 'sink',
    metrics: undefined,
};
function makeview(station, options = {}) {
    const collector = (0, collect_1.makecollector)(options.max ?? 1000);
    const features = (options.features ?? Object.keys(CALLBACK)).filter((f) => f in CALLBACK);
    const bound = [];
    // Each record also goes to the log, redacted, for a viewer that outlives
    // this process (`station-view`).
    const where = (0, log_1.logpath)(options.log);
    if (undefined !== where) {
        const log = (0, log_1.makelog)(where, (text) => station.redact(text), options.logMax);
        collector.subscribe((rec) => log.write(rec));
    }
    const view = {
        records: (filter) => collector.records(filter),
        sdks: () => bound.map((sdk) => ({
            name: sdk.name, api: sdk.api, metrics: sdk.client?._metrics ?? null,
        })),
        snapshot() {
            const status = station.status();
            return {
                mode: status.mode,
                profile: status.profile,
                instances: station.instances().map((i) => ({ name: i.name, api: i.api, active: i.active })),
                records: collector.records().length,
                dropped: collector.dropped(),
            };
        },
        listen: (opts) => (0, server_1.listen)({
            records: collector.records,
            subscribe: collector.subscribe,
            sdks: view.sdks,
            redact: (text) => station.redact(text),
        }, opts),
        // The Station's own events, those already buffered first.
        follow() {
            for (const ev of station.events()) {
                collector.station(ev);
            }
            return station.tap((ev) => { collector.station(ev); });
        },
        watch(feature, info) {
            let out = feature;
            for (const name of features) {
                const key = CALLBACK[name];
                const entry = { active: true };
                if (undefined !== key) {
                    entry[key] = (raw) => { collector.add(name, info, raw); };
                }
                out = (0, station_1.withfeature)(out, name, entry, info?.descriptor);
            }
            return out;
        },
        bound(sdk) { bound.push(sdk); },
        logfile: () => where,
    };
    return view;
}
// A voxgig/plugin definition. A Station loads it only when handed it:
// `station.use(StationView, { max, features })`, then
// `station.extension('view/view')`.
exports.StationView = {
    name: 'view',
    define(inst) {
        const view = makeview(inst.host().exports('station/station'), inst.options || {});
        inst.bind(station_1.FEATURE_POINT, (next, feature, info) => next(view.watch(feature, info), info));
        inst.bind(station_1.BOUND_POINT, (sdk) => view.bound(sdk));
        inst.export('view', view);
    },
    activate(inst) {
        inst.release(inst.host().exports('view/view').follow());
    },
};
//# sourceMappingURL=index.js.map