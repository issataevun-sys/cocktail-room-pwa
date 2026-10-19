'use strict';
/**
 * Read-only archive mirror for registered owner devices.
 * Permanent Guests + imported historical shifts stay in COCKTAIL ROOM DATABASE.
 * Archive cache is encrypted on this device, never sent into the live shift CAS.
 */
(function(){
 const STORE=()=>window.CRWorkStore;
 const clone=x=>JSON.parse(JSON.stringify(x));
 let active=false,transport=null,refreshing=false;
 let state={guests:[],lists:null,index:null,details:{},visits:{},updatedAt:'',error:''};
 const listeners=new Set();
 const emit=()=>{for(const callback of listeners)try{callback(getState())}catch(e){console.error(e)}};
 const getState=()=>({guests:state.guests,lists:state.lists,index:state.index,updatedAt:state.updatedAt,error:state.error,refreshing});
 let chain=Promise.resolve();
 function persist(){
  const frozen=clone(state);
  chain=chain.catch(()=>{}).then(()=>STORE().saveNamed('pilot-archive',frozen));
  return chain;
 }
 async function activate(config){
  if(active)return;
  const cached=await STORE().loadNamed('pilot-archive');
  if(cached&&typeof cached==='object'){
   state={...state,...cached,details:cached.details||{},visits:cached.visits||{}};
  }
  transport=await window.CRRelayTransport.create(config);
  active=true;
  emit();
  if(navigator.onLine)refresh().catch(console.error);
 }
 async function refresh(){
  if(!active||refreshing||!navigator.onLine)return;
  refreshing=true;state.error='';emit();
  try{
   const results=await Promise.allSettled([
    transport.archive('catalog'),
    transport.archive('history-index'),
    transport.archive('lists')
   ]);
   let changed=false,errors=[];
   if(results[0].status==='fulfilled'&&Array.isArray(results[0].value)){
    state.guests=results[0].value;changed=true;
   }else errors.push('Гости: '+String(results[0].reason?.message||'недоступны'));
   if(results[1].status==='fulfilled'&&results[1].value?.ok&&Array.isArray(results[1].value.rows)){
    state.index=results[1].value;changed=true;
   }else errors.push('История: '+String(results[1].reason?.message||'недоступна'));
   if(results[2].status==='fulfilled'&&results[2].value&&Array.isArray(results[2].value.flavors)){
    state.lists=results[2].value;changed=true;
   }else errors.push('Списки: '+String(results[2].reason?.message||'недоступны'));
   state.error=errors.join('; ');
   if(changed){state.updatedAt=new Date().toISOString();await persist()}
  }finally{refreshing=false;emit()}
 }
 async function getPastDetail(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error('Некорректная дата');
  if(state.details[date])return clone(state.details[date]);
  if(!navigator.onLine||!active)throw Error('Для первого просмотра этой смены нужен интернет');
  const result=await transport.archive('history-detail',date);
  if(!result?.ok)throw Error('Историческая смена недоступна');
  state.details[date]=result;await persist();emit();
  return clone(result);
 }
 async function getGuestHistory(id){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(String(id)))throw Error('Неверный гость');
  if(state.visits[id])return clone(state.visits[id]);
  if(!navigator.onLine||!active)throw Error('История этого гостя ещё не загружена на устройство');
  const result=await transport.archive('guest-history',id);
  if(!result?.ok)throw Error('История гостя недоступна');
  state.visits[id]=result;await persist();emit();
  return clone(result);
 }
 window.CRArchive={
  activate,refresh,getPastDetail,getGuestHistory,getState,
  subscribe:callback=>{listeners.add(callback);callback(getState());return()=>listeners.delete(callback)}
 };
 window.addEventListener('online',()=>{if(active)refresh().catch(console.error)});
})();
