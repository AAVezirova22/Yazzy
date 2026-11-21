import {memo,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Platform,PermissionsAndroid,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import {c,F,mono,radius,ui} from '../theme';
import {Button,Check,Chip,Icon,IconTile,Notice,ScreenHeader,Segment,useAction} from '../kit';
import {LightSurface} from '../LightSurface';
import {server} from '../server';
import {t} from '../i18n';
import {Recorder,knownChannels,pickChannels,type Characteristic,type Peripheral,type RecorderSnapshot} from '../../modules/yazzy-recorder/src';

type Props={vehicle:any;selected:string;api:string;snapshot:RecorderSnapshot;view:'Record'|'Connect';padBottom:number;onView:(v:string)=>void;refreshSnapshot:()=>Promise<void>};

async function permissions(){if(Platform.OS==='android'){await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,...(Number(Platform.Version)>=33?[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]:[])]);}}
const short=(uuid:string)=>uuid.slice(4,8);

/** Live readings and recording controls, plus picking the Bluetooth adapter and its data channel. */
export const DriveTab=memo(function DriveTab({vehicle,selected,api,snapshot,view,padBottom,onView,refreshSnapshot}:Props){
 const insets=useSafeAreaInsets(),[busy,run]=useAction();
 const [peripherals,setPeripherals]=useState<Peripheral[]>([]),[peripheral,setPeripheral]=useState(''),[characteristics,setCharacteristics]=useState<Characteristic[]>([]),[write,setWrite]=useState<Characteristic|null>(null),[notify,setNotify]=useState<Characteristic|null>(null);
 // Restore the adapter and the write/notify choice from the last session so they never have to be picked again.
 useEffect(()=>{SecureStore.getItemAsync('yazzy-adapter').then(v=>{if(!v)return;const a=JSON.parse(v);setPeripheral(a.peripheral.id);setPeripherals([{...a.peripheral,rssi:0}]);setCharacteristics(a.characteristics);
  // A pair saved before OBD channels were recognised may be the chip's vendor service, which never answers; prefer a known channel.
  const k=knownChannels(a.characteristics||[]);setWrite(k?.write||a.write);setNotify(k?.notify||a.notify);}).catch(()=>{});},[]);
 useEffect(()=>{if(!peripheral||!write||!notify)return;const p=peripherals.find(x=>x.id===peripheral);if(p)SecureStore.setItemAsync('yazzy-adapter',JSON.stringify({peripheral:p,characteristics,write,notify})).catch(()=>{});},[peripheral,write,notify]);

 async function start(){
  const key=JSON.stringify([api,selected,peripheral,write?.service,write?.uuid,notify?.service,notify?.uuid]);
  if(snapshot.configured&&(!(write&&notify&&peripheral)||await SecureStore.getItemAsync('yazzy-configured')===key)){await permissions();await Recorder.start();return;}
  if(!selected)throw new Error(t('No vehicle selected. On Home, tap the switch button and pick or add a vehicle.'));
  if(!peripheral)throw new Error(t('No adapter selected. On Drive › Adapter, scan and tap your adapter.'));
  if(!write||!notify)throw new Error(t('Pick one write and one notify characteristic from the same service on Drive › Adapter.'));
  if(write.service!==notify.service)throw new Error(t('Write and notify must come from the same service. Re-pick them on Drive › Adapter.'));
  const saved=await SecureStore.getItemAsync('collector-'+selected);const enrol=saved?JSON.parse(saved):await server.call('/devices/enrolments',{vehicleId:selected});
  await SecureStore.setItemAsync('collector-'+selected,JSON.stringify(enrol));
  try{await Recorder.configure({apiUrl:api,deviceId:enrol.deviceId,assignmentId:enrol.assignmentId,deviceToken:enrol.deviceToken,peripheralId:peripheral,serviceUuid:write.service,writeUuid:write.uuid,notifyUuid:notify.uuid});}
  catch(e){
   // Readings queued for an earlier pairing (another server, or another car) cannot be sent under this one.
   if(!/queued samples/i.test((e as Error).message))throw e;
   throw new Error(t('This phone still holds {n} readings from its previous pairing, and they cannot be sent to this server. Tap "Reset recorder (discard queue)" below to drop them, then start again.',{n:snapshot.queued}));
  }
  await SecureStore.setItemAsync('yazzy-configured',key);await permissions();await Recorder.start();
 }

 const live=snapshot.recording&&snapshot.connected,recommended=pickChannels(characteristics),waiting=snapshot.recording&&!snapshot.connected,canNudge=Platform.OS==='android';
 const adapterName=peripherals.find(p=>p.id===peripheral)?.name||t('your adapter');
 /** Finds the saved adapter and links up now rather than when Android's background auto-connect gets round to it. */
 const connectNow=()=>run(async()=>{
  await permissions();const found=await Recorder.reconnect();await refreshSnapshot();
  if(!found)Alert.alert(t('Adapter not found nearby'),t("Yazzy looked for {adapter} for 10 seconds. Check that the ignition is on, the adapter's light is on, and no other app or phone is connected to it. Auto-connect keeps waiting in the background.",{adapter:adapterName}));
 });
 // Setting up an adapter needs the recorder off; ask instead of failing.
 const recorderOff=(then:()=>Promise<void>,action:string)=>{
  const go=()=>run(async()=>{if(snapshot.recording){await Recorder.stop();await refreshSnapshot();}await then();});
  if(!snapshot.recording)return go();
  Alert.alert(t('Turn off auto-connect?'),t('To {action}, the recorder stops waiting for {adapter}. Recordings not yet uploaded stay on the phone.',{action:t(action),adapter:adapterName}),[{text:t('Cancel'),style:'cancel'},{text:t('Turn off and continue'),onPress:go}]);
 };
 const scan=()=>run(async()=>{await permissions();setPeripherals(await Recorder.discover());});
 const choose=(p:Peripheral)=>recorderOff(async()=>{setPeripheral(p.id);setWrite(null);setNotify(null);setCharacteristics([]);const list=await Recorder.inspect(p.id);setCharacteristics(list);const pick=pickChannels(list);if(pick){setWrite(pick.write);setNotify(pick.notify);}},'set up this adapter');
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}} keyboardShouldPersistTaps="handled">
  <ScreenHeader title={t('Drive')} subtitle={vehicle?vehicle.name:t('No vehicle selected')} right={busy?<ActivityIndicator color={c.blue}/>:null}/>
  <Segment items={[['Record',t('Record')],['Connect',t('Adapter')]]} value={view} onChange={onView}/>

  {view==='Record'&&<>
   <View style={s.live}>
    <LightSurface variant="drive"/>
    <View style={[ui.row,{justifyContent:'space-between'}]}>
     <Chip dot={live?c.green:snapshot.recording?c.blue:c.muted} label={t(live?'Recording':snapshot.recording?'Armed':'Ready when you are')}/>
     <Icon name="bluetooth" size={18} color={snapshot.connected?c.blue:c.muted}/>
    </View>
    <View style={s.liveNumbers}>
     <View style={{flex:1.3}}><Text style={s.liveValue} numberOfLines={1}>{snapshot.signals.VEHICLE_SPEED??'—'}</Text><Text style={s.liveUnit}>km/h</Text></View>
     <View style={s.liveDivider}/>
     <View style={{flex:1,paddingLeft:18}}><Text style={[s.liveValue,{fontSize:34,lineHeight:40}]} numberOfLines={1}>{snapshot.signals.ENGINE_RPM??'—'}</Text><Text style={s.liveUnit}>rpm</Text></View>
    </View>
    <View style={[ui.row,{gap:8,flexWrap:'wrap'}]}>
     <Chip icon={snapshot.connected?'link':'unlink'} label={t(snapshot.connected?'Adapter connected':'Adapter not connected')}/>
     <Chip icon="cloud-upload-outline" label={t('{n} waiting to upload',{n:snapshot.queued})}/>
    </View>
   </View>
   {snapshot.error?<Notice tone="error">{snapshot.error}</Notice>:null}
   {waiting&&<Notice icon="time">{t('Waiting for your adapter. Turn the car on and it connects by itself, even with the app closed. Each start of the car begins a new trip.')}</Notice>}
   {waiting&&canNudge?<Button title={t(busy?'Looking for the adapter…':'Connect now')} icon="bluetooth" disabled={busy} onPress={connectNow}/>:null}
   {snapshot.recording?<Button title={t(snapshot.connected?'Stop recording':'Disarm auto-connect')} icon="stop" disabled={busy} onPress={()=>run(async()=>{await Recorder.stop();await refreshSnapshot();})}/>
    :<Button title={t(snapshot.configured&&!(write&&notify&&peripheral)?'Start with saved adapter':'Start recording')} icon="play" disabled={busy} onPress={()=>run(async()=>{await start();await refreshSnapshot();})}/>}
   <Button kind="light" title={t('Upload now')} icon="cloud-upload-outline" disabled={busy} onPress={()=>run(async()=>{await Recorder.sync();await refreshSnapshot();})}/>
   {Recorder.canReset?<Button kind="light" title={t('Reset recorder (discard queue)')} icon="trash-outline" disabled={busy} onPress={()=>Alert.alert(t('Reset recorder?'),t('This permanently discards {n} queued readings that have not uploaded, and forgets the server, vehicle and adapter pairing. Start again afterwards to re-pair.',{n:snapshot.queued}),[{text:t('Cancel'),style:'cancel'},{text:t('Discard and reset'),style:'destructive',onPress:()=>{void run(async()=>{await Recorder.reset();await SecureStore.deleteItemAsync('yazzy-configured');await refreshSnapshot();});}}])}/>:null}
   <View style={[ui.card,{marginTop:12}]}>
    <Text style={[ui.title,{marginBottom:4}]}>{t('Before you drive')}</Text>
    <Check ok={!!server.mode} label={t('Connected to your server')}/>
    <Check ok={!!selected} label={vehicle?t('Vehicle · {name}',{name:vehicle.name}):t('Vehicle selected')}/>
    <Check ok={!!peripheral||!!snapshot.configured} label={t('Adapter chosen')}/>
    <Check ok={!!(write&&notify)||!!snapshot.configured} label={t('Data channel selected')}/>
   </View>
   <Text style={s.note}>{t("Don't use the app while driving. Android may stop background recording; anything not yet uploaded stays on the phone.")}</Text>
  </>}

  {view==='Connect'&&<>
   {snapshot.recording?<View style={ui.card}>
    <View style={[ui.row,{gap:12}]}>
     <IconTile icon={live?'checkmark-circle':'time'} tone={live?'green':'blue'}/>
     <View style={{flex:1}}><Text style={s.rowTitle}>{t(live?'Connected to {adapter}':'Waiting for {adapter}',{adapter:adapterName})}</Text><Text style={ui.caption}>{t(live?'Recording. Stop on the Record tab to change adapters.':'Auto-connect is on: it links up when the car is switched on.')}</Text></View>
    </View>
    {waiting&&canNudge?<Button title={t(busy?'Looking for the adapter…':'Connect now')} icon="bluetooth" disabled={busy} onPress={connectNow} style={{marginTop:12}}/>:null}
   </View>:null}
   <View style={ui.card}>
    <Text style={ui.title}>{t(snapshot.recording?'Use a different adapter':'Find your adapter')}</Text>
    <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>{t('Plug the adapter in, close other OBD apps and scan while parked.')}</Text>
    <Button kind={snapshot.recording?'light':'primary'} title={t('Scan for adapters')} icon="bluetooth" disabled={busy||live} onPress={scan}/>
   </View>
   {peripherals.length>0&&<View style={[ui.card,{paddingVertical:6}]}>{peripherals.map((p,i)=>{const on=peripheral===p.id;return <Pressable key={p.id} accessibilityRole="button" accessibilityState={{disabled:busy,selected:on}} disabled={busy} style={[s.listRow,i>0&&s.listRowBorder,busy&&{opacity:0.5}]} onPress={()=>choose(p)}>
    <View style={[s.circle,on?{backgroundColor:c.blue}:{backgroundColor:c.blue50}]}><Icon name={p.likelyObd?'radio':'bluetooth'} size={18} color={on?'#fff':c.blue}/></View>
    <View style={{flex:1}}><Text style={s.rowTitle}>{p.name}</Text><Text style={ui.caption}>{p.rssi?t('Signal {n} dBm',{n:p.rssi}):t('Saved adapter')}{p.likelyObd?' · '+t('OBD adapter'):''}</Text></View>
    {on?<Icon name="checkmark-circle" size={22} color={c.blue}/>:<View style={s.radio}/>}
   </Pressable>;})}</View>}
   {busy&&!!peripheral&&!characteristics.length&&<Notice icon="sync">{t('Connecting to the adapter and reading its services…')}</Notice>}
   {characteristics.length>0&&<Notice tone={write&&notify?'ok':'info'}>{write&&notify?t('Ready: data channel {w} / {n}',{w:short(write.uuid),n:short(notify.uuid)}):t('Pick one write and one notify channel from the same service.')}</Notice>}
   {[...new Set(characteristics.map(x=>x.service))].map(svc=><View key={svc} style={ui.card}>
    <View style={[ui.row,{justifyContent:'space-between',gap:8}]}>
     <Text style={ui.title}>{t('Service')}</Text>
     {recommended?.write.service===svc&&<View style={s.badge}><Icon name="star" size={11} color={c.blue}/><Text style={s.badgeText}>{t('Recommended')}</Text></View>}
    </View>
    <Text style={s.mono}>{svc}</Text>
    {characteristics.filter(x=>x.service===svc).map(ch=>{const w=write?.service===ch.service&&write?.uuid===ch.uuid,n=notify?.service===ch.service&&notify?.uuid===ch.uuid;return <View key={ch.service+ch.uuid} style={s.charRow}>
     <Text style={s.mono}>{ch.uuid}</Text>
     <View style={[ui.row,{gap:8,flexWrap:'wrap'}]}>
      {ch.write&&<Pressable accessibilityRole="button" accessibilityState={{selected:w}} onPress={()=>{setWrite(ch);if(notify&&notify.service!==ch.service)setNotify(null);}} style={[s.choice,w&&s.choiceOn]}>{w?<Icon name="checkmark" size={14} color="#fff"/>:null}<Text style={[s.choiceText,w&&{color:'#fff'}]}>{t('Write')}</Text></Pressable>}
      {ch.notify&&<Pressable accessibilityRole="button" accessibilityState={{selected:n}} onPress={()=>{setNotify(ch);if(write&&write.service!==ch.service)setWrite(null);}} style={[s.choice,n&&s.choiceOn]}>{n?<Icon name="checkmark" size={14} color="#fff"/>:null}<Text style={[s.choiceText,n&&{color:'#fff'}]}>{t('Notify')}</Text></Pressable>}
     </View>
    </View>;})}
   </View>)}
   <Text style={s.note}>{t('Bluetooth LE adapters only. Classic Bluetooth adapters are not supported yet.')}</Text>
  </>}
 </ScrollView>;
});

