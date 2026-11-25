import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,BackHandler,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScreenContainer} from 'react-native-screens';
import {StatusBar} from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {TripDetail} from '../components/TripDetail';
import {c,ui,F,mono} from '../components/theme';
import {Button,Icon,Segment,useAction} from '../components/kit';
import {Sheet} from '../components/Sheet';
import {NavBar,NAV_HEIGHT,TabPane,TABS,type TabKey} from '../components/Tabs';
import {SignIn} from '../components/SignIn';
import {canUnlock,Lock,Welcome} from '../components/AccountGate';
import {BusinessDashboard} from '../components/BusinessDashboard';
import {CarLook} from '../components/CarLook';
import {loadLooks} from '../components/lookStore';
import {GarageTab} from '../components/tabs/Garage';
import {TripsTab} from '../components/tabs/Trips';
import {HealthTab} from '../components/tabs/Health';
import {DriveTab} from '../components/tabs/Drive';
import {MoreTab} from '../components/tabs/More';
import type {Car} from '../components/tabs/types';
import {CarReport} from '../components/CarReport';
import {carSpot,detect,makerFromVin,serverType,type CarProfile,type Kind} from '../components/car';
import {readCache,server,writeCache} from '../components/server';
import {carLine} from '../components/format';
import {available,Recorder,type RecorderSnapshot} from '../modules/yazzy-recorder/src';
import {loadLang,t,useLang} from '../components/i18n';
import {lookupVin} from '../components/vinCar';

const empty:RecorderSnapshot={recording:false,connected:false,queued:0,error:null,signals:{},qualification:'PENDING_DEVICE_TEST'};
// Fetched one after another: the free server has a tenth of a CPU, and trips come first because Home and Trips show them.
const PARTS:[Exclude<keyof Car,'vehicleId'>,string][]=[['trips','trips'],['fuel','fuel-report'],['findings','findings'],['service','maintenance-records'],['workOrders','work-orders']];
const blank=(id:string):Car=>({vehicleId:id,fuel:null,trips:null,findings:null,service:null,workOrders:null});
// Parts a server that predates them may not have: their absence is not a failed refresh.
const OPTIONAL=new Set(['workOrders']);
const STALE_MS=30000;
const quiet=(message:string)=>/[.!?]$/.test(message)?message:t("Couldn't refresh ({reason}).",{reason:message});

