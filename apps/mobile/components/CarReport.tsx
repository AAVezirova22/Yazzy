import {useState,type ReactNode} from 'react';
import {Alert,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,floatShadow,mono,radius,ui} from './theme';
import {PressableScale} from './motion';
import {Button,Icon,Notice} from './kit';
import {LightSurface} from './LightSurface';
import {CarImage} from './CarImage';
import {exportCarPdf} from './carPdf';
import {CarLocation} from './CarMap';
import {battery12,boost,carSpot,describeCode,detect,KINDS,kindIcon,makerFromVin,MONITOR,OBD_STANDARD,PROTOCOL,READINGS,readingText,since,type CarProfile,type Kind} from './car';
import {carLine,fmt,latest} from './format';
import type {Car} from './tabs/types';
import {t,tp} from './i18n';

type Props={vehicle:any;report:CarProfile|null;live:boolean;car:Car|null;onClose:()=>void;onSetKind:(k:Kind|null)=>void;onPickYear:()=>void};
const DIESEL_MONITORS=['PM_FILTER','NOX_SCR','EGR','BOOST_PRESSURE','EXHAUST_SENSOR','NMHC_CATALYST'];

/** Everything the car reports about itself: type, hybrid or diesel specifics, fault codes, readiness and identity. */
export function CarReport({vehicle,report,live,car,onClose,onSetKind,onPickYear}:Props){
 const insets=useSafeAreaInsets(),[exporting,setExporting]=useState(false),[picking,setPicking]=useState(false);
 const p=report||{},type=detect(report),s=p.signals||{},kind=type.kind;
 const maker=makerFromVin(p.vin),codes=[...(p.stored||[])],pending=(p.pending||[]).filter(x=>!codes.includes(x)),permanent=p.permanent||[];
 const volts=s.ADAPTER_VOLTAGE??p.batteryVoltage,v12=battery12(volts),hv=s.HYBRID_BATTERY,b=boost(s);
 const shown=new Set(['HYBRID_BATTERY','ADAPTER_VOLTAGE','ODOMETER']),readings=READINGS.filter(r=>s[r[0]]!=null&&!shown.has(r[0]));
 const ready=p.readiness||[],notReady=ready.filter(m=>!m.complete).length,spot=carSpot(report,car?.trips);
 async function exportPdf(){
  setExporting(true);
  try{await exportCarPdf({vehicle,report,car});}catch(e){Alert.alert('Export failed',(e as Error).message);}
  finally{setExporting(false);}
 }
 return <View style={s_.page}>
  <StatusBar style="dark"/>
  <ScrollView contentContainerStyle={{paddingBottom:120+insets.bottom}}>
   <View style={[s_.hero,{paddingTop:insets.top+10}]}>
    <LightSurface/>
    <PressableScale accessibilityRole="button" accessibilityLabel={t('Back')} onPress={onClose} style={s_.back}>
     <Icon name="arrow-back" size={18} color={c.ink}/><Text style={s_.backText}>{t('Car report')}</Text>
    </PressableScale>
    <Text style={s_.name} numberOfLines={2}>{vehicle?.name||t('Your car')}</Text>
    <Text style={s_.sub} numberOfLines={1}>{vehicle?[carLine(vehicle),maker&&!vehicle.make?maker:null].filter(Boolean).join(' · '):''}</Text>
    <View style={[ui.row,{gap:8,marginTop:14,flexWrap:'wrap'}]}>
     <View style={s_.badge}><Icon name={kindIcon(kind)} size={14} color="#fff"/><Text style={s_.badgeText}>{type.label}</Text></View>
     <View style={[s_.badge,s_.plain]}><View style={[s_.dot,{backgroundColor:live?c.green:c.muted}]}/><Text style={[s_.badgeText,{color:c.ink}]}>{live?t('Live from the car'):p.readAt?t('Read {when}',{when:since(p.readAt)}):t('Not read yet')}</Text></View>
    </View>
    <Text style={s_.source}>{type.source}</Text>
    <View style={s_.car} pointerEvents="none"><CarImage vinModel={p.vinModel} width={220}/></View>
   </View>

   <View style={s_.body}>
    {/* No saved spot, no map. */}
    {spot?<CarLocation spot={spot} live={live&&spot.source==='recorder'}/>:null}
    {!report?.readAt?<Notice icon="bluetooth">{t('Turn the car on and start recording on the Drive tab. Within a minute the recorder reads the fuel type, VIN, fault codes and readiness, and this page fills in.')}{Platform.OS==='ios'?' '+t('Reading the car report needs the Android app for now; reports read there show here too.'):''}</Notice>:null}

    <Card title={t('Type')} right={<Pressable accessibilityRole="button" onPress={()=>setPicking(v=>!v)} hitSlop={8}><Text style={s_.link}>{picking?t('Done'):t('Not right?')}</Text></Pressable>}>
     <Row label={t('Detected as')} value={type.label}/>
     {p.vinModel?.vin===p.vin&&p.vinModel?.make?<Row label={t('Model')} value={[p.vinModel.make,p.vinModel.model,p.vinModel.year].filter(Boolean).join(' ')}/>:null}
     {p.vinModel?.vin===p.vin&&p.vinModel?.years?.length?<Pressable accessibilityRole="button" onPress={onPickYear} hitSlop={8} style={{paddingVertical:8}}><Text style={s_.link}>{p.vinModel.year?t('Change the model year'):t('Set the model year')}</Text></Pressable>:null}
     {p.fuelType!=null?<Row label={t('Fuel type reading')} value={t('Code {n}',{n:p.fuelType})}/>:null}
     {p.ignition?<Row label={t('Engine')} value={p.ignition==='COMPRESSION'?t('Compression ignition (diesel)'):t('Spark ignition (petrol or hybrid)')}/>:null}
     {picking?<View style={s_.chips}>
      {KINDS.map(([k,label,icon])=>{const on=p.userKind===k;return <Pressable key={k} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>onSetKind(k)} style={[s_.chip,on&&s_.chipOn]}><Icon name={icon} size={14} color={on?'#fff':c.blue}/><Text style={[s_.chipText,on&&{color:'#fff'}]}>{t(label)}</Text></Pressable>;})}
      {p.userKind?<Pressable accessibilityRole="button" onPress={()=>onSetKind(null)} style={s_.chip}><Icon name="refresh" size={14} color={c.blue}/><Text style={s_.chipText}>{t('Detect')}</Text></Pressable>:null}
     </View>:null}
    </Card>

    {kind==='HYBRID'||kind==='ELECTRIC'?<Card title={kind==='HYBRID'?t('Hybrid system'):t('Battery')}>
     {hv!=null?<>
      <View style={[ui.row,{justifyContent:'space-between',alignItems:'flex-end'}]}><Text style={s_.big}>{fmt(hv,0)}<Text style={ui.unit}> %</Text></Text><Text style={ui.caption}>{kind==='HYBRID'?t('Hybrid battery charge'):t('Battery charge')}</Text></View>
      <View style={s_.track}><View style={[s_.fill,{width:`${Math.max(2,Math.min(100,hv))}%`,backgroundColor:hv<20?c.amber:c.green}]}/></View>
     </>:<Text style={ui.body}>{report?.readAt?t("This car does not share its traction battery charge over standard OBD (PID 5B). Many hybrids keep it to the manufacturer's own diagnostics."):t('Shown after the first reading.')}</Text>}
     {kind==='HYBRID'&&s.ENGINE_RPM!=null?<Row label={t('Petrol engine')} value={s.ENGINE_RPM>0?t('Running · {rpm} rpm',{rpm:fmt(s.ENGINE_RPM,0)}):t('Off (electric or stopped)')}/>:null}
    </Card>:null}

    {kind==='DIESEL'?<Card title={t('Diesel system')}>
     {s.FUEL_RAIL_PRESSURE!=null?<Row label={t('Fuel rail pressure')} value={`${fmt(s.FUEL_RAIL_PRESSURE/1000,1)} MPa`}/>:null}
     {b!=null?<Row label={t('Turbo boost')} value={`${fmt(b/100,2)} bar`}/>:null}
     {ready.filter(m=>DIESEL_MONITORS.includes(m.id)).map(m=><Row key={m.id} label={t(MONITOR[m.id])} value={m.complete?t('Ready'):t('Not ready')} tone={m.complete?undefined:'warn'}/>)}
     {s.FUEL_RAIL_PRESSURE==null&&b==null&&!ready.some(m=>DIESEL_MONITORS.includes(m.id))?<Text style={ui.body}>{t('Shown after the first reading.')}</Text>:null}
    </Card>:null}

    <Card title={t('Batteries and power')}>
     <Row label={t('12 V battery')} value={volts!=null?`${fmt(volts,1)} V`:'—'} note={v12?.text} tone={v12?.tone}/>
     {s.MODULE_VOLTAGE!=null?<Row label={t('Control module voltage')} value={`${fmt(s.MODULE_VOLTAGE,1)} V`}/>:null}
    </Card>

    <Card title={t('Check engine')} right={<View style={[s_.lamp,{backgroundColor:p.mil?c.amber:p.mil===false?c.green:c.track}]}><Icon name={p.mil?'warning':'checkmark'} size={14} color="#fff"/></View>}>
     <Row label={t('Warning light')} value={p.mil==null?'—':p.mil?t('On'):t('Off')} tone={p.mil?'warn':undefined}/>
     {codes.length?codes.map(code=><Code key={code} code={code} kind="Stored"/>):p.stored?<Text style={[ui.body,{marginVertical:4}]}>{t('No fault codes stored.')}</Text>:null}
     {pending.map(code=><Code key={code} code={code} kind="Pending"/>)}
     {permanent.map(code=><Code key={'p'+code} code={code} kind="Permanent"/>)}
     {p.distanceSinceClearKm!=null?<Row label={t('Driven since codes were cleared')} value={t('{n} km',{n:p.distanceSinceClearKm})}/>:null}
     {p.warmupsSinceClear!=null?<Row label={t('Warm-ups since codes were cleared')} value={String(p.warmupsSinceClear)}/>:null}
     {p.distanceWithMilKm?<Row label={t('Driven with the light on')} value={t('{n} km',{n:p.distanceWithMilKm})} tone="warn"/>:null}
     <Text style={[ui.caption,{marginTop:8}]}>{t('Read-only: Yazzy never clears codes. Pending codes are not yet confirmed; permanent ones clear only after the car re-tests the fault.')}</Text>
    </Card>

    {ready.length?<Card title={t('Emission readiness')} right={<Text style={[ui.caption,notReady?{color:c.amber}:null]}>{notReady?t('{n} not ready',{n:notReady}):t('All ready')}</Text>}>
     {ready.map(m=><Row key={m.id} label={MONITOR[m.id]?t(MONITOR[m.id]):m.id} value={m.complete?t('Ready'):t('Not ready')} tone={m.complete?undefined:'warn'}/>)}
     <Text style={[ui.caption,{marginTop:8}]}>{t('Monitors run while driving. "Not ready" right after a battery change or code clear is normal; inspections may need them ready.')}</Text>
    </Card>:null}

    {readings.length?<Card title={live?t('Live readings'):t('Last readings')} right={p.signalsAt?<Text style={ui.caption}>{live?t('now'):since(p.signalsAt)}</Text>:null}>
     <View style={s_.grid}>{readings.map(r=><View key={r[0]} style={s_.tile}><Text style={s_.tileValue} numberOfLines={1}>{readingText(r,s[r[0]])}</Text><Text style={ui.caption} numberOfLines={1}>{t(r[1])}</Text></View>)}</View>
    </Card>:null}

    <Card title={t('Identity')}>
     <Row label={t('VIN')} value={p.vin||'—'} mono/>
     {maker?<Row label={t('Manufacturer (from VIN)')} value={maker}/>:null}
     {p.odometerKm!=null||s.ODOMETER!=null?<Row label={t('Odometer')} value={t('{n} km',{n:fmt(s.ODOMETER??p.odometerKm,0)})}/>:null}
     {p.obdStandard!=null?<Row label={t('OBD standard')} value={OBD_STANDARD[p.obdStandard]?t(OBD_STANDARD[p.obdStandard]):t('Code {n}',{n:p.obdStandard})}/>:null}
     {p.protocol?<Row label={t('Protocol')} value={PROTOCOL[p.protocol]||p.protocol}/>:null}
     {(p.ecus||[]).map((e,i)=><Row key={e} label={i?'':t('Control units')} value={e}/>)}
     {p.supported?<Row label={t('Readings the car offers')} value={String(p.supported.length)}/>:null}
    </Card>

    {car?<Card title={t('Use')}>
     <Row label={t('Distance recorded')} value={car.fuel?.distanceKm!=null?t('{n} km',{n:fmt(car.fuel.distanceKm,0)}):'—'}/>
     <Row label={t('Trips')} value={String(car.trips?.length??'—')}/>
     <Row label={t('Average consumption')} value={car.fuel?.litresPer100Km!=null?t('{n} L/100 km',{n:fmt(car.fuel.litresPer100Km,1)}):'—'}/>
     <Row label={t('Findings to review')} value={String(car.findings?.length??'—')}/>
     <Row label={t('Last service')} value={latest(car.service,'observedAt')?.description||'—'}/>
    </Card>:null}
   </View>
  </ScrollView>

  <View style={[s_.footer,{paddingBottom:Math.max(insets.bottom,12)+4}]}>
   <View style={{flex:1}}><Text style={s_.footTitle}>{type.label}</Text><Text style={ui.caption} numberOfLines={1}>{p.mil?tp(codes.length,'Check engine on · {n} code','Check engine on · {n} codes'):codes.length?tp(codes.length,'{n} stored code','{n} stored codes'):t(p.readAt?'No stored fault codes':t('Not read yet'))}</Text></View>
   <Button title={t(exporting?'Preparing…':'Export PDF')} icon="download-outline" disabled={exporting} onPress={exportPdf} style={{marginVertical:0,paddingHorizontal:16}}/>
  </View>
 </View>;
}

