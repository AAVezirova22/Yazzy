import {requireOptionalNativeModule} from 'expo-modules-core';
export type RecorderConfig={apiUrl:string;deviceId:string;assignmentId:string;deviceToken:string;peripheralId:string;serviceUuid:string;writeUuid:string;notifyUuid:string};
export type RecorderSnapshot={recording:boolean;connected:boolean;queued:number;error:string|null;signals:Record<string,number>;qualification:'PENDING_DEVICE_TEST';tripState?:string};
export type Peripheral={id:string;name:string;rssi:number};
export type Characteristic={service:string;uuid:string;write:boolean;notify:boolean};
type NativeRecorder={discover:()=>Promise<Peripheral[]>;inspect:(id:string)=>Promise<Characteristic[]>;configure:(json:string)=>Promise<void>;start:()=>Promise<void>;stop:()=>Promise<void>;sync:()=>Promise<void>;snapshot:()=>Promise<RecorderSnapshot>};
const native=requireOptionalNativeModule<NativeRecorder>('YazzyRecorder');
export const available=!!native;
function requireRecorder(){if(!native)throw new Error('Install a development build containing YazzyRecorder. Expo Go does not include this native module.');return native;}
export const Recorder={discover:()=>requireRecorder().discover(),inspect:(id:string)=>requireRecorder().inspect(id),configure:(config:RecorderConfig)=>requireRecorder().configure(JSON.stringify(config)),start:()=>requireRecorder().start(),stop:()=>requireRecorder().stop(),sync:()=>requireRecorder().sync(),snapshot:()=>requireRecorder().snapshot()};
