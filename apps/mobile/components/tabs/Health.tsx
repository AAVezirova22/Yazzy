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
import {localizeService} from '../serviceTerms';
import type {VinModel} from '../vinCar';
import {battery12,describeCode,MONITOR,since,type CarProfile} from '../car';
import {CodeReplies} from '../CodeReplies';
import {t,tp} from '../i18n';

type Props={vehicle:any;report:CarProfile|null;onOpenCar:()=>void;findings:any[]|null;service:any[]|null;workOrders:any[]|null;trips:any[]|null;obdKm:number|null;vinModel?:VinModel|null;view:'Health'|'Service';refreshing:boolean;busy:boolean;offline:string;padBottom:number;
 onView:(v:string)=>void;onRefresh:()=>void;onSaveService:(fields:ServiceFields,id?:string)=>Promise<void>;onDeleteService:(record:any)=>Promise<void>;onWorkOrder:(order:any,status:'COMPLETED'|'CANCELLED')=>Promise<void>};
const finished=(o:any)=>o.status==='COMPLETED'||o.status==='CANCELLED';

/**
 * What the car itself says about its check engine light and fault codes, from the last car report.
 * "fault": the light is on or codes are stored; "pending": only unconfirmed codes; "ok": read, light off, no codes;
 * "unknown": the car has not been read yet, which is not the same as healthy.
 */
export function engineStatus(p:CarProfile|null){
 const stored=p?.stored||[],pending=(p?.pending||[]).filter(x=>!stored.includes(x)),permanent=(p?.permanent||[]).filter(x=>!stored.includes(x));
 const read=!!p&&(p.mil!=null||p.stored!=null),listed=stored.length+pending.length+permanent.length,count=Math.max(p?.dtcCount||0,listed);
 const state:'fault'|'pending'|'ok'|'unknown'=!read?'unknown':p?.mil||stored.length||permanent.length||(p?.dtcCount||0)>0?'fault':pending.length?'pending':'ok';
 return {state,stored,pending,permanent,listed,count,light:p?.mil===true,readAt:p?.readAt};
}

function CodeRow({code,kind}:{code:string;kind:string}){
 return <View style={s.code}>
  <View style={s.codeTag}><Text style={s.codeText}>{code}</Text></View>
  <View style={{flex:1}}><Text style={s.codeTitle}>{describeCode(code)}</Text><Text style={ui.caption}>{t(kind)}</Text></View>
 </View>;
}

