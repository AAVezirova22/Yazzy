import * as SecureStore from 'expo-secure-store';

/**
 * Bulgarian checks for a car and its owner, made straight from the phone so the owner's identity numbers never
 * reach our server:
 * - vignette: BG Toll's public check, by plate;
 * - toll (АПИ) fines: BG Toll, by plate and the owner's ЕГН/ЕИК;
 * - KAT fines: the Ministry of Interior's e-services, by ЕГН and driving licence number.
 * The technical inspection (ГТП) and civil liability insurance have no open check; their dates are entered by hand.
 */
export type Documents={plate?:string;vin?:string;gtpUntil?:string;insuranceUntil?:string;
 vignette?:{until:string|null;active:boolean;checkedAt:number}|null;
 apiFines?:{count:number;amount:number;checkedAt:number}|null;checkedAt?:number};
export type Identity={egn:string;licence:string};
export type KatFines={count:number;amount:number;currency:string;partial:boolean;checkedAt:number;items:{date?:string;amount:number;description?:string;document?:string}[]};

const TIMEOUT=25000;
async function getJson(url:string){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),TIMEOUT);
 try{const r=await fetch(url,{signal:abort.signal,headers:{Accept:'application/json'}});return {status:r.status,body:await r.json().catch(()=>null)};}
 finally{clearTimeout(timer);}
}

// Bulgarian plates use the Cyrillic letters that look Latin; the registers want the Latin ones.
const LOOKALIKE:Record<string,string>={'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X'};
export const normalPlate=(plate:string)=>plate.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g,ch=>LOOKALIKE[ch]).replace(/[^A-Z0-9]/g,'');
export const validPlate=(plate:string)=>/^[A-Z]{1,2}\d{4}[A-Z]{1,2}$/.test(normalPlate(plate));
export const validEgn=(egn:string)=>/^\d{10}$/.test(egn.trim());
export const validLicence=(licence:string)=>/^\d{9}$/.test(licence.trim());

export async function checkVignette(plate:string):Promise<NonNullable<Documents['vignette']>>{
 const {body}=await getJson(`https://check.bgtoll.bg/check/vignette/plate/BG/${encodeURIComponent(normalPlate(plate))}`);
 const v=body?.vignette;
 return {until:v?.validityDateTo??null,active:!!(body?.ok&&v?.statusBoolean),checkedAt:Date.now()/1000};
}

/** Every array of records in an answer, flattened: the registers wrap their lists differently. */
function records(o:any):any[]{
 if(Array.isArray(o))return o.every(x=>x&&typeof x==='object'&&!Array.isArray(x))?o:o.flatMap(records);
 if(o&&typeof o==='object')return Object.values(o).flatMap(records);
 return [];
}
const money=(x:any)=>{const n=Number(x?.amount??x?.fineAmount??x?.price??x?.sum??0);return Number.isFinite(n)?n:0;};

export async function checkApiFines(plate:string,egn:string):Promise<NonNullable<Documents['apiFines']>>{
 const {status,body}=await getJson(`https://check.bgtoll.bg/check/violation/v2/plate/BG/${encodeURIComponent(normalPlate(plate))}/${encodeURIComponent(egn.trim())}`);
 if(status>=500&&!body)throw new Error('BG Toll did not answer');
 const found=body?.ok?records(body).filter(r=>r!==body?.status):[];
 return {count:found.length,amount:found.reduce((a,r)=>a+money(r),0),checkedAt:Date.now()/1000};
}

export async function checkKatFines(identity:Identity):Promise<KatFines>{
 const q=`obligatedPersonType=1&additinalDataForObligatedPersonType=1&mode=1&obligedPersonIdent=${encodeURIComponent(identity.egn.trim())}&drivingLicenceNumber=${encodeURIComponent(identity.licence.trim())}`;
 const {status,body}=await getJson(`https://e-uslugi.mvr.bg/api/Obligations/AND?${q}`);
 if(status>=400||!body)throw new Error(`МВР HTTP ${status}`);
 const groups:any[]=body.obligationsData||[];
 const items=groups.flatMap(g=>g.obligations||[]).map((o:any)=>({date:o.obligationDate,amount:Number(o.discountAmount||o.amount||0),description:o.description||o.documentTypeName,
  document:[o.documentSeries,o.documentNumber].filter(Boolean).join(' ')||undefined,currency:o.currency}));
 return {count:items.length,amount:items.reduce((a,i)=>a+i.amount,0),currency:items[0]?.currency||'EUR',partial:groups.some(g=>g.errorReadingData),checkedAt:Date.now()/1000,items};
}

// The owner's identity numbers: only on this phone, encrypted by Android's keystore through SecureStore.
export async function loadIdentity():Promise<Identity|null>{
 try{const v=JSON.parse(await SecureStore.getItemAsync('yazzy-identity')||'null');return v&&validEgn(v.egn)?v:null;}catch{return null;}
}
export async function saveIdentity(identity:Identity|null){
 if(identity)await SecureStore.setItemAsync('yazzy-identity',JSON.stringify({egn:identity.egn.trim(),licence:identity.licence.trim()}));
 else await SecureStore.deleteItemAsync('yazzy-identity').catch(()=>{});
}
export async function loadKat():Promise<KatFines|null>{try{return JSON.parse(await SecureStore.getItemAsync('yazzy-kat')||'null');}catch{return null;}}
export async function saveKat(kat:KatFines){await SecureStore.setItemAsync('yazzy-kat',JSON.stringify({...kat,items:kat.items.slice(0,20)})).catch(()=>{});}

/** Days until an ISO date (negative once past), or null without one. */
export function daysLeft(iso?:string|null){
 if(!iso)return null;const d=new Date(iso.length===10?iso+'T23:59:59':iso);if(isNaN(+d))return null;
 return Math.floor((+d-Date.now())/86400000);
}
