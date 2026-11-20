import {requireOptionalNativeModule} from 'expo-modules-core';
export type RecorderConfig={apiUrl:string;deviceId:string;assignmentId:string;deviceToken:string;peripheralId:string;serviceUuid:string;writeUuid:string;notifyUuid:string};
export type RecorderSnapshot={recording:boolean;connected:boolean;configured?:boolean;waitingForAdapter?:boolean;queued:number;error:string|null;signals:Record<string,number>;qualification:'PENDING_DEVICE_TEST';tripState?:string;/** The car report (JSON) the recorder last read: VIN, fuel type, codes, readiness. Android only for now. */profile?:string|null;/** Where the car was last seen moving or running (JSON: latitude, longitude, accuracy, at). Android only for now. */parked?:string|null};
export type Peripheral={id:string;name:string;rssi:number;likelyObd?:boolean};
export type Characteristic={service:string;uuid:string;write:boolean;notify:boolean};
type NativeRecorder={discover:()=>Promise<Peripheral[]>;inspect:(id:string)=>Promise<Characteristic[]>;configure:(json:string)=>Promise<void>;start:()=>Promise<void>;stop:()=>Promise<void>;sync:()=>Promise<void>;reconnect?:()=>Promise<boolean>;reset?:()=>Promise<void>;lastLocation?:()=>Promise<{latitude:number;longitude:number;accuracy:number;at:number}|null>;snapshot:()=>Promise<RecorderSnapshot>};
const native=requireOptionalNativeModule<NativeRecorder>('YazzyRecorder');
export const available=!!native;
function requireRecorder(){if(!native)throw new Error('Install a development build containing YazzyRecorder. Expo Go does not include this native module.');return native;}
const obdName=/vlink|vlinker|vgate|icar|obd|elm|veepeak|viecar|konnwei|carista|bluedriver|ios-vlink/i;
// Names the native layer could not resolve come back empty; label them by a short id and rank them last, with likely OBD adapters first.
export function rankPeripherals(list:Peripheral[]):Peripheral[]{
 return list.map(p=>{const name=(p.name||'').trim();return {...p,name:name||`Unnamed device ${p.id.replace(/[^0-9a-f]/gi,'').slice(-4).toUpperCase()}`,likelyObd:obdName.test(name),unnamed:!name} as Peripheral&{unnamed:boolean}})
  .sort((a:any,b:any)=>Number(b.likelyObd)-Number(a.likelyObd)||Number(a.unnamed)-Number(b.unnamed)||b.rssi-a.rssi) as Peripheral[];
}
// Known OBD serial-over-BLE channels as [service, write, notify]. Many adapters also expose the Bluetooth chip's own
// vendor service (for example 49535343-…-6daa/aca3); it accepts writes but never answers OBD commands.
const uart:[string,string,string][]=[
 ['0000fff0','0000fff2','0000fff1'], // most ELM327 BLE clones, including Viecar
 ['0000ffe0','0000ffe1','0000ffe1'], // HM-10 style single characteristic
 ['000018f0','00002af1','00002af0'], // vLinker / Vgate
 ['49535343-fe7d','49535343-8841','49535343-1e4d'], // Microchip transparent UART data pair
 ['6e400001','6e400002','6e400003'], // Nordic UART
];
const has=(uuid:string,prefix:string)=>uuid.toLowerCase().startsWith(prefix);
/** The write/notify pair to use for an adapter: a known OBD channel first, else the only service offering both. */
export function knownChannels(list:Characteristic[]):{write:Characteristic;notify:Characteristic}|null{
 for(const [svc,w,n] of uart){
  const write=list.find(c=>has(c.service,svc)&&has(c.uuid,w)&&c.write),notify=list.find(c=>has(c.service,svc)&&has(c.uuid,n)&&c.notify);
  if(write&&notify)return {write,notify};
 }
 return null;
}
export function pickChannels(list:Characteristic[]):{write:Characteristic;notify:Characteristic}|null{
 const known=knownChannels(list);if(known)return known;
 const services=[...new Set(list.map(c=>c.service))].filter(svc=>list.some(c=>c.service===svc&&c.write)&&list.some(c=>c.service===svc&&c.notify));
 if(services.length!==1)return null;
 const w=list.filter(c=>c.service===services[0]&&c.write),n=list.filter(c=>c.service===services[0]&&c.notify);
 return w.length===1&&n.length===1?{write:w[0],notify:n[0]}:null;
}
export const Recorder={discover:async()=>rankPeripherals(await requireRecorder().discover()),inspect:(id:string)=>requireRecorder().inspect(id),configure:(config:RecorderConfig)=>requireRecorder().configure(JSON.stringify(config)),start:()=>requireRecorder().start(),stop:()=>requireRecorder().stop(),lastLocation:async()=>native?.lastLocation?native.lastLocation().catch(()=>null):null,reconnect:async()=>{const r=requireRecorder();return r.reconnect?r.reconnect():false;},sync:()=>requireRecorder().sync(),/** Discards the upload queue and forgets the pairing. Builds before Android 41 lack it; check canReset first. */reset:async()=>{const r=requireRecorder();if(!r.reset)throw new Error('Reset is not available on this platform yet.');await r.reset();},canReset:!!native?.reset,snapshot:()=>requireRecorder().snapshot()};
