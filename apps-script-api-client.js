'use strict';
/**
 * COCKTAIL ROOM: direct Apps Script Execution API transport (experimental).
 * No iframe, no window.opener, no privileged tokens stored on disk.
 * Requires an owner-configured Google Cloud OAuth WEB client and an
 * Apps Script API executable sharing that Cloud project.
 * Never enable real writes before server-side role checks and acceptance tests.
 */
(function(){
 let client=null, token='',expiresAt=0,config=null;
 const allowed=new Set(['crWebTestHealth','crSyncGet','crSyncPut']);
 function configure({clientId,scriptId}){
  if(!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(String(clientId||'')))throw Error('Invalid OAuth client ID');
  if(!/^[A-Za-z0-9_-]{20,}$/.test(String(scriptId||'')))throw Error('Invalid Apps Script ID');
  config={clientId,scriptId};
 }
 function authorize(){
  if(!config)throw Error('OAuth not configured');
  if(!window.google?.accounts?.oauth2)throw Error('Google Identity Services library missing');
  return new Promise((resolve,reject)=>{
   client=window.google.accounts.oauth2.initTokenClient({
    client_id:config.clientId,
    scope:'https://www.googleapis.com/auth/spreadsheets',
    callback:r=>{
     if(r?.error||!r?.access_token){reject(Error(String(r?.error||'Google authorization failed')));return}
     token=r.access_token;expiresAt=Date.now()+Math.max(0,Number(r.expires_in||0)-60)*1000;
     resolve(true);
    },
    error_callback:e=>reject(Error(String(e?.type||'OAuth popup failed')))
   });
   client.requestAccessToken({prompt:token?'':'consent'});
  });
 }
 async function run(method,args=[]){
  if(!allowed.has(method))throw Error('Method not allowed');
  if(!config||!token||Date.now()>=expiresAt)throw Error('Google login required');
  const response=await fetch('https://script.googleapis.com/v1/scripts/'+encodeURIComponent(config.scriptId)+':run',{
   method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({function:method,parameters:args,devMode:false}),
   cache:'no-store',credentials:'omit'
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(String(payload?.error?.message||'Apps Script API HTTP '+response.status));
  if(payload.error)throw Error(String(payload.error.details?.[0]?.errorMessage||payload.error.message||'Apps Script error'));
  return payload.response?.result??null;
 }
 function reset(){token='';expiresAt=0;client=null}
 window.CRActionsAPI={configure,authorize,run,reset,isAuthorized:()=>!!token&&Date.now()<expiresAt};
})();
