'use strict';
/**
 * COCKTAIL ROOM — conservative three-way merge of encrypted owner workspaces.
 *
 * Independent additions and independent edits to DIFFERENT IDs merge.
 * Concurrent changes to the SAME record always raise a conflict, even if
 * fields differ: no guessing about revenue, VIP, seat lifecycle or deletion.
 * Collection IDs are mandatory; invalid/duplicate IDs fail CLOSED.
 */
(function(root){
 const COLLECTIONS=new Set([
  'state.shifts','state.hookahs','state.tables','state.bookings',
  'state.washings','state.vipHours','state.guests','guests',
  'lists.flavors','lists.bowls','lists.hookahs','lists.cooling','lists.prices'
 ]);
 function stable(value){
  if(value===undefined)return 'undefined';
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
 }
 const same=(a,b)=>stable(a)===stable(b);
 const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
 const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 function merge(base,local,remote){
  const conflicts=[];
  function conflict(path,b,l,r,reason){
   conflicts.push({path,reason:reason||'simultaneous_change',
    base:copy(b),local:copy(l),remote:copy(r)});
   return copy(r);
  }
  function rows(list,path){
   if(!Array.isArray(list))return null;
   const map=new Map();
   for(const v of list){
    if(!plain(v)||!v.id||typeof v.id!=='string'||map.has(v.id))return null;
    map.set(v.id,v);
   }
   return map;
  }
  function collection(b,l,r,path){
   const old=rows(b===undefined?[]:b,path),mine=rows(l,path),other=rows(r,path);
   if(!old||!mine||!other)return conflict(path,b,l,r,'invalid_or_duplicate_record_ids');
   const ids=new Set([...other.keys(),...mine.keys(),...old.keys()]);
   const result=[];
   for(const id of ids){
    const entry=atomic(old.get(id),mine.get(id),other.get(id),path+'['+id+']');
    if(entry!==undefined)result.push(entry);
   }
   return result;
  }
  function atomic(b,l,r,path){
   if(same(l,r))return copy(l);
   if(same(l,b))return copy(r);
   if(same(r,b))return copy(l);
   return conflict(path,b,l,r);
  }
  function tree(b,l,r,path){
   if(same(l,r))return copy(l);
   if(same(l,b))return copy(r);
   if(same(r,b))return copy(l);
   // Default catalog is null on a fresh workspace, which means no rows.
   if(path==='lists'){
    b=b===null||b===undefined?{}:b;
    l=l===null||l===undefined?{}:l;
    r=r===null||r===undefined?{}:r;
   }
   if(COLLECTIONS.has(path))return collection(b,l,r,path);
   if(!plain(l)||!plain(r)||!(plain(b)||b===undefined))
    return conflict(path,b,l,r,'unsupported_structure');
   // Only the root, state, and the catalog may recurse into named fields.
   if(!['','state','lists'].includes(path))
    return conflict(path,b,l,r);
   const out={};
   for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
    const child=path?path+'.'+key:key;
    const value=tree(b?.[key],l[key],r[key],child);
    if(value!==undefined)out[key]=value;
   }
   return out;
  }
  if(!plain(base)||!plain(local)||!plain(remote)){
   return {ok:false,merged:null,conflicts:[{path:'',reason:'invalid_snapshot'}]};
  }
  const merged=tree(base,local,remote,'');
  return {ok:conflicts.length===0,merged:conflicts.length?null:merged,conflicts};
 }
 const api=Object.freeze({merge});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.CRWorkspaceMerge=api;
})(typeof window!=='undefined'?window:null);
