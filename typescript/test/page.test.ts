
import { test } from 'node:test'
import * as Assert from 'node:assert'
import * as Path from 'node:path'

import * as StationLib from '@voxgig/station'
import { Station } from '@voxgig/station'

import { StationView } from '../src'

import { FEATURES, fakeSDK } from './support'

let playwright: any
try { playwright = require('playwright') }
catch (_err) { playwright = undefined }

// A real browser, where one is installed: the page fills from the API,
// takes new records from the stream, and its filters narrow the table.
test('the page shows the traffic, live, and filters it',
  { skip: undefined === playwright ? 'playwright is not installed here' : false }, async () => {
    StationLib.resetFactories()
    const full = fakeSDK('solar', FEATURES)
    const st = new Station({ config: null, proxy: 'off', load: false }).use(StationView)
    const client = st.connect(full.SDK, { instance: 'solar$a' })
    client.call('planet.list', 200)
    const live = await st.extension('view/view').listen()
    const browser = await playwright.chromium.launch()

    try {
      const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      const errors: string[] = []
      tab.on('pageerror', (err: any) => errors.push(String(err)))
      tab.on('console', (msg: any) => { if ('error' === msg.type()) { errors.push(msg.text()) } })
      await tab.goto(live.url)

      await tab.waitForFunction(() => 0 < (globalThis as any).document.querySelectorAll('#rows tr').length)
      const before = await tab.locator('#rows tr').count()

      client.call('planet.list', 503)
      await tab.waitForFunction((n: number) => n < (globalThis as any).document.querySelectorAll('#rows tr').length, before)

      await tab.selectOption('select[name=source]', 'debug')
      const calls = await tab.locator('#rows tr').allInnerTexts()
      Assert.strictEqual(calls.length, 2)
      Assert.ok(calls.every((row: string) => /debug\s+solar\$a\s+planet\.list\s+GET\s+\/api\/planet/.test(row)), calls.join('\n'))

      await tab.selectOption('select[name=status]', 'failed')
      Assert.strictEqual(await tab.locator('#rows tr').count(), 1)
      await tab.locator('#rows tr').first().click()
      Assert.match(await tab.locator('#detail').innerText(), /"status": 503/)

      await tab.selectOption('select[name=status]', '')
      await tab.selectOption('select[name=source]', '')
      const call = await tab.locator('#rows tr td.call').first().innerText()
      await tab.locator('#rows tr td.call').first().click()
      Assert.strictEqual(await tab.inputValue('input[name=call]'), call)
      await tab.waitForFunction(() => 3 === (globalThis as any).document.querySelectorAll('#rows tr').length)
      Assert.ok((await tab.locator('#rows tr td.call').allInnerTexts()).every((text: string) => call === text))
      await tab.locator('#rows tr td').first().click()
      const joined = await tab.locator('#detail').innerText()
      for (const source of ['telemetry', 'debug', 'audit']) {
        Assert.ok(joined.includes('"source": "' + source + '"'), source + ' in ' + joined)
      }

      const shot = process.env.STATION_VIEW_SCREENSHOT
      if (shot) { await tab.screenshot({ path: Path.resolve(shot), fullPage: true }) }
      Assert.deepStrictEqual(errors, [])
    }
    finally {
      await browser.close()
      await live.close()
      st.close()
      StationLib.resetFactories()
    }
  })