export default function App(){
 const insets=useSafeAreaInsets(),lang=useLang();
 // undefined while the saved connection is read (a few milliseconds, no network), null when this phone never connected.
 const [mode,setMode]=useState<'account'|'oidc'|null|undefined>(undefined),[locked,setLocked]=useState(false),[welcome,setWelcome]=useState(false),[businessOpen,setBusinessOpen]=useState(false),[lookOpen,setLookOpen]=useState(false),[session,setSession]=useState(0),[api,setApi]=useState(server.api);
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
  const id=active(list).find(v=>v.id===saved)?.id||active(list)[0]?.id||saved||'';
  fresh.current={};carRef.current=null;inflight.current=null;
  setApi(server.api);setVehicles(active(list));setCar(null);setSelected(id);setOffline('');setSession(n=>n+1);
  // The old shared login (before accounts) counts as signed out: the person creates an account, which keeps that garage.
  setMode(server.mode==='demo'?null:server.mode);
  setWelcome(server.mode==='account'&&await SecureStore.getItemAsync('yazzy-welcome').catch(()=>null)==='1');
 },[]);
 // Opening the app asks for the fingerprint or face; signing in with the password just now does not.
 const launch=useCallback(async()=>{
  await Promise.all([server.restore().catch(()=>null),loadLang(),loadLooks()]);
  if(server.mode==='account'&&await canUnlock())setLocked(true);
  await boot();
 },[boot]);
 // The saved language is read with the saved connection, before the first screen, so it never flashes the default.
 useEffect(()=>{void launch();},[]);
 const disconnected=useCallback(()=>{setMode(null);setLocked(false);setTab('Home');setVisited(['Home']);setVehicles([]);setSelected('');setCar(null);carRef.current=null;},[]);
 useEffect(()=>{server.onExpired(disconnected);return()=>server.onExpired(null);},[disconnected]);
 const openBusiness=useCallback(()=>setBusinessOpen(true),[]),openLook=useCallback(()=>setLookOpen(true),[]);
 const signOut=useCallback(()=>{void server.signOut().then(disconnected);},[disconnected]);
 const closeWelcome=useCallback(()=>{setWelcome(false);SecureStore.deleteItemAsync('yazzy-welcome').catch(()=>{});},[]);

 useEffect(()=>{
  if(!mode)return;
  let live=true;
  server.call('/vehicles').then((all:any[])=>{
   if(!live)return;
   const list=active(all);setVehicles(list);void writeCache('vehicles',list);
   const cur=selectedRef.current,id=list.some(v=>v.id===cur)?cur:(list[0]?.id||'');
   if(id!==cur){setSelected(id);if(id)SecureStore.setItemAsync('yazzy-vehicle',id).catch(()=>{});}
  }).catch(e=>{if(live)setOffline(quiet((e as Error).message));});
  return()=>{live=false;};
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
    catch(e){const message=(e as Error).message;if(OPTIONAL.has(key)&&/404/.test(message))continue;failure=message;if(/reach|in time/.test(failure))break;}
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
   if(!quiet)Alert.alert(t('Rebuilding trips'),t('Trips from the last 14 days are being rebuilt from the readings your car recorded. Pull down on Trips in a minute to see them.'));
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

 /** Replaces one part of the selected car's data (the service history, say) and keeps the phone's copy. */
 const patchCar=useCallback((id:string,change:(car:Car)=>Car)=>{
  const cur=carRef.current;if(!cur||cur.vehicleId!==id)return;
  const next=change(cur);carRef.current=next;setCar(next);void writeCache('car-'+id,next);
 },[]);
 const byDate=(a:any,b:any)=>(b.observedAt||0)-(a.observedAt||0);
 /** Adds a service to the history, or saves the changes to an existing one. */
 const saveService=useCallback(async(fields:Record<string,unknown>,recordId?:string)=>{
  const id=selectedRef.current;if(!id)return;
  const saved=recordId?await server.call(`/maintenance-records/${recordId}`,fields,'PUT'):await server.call(`/vehicles/${id}/maintenance-records`,fields);
  patchCar(id,cur=>({...cur,service:[saved,...(cur.service||[]).filter(r=>r.id!==saved.id)].sort(byDate)}));
 },[patchCar]);
 const deleteService=useCallback(async(record:any)=>{
  const id=selectedRef.current;if(!id)return;
  await server.call(`/maintenance-records/${record.id}`,undefined,'DELETE');
  patchCar(id,cur=>({...cur,service:(cur.service||[]).filter(r=>r.id!==record.id)}));
 },[patchCar]);
 /** Marks a planned task done or cancelled. A stale copy (changed elsewhere) is refetched once and tried again. */
 const setWorkOrder=useCallback(async(order:any,status:'COMPLETED'|'CANCELLED')=>{
  const id=selectedRef.current;if(!id)return;
  let updated;
  try{updated=await server.call(`/work-orders/${order.id}`,{version:order.version,status},'PATCH');}
  catch(e){
   if((e as Error).message!=='STALE_VERSION')throw e;
   const fresh=(await server.call(`/vehicles/${id}/work-orders`) as any[]).find(o=>o.id===order.id);if(!fresh)throw e;
   updated=await server.call(`/work-orders/${order.id}`,{version:fresh.version,status},'PATCH');
  }
  patchCar(id,cur=>({...cur,workOrders:(cur.workOrders||[]).map(o=>o.id===updated.id?updated:o)}));
 },[patchCar]);

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
  const next:TabKey=view==='Health'||view==='Service'?'Health':view==='Record'||view==='Connect'?'Drive':view as TabKey;
  if(view==='Health'||view==='Service')setHealthView(view);
  if(view==='Record'||view==='Connect')setDriveView(view);
  setTab(next);setVisited(v=>v.includes(next)?v:[...v,next]);
  if(next==='Home'||next==='Trips'||next==='Health')void refresh(false);
 },[refresh]);
 /** A task the advisor prepared was confirmed: bring the car's data up to date so it is listed in Health › Service. */
 const taskCreated=useCallback(()=>{void refresh(true);},[refresh]);
 const showService=useCallback(()=>go('Service'),[go]);
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
 const vehicleAdded=useCallback((all:any[],id?:string)=>{const list=active(all);setVehicles(list);void writeCache('vehicles',list);if(id)pickVehicle(id);},[pickVehicle]);
 /** Saves fields on a car, retrying once on a stale version, and puts the server's copy in the list. A removed (archived) car leaves the list. */
 const updateVehicle=useCallback(async(id:string,fields:Record<string,unknown>)=>{
  const save=(version:number)=>server.call(`/vehicles/${id}`,{...fields,version},'PATCH');
  let v=vehiclesRef.current.find(x=>x.id===id),updated;
  try{updated=await save(v?.version??1);}catch(e){if((e as Error).message!=='STALE_VERSION')throw e;v=await server.call(`/vehicles/${id}`);updated=await save(v.version);}
  const list=active(vehiclesRef.current.map(x=>x.id===id?updated:x));setVehicles(list);void writeCache('vehicles',list);
  if(selectedRef.current===id&&updated.archived){const next=list[0]?.id||'';setSelected(next);setCar(null);carRef.current=null;SecureStore.setItemAsync('yazzy-vehicle',next).catch(()=>{});}
 },[]);
 // A car's papers (plate, ГТП, insurance, vignette and fine checks) live on the vehicle; identity numbers do not.
 const saveDocuments=useCallback((documents:unknown)=>selectedRef.current?updateVehicle(selectedRef.current,{documents}):Promise.resolve(),[updateVehicle]);

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
  const key=JSON.stringify([next.vin,next.fuelType,next.ignition,next.mil,next.stored,next.pending,next.permanent,next.readiness,next.ecus,next.userKind,next.vinModel]);
  const last=pushed.current[id];
  if(!force&&last&&last.key===key&&Date.now()-last.at<900000)return;
  pushed.current[id]={key,at:Date.now()};
  const fields:Record<string,unknown>={profile:next},type=detect(next),odo=next.signals?.ODOMETER??next.odometerKm;
  if(type.kind)Object.assign(fields,serverType(type.kind,next));
  if(odo!=null)fields.odometerKm=Math.round(odo*10)/10;
  // The VIN names the car exactly, so its make, model and year replace whatever was there.
  const vm=next.vinModel,maker=makerFromVin(next.vin);if(vm&&vm.vin===next.vin&&vm.make){fields.make=vm.make;fields.model=vm.model;if(vm.year!=null)fields.year=vm.year;}
  else if(maker&&!vehiclesRef.current.find(x=>x.id===id)?.make)fields.make=maker;
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
 // Once the car has told us its VIN, look up its make, model and year, and whether there is a picture of that model.
 const vinTried=useRef<Record<string,boolean>>({});
 useEffect(()=>{
  const id=selected,vin=(report?.vin||'').trim().toUpperCase(),known=report?.vinModel,ecuYear=report?.ecuYear;
  if(!mode||!id||vin.length!==17)return;
  // Build 59 saved a European VIN's answer without asking for the year: ask again once.
  // A VIN without a year (European cars) takes the year the engine ECU was made, once the car has told it.
  const need=known?.vin!==vin||!known.status||known.status==='PENDING'||(known.manual&&known.status==='NONE')||(known.year==null&&!known.needsModel&&(known.needsYear===undefined||!!ecuYear));
  const tried=id+vin+(ecuYear||'');
  if(!need||vinTried.current[tried])return;
  vinTried.current[tried]=true;
  void(async()=>{
   try{
    const mine=known?.vin===vin&&known.manual?{make:known.make,model:known.model}:null;
    const vinModel=await lookupVin(vin,(known?.vin===vin?known.year:null)||ecuYear,mine);
    storeReport(id,{...(reports.current[id]||{}),vinModel:{...vinModel,years:vinModel.years||(known?.vin===vin?known.years:undefined)}},true);
   }catch{delete vinTried.current[tried];/* offline: try again next time the report changes */}
  })();
 },[mode,selected,report?.vin,report?.vinModel,report?.ecuYear]);
 // The owner's model year, for a VIN that has none: fetches that year's picture and saves the year on the car.
 const [yearOpen,setYearOpen]=useState(false),[yearBusy,runYear]=useAction();
 const pickYear=useCallback(()=>{setCarOpen(false);setYearOpen(true);},[]);
 const chooseYear=(year:number)=>runYear(async()=>{
  const id=selectedRef.current,vin=reports.current[id]?.vin;if(!id||!vin)return;
  const prev=reports.current[id]?.vinModel,vinModel=await lookupVin(vin.trim().toUpperCase(),year);
  storeReport(id,{...(reports.current[id]||{}),vinModel:{...vinModel,years:vinModel.years||prev?.years}},true);setYearOpen(false);
 });
 // A car that never gives its VIN over OBD: the owner types it; its model and picture are then looked up like any other VIN.
 const [vinOpen,setVinOpen]=useState(false),[vinText,setVinText]=useState('');
 const enterVin=useCallback(()=>{setVinText(reports.current[selectedRef.current]?.vin||'');setCarOpen(false);setVinOpen(true);},[]);
 const vinClean=vinText.replace(/\s/g,'').toUpperCase(),vinOk=/^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean);
 const saveVin=()=>{const id=selectedRef.current;if(!id||!vinOk)return;storeReport(id,{...(reports.current[id]||{}),vin:vinClean,vinManual:true,vinModel:null},true);setVinOpen(false);};
 // A VIN that names no model (most cars not sold in America): the owner picks the year and then the model from the catalog.
 const thisYear=new Date().getFullYear(),[modelOpen,setModelOpen]=useState(false),[modelYear,setModelYear]=useState(thisYear-5),[models,setModels]=useState<string[]|null>(null),[modelText,setModelText]=useState(''),[modelBusy,runModel]=useAction();
 const modelMake=report?.vinModel?.make||makerFromVin(report?.vin)||'';
 const pickModel=useCallback(()=>{const r=reports.current[selectedRef.current];setModelYear(r?.vinModel?.year||r?.ecuYear||new Date().getFullYear()-5);setModelText('');setCarOpen(false);setModelOpen(true);},[]);
 useEffect(()=>{
  if(!modelOpen||!modelMake){setModels(null);return;}
  let active=true;setModels(null);
  server.call(`/car-models?make=${encodeURIComponent(modelMake)}&year=${modelYear}`).then(r=>{if(active)setModels(Array.isArray(r?.models)?r.models:[]);}).catch(()=>{if(active)setModels([]);});
  return()=>{active=false;};
 },[modelOpen,modelMake,modelYear]);
 const chooseModel=(model:string)=>runModel(async()=>{
  const id=selectedRef.current,vin=reports.current[id]?.vin;if(!id||!vin||!model.trim())return;
  const answer=await lookupVin(vin.trim().toUpperCase(),modelYear,{make:modelMake,model:model.trim()});
  // What the owner picked always stands, whatever the picture service knows: the car is named by it even with no picture.
  const vinModel={...answer,make:answer.make||modelMake,model:answer.model||model.trim(),year:answer.year??modelYear,needsModel:false,manual:true};
  storeReport(id,{...(reports.current[id]||{}),vinModel},true);setModelOpen(false);
 });
 const setKind=useCallback((k:Kind|null)=>{const id=selectedRef.current;if(!id)return;storeReport(id,{...(reports.current[id]||{}),userKind:k},true);},[storeReport]);
 const openCar=useCallback(()=>setCarOpen(true),[]);
 // The car's last spot; keyed on the parked fix itself because the report object changes with every live reading.
 const spot=useMemo(()=>carSpot(report,car?.trips),[report?.parked?.latitude,report?.parked?.longitude,report?.parked?.at,car?.trips]);
 const carInfo=useMemo(()=>{const type=detect(report);return {label:type.label,kind:type.kind,mil:report?.mil,codes:(report?.stored||[]).length,read:!!report?.readAt,hasVin:!!report?.vin,maker:makerFromVin(report?.vin),
  vin:report?.vin||null,odometerKm:report?.signals?.ODOMETER??report?.odometerKm??null,fuelPct:report?.signals?.FUEL_LEVEL??null,readingsAt:report?.signalsAt??report?.readAt??null};},[report,lang]);

 const live=snapshot.recording&&snapshot.connected,speed=snapshot.signals.VEHICLE_SPEED;
 const recorder=useMemo(()=>({label:live?t('Recording')+(speed!=null?' · '+t('{n} km/h',{n:speed}):''):t(snapshot.recording?'Waiting for your car':'Not recording'),live,recording:snapshot.recording}),[live,speed,snapshot.recording,lang]);

 if(mode===undefined)return <View style={{flex:1,backgroundColor:c.bg}}><StatusBar style="dark"/></View>;
 if(!mode)return <View key={lang} style={{flex:1}}><StatusBar style="dark"/><SignIn api={api} onConnected={boot}/></View>;
 if(locked)return <View key={lang} style={{flex:1}}><StatusBar style="dark"/><Lock name={server.account?.name} onUnlocked={()=>setLocked(false)} onSignOut={signOut}/></View>;

 const business=vehicles.filter(v=>v.category==='BUSINESS').length;
 const vehicle=vehicles.find(v=>v.id===selected),navBottom=Math.max(insets.bottom,10)+8,padBottom=navBottom+NAV_HEIGHT+28;
 const page=(key:TabKey)=>{switch(key){
  case 'Home':return <GarageTab vehicle={vehicle} car={car} refreshing={pulling} busy={refreshing} offline={offline} recorder={recorder} padBottom={padBottom} onRefresh={pullToRefresh} onSwitch={openGarage} onGo={go} onOpenTrip={setTripView} carInfo={carInfo} onOpenCar={openCar} vinModel={report?.vinModel} onSetYear={pickYear} onEnterVin={enterVin} onPickModel={pickModel} business={business} onBusiness={openBusiness} onLook={openLook}/>;
  case 'Trips':return <TripsTab vehicle={vehicle} trips={car?.trips??null} spot={spot} live={snapshot.connected&&recorderVehicle===selected} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onRefresh={pullToRefresh} onOpenTrip={setTripView} onRebuild={rebuildNow}/>;
  case 'Health':return <HealthTab vehicle={vehicle} findings={car?.findings??null} service={car?.service??null} workOrders={car?.workOrders??null} trips={car?.trips??null} obdKm={carInfo.odometerKm} vinModel={report?.vinModel} view={healthView} refreshing={pulling} busy={refreshing} offline={offline} padBottom={padBottom} onView={go} onRefresh={pullToRefresh} onSaveService={saveService} onDeleteService={deleteService} onWorkOrder={setWorkOrder}/>;
  case 'Drive':return <DriveTab vehicle={vehicle} selected={selected} api={api} snapshot={snapshot} view={driveView} padBottom={padBottom} onView={go} refreshSnapshot={refreshSnapshot}/>;
  case 'More':return <MoreTab vehicle={vehicle} vehicleCount={vehicles.length} selected={selected} api={api} padBottom={padBottom} onVehicles={openGarage} onCar={openCar} onConnected={boot} onDisconnected={disconnected} onSignOut={signOut} business={business} onBusiness={openBusiness} onSaveDocuments={saveDocuments} onTask={taskCreated} onShowTask={showService}/>;
 }};

 return <View key={lang} style={s.screen}>
  <StatusBar style="dark"/>
  <ScreenContainer style={{flex:1}} hasTwoStates>
   {TABS.filter(x=>visited.includes(x.key)).map(x=><TabPane key={x.key} active={tab===x.key}>{page(x.key)}</TabPane>)}
  </ScreenContainer>
  <NavBar active={tab} onChange={go} bottom={navBottom} recording={snapshot.recording?(snapshot.connected?'live':'armed'):null}/>

  <Sheet open={garageOpen} onClose={closeGarage} title={t('Your vehicles')}>
   <ScrollView style={{maxHeight:300}}>
    {vehicles.map((v,i)=><VehicleRow key={v.id} vehicle={v} first={i===0} on={selected===v.id} onPick={pickVehicle} onUpdate={updateVehicle}/>)}
    {!vehicles.length&&<Text style={[ui.body,{paddingVertical:10}]}>{t('No vehicles yet. Add your first one below.')}</Text>}
   </ScrollView>
   <AddVehicle onAdded={vehicleAdded}/>
  </Sheet>

  <Sheet open={yearOpen} onClose={()=>setYearOpen(false)} title={t('Model year')}>
   <Text style={[ui.body,{marginBottom:12}]}>{t('This VIN does not say the year. Pick the model year from the registration document to show your car.')}</Text>
   <ScrollView style={{maxHeight:300}} contentContainerStyle={s.years}>
    {(report?.vinModel?.years||[]).map(y=>{const on=report?.vinModel?.year===y;return <Pressable key={y} accessibilityRole="button" accessibilityState={{selected:on}} disabled={yearBusy} onPress={()=>chooseYear(y)} style={({pressed})=>[s.year,on&&s.yearOn,(pressed||yearBusy)&&{opacity:0.6}]}><Text style={[s.yearText,on&&{color:'#fff'}]}>{y}</Text></Pressable>;})}
   </ScrollView>
  </Sheet>

  <Sheet open={vinOpen} onClose={()=>setVinOpen(false)} title={t('Vehicle identification number')}>
   <Text style={[ui.body,{marginBottom:12}]}>{t('Type the 17-character VIN from the registration document or the base of the windshield.')}</Text>
   <TextInput accessibilityLabel={t('VIN')} style={[ui.input,{fontFamily:mono,letterSpacing:1}]} value={vinText} onChangeText={setVinText} autoCapitalize="characters" autoCorrect={false} maxLength={20} placeholder="WVWZZZ1KZAM000000" placeholderTextColor={c.faint}/>
   {vinClean.length>0&&!vinOk?<Text style={[ui.caption,{marginBottom:10,color:c.amber}]}>{t('A VIN has 17 letters and digits, without I, O or Q.')}</Text>:null}
   <Button title={t('Save')} onPress={saveVin} disabled={!vinOk}/>
  </Sheet>

  <Sheet open={modelOpen} onClose={()=>setModelOpen(false)} title={t('Your model')}>
   <Text style={[ui.body,{marginBottom:12}]}>{t('This VIN does not say which {make} you have. Pick the year, then the model, from the registration document.',{make:modelMake})}</Text>
   <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingBottom:12}}>
    {Array.from({length:35},(_,i)=>thisYear-i).map(y=>{const on=modelYear===y;return <Pressable key={y} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>setModelYear(y)} style={[s.year,on&&s.yearOn]}><Text style={[s.yearText,on&&{color:'#fff'}]}>{y}</Text></Pressable>;})}
   </ScrollView>
   {models&&models.length?<ScrollView style={{maxHeight:260}}>
    {models.map(m=><Pressable key={m} accessibilityRole="button" disabled={modelBusy} onPress={()=>chooseModel(m)} style={({pressed})=>[s.modelRow,(pressed||modelBusy)&&{opacity:0.6}]}><Text style={ui.body}>{m}</Text><Icon name="chevron-forward" size={16} color={c.faint}/></Pressable>)}
   </ScrollView>
   :models?<View>
    <Text style={[ui.caption,{marginBottom:8}]}>{t('The catalog has no list for this year. Type the model instead.')}</Text>
    <TextInput accessibilityLabel={t('Model')} style={ui.input} value={modelText} onChangeText={setModelText} autoCorrect={false} placeholder={t('For example Jazz')} placeholderTextColor={c.faint}/>
    <Button title={t('Save')} onPress={()=>chooseModel(modelText)} disabled={modelBusy||!modelText.trim()}/>
   </View>
   :<Text style={ui.caption}>{t('Loading models…')}</Text>}
  </Sheet>

  <Modal visible={carOpen} animationType="slide" onRequestClose={()=>setCarOpen(false)}>
   {carOpen?<CarReport vehicle={vehicle} report={report} live={snapshot.connected&&recorderVehicle===selected} car={car} onClose={()=>setCarOpen(false)} onSetKind={setKind} onPickYear={pickYear} onEnterVin={enterVin} onPickModel={pickModel}/>:null}
  </Modal>

  <Modal visible={businessOpen} animationType="slide" onRequestClose={()=>setBusinessOpen(false)}>
   {businessOpen?<BusinessDashboard onClose={()=>setBusinessOpen(false)}/>:null}
  </Modal>

  <CarLook open={lookOpen} vinModel={report?.vinModel} onClose={()=>setLookOpen(false)}/>

  <Welcome open={welcome&&!locked} name={server.account?.name} onClose={closeWelcome} onConnect={()=>{closeWelcome();go('Connect');}}/>

  <Modal visible={!!tripView} animationType="slide" onRequestClose={()=>setTripView(null)}>
   {tripView?<TripDetail trip={tripView} vehicleId={selected} vehicleName={vehicle?.name} vinModel={report?.vinModel} call={server.call} onClose={()=>setTripView(null)}/>:null}
  </Modal>
 </View>;
}

