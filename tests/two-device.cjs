'use strict';
/* Simulates TWO real app instances with isolated encrypted storage and one CAS server.
 * Crypto + cross-origin transport were verified separately on iPhone; here the
 * actual owner sync client and merge engine are run, not illustrative pseudocode.
 */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const merge=require('../pwa-workspace-merge.js');
const source=fs.readFileSync('pwa-owner-sync.js','utf8');
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
let seed=0;
const server={revision:0,payload:null,receipts:new Map(),saves:[]};
function connect(name){
 const records=new Map(),inputs=new Map(),n={onLine:true};
 const el=id=>{if(!inputs.has(id))inputs.set(id,{value:name,textContent:'',style:{}});return inputs.get(id)};
 const doc={readyState:'complete',querySelector:()=>({append(){}}),
  createElement:()=>({style:{}}),getElementById:el,addEventListener(){}};
 const store={isUnlocked:()=>true,saveNamed:async(key,v)=>{records.set(key,copy(v))},
  loadNamed:async key=>copy(records.get(key)||null)};
 const transport={
  ping:async()=>true,
  load:async()=>({revision:server.revision,state:copy(server.payload)}),
  prepare:async(shiftId,base,payload)=>({
   operation:String(++seed).padStart(32,'0'),shiftId,base:String(base),
   payload:copy(payload)
  }),
  receipt:async operation=>copy(server.receipts.get(operation)||{confirmed:false}),
  submit:async packet=>{
   if(server.receipts.has(packet.operation))return{ok:true,revision:server.receipts.get(packet.operation).revision};
   if(Number(packet.base)!==server.revision)return{ok:false,conflict:true,serverRevision:server.revision};
   server.revision++;
   server.payload=copy(packet.payload);
   server.saves.push({revision:server.revision,who:name});
   server.receipts.set(packet.operation,{confirmed:true,status:'saved',revision:server.revision});
   return{ok:true,revision:server.revision};
  }
 };
 const win={CRWorkStore:store,CRRelayTransport:{create:async()=>transport},CRWorkspaceMerge:merge,
  CRPWA:{enterPilotMode(){}},addEventListener(){}};
 new Function('window','document','navigator','setTimeout','clearTimeout','setInterval',source)(
  win,doc,n,()=>1,()=>{},()=>{}
 );
 let state=null,status=null;
 win.CRPilot.bind({
  getSnapshot:()=>copy(state),
  applySnapshot:payload=>{state=copy(payload)},
  updateStatus:next=>{status=next},
  createShift:({day,waiter})=>{
   if(!state.shiftId)state.shiftId='pilot-workspace';
   state.state.shifts.push({id:'shift-1',day,waiter,status:'open'});
   win.CRPilot.onChange();
  },
  closeShift:()=>{
   state.state.shifts.find(s=>s.status==='open').status='closed';win.CRPilot.onChange();
  }
 });
 return {name,app:win.CRPilot,records,n,el,
  open:async()=>{await el('pilot-connect').onclick();assert.equal(win.CRPilot.isActive(),true)},
  local:()=>copy(state),saved:()=>copy(records.get('pilot-work')),
  edit:async fn=>{fn(state);await win.CRPilot.onChange()},status:()=>status};
}
async function run(){
 const a=connect('iPhone');
 await a.open();
 await a.app.openShift({day:'2026-10-19',waiter:'Тест'});
 await a.app.flush();
 assert.equal(server.revision,1);
 const b=connect('Windows');
 await b.open();
 assert.equal(b.local().state.shifts.length,1);
 // Both start at revision one. Distinct hookah IDs must be merged.
 await a.edit(s=>s.state.hookahs.push({id:'hookah-A',shiftId:'shift-1',table:35,price:5000}));
 await b.edit(s=>s.state.hookahs.push({id:'hookah-B',shiftId:'shift-1',table:36,price:6000}));
 await a.app.flush();
 await b.app.flush();
 await a.app.refresh();
 assert.deepEqual(server.payload.state.hookahs.map(h=>h.id).sort(),['hookah-A','hookah-B']);
 assert.deepEqual(a.local().state.hookahs.map(h=>h.id).sort(),['hookah-A','hookah-B']);
 assert.deepEqual(b.local().state.hookahs.map(h=>h.id).sort(),['hookah-A','hookah-B']);
 // Offline edit on iPhone while Windows writes another independent hookah.
 a.n.onLine=false;
 await a.edit(s=>s.state.hookahs.push({id:'hookah-offline',shiftId:'shift-1',table:37,price:5000}));
 await b.edit(s=>s.state.hookahs.push({id:'hookah-win',shiftId:'shift-1',table:38,price:5000}));
 await b.app.flush();
 assert.equal(server.payload.state.hookahs.length,3);
 a.n.onLine=true;
 await a.app.flush();
 await b.app.refresh();
 assert.equal(server.payload.state.hookahs.length,4);
 assert.equal(a.local().state.hookahs.length,4);
 assert.equal(b.local().state.hookahs.length,4);
 // Different collections (guest records and catalog) must also merge.
 await a.edit(s=>s.guests.push({id:'guest-A',name:'ТЕСТ'}));
 await b.edit(s=>{s.lists=s.lists||{flavors:[],bowls:[],hookahs:[],cooling:[],prices:[]};
  s.lists.flavors.push({id:'flavor-B',name:'Тест',brand:'BB',active:true})});
 await a.app.flush();
 await b.app.flush();
 await a.app.refresh();
 assert.equal(server.payload.guests.length,1);
 assert.equal(server.payload.lists.flavors.length,1);
 // Same record edit is NOT safe. Never overwrite without owner decision.
 await a.edit(s=>{s.state.hookahs.find(h=>h.id==='hookah-A').price=4000});
 await b.edit(s=>{s.state.hookahs.find(h=>h.id==='hookah-A').price=3000});
 await a.app.flush();
 const revBefore=server.revision;
 await b.app.flush();
 assert.equal(server.revision,revBefore,'conflicted device must not overwrite server');
 assert.equal(server.payload.state.hookahs.find(h=>h.id==='hookah-A').price,4000);
 assert.equal(b.saved().payload.state.hookahs.find(h=>h.id==='hookah-A').price,3000);
 assert.equal(b.saved().conflicts.length,1);
 assert.match(b.saved().conflicts[0].path,/state\.hookahs\[hookah-A\]/);
 // Unrelated, offline closing still works on the clean iPhone.
 a.n.onLine=false;
 await a.app.closeShift();
 assert.equal(a.saved().payload.state.shifts[0].status,'closed');
 assert.equal(a.saved().dirty,true);
 a.n.onLine=true;
 await a.app.flush();
 assert.equal(server.payload.state.shifts[0].status,'closed');
 console.log('PASS: two-device online, independent merge, offline/reconnect, guest+catalog merge, same-record conflict, offline close.');
 console.log('Server revision='+server.revision+', confirmed writes='+server.saves.length);
}
run().catch(e=>{console.error(e);process.exitCode=1});
