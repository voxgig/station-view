
// The slice of a voxgig/station Station that the view reads.
export type StationLike = {
  status(): { mode: string, profile: string, events: { buffered: number, dropped: number } }
  instances(): { name: string, api: string, active: boolean }[]
  events(): { kind: string }[]
}

export type ViewSnapshot = {
  stub: true
  mode: string
  profile: string
  instances: { name: string, api: string, active: boolean }[]
  events: { buffered: number, dropped: number, kinds: { [kind: string]: number } }
}

export type View = {
  snapshot(): ViewSnapshot
}

export function makeview(station: StationLike): View {
  return {
    snapshot() {
      const status = station.status()
      const kinds: { [kind: string]: number } = {}
      for (const ev of station.events()) {
        kinds[ev.kind] = (kinds[ev.kind] || 0) + 1
      }
      return {
        stub: true,
        mode: status.mode,
        profile: status.profile,
        instances: station.instances().map((i) => ({ name: i.name, api: i.api, active: i.active })),
        events: { buffered: status.events.buffered, dropped: status.events.dropped, kinds },
      }
    },
  }
}

// A voxgig/plugin definition. A Station loads it only when handed it:
// `station.use(StationView)`, then `station.extension('view/view')`.
export const StationView = {
  name: 'view',
  activate(inst: any): void {
    inst.export('view', makeview(inst.host().exports('station/station')))
  },
}
