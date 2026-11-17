import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,Modal,Platform,PermissionsAndroid,Pressable,ScrollView,StyleSheet,Text,TextInput,useWindowDimensions,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {TripDetail,distance,minutes} from '../components/TripDetail';
import {Updater} from '../components/Updater';
import {c,mono,shadow,ui} from '../components/theme';
import {Button,Check,Empty,Icon,Notice,RoundButton,ScreenHeader,Segment,Stat} from '../components/kit';
import {CarArt,RouteArt,WeekBars} from '../components/art';
import {available,Recorder,knownChannels,pickChannels,type Peripheral,type Characteristic,type RecorderSnapshot} from '../modules/yazzy-recorder/src';
WebBrowser.maybeCompleteAuthSession();
const defaultApi=process.env.EXPO_PUBLIC_API_URL||'http://localhost:8000';
const issuer=(process.env.EXPO_PUBLIC_OIDC_ISSUER||'').trim();
const clientId=process.env.EXPO_PUBLIC_OIDC_CLIENT_ID||'yazzy-mobile';
const empty:RecorderSnapshot={recording:false,connected:false,queued:0,error:null,signals:{},qualification:'PENDING_DEVICE_TEST'};

// Bottom tabs group the original views: Home=Garage, Health=Health+Service, Drive=Record+Connect, More=Advisor.
const TABS:{key:string;icon:string;views:string[]}[]=[
 {key:'Home',icon:'home',views:['Garage']},
 {key:'Trips',icon:'map',views:['Trips']},
 {key:'Health',icon:'pulse',views:['Health','Service']},
 {key:'Drive',icon:'speedometer',views:['Record','Connect']},
 {key:'More',icon:'grid',views:['Advisor']},
];
const fmt=(value:number|null|undefined,digits=1)=>value==null||Number.isNaN(value)?'—':value.toFixed(digits);
const day=(t:number)=>new Date(t*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const weekday=(t:number)=>new Date(t*1000).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
const clock=(t:number)=>new Date(t*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
const ago=(t:number)=>{const d=Math.floor((Date.now()/1000-t)/86400);return d<=0?'Today':d===1?'Yesterday':`${d} days ago`;};
const latest=(list:any[]|null|undefined,key:string)=>(list||[]).reduce((a:any,x:any)=>!a||x[key]>a[key]?x:a,null);
const greeting=()=>{const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';};
const PAGE=20;
const routeOf=(t:any)=>(t?.status==='STATIONARY'||(t?.metrics?.route||[]).length<2?[]:t.metrics.route) as {latitude:number;longitude:number}[];
const pretty=(v:unknown)=>String(v||'').replaceAll('_',' ').toLowerCase();
/** Kilometres driven on each of the last seven days, today last. */
function lastWeek(trips:any[]|null|undefined){
 const out=new Array(7).fill(0),today=new Date();today.setHours(0,0,0,0);
 for(const t of trips||[]){if(t.startAt==null||!t.metrics?.distanceKm)continue;const d=new Date(t.startAt*1000);d.setHours(0,0,0,0);const back=Math.round((today.getTime()-d.getTime())/86400000);if(back>=0&&back<7)out[6-back]+=t.metrics.distanceKm;}
 return out;
}

export default function Home(){
 const [api,setApi]=useState(defaultApi),[token,setToken]=useState(''),[csrf,setCsrf]=useState(''),[vehicles,setVehicles]=useState<any[]>([]),[selected,setSelected]=useState(''),[view,setView]=useState('Garage'),[snapshot,setSnapshot]=useState(empty),[peripherals,setPeripherals]=useState<Peripheral[]>([]),[peripheral,setPeripheral]=useState(''),[characteristics,setCharacteristics]=useState<Characteristic[]>([]),[write,setWrite]=useState<Characteristic|null>(null),[notify,setNotify]=useState<Characteristic|null>(null),[data,setData]=useState<any[]>([]),[message,setMessage]=useState(''),[answer,setAnswer]=useState<any>(null),[busy,setBusy]=useState(false),[name,setName]=useState(''),[tripView,setTripView]=useState<any>(null),[garageOpen,setGarageOpen]=useState(false),[shown,setShown]=useState(PAGE);
 const [discovery,setDiscovery]=useState<AuthSession.DiscoveryDocument|null>(null),[authError,setAuthError]=useState(''),[accessPassword,setAccessPassword]=useState('');
 const [summary,setSummary]=useState<{vehicleId:string;fuel:any;trips:any[]|null;findings:any[]|null;service:any[]|null}|null>(null);
 const insets=useSafeAreaInsets(),{width}=useWindowDimensions();
 useEffect(()=>{
  // useAutoDiscovery rejects null, so discovery is optional in local sandbox mode.
  if(!issuer)return;
  let active=true;
  async function discover(){
   try{
    const document=await AuthSession.fetchDiscoveryAsync(issuer);
    if(!document.authorizationEndpoint||!document.tokenEndpoint)throw new Error('The sign-in provider is missing its authorization or token endpoint.');
    if(active)setDiscovery(document);
   }catch{
    if(active)setAuthError('Secure sign-in is unavailable. Check your sign-in configuration and connection, then reload the app.');
   }
  }
  void discover();
  return()=>{active=false;};
 },[]);
 const [request,response,promptAsync]=AuthSession.useAuthRequest({clientId,redirectUri:AuthSession.makeRedirectUri({scheme:'yazzy'}),scopes:['openid','profile','offline_access'],usePKCE:true},discovery);
 async function sandboxLogin(){const saved=accessPassword||await SecureStore.getItemAsync('yazzy-access-password')||'';const r=await fetch(api+'/api/v1/auth/demo?mode=personal',{method:'POST',credentials:'include',headers:saved?{'X-Access-Password':saved}:{}});const data=await r.json().catch(()=>({}));if(r.status===401)throw new Error('Incorrect access password');if(!r.ok)throw new Error('Demo login is disabled on this server');if(saved)await SecureStore.setItemAsync('yazzy-access-password',saved);setCsrf(data.csrfToken);setToken('LOCAL_DEMO');await SecureStore.setItemAsync('yazzy-sandbox','1');return data.csrfToken as string;}
 async function call(path:string,body?:unknown){const send=(token_csrf:string)=>fetch(api+'/api/v1'+path,{method:body?'POST':'GET',credentials:'include',headers:{...(token==='LOCAL_DEMO'?{'X-CSRF-Token':token_csrf}:{Authorization:'Bearer '+token}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let r=await send(csrf);if(r.status===401&&token==='LOCAL_DEMO')r=await send(await sandboxLogin());const value=await r.json();if(!r.ok)throw new Error(value.detail?.code||'Request failed');return value;}
 async function perform(fn:()=>Promise<void>){setBusy(true);try{await fn()}catch(e){Alert.alert('Yazzy',(e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{(async()=>{const v=await SecureStore.getItemAsync('yazzy-access');if(v){setToken(v);return;}if(await SecureStore.getItemAsync('yazzy-sandbox')==='1')await sandboxLogin();})().catch(()=>{});},[]);
 // Restore the adapter and the write/notify choice from the last session so they never have to be picked again.
 useEffect(()=>{SecureStore.getItemAsync('yazzy-adapter').then(v=>{if(!v)return;const a=JSON.parse(v);setPeripheral(a.peripheral.id);setPeripherals([{...a.peripheral,rssi:0}]);setCharacteristics(a.characteristics);
  // A pair saved before OBD channels were recognised may be the chip's vendor service, which never answers; prefer a known channel.
  const k=knownChannels(a.characteristics||[]);setWrite(k?.write||a.write);setNotify(k?.notify||a.notify);}).catch(()=>{});},[]);
 useEffect(()=>{if(!peripheral||!write||!notify)return;const p=peripherals.find(x=>x.id===peripheral);if(p)SecureStore.setItemAsync('yazzy-adapter',JSON.stringify({peripheral:p,characteristics,write,notify})).catch(()=>{});},[peripheral,write,notify]);
 useEffect(()=>{if(response?.type==='success'&&discovery)perform(async()=>{const t=await AuthSession.exchangeCodeAsync({clientId,code:response.params.code,redirectUri:AuthSession.makeRedirectUri({scheme:'yazzy'}),extraParams:{code_verifier:request?.codeVerifier||''}},discovery);await SecureStore.setItemAsync('yazzy-access',t.accessToken);if(t.refreshToken)await SecureStore.setItemAsync('yazzy-refresh',t.refreshToken);setToken(t.accessToken);});},[response]);
 useEffect(()=>{if(token)perform(async()=>{const v=await call('/vehicles');setVehicles(v);const saved=await SecureStore.getItemAsync('yazzy-vehicle');const pick=v.find((x:any)=>x.id===saved)||v[0];if(pick)setSelected(pick.id);});},[token]);
 useEffect(()=>{if(selected&&['Trips','Health','Service'].includes(view))load(view);},[selected]);
 // Recorder status: re-render only when it actually changed, poll slowly when idle and not at all in the background.
 // Polling every 1.5 s and re-rendering each time made the whole app lag on low-end phones.
 const snapKey=useRef('');
 const refreshSnapshot=useCallback(()=>available?Recorder.snapshot().then(next=>{const key=JSON.stringify(next);if(key!==snapKey.current){snapKey.current=key;setSnapshot(next);}}).catch(()=>{}):Promise.resolve(),[]);
 useEffect(()=>{
  if(!available)return;
  let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
  const tick=async()=>{if(AppState.currentState==='active')await refreshSnapshot();if(!stopped)timer=setTimeout(tick,snapKey.current.includes('"recording":true')?1500:4000);};
  void tick();
  const sub=AppState.addEventListener('change',state=>{if(state==='active')void refreshSnapshot();});
  return()=>{stopped=true;clearTimeout(timer);sub.remove();};
 },[]);
 // Home tiles: one quiet, sequential refresh of the selected car's fuel, trips, findings and service records,
 // skipped when the same car was refreshed in the last 30 seconds (switching tabs no longer refetches everything).
 const summaryAt=useRef({vehicleId:'',at:0});
 useEffect(()=>{
  if(!token||!selected||view!=='Garage')return;
  if(summaryAt.current.vehicleId===selected&&Date.now()-summaryAt.current.at<30000)return;
  let active=true;
  (async()=>{
   const get=(path:string)=>call(`/vehicles/${selected}/${path}`).catch(()=>null);
   const fuel=await get('fuel-report'),trips=await get('trips'),findings=await get('findings'),service=await get('maintenance-records');
   if(active){summaryAt.current={vehicleId:selected,at:Date.now()};setSummary({vehicleId:selected,fuel,trips,findings,service});}
  })();
  return()=>{active=false;};
 },[token,selected,view]);
 async function load(tab:string){
  // Show the trips Home already has straight away, then refresh them.
  if(tab!==view&&['Trips','Health','Service'].includes(tab))setData(tab==='Trips'&&summary?.vehicleId===selected&&summary.trips?summary.trips:[]);
  if(tab==='Trips')setShown(PAGE);
  setView(tab);if(!selected)return;
  if(['Trips','Health','Service'].includes(tab))await perform(async()=>setData(await call(`/vehicles/${selected}/${tab==='Trips'?'trips':tab==='Health'?'findings':'maintenance-records'}`)));
 }
 async function permissions(){if(Platform.OS==='android'){await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,...(Number(Platform.Version)>=33?[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]:[])]);}}
 async function start(){const key=JSON.stringify([selected,peripheral,write?.service,write?.uuid,notify?.service,notify?.uuid]);if(snapshot.configured&&(!(write&&notify&&peripheral)||await SecureStore.getItemAsync('yazzy-configured')===key)){await permissions();await Recorder.start();return;}if(!token)throw new Error('Not signed in. On the Home tab, open the personal sandbox (or sign in) first.');if(!selected)throw new Error('No vehicle selected. On Home, tap the switch button and pick or add a vehicle.');if(!peripheral)throw new Error('No adapter selected. On Drive › Adapter, scan and tap your adapter.');if(!write||!notify)throw new Error('Pick one write and one notify characteristic from the same service on Drive › Adapter.');if(write.service!==notify.service)throw new Error('Write and notify must come from the same service. Re-pick them on Drive › Adapter.');const saved=await SecureStore.getItemAsync('collector-'+selected);const enrol=saved?JSON.parse(saved):await call('/devices/enrolments',{vehicleId:selected});await SecureStore.setItemAsync('collector-'+selected,JSON.stringify(enrol));await Recorder.configure({apiUrl:api,deviceId:enrol.deviceId,assignmentId:enrol.assignmentId,deviceToken:enrol.deviceToken,peripheralId:peripheral,serviceUuid:write.service,writeUuid:write.uuid,notifyUuid:notify.uuid});await SecureStore.setItemAsync('yazzy-configured',key);await permissions();await Recorder.start();}

 const vehicle=vehicles.find((x:any)=>x.id===selected);
 const tab=TABS.find(t=>t.views.includes(view))||TABS[0];
 const sum=summary&&summary.vehicleId===selected?summary:null;
 const lastTrip=latest(sum?.trips,'startAt'),lastService=latest(sum?.service,'observedAt'),findingCount=sum?.findings?.length??0;
 const week=useMemo(()=>lastWeek(sum?.trips),[sum?.trips]),weekKm=week.reduce((a,b)=>a+b,0);
 const live=snapshot.recording&&snapshot.connected;
 const recorderLabel=live?`Recording${snapshot.signals.VEHICLE_SPEED!=null?` · ${snapshot.signals.VEHICLE_SPEED} km/h`:''}`:snapshot.recording?'Waiting for your car':'Not recording';
 const recommended=pickChannels(characteristics);
 const ready={signedIn:!!token,vehicle:!!selected,adapter:!!peripheral,channels:!!(write&&notify)};
 const dark=view==='Garage';
 const carWidth=Math.min(width-24,380);
 const pickVehicle=(id:string)=>{setSelected(id);SecureStore.setItemAsync('yazzy-vehicle',id).catch(()=>{});setGarageOpen(false);};

 const signIn=<View style={ui.card}>
  <Text style={ui.title}>Sign in</Text>
  <Text style={[ui.body,{marginTop:4,marginBottom:16}]}>Connect to your Yazzy server to see your garage.</Text>
  <Text style={s.fieldLabel}>Server</Text>
  <TextInput accessibilityLabel="API address" style={ui.input} value={api} onChangeText={setApi} autoCapitalize="none"/>
  <Text style={s.fieldLabel}>Access password</Text>
  <TextInput accessibilityLabel="Access password" placeholder="Needed for hosted servers" placeholderTextColor={c.faint} style={ui.input} value={accessPassword} onChangeText={setAccessPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry/>
  <Button title="Open my garage" icon="arrow-forward" onPress={()=>perform(async()=>{await sandboxLogin();})}/>
  {issuer?<Button kind="light" title="Sign in securely" icon="shield-checkmark-outline" disabled={!discovery||!request||busy} onPress={()=>perform(async()=>{await promptAsync();})}/>:null}
  {authError?<Text accessibilityRole="alert" style={[ui.body,{color:c.red,marginTop:8}]}>{authError}</Text>:null}
 </View>;

 const statusPill=<Pressable accessibilityRole="button" accessibilityLabel={`Recorder: ${recorderLabel}. Open Drive`} onPress={()=>load('Record')} style={s.statusPill}>
  <View style={[s.dot,{backgroundColor:live?'#4ade80':snapshot.recording?c.blue300:c.nightMuted}]}/>
  <Text style={s.statusText}>{recorderLabel}</Text>
  <Icon name="chevron-forward" size={13} color={c.nightMuted}/>
 </Pressable>;

 return <View style={s.screen}>
  <StatusBar style={dark?'light':'dark'}/>
  <ScrollView contentContainerStyle={{paddingBottom:(token?110:30)+insets.bottom}} keyboardShouldPersistTaps="handled">

  {view==='Garage'&&!token&&<>
   <View style={[s.top,{paddingTop:insets.top+18,paddingBottom:96}]}>
    <Text style={s.wordmark}>yazzy</Text>
    <Text style={s.topTitle}>Your car,{'\n'}in context.</Text>
    <Text style={s.topText}>Trips, fuel and health from your own OBD adapter.</Text>
   </View>
   <View style={[s.car,{marginTop:-(carWidth*0.4)+40}]}><CarArt width={carWidth}/></View>
   <View style={s.pad}>{signIn}</View>
  </>}

  {view==='Garage'&&!!token&&<>
   <View style={[s.top,{paddingTop:insets.top+16,paddingBottom:vehicle?92:28}]}>
    <View style={[ui.row,{alignItems:'flex-start',gap:12}]}>
     <View style={{flex:1}}>
      <Text style={s.greet}>{greeting()}</Text>
      <Text style={s.topTitle} numberOfLines={2}>{vehicle?vehicle.name:'Your garage'}</Text>
      <Text style={s.topText} numberOfLines={1}>{vehicle?([vehicle.make,vehicle.model,vehicle.year].filter(Boolean).join(' ')||(vehicle.origin==='REAL'?'Personal vehicle':pretty(vehicle.origin))):'Add your first vehicle to begin'}</Text>
     </View>
     {busy?<ActivityIndicator color="#fff" style={{marginTop:12}}/>:null}
     <RoundButton dark icon="swap-horizontal" label="Switch or add vehicle" onPress={()=>setGarageOpen(true)}/>
    </View>
    {vehicle?<View style={{marginTop:16,alignItems:'flex-start'}}>{statusPill}</View>:null}
   </View>
   {vehicle?<View style={[s.car,{marginTop:-(carWidth*0.4)+34}]}><CarArt width={carWidth}/></View>:null}
   <View style={[s.pad,{paddingTop:vehicle?4:20}]}>
    <Updater api={api} call={call} token={token}/>
    {!vehicle?<View style={ui.card}>
     <Text style={ui.title}>No vehicle yet</Text>
     <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Add your car to start recording trips, fuel and health.</Text>
     <Button title="Add a vehicle" icon="add" onPress={()=>setGarageOpen(true)}/>
    </View>:<>
     <View style={s.tiles}>
      <Stat title="Distance" icon="trending-up" value={fmt(sum?.fuel?.distanceKm,0)} unit="km" caption={sum?.fuel?.tripCount?`${fmt(weekKm)} km this week · ${sum.fuel.tripCount} trips`:'No trips yet'} onPress={()=>load('Trips')} style={{flex:1}}>
       <WeekBars values={week}/>
      </Stat>
      <View style={{flex:1,gap:12}}>
       <Stat title="Fuel" icon="water" value={sum?.fuel?.litresPer100Km!=null?fmt(sum.fuel.litresPer100Km):fmt(sum?.fuel?.fuelLitres)} unit={sum?.fuel?.litresPer100Km!=null?'L/100':'L'} caption={sum?.fuel?.litresPer100Km!=null?'Average use':'Used on trips'} onPress={()=>load('Trips')}/>
       <Stat title="Health" icon="pulse" tone={sum?findingCount?'warn':'ok':undefined} value={!sum?'—':findingCount?String(findingCount):'All clear'} unit={findingCount?'to review':undefined} caption={findingCount?'Evidence-backed':'No findings'} onPress={()=>load('Health')}/>
      </View>
     </View>
     <View style={[ui.card,s.tripCard]}>
      <View style={{flex:1,paddingRight:12}}>
       <Text style={ui.title}>Last trip</Text>
       <Text style={[ui.caption,{marginTop:2}]}>{lastTrip?`${weekday(lastTrip.startAt)} · ${clock(lastTrip.startAt)}`:'No recorded journeys yet'}</Text>
       <Text style={[ui.value,{marginTop:12}]}>{lastTrip?distance(lastTrip.metrics?.distanceKm):'—'}</Text>
       <Text style={ui.caption}>{lastTrip?minutes(lastTrip.metrics?.durationSeconds||0):'Start a drive from the Drive tab'}</Text>
       <Button title={lastTrip?'View trip':'Start a drive'} icon={lastTrip?'navigate':'play'} onPress={()=>lastTrip?setTripView(lastTrip):load('Record')} style={{marginTop:14,minHeight:44,alignSelf:'flex-start',paddingHorizontal:16}}/>
      </View>
      {routeOf(lastTrip).length?<RouteArt route={routeOf(lastTrip)} style={s.tripThumb} stroke={3.5}/>
       :<View style={[s.tripThumb,{alignItems:'center',justifyContent:'center'}]}><Icon name="map-outline" size={30} color={c.faint}/></View>}
     </View>
     <Pressable accessibilityRole="button" onPress={()=>load('Service')} style={({pressed})=>[ui.card,s.rowCard,pressed&&{opacity:0.9}]}>
      <View style={[s.circle,{backgroundColor:c.green50}]}><Icon name="construct" size={18} color={c.green}/></View>
      <View style={{flex:1}}><Text style={s.rowTitle}>Service</Text><Text style={ui.caption} numberOfLines={1}>{lastService?`${lastService.description} · ${ago(lastService.observedAt)}`:'No maintenance records yet'}</Text></View>
      <Icon name="chevron-forward" size={16} color={c.ink}/>
     </Pressable>
    </>}
   </View>
  </>}

  {view!=='Garage'&&<View style={[s.pad,{paddingTop:insets.top+8}]}>
   {tab.key==='Trips'&&<ScreenHeader title="Trips" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy?<ActivityIndicator color={c.blue}/>:<RoundButton icon="refresh" label="Refresh trips" onPress={()=>load('Trips')}/>}/>}
   {tab.key==='Health'&&<><ScreenHeader title="Health" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy?<ActivityIndicator color={c.blue}/>:null}/><Segment items={[['Health','Findings'],['Service','Service']]} value={view} onChange={v=>load(v)}/></>}
   {tab.key==='Drive'&&<><ScreenHeader title="Drive" subtitle={vehicle?vehicle.name:'No vehicle selected'} right={busy?<ActivityIndicator color={c.blue}/>:null}/><Segment items={[['Record','Record'],['Connect','Adapter']]} value={view} onChange={v=>load(v)}/></>}
   {tab.key==='More'&&<ScreenHeader title="More"/>}

   {['Trips','Health','Service'].includes(view)&&!data.length&&!busy&&<Empty icon={view==='Trips'?'map-outline':view==='Health'?'pulse-outline':'construct-outline'} title={view==='Health'?'No findings':'Nothing here yet'} text={view==='Trips'?'Recorded drives appear here with their route.':view==='Health'?'No persistent change in the readings your car supports.':'Maintenance records you add appear here.'}/>}

   {view==='Trips'&&data.slice(0,shown).map(d=><TripRow key={d.id} trip={d} onOpen={setTripView}/>)}
   {view==='Trips'&&data.length>shown&&<Button kind="light" title={`Show ${Math.min(PAGE,data.length-shown)} more`} icon="chevron-down" onPress={()=>setShown(n=>n+PAGE)}/>}

   {view==='Health'&&data.map(d=><View key={d.id} style={ui.card}>
    <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
     <View style={[s.circle,{backgroundColor:c.amber50}]}><Icon name="warning" size={18} color={c.amber}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>{d.summary||d.description}</Text><Text style={[ui.caption,{marginTop:2,textTransform:'capitalize'}]}>{pretty(d.status)}{d.origin?` · ${pretty(d.origin)}`:''}</Text></View>
    </View>
    {d.evidence&&<View style={s.nextStep}><Text style={s.nextLabel}>Recommended next step</Text><Text style={[ui.body,{color:c.ink2}]}>{d.evidence.recommendedNextStep}</Text></View>}
    {d.evidence&&<Text style={ui.caption}>Exact failed part and failure date unavailable.</Text>}
   </View>)}

   {view==='Service'&&data.map((d,i)=><View key={d.id} style={s.timeline}>
    <View style={{alignItems:'center'}}><View style={[s.circle,{backgroundColor:c.green50,width:36,height:36}]}><Icon name="checkmark" size={17} color={c.green}/></View>{i<data.length-1?<View style={s.timeLine}/>:null}</View>
    <View style={[ui.card,{flex:1,marginBottom:12,padding:14}]}>
     <Text style={s.rowTitle}>{d.description||d.summary}</Text>
     <Text style={[ui.caption,{marginTop:2}]}>{d.observedAt?`${day(d.observedAt)} · ${ago(d.observedAt)}`:''}{d.actualCost!=null?` · ${d.currency||''} ${fmt(d.actualCost,2)}`:''}</Text>
    </View>
   </View>)}

   {view==='Record'&&<>
    <View style={s.live}>
     <View style={[ui.row,{justifyContent:'space-between'}]}>
      <View style={s.statusPill}><View style={[s.dot,{backgroundColor:live?'#4ade80':snapshot.recording?c.blue300:c.nightMuted}]}/><Text style={s.statusText}>{live?'Recording':snapshot.recording?'Armed':'Ready when you are'}</Text></View>
      <Icon name="bluetooth" size={18} color={snapshot.connected?c.blue300:c.nightMuted}/>
     </View>
     <View style={s.liveNumbers}>
      <View style={{flex:1.3}}><Text style={s.liveValue}>{snapshot.signals.VEHICLE_SPEED??'—'}</Text><Text style={s.liveUnit}>km/h</Text></View>
      <View style={s.liveDivider}/>
      <View style={{flex:1,paddingLeft:18}}><Text style={[s.liveValue,{fontSize:34}]}>{snapshot.signals.ENGINE_RPM??'—'}</Text><Text style={s.liveUnit}>rpm</Text></View>
     </View>
     <View style={[ui.row,{gap:18,flexWrap:'wrap'}]}>
      <Text style={s.liveMeta}>{snapshot.connected?'Adapter connected':'Adapter not connected'}</Text>
      <Text style={s.liveMeta}>{snapshot.queued} waiting to upload</Text>
     </View>
    </View>
    {snapshot.error?<Notice tone="error">{snapshot.error}</Notice>:null}
    {snapshot.recording&&!snapshot.connected&&<Notice icon="time">Waiting for your adapter. Turn the car on and it connects by itself, even with the app closed. Each start of the car begins a new trip.</Notice>}
    {snapshot.recording?<Button kind="dark" title={snapshot.connected?'Stop recording':'Disarm auto-connect'} icon="stop" onPress={()=>perform(async()=>{await Recorder.stop();await refreshSnapshot();})}/>
     :<Button title={snapshot.configured&&!(write&&notify&&peripheral)?'Start with saved adapter':'Start recording'} icon="play" onPress={()=>perform(async()=>{await start();await refreshSnapshot();})}/>}
    <Button kind="light" title="Upload now" icon="cloud-upload-outline" onPress={()=>perform(()=>Recorder.sync())}/>
    <View style={[ui.card,{marginTop:12}]}>
     <Text style={[ui.title,{marginBottom:4}]}>Before you drive</Text>
     <Check ok={ready.signedIn} label="Signed in"/>
     <Check ok={ready.vehicle} label={vehicle?`Vehicle · ${vehicle.name}`:'Vehicle selected'}/>
     <Check ok={ready.adapter} label="Adapter chosen"/>
     <Check ok={ready.channels} label="Data channel selected"/>
    </View>
    <Text style={s.note}>Don't use the app while driving. Android may stop background recording; anything not yet uploaded stays on the phone.</Text>
   </>}

   {view==='Connect'&&<>
    <View style={ui.card}>
     <Text style={ui.title}>Find your adapter</Text>
     <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Plug the adapter in, close other OBD apps and scan while parked.</Text>
     <Button title="Scan for adapters" icon="bluetooth" onPress={()=>perform(async()=>{await permissions();setPeripherals(await Recorder.discover());})}/>
    </View>
    {peripherals.length>0&&<View style={[ui.card,{paddingVertical:6}]}>{peripherals.map((p,i)=>{const on=peripheral===p.id;return <Pressable key={p.id} accessibilityRole="button" accessibilityState={{disabled:busy,selected:on}} disabled={busy} style={[s.listRow,i>0&&s.listRowBorder,busy&&{opacity:0.5}]} onPress={()=>perform(async()=>{setPeripheral(p.id);setWrite(null);setNotify(null);setCharacteristics([]);const list=await Recorder.inspect(p.id);setCharacteristics(list);const pick=pickChannels(list);if(pick){setWrite(pick.write);setNotify(pick.notify);}})}>
     <View style={[s.circle,on?{backgroundColor:c.blue}:{backgroundColor:c.blue50}]}><Icon name={p.likelyObd?'radio':'bluetooth'} size={18} color={on?'#fff':c.blue}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>{p.name}</Text><Text style={ui.caption}>{p.rssi?`Signal ${p.rssi} dBm`:'Saved adapter'}{p.likelyObd?' · OBD adapter':''}</Text></View>
     {on?<Icon name="checkmark-circle" size={22} color={c.blue}/>:<View style={s.radio}/>}
    </Pressable>;})}</View>}
    {busy&&!!peripheral&&!characteristics.length&&<Notice icon="sync">Connecting to the adapter and reading its services…</Notice>}
    {characteristics.length>0&&<Notice tone={write&&notify?'ok':'info'}>{write&&notify?`Ready: data channel ${short(write.uuid)} / ${short(notify.uuid)}`:'Pick one write and one notify channel from the same service.'}</Notice>}
    {[...new Set(characteristics.map(x=>x.service))].map(svc=><View key={svc} style={ui.card}>
     <View style={[ui.row,{justifyContent:'space-between',gap:8}]}>
      <Text style={ui.title}>Service</Text>
      {recommended?.write.service===svc&&<View style={s.badge}><Icon name="star" size={11} color={c.blue}/><Text style={s.badgeText}>Recommended</Text></View>}
     </View>
     <Text style={s.mono}>{svc}</Text>
     {characteristics.filter(x=>x.service===svc).map(ch=>{const w=write?.service===ch.service&&write?.uuid===ch.uuid,n=notify?.service===ch.service&&notify?.uuid===ch.uuid;return <View key={ch.service+ch.uuid} style={s.charRow}>
      <Text style={s.mono}>{ch.uuid}</Text>
      <View style={[ui.row,{gap:8,flexWrap:'wrap'}]}>
       {ch.write&&<Pressable accessibilityRole="button" accessibilityState={{selected:w}} onPress={()=>{setWrite(ch);if(notify&&notify.service!==ch.service)setNotify(null);}} style={[s.choice,w&&s.choiceOn]}>{w?<Icon name="checkmark" size={14} color="#fff"/>:null}<Text style={[s.choiceText,w&&{color:'#fff'}]}>Write</Text></Pressable>}
       {ch.notify&&<Pressable accessibilityRole="button" accessibilityState={{selected:n}} onPress={()=>{setNotify(ch);if(write&&write.service!==ch.service)setWrite(null);}} style={[s.choice,n&&s.choiceOn]}>{n?<Icon name="checkmark" size={14} color="#fff"/>:null}<Text style={[s.choiceText,n&&{color:'#fff'}]}>Notify</Text></Pressable>}
      </View>
     </View>;})}
    </View>)}
    <Text style={s.note}>Bluetooth LE adapters only. Classic Bluetooth adapters are not supported yet.</Text>
   </>}

   {view==='Advisor'&&<>
    <Pressable accessibilityRole="button" onPress={()=>setGarageOpen(true)} style={({pressed})=>[ui.card,s.rowCard,pressed&&{opacity:0.9}]}>
     <View style={[s.circle,{backgroundColor:c.blue50}]}><Icon name="car-sport" size={18} color={c.blue}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>Vehicles</Text><Text style={ui.caption}>{vehicles.length} in your garage{vehicle?` · ${vehicle.name} selected`:''}</Text></View>
     <Icon name="chevron-forward" size={16} color={c.ink}/>
    </Pressable>
    <View style={ui.card}>
     <Text style={ui.title}>Ask about your car</Text>
     <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Answers come from your car's recorded evidence, never invented readings.</Text>
     <View style={[ui.row,{gap:10}]}>
      <TextInput style={[ui.input,{flex:1,marginBottom:0}]} value={message} onChangeText={setMessage} placeholder="Why did fuel use go up?" placeholderTextColor={c.faint}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask" onPress={()=>perform(async()=>setAnswer(await call('/assistant/messages',{vehicleId:selected,message})))} style={s.send}><Icon name="arrow-up" size={20} color="#fff"/></Pressable>
     </View>
     {answer&&<View style={s.answer}><Text style={[ui.body,{color:c.ink2}]}>{answer.text}</Text>{answer.type==='CONFIRMATION'&&<Button title="Confirm inspection task" icon="checkmark" onPress={()=>perform(async()=>{await call('/pending-actions/'+answer.pendingActionId+'/confirm',{});Alert.alert('Work order created')})}/>}</View>}
    </View>
    {token?<View style={[ui.card,s.rowCard]}>
     <View style={[s.circle,{backgroundColor:c.green50}]}><Icon name="cloud-done" size={18} color={c.green}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle} numberOfLines={1}>{api.replace(/^https?:\/\//,'')}</Text><Text style={ui.caption}>{token==='LOCAL_DEMO'?'Personal garage':'Signed in securely'}</Text></View>
    </View>:signIn}
    <Text style={s.note}>Read-only diagnostics. Yazzy never clears codes or controls anything in your car.</Text>
   </>}
  </View>}
  </ScrollView>

  {token?<View style={[s.nav,{bottom:Math.max(insets.bottom,10)+8}]}>
   {TABS.map(t=>{const active=tab.key===t.key;return <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:active}} accessibilityLabel={t.key} style={s.navItem} onPress={()=>load(t.views[0])}>
    <View style={[s.navIcon,active&&s.navIconOn]}><Icon name={active?t.icon:`${t.icon}-outline`} size={21} color={active?'#fff':c.nightMuted}/></View>
    {t.key==='Drive'&&snapshot.recording?<View style={[s.navDot,{backgroundColor:snapshot.connected?'#4ade80':c.blue300}]}/>:null}
   </Pressable>;})}
  </View>:null}

  <Modal visible={garageOpen} transparent animationType="slide" onRequestClose={()=>setGarageOpen(false)}>
   <Pressable accessibilityLabel="Close" style={s.backdrop} onPress={()=>setGarageOpen(false)}/>
   <View style={[s.sheet,{paddingBottom:insets.bottom+20}]}>
    <View style={s.grabber}/>
    <View style={[ui.row,{justifyContent:'space-between',marginBottom:8}]}><Text style={s.sheetTitle}>Your vehicles</Text><RoundButton icon="close" label="Close" size={36} onPress={()=>setGarageOpen(false)}/></View>
    <ScrollView style={{maxHeight:300}}>
     {vehicles.map((v,i)=>{const on=selected===v.id;return <Pressable key={v.id} accessibilityRole="button" accessibilityState={{selected:on}} style={[s.listRow,i>0&&s.listRowBorder]} onPress={()=>pickVehicle(v.id)}>
      <View style={[s.circle,on?{backgroundColor:c.night}:{backgroundColor:c.blue50}]}><Icon name="car-sport" size={18} color={on?'#fff':c.blue}/></View>
      <View style={{flex:1}}><Text style={s.rowTitle}>{v.name}</Text><Text style={ui.caption}>{[v.make,v.model].filter(Boolean).join(' ')||(v.origin==='REAL'?'Personal vehicle':pretty(v.origin))}</Text></View>
      {on?<Icon name="checkmark-circle" size={22} color={c.blue}/>:<View style={s.radio}/>}
     </Pressable>;})}
     {!vehicles.length&&<Text style={[ui.body,{paddingVertical:10}]}>No vehicles yet. Add your first one below.</Text>}
    </ScrollView>
    <View style={[ui.row,{gap:10,marginTop:12}]}>
     <TextInput style={[ui.input,{flex:1,marginBottom:0}]} placeholder="New vehicle name" placeholderTextColor={c.faint} value={name} onChangeText={setName}/>
     <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle" disabled={!name.trim()} onPress={()=>perform(async()=>{const v=await call('/vehicles',{name});setVehicles(await call('/vehicles'));setName('');if(v?.id)pickVehicle(v.id);})} style={[s.send,!name.trim()&&{opacity:0.4}]}><Icon name="add" size={22} color="#fff"/></Pressable>
    </View>
   </View>
  </Modal>

  <Modal visible={!!tripView} animationType="slide" onRequestClose={()=>setTripView(null)}>
   {tripView?<TripDetail trip={tripView} vehicleId={selected} vehicleName={vehicle?.name} call={call} onClose={()=>setTripView(null)}/>:null}
  </Modal>
 </View>;
}

const short=(uuid:string)=>uuid.slice(4,8);

/** One trip in the list. Memoised so typing, polling or loading elsewhere never redraws every route thumbnail. */
const TripRow=memo(function TripRow({trip:d,onOpen}:{trip:any;onOpen:(t:any)=>void}){
 const open=d.metrics&&d.startAt!=null,route=routeOf(d);
 return <Pressable accessibilityRole="button" disabled={!open} onPress={()=>onOpen(d)} style={({pressed})=>[ui.card,s.rowCard,{padding:12},pressed&&{opacity:0.9}]}>
  {route.length?<RouteArt route={route} style={s.listThumb} stroke={2.5} grid={false}/>:<View style={[s.listThumb,{alignItems:'center',justifyContent:'center'}]}><Icon name={d.status==='STATIONARY'?'pause':'navigate'} size={20} color={c.blue}/></View>}
  <View style={{flex:1}}>
   <Text style={s.rowTitle}>{d.startAt!=null?weekday(d.startAt):d.summary||d.description}</Text>
   <Text style={ui.caption}>{d.startAt!=null?clock(d.startAt):''}{d.status==='STATIONARY'?' · stationary':''}</Text>
   {d.metrics?<View style={[ui.row,{gap:14,marginTop:8}]}>
    <Text style={s.metric}>{distance(d.metrics.distanceKm)}</Text>
    <Text style={s.metricMuted}>{minutes(d.metrics.durationSeconds||0)}</Text>
    {d.metrics.fuelLitres!=null?<Text style={s.metricMuted}>{fmt(d.metrics.fuelLitres,2)} L</Text>:null}
   </View>:null}
  </View>
  {open?<Icon name="chevron-forward" size={16} color={c.ink}/>:null}
 </Pressable>;
});

const s=StyleSheet.create({
 screen:{flex:1,backgroundColor:c.bg},
 pad:{paddingHorizontal:16},
 top:{backgroundColor:c.night,paddingHorizontal:20},
 wordmark:{fontSize:20,fontWeight:'800',color:'#fff',letterSpacing:-0.5,marginBottom:28},
 greet:{fontSize:15,color:c.nightMuted,fontWeight:'500'},
 topTitle:{fontSize:30,fontWeight:'800',color:'#fff',letterSpacing:-0.8,lineHeight:35,marginTop:2},
 topText:{fontSize:14,color:c.nightMuted,marginTop:6},
 car:{alignItems:'center'},
 statusPill:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:c.night2,borderRadius:999,paddingVertical:7,paddingHorizontal:12},
 statusText:{fontSize:13,fontWeight:'600',color:'#e6ebf1'},
 dot:{width:8,height:8,borderRadius:4},
 tiles:{flexDirection:'row',gap:12,marginBottom:14},
 tripCard:{flexDirection:'row',alignItems:'stretch'},
 tripThumb:{width:128,minHeight:150,borderRadius:18},
 rowCard:{flexDirection:'row',alignItems:'center',gap:12},
 circle:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 listThumb:{width:68,height:68,borderRadius:16,backgroundColor:c.blue50},
 metric:{fontSize:14,fontWeight:'700',color:c.ink,fontVariant:['tabular-nums']},
 metricMuted:{fontSize:14,fontWeight:'500',color:c.muted,fontVariant:['tabular-nums']},
 nextStep:{backgroundColor:c.amber50,borderRadius:14,padding:12,marginTop:14,marginBottom:8},
 nextLabel:{fontSize:12.5,fontWeight:'700',color:c.amber,marginBottom:4},
 timeline:{flexDirection:'row',gap:12},
 timeLine:{width:2,flex:1,backgroundColor:c.track,marginVertical:4},
 live:{backgroundColor:c.night,borderRadius:26,padding:20,marginBottom:14},
 liveNumbers:{flexDirection:'row',alignItems:'center',marginVertical:26},
 liveValue:{fontSize:60,fontWeight:'800',color:'#fff',letterSpacing:-2,fontVariant:['tabular-nums']},
 liveUnit:{fontSize:13,fontWeight:'600',color:c.nightMuted,marginTop:2},
 liveDivider:{width:1,alignSelf:'stretch',backgroundColor:c.nightLine},
 liveMeta:{fontSize:13,color:c.nightMuted},
 listRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},
 listRowBorder:{borderTopWidth:1,borderTopColor:c.line2},
 radio:{width:22,height:22,borderRadius:11,borderWidth:1.5,borderColor:c.faint},
 badge:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:c.blue50,borderRadius:999,paddingVertical:4,paddingHorizontal:9},
 badgeText:{fontSize:12,fontWeight:'700',color:c.blue},
 mono:{fontFamily:mono,fontSize:11,color:c.muted,marginTop:4},
 charRow:{borderTopWidth:1,borderTopColor:c.line2,marginTop:12,paddingTop:10,gap:8},
 choice:{flexDirection:'row',alignItems:'center',gap:6,borderRadius:999,paddingVertical:8,paddingHorizontal:14,backgroundColor:c.surface2,borderWidth:1,borderColor:c.line},
 choiceOn:{backgroundColor:c.blue,borderColor:c.blue},
 choiceText:{fontSize:13,fontWeight:'700',color:c.ink2},
 fieldLabel:{fontSize:13,fontWeight:'600',color:c.ink2,marginBottom:6},
 note:{fontSize:12.5,lineHeight:18,color:c.muted,marginTop:6,marginBottom:10,paddingHorizontal:4,textAlign:'center'},
 send:{width:48,height:48,borderRadius:24,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 answer:{backgroundColor:c.blue50,borderRadius:16,padding:14,marginTop:12},
 nav:{position:'absolute',left:20,right:20,height:64,borderRadius:32,backgroundColor:c.night,flexDirection:'row',alignItems:'center',paddingHorizontal:8,...shadow,shadowOpacity:0.25,elevation:10},
 navItem:{flex:1,alignItems:'center',justifyContent:'center',height:'100%'},
 navIcon:{width:46,height:46,borderRadius:23,alignItems:'center',justifyContent:'center'},
 navIconOn:{backgroundColor:c.blue},
 navDot:{position:'absolute',top:12,right:'26%',width:8,height:8,borderRadius:4,borderWidth:1.5,borderColor:c.night},
 backdrop:{flex:1,backgroundColor:'rgba(15,23,32,0.45)'},
 sheet:{backgroundColor:c.surface,borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,paddingTop:10},
 grabber:{alignSelf:'center',width:40,height:5,borderRadius:3,backgroundColor:c.track,marginBottom:14},
 sheetTitle:{fontSize:20,fontWeight:'800',color:c.ink,letterSpacing:-0.4},
});
