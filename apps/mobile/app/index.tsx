import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,BackHandler,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScreenContainer} from 'react-native-screens';
import {StatusBar} from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {TripDetail} from '../components/TripDetail';
import {c,ui,F} from '../components/theme';
import {Icon,useAction} from '../components/kit';
import {Sheet} from '../components/Sheet';
import {NavBar,NAV_HEIGHT,TabPane,TABS,type TabKey} from '../components/Tabs';
import {SignIn} from '../components/SignIn';
import {GarageTab} from '../components/tabs/Garage';
import {TripsTab} from '../components/tabs/Trips';
import {HealthTab} from '../components/tabs/Health';
import {DriveTab} from '../components/tabs/Drive';
import {MoreTab} from '../components/tabs/More';
import type {Car} from '../components/tabs/types';
import {CarReport} from '../components/CarReport';
import {detect,serverType,type CarProfile,type Kind} from '../components/car';
import {readCache,server,writeCache} from '../components/server';
import {carLine} from '../components/format';
import {available,Recorder,type RecorderSnapshot} from '../modules/yazzy-recorder/src';

const empty:RecorderSnapshot={recording:false,connected:false,queued:0,error:null,signals:{},qualification:'PENDING_DEVICE_TEST'};
// Fetched one after another: the free server has a tenth of a CPU, and trips come first because Home and Trips show them.
const PARTS:[Exclude<keyof Car,'vehicleId'>,string][]=[['trips','trips'],['fuel','fuel-report'],['findings','findings'],['service','maintenance-records']];
const blank=(id:string):Car=>({vehicleId:id,fuel:null,trips:null,findings:null,service:null});
const STALE_MS=30000;
const quiet=(message:string)=>/[.!?]$/.test(message)?message:`Couldn't refresh (${message}).`;

