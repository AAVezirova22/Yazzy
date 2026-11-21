import {useEffect,useMemo,useRef,useState} from 'react';
import {Alert,ScrollView,StyleSheet,Text,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView,{Polyline,type LatLng} from 'react-native-maps';
import {Dot,FullMap,MapPreview,nativeMaps,Pin,regionFor} from './maps';
import {exportTripPdf,REPORT_SIGNALS,type SeriesPoint} from './tripPdf';
import {c,F,floatShadow,radius,shadow,type,ui} from './theme';
import {Button,Chip,Icon,Section,Tile} from './kit';
import {PressableScale} from './motion';
import {CarArt,NightGlow,RouteArt} from './art';
import {locale,t} from './i18n';

// Android maps need a Google Maps key baked in at build time (see app.config.js); iOS uses Apple Maps.
export {nativeMaps};
type Point={observedAt:number;value:number};
type Series={points:Point[]};
type DrivingEvent={type:'HARD_ACCELERATION'|'HARD_BRAKING';time:number;peakMetresPerSecond2:number;fromKmh:number;toKmh:number;durationSeconds:number;latitude:number|null;longitude:number|null};
// Readings of recently opened trips, so opening one again is instant. A trip's readings never change once recorded.
const seen=new Map<string,[Series,Series]>();
type Props={trip:any;vehicleId:string;vehicleName?:string;call:(path:string)=>Promise<any>;onClose:()=>void};

export const minutes=(seconds:number)=>seconds>=3600?t('{h} h {m} min',{h:Math.floor(seconds/3600),m:Math.round(seconds%3600/60)}):seconds>=60?t('{n} min',{n:Math.round(seconds/60)}):t('{n} s',{n:Math.round(seconds)});
export const distance=(km:number|null|undefined)=>km==null?'—':km<1?t('{n} m',{n:Math.round(km*1000)}):t('{n} km',{n:km.toFixed(km<10?2:1)});
const clock=(at:number)=>new Date(at*1000).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'});
const eventLabel=(e:DrivingEvent)=>t(e.type==='HARD_BRAKING'?'Hard braking':'Hard acceleration');
const eventText=(e:DrivingEvent)=>t('{from} → {to} km/h in {s} s · {peak} m/s² · {time}',{from:Math.round(e.fromKmh),to:Math.round(e.toKmh),s:e.durationSeconds.toFixed(1),peak:e.peakMetresPerSecond2.toFixed(1),time:clock(e.time)});
const num=(value:number|null|undefined,digits=1)=>value==null?'—':value.toFixed(digits);
const eventColor=(e:DrivingEvent)=>e.type==='HARD_BRAKING'?c.red:c.amber;

function Bars({points,from,to,unit,color}:{points:Point[];from:number;to:number;unit:string;color:string}){
 if(!points.length)return <Text style={ui.caption}>{t('No readings recorded for this signal.')}</Text>;
 const buckets=36,span=Math.max(1,to-from),peaks=new Array<number>(buckets).fill(NaN);
 for(const p of points){const i=Math.min(buckets-1,Math.max(0,Math.floor((p.observedAt-from)/span*buckets)));peaks[i]=Number.isNaN(peaks[i])?p.value:Math.max(peaks[i],p.value);}
 const top=Math.max(1,...points.map(p=>p.value));
 return <View>
  <View style={s.bars}>{peaks.map((v,i)=><View key={i} style={[s.bar,{backgroundColor:Number.isNaN(v)?c.track:color,height:Number.isNaN(v)?4:Math.max(4,v/top*86)}]}/>)}</View>
  <View style={[ui.row,{justifyContent:'space-between',marginTop:8}]}><Text style={[ui.caption,s.nums]}>{clock(from)}</Text><Text style={[ui.caption,s.nums]}>{t('peak {n} {unit}',{n:num(top,0),unit})}</Text><Text style={[ui.caption,s.nums]}>{clock(to)}</Text></View>
 </View>;
}

/** The route, its start and end, and where hard braking or acceleration happened. */
function RouteLayers({route,events}:{route:LatLng[];events:DrivingEvent[]}){
 const pins=events.filter(e=>e.latitude!=null&&e.longitude!=null);
 return <>
  {route.length>1?<Polyline coordinates={route} strokeColor={c.blue} strokeWidth={5}/>:null}
  <Pin coordinate={route[0]} icon="flag" color={c.green} title={t('Start')}/>
  {route.length>1?<Pin coordinate={route[route.length-1]} icon="car-sport" title={t('End')}/>:null}
  {pins.map(e=><Dot key={e.type+e.time} coordinate={{latitude:e.latitude as number,longitude:e.longitude as number}} color={eventColor(e)} size={12} title={eventLabel(e)}/>)}
 </>;
}

/** Full-screen trip page: a night summary with the distance up front, the route, overview tiles, charts and export. */
export function TripDetail({trip,vehicleId,vehicleName,call,onClose}:Props){
 const m=trip.metrics,from=trip.startAt,to=trip.endAt??trip.startAt;
 const [speed,setSpeed]=useState<Series|null>(()=>seen.get(trip.id)?.[0]??null),[rpm,setRpm]=useState<Series|null>(()=>seen.get(trip.id)?.[1]??null),[failed,setFailed]=useState('');
 const [expanded,setExpanded]=useState(false),[exporting,setExporting]=useState(false),insets=useSafeAreaInsets(),inlineMap=useRef<MapView|null>(null);
 const route:LatLng[]=useMemo(()=>(m.route||[]).map((p:any)=>({latitude:p.latitude,longitude:p.longitude})),[trip.id]);
 useEffect(()=>{
  if(seen.has(trip.id))return;
  let active=true;
  const query=(signal:string)=>call(`/vehicles/${vehicleId}/telemetry?signal=${signal}&from=${from-1}&to=${to+1}&resolution=200`);
  Promise.all([query('VEHICLE_SPEED'),query('ENGINE_RPM')]).then(([a,b])=>{seen.set(trip.id,[a,b]);if(seen.size>20)seen.delete(seen.keys().next().value as string);if(active){setSpeed(a);setRpm(b);}}).catch(e=>{if(active)setFailed((e as Error).message)});
  return()=>{active=false;};
 },[trip.id]);
 const speeds=(speed?.points||[]).map(p=>p.value),topSpeed=speeds.length?Math.max(...speeds):null;
 const events:DrivingEvent[]=m.drivingEvents||[],braking=events.filter(e=>e.type==='HARD_BRAKING').length,accelerating=events.length-braking;
 const estimated=m.fuelMethod==='MAF_ESTIMATE_PETROL',stationary=trip.status==='STATIONARY';
 async function exportPdf(){
  setExporting(true);
  try{
   // Fetch every signal the car reported during the trip, so the report is complete and not limited to what the screen shows.
   const entries=await Promise.all(REPORT_SIGNALS.map(async([id])=>{try{const r=await call(`/vehicles/${vehicleId}/telemetry?signal=${id}&from=${from-1}&to=${to+1}&resolution=300`);return [id,(r.points||[]) as SeriesPoint[]] as const;}catch{return [id,[] as SeriesPoint[]] as const;}}));
   let mapImageBase64:string|null=null;
   try{if(nativeMaps&&inlineMap.current)mapImageBase64=await inlineMap.current.takeSnapshot({format:'png',quality:1,result:'base64'});}catch{/* the report falls back to a drawn route */}
   await exportTripPdf({trip,vehicleName,series:Object.fromEntries(entries),mapImageBase64});
  }catch(e){Alert.alert(t('Export failed'),(e as Error).message);}
  finally{setExporting(false);}
 }
 const started=new Date(from*1000);
 const eventChip=[braking?t('{n} hard braking',{n:braking}):null,accelerating?t('{n} hard accel.',{n:accelerating}):null].filter(Boolean).join(' · ');
 return <View style={s.page}>
  <StatusBar style="dark"/>
  <ScrollView contentContainerStyle={{padding:16,paddingTop:insets.top+10,paddingBottom:120+insets.bottom}}>
   <View style={[ui.row,{marginBottom:14}]}>
    <PressableScale accessibilityRole="button" accessibilityLabel={t('Back to trips')} onPress={onClose} style={s.back}>
     <Icon name="arrow-back" size={18} color={c.ink}/><Text style={s.backText}>{t('Trips')}</Text>
    </PressableScale>
   </View>

   <View style={s.hero}>
    <NightGlow glowX="85%" glowY="90%"/>
    <Text style={s.heroOver} numberOfLines={1}>{started.toLocaleDateString(locale(),{weekday:'short',day:'numeric',month:'short'})} · {clock(from)} – {clock(to)}</Text>
    <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit>{distance(m.distanceKm)}</Text>
    <View style={s.heroStats}>
     <HeroStat label={t('Duration')} value={minutes(m.durationSeconds||0)}/>
     <View style={s.heroDivider}/>
     <HeroStat label={t(estimated?'Fuel (est.)':'Fuel')} value={m.fuelLitres!=null?`${estimated?'≈ ':''}${t('{n} L',{n:num(m.fuelLitres,2)})}`:t('n/a')}/>
     <View style={s.heroDivider}/>
     <HeroStat label={t('Per 100 km')} value={m.litresPer100Km!=null?t('{n} L',{n:num(m.litresPer100Km)}):'—'}/>
    </View>
    <View style={[ui.row,{gap:8,marginTop:16,flexWrap:'wrap'}]}>
     {stationary?<Chip glass icon="pause" label={t('Stationary')}/>:events.length?<Chip glass dot={braking?c.red:c.amber} label={eventChip}/>:<Chip glass dot="#4ade80" label={t('Smooth drive')}/>}
    </View>
    <View style={s.heroCar} pointerEvents="none"><CarArt width={150}/></View>
   </View>

   {route.length?<View style={[ui.card,{padding:0,overflow:'hidden'}]}>
    <MapPreview region={regionFor(route)} height={210} onPress={()=>setExpanded(true)} onReady={map=>{inlineMap.current=map;}} label={t('Open the route on a map')}
     fallback={<RouteArt route={route} style={StyleSheet.absoluteFill} stroke={5} markers={events.filter(e=>e.latitude!=null).map(e=>({latitude:e.latitude as number,longitude:e.longitude as number,color:eventColor(e)}))}/>}>
     <RouteLayers route={route} events={events}/>
    </MapPreview>
    <View style={s.routeInfo}>
     <View style={s.leg}><View style={[s.legDot,{backgroundColor:c.green}]}/><Text style={s.legText}>{t('Start {time}',{time:clock(from)})}</Text></View>
     <View style={s.legLine}/>
     <View style={s.leg}><View style={[s.legDot,{backgroundColor:c.blue}]}/><Text style={s.legText}>{t('End {time}',{time:clock(to)})}</Text></View>
     <View style={{flex:1}}/>
     <PressableScale accessibilityRole="button" onPress={()=>setExpanded(true)} hitSlop={8}><Text style={s.link}>{t('Full map')}</Text></PressableScale>
    </View>
   </View>:<View style={[ui.card,s.noRoute]}><Icon name="location-outline" size={20} color={c.faint}/><Text style={ui.caption}>{t('No GPS position was recorded for this trip.')}</Text></View>}

   <Section title={t('Overview')}/>
   <View style={s.grid}>
    <Tile style={s.half} icon="speedometer-outline" label={t('Top speed')} value={topSpeed!=null?num(topSpeed,0):'—'} unit={topSpeed!=null?t('km/h'):undefined}/>
    <Tile style={s.half} icon="time-outline" label={t('Moving')} value={minutes(m.movingSeconds||0)}/>
    <Tile style={s.half} icon="hourglass-outline" label={t('Idling')} value={minutes(m.idleEngineSeconds||0)} caption={t('Engine on, standing')}/>
    <Tile style={s.half} icon="leaf-outline" tone="green" label={t('Per 100 km')} value={m.litresPer100Km!=null?num(m.litresPer100Km):'—'} unit={m.litresPer100Km!=null?t('L'):undefined} caption={estimated?t('Estimated from air flow'):undefined}/>
   </View>
   {m.fuelMethod==='UNAVAILABLE'&&<Text style={[ui.caption,{marginBottom:14}]}>{t('Fuel unavailable: this car reports neither its fuel rate nor, for a petrol engine, its air flow and fuel trims, so nothing is estimated.')}</Text>}
   {estimated&&<Text style={[ui.caption,{marginBottom:14}]}>{t("Fuel is estimated from the engine's air flow and fuel trims, because this car does not report its fuel rate. Expect it within about 10% of the pump.")}</Text>}

   <View style={ui.card}>
    <View style={[ui.row,{justifyContent:'space-between',marginBottom:6}]}>
     <Text style={ui.title}>{t('Driving events')}</Text>
     <View style={[ui.row,{gap:6}]}><Chip tone="red" label={t('{n} braking',{n:braking})}/><Chip tone="amber" label={t('{n} accel.',{n:accelerating})}/></View>
    </View>
    {events.length?events.map(e=><EventRow key={e.type+e.time} event={e}/>):<Text style={ui.body}>{t('A smooth drive: nothing harder than 3 m/s² braking or 2.5 m/s² acceleration.')}</Text>}
   </View>

   {failed?<Text style={[ui.body,{color:c.red,marginBottom:14}]}>{t('Could not load readings: {reason}',{reason:failed})}</Text>:<>
    <View style={ui.card}><Text style={[ui.title,{marginBottom:12}]}>{t('Speed')}</Text>{speed?<Bars points={speed.points} from={from} to={to} unit={t('km/h')} color={c.blue}/>:<Text style={ui.caption}>{t('Loading…')}</Text>}</View>
    <View style={ui.card}><Text style={[ui.title,{marginBottom:12}]}>{t('Engine speed')}</Text>{rpm?<Bars points={rpm.points} from={from} to={to} unit={t('rpm')} color={c.night}/>:<Text style={ui.caption}>{t('Loading…')}</Text>}</View>
   </>}
   <Text style={[ui.caption,{textAlign:'center',lineHeight:18}]}>{t('Started {when}',{when:started.toLocaleString(locale())})}{m.endReason?' · '+t('ended: {reason}',{reason:t(String(m.endReason).replaceAll('_',' ').toLowerCase())}):''}{m.distanceMethod?' · '+t('distance from {method}',{method:t(String(m.distanceMethod).replaceAll('_',' ').toLowerCase())}):''}</Text>
  </ScrollView>

  <View style={[s.footer,{paddingBottom:Math.max(insets.bottom,12)+4}]}>
   <View style={{flex:1}}><Text style={s.footValue}>{distance(m.distanceKm)}</Text><Text style={ui.caption} numberOfLines={1}>{minutes(m.durationSeconds||0)}{vehicleName?` · ${vehicleName}`:''}</Text></View>
   <Button title={t(exporting?'Preparing…':'Export PDF')} icon="download-outline" disabled={exporting} onPress={exportPdf} style={{marginVertical:0,paddingHorizontal:18}}/>
  </View>

  {route.length?<FullMap visible={expanded} onClose={()=>setExpanded(false)} region={regionFor(route)} title={`${clock(from)} – ${clock(to)}`}
   peek={<View style={{paddingBottom:4}}>
    <View style={[ui.row,{justifyContent:'space-between'}]}>
     <View><Text style={type.overline}>{t('Distance')}</Text><Text style={s.peekValue}>{distance(m.distanceKm)}</Text></View>
     <View style={{alignItems:'flex-end'}}><Text style={type.overline}>{t('Duration')}</Text><Text style={s.peekValue}>{minutes(m.durationSeconds||0)}</Text></View>
    </View>
    <View style={[ui.row,{gap:16,marginTop:12}]}>
     <View style={[ui.row,{gap:6}]}><View style={[s.legDot,{backgroundColor:c.red}]}/><Text style={ui.caption}>{t('Hard braking ({n})',{n:braking})}</Text></View>
     <View style={[ui.row,{gap:6}]}><View style={[s.legDot,{backgroundColor:c.amber}]}/><Text style={ui.caption}>{t('Hard acceleration ({n})',{n:accelerating})}</Text></View>
    </View>
   </View>}
   more={events.length?<View>{events.map(e=><EventRow key={e.type+e.time} event={e}/>)}</View>:<Text style={[ui.body,{paddingVertical:8}]}>{t('A smooth drive: no hard braking or acceleration.')}</Text>}>
   <RouteLayers route={route} events={events}/>
  </FullMap>:null}
 </View>;
}

function HeroStat({label,value}:{label:string;value:string}){
 return <View style={{flex:1}}><Text style={s.heroStatValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={s.heroStatLabel} numberOfLines={1}>{label}</Text></View>;
}

function EventRow({event:e}:{event:DrivingEvent}){
 return <View style={s.event}>
  <View style={[s.eventDot,{backgroundColor:eventColor(e)}]}/>
  <View style={{flex:1}}><Text style={s.eventTitle}>{eventLabel(e)}</Text><Text style={[ui.caption,s.nums]}>{eventText(e)}{e.latitude==null?' · '+t('no GPS fix nearby'):''}</Text></View>
 </View>;
}

const s=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},
 nums:{fontVariant:['tabular-nums']},
 back:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:c.frost,borderRadius:radius.pill,paddingVertical:10,paddingHorizontal:14,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...shadow},
 backText:{fontFamily:F[700],fontSize:14,color:c.ink},
 hero:{borderRadius:radius.xl,padding:20,marginBottom:14,overflow:'hidden',minHeight:200,backgroundColor:c.night},
 heroOver:{fontFamily:F[700],fontSize:10.5,letterSpacing:1.6,textTransform:'uppercase',color:'#9fb0c8'},
 heroValue:{fontFamily:F[500],fontSize:50,lineHeight:56,letterSpacing:-2.2,color:'#fff',marginTop:6,fontVariant:['tabular-nums']},
 heroStats:{flexDirection:'row',alignItems:'center',backgroundColor:c.glass,borderRadius:radius.md,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine,paddingVertical:12,paddingHorizontal:14,marginTop:14,gap:12},
 heroDivider:{width:StyleSheet.hairlineWidth,alignSelf:'stretch',backgroundColor:c.glassLine},
 heroStatValue:{fontFamily:F[600],fontSize:17,color:'#fff',fontVariant:['tabular-nums']},
 heroStatLabel:{fontFamily:F[600],fontSize:11.5,color:c.nightMuted,marginTop:2},
 heroCar:{position:'absolute',right:-20,top:14,opacity:0.9},
 grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12,marginBottom:14},
 half:{width:'48.4%'},
 event:{flexDirection:'row',gap:12,paddingVertical:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 eventDot:{width:10,height:10,borderRadius:5,marginTop:5},
 eventTitle:{fontFamily:F[700],fontSize:14,color:c.ink},
 bars:{flexDirection:'row',alignItems:'flex-end',height:88,gap:3},
 bar:{flex:1,borderRadius:3},
 footer:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:c.frost,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,paddingHorizontal:20,paddingTop:14,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...floatShadow,shadowOpacity:0.1,shadowOffset:{width:0,height:-6}},
 footValue:{fontFamily:F[600],fontSize:22,color:c.ink,letterSpacing:-0.5,fontVariant:['tabular-nums']},
 peekValue:{fontFamily:F[600],fontSize:24,color:c.ink,letterSpacing:-0.6,marginTop:2,fontVariant:['tabular-nums']},
 routeInfo:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingVertical:13},
 leg:{flexDirection:'row',alignItems:'center',gap:6},
 legDot:{width:9,height:9,borderRadius:5},
 legLine:{width:14,height:2,borderRadius:1,backgroundColor:c.track},
 legText:{fontFamily:F[600],fontSize:13,color:c.ink2,fontVariant:['tabular-nums']},
 link:{fontFamily:F[700],fontSize:13.5,color:c.blue},
 noRoute:{flexDirection:'row',alignItems:'center',gap:10},
});
