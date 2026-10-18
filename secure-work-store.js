'use strict';
/** Device-local encrypted offline snapshot. Encryption key never leaves memory. */
(function(){
 const DB_NAME='cocktail-room-secure-v1',STORE='encrypted',ENCODER=new TextEncoder(),DECODER=new TextDecoder();
 let key=null,salt=null,writeQueue=Promise.resolve();
 const TRUSTED_ID='trusted-owner-key-v1';
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
 async function removeRecord(id){
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).delete(id);
   tx.oncomplete=resolve;
   tx.onabort=()=>reject(tx.error||new Error('Не удалось отменить доверие'));
   tx.onerror=()=>reject(tx.error||new Error('Ошибка записи'));
  })}finally{db.close()}
 }
 async function trustedDeviceEnabled(){
  const record=await read(TRUSTED_ID);
  return !!(record?.cryptoKey&&record?.format===1);
 }
 async function trustDevice(){
  if(!key||!salt)throw Error('Сначала разблокируй хранилище прежней фразой');
  // Enrollment and actual encrypted workspace must already be present:
  // never authorize an unregistered or empty browser as an owner device.
  const config=await loadNamed('pilot-config');
  const state=await loadNamed('pilot-work');
  if(!config?.deviceId||!config?.deviceSecret||!config?.roomEncryptionKey||
      !state?.payload?.state)throw Error('Сначала подключи устройство владельца');
  if(key.extractable!==false||key.algorithm?.name!=='AES-GCM')
   throw Error('Ключ устройства не соответствует требованиям безопасности');
  // A non-extractable CryptoKey is structured-cloned by IndexedDB; the
  // plaintext passphrase is NEVER saved in localStorage/IndexedDB.
  await write({id:TRUSTED_ID,format:1,cryptoKey:key,salt:bytes(salt),
   enabledAt:new Date().toISOString()});
  return true;
 }
 async function forgetTrustedDevice(){
  await removeRecord(TRUSTED_ID);
  return true;
 }
 async function autoUnlockTrusted(){
  if(key)return true;
  const saved=await read(TRUSTED_ID);
  if(!saved)return false;
  if(saved.format!==1||saved.cryptoKey?.type!=='secret'||
     saved.cryptoKey?.algorithm?.name!=='AES-GCM'||
     saved.cryptoKey.extractable!==false||
     !Array.isArray(saved.cryptoKey.usages)||
     !saved.cryptoKey.usages.includes('decrypt')||
     !saved.cryptoKey.usages.includes('encrypt')||
     !Array.isArray(saved.salt))return false;
  // Try decrypting the owner-pairing record BEFORE enabling any key.
  // Corrupt/missing records fall back to the existing password route.
  const config=await read('pilot-config'),workspace=await read('pilot-work');
  if(!config||!workspace||JSON.stringify(config.salt)!==JSON.stringify(saved.salt)||
     JSON.stringify(workspace.salt)!==JSON.stringify(saved.salt))return false;
  try{
   const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(config.iv)},
     saved.cryptoKey,new Uint8Array(config.data));
   const parsed=JSON.parse(DECODER.decode(plain));
   if(!parsed?.deviceId||!parsed?.roomEncryptionKey||!parsed?.deviceSecret)return false;
   const workspacePlain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(workspace.iv)},
     saved.cryptoKey,new Uint8Array(workspace.data));
   const work=JSON.parse(DECODER.decode(workspacePlain));
   if(!work?.payload?.state)return false;
  }catch(e){return false}
  key=saved.cryptoKey;salt=new Uint8Array(saved.salt);
  return true;
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
 window.CRWorkStore={unlock,autoUnlockTrusted,trustDevice,forgetTrustedDevice,trustedDeviceEnabled,save,saveNamed,loadNamed,hasSnapshot:async()=>!!(await read()),isUnlocked:()=>!!key,lock:()=>{key=null;salt=null}};
})();
