import {useEffect,useRef,useState} from 'react';
import {Modal,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Constants from 'expo-constants';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView,{Marker,Polyline,type LatLng} from 'react-native-maps';

// Android maps need a Google Maps key baked in at build time (see app.config.js); iOS uses Apple Maps.
const nativeMaps=Platform.OS!=='android'||Constants.expoConfig?.extra?.googleMapsKey===true;
type Point={observedAt:number;value:number};
type Series={points:Point[]};
type DrivingEvent={type:'HARD_ACCELERATION'|'HARD_BRAKING';time:number;peakMetresPerSecond2:number;fromKmh:number;toKmh:number;durationSeconds:number;latitude:number|null;longitude:number|null};
type Props={trip:any;vehicleId:string;call:(path:string)=>Promise<any>};

const minutes=(seconds:number)=>seconds>=3600?`${Math.floor(seconds/3600)} h ${Math.round(seconds%3600/60)} min`:seconds>=60?`${Math.round(seconds/60)} min`:`${Math.round(seconds)} s`;
const clock=(t:number)=>new Date(t*1000).toLocaleTimeString();
const eventLabel=(e:DrivingEvent)=>e.type==='HARD_BRAKING'?'Hard braking':'Hard acceleration';
const eventText=(e:DrivingEvent)=>`${Math.round(e.fromKmh)} → ${Math.round(e.toKmh)} km/h in ${e.durationSeconds.toFixed(1)} s (${e.peakMetresPerSecond2.toFixed(1)} m/s²) · ${clock(e.time)}`;
const num=(value:number|null|undefined,digits=1)=>value==null?'—':value.toFixed(digits);

function Bars({points,from,to,unit,color}:{points:Point[];from:number;to:number;unit:string;color:string}){
 if(!points.length)return <Text style={s.muted}>No readings recorded for this signal.</Text>;
 const buckets=48,span=Math.max(1,to-from),peaks=new Array<number>(buckets).fill(NaN);
 for(const p of points){const i=Math.min(buckets-1,Math.max(0,Math.floor((p.observedAt-from)/span*buckets)));peaks[i]=Number.isNaN(peaks[i])?p.value:Math.max(peaks[i],p.value);}
 const top=Math.max(1,...points.map(p=>p.value));
 return <View>
  <View style={s.bars}>{peaks.map((v,i)=><View key={i} style={[s.bar,{backgroundColor:color,height:Number.isNaN(v)?0:Math.max(2,v/top*70)}]}/>)}</View>
  <Text style={s.muted}>peak {num(top,0)} {unit} · gaps are blank</Text>
 </View>;
}

const eventColor=(e:DrivingEvent)=>e.type==='HARD_BRAKING'?'#d93025':'#f08a00';

/** Plain route drawing used when no map provider is available. North is up; distances are to scale. */
function RouteSketch({route,events,style}:{route:LatLng[];events:DrivingEvent[];style:any}){
 const [box,setBox]=useState({width:0,height:0});
 const pad=36,lat0=route[0].latitude,scale=Math.cos(lat0*Math.PI/180);
 const raw=(p:{latitude:number;longitude:number})=>({x:p.longitude*scale,y:-p.latitude});
 const pts=route.map(raw),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
 const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(1e-9,Math.max(...xs)-minX),h=Math.max(1e-9,Math.max(...ys)-minY);
 const k=Math.max(0,Math.min((box.width-2*pad)/w,(box.height-2*pad)/h)),offX=(box.width-w*k)/2,offY=(box.height-h*k)/2;
 const at=(p:{latitude:number;longitude:number})=>{const r=raw(p);return {x:offX+(r.x-minX)*k,y:offY+(r.y-minY)*k};};
 const xy=route.map(at);
 return <View style={[style,{backgroundColor:'#e9f0e4',overflow:'hidden'}]} onLayout={e=>setBox(e.nativeEvent.layout)}>
  {box.width>0&&xy.slice(1).map((b,i)=>{const a=xy[i],len=Math.hypot(b.x-a.x,b.y-a.y);return len<0.5?null:<View key={i} style={{position:'absolute',left:(a.x+b.x)/2-len/2,top:(a.y+b.y)/2-2,width:len,height:4,borderRadius:2,backgroundColor:'#216f5c',transform:[{rotate:Math.atan2(b.y-a.y,b.x-a.x)+'rad'}]}}/>;})}
  {box.width>0&&<View style={[s.dot,{left:xy[0].x-7,top:xy[0].y-7,backgroundColor:'#2e9d4f'}]}/>}
  {box.width>0&&xy.length>1&&<View style={[s.dot,{left:xy[xy.length-1].x-7,top:xy[xy.length-1].y-7,backgroundColor:'#2d6cdf'}]}/>}
  {box.width>0&&events.filter(e=>e.latitude!=null&&e.longitude!=null).map(e=>{const p=at({latitude:e.latitude as number,longitude:e.longitude as number});return <View key={e.type+e.time} style={[s.dot,{left:p.x-8,top:p.y-8,width:16,height:16,borderRadius:8,backgroundColor:eventColor(e)}]}/>;})}
  <Text style={s.sketchNote}>Route sketch · north up · no map tiles (Google Maps key not configured)</Text>
 </View>;
}

function TripMap({route,events,style}:{route:LatLng[];events:DrivingEvent[];style:any}){
 const map=useRef<MapView>(null);
 if(!nativeMaps)return <RouteSketch route={route} events={events} style={style}/>;
 const fit=()=>{if(route.length)map.current?.fitToCoordinates(route,{edgePadding:{top:60,right:60,bottom:60,left:60},animated:false});};
 return <MapView ref={map} style={style} onMapReady={fit} onLayout={fit} initialRegion={{latitude:route[0].latitude,longitude:route[0].longitude,latitudeDelta:0.003,longitudeDelta:0.003}}>
  {route.length>1&&<Polyline coordinates={route} strokeColor="#216f5c" strokeWidth={5}/>}
  <Marker coordinate={route[0]} title="Start" description="Where the trip began" pinColor="green"/>
  {route.length>1&&<Marker coordinate={route[route.length-1]} title="Last position" pinColor="blue"/>}
  {events.filter(e=>e.latitude!=null&&e.longitude!=null).map(e=><Marker key={e.type+e.time} coordinate={{latitude:e.latitude as number,longitude:e.longitude as number}} title={eventLabel(e)} description={eventText(e)} pinColor={e.type==='HARD_BRAKING'?'red':'orange'}/>)}
 </MapView>;
}

export function TripDetail({trip,vehicleId,call}:Props){
 const m=trip.metrics,from=trip.startAt,to=trip.endAt??trip.startAt;
 const [speed,setSpeed]=useState<Series|null>(null),[rpm,setRpm]=useState<Series|null>(null),[failed,setFailed]=useState('');
 const [expanded,setExpanded]=useState(false),insets=useSafeAreaInsets();
 const route:LatLng[]=(m.route||[]).map((p:any)=>({latitude:p.latitude,longitude:p.longitude}));
 useEffect(()=>{
  let active=true;
  const query=(signal:string)=>call(`/vehicles/${vehicleId}/telemetry?signal=${signal}&from=${from-1}&to=${to+1}&resolution=200`);
  Promise.all([query('VEHICLE_SPEED'),query('ENGINE_RPM')]).then(([a,b])=>{if(active){setSpeed(a);setRpm(b);}}).catch(e=>{if(active)setFailed((e as Error).message)});
  return()=>{active=false;};
 },[trip.id]);
 const speeds=(speed?.points||[]).map(p=>p.value),topSpeed=speeds.length?Math.max(...speeds):null;
 const events:DrivingEvent[]=m.drivingEvents||[],braking=events.filter(e=>e.type==='HARD_BRAKING').length,accelerating=events.length-braking;
 return <View style={s.wrap}>
  {route.length?<>
   <View>
    <TripMap route={route} events={events} style={s.map}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Expand map" style={s.expand} onPress={()=>setExpanded(true)}><Text style={s.expandText}>⤢</Text></Pressable>
   </View>
   <Text style={s.legend}><Text style={{color:'#2e9d4f'}}>●</Text> start  <Text style={{color:'#2d6cdf'}}>●</Text> last position  <Text style={{color:'#d93025'}}>●</Text> hard braking ({braking})  <Text style={{color:'#f08a00'}}>●</Text> hard acceleration ({accelerating})</Text>
   <Modal visible={expanded} animationType="slide" onRequestClose={()=>setExpanded(false)}>
    <View style={s.full}>
     <TripMap route={route} events={events} style={StyleSheet.absoluteFill}/>
     <Pressable accessibilityRole="button" accessibilityLabel="Close map" style={[s.close,{top:insets.top+10}]} onPress={()=>setExpanded(false)}><Text style={s.closeText}>✕  Close</Text></Pressable>
     <View style={[s.fullLegend,{bottom:insets.bottom+12}]}><Text style={s.legend}><Text style={{color:'#d93025'}}>●</Text> hard braking ({braking})   <Text style={{color:'#f08a00'}}>●</Text> hard acceleration ({accelerating})   Tap a pin for details</Text></View>
    </View>
   </Modal>
  </>:<Text style={s.muted}>No GPS position was recorded for this trip, so no map is shown.</Text>}
  <View style={s.grid}>
   <View style={s.cell}><Text style={s.value}>{minutes(m.durationSeconds||0)}</Text><Text style={s.muted}>duration</Text></View>
   <View style={s.cell}><Text style={s.value}>{m.distanceKm!=null?(m.distanceKm*1000<1000?`${Math.round(m.distanceKm*1000)} m`:`${num(m.distanceKm,2)} km`):'—'}</Text><Text style={s.muted}>distance · {m.distanceMethod}</Text></View>
   <View style={s.cell}><Text style={s.value}>{num(topSpeed,0)} km/h</Text><Text style={s.muted}>top speed</Text></View>
   <View style={s.cell}><Text style={s.value}>{minutes(m.movingSeconds||0)}</Text><Text style={s.muted}>moving</Text></View>
   <View style={s.cell}><Text style={s.value}>{minutes(m.idleEngineSeconds||0)}</Text><Text style={s.muted}>idling, engine on</Text></View>
   <View style={s.cell}><Text style={s.value}>{m.fuelLitres!=null?`${num(m.fuelLitres,2)} L`:'—'}</Text><Text style={s.muted}>fuel{m.litresPer100Km!=null?` · ${num(m.litresPer100Km)} L/100 km`:''}</Text></View>
  </View>
  {m.fuelMethod==='UNAVAILABLE'&&<Text style={s.muted}>Fuel unavailable: this car did not report a fuel-rate or air-flow signal, so nothing is estimated.</Text>}
  <Text style={s.label}>Driving events</Text>{events.length?events.map(e=><Text key={e.type+e.time} style={s.event}><Text style={{color:e.type==='HARD_BRAKING'?'#d93025':'#f08a00'}}>● </Text>{eventLabel(e)} · {eventText(e)}{e.latitude==null?' · no GPS fix nearby':''}</Text>):<Text style={s.muted}>No hard braking or hard acceleration detected (braking harder than 3 m/s², accelerating harder than 2.5 m/s²).</Text>}
  {failed?<Text style={s.error}>Could not load readings: {failed}</Text>:<>
   <Text style={s.label}>Speed</Text>{speed?<Bars points={speed.points} from={from} to={to} unit="km/h" color="#216f5c"/>:<Text style={s.muted}>Loading…</Text>}
   <Text style={s.label}>Engine speed</Text>{rpm?<Bars points={rpm.points} from={from} to={to} unit="rpm" color="#c47a1c"/>:<Text style={s.muted}>Loading…</Text>}
  </>}
  <Text style={s.muted}>Started {new Date(from*1000).toLocaleString()}{m.endReason?` · ended: ${String(m.endReason).replaceAll('_',' ').toLowerCase()}`:''}</Text>
 </View>;
}

const s=StyleSheet.create({
 wrap:{marginTop:12,gap:10},
 map:{height:240,borderRadius:14,overflow:'hidden'},
 grid:{flexDirection:'row',flexWrap:'wrap',gap:8},
 cell:{width:'48%',backgroundColor:'#eef3ec',borderRadius:12,padding:10},
 value:{fontSize:18,fontWeight:'700',color:'#16372f'},
 label:{fontWeight:'700',color:'#16372f',marginTop:4},
 expand:{position:'absolute',top:8,right:8,width:38,height:38,borderRadius:10,backgroundColor:'rgba(255,255,255,0.92)',alignItems:'center',justifyContent:'center',shadowColor:'#000',shadowOpacity:0.2,shadowRadius:4,shadowOffset:{width:0,height:1}},
 expandText:{fontSize:22,color:'#16372f',marginTop:-2},
 legend:{fontSize:12,color:'#527369'},
 event:{fontSize:12,color:'#35543e',lineHeight:18},
 full:{flex:1,backgroundColor:'#000'},
 close:{position:'absolute',left:16,backgroundColor:'rgba(255,255,255,0.95)',borderRadius:20,paddingVertical:10,paddingHorizontal:16},
 closeText:{fontWeight:'700',color:'#16372f'},
 fullLegend:{position:'absolute',left:16,right:16,backgroundColor:'rgba(255,255,255,0.92)',borderRadius:12,padding:10},
 dot:{position:'absolute',width:14,height:14,borderRadius:7,borderWidth:2,borderColor:'white'},
 sketchNote:{position:'absolute',left:8,bottom:6,fontSize:10,color:'#527369'},
 muted:{color:'#527369',fontSize:12},
 error:{color:'#b3261e'},
 bars:{flexDirection:'row',alignItems:'flex-end',height:72,gap:2},
 bar:{flex:1,borderRadius:2},
});
