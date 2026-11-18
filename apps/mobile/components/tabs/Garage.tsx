import {memo,useMemo} from 'react';
import {ActivityIndicator,Pressable,RefreshControl,ScrollView,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Updater} from '../Updater';
import {c,ui} from '../theme';
import {Button,Icon,Notice,RoundButton,Stat} from '../kit';
import {CarArt,RouteArt,WeekBars} from '../art';
import {distance,minutes} from '../TripDetail';
import {ago,carLine,clock,fmt,greeting,lastWeek,latest,routeOf,weekday} from '../format';
import type {Car} from './types';
import {kindIcon,type Kind} from '../car';

type Props={vehicle:any;car:Car|null;refreshing:boolean;busy:boolean;offline:string;recorder:{label:string;live:boolean;recording:boolean};padBottom:number;
 onRefresh:()=>void;onSwitch:()=>void;onGo:(view:string)=>void;onOpenTrip:(t:any)=>void;
 carInfo:{label:string;kind:Kind|null;mil?:boolean;codes:number;read:boolean};onOpenCar:()=>void};

/** Home: the selected car on a night header, with distance, fuel, health, the last trip and service at a glance. */
export const GarageTab=memo(function GarageTab({vehicle,car,refreshing,busy,offline,recorder,padBottom,onRefresh,onSwitch,onGo,onOpenTrip,carInfo,onOpenCar}:Props){
 const insets=useSafeAreaInsets(),{width}=useWindowDimensions(),carWidth=Math.min(width-24,380);
 const lastTrip=latest(car?.trips,'startAt'),lastService=latest(car?.service,'observedAt'),findingCount=car?.findings?.length??0;
 const week=useMemo(()=>lastWeek(car?.trips),[car?.trips]),weekKm=week.reduce((a,b)=>a+b,0),fuel=car?.fuel;
 return <ScrollView contentContainerStyle={{paddingBottom:padBottom}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" colors={[c.blue]} progressViewOffset={insets.top}/>}>
  <View style={s.overscroll}/>
  <View style={[s.top,{paddingTop:insets.top+16,paddingBottom:vehicle?92:28}]}>
   <View style={[ui.row,{alignItems:'flex-start',gap:12}]}>
    <View style={{flex:1}}>
     <Text style={s.greet}>{greeting()}</Text>
     <Text style={s.topTitle} numberOfLines={2}>{vehicle?vehicle.name:'Your garage'}</Text>
     <Text style={s.topText} numberOfLines={1}>{vehicle?carLine(vehicle):'Add your first vehicle to begin'}</Text>
    </View>
    {busy&&!refreshing?<ActivityIndicator color={c.nightMuted} style={{marginTop:12}}/>:null}
    <RoundButton dark icon="swap-horizontal" label="Switch or add vehicle" onPress={onSwitch}/>
   </View>
   {vehicle?<Pressable accessibilityRole="button" accessibilityLabel={`Recorder: ${recorder.label}. Open Drive`} onPress={()=>onGo('Record')} style={({pressed})=>[s.statusPill,pressed&&{opacity:0.8}]}>
    <View style={[s.dot,{backgroundColor:recorder.live?'#4ade80':recorder.recording?c.blue300:c.nightMuted}]}/>
    <Text style={s.statusText}>{recorder.label}</Text>
    <Icon name="chevron-forward" size={13} color={c.nightMuted}/>
   </Pressable>:null}
  </View>
  {vehicle?<View style={[s.car,{marginTop:-(carWidth*0.4)+34}]}><CarArt width={carWidth}/></View>:null}
  <View style={[s.pad,{paddingTop:vehicle?4:20}]}>
   {offline?<Notice icon="cloud-offline-outline" tone="warn">{offline} Showing what was saved on this phone.</Notice>:null}
   <Updater/>
   {!vehicle?<View style={ui.card}>
    <Text style={ui.title}>No vehicle yet</Text>
    <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Add your car to start recording trips, fuel and health.</Text>
    <Button title="Add a vehicle" icon="add" onPress={onSwitch}/>
   </View>:<>
    <View style={s.tiles}>
     <Stat title="Distance" icon="trending-up" value={fmt(fuel?.distanceKm,0)} unit="km" caption={fuel?.tripCount?`${fmt(weekKm)} km this week · ${fuel.tripCount} trips`:'No trips yet'} onPress={()=>onGo('Trips')} style={{flex:1}}>
      <WeekBars values={week}/>
     </Stat>
     <View style={{flex:1,gap:12}}>
      <Stat title="Fuel" icon="water" value={fuel?.litresPer100Km!=null?fmt(fuel.litresPer100Km):fmt(fuel?.fuelLitres)} unit={fuel?.litresPer100Km!=null?'L/100':'L'} caption={fuel?.litresPer100Km!=null?'Average use':'Used on trips'} onPress={()=>onGo('Trips')}/>
      <Stat title="Health" icon="pulse" tone={car?.findings?findingCount?'warn':'ok':undefined} value={!car?.findings?'—':findingCount?String(findingCount):'All clear'} unit={findingCount?'to review':undefined} caption={findingCount?'Evidence-backed':'No findings'} onPress={()=>onGo('Health')}/>
     </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Car report: ${carInfo.label}`} onPress={onOpenCar} style={({pressed})=>[ui.card,s.rowCard,pressed&&{opacity:0.9}]}>
     <View style={[s.circle,{backgroundColor:carInfo.mil?c.amber50:c.blue50}]}><Icon name={carInfo.mil?'warning':kindIcon(carInfo.kind)} size={18} color={carInfo.mil?c.amber:c.blue}/></View>
     <View style={{flex:1}}>
      <Text style={s.rowTitle}>{carInfo.kind?`${carInfo.label} car`:'Car report'}</Text>
      <Text style={[ui.caption,carInfo.mil&&{color:c.amber}]} numberOfLines={1}>{!carInfo.read?'Type, codes and battery: read on your next drive':carInfo.mil?`Check engine light on · ${carInfo.codes} codes`:carInfo.codes?`${carInfo.codes} stored fault codes`:'Check engine off · no fault codes'}</Text>
     </View>
     <Icon name="chevron-forward" size={16} color={c.ink}/>
    </Pressable>
    <View style={[ui.card,s.tripCard]}>
     <View style={{flex:1,paddingRight:12}}>
      <Text style={ui.title}>Last trip</Text>
      <Text style={[ui.caption,{marginTop:2}]}>{lastTrip?`${weekday(lastTrip.startAt)} · ${clock(lastTrip.startAt)}`:'No recorded journeys yet'}</Text>
      <Text style={[ui.value,{marginTop:12}]}>{lastTrip?distance(lastTrip.metrics?.distanceKm):'—'}</Text>
      <Text style={ui.caption}>{lastTrip?minutes(lastTrip.metrics?.durationSeconds||0):'Start a drive from the Drive tab'}</Text>
      <Button title={lastTrip?'View trip':'Start a drive'} icon={lastTrip?'navigate':'play'} onPress={()=>lastTrip?onOpenTrip(lastTrip):onGo('Record')} style={{marginTop:14,minHeight:44,alignSelf:'flex-start',paddingHorizontal:16}}/>
     </View>
     {routeOf(lastTrip).length?<RouteArt route={routeOf(lastTrip)} style={s.tripThumb} stroke={3.5}/>
      :<View style={[s.tripThumb,{alignItems:'center',justifyContent:'center'}]}><Icon name="map-outline" size={30} color={c.faint}/></View>}
    </View>
    <Pressable accessibilityRole="button" onPress={()=>onGo('Service')} style={({pressed})=>[ui.card,s.rowCard,pressed&&{opacity:0.9}]}>
     <View style={[s.circle,{backgroundColor:c.green50}]}><Icon name="construct" size={18} color={c.green}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>Service</Text><Text style={ui.caption} numberOfLines={1}>{lastService?`${lastService.description} · ${ago(lastService.observedAt)}`:'No maintenance records yet'}</Text></View>
     <Icon name="chevron-forward" size={16} color={c.ink}/>
    </Pressable>
   </>}
  </View>
 </ScrollView>;
});

const s=StyleSheet.create({
 pad:{paddingHorizontal:16},
 // Night above the header too, so pulling down to refresh never shows a light gap on iOS.
 overscroll:{position:'absolute',left:0,right:0,top:-1000,height:1000,backgroundColor:c.night},
 top:{backgroundColor:c.night,paddingHorizontal:20},
 greet:{fontSize:15,color:c.nightMuted,fontWeight:'500'},
 topTitle:{fontSize:30,fontWeight:'800',color:'#fff',letterSpacing:-0.8,lineHeight:35,marginTop:2},
 topText:{fontSize:14,color:c.nightMuted,marginTop:6},
 car:{alignItems:'center'},
 statusPill:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',gap:8,backgroundColor:c.night2,borderRadius:999,paddingVertical:7,paddingHorizontal:12,marginTop:16},
 statusText:{fontSize:13,fontWeight:'600',color:'#e6ebf1'},
 dot:{width:8,height:8,borderRadius:4},
 tiles:{flexDirection:'row',gap:12,marginBottom:14},
 tripCard:{flexDirection:'row',alignItems:'stretch'},
 tripThumb:{width:128,minHeight:150,borderRadius:18},
 rowCard:{flexDirection:'row',alignItems:'center',gap:12},
 circle:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
});
