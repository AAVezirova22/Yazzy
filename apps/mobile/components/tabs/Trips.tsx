import {memo,useCallback,useMemo,useState} from 'react';
import {ActivityIndicator,FlatList,Platform,Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius,type,ui} from '../theme';
import {Chip,Empty,Icon,ScreenHeader} from '../kit';
import {haptic} from '../motion';
import {PressableScale} from '../motion';
import {RouteArt} from '../art';
import {distance,minutes} from '../TripDetail';
import {clock,fmt,routeOf,weekday} from '../format';
import {t,tp} from '../i18n';

type Props={vehicle:any;trips:any[]|null;refreshing:boolean;busy:boolean;offline:string;padBottom:number;onRefresh:()=>void;onOpenTrip:(t:any)=>void;onRebuild:()=>void};

/** Every recorded drive, newest first, under a one-line summary of the chosen period. Virtualised: only nearby rows are drawn. */
export const TripsTab=memo(function TripsTab({vehicle,trips,refreshing,busy,offline,padBottom,onRefresh,onOpenTrip,onRebuild}:Props){
 const insets=useSafeAreaInsets(),[period,setPeriod]=useState<Period>('all'),[order,setOrder]=useState<Order>('date');
 const shown=useMemo(()=>filterTrips(trips,period,order),[trips,period,order]),filtered=period!=='all'||order!=='date';
 const row=useCallback(({item}:{item:any})=><TripRow trip={item} onOpen={onOpenTrip}/>,[onOpenTrip]);
 // The summary follows the period filter: all time, today, the last 7 or the last 30 days. Stops (engine on, no driving) are not drives.
 const stats=useMemo(()=>{
  const from=periodStart(period),drives=(trips||[]).filter(d=>(d.startAt??0)>=from&&d.status!=='STATIONARY'&&d.metrics);
  const km=drives.reduce((a,d)=>a+(d.metrics.distanceKm||0),0),seconds=drives.reduce((a,d)=>a+(d.metrics.durationSeconds||0),0);
  const smooth=drives.filter(d=>!(d.metrics.drivingEvents||[]).length).length;
  return {km,count:drives.length,seconds,smooth};
 },[trips,period]);
 return <FlatList data={shown} keyExtractor={t=>t.id} renderItem={row}
  initialNumToRender={7} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={Platform.OS==='android'}
  contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}
  ListHeaderComponent={<>
   <ScreenHeader title={t('Trips')} subtitle={vehicle?vehicle.name:t('No vehicle selected')} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>
   {trips?.length?<View style={[ui.card,s.summary]}>
    <Summary label={t(PERIOD_LABEL[period])} value={fmt(stats.km,0)} unit={t('km')}/>
    <View style={s.divider}/>
    <Summary label={t('Drives')} value={String(stats.count)}/>
    <View style={s.divider}/>
    <Summary label={t('Driving')} value={minutes(stats.seconds)}/>
    <View style={s.divider}/>
    <Summary label={t('Smooth')} value={stats.count?`${stats.smooth}/${stats.count}`:'—'}/>
   </View>:null}
   {trips?.length?<View style={s.filters}>
    <Choices items={PERIODS} value={period} onChange={setPeriod}/>
    <Choices items={ORDERS} value={order} onChange={setOrder}/>
    {filtered?<View style={[ui.row,{justifyContent:'space-between'}]}>
     <Text style={ui.caption}>{tp(shown.length,'{n} trip','{n} trips')}</Text>
     <Pressable accessibilityRole="button" hitSlop={8} onPress={()=>{setPeriod('all');setOrder('date');}}><Text style={s.reset}>{t('Clear filters')}</Text></Pressable>
    </View>:null}
   </View>:null}
  </>}
  ListFooterComponent={trips?<Pressable accessibilityRole="button" onPress={onRebuild} style={({pressed})=>[s.rebuild,pressed&&{opacity:0.6}]}><Icon name="construct-outline" size={15} color={c.blue}/><Text style={s.rebuildText}>{t('Missing a drive? Rebuild trips from recordings')}</Text></Pressable>:null}
  ListEmptyComponent={trips?.length&&filtered?<Empty icon="funnel-outline" title={t('No trips match')} text={t('Try another period.')}/>:trips?<Empty icon="map-outline" title={t('Nothing here yet')} text={t('Recorded drives appear here with their route.')}/>:<Loading text={busy?t('Loading…'):offline}/>}/>;
});

type Period='all'|'today'|'7'|'30';
type Order='date'|'longest'|'shortest';
const PERIODS:[Period,string][]=[['all','All'],['today','Today'],['7','7 days'],['30','30 days']];
const ORDERS:[Order,string][]=[['date','By date'],['longest','Longest'],['shortest','Shortest']];

const PERIOD_LABEL:Record<Period,string>={all:'All time',today:'Today','7':'Last 7 days','30':'Last 30 days'};

/** Start of a period as epoch seconds: midnight today, or 7 / 30 days back; 0 for all time. */
function periodStart(period:Period){
 const now=new Date();
 return period==='today'?new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()/1000
  :period==='7'?Date.now()/1000-7*86400:period==='30'?Date.now()/1000-30*86400:0;
}

