'use strict';
/** Device-local encrypted offline snapshot. Encryption key never leaves memory. */
(function(){
 const DB_NAME='cocktail-room-secure-v1',STORE='encrypted',ENCODER=new TextEncoder(),DECODER=new TextDecoder();
 let key=null,salt=null;
 const bytes=a=>Array.from(new Uint8Array(a));
 const buffer=a=>new Uint8Array(a).buffer;
 function open(){
  return new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
 }
 async function read(){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get('snapshot');
   r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
  })}finally{db.close()}
 }
 async function write(record){
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(record);
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Локальное сохранение прервано'));
   tx.onerror=()=>reject(tx.error||new Error('Ошибка записи'));
  })}finally{db.close()}
 }
 async function derive(secret,s){
  if(typeof secret!=='string'||secret.length<12)throw new Error('Для локального шифрования нужна фраза от 12 символов');
  const material=await crypto.subtle.importKey('raw',ENCODER.encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:350000,hash:'SHA-256'},
    material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 }
 async function unlock(secret){
  const saved=await read();
  const rawSalt=saved?new Uint8Array(saved.salt):crypto.getRandomValues(new Uint8Array(16));
  const candidate=await derive(secret,rawSalt);
  let payload=null;
  if(saved){
   try{
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(saved.iv)},candidate,new Uint8Array(saved.data));
    payload=JSON.parse(DECODER.decode(clear));
   }catch(e){throw new Error('Неверная фраза или повреждённая локальная копия')}
  }
  key=candidate;salt=rawSalt;return payload;
 }
 async function save(payload){
  if(!key||!salt)throw new Error('Локальное шифрование не разблокировано');
  if(!payload||typeof payload!=='object')throw new Error('Invalid snapshot');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,ENCODER.encode(JSON.stringify(payload)));
  await write({id:'snapshot',format:1,salt:bytes(salt),iv:bytes(iv),data:bytes(ciphertext),savedAt:new Date().toISOString()});
  return true;
 }
 window.CRWorkStore={unlock,save,hasSnapshot:async()=>!!(await read()),isUnlocked:()=>!!key,lock:()=>{key=null;salt=null}};
})();
