"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StationView = void 0;
exports.makeview = makeview;
function makeview(station) {
    return {
        snapshot() {
            const status = station.status();
            const kinds = {};
            for (const ev of station.events()) {
                kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
            }
            return {
                stub: true,
                mode: status.mode,
                profile: status.profile,
                instances: station.instances().map((i) => ({ name: i.name, api: i.api, active: i.active })),
                events: { buffered: status.events.buffered, dropped: status.events.dropped, kinds },
            };
        },
    };
}
// A voxgig/plugin definition. A Station loads it only when handed it:
// `station.use(StationView)`, then `station.extension('view/view')`.
exports.StationView = {
    name: 'view',
    activate(inst) {
        inst.export('view', makeview(inst.host().exports('station/station')));
    },
};
//# sourceMappingURL=index.js.map