import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Modal,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Constants from 'expo-constants';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView,{Marker,type LatLng,type Region} from 'react-native-maps';
import {c,shadow} from './theme';
import {Icon,RoundButton} from './kit';

// Android maps need a Google Maps key baked in at build time (see app.config.js); iOS uses Apple Maps.
export const nativeMaps=Platform.OS==='ios'||(Platform.OS==='android'&&Constants.expoConfig?.extra?.googleMapsKey===true);

/** A region showing every point with some room around it, never closer than street level. */
export function regionFor(points:LatLng[],minDelta=0.004):Region{
 const lats=points.map(p=>p.latitude),lons=points.map(p=>p.longitude);
 const lo=Math.min(...lats),hi=Math.max(...lats),west=Math.min(...lons),east=Math.max(...lons);
 return {latitude:(lo+hi)/2,longitude:(west+east)/2,latitudeDelta:Math.max(minDelta,(hi-lo)*1.7),longitudeDelta:Math.max(minDelta,(east-west)*1.7)};
}

/**
 * A map as a still card, like the car apps' location tiles. On Android it is Google's lite mode: drawn once
 * as a picture, so it never flickers or half-renders while a page slides in, and costs a low-end phone almost
 * nothing. Tapping it opens the interactive map.
 */
export function MapPreview({region,height=180,onPress,onReady,fallback,children,label='Open map'}:{region:Region;height?:number;onPress?:()=>void;onReady?:(map:MapView)=>void;fallback?:ReactNode;children?:ReactNode;label?:string}){
 const [show,setShow]=useState(false),map=useRef<MapView|null>(null);
 // Let the page finish opening before the map is created.
 useEffect(()=>{const t=setTimeout(()=>setShow(true),250);return()=>clearTimeout(t);},[]);
 return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!onPress} onPress={onPress} style={[s.preview,{height}]}>
  {nativeMaps?(show?<View style={StyleSheet.absoluteFill} pointerEvents="none">
   <MapView ref={r=>{map.current=r;}} liteMode style={StyleSheet.absoluteFill} initialRegion={region} onMapReady={()=>{if(map.current)onReady?.(map.current);}}
    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} showsCompass={false} moveOnMarkerPress={false}>{children}</MapView>
  </View>:null):fallback}
  {onPress?<View style={s.expand} pointerEvents="none"><Icon name="expand" size={14} color={c.ink}/></View>:null}
 </Pressable>;
}

/**
 * The interactive map, full screen. It fades in (a slide would move the map surface mid-draw, the cause of
 * half-drawn maps) and the map itself is only created once the screen is fully shown.
 */
export function FullMap({visible,onClose,region,title,showsUser,onUser,bottom,children}:{visible:boolean;onClose:()=>void;region:Region;title:string;showsUser?:boolean;onUser?:(p:LatLng)=>void;bottom?:ReactNode;children?:ReactNode}){
 const insets=useSafeAreaInsets(),[ready,setReady]=useState(false),map=useRef<MapView|null>(null);
 useEffect(()=>{if(!visible)setReady(false);},[visible]);
 return <Modal visible={visible} animationType="fade" statusBarTranslucent onShow={()=>setTimeout(()=>setReady(true),60)} onRequestClose={onClose}>
  <View style={s.full}>
   {ready&&nativeMaps?<MapView ref={r=>{map.current=r;}} style={StyleSheet.absoluteFill} initialRegion={region} showsUserLocation={showsUser} showsMyLocationButton={false} toolbarEnabled={false} showsCompass={false}
    onUserLocationChange={e=>{const p=e.nativeEvent.coordinate;if(p)onUser?.({latitude:p.latitude,longitude:p.longitude});}}>{children}</MapView>:null}
   <View style={[s.top,{top:insets.top+10}]}>
    <RoundButton icon="close" label="Close map" onPress={onClose}/>
    <View style={s.title}><Text style={s.titleText} numberOfLines={1}>{title}</Text></View>
    <RoundButton icon="scan-outline" label="Show everything" onPress={()=>map.current?.animateToRegion(region,300)}/>
   </View>
   {bottom?<View style={[s.bottom,{bottom:insets.bottom+16}]}>{bottom}</View>:null}
  </View>
 </Modal>;
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
 preview:{borderRadius:18,overflow:'hidden',backgroundColor:'#e6ebf1'},
 expand:{position:'absolute',top:10,right:10,width:30,height:30,borderRadius:15,backgroundColor:'rgba(255,255,255,0.92)',alignItems:'center',justifyContent:'center'},
 full:{flex:1,backgroundColor:'#e6ebf1'},
 top:{position:'absolute',left:16,right:16,flexDirection:'row',alignItems:'center',gap:10},
 title:{flex:1,alignItems:'center'},
 titleText:{backgroundColor:c.surface,borderRadius:999,paddingVertical:9,paddingHorizontal:16,fontSize:14,fontWeight:'700',color:c.ink,overflow:'hidden',...shadow},
 bottom:{position:'absolute',left:16,right:16},
 pin:{width:32,height:32,borderRadius:16,borderWidth:3,borderColor:'#fff',alignItems:'center',justifyContent:'center'},
 tip:{width:0,height:0,borderLeftWidth:5,borderRightWidth:5,borderTopWidth:7,borderLeftColor:'transparent',borderRightColor:'transparent',borderTopColor:'#fff',marginTop:-1},
 dot:{borderWidth:3,borderColor:'#fff'},
});
