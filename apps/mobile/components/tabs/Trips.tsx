import {memo,useCallback,useMemo} from 'react';
import {ActivityIndicator,FlatList,Platform,Pressable,RefreshControl,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius,type,ui} from '../theme';
import {Chip,Empty,Icon,ScreenHeader} from '../kit';
import {PressableScale} from '../motion';
import {RouteArt} from '../art';
import {distance,minutes} from '../TripDetail';
import {clock,fmt,lastWeek,routeOf,smoothDriving,weekday} from '../format';

type Props={vehicle:any;trips:any[]|null;refreshing:boolean;busy:boolean;offline:string;padBottom:number;onRefresh:()=>void;onOpenTrip:(t:any)=>void;onRebuild:()=>void};

/** Every recorded drive, newest first, under a one-line summary of the week. Virtualised: only nearby rows are drawn. */
export const TripsTab=memo(function TripsTab({vehicle,trips,refreshing,busy,offline,padBottom,onRefresh,onOpenTrip,onRebuild}:Props){
 const insets=useSafeAreaInsets();
 const row=useCallback(({item}:{item:any})=><TripRow trip={item} onOpen={onOpenTrip}/>,[onOpenTrip]);
 const week=useMemo(()=>{
  const km=lastWeek(trips).reduce((a,b)=>a+b,0),since=Date.now()/1000-7*86400;
  const drives=(trips||[]).filter(t=>t.startAt>=since&&t.status!=='STATIONARY');
  const seconds=drives.reduce((a,t)=>a+(t.metrics?.durationSeconds||0),0);
  return {km,count:drives.length,seconds,smooth:smoothDriving(trips,7)};
 },[trips]);
 return <FlatList data={trips||[]} keyExtractor={t=>t.id} renderItem={row}
  initialNumToRender={7} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={Platform.OS==='android'}
  contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}
  ListHeaderComponent={<>
   <ScreenHeader title="Trips" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>
   {trips?.length?<View style={[ui.card,s.summary]}>
    <Summary label="Last 7 days" value={fmt(week.km,0)} unit="km"/>
    <View style={s.divider}/>
    <Summary label="Drives" value={String(week.count)}/>
    <View style={s.divider}/>
    <Summary label="Driving" value={minutes(week.seconds)}/>
    <View style={s.divider}/>
    <Summary label="Smooth" value={week.smooth.drives?`${week.smooth.smooth}/${week.smooth.drives}`:'—'}/>
   </View>:null}
  </>}
  ListFooterComponent={trips?<Pressable accessibilityRole="button" onPress={onRebuild} style={({pressed})=>[s.rebuild,pressed&&{opacity:0.6}]}><Icon name="construct-outline" size={15} color={c.blue}/><Text style={s.rebuildText}>Missing a drive? Rebuild trips from recordings</Text></Pressable>:null}
  ListEmptyComponent={trips?<Empty icon="map-outline" title="Nothing here yet" text="Recorded drives appear here with their route."/>:<Loading text={busy?'Loading…':offline}/>}/>;
});

function Summary({label,value,unit}:{label:string;value:string;unit?:string}){
 return <View style={{flex:1}}>
  <Text style={s.sumValue} numberOfLines={1} adjustsFontSizeToFit>{value}{unit?<Text style={s.sumUnit}> {unit}</Text>:null}</Text>
  <Text style={[type.caption,{fontSize:11.5}]} numberOfLines={1}>{label}</Text>
 </View>;
}

export function Loading({text}:{text:string}){return <View style={[ui.card,{alignItems:'center',paddingVertical:28}]}><Text style={[ui.caption,{textAlign:'center'}]}>{text||'Loading…'}</Text></View>;}

/** One trip in the log. Memoised so polling or loading elsewhere never redraws every route thumbnail. */
const TripRow=memo(function TripRow({trip:d,onOpen}:{trip:any;onOpen:(t:any)=>void}){
 const open=d.metrics&&d.startAt!=null,route=routeOf(d),events:any[]=d.metrics?.drivingEvents||[],stationary=d.status==='STATIONARY';
 const braking=events.filter(e=>e.type==='HARD_BRAKING').length;
 return <PressableScale accessibilityRole="button" disabled={!open} onPress={()=>onOpen(d)} style={[ui.card,s.row]}>
  {route.length?<RouteArt route={route} style={s.thumb} stroke={2.5} grid={false}/>:<View style={[s.thumb,s.thumbEmpty]}><Icon name={stationary?'pause':'navigate'} size={20} color={c.blue}/></View>}
  <View style={{flex:1}}>
   <Text style={type.overline} numberOfLines={1}>{d.startAt!=null?`${weekday(d.startAt)} · ${clock(d.startAt)}`:d.summary||d.description}</Text>
   {d.metrics?<>
    <Text style={s.distance}>{stationary?'Stationary':distance(d.metrics.distanceKm)}</Text>
    <View style={[ui.row,{gap:12,marginTop:2,flexWrap:'wrap'}]}>
     <Text style={s.meta}>{minutes(d.metrics.durationSeconds||0)}</Text>
     {d.metrics.fuelLitres!=null?<Text style={s.meta}>{d.metrics.fuelMethod==='MAF_ESTIMATE_PETROL'?'≈ ':''}{fmt(d.metrics.fuelLitres,2)} L</Text>:null}
     {d.metrics.litresPer100Km!=null?<Text style={s.meta}>{fmt(d.metrics.litresPer100Km)} L/100</Text>:null}
    </View>
    {events.length?<View style={{marginTop:8}}><Chip tone={braking?'red':'amber'} label={`${events.length} hard ${events.length===1?'event':'events'}`}/></View>:null}
   </>:null}
  </View>
  {open?<Icon name="chevron-forward" size={16} color={c.faint}/>:null}
 </PressableScale>;
});

const s=StyleSheet.create({
 summary:{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:10},
 divider:{width:StyleSheet.hairlineWidth,alignSelf:'stretch',backgroundColor:c.line},
 sumValue:{fontFamily:F[800],fontSize:18,color:c.ink,letterSpacing:-0.4,fontVariant:['tabular-nums']},
 sumUnit:{fontFamily:F[600],fontSize:12,color:c.muted},
 row:{flexDirection:'row',alignItems:'center',gap:14,padding:12},
 thumb:{width:72,height:72,borderRadius:radius.md,backgroundColor:c.blue50},
 thumbEmpty:{alignItems:'center',justifyContent:'center'},
 distance:{fontFamily:F[800],fontSize:20,color:c.ink,letterSpacing:-0.5,marginTop:4,fontVariant:['tabular-nums']},
 meta:{fontFamily:F[600],fontSize:13,color:c.muted,fontVariant:['tabular-nums']},
 rebuild:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:14},
 rebuildText:{fontFamily:F[700],fontSize:13.5,color:c.blue},
});
