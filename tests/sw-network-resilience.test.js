'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
const origin='https://issataevun-sys.github.io/cocktail-room-pwa/';
function harness(network,cached){
 const handlers={};let current=cached;const writes=[];const waiting=[];
 const cache={
  match:async()=>current,
  put:async(req,res)=>{writes.push(res);current=res;},
  addAll:async()=>{}
 };
 const ctx={
  self:{registration:{scope:origin},addEventListener:(name,fn)=>{handlers[name]=fn;}},
  caches:{open:async()=>cache,keys:async()=>[]},
  fetch:network,URL,Set,Promise,setTimeout,clearTimeout
 };
 vm.runInNewContext(source,ctx,{filename:'sw.js'});
 const request={url:origin+'work.html',method:'GET',mode:'navigate'};
 function run(){
  let response=null;
  handlers.fetch({request,respondWith:p=>{response=p},waitUntil:p=>waiting.push(p)});
  return response;
 }
 return {run,writes,waiting,cache};
}
function response(label){return {label,ok:true,type:'basic',clone(){return this}}}
test('cached shell loads even if network never completes',async()=>{
 const old=response('cached');
 const h=harness(()=>new Promise(()=>{}),old);
 const start=Date.now();
 assert.equal(await h.run(),old);
 assert.ok(Date.now()-start<3500,'cache fallback should be bounded');
});
test('fresh response is preferred on a healthy network',async()=>{
 const old=response('cached'),fresh=response('fresh');
 const h=harness(async()=>fresh,old);
 assert.equal(await h.run(),fresh);
 assert.equal(h.writes.length,1);
});
test('late network response updates cache after fallback',async()=>{
 const old=response('cached'),fresh=response('fresh');
 let complete;
 const h=harness(()=>new Promise(resolve=>{complete=resolve}),old);
 assert.equal(await h.run(),old);
 complete(fresh);
 await Promise.all(h.waiting);
 assert.equal(h.writes.length,1);
});
test('uncached shell requires a successful initial network request',async()=>{
 const h=harness(async()=>{throw Error('offline')},null);
 await assert.rejects(h.run(),/offline/);
});
