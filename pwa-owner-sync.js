'use strict';
/**
 * COCKTAIL ROOM owner pilot — real work.html + encrypted local queue.
 * Feature branch only. NOT production guest/shift storage yet.
 * The original offline test snapshot is NEVER overwritten by this module.
 */
(function(){
 const STORE=()=>window.CRWorkStore;
 let hooks=null,transport=null,local=null,active=false,busy=false,blocked=false;
 let config=null,saveChain=Promise.resolve(),timer=null,lastError='',statusText='Офлайн · ожидает соединения',refreshing=false,lastServerConfirmed=false;
 const EMPTY=()=>({state:{shifts:[],hookahs:[],tables:[],bookings:[],washings:[],vipHours:[],guests:[]},shiftId:'',guests:[],lists:null});
 const clone=o=>JSON.parse(JSON.stringify(o));
 const stamp=()=>new Date().toLocaleTimeString('ru-RU');
 function showMessage(msg){
  const node=document.getElementById('pilot-msg');
  if(node)node.textContent=msg;
 }
 function updateStatus(error){
  lastError=error||'';
  statusText=blocked?'Конфликт · требуется сверка':
    !navigator.onLine?'Офлайн · данные на устройстве':
    lastError?'Ожидание · '+lastError:
    busy?'Синхронизация…':
    local?.dirty?'Ожидает отправки · '+stamp():
    lastServerConfirmed?'Онлайн · синхронизировано':'Ожидаем подтверждения связи';
  hooks?.updateStatus({dirty:!!local?.dirty,error:lastError});
  showMessage('Статус: '+statusText);
 }
 function persist(){
  if(!local)return Promise.resolve();
  const frozen=clone(local);
  saveChain=saveChain.catch(()=>{}).then(()=>STORE().saveNamed('pilot-work',frozen));
  return saveChain;
 }
 function schedule(){
  clearTimeout(timer);
  if(!active||!navigator.onLine||blocked)return;
  timer=setTimeout(()=>flush(),600);
 }
 async function onChange(){
  if(!active||!hooks)return;
  local.payload=hooks.getSnapshot();
  local.generation=(Number(local.generation)||0)+1;
  local.dirty=true;
  // Durable local write is awaited before any network call.
  try{await persist();updateStatus('');schedule()}
  catch(error){blocked=true;updateStatus('Ошибка локальной записи: '+String(error?.message||error))}
 }
 function ensureBase(){
  // Old versions stored no base. A clean local snapshot is a valid baseline;
  // dirty data without a baseline is NOT safe to merge automatically.
  if(local&&!local.base&&!local.dirty)local.base=clone(local.payload);
 }
 async function confirmPending(receipt){
  if(!local?.pending||!receipt?.confirmed||receipt.status!=='saved')return false;
  const acked=Number(receipt.revision);
  if(!Number.isInteger(acked)||acked<local.revision)return false;
  const fullyAcked=Number.isInteger(local.pendingGeneration)&&
    local.pendingGeneration===local.generation;
  let oldSent=local.pendingState||(fullyAcked?clone(local.payload):null);
  if(!oldSent){
   // Previous app versions did not persist pendingState. The exact
   // acknowledged snapshot can still be recovered if the server has not
   // moved past the receipt's revision.
   try{
    const verified=await transport.load();
    if(verified.revision===acked&&verified.state)oldSent=clone(verified.state);
   }catch(e){}
  }
  if(!oldSent){
   blocked=true;
   updateStatus('Не удалось восстановить исходный снимок отправки. Нужна ручная сверка.');
   return false;
  }
  // Move the baseline to the exact data that the server acknowledged.
  local.base=clone(oldSent);
  local.revision=acked;
  local.pending=null;
  local.pendingState=null;
  local.pendingGeneration=null;
  if(fullyAcked)local.dirty=false;
  await persist();
  return true;
 }
 async function reconcile(remote){
  if(!remote||!Number.isInteger(remote.revision)||remote.revision<local.revision)
   throw Error('Сервер вернул недопустимую версию');
  if(remote.revision===local.revision){lastError='';updateStatus('');return true;}
  if(!remote.state||!remote.state.state)
   throw Error('Сервер вернул неполную копию смены');
  if(!local.dirty){
   // Do not allow an in-flight refresh to overwrite a newly created local edit.
   if(local.pending)throw Error('Есть неподтверждённая запись');
   local.payload=clone(remote.state);
   local.revision=remote.revision;
   local.base=clone(remote.state);
   local.generation=0;
   local.conflicts=[];
   hooks.applySnapshot(local.payload,local.revision,false);
   await persist();
   updateStatus('');
   return true;
  }
  if(!local.base){
   blocked=true;local.conflicts=[{path:'',reason:'no_common_baseline'}];
   await persist();
   updateStatus('Нет общей исходной версии. Нужна ручная сверка.');
   return false;
  }
  const result=window.CRWorkspaceMerge.merge(local.base,local.payload,remote.state);
  if(!result.ok){
   blocked=true;
   local.conflicts=result.conflicts.map(x=>({path:x.path,reason:x.reason}));
   await persist();
   updateStatus('Найдены пересекающиеся изменения: '+local.conflicts.length+
    '. Все локальные данные сохранены, сервер не перезаписан.');
   return false;
  }
  const combined=clone(result.merged);
  const differs=JSON.stringify(combined)!==JSON.stringify(remote.state);
  local.payload=combined;
  local.revision=remote.revision;
  local.base=clone(remote.state);
  local.pending=null;
  local.pendingState=null;
  local.pendingGeneration=null;
  local.dirty=differs;
  local.generation=(Number(local.generation)||0)+1;
  local.conflicts=[];
  // Reflect the merged state synchronously, before the first async save.
  hooks.applySnapshot(local.payload,local.revision,local.dirty);
  await persist();
  updateStatus('');
  if(local.dirty)schedule();
  return true;
 }
 async function reconcileConflict(){
  try{
   // Read the receipt before abandoning an ambiguous no-CORS POST.
   if(local.pending){
    const receipt=await transport.receipt(local.pending.operation);
    if(receipt?.confirmed){
     if(!await confirmPending(receipt))return false;
    }else{
     // A confirmed server revision different from our CAS base guarantees
     // that this unacknowledged POST cannot win the old revision.
     const latest=await transport.load();
     if(latest.revision<=Number(local.pending.base))
      return false; // Network race; retry the original ID instead.
     local.pending=null;
     local.pendingState=null;
     local.pendingGeneration=null;
     await persist();
     return reconcile(latest);
    }
   }
   const current=await transport.load();
   if(current.revision===local.revision)return true;
   return reconcile(current);
  }catch(e){
   updateStatus('Проверка конфликта: '+String(e?.message||e));
   return false;
  }
 }
 async function flush(){
  if(!active||busy||blocked||!local?.dirty||!local.payload.shiftId)return;
  if(!navigator.onLine){updateStatus('Нет интернета');return}
  busy=true;updateStatus('');
  try{
   await saveChain;
   // Before creating a new operation, check whether another device wrote.
   // The CAS on the Apps Script server remains the final race protection.
   if(!local.pending){
    const latest=await transport.load();
    lastServerConfirmed=true;
    if(!await reconcile(latest))return;
    if(!local.dirty)return;
   }
   let submitted=local.pending;
   if(!submitted){
    const generation=local.generation;
    const snapshot=clone(local.payload);
    submitted=await transport.prepare(snapshot.shiftId,local.revision,snapshot);
    local.pending=submitted;
    local.pendingState=snapshot;
    local.pendingGeneration=generation;
    await persist(); // durable envelope BEFORE network
   }
   const result=await transport.submit(submitted);
   if(result.conflict){
    // A competing device won; use conservative three-way merge.
    await reconcileConflict();
    return;
   }
   if(!result.ok){
    updateStatus(result.error||'Нет подтверждения сервера');
    return;
   }
   const receipt={confirmed:true,status:'saved',revision:result.revision};
   if(!await confirmPending(receipt))return;
   lastServerConfirmed=true;
   updateStatus('');
  }catch(error){updateStatus(String(error?.message||error))}
  finally{
   busy=false;
   updateStatus(lastError);
   if(local?.dirty&&!blocked&&!lastError)schedule();
  }
 }
 async function refresh(){
  if(!active||!transport)return;
  if(!navigator.onLine){updateStatus('Нет интернета');return}
  if(busy||refreshing)return;
  if(local?.dirty){await flush();return}
  refreshing=true;
  try{
   const remote=await transport.load();
   lastServerConfirmed=true;
   await reconcile(remote);
  }catch(error){updateStatus(String(error?.message||error))}
  finally{refreshing=false;}
 }
 async function activate(given){
  if(!hooks)throw Error('Экран смены ещё не готов');
  if(!window.CRWorkspaceMerge)throw Error('Отсутствует модуль безопасного объединения');
  if(!STORE()?.isUnlocked())throw Error('Сначала разблокируй зашифрованное хранилище');
  const old=await STORE().loadNamed('pilot-config');
  config=given||old;
  if(!config)throw Error('Сначала укажи данные зарегистрированного устройства владельца');
  transport=await window.CRRelayTransport.create(config);
  const saved=await STORE().loadNamed('pilot-work');
  if(saved&&(!saved.payload||!saved.payload.state||
       String(saved.payload.shiftId||'').startsWith('local-test-')))
    throw Error('Неизвестный формат или тестовая смена в хранилище пилота');
  let remote=null;
  if(navigator.onLine){
   await transport.ping();
   remote=await transport.load();
   lastServerConfirmed=true;
  }else if(!saved)throw Error('Для первого подключения нужен интернет');
  if(saved){
   local=saved;
   // A previously detected same-record conflict survives app restarts.
   if(Array.isArray(local.conflicts)&&local.conflicts.length){
    blocked=true;
    lastError='Есть нерешённый конфликт: '+local.conflicts.map(c=>c.path).join(', ').slice(0,180);
   }
   ensureBase();
   if(!blocked&&remote&&local.pending&&remote.revision>local.revision){
    let receipt=null;
    try{receipt=await transport.receipt(local.pending.operation)}catch(e){}
    if(receipt?.confirmed)await confirmPending(receipt);
   }
   if(!blocked&&remote&&remote.revision>local.revision){
    await reconcile(remote);
   }
  }else{
   local=remote?.state?
    {payload:clone(remote.state),base:clone(remote.state),revision:remote.revision,
      dirty:false,pending:null,generation:0,conflicts:[]}:
    {payload:EMPTY(),base:EMPTY(),revision:0,dirty:false,pending:null,
      generation:0,conflicts:[]};
   await persist();
  }
  if(given)await STORE().saveNamed('pilot-config',config);
  hooks.applySnapshot(local.payload,local.revision,!!local.dirty);
  active=true;
  window.CRPWA.enterPilotMode();
  // Never print or send enrollment secrets in logs or to GitHub.
  ['pilot-device-secret','pilot-room-key'].forEach(id=>{
   const field=document.getElementById(id);if(field)field.value='';
  });
  updateStatus(lastError);
  if(local.dirty&&!blocked)schedule();
 }

 // Owner-only manual cleanup of explicitly selected IDs. No name heuristics,
 // no deletion of open shifts, and no mutation of normalized Google Sheets.
 function cleanupBuild(snapshot,selection){
  const state=snapshot?.state||{};
  const pick=name=>{
   const values=selection?.[name]||[];
   if(!Array.isArray(values)||values.some(x=>typeof x!=='string'||!x||x.length>120))
    throw Error('Недопустимый список для удаления: '+name);
   if(new Set(values).size!==values.length)throw Error('Повторное выделение записи');
   return new Set(values);
  };
  const shifts=pick('shiftIds'),orders=pick('orderIds'),guests=pick('guestIds'),bookings=pick('bookingIds');
  if(!shifts.size&&!orders.size&&!guests.size&&!bookings.size)throw Error('Сначала отметь записи для удаления');
  const arr=x=>Array.isArray(x)?x:[];
  const allShifts=arr(state.shifts),allOrders=arr(state.hookahs);
  for(const id of shifts){
   const row=allShifts.find(x=>x.id===id);
   if(!row)throw Error('Смена уже изменилась. Открой очистку заново.');
   if(row.status!=='closed')throw Error('Нельзя удалять открытую смену');
  }
  for(const id of orders)if(!allOrders.some(x=>x.id===id))
   throw Error('Кальян уже изменился. Открой очистку заново.');
  for(const id of bookings)if(!arr(state.bookings).some(x=>x.id===id))
   throw Error('Бронь уже изменилась. Открой очистку заново.');
  const guestRows=arr(snapshot.guests).concat(arr(state.guests));
  for(const id of guests)if(!guestRows.some(x=>x.id===id))
   throw Error('Гость уже изменился. Открой очистку заново.');
  const removeOrder=o=>orders.has(o.id)||shifts.has(o.shiftId);
  const retainedOrders=allOrders.filter(o=>!removeOrder(o));
  const retainedBookings=arr(state.bookings).filter(b=>!shifts.has(b.shiftId)&&!bookings.has(b.id));
  for(const id of guests){
   const g=guestRows.find(x=>x.id===id);
   const usesGuest=o=>o.guestId===id||o.guestID===id||
    (g.name&&String(o.guest||'').trim().toLowerCase()===String(g.name).trim().toLowerCase());
   if(retainedOrders.some(usesGuest)||retainedBookings.some(usesGuest))
    throw Error('Гость «'+String(g.name||id)+'» используется в оставшихся кальянах или бронях. Сначала удали связанные тестовые записи.');
  }
  const result=clone(snapshot);
  if(!Array.isArray(result.state.shifts)||!Array.isArray(result.state.hookahs))
   throw Error('Неизвестная структура базы, очистка остановлена');
  const removed={shifts:shifts.size,hookahs:allOrders.filter(removeOrder).length,
   bookings:arr(state.bookings).filter(b=>shifts.has(b.shiftId)||bookings.has(b.id)).length,
   guests:arr(snapshot.guests).filter(g=>guests.has(g.id)).length+
    arr(state.guests).filter(g=>guests.has(g.id)).length};
  for(const key of ['shifts','hookahs','tables','bookings','washings','vipHours']){
   if(!Array.isArray(result.state[key]))continue;
   result.state[key]=result.state[key].filter(x=>
    key==='shifts'?!shifts.has(x.id):
    key==='hookahs'?!removeOrder(x):
    key==='bookings'?(!shifts.has(x.shiftId)&&!bookings.has(x.id)):
    !shifts.has(x.shiftId));
  }
  if(Array.isArray(result.state.guests))
   result.state.guests=result.state.guests.filter(x=>!guests.has(x.id));
  if(Array.isArray(result.guests))
   result.guests=result.guests.filter(x=>!guests.has(x.id));
  return {payload:result,removed};
 }
 async function cleanupSelected(selection){
  if(!active||!hooks||!local)throw Error('Сначала подключи MANAGEMENT');
  if(!navigator.onLine||busy||refreshing||local.dirty||local.pending||blocked)
   throw Error('Очистка возможна только при статусе «Онлайн · синхронизировано»');
  busy=true;updateStatus('');
  let committed=false;
  try{
   await saveChain;
   const generation=local.generation,revision=local.revision;
   const original=clone(local.payload);
   // Before any destructive operation, independently verify fresh server state.
   const remote=await transport.load();
   if(remote.revision!==revision){
    await reconcile(remote);
    throw Error('Данные на другом устройстве изменились. Открой очистку заново.');
   }
   if(local.generation!==generation||local.dirty||
      JSON.stringify(local.payload)!==JSON.stringify(original))
    throw Error('Данные изменились во время проверки. Открой очистку заново.');
   const plan=cleanupBuild(original,selection);
   // Write-once encrypted recovery point: repeated cleanups never replace
   // the original pre-cleanup data; Google Sheets also has owner backup.
   const previous=await STORE().loadNamed('pilot-precleanup');
   if(!previous)await STORE().saveNamed('pilot-precleanup',{
    payload:original,revision,createdAt:new Date().toISOString(),
    reason:'MANAGEMENT owner manual cleanup'
   });
   if(local.generation!==generation||local.dirty||
      JSON.stringify(local.payload)!==JSON.stringify(original))
    throw Error('Изменения во время резервирования. Очистка отменена.');
   local.payload=plan.payload;
   local.generation=(Number(local.generation)||0)+1;
   local.dirty=true;
   try{await persist();committed=true;}catch(e){
    local.payload=original;local.generation=generation;
    blocked=true;
    throw Error('Не удалось зашифрованно сохранить очистку: '+String(e.message||e));
   }
   hooks.applySnapshot(local.payload,local.revision,true);
   return {removed:plan.removed,locallySaved:true};
  }finally{
   busy=false;updateStatus('');
   if(committed)schedule();
  }
 }
 function fields(){
  const get=id=>String(document.getElementById(id)?.value||'').trim();
  return {url:get('pilot-endpoint'),deviceId:get('pilot-device-id'),
   deviceSecret:get('pilot-device-secret'),roomEncryptionKey:get('pilot-room-key')};
 }
 function mount(){
  const gate=document.querySelector('#cr-work-gate>div');
  if(!gate)return;
  const panel=document.createElement('section');
  panel.style.cssText='border-top:1px solid #e0e5e8;padding-top:13px;margin-top:18px;font-size:13px;color:#364c58';
  panel.innerHTML='<h3 style="margin:0 0 8px">Смена владельца · синхронизация PWA</h3>'+
   '<p style="font-size:12px">Две установки MANAGEMENT с одной зашифрованной базой. Независимые изменения объединяются; пересекающиеся блокируются до ручной сверки. Данные пока не отражаются в iiko.</p>'+
   '<label>Развёртывание Apps Script /exec<input id="pilot-endpoint" type="url" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'+
   '<label>ID устройства владельца<input id="pilot-device-id" autocapitalize="off" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'+
   '<label>Личный секрет устройства<input id="pilot-device-secret" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'+
   '<label>Ключ шифрования комнаты<input id="pilot-room-key" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'+
   '<button id="pilot-connect" style="padding:11px 12px;margin-top:9px">Подключить смену владельца</button>'+
   '<button id="pilot-resume" style="padding:11px 12px;margin:9px 0 0 6px">Продолжить сохранённую смену владельца</button>'+
   '<p id="pilot-msg" style="font-size:12px;color:#6c4950;margin-top:8px">Разблокируй хранилище перед подключением.</p>';
  gate.append(panel);
  document.getElementById('pilot-connect').onclick=async()=>{
   showMessage('Проверяем защищённое соединение…');
   try{await activate(fields())}catch(e){showMessage('Не удалось подключить: '+String(e?.message||e))}
  };
  document.getElementById('pilot-resume').onclick=async()=>{
   showMessage('Открываем сохранённую смену владельца…');
   try{await activate(null)}catch(e){showMessage('Не удалось восстановить: '+String(e?.message||e))}
  };
 }
 window.CRPilot={
  bind:obj=>{hooks=obj},isActive:()=>active,onChange,refresh,flush,cleanupSelected,
  label:()=>statusText,
  openShift:async args=>{
   if(!active||!hooks)return;
   try{hooks.createShift(args);await persist();schedule()}
   catch(e){updateStatus(String(e?.message||e))}
  },
  closeShift:async()=>{
   if(!active||!hooks||blocked)return;
   try{
    // Closing is a LOCAL action. Internet and server ACK are not required.
    // The hook calls save(); a second awaited onChange ensures its new
    // closed status reaches encrypted IndexedDB before we report success.
    hooks.closeShift();
    await onChange();
    if(blocked)throw Error('Сохранение закрытой смены на устройстве не удалось');
    schedule();
   }catch(e){updateStatus(String(e?.message||e))}
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 window.addEventListener('online',()=>{if(active){if(local?.dirty)schedule();else refresh()}});
 window.addEventListener('offline',()=>{if(active)updateStatus('')});
 window.addEventListener('focus',()=>{if(active&&navigator.onLine){if(local?.dirty)schedule();else refresh()}});
 document.addEventListener('visibilitychange',()=>{
  if(active&&document.visibilityState==='visible'&&navigator.onLine){
   if(local?.dirty)schedule();else refresh();
  }
 });
 setInterval(()=>{
  if(active&&navigator.onLine&&!busy&&!blocked){
   if(local?.dirty)schedule();else refresh();
  }
 },15000);
})();
