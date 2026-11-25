import {memo,useMemo,useState} from 'react';
import * as Clipboard from 'expo-clipboard';
import {ActivityIndicator,RefreshControl,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import Animated,{Extrapolation,interpolate,useAnimatedScrollHandler,useAnimatedStyle,useReducedMotion,useSharedValue} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Updater} from '../Updater';
import {c,F,radius,type,ui} from '../theme';
import {Button,Chip,Icon,ListRow,Notice,QuickAction,RoundButton,Section,Tile} from '../kit';
import {haptic,PressableScale} from '../motion';
import {RouteArt,WeekBars} from '../art';
import {LightSurface} from '../LightSurface';
import {CarImage} from '../CarImage';
import type {VinModel} from '../vinCar';
import {distance,minutes} from '../TripDetail';
import {ago,carLine,clock,fmt,greeting,lastWeek,latest,routeOf,smoothDriving,weekday} from '../format';
import type {Car} from './types';
import {kindIcon,since,type Kind} from '../car';
import {locale,t,tp} from '../i18n';

type Props={vehicle:any;car:Car|null;refreshing:boolean;busy:boolean;offline:string;recorder:{label:string;live:boolean;recording:boolean};padBottom:number;
 onRefresh:()=>void;onSwitch:()=>void;onGo:(view:string)=>void;onOpenTrip:(t:any)=>void;
 carInfo:{label:string;kind:Kind|null;mil?:boolean;codes:number;read:boolean;hasVin:boolean;maker?:string|null;vin?:string|null;odometerKm?:number|null;fuelPct?:number|null;readingsAt?:number|null};onOpenCar:()=>void;vinModel?:VinModel|null;onSetYear:()=>void;onEnterVin:()=>void;onPickModel:()=>void;business:number;onBusiness:()=>void;onLook:()=>void};

/**
 * Home. A realistic, illustrative car sits on a light studio wash with square quick actions; as you scroll, the
 * car recedes, shrinking and dimming a little, never sliding onto the quick actions (depth, on the UI thread,
 * dropped with Reduce Motion). Below: live status
 * tiles, the last trip, smooth driving and reminders, each one card you can read at a glance.
 */
