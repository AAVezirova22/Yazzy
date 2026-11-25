import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import {t} from './i18n';

/**
 * The one connection to the Yazzy server, remembered on the phone. People sign in to their own account with
 * e-mail and password; the app keeps the account's token and opens straight into the garage on every launch,
 * after fingerprint or face unlock. Only signing out (More) forgets it.
 */
export const defaultApi=process.env.EXPO_PUBLIC_API_URL||'http://localhost:8000';
// The Render server was shut down in November 2026 (its database ran out of free transfer). Phones that saved it
// move to this build's server on launch, with the same access password.
const RETIRED=['https://yazzy-api.onrender.com'];
// account: e-mail and password, with a long-lived token kept on the phone (unlocked by fingerprint or face).
// demo: the shared garage of the app before accounts; it is only kept so the first account can take it over.
type Mode='account'|'demo'|'oidc';
export type Account={id:string;email:string;name:string};
const st={api:defaultApi,mode:null as Mode|null,token:'',csrf:'',login:null as Promise<void>|null,account:null as Account|null};
let onExpired:(()=>void)|null=null;

/** Trims, adds https:// when no scheme is typed and drops trailing slashes. */
export function normaliseApi(value:string){const v=value.trim().replace(/\/+$/,'');return /^https?:\/\//i.test(v)?v:'https://'+v;}

// A sleeping free-plan server takes up to a minute to wake; without a timeout a dropped request would hang forever.
async function request(url:string,init:RequestInit,ms=75000){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),ms);
 try{return await fetch(url,{...init,signal:abort.signal});}
 catch(e){throw new Error(t((e as Error).name==='AbortError'?'The server did not answer in time. It may be waking up; try again in a minute.':'Cannot reach the server. Check your connection.'));}
 finally{clearTimeout(timer);}
}

