import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import {getLang,locale,t} from './i18n';

export type SeriesPoint={observedAt:number;value:number};
export type TripReportInput={
 trip:any;
 vehicleName?:string;
 series:Record<string,SeriesPoint[]>;
 /** PNG of the on-screen map as base64, when the platform could capture one. */
 mapImageBase64?:string|null;
};

// Everything the vehicle reported during the trip, with the unit shown next to it.
export const REPORT_SIGNALS:Array<[string,string,string]>=[
 ['VEHICLE_SPEED','Speed','km/h'],['ENGINE_RPM','Engine speed','rpm'],['ENGINE_LOAD','Engine load','%'],['THROTTLE','Throttle position','%'],
 ['COOLANT_TEMP','Coolant temperature','°C'],['INTAKE_TEMP','Intake air temperature','°C'],['INTAKE_PRESSURE','Intake manifold pressure','kPa'],
 ['SHORT_FUEL_TRIM','Short-term fuel trim','%'],['LONG_FUEL_TRIM','Long-term fuel trim','%'],['MAF','Air flow (MAF)','g/s'],
 ['FUEL_RATE','Fuel rate','L/h'],['MODULE_VOLTAGE','Module voltage','V'],['FUEL_LEVEL','Fuel level','%'],['AMBIENT_TEMP','Ambient temperature','°C'],
];

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
const when=(at:number)=>new Date(at*1000).toLocaleString(locale());
const clock=(at:number)=>new Date(at*1000).toLocaleTimeString(locale());
const n=(v:number|null|undefined,d=1)=>v==null||Number.isNaN(v)?'—':v.toFixed(d);
const span=(sec:number)=>{sec=Math.max(0,Math.round(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return h?t('{h} h {m} min {s} s',{h,m,s}):m?t('{m} min {s} s',{m,s}):t('{n} s',{n:s});};
/** A server enum (END_REASON, FUEL_METHOD…) as words in the chosen language. */
const words=(v:unknown)=>t(String(v??'').replaceAll('_',' ').toLowerCase());

function chart(points:SeriesPoint[],from:number,to:number,color:string,unit:string){
 if(!points.length)return `<p class="muted">${esc(t('No readings were recorded for this signal.'))}</p>`;
 const W=700,H=130,L=44,B=18,T=8,R=6,w=W-L-R,h=H-T-B,dur=Math.max(1,to-from);
 const values=points.map(p=>p.value),lo=Math.min(0,...values),hi=Math.max(...values,lo+1);
 const x=(at:number)=>L+(Math.min(to,Math.max(from,at))-from)/dur*w,y=(v:number)=>T+h-(v-lo)/(hi-lo)*h;
 // Break the line wherever readings stop for more than 15 s so gaps are visible, never interpolated.
 const runs:SeriesPoint[][]=[];let run:SeriesPoint[]=[];
 for(const p of points){if(run.length&&p.observedAt-run[run.length-1].observedAt>15){runs.push(run);run=[];}run.push(p);}
 if(run.length)runs.push(run);
 const paths=runs.map(r=>r.length===1?`<circle cx="${x(r[0].observedAt).toFixed(1)}" cy="${y(r[0].value).toFixed(1)}" r="1.6" fill="${color}"/>`:`<polyline fill="none" stroke="${color}" stroke-width="1.4" points="${r.map(p=>`${x(p.observedAt).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"/>`).join('');
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><rect x="${L}" y="${T}" width="${w}" height="${h}" fill="#f5f7fa" stroke="#e3e8ee"/>
  <text x="${L-4}" y="${T+8}" font-size="9" text-anchor="end" fill="#7a8594">${n(hi,0)}</text><text x="${L-4}" y="${T+h}" font-size="9" text-anchor="end" fill="#7a8594">${n(lo,0)}</text>
  <text x="${L}" y="${H-4}" font-size="9" fill="#7a8594">${esc(clock(from))}</text><text x="${W-R}" y="${H-4}" font-size="9" text-anchor="end" fill="#7a8594">${esc(clock(to))}</text>
  <text x="${W-R}" y="${T+10}" font-size="9" text-anchor="end" fill="#7a8594">${esc(t(unit))}</text>${paths}</svg>`;
}

function sketch(route:any[],events:any[]){
 if(!route.length)return '';
 const W=700,H=380,pad=30,scale=Math.cos(route[0].latitude*Math.PI/180);
 const raw=(p:any)=>({x:p.longitude*scale,y:-p.latitude}),pts=route.map(raw);
 const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(1e-9,Math.max(...xs)-minX),h=Math.max(1e-9,Math.max(...ys)-minY);
 const k=Math.min((W-2*pad)/w,(H-2*pad)/h),offX=(W-w*k)/2,offY=(H-h*k)/2;
 const at=(p:any)=>{const r=raw(p);return [offX+(r.x-minX)*k,offY+(r.y-minY)*k];};
 const line=route.map(p=>at(p).map(v=>v.toFixed(1)).join(',')).join(' ');
 const dot=(p:any,color:string,r:number)=>{const [a,b]=at(p);return `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;};
 const marks=events.filter(e=>e.latitude!=null).map(e=>dot(e,e.type==='HARD_BRAKING'?'#d93025':'#f08a00',6)).join('');
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><rect width="${W}" height="${H}" fill="#e6ebf1" rx="8"/><polyline fill="none" stroke="#2f7bf5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${line}"/>${dot(route[0],'#2e9d4f',7)}${route.length>1?dot(route[route.length-1],'#2d6cdf',7):''}${marks}<text x="10" y="${H-8}" font-size="10" fill="#7a8594">${esc(t('Route sketch · north up · drawn to scale'))}</text></svg>`;
}

export function buildTripHtml({trip,vehicleName,series,mapImageBase64}:TripReportInput){
 const m=trip.metrics||{},from=trip.startAt,to=trip.endAt??trip.startAt,route:any[]=m.route||[],events:any[]=m.drivingEvents||[];
 const speed=series.VEHICLE_SPEED||[],top=speed.length?Math.max(...speed.map(p=>p.value)):null;
 const avgMoving=m.distanceKm!=null&&m.movingSeconds>0?m.distanceKm/(m.movingSeconds/3600):null;
 const kmh=(v:number)=>t('{n} km/h',{n:n(v,0)});
 const dist=m.distanceKm==null?'—':m.distanceKm<1?t('{n} m',{n:Math.round(m.distanceKm*1000)}):t('{n} km',{n:n(m.distanceKm,2)});
 const tile=(label:string,value:string,sub='')=>`<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span>${sub?`<i>${esc(sub)}</i>`:''}</div>`;
 const braking=events.filter(e=>e.type==='HARD_BRAKING').length;
 const signalRows=REPORT_SIGNALS.filter(([id])=>(series[id]||[]).length).map(([id,label,unit])=>{
  const v=series[id].map(p=>p.value),avg=v.reduce((a,b)=>a+b,0)/v.length;
  return `<tr><td>${esc(t(label))}</td><td>${n(Math.min(...v),1)}</td><td>${n(avg,1)}</td><td>${n(Math.max(...v),1)}</td><td>${esc(t(unit))}</td><td>${series[id].length}</td></tr>`;}).join('');
 const charts=REPORT_SIGNALS.filter(([id])=>(series[id]||[]).length).map(([id,label,unit],i)=>`<section class="chart"><h3>${esc(t(label))}</h3>${chart(series[id],from,to,['#2f7bf5','#c47a1c','#2d6cdf','#8a4fbf'][i%4],unit)}</section>`).join('');
 const metricRows=Object.entries(m).filter(([k,v])=>k!=='route'&&k!=='drivingEvents'&&(v===null||['string','number','boolean'].includes(typeof v))).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v===null?'—':typeof v==='number'?Number(v.toFixed(4)):v)}</td></tr>`).join('');
 const eventRows=events.map(e=>`<tr><td>${esc(t(e.type==='HARD_BRAKING'?'Hard braking':'Hard acceleration'))}</td><td>${esc(clock(e.time))}</td><td>${n(e.fromKmh,0)} → ${esc(kmh(e.toKmh))}</td><td>${esc(t('{n} s',{n:n(e.durationSeconds,1)}))}</td><td>${n(e.peakMetresPerSecond2,1)} m/s²</td><td>${e.latitude!=null?`${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`:esc(t('no GPS fix nearby'))}</td></tr>`).join('');
 const map=mapImageBase64?`<img class="map" src="data:image/png;base64,${mapImageBase64}"/>`:sketch(route,events);
 const coverage=t('Distance coverage {d}% · fuel coverage {f}% · location coverage {l}%.',{d:n((m.distanceCoverage||0)*100,0),f:n((m.fuelCoverage||0)*100,0),l:n((m.locationCoverage||0)*100,0)});
 return `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
  @page{margin:16mm 14mm}*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#161b22;font-size:11px;line-height:1.45}
  h1{font-size:22px;margin:0}h2{font-size:14px;margin:20px 0 8px;border-bottom:2px solid #e3e8ee;padding-bottom:3px;break-after:avoid}h3{break-after:avoid}tr{break-inside:avoid}h3{font-size:11px;margin:10px 0 3px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2f7bf5;padding-bottom:8px}.brand{color:#2f7bf5;font-weight:700;font-size:15px}
  .muted{color:#7a8594}.badge{display:inline-block;background:#e8f0fe;border-radius:10px;padding:1px 8px;font-size:10px}
  .grid{display:flex;flex-wrap:wrap;gap:8px}.tile{width:calc(25% - 6px);background:#eef1f5;border-radius:8px;padding:8px}.tile b{display:block;font-size:15px}.tile span{color:#7a8594}.tile i{display:block;font-size:9px;color:#7a8594;font-style:normal}
  table{border-collapse:collapse;width:100%;margin-top:4px}td,th{border-bottom:1px solid #e3e8ee;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eef1f5}
  .map{width:100%;border-radius:8px}.chart{break-inside:avoid}.break{break-before:page}.small td{font-size:9px}
 </style></head><body>
 <div class="head"><div><div class="brand">yazzy · ${esc(t('trip report'))}</div><h1>${esc(when(from))}</h1><div class="muted">${esc(vehicleName||t('Vehicle'))} · ${esc(t('until {when}',{when:when(to)}))}</div></div>
  <div style="text-align:right"><span class="badge">${esc(words(trip.status))}</span> <span class="badge">${esc(words(trip.origin))}</span><div class="muted">${esc(t('exported {when}',{when:new Date().toLocaleString(locale())}))}</div></div></div>
 <h2>${esc(t('Summary'))}</h2><div class="grid">
  ${tile(t('Duration'),span(m.durationSeconds||0))}${tile(t('Distance'),dist,words(m.distanceMethod))}${tile(t('Top speed'),top==null?'—':kmh(top))}${tile(t('Average speed while moving'),avgMoving==null?'—':kmh(avgMoving))}
  ${tile(t('Moving'),span(m.movingSeconds||0))}${tile(t('Idling, engine on'),span(m.idleEngineSeconds||0))}${tile(t('Stopped, engine off'),span(m.engineOffStopSeconds||0))}${tile(t('Data gaps'),String(m.gaps??0))}
  ${tile(t('Fuel used'),m.fuelLitres==null?'—':t('{n} L',{n:n(m.fuelLitres,2)}),words(m.fuelMethod))}${tile(t('Consumption'),m.litresPer100Km==null?'—':t('{n} L/100 km',{n:n(m.litresPer100Km,1)}))}${tile(t('Hard braking'),String(braking))}${tile(t('Hard acceleration'),String(events.length-braking))}
 </div>
 ${m.fuelMethod==='UNAVAILABLE'?`<p class="muted">${esc(t('Fuel is unavailable: this car reports neither its fuel rate nor, for a petrol engine, its air flow and fuel trims, so nothing is estimated.'))}</p>`:''}
 <p class="muted">${m.endReason?esc(t('Trip ended: {reason}.',{reason:words(m.endReason)}))+' ':''}${esc(coverage)}</p>
 <h2>${esc(t('Route'))}</h2>${route.length?map:`<p class="muted">${esc(t('No GPS position was recorded for this trip.'))}</p>`}
 ${route.length?`<p class="muted">${esc(t('Green: start, blue: last position, red: hard braking, orange: hard acceleration.'))}</p>`:''}
 <h2>${esc(t('Driving events'))}</h2>${events.length?`<table><tr><th>${esc(t('Event'))}</th><th>${esc(t('Time'))}</th><th>${esc(t('Speed'))}</th><th>${esc(t('Duration'))}</th><th>${esc(t('Peak'))}</th><th>${esc(t('Position'))}</th></tr>${eventRows}</table><p class="muted">${esc(t('Hard braking is stronger than 3 m/s², hard acceleration stronger than 2.5 m/s², measured over at least one second.'))}</p>`:`<p class="muted">${esc(t('No hard braking or hard acceleration detected.'))}</p>`}
 <h2>${esc(t('Vehicle readings'))}</h2>${signalRows?`<table><tr><th>${esc(t('Signal'))}</th><th>${esc(t('Min'))}</th><th>${esc(t('Average'))}</th><th>${esc(t('Max'))}</th><th>${esc(t('Unit'))}</th><th>${esc(t('Points'))}</th></tr>${signalRows}</table>`:`<p class="muted">${esc(t('No readings were stored for this trip.'))}</p>`}
 ${charts}
 <h2 class="break">${esc(t('Calculation details'))}</h2><table class="small"><tr><th>${esc(t('Field'))}</th><th>${esc(t('Value'))}</th></tr>${metricRows}
  <tr><td>tripId</td><td>${esc(trip.id)}</td></tr><tr><td>sessionId</td><td>${esc(trip.sessionId)}</td></tr><tr><td>deviceId</td><td>${esc(trip.deviceId)}</td></tr><tr><td>vehicleId</td><td>${esc(trip.vehicleId)}</td></tr><tr><td>detectedAt</td><td>${esc(trip.detectedAt?when(trip.detectedAt):'—')}</td></tr><tr><td>calculationVersion</td><td>${esc(trip.calculationVersion)}</td></tr></table>
 </body></html>`;
}

/** Builds the PDF, gives it a readable file name and opens the share sheet (Save to Files / Drive / mail ...). */
export async function exportTripPdf(input:TripReportInput){
 const {uri}=await Print.printToFileAsync({html:buildTripHtml(input),base64:false,width:595,height:842});
 const d=new Date(input.trip.startAt*1000),pad=(v:number)=>String(v).padStart(2,'0');
 const name=`Yazzy-trip-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
 let file=uri;
 try{const target=(FileSystem.cacheDirectory||uri.slice(0,uri.lastIndexOf('/')+1))+name;await FileSystem.deleteAsync(target,{idempotent:true});await FileSystem.moveAsync({from:uri,to:target});file=target;}catch{/* keep the generated name */}
 if(!(await Sharing.isAvailableAsync()))throw new Error(t('Sharing is not available on this device. The PDF was saved at {file}',{file}));
 await Sharing.shareAsync(file,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:t('Export trip report')});
 return file;
}
