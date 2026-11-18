import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * The one connection to the Yazzy server. It is remembered on the phone: once connected, the app opens straight into
 * the garage on every launch, and when the 8-hour server session lapses it signs back in by itself with the saved
 * access password. Only More › Server changes or forgets it.
 */
export const defaultApi=process.env.EXPO_PUBLIC_API_URL||'http://localhost:8000';
type Mode='demo'|'oidc';
const st={api:defaultApi,mode:null as Mode|null,token:'',csrf:'',login:null as Promise<void>|null};

/** Trims, adds https:// when no scheme is typed and drops trailing slashes. */
export function normaliseApi(value:string){const v=value.trim().replace(/\/+$/,'');return /^https?:\/\//i.test(v)?v:'https://'+v;}

// A sleeping free-plan server takes up to a minute to wake; without a timeout a dropped request would hang forever.
async function request(url:string,init:RequestInit,ms=75000){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),ms);
 try{return await fetch(url,{...init,signal:abort.signal});}
 catch(e){throw new Error((e as Error).name==='AbortError'?'The server did not answer in time. It may be waking up; try again in a minute.':'Cannot reach the server. Check your connection.');}
 finally{clearTimeout(timer);}
}

async function demoLogin(api:string,password:string){
 const r=await request(api+'/api/v1/auth/demo?mode=personal',{method:'POST',credentials:'include',headers:password?{'X-Access-Password':password}:{}});
 const data=await r.json().catch(()=>({}));
 if(r.status===401)throw new Error('The server rejected the access password. Update it in More › Server.');
 if(!r.ok)throw new Error(r.status===404?'This server does not offer a personal garage.':`The server could not sign you in (HTTP ${r.status}).`);
 return data.csrfToken as string;
}

/** Signs in again with the saved password when the server session has lapsed. Concurrent callers share one attempt. */
function relogin(){
 if(!st.login)st.login=(async()=>{
  const csrf=await demoLogin(st.api,await SecureStore.getItemAsync('yazzy-access-password')||'');
  st.csrf=csrf;await SecureStore.setItemAsync('yazzy-csrf',csrf);
 })().finally(()=>{st.login=null;});
 return st.login;
}

export const server={
 get api(){return st.api;},
 get mode(){return st.mode;},
 /** The saved connection, read once at launch. No network: the app opens at once and signs in lazily if needed. */
 async restore(){
  st.api=await SecureStore.getItemAsync('yazzy-api')||defaultApi;
  const access=await SecureStore.getItemAsync('yazzy-access');
  if(access){st.mode='oidc';st.token=access;}
  else if(await SecureStore.getItemAsync('yazzy-sandbox')==='1'){st.mode='demo';st.token='LOCAL_DEMO';st.csrf=await SecureStore.getItemAsync('yazzy-csrf')||'';}
  return st.mode;
 },
 /** Connects to a server's personal garage and remembers it. A different server starts from an empty cache. */
 async connect(address:string,password:string){
  const api=normaliseApi(address),previous=await SecureStore.getItemAsync('yazzy-api')||defaultApi;
  // Reconnecting to the same server may leave the password blank: the saved one is used.
  const csrf=await demoLogin(api,password||(api===previous?await SecureStore.getItemAsync('yazzy-access-password')||'':''));
  if(api!==previous){await clearCache();await Promise.all(['yazzy-vehicle','yazzy-configured'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));}
  await SecureStore.setItemAsync('yazzy-api',api);
  if(password)await SecureStore.setItemAsync('yazzy-access-password',password);
  await SecureStore.setItemAsync('yazzy-csrf',csrf);
  await SecureStore.setItemAsync('yazzy-sandbox','1');
  await SecureStore.deleteItemAsync('yazzy-access').catch(()=>{});
  Object.assign(st,{api,mode:'demo',token:'LOCAL_DEMO',csrf});
 },
 async signInWithToken(address:string,token:string,refresh?:string){
  const api=normaliseApi(address);
  await SecureStore.setItemAsync('yazzy-api',api);await SecureStore.setItemAsync('yazzy-access',token);
  if(refresh)await SecureStore.setItemAsync('yazzy-refresh',refresh);
  Object.assign(st,{api,mode:'oidc',token});
 },
 /** Forgets the sign-in but keeps the address, so connecting again only needs the button. */
 async disconnect(){
  if(st.mode==='demo')request(st.api+'/api/v1/auth/logout',{method:'POST',credentials:'include',headers:{'X-CSRF-Token':st.csrf}},10000).catch(()=>{});
  await Promise.all(['yazzy-sandbox','yazzy-access','yazzy-refresh','yazzy-csrf'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));
  Object.assign(st,{mode:null,token:'',csrf:''});
 },
 async call(path:string,body?:unknown,method?:'PATCH'){
  const send=()=>request(st.api+'/api/v1'+path,{method:method||(body?'POST':'GET'),credentials:'include',
   headers:{...(st.mode==='demo'?{'X-CSRF-Token':st.csrf}:{Authorization:'Bearer '+st.token}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  let r=await send(),value=await r.json().catch(()=>({}));
  // The session cookie lasts 8 hours; after that (or after a reinstall) sign back in once and repeat the request.
  if(st.mode==='demo'&&(r.status===401||value?.detail?.code==='CSRF_FAILED')){await relogin();r=await send();value=await r.json().catch(()=>({}));}
  if(!r.ok)throw new Error(typeof value?.detail?.code==='string'?value.detail.code:`Request failed (HTTP ${r.status})`);
  return value;
 },
};

// Last-known server data on the phone, so every screen opens instantly (even while the server wakes up) and refreshes behind.
const dir=FileSystem.documentDirectory?FileSystem.documentDirectory+'yazzy-cache/':null;
let made:Promise<unknown>|null=null;
export async function readCache<T>(key:string):Promise<T|null>{
 if(!dir)return null;
 try{return JSON.parse(await FileSystem.readAsStringAsync(dir+key+'.json')) as T;}catch{return null;}
}
export async function writeCache(key:string,value:unknown){
 if(!dir)return;
 try{if(!made)made=FileSystem.makeDirectoryAsync(dir,{intermediates:true}).catch(()=>{});await made;await FileSystem.writeAsStringAsync(dir+key+'.json',JSON.stringify(value));}catch{/* a cache miss only costs a network round trip */}
}
export async function clearCache(){if(dir)await FileSystem.deleteAsync(dir,{idempotent:true}).catch(()=>{});made=null;}
