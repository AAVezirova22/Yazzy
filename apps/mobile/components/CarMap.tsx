import {useEffect,useState} from 'react';
import {Linking,PermissionsAndroid,Platform,StyleSheet,Text,View} from 'react-native';
import type MapView from 'react-native-maps';
import type {LatLng} from 'react-native-maps';
import {c,F,radius,type,ui} from './theme';
import {Button,Icon} from './kit';
import {PressableScale} from './motion';
import {Dot,FullMap,MapPreview,nativeMaps,Pin,regionFor} from './maps';
import {away,metres,since,type Spot} from './car';
import {Recorder} from '../modules/yazzy-recorder/src';
import {t} from './i18n';

const NEAR=20000;
type CarSpot=Spot&{source:'recorder'|'trip'};

/**
 * What every map of the car's spot shares: your own position (read once `active`, so nothing asks for location
 * permission until a map is actually opened), the street address, the wording, and Directions in the phone's own
 * maps app (Apple Maps on iPhone, Google Maps on Android).
 */
function useCarPlace(spot:CarSpot,live:boolean,active:boolean){
 const car={latitude:spot.latitude,longitude:spot.longitude};
 const [me,setMe]=useState<LatLng|null>(null),[address,setAddress]=useState<string|null>(null);
 useEffect(()=>{
  if(!active)return;
  let on=true;
  (async()=>{
   if(Platform.OS==='android'){const fine=PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;if(!(await PermissionsAndroid.check(fine))&&(await PermissionsAndroid.request(fine))!==PermissionsAndroid.RESULTS.GRANTED)return;}
   const p=await Recorder.lastLocation();
   if(on&&p&&Date.now()/1000-p.at<1800)setMe({latitude:p.latitude,longitude:p.longitude});
  })().catch(()=>{});
  return()=>{on=false;};
 },[active]);
 const distance=me?metres(me,car):null,both=me&&distance!=null&&distance<NEAR?[car,me]:[car];
 const title=t(live?'With you now':spot.source==='trip'?'Where your last trip ended':'Parked');
 const when=live?t('Updating while you drive'):since(spot.at),far=distance!=null?t('{d} from you',{d:away(distance)}):null;
 const detail=[when,far].filter(Boolean).join(' · ');
 const lookUp=(map:MapView)=>{map.addressForCoordinate(car).then(a=>{const street=[a.thoroughfare,a.subThoroughfare].filter(Boolean).join(' ')||a.name;setAddress([street,a.locality].filter(Boolean).join(', ')||null);}).catch(()=>{});};
 const q=`${car.latitude},${car.longitude}`;
 const directions=()=>{Linking.openURL(Platform.OS==='ios'?`http://maps.apple.com/?daddr=${q}&dirflg=w`:`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`).catch(()=>{});};
 /** For an Android build without a Google Maps key: show the spot in the maps app instead of in ours. */
 const openExternal=()=>{Linking.openURL(Platform.OS==='ios'?`http://maps.apple.com/?ll=${q}&q=${encodeURIComponent(t('Your car'))}`:`https://www.google.com/maps/search/?api=1&query=${q}`).catch(()=>{});};
 const where=address||`${car.latitude.toFixed(5)}, ${car.longitude.toFixed(5)}`;
 return {car,me,setMe,both,title,when,far,detail,where,lookUp,directions,openExternal};
}
type Place=ReturnType<typeof useCarPlace>;

