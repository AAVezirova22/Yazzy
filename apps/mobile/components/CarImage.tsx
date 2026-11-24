import {memo,useState} from 'react';
import {Image,type ImageStyle,type StyleProp} from 'react-native';
import type {VinModel} from './vinCar';
import {lookUrl,useLook,vehicleOf,type Look} from './lookStore';

const generic=require('../assets/images/car-hero.png');

/**
 * The car in the hero: the picture of the model and year read from the VIN when the picture service has it, in the
 * owner's colour, view and facing (components/lookStore.ts), otherwise (no VIN, unknown car, offline) the app's own
 * illustrated car. Both have no background. `look` overrides the saved one (the picker's preview).
 */
export const CarImage=memo(function CarImage({vinModel,width,style,look}:{vinModel?:VinModel|null;width:number;style?:StyleProp<ImageStyle>;look?:Look}){
 const base=vinModel?.status==='READY'?vinModel.picture||null:null,saved=useLook(vehicleOf(base));
 const url=base?lookUrl(base,look||saved):null,[failed,setFailed]=useState<string|null>(null);
 const own=!!url&&failed!==url;
 return <Image source={own?{uri:url}:generic} onError={()=>setFailed(url)} accessible={false}
  style={[{width,height:width*0.5},style]} resizeMode="contain"/>;
});
