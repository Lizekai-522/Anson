import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/pages/TripPage.vue', import.meta.url), 'utf8')
for (const name of ['queryWeather', 'loadGeo']) {
  const end = name === 'queryWeather' ? '\nfunction weatherOf' : '\nonMounted('
  const fn = source.slice(source.indexOf(`async function ${name}()`), source.indexOf(end, source.indexOf(`async function ${name}()`)))
  for (const deleted of [false, true]) test(`${name} preserves edits made while fetching; deleted=${deleted}`, async () => {
    const initial = { id: 'trip', title: 'old', segments: [{ id: 'segment', to: '北京' }] }
    let latest = initial, writes = []
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    const box = value => ({ value })
    const context = {
      trip: box(initial), weatherBusy: box(false), geoBusy: box(false),
      geoHint: box(''), geoMissing: box([]), weatherBlock: box(null), destCities: box(['北京']),
      guessCity: x => x, fetchWeather: () => pending, fetchCityCoords: () => pending,
      getTrip: id => id === 'trip' ? latest : null,
      upsertTrip: value => { writes.push(value); latest = value; return { ok: true } },
      toast() {},
    }
    const operation = vm.runInNewContext(`${fn}; ${name}()`, context)
    latest = deleted ? null : { ...initial, title: 'edited', segments: [{ id: 'segment', to: '上海' }] }
    finish(name === 'queryWeather' ? { advice: '晴' } : { lat: 39, lng: 116 })
    await operation
    if (deleted) assert.equal(writes.length, 0, 'a deleted trip must not be recreated')
    else {
      assert.equal(writes.length, 1)
      assert.equal(writes[0].title, 'edited')
      assert.equal(writes[0].segments[0].to, '上海')
      assert.ok(writes[0][name === 'queryWeather' ? 'weather' : 'geo']['北京'])
    }
  })
}