/** The interactive full-screen map of the car: the pin, and a sheet you can drag up for the details. */
function CarFullMap({place,spot,live,open,onClose}:{place:Place;spot:CarSpot;live:boolean;open:boolean;onClose:()=>void}){
 const {car,both,title,when,far,detail,where,lookUp,directions,setMe}=place;
 return <FullMap visible={open} onClose={onClose} region={regionFor(both)} title={title} showsUser onUser={p=>setMe(m=>m&&metres(m,p)<5?m:p)} onReady={lookUp}
  peek={<View style={s.peek}>
   <Text style={[type.overline,{color:c.blue}]}>{title}</Text>
   <Text style={[s.address,{fontSize:18}]} numberOfLines={2}>{where}</Text>
   <Text style={type.caption} numberOfLines={1}>{detail}</Text>
   <Button title={t('Walking directions')} icon="navigate" onPress={directions} style={{marginTop:14}}/>
  </View>}
  more={<View style={s.facts}>
   <Fact icon="time-outline" label={t(live?'Position':'Parked')} value={when}/>
   <Fact icon="walk-outline" label={t('From you')} value={far||t('Your position is unknown')}/>
   {spot.accuracy?<Fact icon="radio-button-on-outline" label={t('Accuracy')} value={`± ${Math.round(spot.accuracy)} m`}/>:null}
   <Fact icon={spot.source==='trip'?'flag-outline':'car-sport-outline'} label={t('Saved from')} value={t(spot.source==='trip'?'The end of your last trip':'The last position before the engine stopped')}/>
  </View>}>
  <Pin coordinate={car} icon="car-sport" title={t('Your car')} description={detail}/>
 </FullMap>;
}

/**
 * Where the car is: a still map card with the car's pin and you, the street address, how long ago and how far,
 * Directions, and a full-screen map whose sheet you can drag up for the details.
 */
export function CarLocation({spot,live}:{spot:CarSpot;live:boolean}){
 const [open,setOpen]=useState(false),place=useCarPlace(spot,live,true);
 const {car,me,both,title,detail,where,lookUp,directions}=place;
 return <View style={[ui.card,{padding:0,overflow:'hidden'}]}>
  <MapPreview key={both.length} region={regionFor(both)} height={190} onPress={()=>setOpen(true)} onReady={lookUp} label={t("Open the car's location on a map")}
   fallback={<View style={[StyleSheet.absoluteFill,s.fallback]}><Icon name="car-sport" size={26} color={c.blue}/></View>}>
   <Pin coordinate={car} icon="car-sport" title={t('Your car')}/>
   {me&&both.length>1?<Dot coordinate={me} title={t('You')}/>:null}
  </MapPreview>
  <View style={s.body}>
   <View style={{flex:1}}>
    <Text style={[type.overline,{color:c.blue}]}>{title}</Text>
    <Text style={s.address} numberOfLines={2} selectable>{where}</Text>
    <Text style={type.caption} numberOfLines={1}>{detail}</Text>
   </View>
   <PressableScale accessibilityRole="button" accessibilityLabel={t('Walking directions to the car')} onPress={directions} scale={0.92} style={s.go}>
    <Icon name="navigate" size={19} color="#fff"/>
   </PressableScale>
  </View>
  <CarFullMap place={place} spot={spot} live={live} open={open} onClose={()=>setOpen(false)}/>
 </View>;
}

/**
 * A small pill for a screen header: opens the full-screen map of the parked car (the last position before the engine
 * stopped, or where the last trip ended). Without map support in the build it opens the phone's maps app instead.
 */
export function ParkedCarButton({spot,live}:{spot:CarSpot;live:boolean}){
 const [open,setOpen]=useState(false),place=useCarPlace(spot,live,open);
 return <>
  <PressableScale accessibilityRole="button" accessibilityLabel={t("Open the car's location on a map")} onPress={()=>nativeMaps?setOpen(true):place.openExternal()} scale={0.94} style={s.pill}>
   <Icon name="car-sport" size={15} color={c.blue}/>
   <Text style={s.pillText} numberOfLines={1}>{t(live?'Your car':'Parked')}</Text>
  </PressableScale>
  {nativeMaps?<CarFullMap place={place} spot={spot} live={live} open={open} onClose={()=>setOpen(false)}/>:null}
 </>;
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
 pill:{flexDirection:'row',alignItems:'center',gap:6,height:34,paddingHorizontal:12,borderRadius:radius.pill,backgroundColor:c.blue50},
 pillText:{fontFamily:F[700],fontSize:13,color:c.blue},
 go:{width:48,height:48,borderRadius:radius.md,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 peek:{paddingBottom:6},
 facts:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line,paddingTop:6},
 fact:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.line2,borderRadius:radius.sm},
});
