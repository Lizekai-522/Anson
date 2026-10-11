import test from 'node:test'
import assert from 'node:assert/strict'
import {minimizeSyncEvent,scrubStoredSyncEvents} from '../../src/core/locationPrivacy.js'
import {createSyncStore} from '../../server/app.mjs'
test('event history contains no coordinates while latest presence remains usable',()=>{
 const store=createSyncStore()
 for(let i=0;i<100;i++) store.push('privacyroom',[{id:'e'+i,type:'location',data:{lat:30+i/1000,lng:120,nested:{latitude:30}}}],{lat:30+i/1000,lng:120,at:i})
 const out=store.pull('privacyroom',0)
 assert.equal(out.events.length,100)
 assert.ok(out.events.every(e=>!JSON.stringify(e.data).includes('lat')))
 assert.equal(out.presence.lat,30.099)
 assert.deepEqual(minimizeSyncEvent({type:'sos',data:{lat:1,lng:2,hasLoc:true}}).data,{hasLoc:true})
})
test('startup migrates persistent old mirrors and leaves latest presence',()=>{
 const mem=new Map([['ptb:sync:room',JSON.stringify({events:[{id:'1',type:'location',data:{lat:1,lng:2}}],presence:{lat:3,lng:4}})]])
 const storage={length:mem.size,key:i=>[...mem.keys()][i],getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v)}
 scrubStoredSyncEvents(storage)
 const out=JSON.parse(mem.get('ptb:sync:room'));assert.deepEqual(out.events[0].data,{});assert.equal(out.presence.lat,3)
})
