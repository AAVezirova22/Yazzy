import {memo,useMemo} from 'react';
import {ActivityIndicator,Image,RefreshControl,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import Animated,{Extrapolation,interpolate,useAnimatedScrollHandler,useAnimatedStyle,useReducedMotion,useSharedValue} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Updater} from '../Updater';
import {c,F,radius,type,ui} from '../theme';
import {Button,Chip,Icon,ListRow,Notice,QuickAction,RoundButton,Section,Tile} from '../kit';
import {PressableScale} from '../motion';
import {RouteArt,WeekBars} from '../art';
import {LightSurface} from '../LightSurface';
import {distance,minutes} from '../TripDetail';
import {ago,carLine,clock,fmt,greeting,lastWeek,latest,routeOf,smoothDriving,weekday} from '../format';
import type {Car} from './types';
import {kindIcon,type Kind} from '../car';

type Props={vehicle:any;car:Car|null;refreshing:boolean;busy:boolean;offline:string;recorder:{label:string;live:boolean;recording:boolean};padBottom:number;
 onRefresh:()=>void;onSwitch:()=>void;onGo:(view:string)=>void;onOpenTrip:(t:any)=>void;
 carInfo:{label:string;kind:Kind|null;mil?:boolean;codes:number;read:boolean};onOpenCar:()=>void};

/**
 * Home. A realistic, illustrative car sits on a light studio wash with square quick actions; as you scroll, the
 * car recedes, shrinking and dimming a little, never sliding onto the quick actions (depth, on the UI thread,
 * dropped with Reduce Motion). Below: live status
 * tiles, the last trip, smooth driving and reminders, each one card you can read at a glance.
 */
