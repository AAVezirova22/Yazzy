import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Animated,Easing,KeyboardAvoidingView,Modal,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c} from './theme';
import {RoundButton} from './kit';

/** Bottom sheet: the backdrop fades while the sheet slides up, both on the UI thread. Closing plays the reverse first. */
export function Sheet({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}){
 const insets=useSafeAreaInsets(),[mounted,setMounted]=useState(open),t=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  if(open){setMounted(true);return;}
  if(!mounted)return;
  Animated.timing(t,{toValue:0,duration:190,easing:Easing.in(Easing.cubic),useNativeDriver:true}).start(({finished})=>{if(finished)setMounted(false);});
 },[open]);
 useEffect(()=>{if(open&&mounted)Animated.timing(t,{toValue:1,duration:280,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start();},[open,mounted]);
 if(!mounted)return null;
 return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
  <Animated.View style={[StyleSheet.absoluteFill,s.backdrop,{opacity:t}]}>
   <Pressable accessibilityLabel="Close" style={{flex:1}} onPress={onClose}/>
  </Animated.View>
  <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS==='ios'?'padding':undefined} style={s.holder}>
   <Animated.View style={[s.sheet,{paddingBottom:insets.bottom+20,transform:[{translateY:t.interpolate({inputRange:[0,1],outputRange:[520,0]})}]}]}>
    <View style={s.grabber}/>
    <View style={s.head}><Text style={s.title}>{title}</Text><RoundButton icon="close" label="Close" size={36} onPress={onClose}/></View>
    {children}
   </Animated.View>
  </KeyboardAvoidingView>
 </Modal>;
}

const s=StyleSheet.create({
 backdrop:{backgroundColor:'rgba(15,23,32,0.45)'},
 holder:{flex:1,justifyContent:'flex-end'},
 sheet:{backgroundColor:c.surface,borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,paddingTop:10},
 grabber:{alignSelf:'center',width:40,height:5,borderRadius:3,backgroundColor:c.track,marginBottom:14},
 head:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},
 title:{fontSize:20,fontWeight:'800',color:c.ink,letterSpacing:-0.4},
});
