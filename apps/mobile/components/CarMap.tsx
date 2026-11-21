import {useEffect,useState} from 'react';
import {Linking,PermissionsAndroid,Platform,StyleSheet,Text,View} from 'react-native';
import type MapView from 'react-native-maps';
import type {LatLng} from 'react-native-maps';
import {c,F,radius,type,ui} from './theme';
import {Button,Icon} from './kit';
import {PressableScale} from './motion';
import {Dot,FullMap,MapPreview,Pin,regionFor} from './maps';
import {away,metres,since,type Spot} from './car';
import {Recorder} from '../modules/yazzy-recorder/src';

const NEAR=20000;

/**
 * Where the car is: a still map card with the car's pin and you, the street address, how long ago and how far,
 * Directions, and a full-screen map whose sheet you can drag up for the details.
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
 const when=live?'Updating while you drive':since(spot.at),far=distance!=null?`${away(distance)} from you`:null;
 const detail=[when,far].filter(Boolean).join(' · ');
 const lookUp=(map:MapView)=>{map.addressForCoordinate(car).then(a=>{const street=[a.thoroughfare,a.subThoroughfare].filter(Boolean).join(' ')||a.name;setAddress([street,a.locality].filter(Boolean).join(', ')||null);}).catch(()=>{});};
 const directions=()=>{const q=`${car.latitude},${car.longitude}`;Linking.openURL(Platform.OS==='ios'?`http://maps.apple.com/?daddr=${q}&dirflg=w`:`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`).catch(()=>{});};
 const where=address||`${car.latitude.toFixed(5)}, ${car.longitude.toFixed(5)}`;
 return <View style={[ui.card,{padding:0,overflow:'hidden'}]}>
  <MapPreview key={both.length} region={regionFor(both)} height={190} onPress={()=>setOpen(true)} onReady={lookUp} label="Open the car's location on a map"
   fallback={<View style={[StyleSheet.absoluteFill,s.fallback]}><Icon name="car-sport" size={26} color={c.blue}/></View>}>
   <Pin coordinate={car} icon="car-sport" title="Your car"/>
   {me&&both.length>1?<Dot coordinate={me} title="You"/>:null}
  </MapPreview>
  <View style={s.body}>
   <View style={{flex:1}}>
    <Text style={[type.overline,{color:c.blue}]}>{title}</Text>
    <Text style={s.address} numberOfLines={2} selectable>{where}</Text>
    <Text style={type.caption} numberOfLines={1}>{detail}</Text>
   </View>
   <PressableScale accessibilityRole="button" accessibilityLabel="Walking directions to the car" onPress={directions} scale={0.92} style={s.go}>
    <Icon name="navigate" size={19} color="#fff"/>
   </PressableScale>
  </View>

  <FullMap visible={open} onClose={()=>setOpen(false)} region={regionFor(both)} title={title} showsUser onUser={p=>setMe(m=>m&&metres(m,p)<5?m:p)}
   peek={<View style={s.peek}>
    <Text style={[type.overline,{color:c.blue}]}>{title}</Text>
    <Text style={[s.address,{fontSize:18}]} numberOfLines={2}>{where}</Text>
    <Text style={type.caption} numberOfLines={1}>{detail}</Text>
    <Button title="Walking directions" icon="navigate" onPress={directions} style={{marginTop:14}}/>
   </View>}
   more={<View style={s.facts}>
    <Fact icon="time-outline" label={live?'Position':'Parked'} value={when}/>
    <Fact icon="walk-outline" label="From you" value={far||'Your position is unknown'}/>
    {spot.accuracy?<Fact icon="radio-button-on-outline" label="Accuracy" value={`± ${Math.round(spot.accuracy)} m`}/>:null}
    <Fact icon={spot.source==='trip'?'flag-outline':'car-sport-outline'} label="Saved from" value={spot.source==='trip'?'The end of your last trip':'The last position before the engine stopped'}/>
   </View>}>
   <Pin coordinate={car} icon="car-sport" title="Your car" description={detail}/>
  </FullMap>
 </View>;
}

function Fact({icon,label,value}:{icon:string;label:string;value:string}){
 return <View style={s.fact}>
  <Icon name={icon} size={17} color={c.muted}/>
  <Text style={[type.caption,{width:84}]}>{label}</Text>
  <Text style={[type.label,{flex:1,fontFamily:F[600]}]} numberOfLines={2}>{value}</Text>
 </View>;
}

const s=StyleSheet.create({
 fallback:{alignItems:'center',justifyContent:'center'},
 body:{flexDirection:'row',alignItems:'center',gap:12,padding:16},
 address:{fontFamily:F[700],fontSize:16,lineHeight:22,color:c.ink,marginTop:3,marginBottom:1},
 go:{width:48,height:48,borderRadius:24,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 peek:{paddingBottom:6},
 facts:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line,paddingTop:6},
 fact:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.line2,borderRadius:radius.sm},
});
