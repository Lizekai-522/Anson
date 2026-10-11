import test from 'node:test'
import assert from 'node:assert/strict'
import {buildElderCards} from '../../src/core/agents.js'
import {encodeShare,decodeShare} from '../../src/core/share-codec.js'
import {replaySharedTodos} from '../../src/core/sharedTodos.js'
const seg={id:'stable-segment',type:'train',from:'A',to:'B',date:'2026-10-12',todos:[{id:'task-a',text:'ticket',level:'normal'},{id:'task-b',text:'call',level:'high'}]}
test('published segment/task IDs survive codec and reordered tasks replay correctly',()=>{
 const cards=decodeShare(encodeShare({cards:buildElderCards({segments:[seg]}),exp:Date.now()+100000})).payload.cards
 assert.equal(cards[0].segId,seg.id);assert.equal(cards[0].todos[0].id,'task-a')
 const event={id:'1',type:'todo-done',at:1,segId:seg.id,data:{index:0,taskId:'task-a'}}
 const current={...seg,todos:[...seg.todos].reverse()}
 const state=replaySharedTodos([event],cards,[current]);assert.ok(state[seg.id].has('task-a'));assert.ok(!state[seg.id].has('task-b'))
 assert.equal(replaySharedTodos([event,{...event,type:'todo-undone',at:2}],cards,[current])[seg.id].size,0)
})
test('legacy index IDs use unambiguous snapshot fields and task text only',()=>{
 const cards=[{...buildElderCards({segments:[seg]})[0],segId:'seg0'}]
 const event={type:'todo-done',at:1,segId:'seg0',data:{index:0}}
 assert.ok(replaySharedTodos([event],cards,[seg])[seg.id].has('task-a'))
 assert.deepEqual(replaySharedTodos([event],cards,[seg,{...seg,id:'duplicate'}]),{})
})
