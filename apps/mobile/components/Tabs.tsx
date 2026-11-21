import {memo,useEffect,useRef,useState,type ReactNode} from 'react';
import {Keyboard,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Animated,{useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import {Screen} from 'react-native-screens';
import {c,F} from './theme';
import {Icon} from './kit';
import {EASE_IN_OUT,haptic} from './motion';

export type TabKey='Home'|'Trips'|'Health'|'Drive'|'More';
export const TABS:{key:TabKey;icon:string}[]=[
 {key:'Home',icon:'home'},{key:'Trips',icon:'map'},{key:'Health',icon:'pulse'},{key:'Drive',icon:'speedometer'},{key:'More',icon:'grid'},
];
export const NAV_HEIGHT=62;

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
 * Docked night bar, edge to edge, with a hairline on top. A short blue line above the active tab travels to the
 * tapped one on the UI thread (220 ms, ease-in-out), so it stays smooth while the new page renders; a selection
 * tick fires on the press itself.
 */
export const NavBar=memo(function NavBar({active,onChange,bottom,recording}:{active:TabKey;onChange:(t:TabKey)=>void;bottom:number;recording:null|'live'|'armed'}){
 const at=(k:TabKey)=>TABS.findIndex(t=>t.key===k);
 const [width,setWidth]=useState(0),[typing,setTyping]=useState(false),[shown,setShown]=useState(active),current=useRef(active);
 const item=width/TABS.length,x=useSharedValue(0),placed=useRef(false);
 const move=(k:TabKey,animate:boolean)=>{if(!item)return;const to=at(k)*item;x.set(animate?withTiming(to,{duration:220,easing:EASE_IN_OUT}):to);};
 useEffect(()=>{if(item&&!placed.current){placed.current=true;move(current.current,false);}},[item]);
 const slide=(k:TabKey)=>{current.current=k;setShown(k);move(k,true);};
 // A tap moves the line first and opens the page a frame later, so the move starts on the UI thread before the
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
 return <View style={[s.dock,{paddingBottom:Math.max(0,bottom-8)}]} onLayout={e=>setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
  {item>0?<Animated.View pointerEvents="none" style={[s.track,{width:item},line]}><View style={s.line}/></Animated.View>:null}
  <View style={s.bar}>
   {TABS.map(t=>{const on=t.key===shown;return <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:on}} accessibilityLabel={t.key} onPress={()=>press(t.key)} style={s.item}>
    <View>
     <Icon name={on?t.icon:`${t.icon}-outline`} size={21} color={on?'#fff':c.nightMuted}/>
     {t.key==='Drive'&&recording?<View style={[s.dot,{backgroundColor:recording==='live'?'#4ade80':c.blue300}]}/>:null}
    </View>
    <Text style={[s.label,on&&{color:'#fff'}]} numberOfLines={1}>{t.key}</Text>
   </Pressable>;})}
  </View>
 </View>;
});

const s=StyleSheet.create({
 dock:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.night,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.glassLine},
 bar:{height:NAV_HEIGHT,flexDirection:'row',alignItems:'center'},
 track:{position:'absolute',left:0,top:0,height:2,alignItems:'center'},
 line:{width:28,height:2,backgroundColor:c.blue},
 item:{flex:1,height:'100%',alignItems:'center',justifyContent:'center',gap:5},
 label:{fontFamily:F[700],fontSize:9.5,letterSpacing:1,textTransform:'uppercase',color:c.nightMuted},
 dot:{position:'absolute',top:-2,right:-5,width:8,height:8,borderRadius:4,borderWidth:1.5,borderColor:c.night},
});
