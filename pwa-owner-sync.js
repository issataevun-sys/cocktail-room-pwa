'use strict';
/**
 * COCKTAIL ROOM owner pilot — real work.html + encrypted local queue.
 * Feature branch only. NOT production guest/shift storage yet.
 * The original offline test snapshot is NEVER overwritten by this module.
 */
(function(){
 const STORE=()=>window.CRWorkStore;
 let hooks=null,transport=null,local=null,active=false,busy=false,blocked=false;
 let config=null,saveChain=Promise.resolve(),timer=null,lastError='',statusText='Офлайн · ожидает соединения';
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
    'Онлайн · синхронизировано';
  hooks?.updateStatus({dirty:!!local?.dirty,error:lastError});
  showMessage('Статус: '+statusText);
 }
 function persist(){
  if(!local)return Promise.resolve();
  const frozen=clone(local);
  saveChain=saveChain.then(()=>STORE().saveNamed('pilot-work',frozen));
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
 async function flush(){
  if(!active||busy||blocked||!local?.dirty||!local.payload.shiftId)return;
  if(!navigator.onLine){updateStatus('Нет интернета');return}
  busy=true;updateStatus('');
  try{
   await saveChain;
   let generation=local.generation,submitted=null;
   if(local.pending){
    submitted=local.pending;
   }else{
    submitted=await transport.prepare(local.payload.shiftId,local.revision,local.payload);
    local.pending=submitted;
    await persist();
   }
   const result=await transport.submit(submitted);
   if(result.conflict){
    blocked=true;updateStatus('На сервере другая версия. Локальные изменения не потеряны.');
    return;
   }
   if(!result.ok){
    updateStatus(result.error||'Нет подтверждения сервера');
    return;
   }
   local.revision=result.revision;
   local.pending=null;
   if(local.generation===generation)local.dirty=false;
   await persist();
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
  if(busy)return;
  if(local?.dirty){await flush();return}
  try{
   const remote=await transport.load();
   if(remote.revision===local.revision){lastError='';updateStatus('');return}
   if(remote.revision<local.revision)throw Error('Сервер вернул более старую версию');
   if(!remote.state)throw Error('Пустой ответ сервера после сохранения');
   // Never overwrite unsent edits.
   if(local.dirty){blocked=true;updateStatus('Изменения с другого устройства');return}
   local={payload:remote.state,revision:remote.revision,dirty:false,pending:null,generation:0};
   await persist();
   hooks.applySnapshot(local.payload,local.revision,false);
   updateStatus('');
  }catch(error){updateStatus(String(error?.message||error))}
 }
 async function activate(given){
  if(!hooks)throw Error('Экран смены ещё не готов');
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
  }else if(!saved)throw Error('Для первого подключения нужен интернет');
  if(saved){
   local=saved;
   if(remote&&remote.revision>local.revision){
    if(local.dirty){
     blocked=true;lastError='Конфликт: на сервере новая версия';
    }else if(remote.state){
     local={payload:remote.state,revision:remote.revision,dirty:false,pending:null,generation:0};
     await persist();
    }
   }
  }else{
   local=remote?.state?
    {payload:remote.state,revision:remote.revision,dirty:false,pending:null,generation:0}:
    {payload:EMPTY(),revision:0,dirty:false,pending:null,generation:0};
   await persist();
  }
  if(given)await STORE().saveNamed('pilot-config',config);
  hooks.applySnapshot(local.payload,local.revision,!!local.dirty);
  active=true;
  window.CRPWA.enterPilotMode();
  // No secrets remain in the browser inputs.
  ['pilot-device-secret','pilot-room-key'].forEach(id=>{
   const field=document.getElementById(id);if(field)field.value='';
  });
  updateStatus(lastError);
  if(local.dirty&&!blocked)schedule();
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
   '<p style="font-size:12px">Отдельное защищённое подключение. Пока только схема зала и кальяны — без записи в рабочие заказы iiko. Ранее созданная офлайн-смена сохранится отдельно.</p>'+
   '<label>Тестовое развёртывание Apps Script /exec<input id="pilot-endpoint" type="url" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'+
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
  bind:obj=>{hooks=obj},isActive:()=>active,onChange,refresh,flush,
  label:()=>statusText,
  openShift:async args=>{
   if(!active||!hooks)return;
   try{hooks.createShift(args);await persist();schedule()}
   catch(e){updateStatus(String(e?.message||e))}
  },
  closeShift:async()=>{
   if(!active||!hooks)return;
   try{
    if(local?.dirty)await flush();
    if(local?.dirty)throw Error('Есть неподтверждённые изменения');
    hooks.closeShift();await persist();schedule();
   }catch(e){updateStatus(String(e?.message||e))}
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 window.addEventListener('online',()=>{if(active){if(local?.dirty)schedule();else refresh()}});
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
 },45000);
})();
