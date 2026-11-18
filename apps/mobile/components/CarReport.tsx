import {useState,type ReactNode} from 'react';
import {Alert,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,mono,shadow,ui} from './theme';
import {Button,Icon,Notice} from './kit';
import {CarArt} from './art';
import {exportCarPdf} from './carPdf';
import {CarMap} from './CarMap';
import {battery12,boost,carSpot,describeCode,detect,KINDS,kindIcon,makerFromVin,MONITOR,OBD_STANDARD,PROTOCOL,READINGS,readingText,since,type CarProfile,type Kind} from './car';
import {carLine,fmt,latest} from './format';
import type {Car} from './tabs/types';

type Props={vehicle:any;report:CarProfile|null;live:boolean;car:Car|null;onClose:()=>void;onSetKind:(k:Kind|null)=>void};
const DIESEL_MONITORS=['PM_FILTER','NOX_SCR','EGR','BOOST_PRESSURE','EXHAUST_SENSOR','NMHC_CATALYST'];

/** Everything the car reports about itself: type, hybrid or diesel specifics, fault codes, readiness and identity. */
export function CarReport({vehicle,report,live,car,onClose,onSetKind}:Props){
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
  <StatusBar style={spot?'dark':'light'}/>
  {/* The map stays put above the page (as on a trip), so dragging it pans the map instead of scrolling. No saved spot, no map. */}
  {spot?<View style={s_.mapBox}>
   <CarMap spot={spot} live={live&&spot.source==='recorder'} style={StyleSheet.absoluteFill}/>
   <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={({pressed})=>[s_.backLight,{top:insets.top+10},pressed&&{opacity:0.85}]}>
    <Icon name="arrow-back" size={18} color={c.ink}/><Text style={[s_.backText,{color:c.ink}]}>Car report</Text>
   </Pressable>
  </View>:null}
  <ScrollView style={spot?s_.sheet:null} contentContainerStyle={{paddingBottom:120+insets.bottom}}>
   <View style={[s_.hero,spot?{paddingTop:22,borderTopLeftRadius:28,borderTopRightRadius:28}:{paddingTop:insets.top+10}]}>
    {spot?null:<Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={({pressed})=>[s_.back,pressed&&{opacity:0.8}]}>
     <Icon name="arrow-back" size={18} color="#fff"/><Text style={s_.backText}>Car report</Text>
    </Pressable>}
    <Text style={s_.name} numberOfLines={2}>{vehicle?.name||'Your car'}</Text>
    <Text style={s_.sub} numberOfLines={1}>{vehicle?[carLine(vehicle),maker&&!vehicle.make?maker:null].filter(Boolean).join(' · '):''}</Text>
    <View style={[ui.row,{gap:8,marginTop:14,flexWrap:'wrap'}]}>
     <View style={s_.badge}><Icon name={kindIcon(kind)} size={14} color="#fff"/><Text style={s_.badgeText}>{type.label}</Text></View>
     <View style={[s_.badge,{backgroundColor:c.night2}]}><View style={[s_.dot,{backgroundColor:live?'#4ade80':c.nightMuted}]}/><Text style={s_.badgeText}>{live?'Live from the car':p.readAt?`Read ${since(p.readAt)}`:'Not read yet'}</Text></View>
    </View>
    <Text style={s_.source}>{type.source}</Text>
    <View style={s_.car} pointerEvents="none"><CarArt width={220}/></View>
   </View>

   <View style={s_.body}>
    {!report?.readAt?<Notice icon="bluetooth">Turn the car on and start recording on the Drive tab. Within a minute the recorder reads the fuel type, VIN, fault codes and readiness, and this page fills in.{Platform.OS==='ios'?' Reading the car report needs the Android app for now; reports read there show here too.':''}</Notice>:null}

    <Card title="Type" right={<Pressable accessibilityRole="button" onPress={()=>setPicking(v=>!v)} hitSlop={8}><Text style={s_.link}>{picking?'Done':'Not right?'}</Text></Pressable>}>
     <Row label="Detected as" value={type.label}/>
     {p.fuelType!=null?<Row label="Fuel type reading" value={`Code ${p.fuelType}`}/>:null}
     {p.ignition?<Row label="Engine" value={p.ignition==='COMPRESSION'?'Compression ignition (diesel)':'Spark ignition (petrol or hybrid)'}/>:null}
     {picking?<View style={s_.chips}>
      {KINDS.map(([k,label,icon])=>{const on=p.userKind===k;return <Pressable key={k} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>onSetKind(k)} style={[s_.chip,on&&s_.chipOn]}><Icon name={icon} size={14} color={on?'#fff':c.blue}/><Text style={[s_.chipText,on&&{color:'#fff'}]}>{label}</Text></Pressable>;})}
      {p.userKind?<Pressable accessibilityRole="button" onPress={()=>onSetKind(null)} style={s_.chip}><Icon name="refresh" size={14} color={c.blue}/><Text style={s_.chipText}>Detect</Text></Pressable>:null}
     </View>:null}
    </Card>

    {kind==='HYBRID'||kind==='ELECTRIC'?<Card title={kind==='HYBRID'?'Hybrid system':'Battery'}>
     {hv!=null?<>
      <View style={[ui.row,{justifyContent:'space-between',alignItems:'flex-end'}]}><Text style={s_.big}>{fmt(hv,0)}<Text style={ui.unit}> %</Text></Text><Text style={ui.caption}>{kind==='HYBRID'?'Hybrid battery charge':'Battery charge'}</Text></View>
      <View style={s_.track}><View style={[s_.fill,{width:`${Math.max(2,Math.min(100,hv))}%`,backgroundColor:hv<20?c.amber:c.green}]}/></View>
     </>:<Text style={ui.body}>{report?.readAt?'This car does not share its traction battery charge over standard OBD (PID 5B). Many hybrids keep it to the manufacturer\'s own diagnostics.':'Shown after the first reading.'}</Text>}
     {kind==='HYBRID'&&s.ENGINE_RPM!=null?<Row label="Petrol engine" value={s.ENGINE_RPM>0?`Running · ${fmt(s.ENGINE_RPM,0)} rpm`:'Off (electric or stopped)'}/>:null}
    </Card>:null}

    {kind==='DIESEL'?<Card title="Diesel system">
     {s.FUEL_RAIL_PRESSURE!=null?<Row label="Fuel rail pressure" value={`${fmt(s.FUEL_RAIL_PRESSURE/1000,1)} MPa`}/>:null}
     {b!=null?<Row label="Turbo boost" value={`${fmt(b/100,2)} bar`}/>:null}
     {ready.filter(m=>DIESEL_MONITORS.includes(m.id)).map(m=><Row key={m.id} label={MONITOR[m.id]} value={m.complete?'Ready':'Not ready'} tone={m.complete?undefined:'warn'}/>)}
     {s.FUEL_RAIL_PRESSURE==null&&b==null&&!ready.some(m=>DIESEL_MONITORS.includes(m.id))?<Text style={ui.body}>Shown after the first reading.</Text>:null}
    </Card>:null}

    <Card title="Batteries and power">
     <Row label="12 V battery" value={volts!=null?`${fmt(volts,1)} V`:'—'} note={v12?.text} tone={v12?.tone}/>
     {s.MODULE_VOLTAGE!=null?<Row label="Control module voltage" value={`${fmt(s.MODULE_VOLTAGE,1)} V`}/>:null}
    </Card>

    <Card title="Check engine" right={<View style={[s_.lamp,{backgroundColor:p.mil?c.amber:p.mil===false?c.green:c.track}]}><Icon name={p.mil?'warning':'checkmark'} size={14} color="#fff"/></View>}>
     <Row label="Warning light" value={p.mil==null?'—':p.mil?'On':'Off'} tone={p.mil?'warn':undefined}/>
     {codes.length?codes.map(code=><Code key={code} code={code} kind="Stored"/>):p.stored?<Text style={[ui.body,{marginVertical:4}]}>No fault codes stored.</Text>:null}
     {pending.map(code=><Code key={code} code={code} kind="Pending"/>)}
     {permanent.map(code=><Code key={'p'+code} code={code} kind="Permanent"/>)}
     {p.distanceSinceClearKm!=null?<Row label="Driven since codes were cleared" value={`${p.distanceSinceClearKm} km`}/>:null}
     {p.warmupsSinceClear!=null?<Row label="Warm-ups since codes were cleared" value={String(p.warmupsSinceClear)}/>:null}
     {p.distanceWithMilKm?<Row label="Driven with the light on" value={`${p.distanceWithMilKm} km`} tone="warn"/>:null}
     <Text style={[ui.caption,{marginTop:8}]}>Read-only: Yazzy never clears codes. Pending codes are not yet confirmed; permanent ones clear only after the car re-tests the fault.</Text>
    </Card>

    {ready.length?<Card title="Emission readiness" right={<Text style={[ui.caption,notReady?{color:c.amber}:null]}>{notReady?`${notReady} not ready`:'All ready'}</Text>}>
     {ready.map(m=><Row key={m.id} label={MONITOR[m.id]||m.id} value={m.complete?'Ready':'Not ready'} tone={m.complete?undefined:'warn'}/>)}
     <Text style={[ui.caption,{marginTop:8}]}>Monitors run while driving. "Not ready" right after a battery change or code clear is normal; inspections may need them ready.</Text>
    </Card>:null}

    {readings.length?<Card title={live?'Live readings':'Last readings'} right={p.signalsAt?<Text style={ui.caption}>{live?'now':since(p.signalsAt)}</Text>:null}>
     <View style={s_.grid}>{readings.map(r=><View key={r[0]} style={s_.tile}><Text style={s_.tileValue} numberOfLines={1}>{readingText(r,s[r[0]])}</Text><Text style={ui.caption} numberOfLines={1}>{r[1]}</Text></View>)}</View>
    </Card>:null}

    <Card title="Identity">
     <Row label="VIN" value={p.vin||'—'} mono/>
     {maker?<Row label="Manufacturer (from VIN)" value={maker}/>:null}
     {p.odometerKm!=null||s.ODOMETER!=null?<Row label="Odometer" value={`${fmt(s.ODOMETER??p.odometerKm,0)} km`}/>:null}
     {p.obdStandard!=null?<Row label="OBD standard" value={OBD_STANDARD[p.obdStandard]||`Code ${p.obdStandard}`}/>:null}
     {p.protocol?<Row label="Protocol" value={PROTOCOL[p.protocol]||p.protocol}/>:null}
     {(p.ecus||[]).map((e,i)=><Row key={e} label={i?'':'Control units'} value={e}/>)}
     {p.supported?<Row label="Readings the car offers" value={String(p.supported.length)}/>:null}
    </Card>

    {car?<Card title="Use">
     <Row label="Distance recorded" value={car.fuel?.distanceKm!=null?`${fmt(car.fuel.distanceKm,0)} km`:'—'}/>
     <Row label="Trips" value={String(car.trips?.length??'—')}/>
     <Row label="Average consumption" value={car.fuel?.litresPer100Km!=null?`${fmt(car.fuel.litresPer100Km,1)} L/100 km`:'—'}/>
     <Row label="Findings to review" value={String(car.findings?.length??'—')}/>
     <Row label="Last service" value={latest(car.service,'observedAt')?.description||'—'}/>
    </Card>:null}
   </View>
  </ScrollView>

  <View style={[s_.footer,{paddingBottom:Math.max(insets.bottom,12)+4}]}>
   <View style={{flex:1}}><Text style={s_.footTitle}>{type.label}</Text><Text style={ui.caption} numberOfLines={1}>{p.mil?`Check engine on · ${codes.length} codes`:codes.length?`${codes.length} stored codes`:p.readAt?'No stored fault codes':'Not read yet'}</Text></View>
   <Button title={exporting?'Preparing…':'Export PDF'} icon="download-outline" disabled={exporting} onPress={exportPdf} style={{marginVertical:0,paddingHorizontal:16}}/>
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
  <View style={{flex:1}}><Text style={s_.codeTitle}>{describeCode(code)}</Text><Text style={ui.caption}>{kind}</Text></View>
 </View>;
}

