'use strict';
(function(){
 const CHANNEL='cocktail-room-work-v1',HOST='https://issataevun-sys.github.io';
 const KEY='cr-pwa-work-url';
 const overlay=document.createElement('div');
 overlay.id='cr-work-gate';
 overlay.style.cssText='position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#0e1721c9;padding:16px;font-family:Arial,sans-serif';
 overlay.innerHTML='<div style="background:white;max-width:490px;width:100%;border-radius:15px;padding:22px;box-shadow:0 15px 55px #0004">'+
 '<h2 style="margin:0 0 12px">COCKTAIL ROOM · Рабочее приложение</h2>'+
 '<p style="line-height:1.5;color:#596975">Для работы нужна авторизованная Google-сессия. Открой защищённое окно и оставь его открытым. При потере связи редактирование блокируется.</p>'+
 '<label style="display:block;margin-bottom:12px">Адрес Google Apps Script<input id="cr-owner-url" type="url" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #d1d8dc;border-radius:8px;margin-top:6px" placeholder="https://script.google.com/macros/s/.../dev"></label>'+
 '<p id="cr-gate-status" style="color:#7a4c25;font-size:13px">Ожидаем подключения</p>'+
 '<button id="cr-connect" style="padding:12px 20px;background:#18242b;color:white;border:0;border-radius:9px">Подключиться через Google</button>'+
 '<button id="cr-open-original" style="margin-left:6px;padding:12px 14px;border:1px solid #d0d8dc;background:white;border-radius:9px">Открыть рабочую версию</button>'+
 '<div style="margin-top:18px;border-top:1px solid #e2e6e9;padding-top:14px">'+
 '<label>Фраза для шифрования локальной копии (от 12 символов)<input id="cr-offline-secret" type="password" style="box-sizing:border-box;width:100%;padding:11px;border:1px solid #d1d8dc;border-radius:8px;margin-top:5px" autocomplete="new-password"></label>'+
 '<button id="cr-secure-cache" style="margin-top:8px;padding:9px 12px">Разблокировать защищённое хранилище</button>'+
 '<div id="cr-local-preview" style="font-size:12px;color:#5a6c77;margin-top:9px"></div>'+
 '<button id="cr-continue-offline" disabled style="margin-top:10px;padding:10px 12px">Продолжить сохранённую смену офлайн</button></div>'+
 '<p style="font-size:12px;color:#7c8892;margin-top:15px">Офлайн-режим доступен после шифрованного сохранения смены. Изменения отправляются через Google после восстановления связи.</p></div>';
 const enableOffline=document.createElement('button');
 enableOffline.textContent='Включить офлайн';
 enableOffline.id='cr-enable-offline';
 enableOffline.style.cssText='display:none;position:fixed;z-index:9800;right:12px;bottom:12px;background:#1d313a;color:white;padding:11px 16px;border:0;border-radius:10px;box-shadow:0 3px 15px #0003;font:13px Arial,sans-serif';
 const toolbar=document.createElement('div');
 toolbar.id='cr-offline-toolbar';
 toolbar.style.cssText='display:none;position:fixed;z-index:9900;top:10px;left:50%;transform:translateX(-50%);background:#16252c;color:white;padding:9px 12px;border-radius:12px;box-shadow:0 4px 20px #0004;font:12px Arial,sans-serif;align-items:center;gap:10px';
 toolbar.innerHTML='<span id="cr-local-status">Офлайн · изменения на устройстве</span>'+
 '<button id="cr-save-local" style="padding:7px 9px;border-radius:6px">Сохранить локально</button>'+
 '<button id="cr-reconnect" style="padding:7px 9px;border-radius:6px">Подключить Google</button>';
 let nonce='',peer=null,peerOrigin='',popup=null,ready=false,connected=false,lastHeartbeat=0,connectTimer=null;
 const queue=[],pending=new Map();
 let snapshotProvider=null,restoreSnapshot=null,onConnected=null,saveTimer=null,offlineEditing=false,unlockedSnapshot=null;
 const safeUrl=value=>{
  try{const url=new URL(String(value||'').trim());return url.protocol==='https:'&&url.hostname==='script.google.com'&&
   /^\/macros\/s\/[A-Za-z0-9_-]+\/(dev|exec)\/?$/.test(url.pathname)?url.href:''}catch(e){return ''}
 };
 const gate=msg=>{
  connected=false;window.CRPWA.connected=false;
  clearTimeout(connectTimer);
  document.getElementById('cr-gate-status').textContent=msg||'Нет подтверждённого соединения';
  document.getElementById('cr-continue-offline').disabled=!unlockedSnapshot?.state;
  overlay.style.display='grid';
 };
 const receive=event=>{
  const msg=event.data||{};
  if(!nonce||msg.channel!==CHANNEL||msg.nonce!==nonce)return;
  let host='';try{host=new URL(event.origin).hostname}catch(e){}
  if(host!=='script.google.com'&&host!=='script.googleusercontent.com'&&!host.endsWith('.script.googleusercontent.com'))return;
  if(msg.type==='ready'){
   peer=event.source;peerOrigin=event.origin;lastHeartbeat=Date.now();ready=true;
   clearTimeout(connectTimer);
   if(!connected){
    connected=true;offlineEditing=false;window.CRPWA.connected=true;overlay.style.display='none';toolbar.style.display='none';
    enableOffline.style.display=window.CRWorkStore?.isUnlocked()?'none':'block';
    while(queue.length){const job=queue.shift();dispatch(job)}
    if(typeof onConnected==='function')try{onConnected()}catch(e){console.error(e)}
   }
  }
  if(msg.type==='result'){
   const job=pending.get(msg.id);if(!job)return;
   pending.delete(msg.id);clearTimeout(job.timer);lastHeartbeat=Date.now();
   if(msg.ok){try{job.ok?.(msg.result)}catch(e){console.error(e)}}
   else{try{job.fail?.({message:String(msg.error||'Ошибка сервера')})}catch(e){console.error(e)}}
  }
 };
 window.addEventListener('message',receive);
 function dispatch(job){
  if(!connected||!peer){if(offlineEditing){job.fail?.({message:'Для этой операции требуется Google-сервер'});return}queue.push(job);return}
  job.id=crypto.randomUUID();
  job.timer=setTimeout(()=>{
   if(!pending.has(job.id))return;
   pending.delete(job.id);gate('Нет ответа сервера. Проверь Google-окно и интернет.');
   job.fail?.({message:'Прервано соединение с Google. Данные не подтверждены сервером.'});
  },45000);
  pending.set(job.id,job);
  try{peer.postMessage({channel:CHANNEL,nonce,type:'rpc',id:job.id,method:job.method,args:job.args},peerOrigin)}
  catch(error){clearTimeout(job.timer);pending.delete(job.id);gate('Не удалось связаться с Google');job.fail?.({message:String(error)})}
 }
 const allowed=new Set(['crWebTestHealth','crSyncGet','crSyncPut','crLiveOpenShift','crLiveCloseShift','crLiveGetCurrentShift','crGetGuests','crSaveGuest','crGetLists','crListsSave','crListsSetActive','crSetWashingSchedule','crGetHistoricalGuestVisits','crPastShiftIndex','crPastShiftDetail']);
 function runner(ok,fail){
  return new Proxy({}, {get(_,key){
   if(key==='withSuccessHandler')return handler=>runner(handler,fail);
   if(key==='withFailureHandler')return handler=>runner(ok,handler);
   if(key==='then')return undefined;
   if(!allowed.has(String(key)))return undefined;
   return (...args)=>dispatch({method:String(key),args,ok,fail});
  }});
 }
 window.google={script:{run:runner(null,null)}};
 async function persistNow(){
  if(!snapshotProvider||!window.CRWorkStore?.isUnlocked())return false;
  clearTimeout(saveTimer);
  const data=snapshotProvider();
  if(!data?.state)return false;
  await window.CRWorkStore.save(data);
  unlockedSnapshot=data;return true;
 }
 function scheduleEncryptedSnapshot(){
  if(!snapshotProvider||!window.CRWorkStore?.isUnlocked())return;
  clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{
   try{await persistNow()}
   catch(e){console.error('Encrypted copy could not be updated',e)}
  },650);
 }
 window.CRPWA={connected:false,setSnapshotProvider:fn=>{snapshotProvider=fn},
  setRestoreSnapshot:fn=>{restoreSnapshot=fn},setOnConnected:fn=>{onConnected=fn},
  persistEncrypted:scheduleEncryptedSnapshot,saveEncryptedNow:persistNow,isOfflineEditing:()=>offlineEditing};
 const connect=()=>{
  const url=safeUrl(document.getElementById('cr-owner-url').value);
  if(!url){gate('Проверь адрес: нужна ссылка script.google.com/macros/s/.../dev или /exec');return}
  localStorage.setItem(KEY,url);nonce=crypto.randomUUID();peer=null;peerOrigin='';ready=false;
  const bridge=new URL(url);bridge.searchParams.set('view','bridge');bridge.searchParams.set('nonce',nonce);
  popup=window.open(bridge.href,'cr_owner_'+nonce,'width=650,height=620');
  if(!popup){gate('Разреши всплывающие окна Chrome для COCKTAIL ROOM');return}
  document.getElementById('cr-gate-status').textContent='Ожидаем подтверждения подключения из окна Google…';
  clearTimeout(connectTimer);
  connectTimer=setTimeout(()=>{
   if(connected)return;
   gate('Google подтвердил вход, но Chrome не передал сообщение между окнами. Это ограничение текущего моста. Нажми «Открыть рабочую версию» — она продолжит работать без повторного ввода данных.');
  },14000);
 };
 const start=()=>{
  document.body.append(overlay);document.body.append(toolbar);document.body.append(enableOffline);
  enableOffline.onclick=()=>{
   if(!connected)return;
   document.getElementById('cr-gate-status').textContent='Задай фразу для зашифрованной копии. Google-сессия остаётся подключённой.';
   overlay.style.display='grid';
  };
  document.getElementById('cr-owner-url').value=localStorage.getItem(KEY)||'';
  document.getElementById('cr-save-local').onclick=async()=>{
   const label=document.getElementById('cr-local-status');label.textContent='Шифруем и сохраняем…';
   try{await persistNow();label.textContent='Сохранено на этом устройстве · '+new Date().toLocaleTimeString('ru-RU')}
   catch(e){label.textContent='Ошибка сохранения: '+String(e.message||e)}
  };
  document.getElementById('cr-reconnect').onclick=()=>gate('Для синхронизации повторно подключи Google');
  document.getElementById('cr-connect').onclick=connect;
  document.getElementById('cr-open-original').onclick=()=>{
   const url=safeUrl(document.getElementById('cr-owner-url').value);
   if(!url){gate('Сначала укажи правильную ссылку Apps Script');return}
   window.open(url,'_blank','noopener,noreferrer');
  };
  document.getElementById('cr-secure-cache').onclick=async()=>{
   const input=document.getElementById('cr-offline-secret'),preview=document.getElementById('cr-local-preview');
   try{
    const data=await window.CRWorkStore.unlock(input.value);
    input.value='';
    unlockedSnapshot=data||null;
    document.getElementById('cr-continue-offline').disabled=!data?.state;
    const state=data?.state||null;
    if(state){
     const n=state.hookahs?.length||0,day=state.shifts?.[0]?.day||'—';
     preview.textContent='Зашифрованная копия открыта: смена '+day+', кальянов '+n+
      ', броней '+(state.bookings?.length||0)+'. Для редактирования подключись к Google.';
    }else preview.textContent='Хранилище разблокировано. После подключения к Google доступная смена сохранится в зашифрованном виде.';
    if(connected){scheduleEncryptedSnapshot();overlay.style.display='none';enableOffline.style.display='none';}
   }catch(e){preview.textContent='Не удалось открыть хранилище: '+String(e.message||e)}
  };
  document.getElementById('cr-continue-offline').onclick=()=>{
   if(!unlockedSnapshot?.state||!restoreSnapshot)return;
   if(!restoreSnapshot(unlockedSnapshot)){
    document.getElementById('cr-gate-status').textContent='Не удалось восстановить локальную смену';return;
   }
   offlineEditing=true;connected=false;window.CRPWA.connected=false;
   overlay.style.display='none';toolbar.style.display='flex';enableOffline.style.display='none';
  };
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&window.CRWorkStore?.isUnlocked()){
   persistNow().catch(error=>console.error('Не удалось сохранить зашифрованную смену при сворачивании',error));
  }
 });
 window.addEventListener('pagehide',()=>{
  if(window.CRWorkStore?.isUnlocked()){
   persistNow().catch(error=>console.error('Не удалось сохранить зашифрованную смену перед закрытием',error));
  }
 });
 window.addEventListener('offline',()=>{
  if(!offlineEditing)gate('Нет интернета. Открой зашифрованную копию, если она была сохранена.');
 });
 window.addEventListener('online',()=>{
  if(offlineEditing){
   persistNow().catch(error=>console.error('Не удалось сохранить изменения перед подключением',error));
   gate('Интернет восстановлен. Подключи Google для безопасной сверки изменений.');
  }
 });
 setInterval(()=>{
  // Отсутствие запросов не является обрывом соединения. Проверяем окно и сеть.
  if(connected&&(!navigator.onLine||!popup||popup.closed))
   gate('Связь с Google прервана. Подключись снова перед изменениями.');
 },3000);
})();
