import {memo,useCallback} from 'react';
import {ActivityIndicator,FlatList,Platform,Pressable,RefreshControl,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,ui} from '../theme';
import {Empty,Icon,ScreenHeader} from '../kit';
import {RouteArt} from '../art';
import {distance,minutes} from '../TripDetail';
import {clock,fmt,routeOf,weekday} from '../format';

type Props={vehicle:any;trips:any[]|null;refreshing:boolean;busy:boolean;offline:string;padBottom:number;onRefresh:()=>void;onOpenTrip:(t:any)=>void;onRebuild:()=>void};

/** Every recorded drive, newest first as the server sends them. Virtualised: only rows near the screen are drawn. */
export const TripsTab=memo(function TripsTab({vehicle,trips,refreshing,busy,offline,padBottom,onRefresh,onOpenTrip,onRebuild}:Props){
 const insets=useSafeAreaInsets();
 const row=useCallback(({item}:{item:any})=><TripRow trip={item} onOpen={onOpenTrip}/>,[onOpenTrip]);
 return <FlatList data={trips||[]} keyExtractor={t=>t.id} renderItem={row}
  initialNumToRender={7} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={Platform.OS==='android'}
  contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}
  ListHeaderComponent={<ScreenHeader title="Trips" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>}
  ListFooterComponent={trips?<Pressable accessibilityRole="button" onPress={onRebuild} style={({pressed})=>[s.rebuild,pressed&&{opacity:0.6}]}><Icon name="construct-outline" size={15} color={c.blue}/><Text style={s.rebuildText}>Missing a drive? Rebuild trips from recordings</Text></Pressable>:null}
  ListEmptyComponent={trips?<Empty icon="map-outline" title="Nothing here yet" text="Recorded drives appear here with their route."/>:<Loading text={busy?'Loading…':offline}/>}/>;
});

export function Loading({text}:{text:string}){return <View style={[ui.card,{alignItems:'center',paddingVertical:28}]}><Text style={[ui.caption,{textAlign:'center'}]}>{text||'Loading…'}</Text></View>;}

/** One trip in the list. Memoised so polling or loading elsewhere never redraws every route thumbnail. */
const TripRow=memo(function TripRow({trip:d,onOpen}:{trip:any;onOpen:(t:any)=>void}){
 const open=d.metrics&&d.startAt!=null,route=routeOf(d);
 return <Pressable accessibilityRole="button" disabled={!open} onPress={()=>onOpen(d)} style={({pressed})=>[ui.card,s.rowCard,pressed&&{opacity:0.9}]}>
  {route.length?<RouteArt route={route} style={s.listThumb} stroke={2.5} grid={false}/>:<View style={[s.listThumb,{alignItems:'center',justifyContent:'center'}]}><Icon name={d.status==='STATIONARY'?'pause':'navigate'} size={20} color={c.blue}/></View>}
  <View style={{flex:1}}>
   <Text style={s.rowTitle}>{d.startAt!=null?weekday(d.startAt):d.summary||d.description}</Text>
   <Text style={ui.caption}>{d.startAt!=null?clock(d.startAt):''}{d.status==='STATIONARY'?' · stationary':''}</Text>
   {d.metrics?<View style={[ui.row,{gap:14,marginTop:8}]}>
    <Text style={s.metric}>{distance(d.metrics.distanceKm)}</Text>
    <Text style={s.metricMuted}>{minutes(d.metrics.durationSeconds||0)}</Text>
    {d.metrics.fuelLitres!=null?<Text style={s.metricMuted}>{d.metrics.fuelMethod==='MAF_ESTIMATE_PETROL'?'≈ ':''}{fmt(d.metrics.fuelLitres,2)} L</Text>:null}
   </View>:null}
  </View>
  {open?<Icon name="chevron-forward" size={16} color={c.ink}/>:null}
 </Pressable>;
});

const s=StyleSheet.create({
 rowCard:{flexDirection:'row',alignItems:'center',gap:12,padding:12},
 rebuild:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:14},
 rebuildText:{fontSize:13.5,fontWeight:'700',color:c.blue},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 listThumb:{width:68,height:68,borderRadius:16,backgroundColor:c.blue50},
 metric:{fontSize:14,fontWeight:'700',color:c.ink,fontVariant:['tabular-nums']},
 metricMuted:{fontSize:14,fontWeight:'500',color:c.muted,fontVariant:['tabular-nums']},
});