async function demoLogin(api:string,password:string){
 const r=await request(api+'/api/v1/auth/demo?mode=personal',{method:'POST',credentials:'include',headers:password?{'X-Access-Password':password}:{}});
 const data=await r.json().catch(()=>({}));
 if(r.status===401)throw new Error(t('The server rejected the access password. Update it in More › Server.'));
 // Wrong passwords lock the login for a while (even the right one), so guessing a short password gets nowhere.
 if(r.status===429)throw new Error(t('Too many wrong passwords. Try again in {n} min.',{n:Math.max(1,Math.ceil((Number(data?.detail?.retryAfter)||60)/60))}));
 if(!r.ok)throw new Error(r.status===404?t('This server does not offer a personal garage.'):t('The server could not sign you in (HTTP {status}).',{status:r.status}));
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
 get account(){return st.account;},
 /** Called when the server no longer accepts the account's token (signed out elsewhere, expired). */
 onExpired(fn:(()=>void)|null){onExpired=fn;},
 /** The saved connection, read once at launch. No network: the app opens at once and signs in lazily if needed. */
 async restore(){
  st.api=await SecureStore.getItemAsync('yazzy-api')||defaultApi;
  if(RETIRED.includes(st.api)&&!RETIRED.includes(defaultApi)){
   // A new server holds none of the old garage: start from an empty cache and pick its car again.
   st.api=defaultApi;await SecureStore.setItemAsync('yazzy-api',st.api);await clearCache();
   await Promise.all(['yazzy-vehicle','yazzy-configured','yazzy-csrf'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));
  }
  const account=await SecureStore.getItemAsync('yazzy-account-token'),access=await SecureStore.getItemAsync('yazzy-access');
  if(account){st.mode='account';st.token=account;try{st.account=JSON.parse(await SecureStore.getItemAsync('yazzy-account')||'null');}catch{st.account=null;}}
  else if(access){st.mode='oidc';st.token=access;}
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
 /** Creates an account. A phone still signed in to the old shared garage asks to keep it (only the first account
  * on the server gets it). Returns true for a new account, so the app can welcome it. */
 async register(email:string,password:string,name:string,address?:string){
  const api=normaliseApi(address||st.api),claim=st.mode==='demo'&&api===st.api;
  if(claim)await relogin().catch(()=>{});
  const r=await request(api+'/api/v1/auth/register',{method:'POST',credentials:'include',
   headers:{'Content-Type':'application/json',...(claim?{'X-CSRF-Token':st.csrf}:{})},body:JSON.stringify({email,password,name,claim})});
  await this.accountSignedIn(api,r);
 },
 async login(email:string,password:string,address?:string){
  const api=normaliseApi(address||st.api);
  const r=await request(api+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  await this.accountSignedIn(api,r);
 },
 async accountSignedIn(api:string,r:Response){
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
   const code=data?.detail?.code;
   if(r.status===429)throw new Error(t('Too many wrong passwords. Try again in {n} min.',{n:Math.max(1,Math.ceil((Number(data?.detail?.retryAfter)||60)/60))}));
   throw new Error(code==='INVALID_LOGIN'?t('Wrong e-mail or password.'):code==='EMAIL_TAKEN'?t('An account with this e-mail already exists. Sign in instead.')
    :code==='INVALID_EMAIL'?t('Enter a valid e-mail address.'):r.status===422?t('The password needs at least 8 characters.'):t('The server could not sign you in (HTTP {status}).',{status:r.status}));
  }
  const previous=await SecureStore.getItemAsync('yazzy-api')||defaultApi;
  // Another workspace holds other cars: start from an empty cache and pick a car again.
  if(api!==previous||data.tenantId!==await SecureStore.getItemAsync('yazzy-tenant')){await clearCache();await Promise.all(['yazzy-vehicle','yazzy-configured'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));}
  await SecureStore.setItemAsync('yazzy-api',api);await SecureStore.setItemAsync('yazzy-tenant',String(data.tenantId||''));
  await SecureStore.setItemAsync('yazzy-account-token',data.token);await SecureStore.setItemAsync('yazzy-account',JSON.stringify(data.account));
  if(data.new)await SecureStore.setItemAsync('yazzy-welcome','1');
  await Promise.all(['yazzy-sandbox','yazzy-access','yazzy-refresh','yazzy-csrf','yazzy-access-password'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));
  Object.assign(st,{api,mode:'account',token:data.token,csrf:'',account:data.account});
 },
 /** Signs this phone out of its account; the e-mail and password sign it in again. */
 async signOut(){
  if(st.mode==='account')request(st.api+'/api/v1/auth/sign-out',{method:'POST',headers:{Authorization:'Bearer '+st.token}},10000).catch(()=>{});
  await Promise.all(['yazzy-account-token','yazzy-account','yazzy-sandbox','yazzy-access','yazzy-refresh','yazzy-csrf'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));
  Object.assign(st,{mode:null,token:'',csrf:'',account:null});
 },
 /** Forgets the sign-in but keeps the address, so connecting again only needs the button. */
 async disconnect(){
  if(st.mode==='demo')request(st.api+'/api/v1/auth/logout',{method:'POST',credentials:'include',headers:{'X-CSRF-Token':st.csrf}},10000).catch(()=>{});
  await Promise.all(['yazzy-sandbox','yazzy-access','yazzy-refresh','yazzy-csrf'].map(k=>SecureStore.deleteItemAsync(k).catch(()=>{})));
  Object.assign(st,{mode:null,token:'',csrf:''});
 },
 async call(path:string,body?:unknown,method?:'PATCH'|'PUT'|'DELETE'){
  const send=()=>request(st.api+'/api/v1'+path,{method:method||(body?'POST':'GET'),credentials:'include',
   headers:{...(st.mode==='demo'?{'X-CSRF-Token':st.csrf}:{Authorization:'Bearer '+st.token}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  let r=await send(),value=await r.json().catch(()=>({}));
  // The session cookie lasts 8 hours; after that (or after a reinstall) sign back in once and repeat the request.
  if(st.mode==='demo'&&(r.status===401||value?.detail?.code==='CSRF_FAILED')){await relogin();r=await send();value=await r.json().catch(()=>({}));}
  if(st.mode==='account'&&r.status===401){await this.signOut();onExpired?.();throw new Error(t('Your sign-in has expired. Sign in again.'));}
  if(!r.ok)throw new Error(typeof value?.detail?.code==='string'?value.detail.code:t('Request failed (HTTP {status})',{status:r.status}));
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