const s=StyleSheet.create({
 circle:{width:40,height:40,borderRadius:radius.md,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontFamily:F[700],fontSize:15,color:c.ink},
 live:{backgroundColor:c.skyTop,borderWidth:StyleSheet.hairlineWidth,borderColor:c.skyLine,borderRadius:radius.xl,padding:20,marginBottom:14,overflow:'hidden'},
 liveNumbers:{flexDirection:'row',alignItems:'center',marginVertical:24},
 liveValue:{fontFamily:F[500],fontSize:64,lineHeight:70,color:c.ink,letterSpacing:-2.6,fontVariant:['tabular-nums']},
 liveUnit:{fontFamily:F[600],fontSize:13,color:c.ink2,marginTop:2},
 liveDivider:{width:StyleSheet.hairlineWidth,alignSelf:'stretch',backgroundColor:c.skyLine},
 listRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},
 listRowBorder:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 radio:{width:22,height:22,borderRadius:11,borderWidth:1.5,borderColor:c.faint},
 badge:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:c.blue50,borderRadius:radius.sm,paddingVertical:4,paddingHorizontal:9},
 badgeText:{fontFamily:F[700],fontSize:12,color:c.blue},
 mono:{fontFamily:mono,fontSize:11,color:c.muted,marginTop:4},
 charRow:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line,marginTop:12,paddingTop:10,gap:8},
 choice:{flexDirection:'row',alignItems:'center',gap:6,borderRadius:radius.md,paddingVertical:8,paddingHorizontal:14,backgroundColor:c.surface2,borderWidth:1,borderColor:c.line},
 choiceOn:{backgroundColor:c.blue,borderColor:c.blue},
 choiceText:{fontFamily:F[700],fontSize:13,color:c.ink2},
 note:{fontFamily:F[500],fontSize:12.5,lineHeight:18,color:c.muted,marginTop:6,marginBottom:10,paddingHorizontal:4,textAlign:'center'},
});
