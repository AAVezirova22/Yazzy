import {useSyncExternalStore} from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * How the owner likes their car drawn: metallic paint colour and which way it faces. Kept on the phone per catalog
 * car (the veh_… id in its picture address), so every screen that shows the car picks it up. Both are made by our
 * server from the stored picture, for free. (view stays in the type for looks saved by build 79.)
 */
export type Look={color:string;view:string;flip:boolean};
export const DEFAULT_LOOK:Look={color:'1f2c4d',view:'front-3-4',flip:false};
/** Paint presets, the first being the default (dark blue pearl). */
export const COLORS:[string,string][]=[
 ['1f2c4d','Dark blue pearl'],['151619','Black'],['e8e9eb','Pearl white'],['b5b9bf','Silver'],
 ['5d6168','Grey'],['a3171d','Red'],['2f5fae','Blue'],['2e5a3c','Green'],
];

let looks:Record<string,Look>={};
const listeners=new Set<()=>void>(),notify=()=>listeners.forEach(l=>l());

export async function loadLooks(){
 try{const saved=JSON.parse(await SecureStore.getItemAsync('yazzy-looks')||'{}');if(saved&&typeof saved==='object'){looks=saved;notify();}}catch{/* defaults */}
}
export function setLook(vehicle:string,look:Look){
 looks={...looks,[vehicle]:look};notify();
 SecureStore.setItemAsync('yazzy-looks',JSON.stringify(looks)).catch(()=>{});
}
const subscribe=(cb:()=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};};
export function useLook(vehicle:string|null):Look{
 return useSyncExternalStore(subscribe,()=>(vehicle&&looks[vehicle])||DEFAULT_LOOK,()=>DEFAULT_LOOK);
}

/** The catalog vehicle id in a car picture address (…/car-pictures/veh_….webp). */
export const vehicleOf=(url?:string|null)=>url?.match(/car-pictures\/(veh_[a-z0-9]+)\.webp/)?.[1]||null;
/** The picture address for a look: the server repaints (metallic) and mirrors the stored picture. */
export const lookUrl=(url:string,look:Look)=>`${url}?color=${look.color}${look.flip?'&flip=true':''}`;
