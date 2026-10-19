'use strict';
/**
 * One app, one owner-device onboarding.
 * No legacy Google popup, demo fork, phrase/password gate, or second workspace.
 * Local data stays encrypted by a non-extractable device-bound WebCrypto key.
 */
(function(){
 const overlay=document.createElement('div');
 overlay.id='cr-work-gate';
 overlay.style.cssText='position:fixed;inset:0;z-index:99999;display:grid;align-items:start;justify-items:center;overflow-y:auto;background:#0e1721dc;padding:16px;font-family:Arial,sans-serif';
 overlay.innerHTML='<div style="background:white;max-width:520px;width:100%;border-radius:15px;padding:22px;box-shadow:0 15px 55px #0004">'+
  '<h2 style="margin:0 0 12px">COCKTAIL ROOM</h2>'+
  '<p style="line-height:1.5;color:#596975">Единое приложение. Подтверждённое устройство открывает смены без дополнительного пароля. Для первого подключения зарегистрируй устройство один раз.</p>'+
  '<p id="cr-device-status" role="status" style="color:#53656b;font-size:13px">Проверяем ключ устройства…</p></div>';
 window.CRPWA={
  connected:false,
  enterPilotMode:()=>{overlay.style.display='none';},
  persistEncrypted:()=>{},
  saveEncryptedNow:async()=>true,
  setSnapshotProvider:()=>{},
  setRestoreSnapshot:()=>{},
  setOnConnected:()=>{},
  isOfflineEditing:()=>window.CRPilot?.isActive()&&!navigator.onLine
 };
 async function initialize(){
  const status=document.getElementById('cr-device-status');
  try{
   await window.CRWorkStore.openDevice();
   const pairing=await window.CRWorkStore.loadNamed('pilot-config');
   if(!pairing){
    status.textContent='Устройство ещё не зарегистрировано. Заполни данные подключения ниже один раз.';
    return;
   }
   status.textContent='Открываем зашифрованную смену на этом устройстве…';
   await window.CRPilot.resume();
  }catch(error){
   // Do not clear the database or silently replace previous ciphertext.
   status.textContent='Не удалось открыть приложение: '+String(error?.message||error)+
    ' Не удаляй данные браузера и приложение, пока не восстановим доступ.';
   status.style.color='#a33b30';
  }
 }
 const start=()=>{
  document.body.appendChild(overlay);
  Promise.resolve().then(initialize);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