function Card({title,right,children}:{title:string;right?:ReactNode;children:ReactNode}){
 return <View style={ui.card}><View style={[ui.row,{justifyContent:'space-between',marginBottom:6}]}><Text style={ui.title}>{title}</Text>{right}</View>{children}</View>;
}
function Row({label,value,note,tone,mono:isMono}:{label:string;value:string;note?:string;tone?:'ok'|'warn'|'error';mono?:boolean}){
 const color=tone==='warn'?c.amber:tone==='error'?c.red:c.ink;
 return <View style={s_.row}>
  <Text style={s_.rowLabel}>{label}</Text>
  <View style={{flexShrink:1,alignItems:'flex-end'}}><Text style={[s_.rowValue,{color},isMono&&{fontFamily:mono,fontSize:13}]} selectable>{value}</Text>{note?<Text style={[ui.caption,{color:tone==='ok'?c.green:color,textAlign:'right'}]}>{note}</Text>:null}</View>
 </View>;
}
function Code({code,kind}:{code:string;kind:string}){
 return <View style={s_.code}>
  <View style={s_.codeTag}><Text style={s_.codeText}>{code}</Text></View>
  <View style={{flex:1}}><Text style={s_.codeTitle}>{describeCode(code)}</Text><Text style={ui.caption}>{t(kind)}</Text></View>
 </View>;
}