export default function App(){
 const insets=useSafeAreaInsets();
 // undefined while the saved connection is read (a few milliseconds, no network), null when this phone never connected.
 const [mode,setMode]=useState<'demo'|'oidc'|null|undefined>(undefined),[session,setSession]=useState(0),[api,setApi]=useState(server.api);
 const [vehicles,setVehicles]=useState<any[]>([]),[selected,setSelected]=useState(''),[car,setCar]=useState<Car|null>(null);
 const [refreshing,setRefreshing]=useState(false),[pulling,setPulling]=useState(false),[offline,setOffline]=useState('');
 const [tab,setTab]=useState<TabKey>('Home'),[visited,setVisited]=useState<TabKey[]>(['Home']);
 const [healthView,setHealthView]=useState<'Health'|'Service'>('Health'),[driveView,setDriveView]=useState<'Record'|'Connect'>('Record');
 const [snapshot,setSnapshot]=useState(empty),[garageOpen,setGarageOpen]=useState(false),[tripView,setTripView]=useState<any>(null);
 const [report,setReport]=useState<CarProfile|null>(null),[recorderVehicle,setRecorderVehicle]=useState(''),[carOpen,setCarOpen]=useState(false);
 const vehiclesRef=useRef<any[]>([]),reports=useRef<Record<string,CarProfile>>({}),pushed=useRef<Record<string,{key:string;at:number}>>({}),savedAt=useRef<Record<string,number>>({});
 const selectedRef=useRef(''),carRef=useRef<Car|null>(null),fresh=useRef<Record<string,number>>({}),inflight=useRef<{id:string;done:Promise<void>}|null>(null);
 selectedRef.current=selected;vehiclesRef.current=vehicles;

 /** Shows the last-known garage from the phone at once; the effects below then refresh it from the server. */
 const boot=useCallback(async()=>{
  const [list,saved]=await Promise.all([readCache<any[]>('vehicles'),SecureStore.getItemAsync('yazzy-vehicle').catch(()=>null)]);
  const id=list?.find(v=>v.id===saved)?.id||saved||list?.[0]?.id||'';
  fresh.current={};carRef.current=null;inflight.current=null;
  setApi(server.api);setVehicles(list||[]);setCar(null);setSelected(id);setOffline('');setMode(server.mode);setSession(n=>n+1);
 },[]);
 useEffect(()=>{server.restore().catch(()=>null).then(boot);},[]);
 const disconnected=useCallback(()=>{setMode(null);setTab('Home');setVisited(['Home']);setVehicles([]);setSelected('');setCar(null);carRef.current=null;},[]);

 useEffect(()=>{
  if(!mode)return;
  let active=true;
  server.call('/vehicles').then((list:any[])=>{
   if(!active)return;
   setVehicles(list);void writeCache('vehicles',list);
   const cur=selectedRef.current,id=list.some(v=>v.id===cur)?cur:(list[0]?.id||'');
   if(id!==cur){setSelected(id);if(id)SecureStore.setItemAsync('yazzy-vehicle',id).catch(()=>{});}
  }).catch(e=>{if(active)setOffline(quiet((e as Error).message));});
  return()=>{active=false;};
 },[mode,session]);

 /** Refreshes the selected car's trips, fuel, findings and service, at most every 30 s unless forced, and saves them. */
 const refresh=useCallback((force:boolean):Promise<void>=>{
  const id=selectedRef.current;
  if(!id||!server.mode)return Promise.resolve();
  if(inflight.current?.id===id)return inflight.current.done;
  if(!force&&Date.now()-(fresh.current[id]||0)<STALE_MS)return Promise.resolve();
  setRefreshing(true);
  const done=(async()=>{
   let next=carRef.current?.vehicleId===id?carRef.current:blank(id),failure='';
   for(const [key,path] of PARTS){
    try{const value=await server.call(`/vehicles/${id}/${path}`);if(selectedRef.current!==id)return;next={...next,[key]:value};carRef.current=next;setCar(next);}
    catch(e){failure=(e as Error).message;if(/reach|in time/.test(failure))break;}
   }
   if(selectedRef.current!==id)return;
   if(!failure)fresh.current[id]=Date.now();
   setOffline(failure?quiet(failure):'');
   void writeCache('car-'+id,next);
  })().finally(()=>{if(inflight.current?.id===id){inflight.current=null;setRefreshing(false);}});
  inflight.current={id,done};
  return done;
 },[]);
 /** Asks the server to rebuild the last 14 days of trips from the stored readings (drives missed while trip building failed). */
 const rebuild=useCallback(async(quiet:boolean)=>{
  const id=selectedRef.current;if(!id)return false;
  try{
   await server.call(`/vehicles/${id}/trips/rebuild`,{days:14});
   if(!quiet)Alert.alert('Rebuilding trips','Trips from the last 14 days are being rebuilt from the readings your car recorded. Pull down on Trips in a minute to see them.');
   setTimeout(()=>{void refresh(true);},45000);return true;
  }catch(e){if(!quiet)Alert.alert('Yazzy',(e as Error).message);return false;}
 },[]);
 // Once per car after this update: recover the drives whose trips were never built.
 useEffect(()=>{
  if(!mode||!selected)return;
  SecureStore.getItemAsync('yazzy-rebuilt-v2').then(async v=>{const done:string[]=JSON.parse(v||'[]');if(done.includes(selected))return;if(await rebuild(true))await SecureStore.setItemAsync('yazzy-rebuilt-v2',JSON.stringify([...done,selected]));}).catch(()=>{});
 },[mode,session,selected]);
 const rebuildNow=useCallback(()=>{void rebuild(false);},[rebuild]);
 const pullToRefresh=useCallback(()=>{setPulling(true);refresh(true).finally(()=>setPulling(false));},[refresh]);

 useEffect(()=>{
  if(!mode||!selected){setCar(null);carRef.current=null;return;}
  let active=true;
  if(carRef.current?.vehicleId!==selected){carRef.current=null;setCar(null);setRefreshing(false);}
  readCache<Car>('car-'+selected).then(cached=>{
   if(!active)return;
   if(cached?.vehicleId===selected&&carRef.current?.vehicleId!==selected){carRef.current=cached;setCar(cached);}
   void refresh(false);
  });
  return()=>{active=false;};
 },[mode,session,selected]);

 // Recorder status: re-render only when it actually changed, poll slowly when idle and not at all in the background.
 const snapKey=useRef('');
 const refreshSnapshot=useCallback(()=>available?Recorder.snapshot().then(next=>{const key=JSON.stringify(next);if(key!==snapKey.current){snapKey.current=key;setSnapshot(next);}}).catch(()=>{}):Promise.resolve(),[]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
  const tick=async()=>{if(AppState.currentState==='active')await refreshSnapshot();if(!stopped)timer=setTimeout(tick,snapKey.current.includes('"recording":true')?1500:4000);};
  if(available)void tick();
  // Coming back to the app (after a drive, say) refreshes stale data as well.
  // Coming back to the app while the recorder waits for the car also looks for the adapter, so it links up at once.
  const nudge=()=>refreshSnapshot().then(()=>{try{const s=JSON.parse(snapKey.current||'{}');if(s.recording&&!s.connected)Recorder.reconnect().catch(()=>{});}catch{}});
  if(available)void nudge();
  const sub=AppState.addEventListener('change',state=>{if(state==='active'){void nudge();void refresh(false);}});
  return()=>{stopped=true;clearTimeout(timer);sub.remove();};
 },[]);

 const go=useCallback((view:string)=>{
  const t:TabKey=view==='Health'||view==='Service'?'Health':view==='Record'||view==='Connect'?'Drive':view as TabKey;
  if(view==='Health'||view==='Service')setHealthView(view);
  if(view==='Record'||view==='Connect')setDriveView(view);
  setTab(t);setVisited(v=>v.includes(t)?v:[...v,t]);
  if(t==='Home'||t==='Trips'||t==='Health')void refresh(false);
 },[refresh]);
 // Once Home is up, quietly render the other tabs one by one, so even the first visit to each opens instantly.
 useEffect(()=>{
  if(!mode)return;
  const queue:TabKey[]=['Trips','Health','Drive','More'];let timer:ReturnType<typeof setTimeout>;
  const next=()=>{const k=queue.shift();if(!k)return;setVisited(v=>v.includes(k)?v:[...v,k]);timer=setTimeout(next,450);};
  timer=setTimeout(next,1500);
  return()=>clearTimeout(timer);
 },[mode,session]);
 // Android Back on another tab returns Home before it leaves the app.
 useEffect(()=>{
  if(!mode||tab==='Home')return;
  const sub=BackHandler.addEventListener('hardwareBackPress',()=>{go('Home');return true;});
  return()=>sub.remove();
 },[mode,tab,go]);
 const openGarage=useCallback(()=>setGarageOpen(true),[]),closeGarage=useCallback(()=>setGarageOpen(false),[]);
 const pickVehicle=useCallback((id:string)=>{setSelected(id);SecureStore.setItemAsync('yazzy-vehicle',id).catch(()=>{});setGarageOpen(false);},[]);
 const vehicleAdded=useCallback((list:any[],id?:string)=>{setVehicles(list);void writeCache('vehicles',list);if(id)pickVehicle(id);},[pickVehicle]);

 // The car report: what the recorder read from the car, merged with its latest live values, kept per car on the phone
 // and on the server. The newest of the phone's copy and the server's copy wins.
 const newer=(a?:CarProfile|null,b?:CarProfile|null)=>((a?.readAt||0)>=(b?.readAt||0)?a:b)||null;
 useEffect(()=>{
  if(!mode||!selected){setReport(null);return;}
  let active=true;
  setReport(reports.current[selected]||null);
  readCache<CarProfile>('report-'+selected).then(local=>{
   if(!active)return;
   const best=newer(newer(reports.current[selected],local),vehiclesRef.current.find(v=>v.id===selected)?.profile);
   if(best){reports.current[selected]=best;setReport(best);}
  });
  return()=>{active=false;};
 },[mode,session,selected]);
 useEffect(()=>{const remote=vehicles.find(v=>v.id===selected)?.profile;if(remote&&(remote.readAt||0)>(reports.current[selected]?.readAt||0)){reports.current[selected]=remote;setReport(remote);}},[vehicles]);
 // The recorder belongs to the car it was last started for.
 useEffect(()=>{SecureStore.getItemAsync('yazzy-configured').then(k=>{try{const a=JSON.parse(k||'[]');setRecorderVehicle(String((typeof a[0]==='string'&&a[0].startsWith('http')?a[1]:a[0])||''));}catch{setRecorderVehicle('');}}).catch(()=>{});},[session,snapshot.configured,snapshot.recording]);

 /** Saves the report on the server with the detected type; skipped when nothing important changed in the last 15 minutes. */
 const pushReport=useCallback(async(id:string,next:CarProfile,force=false)=>{
  const key=JSON.stringify([next.vin,next.fuelType,next.ignition,next.mil,next.stored,next.pending,next.permanent,next.readiness,next.ecus,next.userKind]);
  const last=pushed.current[id];
  if(!force&&last&&last.key===key&&Date.now()-last.at<900000)return;
  pushed.current[id]={key,at:Date.now()};
  const fields:Record<string,unknown>={profile:next},type=detect(next),odo=next.signals?.ODOMETER??next.odometerKm;
  if(type.kind)Object.assign(fields,serverType(type.kind,next));
  if(odo!=null)fields.odometerKm=Math.round(odo*10)/10;
  const save=(version:number)=>server.call(`/vehicles/${id}`,{...fields,version},'PATCH');
  try{
   let v=vehiclesRef.current.find(x=>x.id===id);if(!v)return;
   let updated;try{updated=await save(v.version);}catch(e){if((e as Error).message!=='STALE_VERSION')throw e;v=await server.call(`/vehicles/${id}`);updated=await save(v.version);}
   const list=vehiclesRef.current.map(x=>x.id===id?updated:x);setVehicles(list);void writeCache('vehicles',list);
  }catch{pushed.current[id]={key:'',at:Date.now()};/* an older server without car reports, or offline: the phone keeps it and tries later */}
 },[]);
 const storeReport=useCallback((id:string,next:CarProfile,force=false)=>{
  reports.current[id]=next;if(id===selectedRef.current)setReport(next);
  if(force||Date.now()-(savedAt.current[id]||0)>60000){savedAt.current[id]=Date.now();void writeCache('report-'+id,next);void pushReport(id,next,force);}
 },[pushReport]);
 const nativeProfile=useMemo(()=>{try{return snapshot.profile?JSON.parse(snapshot.profile) as CarProfile:null;}catch{return null;}},[snapshot.profile]);
 const nativeSpot=useMemo(()=>{try{return snapshot.parked?JSON.parse(snapshot.parked) as CarProfile['parked']:null;}catch{return null;}},[snapshot.parked]);
 const wasConnected=useRef(false);
 useEffect(()=>{
  const id=recorderVehicle;if(!mode||!id||(!nativeProfile&&!nativeSpot&&!snapshot.connected))return;
  const prev=reports.current[id]||null,next:CarProfile={...(prev||{}),...(nativeProfile||{}),userKind:prev?.userKind??null};
  if(snapshot.connected&&Object.keys(snapshot.signals).length){next.signals={...(prev?.signals||{}),...snapshot.signals};next.signalsAt=Date.now()/1000;}
  if(nativeSpot&&(nativeSpot.at||0)>=(prev?.parked?.at||0))next.parked=nativeSpot;
  // The moment the car goes quiet (switched off), save where it stands right away instead of within the next minute.
  const parkedNow=wasConnected.current&&!snapshot.connected;wasConnected.current=snapshot.connected;
  storeReport(id,next,parkedNow||(nativeProfile?.readAt||0)>(prev?.readAt||0)+170);
 },[mode,recorderVehicle,nativeProfile,nativeSpot,snapshot.signals,snapshot.connected]);
 const setKind=useCallback((k:Kind|null)=>{const id=selectedRef.current;if(!id)return;storeReport(id,{...(reports.current[id]||{}),userKind:k},true);},[storeReport]);
 const openCar=useCallback(()=>setCarOpen(true),[]);
 const carInfo=useMemo(()=>{const t=detect(report);return {label:t.label,kind:t.kind,mil:report?.mil,codes:(report?.stored||[]).length,read:!!report?.readAt};},[report]);

 const live=snapshot.recording&&snapshot.connected,speed=snapshot.signals.VEHICLE_SPEED;
 const recorder=useMemo(()=>({label:live?`Recording${speed!=null?` · ${speed} km/h`:''}`:snapshot.recording?'Waiting for your car':'Not recording',live,recording:snapshot.recording}),[live,speed,snapshot.recording]);

 if(mode===undefined)return <View style={{flex:1,backgroundColor:c.night}}><StatusBar style="light"/></View>;
 if(!mode)return <View style={{flex:1}}><StatusBar style="light"/><SignIn api={api} onConnected={boot}/></View>;

 const vehicle=vehicles.find(v=>v.id===selected),navBottom=Math.max(insets.bottom,10)+8,padBottom=navBottom+NAV_HEIGHT+28;
 const page=(key:TabKey)=>{switch(key){
  case 'Home':return <GarageTab vehicle={vehicle} car={car} refreshing={pulling} busy={refreshing} offline={offline} recorder={recorder} padBottom={padBottom} onRefresh={pullToRefresh} onSwitch={openGarage} onGo={go} onOpenTrip={setTripView} carInfo={carInfo} onOpenCar={openCar}/>;
  case 'Trips':return <TripsTab vehicle={vehicle} trips={car?.trips??null} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onRefresh={pullToRefresh} onOpenTrip={setTripView} onRebuild={rebuildNow}/>;
  case 'Health':return <HealthTab vehicle={vehicle} findings={car?.findings??null} service={car?.service??null} view={healthView} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onView={go} onRefresh={pullToRefresh}/>;
  case 'Drive':return <DriveTab vehicle={vehicle} selected={selected} api={api} snapshot={snapshot} view={driveView} padBottom={padBottom} onView={go} refreshSnapshot={refreshSnapshot}/>;
  case 'More':return <MoreTab vehicle={vehicle} vehicleCount={vehicles.length} selected={selected} api={api} padBottom={padBottom} onVehicles={openGarage} onCar={openCar} onConnected={boot} onDisconnected={disconnected}/>;
 }};

 return <View style={s.screen}>
  <StatusBar style={tab==='Home'?'light':'dark'}/>
  <ScreenContainer style={{flex:1}} hasTwoStates>
   {TABS.filter(t=>visited.includes(t.key)).map(t=><TabPane key={t.key} active={tab===t.key}>{page(t.key)}</TabPane>)}
  </ScreenContainer>
  <NavBar active={tab} onChange={go} bottom={navBottom} recording={snapshot.recording?(snapshot.connected?'live':'armed'):null}/>

  <Sheet open={garageOpen} onClose={closeGarage} title="Your vehicles">
   <ScrollView style={{maxHeight:300}}>
    {vehicles.map((v,i)=>{const on=selected===v.id;return <Pressable key={v.id} accessibilityRole="button" accessibilityState={{selected:on}} style={({pressed})=>[s.listRow,i>0&&s.listRowBorder,pressed&&{opacity:0.7}]} onPress={()=>pickVehicle(v.id)}>
     <View style={[s.circle,on?{backgroundColor:c.night}:{backgroundColor:c.blue50}]}><Icon name="car-sport" size={18} color={on?'#fff':c.blue}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>{v.name}</Text><Text style={ui.caption}>{carLine(v)}</Text></View>
     {on?<Icon name="checkmark-circle" size={22} color={c.blue}/>:<View style={s.radio}/>}
    </Pressable>;})}
    {!vehicles.length&&<Text style={[ui.body,{paddingVertical:10}]}>No vehicles yet. Add your first one below.</Text>}
   </ScrollView>
   <AddVehicle onAdded={vehicleAdded}/>
  </Sheet>

  <Modal visible={carOpen} animationType="slide" onRequestClose={()=>setCarOpen(false)}>
   {carOpen?<CarReport vehicle={vehicle} report={report} live={snapshot.connected&&recorderVehicle===selected} car={car} onClose={()=>setCarOpen(false)} onSetKind={setKind}/>:null}
  </Modal>

  <Modal visible={!!tripView} animationType="slide" onRequestClose={()=>setTripView(null)}>
   {tripView?<TripDetail trip={tripView} vehicleId={selected} vehicleName={vehicle?.name} call={server.call} onClose={()=>setTripView(null)}/>:null}
  </Modal>
 </View>;
}

function AddVehicle({onAdded}:{onAdded:(list:any[],id?:string)=>void}){
 const [name,setName]=useState(''),[busy,run]=useAction(),off=busy||!name.trim();
 return <View style={[ui.row,{gap:10,marginTop:12}]}>
  <TextInput style={[ui.input,{flex:1,marginBottom:0}]} placeholder="New vehicle name" placeholderTextColor={c.faint} value={name} onChangeText={setName}/>
  <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle" disabled={off} onPress={()=>run(async()=>{const v=await server.call('/vehicles',{name});onAdded(await server.call('/vehicles'),v?.id);setName('');})} style={[s.send,off&&{opacity:0.4}]}><Icon name="add" size={22} color="#fff"/></Pressable>
 </View>;
}

const s=StyleSheet.create({
 screen:{flex:1,backgroundColor:c.bg},
 circle:{width:40,height:40,borderRadius:3,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontFamily:F[700],fontSize:15,color:c.ink},
 listRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},
 listRowBorder:{borderTopWidth:1,borderTopColor:c.line2},
 radio:{width:22,height:22,borderRadius:11,borderWidth:1.5,borderColor:c.faint},
 send:{width:48,height:48,borderRadius:3,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
});