/** Evidence-backed findings, and the service history with what is planned and what is due next. */
export const HealthTab=memo(function HealthTab({vehicle,report,onOpenCar,findings,service,workOrders,trips,obdKm,vinModel,view,refreshing,busy,offline,padBottom,onView,onRefresh,onSaveService,onDeleteService,onWorkOrder}:Props){
 const insets=useSafeAreaInsets(),list=view==='Health'?findings:service,[working,run]=useAction();
 const [form,setForm]=useState<{record?:any;draft?:string}|null>(null),[openId,setOpenId]=useState<string|null>(null);
 const engine=useMemo(()=>engineStatus(report),[report]);
 // What else the car reports that deserves a look: a weak 12 V battery, and emission self-tests that have not run (normal after a battery change).
 const alerts=useMemo(()=>{
  const out:{key:string;icon:string;tone:'amber'|'red'|'blue';title:string;text:string}[]=[],volts=report?.signals?.ADAPTER_VOLTAGE??report?.batteryVoltage,v12=battery12(volts);
  if(v12&&v12.tone!=='ok')out.push({key:'battery',icon:'battery-dead-outline',tone:v12.tone==='error'?'red':'amber',title:t('12 V battery')+` · ${volts!=null?volts.toFixed(1):''} V`,text:v12.text});
  const waiting=(report?.readiness||[]).filter(m=>!m.complete);
  if(waiting.length)out.push({key:'readiness',icon:'hourglass-outline',tone:'blue',title:tp(waiting.length,'{n} emissions self-test not ready','{n} emissions self-tests not ready'),text:waiting.map(m=>MONITOR[m.id]?t(MONITOR[m.id]):m.id).join(', ')+'. '+t('Normal after a battery change or after codes were cleared; an inspection may need them ready.')});
  return out;
 },[report]);
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
  {view==='Health'?<>
   {engine.state==='fault'||engine.state==='pending'?<View style={ui.card}>
    <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
     <IconTile icon="warning" tone="amber" size={48}/>
     <View style={{flex:1}}>
      <Text style={type.overline}>{t('Check engine')}</Text>
      <Text style={[ui.title,{marginTop:3}]}>{engine.state==='pending'?t('Pending fault codes'):engine.light?t('Check engine light is on'):t('The car has stored fault codes')}</Text>
      <View style={[ui.row,{gap:6,marginTop:8,flexWrap:'wrap'}]}>
       <Chip tone="amber" label={tp(engine.count,'{n} fault code','{n} fault codes')}/>
       {engine.readAt?<Chip label={t('Read {when}',{when:since(engine.readAt)})}/>:null}
      </View>
     </View>
    </View>
    <View style={{marginTop:6}}>
     {engine.stored.map(code=><CodeRow key={code} code={code} kind="Stored"/>)}
     {engine.pending.map(code=><CodeRow key={'n'+code} code={code} kind="Pending"/>)}
     {engine.permanent.map(code=><CodeRow key={'p'+code} code={code} kind="Permanent"/>)}
    </View>
    {!engine.listed?<Text style={[ui.body,{marginTop:8}]}>{t('The car reports the light on, but its codes could not be listed. Open the car report to read them again.')}</Text>:null}
    {report?.distanceWithMilKm?<Text style={[ui.caption,{marginTop:8}]}>{t('Driven with the light on')}: {t('{n} km',{n:report.distanceWithMilKm})}</Text>:null}
    <CodeReplies replies={report?.codeReplies}/>
    <View style={s.next}><Text style={[ui.body,{color:c.ink2}]}>{engine.state==='pending'?t('Not confirmed yet: the car saw this once. Watch whether the light comes on.'):t('Yazzy only reads your car; it cannot say which part failed. Have the codes checked at a workshop.')}</Text></View>
    <Button title={t('Open car report')} icon="document-text-outline" kind="light" onPress={onOpenCar} style={{marginBottom:0}}/>
   </View>:null}

   {engine.state==='unknown'?<View style={ui.card}>
    <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
     <IconTile icon="bluetooth" tone="blue" size={48}/>
     <View style={{flex:1}}>
      <Text style={ui.title}>{t('Car not read yet')}</Text>
      <Text style={[ui.body,{marginTop:2}]}>{t('Connect your OBD adapter and drive: Yazzy then reads the check engine light and the fault codes. Until then this page cannot tell whether the car is healthy.')}</Text>
     </View>
    </View>
    <Button title={t('Connect adapter')} icon="bluetooth" kind="light" onPress={()=>onView('Connect')} style={{marginTop:12,marginBottom:0}}/>
   </View>:null}

   {alerts.length?<View style={ui.card}>
    <Text style={[type.overline,{marginBottom:6}]}>{t('Also reported by the car')}</Text>
    {alerts.map((a,i)=><View key={a.key} style={[ui.row,{gap:12,alignItems:'flex-start',paddingVertical:10},i>0&&s.divider]}>
     <IconTile icon={a.icon} tone={a.tone} size={38}/>
     <View style={{flex:1}}><Text style={ui.title}>{a.title}</Text><Text style={[ui.body,{marginTop:2}]}>{a.text}</Text></View>
    </View>)}
   </View>:null}

   {findings&&!findings.length&&engine.state==='ok'?<View style={[ui.card,s.clear]}>
    <IconTile icon="shield-checkmark" tone="green" size={48}/>
    <View style={{flex:1}}>
     <Text style={ui.title}>{t('All clear')}</Text>
     <Text style={[ui.body,{marginTop:2}]}>{t('Check engine light off, no fault codes, and no persistent change in the readings your car supports.')}</Text>
     {engine.readAt?<Text style={[ui.caption,{marginTop:4}]}>{t('Read {when}',{when:since(engine.readAt)})}</Text>:null}
    </View>
   </View>:null}
  </>:null}
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

  {view==='Health'?<Text style={[ui.caption,{textAlign:'center',lineHeight:18,marginTop:4,paddingHorizontal:8}]}>{t('Yazzy reads the engine and emissions system (OBD-II). Warning lights of other systems, such as ABS, airbags or the gearbox, are not read.')}</Text>:null}

  {view==='Service'&&<>
   <Button title={t('Add service')} icon="add" onPress={()=>setForm({})} disabled={!vehicle} style={{marginTop:0,marginBottom:14}}/>

   {next?<PressableScale accessibilityRole="button" onPress={()=>open(next.r)} style={[ui.card,s.dueCard]}>
    <IconTile icon={next.due.tone==='red'?'alert-circle':'notifications'} tone={next.due.tone==='blue'?'blue':next.due.tone}/>
    <View style={{flex:1}}>
     <Text style={type.overline}>{t('Due next')}</Text>
     <Text style={[ui.title,{marginTop:3}]} numberOfLines={2}>{localizeService(next.r.description)}</Text>
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
       <Text style={[ui.title,{marginTop:3}]}>{localizeService(o.title)}</Text>
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
 divider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 code:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:9,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 codeTag:{backgroundColor:c.amber50,borderRadius:radius.sm,paddingVertical:5,paddingHorizontal:9},
 codeText:{fontFamily:F[700],fontSize:13,letterSpacing:0.6,color:c.amber,fontVariant:['tabular-nums']},
 codeTitle:{fontFamily:F[600],fontSize:14,color:c.ink},
});
