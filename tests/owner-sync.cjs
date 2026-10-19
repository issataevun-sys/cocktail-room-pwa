'use strict';
/**
 * Reproducible integration-style queue tests for the PWA owner sync client.
 * All I/O is simulated; no Google account or real data is accessed.
 */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync('pwa-owner-sync.js','utf8');
const merge=require('../pwa-workspace-merge.js');
const clone=value=>JSON.parse(JSON.stringify(value));
let nextOperation=0;
function rig(shared={revision:0,payload:null,ops:new Map()},stored=new Map()){
 if(!stored.has('pilot-config'))stored.set('pilot-config',{url:'private-value',deviceId:'private-value',deviceSecret:'private-value',roomEncryptionKey:'private-value'});
 const nodes=new Map(),callbacks={};
 const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',style:{}});return nodes.get(id)};
 const doc={readyState:'complete',querySelector:()=>({append(){}}),
  createElement:()=>({style:{}}),getElementById:element,addEventListener(){}};
 const navigator={onLine:true};
 const deviceStore={
  isUnlocked:()=>true,
  loadNamed:async key=>stored.has(key)?clone(stored.get(key)):null,
  saveNamed:async(key,value)=>{stored.set(key,clone(value))}
 };
 const window={CRWorkStore:deviceStore,CRWorkspaceMerge:merge,CRPWA:{enterPilotMode(){}},
  addEventListener:(name,fn)=>callbacks[name]=fn};
 let pauseSave=null,startedSave=null;
 let waitForFirst=null;
 const transport={
  ping:async()=>true,
  load:async()=>({revision:shared.revision,state:shared.payload?clone(shared.payload):null}),
  prepare:async(shiftId,base,payload)=>({operation:('e'.repeat(31)+String(++nextOperation%10)),shiftId,base,payload:clone(payload)}),
  submit:async packet=>{
   if(!shared.ops.has(packet.operation)){
    if(shared.revision!==Number(packet.base))return{ok:false,conflict:true,serverRevision:shared.revision};
    shared.revision++;
    shared.payload=clone(packet.payload);
    shared.ops.set(packet.operation,{confirmed:true,revision:shared.revision,status:'saved'});
   }
   if(pauseSave){const holding=pauseSave;pauseSave=null;waitForFirst?.();await holding.promise}
   return{ok:true,revision:shared.ops.get(packet.operation).revision}
  },
  receipt:async op=>shared.ops.get(op)||{confirmed:false}
 };
 window.CRRelayTransport={create:async()=>transport};
 new Function('window','document','navigator','setTimeout','clearTimeout','setInterval',source)(
  window,doc,navigator,()=>1,()=>{},()=>{}
 );
 let snapshot={state:{shifts:[],hookahs:[],tables:[],bookings:[],washings:[],vipHours:[],guests:[]},
  shiftId:'',guests:[],lists:null};
 window.CRPilot.bind({
  getSnapshot:()=>clone(snapshot),
  applySnapshot:next=>{snapshot=clone(next)},
  updateStatus:()=>{},
  createShift:()=>{
   snapshot.shiftId='pilot-new';
   snapshot.state.shifts.push({id:'pilot-new',day:'2026-10-18',status:'open'});
   window.CRPilot.onChange();
  },
  closeShift:()=>{
   const shift=snapshot.state.shifts.find(s=>s.status==='open');
   if(shift)shift.status='closed';
   window.CRPilot.onChange();
  }
 });
 for(const field of ['pilot-endpoint','pilot-device-id','pilot-device-secret','pilot-room-key']){
  element(field).value='private-value';
 }
 return{
  app:window.CRPilot,navigator,element,shared,stored,
  getSnapshot:()=>snapshot,
  pauseNext:()=>{
   let ready;
   const triggered=new Promise(resolve=>ready=resolve);
   startedSave=()=>ready();
   waitForFirst=startedSave;
   let release;
   const pending=new Promise(resolve=>release=resolve);
   pauseSave={promise:pending,release};
   return{triggered,release};
  }
 };
}
async function raceAndOfflineClose(){
 const test=rig();
 await test.app.resume();
 assert.equal(test.app.isActive(),true);
 await test.app.openShift({});
 await test.app.flush();
 assert.equal(test.shared.revision,1);
 test.getSnapshot().state.hookahs.push({id:'hookah-1'});
 await test.app.onChange();
 const hold=test.pauseNext();
 const pending=test.app.flush();
 await Promise.race([hold.triggered,new Promise((_,reject)=>setTimeout(()=>reject(Error('POST was not called')),3000))]);
 test.getSnapshot().state.hookahs.push({id:'hookah-2'});
 await test.app.onChange();
 hold.release();
 await pending;
 assert.equal(test.stored.get('pilot-work').dirty,true,'New edit lost while prior POST was in flight');
 await test.app.flush();
 assert.equal(test.shared.payload.state.hookahs.length,2);
 assert.equal(test.stored.get('pilot-work').dirty,false);
 test.navigator.onLine=false;
 await test.app.closeShift();
 assert.equal(test.stored.get('pilot-work').payload.state.shifts[0].status,'closed');
 assert.equal(test.stored.get('pilot-work').dirty,true,'Offline close must queue a durable write');
 test.navigator.onLine=true;
 await test.app.flush();
 assert.equal(test.shared.payload.state.shifts[0].status,'closed');
 assert.equal(test.stored.get('pilot-work').dirty,false);
 console.log('✓ Edits during pending POST, offline close, and reconnect');
}
async function resumeAcknowledgedPost(){
 const base={state:{shifts:[{id:'pilot-abc',status:'open'}],
  hookahs:[{id:'hookah-1'}],tables:[],bookings:[],washings:[],vipHours:[],guests:[]},
  shiftId:'pilot-abc',guests:[],lists:null};
 const oldOperation='a'.repeat(32);
 const shared={revision:9,payload:clone(base),ops:new Map([[oldOperation,{confirmed:true,revision:9,status:'saved'}]])};
 const stored=new Map();
 stored.set('pilot-config',{url:'private-value',deviceId:'private-value',deviceSecret:'private-value',roomEncryptionKey:'private-value'});
 stored.set('pilot-work',{payload:clone(base),revision:8,dirty:true,generation:4,
  pending:{operation:oldOperation,shiftId:'pilot-abc'},pendingGeneration:4});
 const test=rig(shared,stored);
 await test.app.resume();
 assert.equal(test.app.isActive(),true);
 assert.equal(stored.get('pilot-work').revision,9);
 assert.equal(stored.get('pilot-work').pending,null);
 assert.equal(stored.get('pilot-work').dirty,false);
 console.log('✓ Interrupted POST recovery using saved operation receipt');
}
async function resumeWithNewerLocalEdits(){
 const original={state:{shifts:[{id:'pilot-xyz',status:'open'}],
  hookahs:[{id:'hookah-1'}],tables:[],bookings:[],washings:[],vipHours:[],guests:[]},
  shiftId:'pilot-xyz',guests:[],lists:null};
 const edited=clone(original);edited.state.hookahs.push({id:'hookah-2'});
 const op='b'.repeat(32);
 const shared={revision:5,payload:clone(original),ops:new Map([[op,{confirmed:true,revision:5,status:'saved'}]])};
 const stored=new Map();
 stored.set('pilot-config',{url:'private-value',deviceId:'private-value',deviceSecret:'private-value',roomEncryptionKey:'private-value'});
 stored.set('pilot-work',{payload:edited,revision:4,dirty:true,generation:3,
  pending:{operation:op,shiftId:'pilot-xyz'},pendingGeneration:2});
 const test=rig(shared,stored);
 await test.app.resume();
 assert.equal(stored.get('pilot-work').dirty,true,'Later edits must remain pending after old ACK');
 await test.app.flush();
 assert.equal(shared.revision,6);
 assert.equal(shared.payload.state.hookahs.length,2);
 assert.equal(stored.get('pilot-work').dirty,false);
 console.log('✓ Restart with newer edits preserves both hookahs');
}
(async()=>{await raceAndOfflineClose();await resumeAcknowledgedPost();await resumeWithNewerLocalEdits();})()
.catch(error=>{console.error(error);process.exitCode=1});
