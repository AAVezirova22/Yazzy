import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppState,BackHandler,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScreenContainer} from 'react-native-screens';
import {StatusBar} from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {TripDetail} from '../components/TripDetail';
import {c,ui} from '../components/theme';
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
 const selectedRef=useRef(''),carRef=useRef<Car|null>(null),fresh=useRef<Record<string,number>>({}),inflight=useRef<{id:string;done:Promise<void>}|null>(null);
 selectedRef.current=selected;

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
  const sub=AppState.addEventListener('change',state=>{if(state==='active'){void refreshSnapshot();void refresh(false);}});
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

 const live=snapshot.recording&&snapshot.connected,speed=snapshot.signals.VEHICLE_SPEED;
 const recorder=useMemo(()=>({label:live?`Recording${speed!=null?` · ${speed} km/h`:''}`:snapshot.recording?'Waiting for your car':'Not recording',live,recording:snapshot.recording}),[live,speed,snapshot.recording]);

 if(mode===undefined)return <View style={{flex:1,backgroundColor:c.night}}><StatusBar style="light"/></View>;
 if(!mode)return <View style={{flex:1}}><StatusBar style="light"/><SignIn api={api} onConnected={boot}/></View>;

 const vehicle=vehicles.find(v=>v.id===selected),navBottom=Math.max(insets.bottom,10)+8,padBottom=navBottom+NAV_HEIGHT+28;
 const page=(key:TabKey)=>{switch(key){
  case 'Home':return <GarageTab vehicle={vehicle} car={car} refreshing={pulling} busy={refreshing} offline={offline} recorder={recorder} padBottom={padBottom} onRefresh={pullToRefresh} onSwitch={openGarage} onGo={go} onOpenTrip={setTripView}/>;
  case 'Trips':return <TripsTab vehicle={vehicle} trips={car?.trips??null} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onRefresh={pullToRefresh} onOpenTrip={setTripView}/>;
  case 'Health':return <HealthTab vehicle={vehicle} findings={car?.findings??null} service={car?.service??null} view={healthView} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onView={go} onRefresh={pullToRefresh}/>;
  case 'Drive':return <DriveTab vehicle={vehicle} selected={selected} api={api} snapshot={snapshot} view={driveView} padBottom={padBottom} onView={go} refreshSnapshot={refreshSnapshot}/>;
  case 'More':return <MoreTab vehicle={vehicle} vehicleCount={vehicles.length} selected={selected} api={api} padBottom={padBottom} onVehicles={openGarage} onConnected={boot} onDisconnected={disconnected}/>;
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
 circle:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 listRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},
 listRowBorder:{borderTopWidth:1,borderTopColor:c.line2},
 radio:{width:22,height:22,borderRadius:11,borderWidth:1.5,borderColor:c.faint},
 send:{width:48,height:48,borderRadius:24,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
});
