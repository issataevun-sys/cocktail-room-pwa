'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('secure-work-store.js','utf8');

function createStore(data){
 const storage={
  open(){
   const req={result:null};
   setImmediate(()=>{
    const db={
     objectStoreNames:{contains:()=>true},createObjectStore(){return{}},close(){},
     transaction(){
      const tx={error:null};
      tx.objectStore=()=>({
       get(id){
        const r={result:null,error:null};
        setImmediate(()=>{r.result=data.get(id)||null;r.onsuccess?.()});
        return r;
       },
       put(value){setImmediate(()=>{data.set(value.id,value);tx.oncomplete?.()});return{}}
      });
      return tx;
     }
    };
    req.result=db;req.onsuccess?.();
   });return req;
  }
 };
 const window={};
 vm.runInNewContext(source,{window,indexedDB:storage,crypto:webcrypto,
  TextEncoder,TextDecoder,Uint8Array,Promise,Date,JSON,Array,Error,String,Set},
  {filename:'secure-work-store.js'});
 return window.CRWorkStore;
}

(async()=>{
 assert.ok(!source.includes('function derive('),'No phrase key derivation exists');
 assert.ok(!source.includes('unlock(secret)'),'No password unlock route exists');
 const data=new Map(),first=createStore(data);
 assert.equal(first.isUnlocked(),false);
 assert.equal(await first.openDevice(),true);
 assert.equal(first.isUnlocked(),true);
 const key=data.get('owner-device-crypto-v2');
 assert.ok(key?.cryptoKey,'Device-bound encryption key created');
 assert.equal(key.cryptoKey.extractable,false,'Device encryption key is non-extractable');
 assert.equal(key.cryptoKey.algorithm.name,'AES-GCM');
 const payload={state:{shifts:[{id:'real-shift',status:'closed'}],hookahs:[{id:'real-order'}]},
  guests:[{id:'real-guest',name:'Example'}]};
 await first.saveNamed('pilot-config',{url:'https://example.org/exec',
  deviceId:'owner-device',deviceSecret:'secret',roomEncryptionKey:'room-key'});
 await first.saveNamed('pilot-work',{payload,revision:15,dirty:true});
 const oldCipher=data.get('pilot-work');
 assert.equal(JSON.stringify(oldCipher).includes('real-order'),false,'No plaintext in local cache');
 const restarted=createStore(data);
 assert.equal(restarted.isUnlocked(),false);
 assert.equal(await restarted.openDevice(),true,'Existing device opens without phrase');
 assert.deepEqual(JSON.parse(JSON.stringify(await restarted.loadNamed('pilot-work'))),
  {payload,revision:15,dirty:true},'Offline changes preserved through restart');

 // A previously encrypted workspace without its original trusted key must
 // remain untouched. Do not generate a new key over inaccessible ciphertext.
 const orphan=new Map([['pilot-work',oldCipher]]);
 const unsupported=createStore(orphan);
 await assert.rejects(()=>unsupported.openDevice(),/старая зашифрованная смена/);
 assert.equal(orphan.get('pilot-work'),oldCipher,'Old encrypted state not destroyed');
 assert.equal(orphan.has('owner-device-crypto-v2'),false,'No silent incompatible rekey');
 console.log('✓ One device-bound key, no phrase route, restart, offline data and safe legacy lock');
})().catch(error=>{console.error(error);process.exitCode=1});
