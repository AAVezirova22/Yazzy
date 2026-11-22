import {locale,t,tp} from './i18n';

export const fmt=(value:number|null|undefined,digits=1)=>value==null||Number.isNaN(value)?'—':value.toFixed(digits);
export const day=(at:number)=>new Date(at*1000).toLocaleDateString(locale(),{month:'short',day:'numeric'});
export const weekday=(at:number)=>new Date(at*1000).toLocaleDateString(locale(),{weekday:'short',day:'numeric',month:'short'});
export const clock=(at:number)=>new Date(at*1000).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'});
export const ago=(at:number)=>{const d=Math.floor((Date.now()/1000-at)/86400);return d<=0?t('Today'):d===1?t('Yesterday'):tp(d,'{n} day ago','{n} days ago');};
export const latest=(list:any[]|null|undefined,key:string)=>(list||[]).reduce((a:any,x:any)=>!a||x[key]>a[key]?x:a,null);
export const greeting=()=>{const h=new Date().getHours();return t(h<12?'Good morning':h<18?'Good afternoon':'Good evening');};
export const routeOf=(trip:any)=>(trip?.status==='STATIONARY'||(trip?.metrics?.route||[]).length<2?[]:trip.metrics.route) as {latitude:number;longitude:number}[];
export const pretty=(v:unknown)=>String(v||'').replaceAll('_',' ').toLowerCase();
export const carLine=(v:any)=>[v.make,v.model,v.year].filter(Boolean).join(' ')||(v.origin==='REAL'?'':pretty(v.origin));
/** Kilometres driven on each of the last seven days, today last. */
export function lastWeek(trips:any[]|null|undefined){
 const out=new Array(7).fill(0),today=new Date();today.setHours(0,0,0,0);
 for(const trip of trips||[]){if(trip.startAt==null||!trip.metrics?.distanceKm)continue;const d=new Date(trip.startAt*1000);d.setHours(0,0,0,0);const back=Math.round((today.getTime()-d.getTime())/86400000);if(back>=0&&back<7)out[6-back]+=trip.metrics.distanceKm;}
 return out;
}
/**
 * Smooth driving over the last 30 days: how many drives had no hard braking (stronger than 3 m/s²) or hard
 * acceleration (stronger than 2.5 m/s²). A plain count, not an invented score.
 */
export function smoothDriving(trips:any[]|null|undefined,days=30){
 const since=Date.now()/1000-days*86400;
 const drives=(trips||[]).filter(x=>x.startAt!=null&&x.startAt>=since&&x.status!=='STATIONARY'&&x.metrics);
 const smooth=drives.filter(x=>!(x.metrics.drivingEvents||[]).length).length;
 const events=drives.reduce((n,x)=>n+(x.metrics.drivingEvents||[]).length,0);
 return {drives:drives.length,smooth,events};
}