const s_=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},
 hero:{backgroundColor:c.night,paddingHorizontal:20,paddingBottom:24,overflow:'hidden',minHeight:250},
 back:{flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start',backgroundColor:'rgba(255,255,255,0.1)',borderRadius:999,paddingVertical:9,paddingHorizontal:14,marginBottom:18},
 backText:{fontSize:14,fontWeight:'700',color:'#fff'},
 mapBox:{height:'44%'},
 backLight:{position:'absolute',left:16,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:c.surface,borderRadius:999,paddingVertical:10,paddingHorizontal:14,...shadow},
 sheet:{flex:1,marginTop:-26,borderTopLeftRadius:28,borderTopRightRadius:28,backgroundColor:c.bg,overflow:'hidden'},
 name:{fontSize:28,fontWeight:'800',color:'#fff',letterSpacing:-0.8,maxWidth:'70%'},
 sub:{fontSize:14,color:c.nightMuted,marginTop:4,maxWidth:'70%'},
 badge:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:c.blue,borderRadius:999,paddingVertical:6,paddingHorizontal:11},
 badgeText:{fontSize:12.5,fontWeight:'700',color:'#fff'},
 dot:{width:7,height:7,borderRadius:4},
 source:{fontSize:12,color:c.nightMuted,marginTop:8,maxWidth:'62%'},
 car:{position:'absolute',right:-30,bottom:-6},
 body:{padding:16},
 link:{fontSize:13.5,fontWeight:'700',color:c.blue},
 chips:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},
 chip:{flexDirection:'row',alignItems:'center',gap:6,borderRadius:999,paddingVertical:8,paddingHorizontal:12,backgroundColor:c.blue50},
 chipOn:{backgroundColor:c.blue},
 chipText:{fontSize:13,fontWeight:'700',color:c.blue},
 big:{fontSize:34,fontWeight:'800',color:c.ink,letterSpacing:-1,fontVariant:['tabular-nums']},
 track:{height:12,borderRadius:6,backgroundColor:c.track,overflow:'hidden',marginTop:10,marginBottom:6},
 fill:{height:'100%',borderRadius:6},
 row:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:16,paddingVertical:8,borderTopWidth:1,borderTopColor:c.line2},
 rowLabel:{fontSize:14,color:c.muted,flexShrink:0,maxWidth:'55%'},
 rowValue:{fontSize:14,fontWeight:'700',textAlign:'right'},
 lamp:{width:26,height:26,borderRadius:13,alignItems:'center',justifyContent:'center'},
 code:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:9,borderTopWidth:1,borderTopColor:c.line2},
 codeTag:{backgroundColor:c.amber50,borderRadius:8,paddingVertical:5,paddingHorizontal:8},
 codeText:{fontFamily:mono,fontSize:13,fontWeight:'700',color:c.amber},
 codeTitle:{fontSize:14,fontWeight:'600',color:c.ink},
 grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:10,marginTop:4},
 tile:{width:'48.5%',backgroundColor:c.surface2,borderRadius:14,padding:12},
 tileValue:{fontSize:16,fontWeight:'700',color:c.ink,fontVariant:['tabular-nums']},
 footer:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:c.surface,borderTopLeftRadius:26,borderTopRightRadius:26,paddingHorizontal:20,paddingTop:14,...shadow,shadowOffset:{width:0,height:-4},elevation:12},
 footTitle:{fontSize:20,fontWeight:'800',color:c.ink,letterSpacing:-0.4},
});
