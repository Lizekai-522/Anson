import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDatePhrase,runPipeline,sanityCheck,refreshPlain,packInviteSegments,buildInviteTrip } from '../../src/core/agents.js'
import { upcomingList,arrivalCheckpoints } from '../../src/core/upcoming.js'
test('week prefixes share a Monday origin across complete weekday phrases',()=>{
 for(const word of ['周','星期','礼拜']) {
  assert.equal(parseDatePhrase('下'+word+'五','2026-10-12').date,'2026-10-23')
  assert.equal(parseDatePhrase('下下'+word+'一','2026-10-11').date,'2026-10-19')
  assert.equal(parseDatePhrase('本'+word+'日','2026-10-12').date,'2026-10-18')
 }
})
test('invalid departure and arrival remain unknown and require confirmation',()=>{
 for(const text of ['25:70发车 13:00到','09:00发车 25:70到']) {
  const r=runPipeline('10月12号 G1 上海虹桥站 到 北京南站 '+text,{today:'2026-10-11'})
  assert.equal(r.segments[0].manualConfirm,true)
  assert.ok(r.issues.some(x=>x.code==='time-clamped'))
  assert.ok(r.segments[0].departTime===null || r.segments[0].arriveTime===null)
 }
})
test('cross-day inference is recomputed while explicit next-day choices survive',()=>{
 const s={type:'train',plain:{},date:'2026-10-12',from:'A',to:'B',departTime:'23:00',arriveTime:'01:00'}
 sanityCheck([s]);assert.equal(s.arriveNextDay,true)
 s.departTime='09:00';s.arriveTime='13:00';sanityCheck([s]);refreshPlain(s);assert.equal(s.arriveNextDay,false)
 s.arriveNextDayExplicit=true;sanityCheck([s]);assert.equal(s.arriveNextDay,true)
})
test('unconfirmed card never generates a timed departure or arrival alert',()=>{
 const card={date:'2026-10-12',depart:'09:00',arrive:'10:00',manualConfirm:true}
 assert.deepEqual(upcomingList([card],new Date(2026,9,12,8,30)),[])
 assert.deepEqual(arrivalCheckpoints([card],{},new Date(2026,9,12,12)),[])
})

test('explicit arrival day survives the editable invitation codec',()=>{
 const seg={type:'train',plain:{},date:'2026-10-12',from:'A',to:'B',departTime:'09:00',arriveTime:'13:00',arriveNextDay:true,arriveNextDayExplicit:true}
 const trip=buildInviteTrip({g:packInviteSegments([seg])},{today:'2026-10-11'})
 assert.equal(trip.segments[0].arriveNextDayExplicit,true)
 assert.equal(trip.segments[0].arriveNextDay,true)
})
