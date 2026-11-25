import {locale,t} from './i18n';
import {fmt} from './format';

/** Kilometres with thousands separators in the chosen language: "152 300 km". */
export const kmText=(km:number)=>t('{n} km',{n:Math.round(km).toLocaleString(locale())});

/** A price in the record's own currency; falls back to the plain number when the phone does not know the currency. */
export function money(amount:number,currency='EUR'){
 try{return new Intl.NumberFormat(locale(),{style:'currency',currency}).format(amount);}
 catch{return `${fmt(amount,2)} ${currency}`;}
}

/** A number typed by a person: spaces are ignored and a comma counts as the decimal point. Empty or invalid is null. */
export function typedNumber(text:string){
 const v=parseFloat(text.replace(/\s/g,'').replace(',','.'));
 return Number.isFinite(v)&&v>=0?v:null;
}

/**
 * Where the odometer stands now. A reading from the car (or the one saved on the vehicle) is exact; without one,
 * the last kilometres written in the service history plus the distance of every drive recorded since then is an estimate.
 */
export function currentKm(readings:(number|null|undefined)[],service:any[]|null|undefined,trips:any[]|null|undefined):{km:number;estimated:boolean}|null{
 const exact=Math.max(0,...readings.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)));
 const last=(service||[]).filter(r=>r.odometerKm!=null).sort((a,b)=>b.observedAt-a.observedAt)[0];
 let guess=0;
 if(last){
  const since=(trips||[]).filter(d=>d.startAt!=null&&d.startAt>last.observedAt&&d.status!=='STATIONARY').reduce((a,d)=>a+(d.metrics?.distanceKm||0),0);
  guess=last.odometerKm+since;
 }
 if(!exact&&!guess)return null;
 return guess>exact?{km:guess,estimated:true}:{km:exact,estimated:false};
}

const SKIP=new Set(['and','the','for','with','new','full','and','от','за','на','със','нов','нова','и']);
const words=(text:string)=>new Set(text.toLowerCase().replace(/[^\p{L}]+/gu,' ').split(' ').filter(w=>w.length>=3&&!SKIP.has(w)));
/** Two free-text descriptions that name the same job ("Oil change" and "Engine oil change 5W-30"): at least two shared words. */
export function sameJob(a:string,b:string){
 const x=words(a),y=words(b);
 if(!x.size||!y.size)return false;
 let shared=0;
 for(const w of x)if(y.has(w))shared++;
 return shared>=Math.min(2,x.size,y.size)&&shared/Math.min(x.size,y.size)>=0.5;
}

/** A reminder stays open until the same job is written into the history again. */
export function openReminders(records:any[]|null|undefined){
 const all=records||[];
 return all.filter(r=>r.nextDueKm!=null&&!all.some(o=>o.id!==r.id&&o.observedAt>r.observedAt&&sameJob(o.description||'',r.description||'')));
}

export type Due={left:number|null;at:number;tone:'red'|'amber'|'green'|'blue'};
/** How far a reminder is: overdue (red), within 1 000 km (amber), later (green); only the target when the odometer is unknown. */
export function dueOf(record:any,km:number|null|undefined):Due|null{
 if(record.nextDueKm==null)return null;
 if(km==null)return {left:null,at:record.nextDueKm,tone:'blue'};
 const left=record.nextDueKm-km;
 return {left,at:record.nextDueKm,tone:left<=0?'red':left<=1000?'amber':'green'};
}
export const dueText=(due:Due)=>due.left==null?t('Due at {km}',{km:kmText(due.at)}):due.left<=0?t('Overdue by {km}',{km:kmText(-due.left)}):t('Due in {km}',{km:kmText(due.left)});

/** The reminder's distance as the person entered it: the next service reading minus the reading when it was done. */
export const intervalOf=(record:any)=>record?.nextDueKm!=null&&record?.odometerKm!=null&&record.nextDueKm>record.odometerKm?record.nextDueKm-record.odometerKm:null;
