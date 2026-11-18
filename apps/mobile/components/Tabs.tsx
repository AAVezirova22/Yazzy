import {memo,useEffect,useRef,useState,type ReactNode} from 'react';
import {Animated,Easing,Keyboard,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {Screen} from 'react-native-screens';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {c,shadow} from './theme';
import {Icon} from './kit';

export type TabKey='Home'|'Trips'|'Health'|'Drive'|'More';
export const TABS:{key:TabKey;icon:string}[]=[
 {key:'Home',icon:'home'},{key:'Trips',icon:'map'},{key:'Health',icon:'pulse'},{key:'Drive',icon:'speedometer'},{key:'More',icon:'grid'},
];
export const NAV_HEIGHT=64;

/**
 * One tab's page. Pages stay mounted once rendered: inactive ones are detached natively (react-native-screens) and
 * frozen, so switching is instant, keeps the scroll position and costs no re-render while hidden. A page preloaded in
 * the background renders once before it freezes. Each activation fades the page in with a short rise, on the UI thread.
 */
export function TabPane({active,children}:{active:boolean;children:ReactNode}){
 const fade=useRef(new Animated.Value(0)).current,[rendered,setRendered]=useState(false);
 useEffect(()=>setRendered(true),[]);
 useEffect(()=>{
  // Reset while hidden, so the page never flashes at full opacity for a frame before its fade starts.
  if(!active){fade.setValue(0);return;}
  Animated.timing(fade,{toValue:1,duration:200,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start();
 },[active]);
 return <Screen enabled activityState={active?2:0} freezeOnBlur shouldFreeze={!active&&rendered} style={[StyleSheet.absoluteFill,{zIndex:active?0:-1}]}>
  <Animated.View style={{flex:1,opacity:fade,transform:[{translateY:fade.interpolate({inputRange:[0,1],outputRange:[10,0]})}]}}>{children}</Animated.View>
 </Screen>;
}

/**
 * Floating night-blue bar. The blue highlight slides between tabs on the UI thread, so it stays smooth while the
 * new page renders. The strip behind the bar fades the page out, so nothing scrolls visibly under the bar or under
 * Android's navigation buttons.
 */
export const NavBar=memo(function NavBar({active,onChange,bottom,recording}:{active:TabKey;onChange:(t:TabKey)=>void;bottom:number;recording:null|'live'|'armed'}){
 const at=(k:TabKey)=>TABS.findIndex(t=>t.key===k);
 const [width,setWidth]=useState(0),[typing,setTyping]=useState(false),[shown,setShown]=useState(active),current=useRef(active),x=useRef(new Animated.Value(at(active))).current;
 const slide=(k:TabKey)=>{current.current=k;setShown(k);Animated.spring(x,{toValue:at(k),useNativeDriver:true,damping:20,stiffness:260,mass:0.7}).start();};
 // A tap moves the highlight first and opens the page a frame later, so the slide starts on the UI thread before the
 // page's first render takes the JS thread. Navigation from elsewhere (Back, Home's shortcuts) slides it here.
 const press=(k:TabKey)=>{if(k===current.current)return;slide(k);requestAnimationFrame(()=>onChange(k));};
 useEffect(()=>{if(active!==current.current)slide(active);},[active]);
 // Android lifts the bar above the keyboard, where it would cover the field being typed in; step aside instead.
 useEffect(()=>{
  if(Platform.OS!=='android')return;
  const show=Keyboard.addListener('keyboardDidShow',()=>setTyping(true)),hide=Keyboard.addListener('keyboardDidHide',()=>setTyping(false));
  return()=>{show.remove();hide.remove();};
 },[]);
 if(typing)return null;
 const item=width/TABS.length;
 return <View pointerEvents="box-none" style={[s.dock,{height:bottom+NAV_HEIGHT+18}]}>
  <Svg pointerEvents="none" width="100%" height={FADE} style={s.fade}>
   <Defs><LinearGradient id="navFade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={c.bg} stopOpacity="0"/><Stop offset="1" stopColor={c.bg} stopOpacity="1"/></LinearGradient></Defs>
   <Rect width="100%" height={FADE} fill="url(#navFade)"/>
  </Svg>
  <View style={[s.bar,{bottom}]} onLayout={e=>setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
   {item?<Animated.View pointerEvents="none" style={[s.pill,{width:item-INSET*2,transform:[{translateX:x.interpolate({inputRange:[0,TABS.length-1],outputRange:[INSET,INSET+item*(TABS.length-1)]})}]}]}/>:null}
   {TABS.map(t=>{const on=t.key===shown;return <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:on}} accessibilityLabel={t.key} onPress={()=>press(t.key)} style={s.item}>
    <View>
     <Icon name={on?t.icon:`${t.icon}-outline`} size={21} color={on?'#fff':c.nightMuted}/>
     {t.key==='Drive'&&recording?<View style={[s.dot,{backgroundColor:recording==='live'?'#4ade80':c.blue300,borderColor:on?c.blue:c.night}]}/>:null}
    </View>
    <Text style={[s.label,on&&{color:'#fff'}]} numberOfLines={1}>{t.key}</Text>
   </Pressable>;})}
  </View>
 </View>;
});

const INSET=5,FADE=28;
const s=StyleSheet.create({
 dock:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.bg},
 fade:{position:'absolute',left:0,right:0,top:-FADE},
 bar:{position:'absolute',left:14,right:14,height:NAV_HEIGHT,borderRadius:NAV_HEIGHT/2,backgroundColor:c.night,flexDirection:'row',alignItems:'center',...shadow,shadowOpacity:0.22,elevation:8},
 pill:{position:'absolute',left:0,top:6,bottom:6,borderRadius:26,backgroundColor:c.blue},
 item:{flex:1,height:'100%',alignItems:'center',justifyContent:'center',gap:3},
 label:{fontSize:10.5,fontWeight:'700',color:c.nightMuted,letterSpacing:0.1},
 dot:{position:'absolute',top:-2,right:-5,width:9,height:9,borderRadius:4.5,borderWidth:1.5},
});