export const GarageTab=memo(function GarageTab({vehicle,car,refreshing,busy,offline,recorder,padBottom,onRefresh,onSwitch,onGo,onOpenTrip,carInfo,onOpenCar,vinModel,onSetYear,onEnterVin,onPickModel,business,onBusiness,onLook}:Props){
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
     <Text style={s.name} numberOfLines={2}>{vehicle?vehicle.name:t('Your garage')}</Text>
    </View>
    {busy&&!refreshing?<ActivityIndicator color={c.muted} style={{marginTop:12}}/>:null}
    <RoundButton icon="swap-horizontal" label={t('Switch or add vehicle')} onPress={onSwitch}/>
   </View>
   {vehicle?<Animated.View style={[s.car,carStyle]}>
    {/* Tapping the car's own picture opens its colour and view picker. */}
    <PressableScale accessibilityRole="button" accessibilityLabel={t('Change colour and view')} disabled={vinModel?.status!=='READY'} scale={0.98} onPress={onLook}>
     <CarImage vinModel={vinModel} width={carWidth}/>
    </PressableScale>
   </Animated.View>:<View style={{height:24}}/>}
   <Text style={s.line} numberOfLines={1}>{vehicle?(carLine(vehicle)||carInfo.maker||vehicle.name||''):t('Add your first vehicle to begin')}</Text>
   {vehicle?<CarReadings odometerKm={carInfo.odometerKm??vehicle.odometerKm??null} fuelPct={carInfo.fuelPct??null} avgUse={fuel?.litresPer100Km??null} at={carInfo.readingsAt??null} vin={carInfo.vin??null}/>:null}
   {vehicle&&vinModel?.needsYear&&vinModel.years?.length?<PressableScale accessibilityRole="button" onPress={onSetYear} style={{alignSelf:'flex-start',minHeight:40,justifyContent:'center'}}>
    <Chip icon="calendar-outline" tone="blue" label={t('Set the model year to show your {model}',{model:vinModel.model})}/>
   </PressableScale>:null}
   {vehicle&&carInfo.hasVin&&!vinModel?.model?<PressableScale accessibilityRole="button" onPress={onPickModel} style={{alignSelf:'flex-start',minHeight:40,justifyContent:'center'}}>
    <Chip icon="car-sport-outline" tone="blue" label={t('Choose your model to show your car')}/>
   </PressableScale>:null}
   {vehicle&&carInfo.read&&!carInfo.hasVin?<PressableScale accessibilityRole="button" onPress={onEnterVin} style={{alignSelf:'flex-start',minHeight:40,justifyContent:'center'}}>
    <Chip icon="create-outline" tone="blue" label={t('Enter the VIN to show your car')}/>
   </PressableScale>:null}
   {vehicle?<PressableScale accessibilityRole="button" accessibilityLabel={t('Recorder: {state}. Open Drive',{state:recorder.label})} onPress={()=>onGo('Record')} style={{alignSelf:'flex-start',minHeight:44,justifyContent:'center'}}>
    <Chip dot={recorder.live?c.green:recorder.recording?c.blue:c.muted} label={recorder.label}/>
   </PressableScale>:null}
   {vehicle?<View style={s.actions}>
    <QuickAction light icon={recorder.live?'radio':'play'} label={t('Drive')} accent={recorder.live} onPress={()=>onGo('Record')}/>
    <QuickAction light icon="document-text" label={t('Report')} onPress={onOpenCar}/>
    <QuickAction light icon="map" label={t('Trips')} onPress={()=>onGo('Trips')}/>
    <QuickAction light icon="construct" label={t('Service')} onPress={()=>onGo('Service')}/>
   </View>:null}
  </View>

  <View style={s.sheet}>
   {offline?<Notice icon="cloud-offline-outline" tone="warn">{offline} Showing what was saved on this phone.</Notice>:null}
   <Updater/>
   {business?<ListRow icon="briefcase" title={t('Business dashboard')} caption={tp(business,'{n} business car','{n} business cars')+' · '+t('live locations, kilometres')} onPress={onBusiness}/>:null}
   {!vehicle?<View style={ui.card}>
    <Text style={ui.title}>{t('No vehicle yet')}</Text>
    <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>{t('Add your car to start recording trips, fuel and health.')}</Text>
    <Button title={t('Add a vehicle')} icon="add" onPress={onSwitch}/>
   </View>:<>
    <Section title={t('Status')}/>
    <View style={s.tiles}>
     <Tile style={{flex:1}} icon="trending-up" label={t('This week')} value={car?.trips?fmt(weekKm,0):'—'} unit={t('km')} caption={fuel?.tripCount?tp(fuel.tripCount,'{km} km in {n} trip','{km} km in {n} trips',{km:fmt(fuel.distanceKm,0)}):t('No trips yet')} onPress={()=>onGo('Trips')}>
      <WeekBars values={week} height={52}/>
     </Tile>
     <View style={{flex:1,gap:12}}>
      <Tile icon="water" label={t('Fuel')} value={fuel?.litresPer100Km!=null?fmt(fuel.litresPer100Km):fmt(fuel?.fuelLitres)} unit={fuel?.litresPer100Km!=null?t('L/100'):t('L')} caption={fuel?.litresPer100Km!=null?t('Average use'):t('Used on trips')} onPress={()=>onGo('Trips')}/>
      <Tile icon="pulse" tone={car?.findings?findingCount?'amber':'green':'blue'} label={t('Health')} value={!car?.findings?'—':findingCount?String(findingCount):t('All clear')} unit={findingCount?t('to review'):undefined} caption={findingCount?t('Evidence-backed'):t('No findings')} onPress={()=>onGo('Health')}/>
     </View>
    </View>

    <Section title={t('Last trip')} action={lastTrip?t('All trips'):undefined} onAction={()=>onGo('Trips')}/>
    {lastTrip?<PressableScale accessibilityRole="button" accessibilityLabel={t('Last trip, {day}, {distance}',{day:weekday(lastTrip.startAt),distance:distance(lastTrip.metrics?.distanceKm)})} onPress={()=>onOpenTrip(lastTrip)} style={[ui.card,s.trip]}>
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
     <View style={{flex:1}}><Text style={ui.title}>{t('No trips yet')}</Text><Text style={[ui.caption,{marginTop:2,marginBottom:10}]}>{t('Start a drive and it appears here with its route.')}</Text>
      <Button title={t('Start a drive')} icon="play" onPress={()=>onGo('Record')} style={{alignSelf:'flex-start',minHeight:44,paddingHorizontal:16,marginVertical:0}}/></View>
    </View>}

    <Section title={t('Driving')}/>
    <View style={ui.card}>
     <View style={[ui.row,{justifyContent:'space-between',alignItems:'flex-end'}]}>
      <View><Text style={type.overline}>{t('Smooth drives · 30 days')}</Text><Text style={[type.metric,{marginTop:10}]}>{smooth.drives?`${Math.round(smooth.smooth/smooth.drives*100)}`:'—'}<Text style={type.unit}>{smooth.drives?' %':''}</Text></Text></View>
      {smooth.events?<Chip tone="amber" label={tp(smooth.events,'{n} hard event','{n} hard events')}/>:null}
     </View>
     <View style={s.meter}><View style={[s.meterFill,{width:`${smooth.drives?Math.max(2,smooth.smooth/smooth.drives*100):0}%`}]}/></View>
     <Text style={ui.body}>{smooth.drives?tp(smooth.drives,'{s} of {n} drive had no hard braking or acceleration.','{s} of {n} drives had no hard braking or acceleration.',{s:smooth.smooth}):t('No drives in the last 30 days yet.')}</Text>
    </View>

    <Section title={t('Reminders')}/>
    <ListRow icon={carInfo.mil?'warning':kindIcon(carInfo.kind)} tone={carInfo.mil?'amber':'blue'} title={carInfo.kind?t('{type} car',{type:carInfo.label}):t('Car report')} onPress={onOpenCar}
     caption={!carInfo.read?t('Type, codes and battery: read on your next drive'):carInfo.mil?tp(carInfo.codes,'Check engine light on · {n} code','Check engine light on · {n} codes'):carInfo.codes?tp(carInfo.codes,'{n} stored fault code','{n} stored fault codes'):t('Check engine off · no fault codes')}/>
    <ListRow icon="construct" tone="green" title={t('Service')} onPress={()=>onGo('Service')} caption={lastService?`${lastService.description} · ${ago(lastService.observedAt)}`:t('No maintenance records yet')}/>
    {findingCount?<ListRow icon="pulse" tone="amber" title={tp(findingCount,'{n} health finding','{n} health findings')} caption={t('Open Health for the evidence and next step')} onPress={()=>onGo('Health')}/>:null}
   </>}
  </View>
 </Animated.ScrollView>;
});

