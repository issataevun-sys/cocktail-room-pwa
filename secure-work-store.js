'use strict';
/** Device-local encrypted offline snapshot. Encryption key never leaves memory. */
(function(){
 const DB_NAME='cocktail-room-secure-v1',STORE='encrypted',ENCODER=new TextEncoder(),DECODER=new TextDecoder();
 let key=null,salt=null,writeQueue=Promise.resolve();
 const bytes=a=>Array.from(new Uint8Array(a));
 const buffer=a=>new Uint8Array(a).buffer;
 function open(){
  return new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
 }
 async function read(name='snapshot'){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(name);
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
  const saved=(await read())||(await read('pilot-work'))||(await read('pilot-config'));
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
  return saveNamed('snapshot',payload);
 }
 async function saveNamed(name,payload){
  if(!['snapshot','pilot-work','pilot-config','pilot-precleanup'].includes(name))throw new Error('Недопустимый ключ локального хранения');
  if(!key||!salt)throw new Error('Локальное шифрование не разблокировано');
  if(!payload||typeof payload!=='object')throw new Error('Invalid snapshot');
  const frozen=JSON.stringify(payload),currentKey=key,currentSalt=bytes(salt);
  const task=async()=>{
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},currentKey,ENCODER.encode(frozen));
   await write({id:name,format:1,salt:currentSalt,iv:bytes(iv),data:bytes(ciphertext),savedAt:new Date().toISOString()});
   return true;
  };
  writeQueue=writeQueue.then(task,task);
  return writeQueue;
 }
 async function loadNamed(name){
  if(!['snapshot','pilot-work','pilot-config','pilot-precleanup'].includes(name))throw new Error('Недопустимый ключ локального хранения');
  if(!key)throw new Error('Сначала разблокируй защищённое хранилище');
  const record=await read(name);
  if(!record)return null;
  if(!salt||JSON.stringify(record.salt)!==JSON.stringify(bytes(salt)))throw new Error('Несовместимая соль шифрования');
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},key,new Uint8Array(record.data));
  return JSON.parse(DECODER.decode(clear));
 }
 window.CRWorkStore={unlock,save,saveNamed,loadNamed,hasSnapshot:async()=>!!(await read()),isUnlocked:()=>!!key,lock:()=>{key=null;salt=null}};
})();