export const GarageTab=memo(function GarageTab({vehicle,car,refreshing,busy,offline,recorder,padBottom,onRefresh,onSwitch,onGo,onOpenTrip,carInfo,onOpenCar}:Props){
 const insets=useSafeAreaInsets(),{width}=useWindowDimensions(),carWidth=Math.min(width-24,430),reduced=useReducedMotion();
 const lastTrip=latest(car?.trips,'startAt'),lastService=latest(car?.service,'observedAt'),findingCount=car?.findings?.length??0;
 const week=useMemo(()=>lastWeek(car?.trips),[car?.trips]),weekKm=week.reduce((a,b)=>a+b,0),fuel=car?.fuel;
 const smooth=useMemo(()=>smoothDriving(car?.trips),[car?.trips]);
 const scrollY=useSharedValue(0);
 const onScroll=useAnimatedScrollHandler(e=>{scrollY.set(e.contentOffset.y);});
 const carStyle=useAnimatedStyle(()=>reduced?{}:{
  transform:[
   {translateY:interpolate(scrollY.get(),[-120,0,260],[-18,0,14],Extrapolation.CLAMP)},
   {scale:interpolate(scrollY.get(),[-120,0,260],[1.05,1,0.92],Extrapolation.CLAMP)},
  ],
  opacity:interpolate(scrollY.get(),[0,260],[1,0.35],Extrapolation.CLAMP),
 });
 const route=routeOf(lastTrip);
 return <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}>
  <View style={s.overscroll}/>
  <View style={[s.hero,{paddingTop:insets.top+14}]}>
   <LightSurface/>
   <View style={[ui.row,{alignItems:'flex-start',gap:12}]}>
    <View style={{flex:1}}>
     <Text style={s.greet}>{greeting()}</Text>
     <Text style={s.name} numberOfLines={2}>{vehicle?vehicle.name:'Your garage'}</Text>
    </View>
    {busy&&!refreshing?<ActivityIndicator color={c.muted} style={{marginTop:12}}/>:null}
    <RoundButton icon="swap-horizontal" label="Switch or add vehicle" onPress={onSwitch}/>
   </View>
   {vehicle?<Animated.View style={[s.car,carStyle]} pointerEvents="none" accessible={false}>
    <Image source={require('../../assets/images/car-hero.png')} style={{width:carWidth,height:carWidth*0.5}} resizeMode="contain" accessible={false}/>
   </Animated.View>:<View style={{height:24}}/>}
   <Text style={s.line} numberOfLines={1}>{vehicle?carLine(vehicle):'Add your first vehicle to begin'}</Text>
   {vehicle?<PressableScale accessibilityRole="button" accessibilityLabel={`Recorder: ${recorder.label}. Open Drive`} onPress={()=>onGo('Record')} style={{alignSelf:'flex-start',minHeight:44,justifyContent:'center'}}>
    <Chip dot={recorder.live?c.green:recorder.recording?c.blue:c.muted} label={recorder.label}/>
   </PressableScale>:null}
   {vehicle?<View style={s.actions}>
    <QuickAction light icon={recorder.live?'radio':'play'} label="Drive" accent={recorder.live} onPress={()=>onGo('Record')}/>
    <QuickAction light icon="document-text" label="Report" onPress={onOpenCar}/>
    <QuickAction light icon="map" label="Trips" onPress={()=>onGo('Trips')}/>
    <QuickAction light icon="construct" label="Service" onPress={()=>onGo('Service')}/>
   </View>:null}
  </View>

  <View style={s.sheet}>
   {offline?<Notice icon="cloud-offline-outline" tone="warn">{offline} Showing what was saved on this phone.</Notice>:null}
   <Updater/>
   {!vehicle?<View style={ui.card}>
    <Text style={ui.title}>No vehicle yet</Text>
    <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Add your car to start recording trips, fuel and health.</Text>
    <Button title="Add a vehicle" icon="add" onPress={onSwitch}/>
   </View>:<>
    <Section title="Status"/>
    <View style={s.tiles}>
     <Tile style={{flex:1}} icon="trending-up" label="This week" value={car?.trips?fmt(weekKm,0):'—'} unit="km" caption={fuel?.tripCount?`${fmt(fuel.distanceKm,0)} km in ${fuel.tripCount} trips`:'No trips yet'} onPress={()=>onGo('Trips')}>
      <WeekBars values={week} height={52}/>
     </Tile>
     <View style={{flex:1,gap:12}}>
      <Tile icon="water" label="Fuel" value={fuel?.litresPer100Km!=null?fmt(fuel.litresPer100Km):fmt(fuel?.fuelLitres)} unit={fuel?.litresPer100Km!=null?'L/100':'L'} caption={fuel?.litresPer100Km!=null?'Average use':'Used on trips'} onPress={()=>onGo('Trips')}/>
      <Tile icon="pulse" tone={car?.findings?findingCount?'amber':'green':'blue'} label="Health" value={!car?.findings?'—':findingCount?String(findingCount):'All clear'} unit={findingCount?'to review':undefined} caption={findingCount?'Evidence-backed':'No findings'} onPress={()=>onGo('Health')}/>
     </View>
    </View>

    <Section title="Last trip" action={lastTrip?'All trips':undefined} onAction={()=>onGo('Trips')}/>
    {lastTrip?<PressableScale accessibilityRole="button" accessibilityLabel={`Last trip, ${weekday(lastTrip.startAt)}, ${distance(lastTrip.metrics?.distanceKm)}`} onPress={()=>onOpenTrip(lastTrip)} style={[ui.card,s.trip]}>
     {route.length?<RouteArt route={route} style={s.thumb} stroke={3.5}/>:<View style={[s.thumb,s.thumbEmpty]}><Icon name="navigate" size={26} color={c.blue}/></View>}
     <View style={{flex:1}}>
      <Text style={type.overline}>{weekday(lastTrip.startAt)} · {clock(lastTrip.startAt)}</Text>
      <Text style={[type.metric,{marginTop:8}]} numberOfLines={1}>{distance(lastTrip.metrics?.distanceKm)}</Text>
      <View style={[ui.row,{gap:10,marginTop:4,flexWrap:'wrap'}]}>
       <Text style={s.meta}>{minutes(lastTrip.metrics?.durationSeconds||0)}</Text>
       {lastTrip.metrics?.fuelLitres!=null?<Text style={s.meta}>{lastTrip.metrics.fuelMethod==='MAF_ESTIMATE_PETROL'?'≈ ':''}{fmt(lastTrip.metrics.fuelLitres,2)} L</Text>:null}
      </View>
     </View>
     <Icon name="chevron-forward" size={16} color={c.faint}/>
    </PressableScale>:<View style={[ui.card,s.trip]}>
     <View style={[s.thumb,s.thumbEmpty]}><Icon name="map-outline" size={26} color={c.faint}/></View>
     <View style={{flex:1}}><Text style={ui.title}>No trips yet</Text><Text style={[ui.caption,{marginTop:2,marginBottom:10}]}>Start a drive and it appears here with its route.</Text>
      <Button title="Start a drive" icon="play" onPress={()=>onGo('Record')} style={{alignSelf:'flex-start',minHeight:44,paddingHorizontal:16,marginVertical:0}}/></View>
    </View>}

    <Section title="Driving"/>
    <View style={ui.card}>
     <View style={[ui.row,{justifyContent:'space-between',alignItems:'flex-end'}]}>
      <View><Text style={type.overline}>Smooth drives · 30 days</Text><Text style={[type.metric,{marginTop:10}]}>{smooth.drives?`${Math.round(smooth.smooth/smooth.drives*100)}`:'—'}<Text style={type.unit}>{smooth.drives?' %':''}</Text></Text></View>
      {smooth.events?<Chip tone="amber" label={`${smooth.events} hard ${smooth.events===1?'event':'events'}`}/>:null}
     </View>
     <View style={s.meter}><View style={[s.meterFill,{width:`${smooth.drives?Math.max(2,smooth.smooth/smooth.drives*100):0}%`}]}/></View>
     <Text style={ui.body}>{smooth.drives?`${smooth.smooth} of ${smooth.drives} drives had no hard braking or acceleration.`:'No drives in the last 30 days yet.'}</Text>
    </View>

    <Section title="Reminders"/>
    <ListRow icon={carInfo.mil?'warning':kindIcon(carInfo.kind)} tone={carInfo.mil?'amber':'blue'} title={carInfo.kind?`${carInfo.label} car`:'Car report'} onPress={onOpenCar}
     caption={!carInfo.read?'Type, codes and battery: read on your next drive':carInfo.mil?`Check engine light on · ${carInfo.codes} codes`:carInfo.codes?`${carInfo.codes} stored fault codes`:'Check engine off · no fault codes'}/>
    <ListRow icon="construct" tone="green" title="Service" onPress={()=>onGo('Service')} caption={lastService?`${lastService.description} · ${ago(lastService.observedAt)}`:'No maintenance records yet'}/>
    {findingCount?<ListRow icon="pulse" tone="amber" title={`${findingCount} health ${findingCount===1?'finding':'findings'}`} caption="Open Health for the evidence and next step" onPress={()=>onGo('Health')}/>:null}
   </>}
  </View>
 </Animated.ScrollView>;
});