/** The trips of a period, newest first or by distance. Sorted by distance, stops (engine on, no driving) are left out. */
function filterTrips(trips:any[]|null,period:Period,order:Order){
 const from=periodStart(period),inPeriod=(trips||[]).filter(d=>(d.startAt??0)>=from);
 if(order==='date')return [...inPeriod].sort((a,b)=>(b.startAt??0)-(a.startAt??0));
 const km=(d:any)=>d.metrics?.distanceKm??0;
 return inPeriod.filter(d=>d.status!=='STATIONARY').sort((a,b)=>order==='longest'?km(b)-km(a):km(a)-km(b));
}

/** A row of filter chips, scrolling sideways on narrow phones. */
function Choices<T extends string>({items,value,onChange}:{items:[T,string][];value:T;onChange:(v:T)=>void}){
 return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
  {items.map(([key,label])=>{const on=key===value;return <Pressable key={key} accessibilityRole="button" accessibilityState={{selected:on}}
   onPress={()=>{if(!on){haptic.step();onChange(key);}}} style={[s.choice,on&&s.choiceOn]}>
   <Text style={[s.choiceText,on&&{color:'#fff'}]}>{t(label)}</Text>
  </Pressable>;})}
 </ScrollView>;
}

function Summary({label,value,unit}:{label:string;value:string;unit?:string}){
 return <View style={{flex:1}}>
  <Text style={s.sumValue} numberOfLines={1} adjustsFontSizeToFit>{value}{unit?<Text style={s.sumUnit}> {unit}</Text>:null}</Text>
  <Text style={[type.caption,{fontSize:11.5}]} numberOfLines={1}>{label}</Text>
 </View>;
}

export function Loading({text}:{text:string}){return <View style={[ui.card,{alignItems:'center',paddingVertical:28}]}><Text style={[ui.caption,{textAlign:'center'}]}>{text||t('Loading…')}</Text></View>;}

/** One trip in the log. Memoised so polling or loading elsewhere never redraws every route thumbnail. */
const TripRow=memo(function TripRow({trip:d,onOpen}:{trip:any;onOpen:(t:any)=>void}){
 const open=d.metrics&&d.startAt!=null,route=routeOf(d),events:any[]=d.metrics?.drivingEvents||[],stationary=d.status==='STATIONARY';
 const braking=events.filter(e=>e.type==='HARD_BRAKING').length;
 return <PressableScale accessibilityRole="button" disabled={!open} onPress={()=>onOpen(d)} style={[ui.card,s.row]}>
  {route.length?<RouteArt route={route} style={s.thumb} stroke={2.5} grid={false}/>:<View style={[s.thumb,s.thumbEmpty]}><Icon name={stationary?'pause':'navigate'} size={20} color={c.blue}/></View>}
  <View style={{flex:1}}>
   <Text style={type.overline} numberOfLines={1}>{d.startAt!=null?`${weekday(d.startAt)} · ${clock(d.startAt)}`:d.summary||d.description}</Text>
   {d.metrics?<>
    <Text style={s.distance}>{stationary?t('Stationary'):distance(d.metrics.distanceKm)}</Text>
    <View style={[ui.row,{gap:12,marginTop:2,flexWrap:'wrap'}]}>
     <Text style={s.meta}>{minutes(d.metrics.durationSeconds||0)}</Text>
     {d.metrics.fuelLitres!=null?<Text style={s.meta}>{d.metrics.fuelMethod==='MAF_ESTIMATE_PETROL'?'≈ ':''}{fmt(d.metrics.fuelLitres,2)} L</Text>:null}
     {d.metrics.litresPer100Km!=null?<Text style={s.meta}>{fmt(d.metrics.litresPer100Km)} L/100</Text>:null}
    </View>
    {events.length?<View style={{marginTop:8}}><Chip tone={braking?'red':'amber'} label={tp(events.length,'{n} hard event','{n} hard events')}/></View>:null}
   </>:null}
  </View>
  {open?<Icon name="chevron-forward" size={16} color={c.faint}/>:null}
 </PressableScale>;
});

const s=StyleSheet.create({
 summary:{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:10},
 divider:{width:StyleSheet.hairlineWidth,alignSelf:'stretch',backgroundColor:c.line},
 sumValue:{fontFamily:F[600],fontSize:18,color:c.ink,letterSpacing:-0.4,fontVariant:['tabular-nums']},
 sumUnit:{fontFamily:F[600],fontSize:12,color:c.muted},
 row:{flexDirection:'row',alignItems:'center',gap:14,padding:12},
 thumb:{width:72,height:72,borderRadius:radius.md,backgroundColor:c.blue50},
 thumbEmpty:{alignItems:'center',justifyContent:'center'},
 distance:{fontFamily:F[600],fontSize:20,color:c.ink,letterSpacing:-0.5,marginTop:4,fontVariant:['tabular-nums']},
 meta:{fontFamily:F[600],fontSize:13,color:c.muted,fontVariant:['tabular-nums']},
 filters:{gap:10,marginBottom:12},
 choice:{borderWidth:1,borderColor:c.line,backgroundColor:c.surface,borderRadius:radius.pill,paddingVertical:7,paddingHorizontal:14,minHeight:36,justifyContent:'center'},
 choiceOn:{backgroundColor:c.blue,borderColor:c.blue},
 choiceText:{fontFamily:F[600],fontSize:13,color:c.ink2},
 reset:{fontFamily:F[700],fontSize:13,color:c.blue},
 rebuild:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:14,paddingHorizontal:8},
 rebuildText:{fontFamily:F[700],fontSize:13.5,color:c.blue,flexShrink:1,textAlign:'center'},
});
