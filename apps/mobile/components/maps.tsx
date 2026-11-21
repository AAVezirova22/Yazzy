import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Modal,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Constants from 'expo-constants';
import Animated,{cancelAnimation,useAnimatedStyle,useSharedValue,withSpring} from 'react-native-reanimated';
import {Gesture,GestureDetector,GestureHandlerRootView} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView,{Marker,type LatLng,type Region} from 'react-native-maps';
import {c,F,floatShadow,radius} from './theme';
import {Icon,RoundButton} from './kit';
import {haptic,PressableScale,SPRING} from './motion';
import {project,rubberband} from './gestures';
import {t} from './i18n';

// Android maps need a Google Maps key baked in at build time (see app.config.js); iOS uses Apple Maps.
export const nativeMaps=Platform.OS==='ios'||(Platform.OS==='android'&&Constants.expoConfig?.extra?.googleMapsKey===true);

/** A region showing every point with some room around it, never closer than street level. */
export function regionFor(points:LatLng[],minDelta=0.004):Region{
 const lats=points.map(p=>p.latitude),lons=points.map(p=>p.longitude);
 const lo=Math.min(...lats),hi=Math.max(...lats),west=Math.min(...lons),east=Math.max(...lons);
 return {latitude:(lo+hi)/2,longitude:(west+east)/2,latitudeDelta:Math.max(minDelta,(hi-lo)*1.7),longitudeDelta:Math.max(minDelta,(east-west)*1.7)};
}

/**
 * A map as a still card, like the car makers' location tiles. On Android it is Google's lite mode: drawn once as a
 * picture, so it never flickers or half-renders while a page slides in, and costs a low-end phone almost nothing.
 * Tapping it opens the interactive map.
 */
export function MapPreview({region,height=180,onPress,onReady,fallback,children,label}:{region:Region;height?:number;onPress?:()=>void;onReady?:(map:MapView)=>void;fallback?:ReactNode;children?:ReactNode;label?:string}){
 const [show,setShow]=useState(false),map=useRef<MapView|null>(null);
 // Let the page finish opening before the map is created.
 useEffect(()=>{const t=setTimeout(()=>setShow(true),250);return()=>clearTimeout(t);},[]);
 const body=<>
  {nativeMaps?(show?<View style={StyleSheet.absoluteFill} pointerEvents="none">
   <MapView ref={r=>{map.current=r;}} liteMode style={StyleSheet.absoluteFill} initialRegion={region} onMapReady={()=>{if(map.current)onReady?.(map.current);}}
    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} showsCompass={false} moveOnMarkerPress={false}>{children}</MapView>
  </View>:null):fallback}
  {onPress?<View style={s.expand} pointerEvents="none"><Icon name="expand" size={14} color={c.ink}/></View>:null}
 </>;
 return onPress?<PressableScale accessibilityRole="button" accessibilityLabel={label||t('Open map')} onPress={onPress} scale={0.985} style={[s.preview,{height}]}>{body}</PressableScale>
  :<View style={[s.preview,{height}]}>{body}</View>;
}

/**
 * The interactive map, full screen, with a frosted sheet you can drag. The sheet rests showing its peek (the
 * essentials and the main action); drag or flick it up for the details, down to give the map back. Its position is
 * a shared value driven by the pan on the UI thread, and the release velocity carries into the settling spring.
 * The screen fades in (a slide would move the map surface mid-draw) and the map is created once it is shown.
 */
export function FullMap({visible,onClose,region,title,showsUser,onUser,peek,more,children}:{visible:boolean;onClose:()=>void;region:Region;title:string;showsUser?:boolean;onUser?:(p:LatLng)=>void;peek?:ReactNode;more?:ReactNode;children?:ReactNode}){
 const insets=useSafeAreaInsets(),[ready,setReady]=useState(false),[peekHeight,setPeekHeight]=useState(0),map=useRef<MapView|null>(null);
 useEffect(()=>{if(!visible)setReady(false);},[visible]);
 return <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onShow={()=>setTimeout(()=>setReady(true),60)} onRequestClose={onClose}>
  <GestureHandlerRootView style={s.full}>
   {ready&&nativeMaps?<MapView ref={r=>{map.current=r;}} style={StyleSheet.absoluteFill} initialRegion={region} showsUserLocation={showsUser} showsMyLocationButton={false} toolbarEnabled={false} showsCompass={false}
    mapPadding={{top:insets.top+60,right:0,left:0,bottom:peekHeight}}
    onUserLocationChange={e=>{const p=e.nativeEvent.coordinate;if(p)onUser?.({latitude:p.latitude,longitude:p.longitude});}}>{children}</MapView>:null}
   <View style={[s.top,{top:insets.top+10}]}>
    <RoundButton icon="close" label={t('Close map')} onPress={onClose}/>
    <View style={s.title}><Text style={s.titleText} numberOfLines={1}>{title}</Text></View>
    <RoundButton icon="scan-outline" label={t('Show everything')} onPress={()=>map.current?.animateToRegion(region,300)}/>
   </View>
   {peek?<MapSheet peek={peek} more={more} bottom={insets.bottom} onPeek={setPeekHeight}/>:null}
  </GestureHandlerRootView>
 </Modal>;
}

