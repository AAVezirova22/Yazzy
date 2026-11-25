import {memo,useCallback,useMemo,useState} from 'react';
import {ActivityIndicator,Modal,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius,type,ui} from '../theme';
import {Button,Chip,Empty,Icon,IconTile,ScreenHeader,Section,Segment,useAction} from '../kit';
import {PressableScale} from '../motion';
import {ago,day,pretty} from '../format';
import {Loading} from './Trips';
import {ServiceDetail,ServiceForm,ServiceRow,type ServiceFields} from '../ServiceRecord';
import {currentKm,dueOf,dueText,openReminders} from '../service';
import type {VinModel} from '../vinCar';
import {t} from '../i18n';

type Props={vehicle:any;findings:any[]|null;service:any[]|null;workOrders:any[]|null;trips:any[]|null;obdKm:number|null;vinModel?:VinModel|null;view:'Health'|'Service';refreshing:boolean;busy:boolean;offline:string;padBottom:number;
 onView:(v:string)=>void;onRefresh:()=>void;onSaveService:(fields:ServiceFields,id?:string)=>Promise<void>;onDeleteService:(record:any)=>Promise<void>;onWorkOrder:(order:any,status:'COMPLETED'|'CANCELLED')=>Promise<void>};
const finished=(o:any)=>o.status==='COMPLETED'||o.status==='CANCELLED';

/** Evidence-backed findings, and the service history with what is planned and what is due next. */
export const HealthTab=memo(function HealthTab({vehicle,findings,service,workOrders,trips,obdKm,vinModel,view,refreshing,busy,offline,padBottom,onView,onRefresh,onSaveService,onDeleteService,onWorkOrder}:Props){
 const insets=useSafeAreaInsets(),list=view==='Health'?findings:service,[working,run]=useAction();
 const [form,setForm]=useState<{record?:any;draft?:string}|null>(null),[openId,setOpenId]=useState<string|null>(null);
 const km=useMemo(()=>currentKm([obdKm,vehicle?.odometerKm],service,trips),[obdKm,vehicle?.odometerKm,service,trips]);
 const reminders=useMemo(()=>openReminders(service),[service]);
 const dueFor=useMemo(()=>{const map=new Map<string,ReturnType<typeof dueOf>>();for(const r of reminders)map.set(r.id,dueOf(r,km?.km));return map;},[reminders,km]);
 // The most pressing reminder: the one with the least distance left (overdue first).
 const next=useMemo(()=>reminders.map(r=>({r,due:dueFor.get(r.id)!})).sort((a,b)=>(a.due.left??a.due.at)-(b.due.left??b.due.at))[0]||null,[reminders,dueFor]);
 const planned=useMemo(()=>(workOrders||[]).filter(o=>!finished(o)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[workOrders]);
 const opened=openId?(service||[]).find(r=>r.id===openId)||null:null;
 const open=useCallback((r:any)=>setOpenId(r.id),[]);
 const finish=(o:any,status:'COMPLETED'|'CANCELLED')=>run(async()=>{await onWorkOrder(o,status);if(status==='COMPLETED')setForm({draft:o.title});});
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} colors={[c.blue]} progressViewOffset={insets.top}/>}>
  <ScreenHeader title={t('Health')} subtitle={vehicle?vehicle.name:t('No vehicle selected')} right={busy&&!refreshing?<ActivityIndicator color={c.blue}/>:null}/>
  <Segment items={[['Health',t('Findings')],['Service',t('Service')]]} value={view} onChange={onView}/>
  {view==='Health'&&findings&&!findings.length?<View style={[ui.card,s.clear]}>
   <IconTile icon="shield-checkmark" tone="green" size={48}/>
   <View style={{flex:1}}><Text style={ui.title}>{t('All clear')}</Text><Text style={[ui.body,{marginTop:2}]}>{t('No persistent change in the readings your car supports.')}</Text></View>
  </View>:null}
  {!list?<Loading text={busy?t('Loading…'):offline}/>:null}

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

  {view==='Service'&&<>
   <Button title={t('Add service')} icon="add" onPress={()=>setForm({})} disabled={!vehicle} style={{marginTop:0,marginBottom:14}}/>

   {next?<PressableScale accessibilityRole="button" onPress={()=>open(next.r)} style={[ui.card,s.dueCard]}>
    <IconTile icon={next.due.tone==='red'?'alert-circle':'notifications'} tone={next.due.tone==='blue'?'blue':next.due.tone}/>
    <View style={{flex:1}}>
     <Text style={type.overline}>{t('Due next')}</Text>
     <Text style={[ui.title,{marginTop:3}]} numberOfLines={2}>{next.r.description}</Text>
     <View style={{marginTop:8}}><Chip tone={next.due.tone} label={dueText(next.due)}/></View>
    </View>
    <Icon name="chevron-forward" size={16} color={c.faint}/>
   </PressableScale>:null}

   {planned.length?<>
    <Section title={t('Planned')}/>
    {planned.map(o=><View key={o.id} style={ui.card}>
     <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
      <IconTile icon="clipboard-outline" tone="blue"/>
      <View style={{flex:1}}>
       <Text style={type.overline}>{o.createdAt?`${day(o.createdAt)} · ${ago(o.createdAt)}`:t('Task')}</Text>
       <Text style={[ui.title,{marginTop:3}]}>{o.title}</Text>
       <View style={[ui.row,{gap:6,marginTop:8,flexWrap:'wrap'}]}><Chip tone="blue" label={t(pretty(o.status))}/>{o.origin==='SIMULATED'?<Chip label={t('simulated')}/>:null}</View>
      </View>
     </View>
     <View style={[ui.row,{gap:10,marginTop:12}]}>
      <Button title={t('Cancel task')} kind="light" disabled={working} onPress={()=>finish(o,'CANCELLED')} style={{flex:1,marginVertical:0}}/>
      <Button title={t('Done')} icon="checkmark" disabled={working} onPress={()=>finish(o,'COMPLETED')} style={{flex:1,marginVertical:0}}/>
     </View>
    </View>)}
   </>:null}

   {service&&service.length?<Section title={t('History')}/>:null}
   {(service||[]).map(d=><ServiceRow key={d.id} record={d} due={dueFor.get(d.id)||null} onOpen={open}/>)}
   {service&&!service.length&&!planned.length?<Empty icon="construct-outline" title={t('No service recorded yet')} text={t('Add an oil change, a repair or any service: what was done, the date, the price and the kilometres. Yazzy reminds you when it is due again.')}/>:null}
  </>}

  <ServiceForm open={!!form} record={form?.record} draft={form?.draft} guessKm={km?.km??null} onClose={()=>setForm(null)} onSave={fields=>onSaveService(fields,form?.record?.id)}/>
  <Modal visible={!!opened} animationType="slide" onRequestClose={()=>setOpenId(null)}>
   {opened?<ServiceDetail record={opened} vehicleName={vehicle?.name} vinModel={vinModel} km={km} due={dueFor.get(opened.id)||null} onClose={()=>setOpenId(null)}
    onEdit={r=>{setOpenId(null);setForm({record:r});}} onDelete={onDeleteService}/>:null}
  </Modal>
 </ScrollView>;
});

const s=StyleSheet.create({
 clear:{flexDirection:'row',alignItems:'center',gap:14},
 next:{backgroundColor:c.amber50,borderRadius:radius.md,padding:12,marginTop:14,marginBottom:8},
 nextLabel:{fontFamily:F[700],fontSize:12.5,color:c.amber,marginBottom:4},
 dueCard:{flexDirection:'row',alignItems:'center',gap:14},
});
