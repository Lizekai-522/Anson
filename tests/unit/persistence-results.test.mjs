import test from 'node:test'
import assert from 'node:assert/strict'
const mem=new Map();let fail=false
 globalThis.localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>{if(fail)throw new DOMException('full','QuotaExceededError');mem.set(k,v)},removeItem:k=>mem.delete(k)}
const {store,emptyData,safeSet,persist,upsertTrip,setDraft,clearDraft,saveShare,saveInvite}=await import('../../src/core/store.js')
test('failed trip/share/invite writes do not mutate durable or active state',()=>{
 store.account={id:'test'};store.data=emptyData();assert.equal(setDraft({raw:'original'}).ok,true)
 const before=JSON.stringify(store.data);fail=true
 for(const result of [upsertTrip({id:'trip',title:'x'}),saveShare({id:'share'}),saveInvite({id:'invite'}),clearDraft(),persist()]) assert.equal(result.ok,false)
 assert.equal(JSON.stringify(store.data),before)
 assert.equal(JSON.parse(mem.get('ptb:data:test')).draft.raw,'original')
 assert.equal(safeSet('other',{}).reason,'QuotaExceededError')
 fail=false;assert.equal(upsertTrip({id:'trip',title:'x'}).ok,true)
 assert.equal(JSON.parse(mem.get('ptb:data:test')).trips[0].id,'trip')
 assert.equal(clearDraft().ok,true)
})
test('no account cannot silently accept a save',()=>{store.account=null;assert.equal(upsertTrip({id:'x'}).reason,'no-account')})
