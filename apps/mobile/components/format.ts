export const fmt=(value:number|null|undefined,digits=1)=>value==null||Number.isNaN(value)?'—':value.toFixed(digits);
export const day=(t:number)=>new Date(t*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'});
export const weekday=(t:number)=>new Date(t*1000).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
export const clock=(t:number)=>new Date(t*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
export const ago=(t:number)=>{const d=Math.floor((Date.now()/1000-t)/86400);return d<=0?'Today':d===1?'Yesterday':`${d} days ago`;};
export const latest=(list:any[]|null|undefined,key:string)=>(list||[]).reduce((a:any,x:any)=>!a||x[key]>a[key]?x:a,null);
export const greeting=()=>{const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';};
export const routeOf=(t:any)=>(t?.status==='STATIONARY'||(t?.metrics?.route||[]).length<2?[]:t.metrics.route) as {latitude:number;longitude:number}[];
export const pretty=(v:unknown)=>String(v||'').replaceAll('_',' ').toLowerCase();
export const carLine=(v:any)=>[v.make,v.model,v.year].filter(Boolean).join(' ')||(v.origin==='REAL'?'Personal vehicle':pretty(v.origin));
/** Kilometres driven on each of the last seven days, today last. */
export function lastWeek(trips:any[]|null|undefined){
 const out=new Array(7).fill(0),today=new Date();today.setHours(0,0,0,0);
 for(const t of trips||[]){if(t.startAt==null||!t.metrics?.distanceKm)continue;const d=new Date(t.startAt*1000);d.setHours(0,0,0,0);const back=Math.round((today.getTime()-d.getTime())/86400000);if(back>=0&&back<7)out[6-back]+=t.metrics.distanceKm;}
 return out;
}
