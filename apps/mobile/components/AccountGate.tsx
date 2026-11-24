import {useCallback,useEffect,useState} from 'react';
import {Modal,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import {c,F,radius,ui} from './theme';
import {Button,Icon} from './kit';
import {LightSurface} from './LightSurface';
import {t} from './i18n';

/** Whether this phone can confirm its owner with a fingerprint, face or the screen lock. */
export async function canUnlock(){
 try{return (await LocalAuthentication.hasHardwareAsync())&&(await LocalAuthentication.isEnrolledAsync());}catch{return false;}
}

/**
 * The account stays signed in on the phone; opening the app asks for the fingerprint or face (the phone's PIN as a
 * fallback). A phone without either opens straight away. "Use password instead" signs out.
 */
export function Lock({name,onUnlocked,onSignOut}:{name?:string;onUnlocked:()=>void;onSignOut:()=>void}){
 const insets=useSafeAreaInsets(),[failed,setFailed]=useState(false);
 const unlock=useCallback(async()=>{
  setFailed(false);
  try{
   const r=await LocalAuthentication.authenticateAsync({promptMessage:t('Unlock Yazzy'),cancelLabel:t('Cancel'),fallbackLabel:t('Use phone PIN')});
   if(r.success)onUnlocked();else setFailed(true);
  }catch{setFailed(true);}
 },[onUnlocked]);
 useEffect(()=>{void unlock();},[]);
 return <View style={[s.lock,{paddingTop:insets.top+40,paddingBottom:insets.bottom+24}]}>
  <LightSurface/>
  <Text style={s.wordmark}>yazzy</Text>
  <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
   <View style={s.badge}><Icon name="finger-print" size={40} color={c.blue}/></View>
   <Text style={s.title}>{name?t('Welcome back, {name}',{name}):t('Welcome back')}</Text>
   <Text style={[ui.body,{textAlign:'center',marginTop:6}]}>{t('Unlock with your fingerprint or face.')}</Text>
   {failed?<Text style={[ui.caption,{color:c.red,marginTop:12}]}>{t('Not recognised. Try again.')}</Text>:null}
  </View>
  <Button title={t('Unlock')} icon="finger-print" onPress={()=>{void unlock();}}/>
  <Button kind="light" title={t('Use password instead')} icon="key-outline" onPress={onSignOut}/>
 </View>;
}

/** Shown once, right after an account is created: how to start recording. */
export function Welcome({open,name,onConnect,onClose}:{open:boolean;name?:string;onConnect:()=>void;onClose:()=>void}){
 const steps:[string,string][]=[
  ['hardware-chip-outline',t('Plug the OBD adapter into the port under the dashboard, near the steering wheel.')],
  ['key-outline',t('Turn the car on (ignition or engine).')],
  ['bluetooth',t('Open Drive › Adapter, scan and tap your adapter to connect.')],
 ];
 return <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
  <View style={s.backdrop}>
   <View style={s.card}>
    <View style={s.badge}><Icon name="car-sport" size={34} color={c.blue}/></View>
    <Text style={[s.title,{textAlign:'center'}]}>{name?t('Welcome to Yazzy, {name}!',{name}):t('Welcome to Yazzy!')}</Text>
    <Text style={[ui.body,{textAlign:'center',marginTop:6,marginBottom:16}]}>{t('Your account is ready. To start recording trips, connect your car:')}</Text>
    {steps.map(([icon,text],i)=><View key={i} style={s.step}>
     <View style={s.stepIcon}><Icon name={icon} size={18} color={c.blue}/></View>
     <Text style={[ui.body,{flex:1,color:c.ink}]}>{text}</Text>
    </View>)}
    <View style={[s.step,{marginTop:4}]}>
     <View style={s.stepIcon}><Icon name="document-text-outline" size={18} color={c.blue}/></View>
     <Text style={[ui.body,{flex:1,color:c.ink}]}>{t('On Home, add the plate and documents: Yazzy shows the vignette, technical inspection and insurance dates, and checks for fines from KAT and АПИ.')}</Text>
    </View>
    <View style={{height:12}}/>
    <Button title={t('Connect the adapter')} icon="bluetooth" onPress={onConnect}/>
    <Button kind="light" title={t('Later')} onPress={onClose}/>
   </View>
  </View>
 </Modal>;
}

const s=StyleSheet.create({
 lock:{flex:1,backgroundColor:c.bg,paddingHorizontal:20,gap:10},
 wordmark:{fontFamily:F[700],fontSize:20,color:c.blue,letterSpacing:-0.5},
 badge:{width:76,height:76,borderRadius:radius.lg,backgroundColor:c.blue50,alignItems:'center',justifyContent:'center',alignSelf:'center',marginBottom:16},
 title:{fontFamily:F[700],fontSize:24,color:c.ink,letterSpacing:-0.6},
 backdrop:{flex:1,backgroundColor:'rgba(11,17,28,0.5)',justifyContent:'center',padding:20},
 card:{backgroundColor:c.surface,borderRadius:radius.xl,padding:20,gap:4},
 step:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:8},
 stepIcon:{width:36,height:36,borderRadius:radius.md,backgroundColor:c.blue50,alignItems:'center',justifyContent:'center'},
});
