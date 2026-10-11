import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const mem = new Map()
globalThis.localStorage = { getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k) }
const { push, probeSync, resetSyncCache } = await import('../../src/core/sync.js')
test('SW ignores live API and upgrades old cache namespace', async () => {
 const listeners = {}
 const deleted=[]
 const caches={keys:async()=>['ptb-v3','ptb-v4'],delete:async k=>deleted.push(k)}
 vm.runInNewContext(fs.readFileSync(new URL('../../public/sw.js',import.meta.url),'utf8'), { URL,caches,self:{location:{origin:'https://local'},clients:{claim:async()=>{}},addEventListener:(k,f)=>listeners[k]=f} })
 let intercepted=false
 listeners.fetch({request:{method:'GET',url:'https://local/api/sync/room/pull?since=0'},respondWith:()=>intercepted=true})
 assert.equal(intercepted,false)
 let activation
 listeners.activate({waitUntil:p=>activation=p})
 await activation;assert.deepEqual(deleted,['ptb-v3'])
})
test('push cannot report accepted on HTTP rejection and probes bypass browser cache', async () => {
 resetSyncCache()
 const calls=[]
 globalThis.fetch=async (url,options)=>{calls.push({url,options});return {ok:url.endsWith('/ping'),json:async()=>({ok:url.endsWith('/ping')})}}
 assert.equal(await probeSync(),true)
 assert.equal(calls[0].options.cache,'no-store')
 assert.equal(await push('testroom',[{id:'x',type:'sos'}]),false)
})