const s_=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},
 hero:{backgroundColor:c.surface,paddingHorizontal:20,paddingBottom:24,overflow:'hidden',minHeight:250},
 back:{flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start',backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,borderRadius:radius.pill,paddingVertical:9,paddingHorizontal:14,marginBottom:18},
 backText:{fontFamily:F[700],fontSize:14,color:c.ink},
 name:{fontFamily:F[600],fontSize:30,lineHeight:36,color:c.ink,letterSpacing:-1,maxWidth:'70%'},
 sub:{fontFamily:F[500],fontSize:14,color:c.ink2,marginTop:4,maxWidth:'70%'},
 badge:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:c.blue,borderRadius:radius.pill,paddingVertical:6,paddingHorizontal:11},
 plain:{backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line},
 badgeText:{fontFamily:F[700],fontSize:12.5,color:'#fff'},
 dot:{width:7,height:7,borderRadius:4},
 source:{fontFamily:F[500],fontSize:12,color:c.muted,marginTop:8,maxWidth:'62%'},
 car:{position:'absolute',right:-30,bottom:8},
 body:{padding:16},
 link:{fontFamily:F[700],fontSize:13.5,color:c.blue},
 chips:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},
 chip:{flexDirection:'row',alignItems:'center',gap:6,borderRadius:radius.pill,paddingVertical:8,paddingHorizontal:12,backgroundColor:c.blue50},
 chipOn:{backgroundColor:c.blue},
 chipText:{fontFamily:F[700],fontSize:13,color:c.blue},
 big:{fontFamily:F[500],fontSize:36,color:c.ink,letterSpacing:-1,fontVariant:['tabular-nums']},
 track:{height:12,borderRadius:6,backgroundColor:c.track,overflow:'hidden',marginTop:10,marginBottom:6},
 fill:{height:'100%',borderRadius:6},
 row:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:16,paddingVertical:9,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 rowLabel:{fontFamily:F[500],fontSize:14,color:c.muted,flexShrink:0,maxWidth:'55%'},
 rowValue:{fontFamily:F[700],fontSize:14,textAlign:'right',fontVariant:['tabular-nums']},
 lamp:{width:26,height:26,borderRadius:radius.sm,alignItems:'center',justifyContent:'center'},
 code:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:9,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 codeTag:{backgroundColor:c.amber50,borderRadius:radius.sm,paddingVertical:5,paddingHorizontal:8},
 codeText:{fontFamily:mono,fontSize:13,fontWeight:'700',color:c.amber},
 codeTitle:{fontFamily:F[600],fontSize:14,color:c.ink},
 grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:10,marginTop:4},
 tile:{width:'48.5%',backgroundColor:c.surface2,borderRadius:radius.md,padding:12},
 tileValue:{fontFamily:F[700],fontSize:16,color:c.ink,fontVariant:['tabular-nums']},
 footer:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:c.frost,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,paddingHorizontal:20,paddingTop:14,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...floatShadow,shadowOpacity:0.1,shadowOffset:{width:0,height:-6}},
 footTitle:{fontFamily:F[700],fontSize:20,color:c.ink,letterSpacing:-0.4},
});