/**
 * One quiet line under the car: mileage, fuel (the average use when the car does not report a fuel level, as many
 * Toyota hybrids do not) and the VIN's last digits, which a tap copies whole.
 */
function CarReadings({odometerKm,fuelPct,avgUse,vin}:{odometerKm:number|null;fuelPct:number|null;avgUse:number|null;at?:number|null;vin:string|null}){
 const [copied,setCopied]=useState(false);
 const copy=async()=>{if(!vin)return;await Clipboard.setStringAsync(vin);haptic.snap();setCopied(true);setTimeout(()=>setCopied(false),1800);};
 const parts=[
  odometerKm!=null?Math.round(odometerKm).toLocaleString(locale())+' '+t('km'):null,
  fuelPct!=null?t('Fuel')+' '+Math.round(fuelPct)+'%':avgUse!=null?fmt(avgUse)+' '+t('L/100'):null,
 ].filter(Boolean) as string[];
 if(!parts.length&&!vin)return null;
 return <View style={s.readings}>
  {parts.map((p,i)=><Text key={i} style={s.reading}>{i?'·  ':''}{p}</Text>)}
  {vin?<PressableScale accessibilityRole="button" accessibilityLabel={t('Copy VIN')} onPress={()=>{void copy();}} hitSlop={10} style={s.vin}>
   <Text style={s.reading}>{parts.length?'·  ':''}{copied?t('Copied'):'VIN …'+vin.slice(-6)}</Text>
   <Icon name={copied?'checkmark':'copy-outline'} size={12} color={copied?c.green:c.faint}/>
  </PressableScale>:null}
 </View>;
}

const s=StyleSheet.create({
 readings:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',columnGap:8,marginTop:3},
 reading:{fontFamily:F[500],fontSize:12.5,color:c.muted,fontVariant:['tabular-nums']},
 vin:{flexDirection:'row',alignItems:'center',gap:4},
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
