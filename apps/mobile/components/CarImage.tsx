import {memo,useState} from 'react';
import {Image,type ImageStyle,type StyleProp} from 'react-native';
import type {VinModel} from './vinCar';

const generic=require('../assets/images/car-hero.png');

/**
 * The car in the hero: the picture of the model and year read from the VIN when the picture service has it,
 * otherwise (no VIN, unknown car, offline) the app's own illustrated car. Both have no background.
 */
export const CarImage=memo(function CarImage({vinModel,width,style}:{vinModel?:VinModel|null;width:number;style?:StyleProp<ImageStyle>}){
 const url=vinModel?.status==='READY'?vinModel.picture||null:null,[failed,setFailed]=useState<string|null>(null);
 const own=!!url&&failed!==url;
 return <Image source={own?{uri:url}:generic} onError={()=>setFailed(url)} accessible={false}
  style={[{width,height:width*0.5},style]} resizeMode="contain"/>;
});
