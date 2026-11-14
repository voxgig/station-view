
import { test } from 'node:test'
import * as Assert from 'node:assert'

import { makecatalog, makehost } from '@voxgig/plugin'
import { Station } from '@voxgig/station'

import { StationView } from '../src'

// The host a Station gives its extensions: its first instance is the
// Station, exported as `station/station`.
function hosted(station: Station) {
  const host = makehost({
    catalog: makecatalog([{ name: 'station', define: (inst: any) => inst.export('station', station) }]),
  })
  host.load('station')
  host.activate('station')
  host.define(StationView)
  host.load('view')
  host.activate('view')
  return host
}

const CONFIG = {
  station: 1,
  profiles: { default: { sdk: { joplin: {}, 'notion$work': { active: false } } } },
}

test('the view goes live in a station host and snapshots the station', () => {
  const station = new Station({ config: CONFIG as any, proxy: 'off', load: false })
  const host = hosted(station)
  Assert.strictEqual(host.list().view, 'live')

  const snap = host.exports('view/view').snapshot()
  Assert.strictEqual(snap.stub, true)
  Assert.strictEqual(snap.mode, 'solo')
  Assert.strictEqual(snap.profile, 'default')
  Assert.deepStrictEqual(snap.instances, station.instances().map((i) =>
    ({ name: i.name, api: i.api, active: i.active })))
  Assert.ok(snap.instances.length > 0, 'the config declares instances')
  Assert.deepStrictEqual({ buffered: snap.events.buffered, dropped: snap.events.dropped },
    station.status().events)

  host.close()
  station.close()
})

test('the snapshot counts the station\'s events by kind', () => {
  // With no proxy found, a Station records that it runs solo.
  const station = new Station({ config: null, proxy: 'auto', load: false })
  const host = hosted(station)
  Assert.deepStrictEqual(host.exports('view/view').snapshot().events.kinds, { station: 1 })
  host.close()
  station.close()
})