/** One car in the garage sheet. The pencil turns the row into a name field with Save and Remove. */
function VehicleRow({vehicle:v,first,on,onPick,onUpdate}:{vehicle:any;first:boolean;on:boolean;onPick:(id:string)=>void;onUpdate:(id:string,fields:Record<string,unknown>)=>Promise<void>}){
 const [editing,setEditing]=useState(false),[name,setName]=useState(v.name),[busy,run]=useAction();
 const trimmed=name.trim(),canSave=!busy&&!!trimmed&&trimmed!==v.name;
 const remove=()=>Alert.alert(t('Remove {name}?',{name:v.name}),t('The car leaves your garage on every phone. Its trips and readings stay saved on the server.'),[
  {text:t('Cancel'),style:'cancel'},
  {text:t('Remove'),style:'destructive',onPress:()=>{void run(()=>onUpdate(v.id,{archived:true}));}},
 ]);
 if(editing)return <View style={[!first&&s.listRowBorder,{paddingVertical:12,gap:10}]}>
  <View style={[ui.row,{gap:10}]}>
  <TextInput style={[ui.input,{flex:1,marginBottom:0}]} value={name} onChangeText={setName} autoFocus maxLength={100} placeholder={t('Vehicle name')} placeholderTextColor={c.faint}
   returnKeyType="done" onSubmitEditing={()=>{if(canSave)void run(async()=>{await onUpdate(v.id,{name:trimmed});setEditing(false);});}}/>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Save')} disabled={!canSave} hitSlop={6} onPress={()=>run(async()=>{await onUpdate(v.id,{name:trimmed});setEditing(false);})} style={[s.send,!canSave&&{opacity:0.4}]}><Icon name="checkmark" size={22} color="#fff"/></Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Remove')} disabled={busy} hitSlop={6} onPress={remove} style={[s.send,{backgroundColor:c.red}]}><Icon name="trash-outline" size={20} color="#fff"/></Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel')} hitSlop={6} onPress={()=>{setName(v.name);setEditing(false);}} style={s.iconButton}><Icon name="close" size={22} color={c.muted}/></Pressable>
  </View>
  {/* The group saves at once: Business cars appear on the Business dashboard. */}
  <Segment items={[['PERSONAL',t('Personal')],['BUSINESS',t('Business')]]} value={v.category||'PERSONAL'} onChange={category=>{if(category!==(v.category||'PERSONAL'))void run(()=>onUpdate(v.id,{category}));}}/>
 </View>;
 return <View style={[s.listRow,!first&&s.listRowBorder]}>
  <Pressable accessibilityRole="button" accessibilityState={{selected:on}} style={({pressed})=>[{flex:1,flexDirection:'row',alignItems:'center',gap:12},pressed&&{opacity:0.7}]} onPress={()=>onPick(v.id)}>
   <View style={[s.circle,on?{backgroundColor:c.blue}:{backgroundColor:c.blue50}]}><Icon name="car-sport" size={18} color={on?'#fff':c.blue}/></View>
   <View style={{flex:1}}><Text style={s.rowTitle}>{v.name}</Text><Text style={ui.caption}>{[carLine(v),v.category==='BUSINESS'?t('Business'):null].filter(Boolean).join(' · ')}</Text></View>
   {on?<Icon name="checkmark-circle" size={22} color={c.blue}/>:<View style={s.radio}/>}
  </Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Rename or remove {name}',{name:v.name})} hitSlop={6} onPress={()=>{setName(v.name);setEditing(true);}} style={s.iconButton}><Icon name="create-outline" size={20} color={c.muted}/></Pressable>
 </View>;
}

