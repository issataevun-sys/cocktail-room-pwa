'use strict';
/**
 * COCKTAIL ROOM: encrypted device storage, without any phrase/password login.
 * Enrollment remains server-authorized by a registered device credential.
 * Existing trusted-owner keys and ciphertext remain readable; never erase them.
 */
(function(){
 const DB_NAME='cocktail-room-secure-v1',STORE='encrypted';
 const DEVICE_ID='owner-device-crypto-v2',LEGACY_ID='trusted-owner-key-v1';
 const ENCODER=new TextEncoder(),DECODER=new TextDecoder();
 let key=null,salt=null,writeQueue=Promise.resolve();
 const bytes=a=>Array.from(new Uint8Array(a));
 const allowed=name=>['snapshot','pilot-work','pilot-config','pilot-precleanup','pilot-archive'].includes(name);
 function open(){
  return new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
 }
 async function read(id){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get(id);
   request.onsuccess=()=>resolve(request.result||null);
   request.onerror=()=>reject(request.error);
  })}finally{db.close()}
 }
 async function write(record){
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);
   tx.oncomplete=resolve;
   tx.onabort=()=>reject(tx.error||Error('Запись на устройство прервана'));
   tx.onerror=()=>reject(tx.error||Error('Ошибка сохранения на устройство'));
  })}finally{db.close()}
 }
 function validKey(record){
  const k=record?.cryptoKey;
  return !!(k&&record?.format>=1&&k.type==='secret'&&k.algorithm?.name==='AES-GCM'&&
   k.extractable===false&&Array.isArray(k.usages)&&k.usages.includes('encrypt')&&
   k.usages.includes('decrypt')&&Array.isArray(record.salt)&&record.salt.length===16);
 }
 async function verifyLegacy(record){
  const config=await read('pilot-config'),workspace=await read('pilot-work');
  if(!config||!workspace)return false;
  if(JSON.stringify(config.salt)!==JSON.stringify(record.salt)||
     JSON.stringify(workspace.salt)!==JSON.stringify(record.salt))return false;
  try{
   const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(config.iv)},
      record.cryptoKey,new Uint8Array(config.data));
   const pairing=JSON.parse(DECODER.decode(clear));
   if(!pairing?.deviceId||!pairing?.deviceSecret||!pairing?.roomEncryptionKey)return false;
   const work=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(workspace.iv)},
      record.cryptoKey,new Uint8Array(workspace.data));
   return !!JSON.parse(DECODER.decode(work))?.payload?.state;
  }catch(e){return false}
 }
 async function openDevice(){
  if(key)return true;
  const saved=await read(DEVICE_ID);
  if(saved){
   if(!validKey(saved))throw Error('Ключ устройства повреждён; данные сохранены без изменений');
   key=saved.cryptoKey;salt=new Uint8Array(saved.salt);
   return true;
  }
  const legacy=await read(LEGACY_ID);
  if(legacy){
   if(!validKey(legacy)||!await verifyLegacy(legacy))
    throw Error('Не удалось открыть старую локальную копию. Ничего не удалено; требуется перенос защищённых данных.');
   // Compatibility for previously authorized owner devices, without a phrase prompt.
   key=legacy.cryptoKey;salt=new Uint8Array(legacy.salt);
   return true;
  }
  // Never silently overwrite an older encrypted owner workspace if its key is missing.
  if(await read('pilot-work')||await read('pilot-config'))
   throw Error('На устройстве обнаружена старая зашифрованная смена без ключа доступа. Данные сохранены. Перенос требуется отдельно.');
  const fresh=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const randomSalt=crypto.getRandomValues(new Uint8Array(16));
  await write({id:DEVICE_ID,format:2,cryptoKey:fresh,salt:bytes(randomSalt),createdAt:new Date().toISOString()});
  key=fresh;salt=randomSalt;
  return true;
 }
 async function saveNamed(name,payload){
  if(!allowed(name))throw Error('Недопустимая запись');
  if(!key||!salt)throw Error('Ключ устройства недоступен');
  if(!payload||typeof payload!=='object')throw Error('Недопустимые данные');
  const frozen=JSON.stringify(payload),currentKey=key,currentSalt=bytes(salt);
  const task=async()=>{
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},currentKey,ENCODER.encode(frozen));
   await write({id:name,format:2,salt:currentSalt,iv:bytes(iv),data:bytes(ciphertext),savedAt:new Date().toISOString()});
   return true;
  };
  writeQueue=writeQueue.then(task,task);
  return writeQueue;
 }
 async function loadNamed(name){
  if(!allowed(name))throw Error('Недопустимая запись');
  if(!key||!salt)throw Error('Ключ устройства недоступен');
  const record=await read(name);
  if(!record)return null;
  if(JSON.stringify(record.salt)!==JSON.stringify(bytes(salt)))
   throw Error('Локальная копия зашифрована другим ключом. Записи не затронуты.');
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},
    key,new Uint8Array(record.data));
  return JSON.parse(DECODER.decode(clear));
 }
 window.CRWorkStore={
  openDevice,autoUnlockTrusted:openDevice,loadNamed,saveNamed,
  save:payload=>saveNamed('snapshot',payload),
  hasSnapshot:async()=>!!(await read('snapshot')),
  isUnlocked:()=>!!key,
  trustedDeviceEnabled:async()=>!!(await read(DEVICE_ID)||await read(LEGACY_ID))
 };
})();
