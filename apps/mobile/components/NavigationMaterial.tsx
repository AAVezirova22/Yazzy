import {useEffect,useState} from 'react';
import {AccessibilityInfo,Platform,StyleSheet,View} from 'react-native';
import {BlurView} from 'expo-blur';
import {GlassView,isGlassEffectAPIAvailable,isLiquidGlassAvailable} from 'expo-glass-effect';
import {c} from './theme';

/** Native iOS glass, iOS blur fallback, and an inexpensive translucent Android surface. */
export function NavigationMaterial(){
 const [opaque,setOpaque]=useState(true);
 useEffect(()=>{
  let active=true;
  AccessibilityInfo.isReduceTransparencyEnabled().then(value=>{if(active)setOpaque(value);}).catch(()=>{});
  const subscription=AccessibilityInfo.addEventListener('reduceTransparencyChanged',setOpaque);
  return()=>{active=false;subscription.remove();};
 },[]);
 if(opaque)return <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:c.surface}]}/>;
 if(Platform.OS==='ios'&&isGlassEffectAPIAvailable()&&isLiquidGlassAvailable()){
  return <GlassView pointerEvents="none" style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme="light" tintColor="#f3f6fc"/>;
 }
 if(Platform.OS==='ios')return <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} tint="systemChromeMaterialLight" intensity={85}/>;
 // SDK 54's Android native blur is experimental. Keep scroll performance stable with a
 // light translucent finish instead of enabling a heavy blur pass.
 return <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(250,252,255,0.96)'}]}/>;
}
