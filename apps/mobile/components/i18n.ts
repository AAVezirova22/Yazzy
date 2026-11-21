import {useSyncExternalStore} from 'react';
import * as SecureStore from 'expo-secure-store';
import {BG,BG_PLURAL} from './i18n/bg';
import {RU,RU_PLURAL} from './i18n/ru';

/**
 * The app's languages: Bulgarian (the default), English and Russian. English text is the key and the fallback, so a
 * string without a translation still shows, in English. The choice is kept on the phone and set in More › Language.
 */
export type Lang='bg'|'en'|'ru';
export const LANGS:{id:Lang;name:string}[]=[{id:'bg',name:'Български'},{id:'en',name:'English'},{id:'ru',name:'Русский'}];

let lang:Lang='bg';
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(l=>l());

/** Reads the saved choice; call once at launch, before the first screen. */
export async function loadLang(){
 try{const v=await SecureStore.getItemAsync('yazzy-lang');if((v==='bg'||v==='en'||v==='ru')&&v!==lang){lang=v;notify();}}catch{/* keep the default */}
}
export function setLang(next:Lang){
 if(next===lang)return;
 lang=next;SecureStore.setItemAsync('yazzy-lang',next).catch(()=>{});notify();
}
export const getLang=()=>lang;
/** The current language; a component using it redraws when the language changes. */
export function useLang(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};},getLang,getLang);}

const fill=(s:string,vars?:Record<string,string|number>)=>vars?s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]!=null?String(vars[k]):m):s;

/** The text in the chosen language, with {placeholders} filled in. */
export function t(text:string,vars?:Record<string,string|number>){
 const table=lang==='bg'?BG:lang==='ru'?RU:null;
 return fill((table&&table[text])||text,vars);
}

/** Russian has three counted forms: 1 (and 21, 31…), 2–4 (and 22–24…), and the rest. */
function ruForm(n:number){
 if(!Number.isInteger(n))return 1;
 const a=Math.abs(n)%100,b=a%10;
 return a>10&&a<20?2:b===1?0:b>=2&&b<=4?1:2;
}
/** Counted text: English singular and plural; Bulgarian has two forms, Russian three. {n} is the count. */
export function tp(n:number,one:string,other:string,vars?:Record<string,string|number>){
 const v={n,...vars};
 if(lang==='en')return fill(n===1?one:other,v);
 const forms=(lang==='bg'?BG_PLURAL:RU_PLURAL)[other];
 if(!forms)return fill(n===1?one:other,v);
 const i=lang==='bg'?(n===1?0:1):ruForm(n);
 return fill(forms[Math.min(i,forms.length-1)],v);
}

/** Locale for dates and times. */
export const locale=()=>lang==='bg'?'bg-BG':lang==='ru'?'ru-RU':'en-GB';
