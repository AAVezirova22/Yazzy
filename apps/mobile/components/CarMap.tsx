import {useEffect,useRef,useState} from 'react';
import {Linking,PermissionsAndroid,Platform,Pressable,StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import MapView,{Marker,type LatLng} from 'react-native-maps';
import {c,shadow,ui} from './theme';
import {Icon,RoundButton} from './kit';
import {nativeMaps} from './TripDetail';
import {away,metres,since,type Spot} from './car';

/**
 * The car's last known spot on a map, with you (the phone) as the blue dot, how far away it is and walking directions.
 * Without a Google Maps key on Android it shows the coordinates and the directions button only.
 */
export function CarMap({spot,live,style}:{spot:Spot&{source:'recorder'|'trip'};live:boolean;style?:StyleProp<ViewStyle>}){
 const map=useRef<MapView|null>(null),fitted=useRef(false);
 const [me,setMe]=useState<LatLng|null>(null),[locate,setLocate]=useState(Platform.OS==='ios'),[ready,setReady]=useState(false),[pinDrawing,setPinDrawing]=useState(true);
 const car={latitude:spot.latitude,longitude:spot.longitude};
 // Creating the map is the heaviest step: let the page slide in first. The custom pin is drawn once, then frozen.
 useEffect(()=>{const a=setTimeout(()=>setReady(true),300),b=setTimeout(()=>setPinDrawing(false),1800);return()=>{clearTimeout(a);clearTimeout(b);};},[]);
 useEffect(()=>{
  if(Platform.OS!=='android')return;
  const fine=PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  PermissionsAndroid.check(fine).then(ok=>ok||PermissionsAndroid.request(fine).then(r=>r===PermissionsAndroid.RESULTS.GRANTED)).then(setLocate).catch(()=>{});
 },[]);
 const both=(animated:boolean)=>{
  if(me&&metres(me,car)<30000)map.current?.fitToCoordinates([car,me],{edgePadding:{top:120,right:70,bottom:110,left:70},animated});
  else map.current?.animateToRegion({...car,latitudeDelta:0.004,longitudeDelta:0.004},animated?300:0);
 };
 // Frame you and the car together the first time your position is known.
 useEffect(()=>{if(me&&!fitted.current){fitted.current=true;both(true);}},[me]);
 const distance=me?metres(me,car):null;
 const directions=()=>{const q=`${car.latitude},${car.longitude}`;Linking.openURL(Platform.OS==='ios'?`http://maps.apple.com/?daddr=${q}&dirflg=w`:`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`).catch(()=>{});};
 const title=live?'Your car, with you now':spot.source==='trip'?'Where your last trip ended':'Where you parked';
 return <View style={[s.box,style]}>
  {nativeMaps?(ready?<MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={{...car,latitudeDelta:0.004,longitudeDelta:0.004}}
    showsUserLocation={locate} showsMyLocationButton={false} toolbarEnabled={false} showsCompass={false}
    onUserLocationChange={e=>{const p=e.nativeEvent.coordinate;if(p&&(!me||metres(me,p)>5))setMe({latitude:p.latitude,longitude:p.longitude});}}>
    <Marker coordinate={car} title="Your car" description={`${since(spot.at)}${spot.accuracy?` · ±${Math.round(spot.accuracy)} m`:''}`} anchor={{x:0.5,y:1}} tracksViewChanges={pinDrawing}>
     <View style={{alignItems:'center'}}><View style={s.pin}><Icon name="car-sport" size={17} color="#fff"/></View><View style={s.tip}/></View>
    </Marker>
   </MapView>:null)
   :<View style={[StyleSheet.absoluteFill,s.noMap]}><Icon name="car-sport" size={28} color={c.blue}/><Text selectable style={[ui.caption,{marginTop:6}]}>{car.latitude.toFixed(5)}, {car.longitude.toFixed(5)}</Text></View>}
  {nativeMaps?<View style={s.recenter}><RoundButton icon={me?'scan-outline':'car-sport-outline'} label={me?'Show you and the car':'Centre on the car'} onPress={()=>both(true)}/></View>:null}
  <View style={s.info}>
   <View style={{flex:1}}>
    <Text style={s.infoTitle} numberOfLines={1}>{title}</Text>
    <Text style={ui.caption} numberOfLines={1}>{live?'Updating while you drive':since(spot.at)}{distance!=null?` · ${away(distance)} from you`:''}</Text>
   </View>
   <Pressable accessibilityRole="button" accessibilityLabel="Walking directions to the car" onPress={directions} style={({pressed})=>[s.go,pressed&&{opacity:0.85}]}>
    <Icon name="navigate" size={15} color="#fff"/><Text style={s.goText}>Directions</Text>
   </Pressable>
  </View>
 </View>;
}

const s=StyleSheet.create({
 box:{backgroundColor:'#e6ebf1',overflow:'hidden'},
 noMap:{alignItems:'center',justifyContent:'center'},
 pin:{width:36,height:36,borderRadius:18,backgroundColor:c.blue,borderWidth:3,borderColor:'#fff',alignItems:'center',justifyContent:'center'},
 tip:{width:0,height:0,borderLeftWidth:6,borderRightWidth:6,borderTopWidth:8,borderLeftColor:'transparent',borderRightColor:'transparent',borderTopColor:'#fff',marginTop:-1},
 recenter:{position:'absolute',right:14,bottom:84},
 info:{position:'absolute',left:14,right:14,bottom:14,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:c.surface,borderRadius:20,paddingVertical:10,paddingLeft:16,paddingRight:10,...shadow},
 infoTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 go:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:c.blue,borderRadius:999,paddingVertical:10,paddingHorizontal:14},
 goText:{fontSize:13.5,fontWeight:'700',color:'#fff'},
});
