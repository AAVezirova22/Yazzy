import {memo} from 'react';
import {ActivityIndicator,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius,type,ui} from '../theme';
import {Chip,Empty,Icon,IconTile,ScreenHeader,Segment} from '../kit';
import {ago,day,fmt,pretty} from '../format';
import {Loading} from './Trips';
import {t} from '../i18n';

type Props={vehicle:any;findings:any[]|null;service:any[]|null;view:'Health'|'Service';refreshing:boolean;busy:boolean;offline:string;padBottom:number;onView:(v:string)=>void;onRefresh:()=>void};

/** Evidence-backed findings and the service history, one segment each, as plain reminder cards. */
export const HealthTab=memo(function HealthTab({vehicle,findings,service,view,refreshing,busy,offline,padBottom,onView,onRefresh}:Props){
 const insets=useSafeAreaInsets(),list=view==='Health'?findings:service;
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}>
  <ScreenHeader title={t('Health')} subtitle={vehicle?vehicle.name:t('No vehicle selected')} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>
  <Segment items={[['Health',t('Findings')],['Service',t('Service')]]} value={view} onChange={onView}/>
  {view==='Health'&&findings&&!findings.length?<View style={[ui.card,s.clear]}>
   <IconTile icon="shield-checkmark" tone="green" size={48}/>
   <View style={{flex:1}}><Text style={ui.title}>{t('All clear')}</Text><Text style={[ui.body,{marginTop:2}]}>{t('No persistent change in the readings your car supports.')}</Text></View>
  </View>:null}
  {!list?<Loading text={busy?t('Loading…'):offline}/>:!list.length&&view==='Service'?<Empty icon="construct-outline" title={t('Nothing here yet')} text={t('Maintenance records you add appear here.')}/>:null}

  {view==='Health'&&(findings||[]).map(d=><View key={d.id} style={ui.card}>
   <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
    <IconTile icon="warning" tone="amber"/>
    <View style={{flex:1}}>
     <Text style={ui.title}>{d.summary||d.description}</Text>
     <View style={[ui.row,{gap:6,marginTop:6,flexWrap:'wrap'}]}>
      <Chip tone="amber" label={t(pretty(d.status)||'open')}/>
      {d.origin?<Chip label={t(pretty(d.origin))}/>:null}
     </View>
    </View>
   </View>
   {d.evidence&&<View style={s.next}><Text style={s.nextLabel}>{t('Recommended next step')}</Text><Text style={[ui.body,{color:c.ink2}]}>{d.evidence.recommendedNextStep}</Text></View>}
   {d.evidence&&<Text style={ui.caption}>{t('Exact failed part and failure date unavailable.')}</Text>}
  </View>)}

  {view==='Service'&&(service||[]).map((d,i,all)=><View key={d.id} style={s.timeline}>
   <View style={{alignItems:'center'}}><View style={s.node}><Icon name="checkmark" size={15} color={c.green}/></View>{i<all.length-1?<View style={s.rail}/>:null}</View>
   <View style={[ui.card,{flex:1,marginBottom:12,padding:14}]}>
    <Text style={type.overline}>{d.observedAt?`${day(d.observedAt)} · ${ago(d.observedAt)}`:t('Undated')}</Text>
    <Text style={[ui.title,{marginTop:4}]}>{d.description||d.summary}</Text>
    {d.actualCost!=null?<Text style={s.cost}>{d.currency||''} {fmt(d.actualCost,2)}</Text>:null}
   </View>
  </View>)}
 </ScrollView>;
});

const s=StyleSheet.create({
 clear:{flexDirection:'row',alignItems:'center',gap:14},
 next:{backgroundColor:c.amber50,borderRadius:radius.md,padding:12,marginTop:14,marginBottom:8},
 nextLabel:{fontFamily:F[700],fontSize:12.5,color:c.amber,marginBottom:4},
 timeline:{flexDirection:'row',gap:12},
 node:{width:30,height:30,borderRadius:radius.md,backgroundColor:c.green50,alignItems:'center',justifyContent:'center',marginTop:12},
 rail:{width:StyleSheet.hairlineWidth,flex:1,backgroundColor:c.track,marginVertical:4},
 cost:{fontFamily:F[700],fontSize:14,color:c.ink2,marginTop:6,fontVariant:['tabular-nums']},
});
