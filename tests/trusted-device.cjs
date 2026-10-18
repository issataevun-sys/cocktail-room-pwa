'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('secure-work-store.js','utf8');
const data=new Map();
const storage={
 open(){
  const r={result:null};
  setImmediate(()=>{
   const db={
    objectStoreNames:{contains:()=>true},
    createObjectStore(){return {}},
    close(){},
    transaction(name,mode){
     const tx={error:null};
     tx.objectStore=()=>({
      get(id){
       const q={result:null,error:null};
       setImmediate(()=>{q.result=data.get(id)||null;q.onsuccess?.()});
       return q;
      },
      put(row){setImmediate(()=>{data.set(row.id,row);tx.oncomplete?.()});return {}},
      delete(id){setImmediate(()=>{data.delete(id);tx.oncomplete?.()});return {}}
     });
     return tx;
    }
   };
   r.result=db;r.onsuccess?.();
  });
  return r;
 }
};
const window={};
vm.runInNewContext(source,{
 window,indexedDB:storage,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,
 Promise,Date,JSON,Array,Error,String,Set
},{filename:'secure-work-store.js'});
const store=window.CRWorkStore;
const passphrase='Owner-password-2026-example';
const snapshot={state:{shifts:[{id:'shift-real',status:'closed'}],hookahs:[]}};
(async()=>{
 await assert.rejects(()=>store.trustDevice(),/Сначала разблокируй/);
 await store.unlock(passphrase);
 await store.saveNamed('pilot-config',{url:'https://example.org/exec',deviceId:'device-owner',
   deviceSecret:'owner-secret',roomEncryptionKey:'room-key'});
 await store.saveNamed('pilot-work',{payload:snapshot,dirty:false,revision:12});
 assert.equal(await store.trustedDeviceEnabled(),false);
 await store.trustDevice();
 assert.equal(await store.trustedDeviceEnabled(),true);
 const trust=data.get('trusted-owner-key-v1');
 assert.ok(trust.cryptoKey);
 assert.equal(trust.cryptoKey.extractable,false,'Trusted key must be non-extractable');
 assert.ok(!('passphrase' in trust),'Never persist the passphrase itself');
 assert.equal(trust.salt.length,16);
 store.lock();
 assert.equal(store.isUnlocked(),false);
 assert.equal(await store.autoUnlockTrusted(),true,'Trusted device auto unlock works');
 assert.deepEqual(JSON.parse(JSON.stringify(await store.loadNamed('pilot-work'))),{payload:snapshot,dirty:false,revision:12});
 // Restoring offline encrypted shifts must remain possible after auto login.
 await store.saveNamed('pilot-work',{payload:snapshot,dirty:true,revision:13});
 store.lock();
 await store.forgetTrustedDevice();
 assert.equal(await store.trustedDeviceEnabled(),false);
 assert.equal(await store.autoUnlockTrusted(),false,'Revoked trust must force password login');
 await assert.rejects(()=>store.unlock('totally-wrong-password'),/Неверная фраза/);
 await store.unlock(passphrase);
 assert.equal((await store.loadNamed('pilot-work')).revision,13,'Revoking trust leaves all encrypted records intact');
 console.log('✓ Trusted-owner opt-in, non-extractable key, auto resume, revocation and password recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
