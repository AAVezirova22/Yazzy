import {requireOptionalNativeModule} from 'expo-modules-core';
export type RecorderConfig={apiUrl:string;deviceId:string;assignmentId:string;deviceToken:string;peripheralId:string;serviceUuid:string;writeUuid:string;notifyUuid:string};
export type RecorderSnapshot={recording:boolean;connected:boolean;configured?:boolean;waitingForAdapter?:boolean;queued:number;error:string|null;signals:Record<string,number>;qualification:'PENDING_DEVICE_TEST';tripState?:string};
export type Peripheral={id:string;name:string;rssi:number;likelyObd?:boolean};
export type Characteristic={service:string;uuid:string;write:boolean;notify:boolean};
type NativeRecorder={discover:()=>Promise<Peripheral[]>;inspect:(id:string)=>Promise<Characteristic[]>;configure:(json:string)=>Promise<void>;start:()=>Promise<void>;stop:()=>Promise<void>;sync:()=>Promise<void>;snapshot:()=>Promise<RecorderSnapshot>};
const native=requireOptionalNativeModule<NativeRecorder>('YazzyRecorder');
export const available=!!native;
function requireRecorder(){if(!native)throw new Error('Install a development build containing YazzyRecorder. Expo Go does not include this native module.');return native;}
const obdName=/vlink|vlinker|vgate|icar|obd|elm|veepeak|viecar|konnwei|carista|bluedriver|ios-vlink/i;
// Names the native layer could not resolve come back empty; label them by a short id and rank them last, with likely OBD adapters first.
export function rankPeripherals(list:Peripheral[]):Peripheral[]{
 return list.map(p=>{const name=(p.name||'').trim();return {...p,name:name||`Unnamed device ${p.id.replace(/[^0-9a-f]/gi,'').slice(-4).toUpperCase()}`,likelyObd:obdName.test(name),unnamed:!name} as Peripheral&{unnamed:boolean}})
  .sort((a:any,b:any)=>Number(b.likelyObd)-Number(a.likelyObd)||Number(a.unnamed)-Number(b.unnamed)||b.rssi-a.rssi) as Peripheral[];
}
export const Recorder={discover:async()=>rankPeripherals(await requireRecorder().discover()),inspect:(id:string)=>requireRecorder().inspect(id),configure:(config:RecorderConfig)=>requireRecorder().configure(JSON.stringify(config)),start:()=>requireRecorder().start(),stop:()=>requireRecorder().stop(),sync:()=>requireRecorder().sync(),snapshot:()=>requireRecorder().snapshot()};
