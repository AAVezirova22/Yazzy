import {memo,useEffect,useRef,useState,type ReactNode} from 'react';
import {Keyboard,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Animated,{useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import {Screen} from 'react-native-screens';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {c,F,floatShadow} from './theme';
import {Icon} from './kit';
import {EASE_IN_OUT,haptic} from './motion';

export type TabKey='Home'|'Trips'|'Health'|'Drive'|'More';
export const TABS:{key:TabKey;icon:string}[]=[
 {key:'Home',icon:'home'},{key:'Trips',icon:'map'},{key:'Health',icon:'pulse'},{key:'Drive',icon:'speedometer'},{key:'More',icon:'grid'},
];
export const NAV_HEIGHT=64;

/**
 * One tab's page. Pages stay mounted once rendered: inactive ones are detached natively (react-native-screens) and
 * frozen, so switching is instant, keeps the scroll position and costs no re-render while hidden. Tabs are peers
 * that people switch between all day, so the page itself does not animate: it is simply there.
 */
export function TabPane({active,children}:{active:boolean;children:ReactNode}){
 const [rendered,setRendered]=useState(false);
 useEffect(()=>setRendered(true),[]);
 return <Screen enabled activityState={active?2:0} freezeOnBlur shouldFreeze={!active&&rendered} style={[StyleSheet.absoluteFill,{zIndex:active?0:-1}]}>{children}</Screen>;
}

/**
 * Floating night bar with a glass edge. The blue highlight travels to the tapped tab on the UI thread (220 ms,
 * ease-in-out), so it stays smooth while the new page renders; a selection tick fires on the press itself.
 * The strip behind the bar fades the page out, so nothing scrolls visibly under the bar or Android's buttons.
 */
export const NavBar=memo(function NavBar({active,onChange,bottom,recording}:{active:TabKey;onChange:(t:TabKey)=>void;bottom:number;recording:null|'live'|'armed'}){
 const at=(k:TabKey)=>TABS.findIndex(t=>t.key===k);
 const [width,setWidth]=useState(0),[typing,setTyping]=useState(false),[shown,setShown]=useState(active),current=useRef(active);
 const item=(width-INSET*2)/TABS.length,x=useSharedValue(0),placed=useRef(false);
 const move=(k:TabKey,animate:boolean)=>{if(!item)return;const to=at(k)*item;x.set(animate?withTiming(to,{duration:220,easing:EASE_IN_OUT}):to);};
 useEffect(()=>{if(item&&!placed.current){placed.current=true;move(current.current,false);}},[item]);
 const slide=(k:TabKey)=>{current.current=k;setShown(k);move(k,true);};
 // A tap moves the highlight first and opens the page a frame later, so the move starts on the UI thread before the
 // page's first render takes the JS thread. Navigation from elsewhere (Back, Home's shortcuts) moves it here.
 const press=(k:TabKey)=>{if(k===current.current)return;haptic.step();slide(k);requestAnimationFrame(()=>onChange(k));};
 useEffect(()=>{if(active!==current.current)slide(active);},[active]);
 // Android lifts the bar above the keyboard, where it would cover the field being typed in; step aside instead.
 useEffect(()=>{
  if(Platform.OS!=='android')return;
  const show=Keyboard.addListener('keyboardDidShow',()=>setTyping(true)),hide=Keyboard.addListener('keyboardDidHide',()=>setTyping(false));
  return()=>{show.remove();hide.remove();};
 },[]);
 const pill=useAnimatedStyle(()=>({transform:[{translateX:x.get()}]}));
 if(typing)return null;
 return <View pointerEvents="box-none" style={[s.dock,{height:bottom+NAV_HEIGHT+18}]}>
  <Svg pointerEvents="none" width="100%" height={FADE} style={s.fade}>
   <Defs><LinearGradient id="navFade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={c.bg} stopOpacity="0"/><Stop offset="1" stopColor={c.bg} stopOpacity="1"/></LinearGradient></Defs>
   <Rect width="100%" height={FADE} fill="url(#navFade)"/>
  </Svg>
  <View style={[s.bar,{bottom}]} onLayout={e=>setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
   {item>0?<Animated.View pointerEvents="none" style={[s.pill,{width:item},pill]}/>:null}
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

const INSET=6,FADE=28;
const s=StyleSheet.create({
 dock:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.bg},
 fade:{position:'absolute',left:0,right:0,top:-FADE},
 bar:{position:'absolute',left:14,right:14,height:NAV_HEIGHT,borderRadius:NAV_HEIGHT/2,backgroundColor:c.night,flexDirection:'row',alignItems:'center',paddingHorizontal:INSET,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine,...floatShadow},
 pill:{position:'absolute',left:INSET,top:6,bottom:6,borderRadius:26,backgroundColor:c.blue},
 item:{flex:1,height:'100%',alignItems:'center',justifyContent:'center',gap:3},
 label:{fontFamily:F[700],fontSize:10.5,color:c.nightMuted,letterSpacing:0.1},
 dot:{position:'absolute',top:-2,right:-5,width:9,height:9,borderRadius:4.5,borderWidth:1.5},
});
