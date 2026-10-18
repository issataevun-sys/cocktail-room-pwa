'use strict';
/**
 * COCKTAIL ROOM — production-intent owner relay transport (feature branch).
 * No service credentials in public source. No plaintext guest data in URL.
 * A reliable POST response is impossible in no-CORS mode: verify operation ID
 * with a separately authenticated GET, then safely retry same envelope.
 * The app must persist the FULL envelope encrypted before the first send.
 */
(function(){
 const ENCODER=new TextEncoder(),DECODER=new TextDecoder();
 function id(bytes=16){
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),
   n=>n.toString(16).padStart(2,'0')).join('');
 }
 function b64(bytes){
  let out='';for(const n of bytes)out+=String.fromCharCode(n);
  return btoa(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
 }
 function un64(s){
  const str=atob(String(s).replace(/-/g,'+').replace(/_/g,'/')+
   '='.repeat((4-s.length%4)%4));
  return Uint8Array.from(str,ch=>ch.charCodeAt(0));
 }
 function hex(s){
  if(!/^[a-f0-9]{64}$/.test(s))throw Error('Неверный формат ключа устройства');
  return Uint8Array.from(s.match(/../g),v=>parseInt(v,16));
 }
 function endpoint(value){
  const url=new URL(String(value||'').trim());
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname))
    throw Error('Нужна ссылка защищённого Apps Script /exec');
  return url;
 }
 async function create(config){
  const url=endpoint(config.url);
  const deviceId=String(config.deviceId||'');
  if(!/^[a-f0-9]{32}$/.test(deviceId))throw Error('Неверный ID устройства');
  const secret=String(config.deviceSecret||'');
  const room=String(config.roomEncryptionKey||'');
  hex(secret);hex(room);
  const signingKey=await crypto.subtle.importKey('raw',ENCODER.encode(secret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const contentKey=await crypto.subtle.importKey('raw',hex(room),
   {name:'AES-GCM'},false,['encrypt','decrypt']);
  const sig=async text=>b64(new Uint8Array(
   await crypto.subtle.sign('HMAC',signingKey,ENCODER.encode(text))));
  async function jsonp(params){
   const link=new URL(url.href);
   for(const [key,value] of Object.entries(params))link.searchParams.set(key,String(value));
   return new Promise((resolve,reject)=>{
    const callback='__crRelay_'+id(10),script=document.createElement('script');
    let finished=false,timer;
    function done(err,value){
     if(finished)return;
     finished=true;clearTimeout(timer);script.remove();delete window[callback];
     if(err)reject(err);else resolve(value);
    }
    window[callback]=payload=>done(null,payload);
    script.onerror=()=>done(Error('Сервер не вернул подтверждённый ответ'));
    timer=setTimeout(()=>done(Error('Не получен ответ сервера (15 секунд)')),15000);
    link.searchParams.set('callback',callback);
    script.src=link.href;document.head.appendChild(script);
   });
  }
  async function ping(){
   const res=await jsonp({op:'ping'});
   if(!res?.ok||res.version!=='owner-relay-v1')throw Error('Сервер PWA не готов');
   return true;
  }
  async function load(){
   const nonce=id(16);
   const tag=await sig('load|'+deviceId+'|'+nonce);
   const res=await jsonp({op:'load',device:deviceId,nonce,tag});
   if(!res?.ok)throw Error('Чтение отклонено: '+String(res?.error||'нет ответа'));
   let state=null;
   if(res.iv&&res.cipher){
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(res.iv)},
      contentKey,un64(res.cipher));
    state=JSON.parse(DECODER.decode(clear));
   }
   return {revision:Number(res.revision)||0,shiftId:String(res.shiftId||''),state};
  }
  async function prepare(shiftId,baseRevision,state){
   if(!/^[a-zA-Z0-9_-]{1,90}$/.test(String(shiftId||'')))
    throw Error('Недопустимый ID смены');
   if(!Number.isInteger(baseRevision)||baseRevision<0)
    throw Error('Недопустимая версия смены');
   const iv=crypto.getRandomValues(new Uint8Array(12)),operation=id(16);
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},
    contentKey,ENCODER.encode(JSON.stringify(state)));
   const payload={op:'save',device:deviceId,operation,shiftId,
     base:String(baseRevision),iv:b64(iv),cipher:b64(new Uint8Array(ciphertext))};
   if(payload.cipher.length>330000)
    throw Error('Смена слишком большая для текущей версии обмена');
   payload.tag=await sig('save|'+deviceId+'|'+operation+'|'+shiftId+'|'+baseRevision+
    '|'+payload.iv+'|'+payload.cipher);
   return payload;
  }
  async function receipt(operation){
   const nonce=id(16);
   const tag=await sig('ack|'+deviceId+'|'+operation+'|'+nonce);
   const res=await jsonp({op:'ack',device:deviceId,operation,nonce,tag});
   if(!res?.ok)throw Error('Не удалось проверить подтверждение записи');
   return res;
  }
  async function submit(envelope){
   if(!envelope||envelope.device!==deviceId||
      !/^[a-f0-9]{32}$/.test(String(envelope.operation||'')))
    throw Error('Неверная локальная очередь синхронизации');
   const form=new URLSearchParams(envelope);
   // A no-CORS response is opaque, and a network error does NOT prove the
   // server rejected the request. A stable operationId prevents duplicates.
   let networkError=null;
   try{
    await fetch(url.href,{method:'POST',mode:'no-cors',credentials:'omit',
      redirect:'follow',body:form});
   }catch(error){networkError=String(error?.message||error)}
   for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,i===0?700:1300));
    try{
     const ack=await receipt(envelope.operation);
     if(ack.confirmed&&ack.status==='saved')
      return {ok:true,revision:Number(ack.revision)};
     if(Number(ack.serverRevision)>Number(envelope.base))
      return {ok:false,conflict:true,serverRevision:Number(ack.serverRevision)};
    }catch(error){if(i===3)networkError=String(error?.message||error)}
   }
   return {ok:false,pending:true,error:networkError||'Нет подтверждения сохранения'};
  }
  return Object.freeze({ping,load,prepare,receipt,submit,deviceId});
 }
 window.CRRelayTransport={create};
})();
