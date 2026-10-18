'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

function source(path){return fs.readFileSync(path,'utf8')}
const html=source('work.html');
const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert.equal(inline.length,1,'Exactly one inline script is expected');
for(const path of ['pwa-work-client.js','secure-work-store.js','pwa-relay-transport.js','pwa-workspace-merge.js','pwa-owner-sync.js','sw.js']){
 new vm.Script(source(path),{filename:path});
}
new vm.Script(inline[0],{filename:'work.html:inline'});
console.log('✓ All application JavaScript sources parse');
for(const file of ['pwa-owner-sync.js','pwa-workspace-merge.js','pwa-relay-transport.js','secure-work-store.js']){
 assert.ok(html.includes('<script src="./'+file+'"></script>'),'Missing '+file);
}
assert.ok(html.includes("if(tab==='past'){if(syncMode==='pilot')pilotPastRender()"),'PWA history not wired');
assert.ok(html.includes("if(syncMode==='pilot'){\n   if(!record.name)"),'Owner list editor not connected');
assert.ok(html.includes("if(syncMode==='pilot'){\n   if(!entry.name)"),'Owner guest editor not connected');
assert.ok(!source('pwa-owner-sync.js').includes('localStorage.setItem'), 'No secrets in localStorage');
assert.ok(source('sw.js').includes('pwa-owner-sync.js'),'PWA offline shell missing');
console.log('✓ Guest, catalog, shift history and offline script wiring');

const start=html.indexOf('window.CRPilot?.bind({');
const end=html.indexOf('});\nwindow.CRPWA.setSnapshotProvider',start);
assert.ok(start>0&&end>start,'Expected PWA shift binding');
const snippet=html.slice(start,end+3).replace('window.CRPilot?.bind({','pilot.bind({');
let painted=0,changes=0,uid=0;
const stateMachine=new Function('pilot','crypto','syncClone','LIST_CATALOG','REMOTE_GUESTS','paint','renderSyncStatus','localDay',`
 let data={shifts:[{id:'pilot-original',day:'2026-10-18',status:'open',waiter:'ТЕСТ',employees:['ТЕСТ']}],
   hookahs:[{id:'order-original',shiftId:'pilot-original',table:35,price:5000}],
   tables:[],bookings:[],washings:[],vipHours:[],guests:[]};
 let syncShiftId='pilot-original',syncMode='pilot',tab='shifts',syncRevision=3,syncDirty=0,
   syncBusy=false,syncError='',remoteGuestsLoaded=false,flavorCatalogLoaded=false;
 function openShift(){return data.shifts.find(x=>x.status==='open')||null};
 function save(){syncDirty++;pilot.onChange()};
 ${snippet}
 return {getState:()=>({data:JSON.parse(JSON.stringify(data)),syncShiftId,syncDirty,open:openShift(),tab})};
`);
const pilot={hooks:null,bind(value){this.hooks=value},onChange(){changes++}};
const ctx=stateMachine(pilot,{randomUUID:()=>String(++uid)},
 x=>JSON.parse(JSON.stringify(x)),{},[],()=>painted++,()=>{},()=> '2026-10-18');
const first=ctx.getState();
pilot.hooks.closeShift();
const closed=ctx.getState();
assert.equal(closed.open,null,'Offline close must succeed without server');
assert.equal(closed.data.hookahs.length,1,'Closing shift must not clear hookahs');
assert.equal(closed.syncShiftId,first.syncShiftId,'Workspace ID cannot change');
pilot.hooks.createShift({day:'2026-10-19',waiter:'Новый'});
const next=ctx.getState();
assert.equal(next.data.shifts.length,2,'History of previous shift preserved');
assert.equal(next.data.hookahs[0].id,'order-original','Closed orders retained');
assert.equal(next.syncShiftId,first.syncShiftId,'Server revision context preserved');
assert.ok(next.open&&next.open.id!=='pilot-original','New open shift');
assert.throws(()=>pilot.hooks.createShift({day:'2026-10-20',waiter:'Два'}),/Сначала закрой/);
pilot.hooks.closeShift();
assert.throws(()=>pilot.hooks.createShift({day:'2026-10-18',waiter:'Дубликат'}),/уже существует/);
assert.ok(changes>=3&&painted>=3,'UI and persistence notified');
console.log('✓ Offline close -> next shift -> history and duplicate protection');
