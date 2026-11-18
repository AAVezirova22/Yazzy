import {useEffect,useState} from 'react';
import {Linking,PermissionsAndroid,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import type MapView from 'react-native-maps';
import type {LatLng} from 'react-native-maps';
import {c,shadow,ui} from './theme';
import {Icon} from './kit';
import {Dot,FullMap,MapPreview,Pin,regionFor} from './maps';
import {away,metres,since,type Spot} from './car';
import {Recorder} from '../modules/yazzy-recorder/src';

const NEAR=20000;

/**
 * Where the car is, as in the car makers' apps: a still map card with the car's pin and you, the street address,
 * how long ago and how far, Directions, and a full-screen map on tap.
 */
export function CarLocation({spot,live}:{spot:Spot&{source:'recorder'|'trip'};live:boolean}){
 const car={latitude:spot.latitude,longitude:spot.longitude};
 const [me,setMe]=useState<LatLng|null>(null),[address,setAddress]=useState<string|null>(null),[open,setOpen]=useState(false);
 useEffect(()=>{
  let active=true;
  (async()=>{
   if(Platform.OS==='android'){const fine=PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;if(!(await PermissionsAndroid.check(fine))&&(await PermissionsAndroid.request(fine))!==PermissionsAndroid.RESULTS.GRANTED)return;}
   const p=await Recorder.lastLocation();
   if(active&&p&&Date.now()/1000-p.at<1800)setMe({latitude:p.latitude,longitude:p.longitude});
  })().catch(()=>{});
  return()=>{active=false;};
 },[]);
 const distance=me?metres(me,car):null,both=me&&distance!=null&&distance<NEAR?[car,me]:[car];
 const title=live?'With you now':spot.source==='trip'?'Where your last trip ended':'Parked';
 const detail=[live?'Updating while you drive':since(spot.at),distance!=null?`${away(distance)} from you`:null,spot.accuracy?`±${Math.round(spot.accuracy)} m`:null].filter(Boolean).join(' · ');
 const lookUp=(map:MapView)=>{map.addressForCoordinate(car).then(a=>{const street=[a.thoroughfare,a.subThoroughfare].filter(Boolean).join(' ')||a.name;setAddress([street,a.locality].filter(Boolean).join(', ')||null);}).catch(()=>{});};
 const directions=()=>{const q=`${car.latitude},${car.longitude}`;Linking.openURL(Platform.OS==='ios'?`http://maps.apple.com/?daddr=${q}&dirflg=w`:`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`).catch(()=>{});};
 const where=address||`${car.latitude.toFixed(5)}, ${car.longitude.toFixed(5)}`;
 return <View style={[ui.card,{padding:0,overflow:'hidden'}]}>
  <MapPreview key={both.length} region={regionFor(both)} onPress={()=>setOpen(true)} onReady={lookUp} label="Open the car's location on a map"
   fallback={<View style={[StyleSheet.absoluteFill,s.fallback]}><Icon name="car-sport" size={26} color={c.blue}/></View>}>
   <Pin coordinate={car} icon="car-sport" title="Your car"/>
   {me&&both.length>1?<Dot coordinate={me} title="You"/>:null}
  </MapPreview>
  <View style={s.body}>
   <View style={[ui.row,{gap:12}]}>
    <View style={{flex:1}}>
     <Text style={s.kicker}>{title.toUpperCase()}</Text>
     <Text style={s.address} numberOfLines={2} selectable>{where}</Text>
     <Text style={ui.caption} numberOfLines={1}>{detail}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Walking directions to the car" onPress={directions} style={({pressed})=>[s.go,pressed&&{opacity:0.85}]}>
     <Icon name="navigate" size={18} color="#fff"/>
    </Pressable>
   </View>
  </View>

  <FullMap visible={open} onClose={()=>setOpen(false)} region={regionFor(both)} title={title} showsUser onUser={p=>setMe(m=>m&&metres(m,p)<5?m:p)}
   bottom={<View style={s.sheet}>
    <View style={{flex:1}}><Text style={s.address} numberOfLines={1}>{where}</Text><Text style={ui.caption} numberOfLines={1}>{detail}</Text></View>
    <Pressable accessibilityRole="button" onPress={directions} style={({pressed})=>[s.goWide,pressed&&{opacity:0.85}]}><Icon name="navigate" size={15} color="#fff"/><Text style={s.goText}>Directions</Text></Pressable>
   </View>}>
   <Pin coordinate={car} icon="car-sport" title="Your car" description={detail}/>
  </FullMap>
 </View>;
}

const s=StyleSheet.create({
 fallback:{alignItems:'center',justifyContent:'center'},
 body:{padding:16},
 kicker:{fontSize:11.5,fontWeight:'800',letterSpacing:0.8,color:c.blue,marginBottom:3},
 address:{fontSize:16,fontWeight:'700',color:c.ink,marginBottom:2},
 go:{width:46,height:46,borderRadius:23,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 sheet:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:c.surface,borderRadius:22,paddingVertical:12,paddingLeft:18,paddingRight:12,...shadow},
 goWide:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:c.blue,borderRadius:999,paddingVertical:11,paddingHorizontal:16},
 goText:{fontSize:14,fontWeight:'700',color:'#fff'},
});
