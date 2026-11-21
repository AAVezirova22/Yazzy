import {memo,useId,useState} from 'react';
import {StyleSheet,View} from 'react-native';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {c} from './theme';

/** A static, light studio wash. No animated gradients or GPU-heavy effects. */
export const LightSurface=memo(function LightSurface({variant='hero'}:{variant?:'hero'|'drive'}){
 const id=useId().replace(/:/g,''),[box,setBox]=useState({width:0,height:0});
 return <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={e=>{
  const {width,height}=e.nativeEvent.layout;
  setBox(old=>old.width===width&&old.height===height?old:{width,height});
 }}>
  {box.width>0&&<Svg width={box.width} height={box.height}>
   <Defs><LinearGradient id={id} x1="0" y1="0" x2={variant==='drive'?'1':'0'} y2="1">
    <Stop offset="0" stopColor={variant==='drive'?c.skyTop:c.surface}/>
    <Stop offset={variant==='drive'?'0.6':'0.55'} stopColor={c.skyMiddle}/>
    <Stop offset="1" stopColor={variant==='drive'?c.skyBottom:c.bg}/>
   </LinearGradient></Defs>
   <Rect width={box.width} height={box.height} fill={`url(#${id})`}/>
  </Svg>}
 </View>;
});