const s=StyleSheet.create({
 // Match the canvas while pulling down to refresh.
 overscroll:{position:'absolute',left:0,right:0,top:-1000,height:1000,backgroundColor:c.surface},
 hero:{paddingHorizontal:20,paddingBottom:18,overflow:'hidden',backgroundColor:c.surface},
 greet:{fontFamily:F[700],fontSize:10.5,letterSpacing:1.6,textTransform:'uppercase',color:c.muted},
 name:{fontFamily:F[600],fontSize:32,lineHeight:38,letterSpacing:-1.1,color:c.ink,marginTop:6},
 line:{fontFamily:F[500],fontSize:14,color:c.ink2,marginTop:4},
 car:{alignItems:'center',marginTop:14,marginHorizontal:-8},
 actions:{flexDirection:'row',justifyContent:'space-between',marginTop:2,gap:8},
 sheet:{backgroundColor:c.bg,paddingHorizontal:16,paddingTop:10},
 tiles:{flexDirection:'row',gap:12,marginBottom:4},
 trip:{flexDirection:'row',alignItems:'center',gap:14,padding:12},
 thumb:{width:96,height:96,borderRadius:radius.md},
 thumbEmpty:{backgroundColor:c.blue50,alignItems:'center',justifyContent:'center'},
 meta:{fontFamily:F[600],fontSize:13.5,color:c.muted,fontVariant:['tabular-nums']},
 meter:{height:4,backgroundColor:c.track,marginTop:14,marginBottom:12,overflow:'hidden'},
 meterFill:{height:4,backgroundColor:c.green},
});
