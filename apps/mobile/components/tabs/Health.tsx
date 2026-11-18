import {memo} from 'react';
import {ActivityIndicator,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,ui} from '../theme';
import {Empty,Icon,ScreenHeader,Segment} from '../kit';
import {ago,day,fmt,pretty} from '../format';
import {Loading} from './Trips';

type Props={vehicle:any;findings:any[]|null;service:any[]|null;view:'Health'|'Service';refreshing:boolean;busy:boolean;offline:string;padBottom:number;onView:(v:string)=>void;onRefresh:()=>void};

/** Evidence-backed findings and the service history, one segment each. */
export const HealthTab=memo(function HealthTab({vehicle,findings,service,view,refreshing,busy,offline,padBottom,onView,onRefresh}:Props){
 const insets=useSafeAreaInsets(),list=view==='Health'?findings:service;
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}>
  <ScreenHeader title="Health" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>
  <Segment items={[['Health','Findings'],['Service','Service']]} value={view} onChange={onView}/>
  {!list?<Loading text={busy?'Loading…':offline}/>:!list.length?<Empty icon={view==='Health'?'pulse-outline':'construct-outline'} title={view==='Health'?'No findings':'Nothing here yet'} text={view==='Health'?'No persistent change in the readings your car supports.':'Maintenance records you add appear here.'}/>:null}

  {view==='Health'&&(findings||[]).map(d=><View key={d.id} style={ui.card}>
   <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
    <View style={[s.circle,{backgroundColor:c.amber50}]}><Icon name="warning" size={18} color={c.amber}/></View>
    <View style={{flex:1}}><Text style={s.rowTitle}>{d.summary||d.description}</Text><Text style={[ui.caption,{marginTop:2,textTransform:'capitalize'}]}>{pretty(d.status)}{d.origin?` · ${pretty(d.origin)}`:''}</Text></View>
   </View>
   {d.evidence&&<View style={s.nextStep}><Text style={s.nextLabel}>Recommended next step</Text><Text style={[ui.body,{color:c.ink2}]}>{d.evidence.recommendedNextStep}</Text></View>}
   {d.evidence&&<Text style={ui.caption}>Exact failed part and failure date unavailable.</Text>}
  </View>)}

  {view==='Service'&&(service||[]).map((d,i,all)=><View key={d.id} style={s.timeline}>
   <View style={{alignItems:'center'}}><View style={[s.circle,{backgroundColor:c.green50,width:36,height:36}]}><Icon name="checkmark" size={17} color={c.green}/></View>{i<all.length-1?<View style={s.timeLine}/>:null}</View>
   <View style={[ui.card,{flex:1,marginBottom:12,padding:14}]}>
    <Text style={s.rowTitle}>{d.description||d.summary}</Text>
    <Text style={[ui.caption,{marginTop:2}]}>{d.observedAt?`${day(d.observedAt)} · ${ago(d.observedAt)}`:''}{d.actualCost!=null?` · ${d.currency||''} ${fmt(d.actualCost,2)}`:''}</Text>
   </View>
  </View>)}
 </ScrollView>;
});

const s=StyleSheet.create({
 circle:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 nextStep:{backgroundColor:c.amber50,borderRadius:14,padding:12,marginTop:14,marginBottom:8},
 nextLabel:{fontSize:12.5,fontWeight:'700',color:c.amber,marginBottom:4},
 timeline:{flexDirection:'row',gap:12},
 timeLine:{width:2,flex:1,backgroundColor:c.track,marginVertical:4},
});
