import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {KeyboardAvoidingView,Modal,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Animated,{cancelAnimation,Extrapolation,interpolate,useAnimatedStyle,useSharedValue,withSpring,withTiming} from 'react-native-reanimated';
import {Gesture,GestureDetector,GestureHandlerRootView} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius} from './theme';
import {RoundButton} from './kit';
import {EASE_OUT,haptic,SPRING} from './motion';
import {project,rubberband} from './gestures';

const OFF=900;

/**
 * Bottom sheet you can drag. It springs up from below; drag it down and let go, and a flick (velocity, not distance)
 * closes it while a slow nudge springs it home with the release speed carried over. Pulling up past the top
 * resists. The backdrop's opacity follows the sheet's position on the UI thread.
 */
export function Sheet({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}){
 const insets=useSafeAreaInsets(),[mounted,setMounted]=useState(open),[height,setHeight]=useState(0);
 const y=useSharedValue(OFF),start=useSharedValue(0),snapped=haptic.snap;
 useEffect(()=>{
  if(open){setMounted(true);return;}
  if(!mounted)return;
  y.set(withTiming(height||OFF,{duration:200,easing:EASE_OUT},done=>{if(done)scheduleOnRN(setMounted,false);}));
 },[open]);
 // Slide in once the sheet has measured itself, so it starts exactly one sheet-height below the screen.
 useEffect(()=>{if(open&&mounted&&height){y.set(height);y.set(withSpring(0,SPRING.sheet));}},[open,mounted,height>0]);
 const pan=useMemo(()=>Gesture.Pan().activeOffsetY([-10,10])
  .onStart(()=>{cancelAnimation(y);start.set(y.get());})
  .onUpdate(e=>{const next=start.get()+e.translationY;y.set(next>=0?next:rubberband(next,height||OFF));})
  .onEnd(e=>{
   if(y.get()+project(e.velocityY)>(height||OFF)*0.4){y.set(withSpring(height||OFF,{...SPRING.sheet,dampingRatio:1,velocity:e.velocityY,overshootClamping:true}));scheduleOnRN(onClose);}
   else{y.set(withSpring(0,{...SPRING.sheet,velocity:e.velocityY}));scheduleOnRN(snapped);}
  }),[height,onClose]);
 const sheet=useAnimatedStyle(()=>({transform:[{translateY:y.get()}]}));
 const backdrop=useAnimatedStyle(()=>({opacity:interpolate(y.get(),[0,height||OFF],[1,0],Extrapolation.CLAMP)}));
 if(!mounted)return null;
 return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
  <GestureHandlerRootView style={{flex:1}}>
   <Animated.View style={[StyleSheet.absoluteFill,s.backdrop,backdrop]}>
    <Pressable accessibilityLabel="Close" style={{flex:1}} onPress={onClose}/>
   </Animated.View>
   <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS==='ios'?'padding':undefined} style={s.holder}>
    <Animated.View onLayout={e=>{const h=Math.round(e.nativeEvent.layout.height);if(Math.abs(h-height)>1)setHeight(h);}} style={[s.sheet,{paddingBottom:insets.bottom+20},sheet]}>
     <GestureDetector gesture={pan}>
      <View style={s.handleArea}>
       <View style={s.grabber}/>
       <View style={s.head}><Text style={s.title}>{title}</Text><RoundButton icon="close" label="Close" size={36} onPress={onClose}/></View>
      </View>
     </GestureDetector>
     {children}
    </Animated.View>
   </KeyboardAvoidingView>
  </GestureHandlerRootView>
 </Modal>;
}

const s=StyleSheet.create({
 backdrop:{backgroundColor:'rgba(11,17,28,0.5)'},
 holder:{flex:1,justifyContent:'flex-end'},
 sheet:{backgroundColor:c.surface,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,paddingHorizontal:20},
 handleArea:{paddingTop:10},
 grabber:{alignSelf:'center',width:36,height:4,borderRadius:1,backgroundColor:c.track,marginBottom:12},
 head:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10},
 title:{fontFamily:F[700],fontSize:20,color:c.ink,letterSpacing:-0.4},
});
