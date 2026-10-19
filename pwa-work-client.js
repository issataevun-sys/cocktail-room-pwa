'use strict';
/**
 * COCKTAIL ROOM — temporarily no login/onboarding UI.
 * Preserve encrypted local data and all server sync modules unchanged.
 * Device enrollment can be redesigned later; never silently bypass server auth.
 */
(function(){
 let snapshotProvider=null,restoreSnapshot=null,onConnected=null;
 let storeReady=false,restored=false;
 async function saveNow(){
  if(!storeReady||!snapshotProvider)return false;
  const snapshot=snapshotProvider();
  if(!snapshot||!snapshot.state)return false;
  await window.CRWorkStore.saveNamed('snapshot',snapshot);
  return true;
 }
 async function restore(){
  if(!storeReady||!restoreSnapshot||restored)return;
  const snapshot=await window.CRWorkStore.loadNamed('snapshot');
  if(snapshot&&restoreSnapshot(snapshot))restored=true;
 }
 window.CRPWA={
  connected:false,
  enterPilotMode:()=>{},
  persistEncrypted:()=>{saveNow().catch(e=>console.error('Encrypted local save failed',e));},
  saveEncryptedNow:saveNow,
  setSnapshotProvider:fn=>{snapshotProvider=fn;},
  setRestoreSnapshot:fn=>{restoreSnapshot=fn;restore().catch(e=>console.error('Encrypted local restore failed',e));},
  setOnConnected:fn=>{onConnected=fn;},
  isOfflineEditing:()=>!navigator.onLine
 };
 async function initialize(){
  try{
   await window.CRWorkStore.openDevice();
   storeReady=true;
   await window.CRArchive?.restoreCached?.().catch(e=>console.warn('Encrypted archive cache unavailable',e));
   const pairing=await window.CRWorkStore.loadNamed('pilot-config');
   if(pairing&&window.CRPilot){
    try{await window.CRPilot.resume();return;}
    catch(e){console.warn('Existing device pairing cannot connect; keeping local data intact',e);}
   }
   await restore();
   // No device credentials are requested. Unpaired devices do not sync
   // to the server; remote identity checks must never be silently bypassed.
   if(!restored)console.info('COCKTAIL ROOM: no paired device or local snapshot. Offline local mode only.');
  }catch(e){
   // Do not erase or re-key encrypted owner data on error.
   console.error('COCKTAIL ROOM local encrypted database unavailable; data untouched',e);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
 else initialize();
})();
