import {memo,useEffect,useRef,useState,type ReactNode} from 'react';
import {Keyboard,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Animated,{useAnimatedStyle,useReducedMotion,useSharedValue,withTiming} from 'react-native-reanimated';
import {Screen} from 'react-native-screens';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F} from './theme';
import {Icon} from './kit';
import {NavigationMaterial} from './NavigationMaterial';
import {EASE_IN_OUT,haptic} from './motion';
import {t} from './i18n';

export type TabKey='Home'|'Trips'|'Health'|'Drive'|'More';
export const TABS:{key:TabKey;icon:string}[]=[
 {key:'Home',icon:'home'},{key:'Trips',icon:'map'},{key:'Health',icon:'pulse'},{key:'Drive',icon:'speedometer'},{key:'More',icon:'grid'},
];
export const NAV_HEIGHT=68;

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

/** iOS keeps its floating glass dock; Android uses an edge-to-edge, bottom-fixed light bar. */
export const NavBar=memo(function NavBar({active,onChange,bottom,recording}:{active:TabKey;onChange:(t:TabKey)=>void;bottom:number;recording:null|'live'|'armed'}){
 const reduced=useReducedMotion(),insets=useSafeAreaInsets(),android=Platform.OS==='android';
 const at=(k:TabKey)=>TABS.findIndex(tab=>tab.key===k);
 const [width,setWidth]=useState(0),[typing,setTyping]=useState(false),[shown,setShown]=useState(active),current=useRef(active);
 const item=width/TABS.length,x=useSharedValue(0);
 const move=(k:TabKey,animate:boolean)=>{if(!item)return;const to=at(k)*item;x.set(animate&&!reduced?withTiming(to,{duration:220,easing:EASE_IN_OUT}):to);};
 useEffect(()=>{if(item){move(current.current,false);}},[item]);
 const slide=(k:TabKey)=>{current.current=k;setShown(k);move(k,true);};
 // A tap moves the selection first and opens the page a frame later, so the move starts on the UI thread before the
 // page's first render takes the JS thread. Navigation from elsewhere (Back, Home's shortcuts) moves it here.
 const press=(k:TabKey)=>{if(k===current.current)return;haptic.step();slide(k);requestAnimationFrame(()=>onChange(k));};
 useEffect(()=>{if(active!==current.current)slide(active);},[active]);
 // Android lifts the bar above the keyboard, where it would cover the field being typed in; step aside instead.
 useEffect(()=>{
  if(Platform.OS!=='android')return;
  const show=Keyboard.addListener('keyboardDidShow',()=>setTyping(true)),hide=Keyboard.addListener('keyboardDidHide',()=>setTyping(false));
  return()=>{show.remove();hide.remove();};
 },[]);
 const line=useAnimatedStyle(()=>({transform:[{translateX:x.get()}]}));
 if(typing)return null;
 return <View style={[s.dock,{bottom:Math.max(8,bottom-8)},android&&s.androidDock,android&&{paddingBottom:insets.bottom}]} accessibilityRole="tablist">
  <View style={[s.material,android&&s.androidMaterial]}><NavigationMaterial/></View>
  {item>0?<Animated.View pointerEvents="none" style={[s.track,{width:item},line]}><View style={s.line}/></Animated.View>:null}
  <View style={s.bar} onLayout={e=>setWidth(e.nativeEvent.layout.width)}>
   {TABS.map(tab=>{const on=tab.key===shown;return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{selected:on}} accessibilityLabel={tab.key==='Drive'?`${t('Drive')}, ${t(recording==='live'?'Recording':recording==='armed'?'Waiting for your car':'Not recording')}`:t(tab.key)} onPress={()=>press(tab.key)} style={s.item}>
    <View>
     <Icon name={on?tab.icon:`${tab.icon}-outline`} size={21} color={on?c.blue600:c.muted}/>
     {tab.key==='Drive'&&recording?<View style={[s.dot,{backgroundColor:recording==='live'?c.green:c.blue}]}/>:null}
    </View>
    <Text style={[s.label,on&&{color:c.blue600}]} numberOfLines={1}>{t(tab.key)}</Text>
   </Pressable>;})}
  </View>
 </View>;
});

const s=StyleSheet.create({
 dock:{position:'absolute',left:12,right:12,borderRadius:20,shadowColor:'#344768',shadowOpacity:0.12,shadowRadius:16,shadowOffset:{width:0,height:5},elevation:6},
 androidDock:{left:0,right:0,bottom:0,borderRadius:0,backgroundColor:'#fafcff',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line,shadowOpacity:0,elevation:0},
 material:{...StyleSheet.absoluteFillObject,overflow:'hidden',borderRadius:20,borderWidth:1,borderColor:'rgba(255,255,255,0.9)'},
 androidMaterial:{borderRadius:0,borderWidth:0},
 bar:{height:NAV_HEIGHT,flexDirection:'row',alignItems:'center'},
 track:{position:'absolute',left:0,top:6,height:NAV_HEIGHT-12,alignItems:'center',paddingHorizontal:6},
 line:{width:'100%',height:'100%',borderRadius:12,backgroundColor:'rgba(47,107,255,0.09)'},
 item:{flex:1,height:'100%',alignItems:'center',justifyContent:'center',gap:5},
 label:{fontFamily:F[700],fontSize:10.5,letterSpacing:0.1,color:c.muted},
 dot:{position:'absolute',top:-2,right:-5,width:8,height:8,borderRadius:4,borderWidth:1.5,borderColor:c.surface},
});
