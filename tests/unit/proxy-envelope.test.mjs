import test from 'node:test'
import assert from 'node:assert/strict'
import {chat} from '../../src/core/model.js'
const cfg={baseUrl:'https://unused.invalid/v1',model:'test',useProxy:true}
test('proxy accepts the actual server envelope after direct failure',async()=>{
 globalThis.fetch=async url=>{if(url!=='/api/model') throw new Error('stub direct CORS');return {ok:true,json:async()=>({ok:true,content:'extracted ticket text'})}}
 const r=await chat([{role:'user',content:'test'}],{cfg})
 assert.deepEqual(r,{ok:true,content:'extracted ticket text',via:'proxy'})
})
test('proxy preserves server reason and rejects incomplete success',async()=>{
 for(const body of [{ok:false,reason:'unauthorized',detail:'denied'},{ok:true,content:''},{ok:true}]) {
  globalThis.fetch=async url=>{if(url!=='/api/model') throw new Error('stub');return {ok:body.ok,json:async()=>body,status:401}}
  const r=await chat([],{cfg});assert.equal(r.ok,false);assert.equal(r.reason,body.ok?'bad-response':'unauthorized')
 }
})