/** The draggable sheet: two rest points, the peek and fully open. */
function MapSheet({peek,more,bottom,onPeek}:{peek:ReactNode;more?:ReactNode;bottom:number;onPeek:(h:number)=>void}){
 const [full,setFull]=useState(0),[peekH,setPeekH]=useState(0),[open,setOpen]=useState(false);
 // translateY when resting on the peek: everything but the grabber, the peek and the safe area slides below the screen.
 const visible=peekH+bottom+14,closed=more?Math.max(0,full-visible):0;
 const y=useSharedValue(0),start=useSharedValue(0),placed=useRef(false),snapped=haptic.snap;
 // Rest on the peek once measured, and again whenever the peek changes size while the sheet is down.
 useEffect(()=>{if(!full||!peekH)return;onPeek(visible);if(!placed.current||!open){placed.current=true;y.set(closed);}},[full,peekH,closed]);
 const settle=(to:number)=>{setOpen(to===0);y.set(withSpring(to,SPRING.sheet));};
 const pan=useMemo(()=>Gesture.Pan().activeOffsetY([-8,8])
  .onStart(()=>{cancelAnimation(y);start.set(y.get());})
  .onUpdate(e=>{
   const next=start.get()+e.translationY;
   // Free between the two rest points; past either one the sheet resists.
   y.set(next<0?rubberband(next,full||1):next>closed?closed+rubberband(next-closed,full||1):next);
  })
  .onEnd(e=>{
   const to=y.get()+project(e.velocityY)<closed/2?0:closed;
   y.set(withSpring(to,{...SPRING.sheet,velocity:e.velocityY}));
   if(to!==start.get())scheduleOnRN(snapped);
   scheduleOnRN(setOpen,to===0);
  }),[closed,full]);
 const style=useAnimatedStyle(()=>({transform:[{translateY:y.get()}]}));
 return <GestureDetector gesture={pan}>
  <Animated.View onLayout={e=>setFull(Math.round(e.nativeEvent.layout.height))} style={[s.sheet,{paddingBottom:bottom+14},style,!(full&&peekH)&&{opacity:0}]}>
   <View onLayout={e=>setPeekH(Math.round(e.nativeEvent.layout.height))}>
    {more?<Pressable accessibilityRole="button" accessibilityLabel={open?t('Hide details'):t('Show details')} onPress={()=>settle(open?closed:0)} hitSlop={10} style={s.grabArea}><View style={s.grabber}/></Pressable>:<View style={s.grabArea}><View style={s.grabber}/></View>}
    {peek}
   </View>
   {more?<View style={s.more}>{more}</View>:null}
  </Animated.View>
 </GestureDetector>;
}

/** Map pins drawn as small views; frozen after the first draw so they cost nothing afterwards. */
export function Pin({coordinate,icon,color=c.blue,title,description}:{coordinate:LatLng;icon:string;color?:string;title?:string;description?:string}){
 const [drawing,setDrawing]=useState(true);
 useEffect(()=>{const t=setTimeout(()=>setDrawing(false),1500);return()=>clearTimeout(t);},[]);
 return <Marker coordinate={coordinate} title={title} description={description} anchor={{x:0.5,y:1}} tracksViewChanges={drawing}>
  <View style={{alignItems:'center'}}><View style={[s.pin,{backgroundColor:color}]}><Icon name={icon} size={15} color="#fff"/></View><View style={s.tip}/></View>
 </Marker>;
}
export function Dot({coordinate,color=c.blue,size=14,title}:{coordinate:LatLng;color?:string;size?:number;title?:string}){
 const [drawing,setDrawing]=useState(true);
 useEffect(()=>{const t=setTimeout(()=>setDrawing(false),1500);return()=>clearTimeout(t);},[]);
 return <Marker coordinate={coordinate} title={title} anchor={{x:0.5,y:0.5}} tracksViewChanges={drawing}>
  <View style={[s.dot,{width:size,height:size,borderRadius:size/2,backgroundColor:color}]}/>
 </Marker>;
}

const s=StyleSheet.create({
 preview:{borderRadius:radius.lg,overflow:'hidden',backgroundColor:'#e6ebf1'},
 expand:{position:'absolute',top:10,right:10,width:30,height:30,borderRadius:radius.md,backgroundColor:c.frost,alignItems:'center',justifyContent:'center'},
 full:{flex:1,backgroundColor:'#e6ebf1'},
 top:{position:'absolute',left:16,right:16,flexDirection:'row',alignItems:'center',gap:10},
 title:{flex:1,alignItems:'center'},
 titleText:{backgroundColor:c.frost,borderRadius:radius.pill,paddingVertical:10,paddingHorizontal:16,fontFamily:F[700],fontSize:14,color:c.ink,overflow:'hidden',borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine},
 sheet:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.frost,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,paddingHorizontal:18,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...floatShadow,shadowOpacity:0.16},
 grabArea:{alignItems:'center',paddingTop:10,paddingBottom:12},
 grabber:{width:36,height:4,borderRadius:1,backgroundColor:'#cfd6df'},
 more:{paddingTop:6},
 pin:{width:32,height:32,borderRadius:16,borderWidth:3,borderColor:'#fff',alignItems:'center',justifyContent:'center'},
 tip:{width:0,height:0,borderLeftWidth:5,borderRightWidth:5,borderTopWidth:7,borderLeftColor:'transparent',borderRightColor:'transparent',borderTopColor:'#fff',marginTop:-1},
 dot:{borderWidth:3,borderColor:'#fff'},
});