/** Cars the user removed are archived on the server and never shown. */
const active=(list:any[]|null|undefined)=>(list||[]).filter(v=>!v.archived);

function AddVehicle({onAdded}:{onAdded:(list:any[],id?:string)=>void}){
 const [name,setName]=useState(''),[category,setCategory]=useState('PERSONAL'),[busy,run]=useAction(),off=busy||!name.trim();
 const add=()=>run(async()=>{const v=await server.call('/vehicles',{name:name.trim(),category});onAdded(await server.call('/vehicles'),v?.id);setName('');});
 return <View style={{marginTop:12,gap:10}}>
  <Segment items={[['PERSONAL',t('Personal')],['BUSINESS',t('Business')]]} value={category} onChange={setCategory}/>
  <View style={[ui.row,{gap:10}]}>
   <TextInput style={[ui.input,{flex:1,marginBottom:0}]} placeholder={t('New vehicle name')} placeholderTextColor={c.faint} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={()=>{if(!off)add();}}/>
   <Pressable accessibilityRole="button" accessibilityLabel={t('Add vehicle')} disabled={off} onPress={add} style={[s.send,off&&{opacity:0.4}]}><Icon name="add" size={22} color="#fff"/></Pressable>
  </View>
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
 iconButton:{width:44,height:44,alignItems:'center',justifyContent:'center'},
 years:{flexDirection:'row',flexWrap:'wrap',gap:8,paddingBottom:8},
 modelRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line2},
 year:{width:76,height:44,borderRadius:3,borderWidth:1,borderColor:c.line,alignItems:'center',justifyContent:'center',backgroundColor:c.surface},
 yearOn:{backgroundColor:c.blue,borderColor:c.blue},
 yearText:{fontFamily:F[700],fontSize:15,color:c.ink,fontVariant:['tabular-nums']},
});
