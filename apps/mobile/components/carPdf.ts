import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import {battery12,boost,carSpot,describeCode,detect,makerFromVin,MONITOR,OBD_STANDARD,PROTOCOL,READINGS,readingText,type CarProfile} from './car';
import {carLine,latest} from './format';
import {getLang,locale,t,tp} from './i18n';
import type {Car} from './tabs/types';

type Input={vehicle:any;report:CarProfile|null;car:Car|null};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] as string));
const when=(at?:number)=>at?new Date(at*1000).toLocaleString(locale()):'—';
const n=(v:number|null|undefined,d=1)=>v==null||Number.isNaN(v)?'—':v.toFixed(d);
const DIESEL=['PM_FILTER','NOX_SCR','EGR','BOOST_PRESSURE','EXHAUST_SENSOR','NMHC_CATALYST'];

export function buildCarHtml({vehicle,report,car}:Input){
 const p=report||{},s=p.signals||{},type=detect(report),maker=makerFromVin(p.vin),v12=battery12(s.ADAPTER_VOLTAGE??p.batteryVoltage),b=boost(s);
 const km=(v:unknown)=>t('{n} km',{n:String(v)}),monitor=(id:string)=>MONITOR[id]?t(MONITOR[id]):id,state=(ok:boolean)=>t(ok?'Ready':'Not ready');
 const row=(label:string,value:string,cls='')=>`<tr${cls?` class="${cls}"`:''}><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
 const tile=(label:string,value:string,sub='')=>`<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span>${sub?`<i>${esc(sub)}</i>`:''}</div>`;
 const codes=(list:string[]|undefined,kind:string)=>(list||[]).map(code=>`<tr><td class="code">${esc(code)}</td><td>${esc(describeCode(code))}</td><td>${esc(t(kind))}</td></tr>`).join('');
 const codeRows=codes(p.stored,'Stored')+codes((p.pending||[]).filter(x=>!(p.stored||[]).includes(x)),'Pending')+codes(p.permanent,'Permanent');
 const readings=READINGS.filter(r=>s[r[0]]!=null).map(r=>row(t(r[1]),readingText(r,s[r[0]]))).join('');
 const ready=(p.readiness||[]).map(m=>row(monitor(m.id),state(m.complete),m.complete?'':'warn')).join('');
 const battery=s.HYBRID_BATTERY,spot=carSpot(report,car?.trips),odo=s.ODOMETER??p.odometerKm,volts=s.ADAPTER_VOLTAGE??p.batteryVoltage;
 const readyCount=p.readiness?t('{done}/{all} ready',{done:p.readiness.filter(m=>m.complete).length,all:p.readiness.length}):'—';
 return `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><style>
  @page{margin:16mm 14mm}*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#161b22;font-size:11px;line-height:1.45}
  h1{font-size:22px;margin:0}h2{font-size:14px;margin:20px 0 8px;border-bottom:2px solid #e3e8ee;padding-bottom:3px;break-after:avoid}tr{break-inside:avoid}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2f7bf5;padding-bottom:8px}.brand{color:#2f7bf5;font-weight:700;font-size:15px}
  .muted{color:#7a8594}.badge{display:inline-block;background:#e8f0fe;border-radius:10px;padding:1px 8px;font-size:10px;margin-left:4px}
  .grid{display:flex;flex-wrap:wrap;gap:8px}.tile{width:calc(25% - 6px);background:#eef1f5;border-radius:8px;padding:8px}.tile b{display:block;font-size:15px}.tile span{color:#7a8594}.tile i{display:block;font-size:9px;color:#7a8594;font-style:normal}
  table{border-collapse:collapse;width:100%;margin-top:4px}td,th{border-bottom:1px solid #e3e8ee;padding:4px 5px;text-align:left;vertical-align:top}th{background:#eef1f5}td:first-child{color:#3a4552;width:45%}
  .code{font-family:Menlo,monospace;font-weight:700;color:#d97706;width:70px!important}.warn td:last-child{color:#d97706;font-weight:700}
  .bar{height:10px;background:#e3e8ee;border-radius:5px;overflow:hidden;margin:4px 0 2px}.bar div{height:100%;background:#16a34a}
 </style></head><body>
 <div class="head"><div><div class="brand">yazzy · ${esc(t('car report'))}</div><h1>${esc(vehicle?.name||t('Vehicle'))}</h1><div class="muted">${esc([vehicle?carLine(vehicle):'',maker].filter(Boolean).join(' · '))}</div></div>
  <div style="text-align:right"><span class="badge">${esc(type.label)}</span><span class="badge">${esc(t(p.mil?'Check engine ON':p.mil===false?'Check engine off':'Lamp unknown'))}</span><div class="muted">${esc(t('read from the car {when}',{when:when(p.readAt)}))}<br>${esc(t('exported {when}',{when:new Date().toLocaleString(locale())}))}</div></div></div>

 <h2>${esc(t('Summary'))}</h2><div class="grid">
  ${tile(t('Type'),type.label,type.source)}${tile(t('Fault codes stored'),String((p.stored||[]).length),p.stored?'':t('not read'))}${tile(t('Readiness'),readyCount)}${tile(t('12 V battery'),volts?`${n(volts)} V`:'—',v12?.text||'')}
  ${tile(t('Odometer'),odo?km(n(odo,0)):'—',odo?'':t('not reported by the car'))}${tile(t('Since codes cleared'),p.distanceSinceClearKm!=null?km(p.distanceSinceClearKm):'—',p.warmupsSinceClear!=null?tp(p.warmupsSinceClear,'{n} warm-up','{n} warm-ups'):'')}
  ${tile(t('Distance recorded'),car?.fuel?.distanceKm!=null?km(n(car.fuel.distanceKm,0)):'—',car?.trips?tp(car.trips.length,'{n} trip','{n} trips'):'')}${tile(t('Average consumption'),car?.fuel?.litresPer100Km!=null?t('{n} L/100 km',{n:n(car.fuel.litresPer100Km)}):'—')}
 </div>

 ${type.kind==='HYBRID'||type.kind==='ELECTRIC'?`<h2>${esc(t(type.kind==='HYBRID'?'Hybrid system':'Battery'))}</h2>${battery!=null?`<p><b>${n(battery,0)} %</b> ${esc(t('traction battery charge'))}</p><div class="bar"><div style="width:${Math.max(2,Math.min(100,battery))}%"></div></div>`:`<p class="muted">${esc(t('The car does not share its traction battery charge over standard OBD (PID 5B).'))}</p>`}
  ${type.kind==='HYBRID'&&s.ENGINE_RPM!=null?`<p>${esc(s.ENGINE_RPM>0?t('Petrol engine: running at {rpm} rpm at the last reading.',{rpm:n(s.ENGINE_RPM,0)}):t('Petrol engine: off (electric or stopped) at the last reading.'))}</p>`:''}`:''}
 ${type.kind==='DIESEL'?`<h2>${esc(t('Diesel system'))}</h2><table>${s.FUEL_RAIL_PRESSURE!=null?row(t('Fuel rail pressure'),`${n(s.FUEL_RAIL_PRESSURE/1000,1)} MPa`):''}${b!=null?row(t('Turbo boost'),`${n(b/100,2)} bar`):''}${(p.readiness||[]).filter(m=>DIESEL.includes(m.id)).map(m=>row(monitor(m.id),state(m.complete),m.complete?'':'warn')).join('')}</table>`:''}

 <h2>${esc(t('Check engine and fault codes'))}</h2>
 <table>${row(t('Warning light'),p.mil==null?'—':t(p.mil?'On':'Off'),p.mil?'warn':'')}${row(t('Codes reported by the control units'),p.dtcCount!=null?String(p.dtcCount):'—')}${p.distanceWithMilKm!=null?row(t('Driven with the light on'),km(p.distanceWithMilKm)):''}${p.minutesWithMil!=null?row(t('Engine time with the light on'),t('{n} min',{n:p.minutesWithMil})):''}${p.distanceSinceClearKm!=null?row(t('Driven since codes were cleared'),km(p.distanceSinceClearKm)):''}${p.minutesSinceClear!=null?row(t('Engine time since codes were cleared'),t('{n} min',{n:p.minutesSinceClear})):''}${p.warmupsSinceClear!=null?row(t('Warm-ups since codes were cleared'),String(p.warmupsSinceClear)):''}</table>
 ${codeRows?`<table><tr><th>${esc(t('Code'))}</th><th>${esc(t('Meaning'))}</th><th>${esc(t('Status'))}</th></tr>${codeRows}</table><p class="muted">${esc(t("Pending codes are not yet confirmed. Permanent codes clear only after the car re-tests the fault. Manufacturer-specific codes need the maker's documentation for the exact meaning."))}</p>`:`<p class="muted">${esc(t(p.stored?'No fault codes stored, pending or permanent.':'Fault codes have not been read yet.'))}</p>`}

 ${ready?`<h2>${esc(t('Emission readiness monitors'))}</h2><table>${ready}</table><p class="muted">${esc(t('Monitors complete while driving; "not ready" shortly after a battery change or a code clear is normal.'))}</p>`:''}
 ${readings?`<h2>${esc(t('Readings'))} ${p.signalsAt?`(${esc(when(p.signalsAt))})`:''}</h2><table>${readings}</table>`:''}

 ${spot?`<h2>${esc(t('Last known location'))}</h2><table>${row(t(spot.source==='trip'?'Where the last trip ended':'Where the car was parked'),`${spot.latitude.toFixed(6)}, ${spot.longitude.toFixed(6)}${spot.accuracy?` (±${Math.round(spot.accuracy)} m)`:''}`)}${row(t('Seen at'),when(spot.at))}</table>`:''}
 <h2>${esc(t('Identity'))}</h2><table>
  ${row('VIN',p.vin||'—')}${maker?row(t('Manufacturer (from VIN)'),maker):''}${row(t('Make / model / year'),vehicle?carLine(vehicle):'—')}
  ${p.obdStandard!=null?row(t('OBD standard'),OBD_STANDARD[p.obdStandard]?t(OBD_STANDARD[p.obdStandard]):t('Code {n}',{n:p.obdStandard})):''}${p.protocol?row(t('Protocol'),PROTOCOL[p.protocol]||p.protocol):''}
  ${(p.ecus||[]).map((e,i)=>row(i?'':t('Control units'),e)).join('')}${p.fuelType!=null?row(t('Fuel type code (PID 51)'),String(p.fuelType)):''}${p.ignition?row(t('Ignition'),t(p.ignition==='COMPRESSION'?'Compression (diesel)':'Spark')):''}
  ${p.supported?row(t('Supported mode 01 readings'),p.supported.join(' ')):''}
 </table>

 ${car?`<h2>${esc(t('Use and maintenance'))}</h2><table>${row(t('Distance recorded'),car.fuel?.distanceKm!=null?km(n(car.fuel.distanceKm,0)):'—')}${row(t('Trips'),String(car.trips?.length??'—'))}${row(t('Fuel used on trips'),car.fuel?.fuelLitres!=null?t('{n} L',{n:n(car.fuel.fuelLitres)}):'—')}${row(t('Average consumption'),car.fuel?.litresPer100Km!=null?t('{n} L/100 km',{n:n(car.fuel.litresPer100Km)}):'—')}${row(t('Findings to review'),String(car.findings?.length??'—'))}${(()=>{const last=latest(car.service,'observedAt');return row(t('Last service'),last?`${last.description} · ${new Date(last.observedAt*1000).toLocaleDateString(locale())}`:'—');})()}</table>`:''}
 <p class="muted" style="margin-top:18px">${esc(t("Read-only diagnostics over standard OBD-II (SAE J1979). Yazzy never clears codes or controls anything in the car. Values are as reported by the car's control units at the time shown."))}</p>
 </body></html>`;
}

/** Builds the PDF, names it after the car and opens the share sheet. */
export async function exportCarPdf(input:Input){
 const {uri}=await Print.printToFileAsync({html:buildCarHtml(input),base64:false,width:595,height:842});
 const d=new Date(),pad=(v:number)=>String(v).padStart(2,'0');
 const slug=String(input.vehicle?.name||'car').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')||'car';
 const name=`Yazzy-${slug}-report-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.pdf`;
 let file=uri;
 try{const target=(FileSystem.cacheDirectory||uri.slice(0,uri.lastIndexOf('/')+1))+name;await FileSystem.deleteAsync(target,{idempotent:true});await FileSystem.moveAsync({from:uri,to:target});file=target;}catch{/* keep the generated name */}
 if(!(await Sharing.isAvailableAsync()))throw new Error(t('Sharing is not available on this device. The PDF was saved at {file}',{file}));
 await Sharing.shareAsync(file,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:t('Export car report')});
 return file;
}
