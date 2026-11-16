import {useEffect,useState,type ComponentProps,type ReactNode} from 'react';
import {ActivityIndicator,Alert,Platform,PermissionsAndroid,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {TripDetail} from '../components/TripDetail';
import {c,mono,ui} from '../components/theme';
import {available,Recorder,knownChannels,pickChannels,type Peripheral,type Characteristic,type RecorderSnapshot} from '../modules/yazzy-recorder/src';
WebBrowser.maybeCompleteAuthSession();
const defaultApi=process.env.EXPO_PUBLIC_API_URL||'http://localhost:8000';
const issuer=(process.env.EXPO_PUBLIC_OIDC_ISSUER||'').trim();
const clientId=process.env.EXPO_PUBLIC_OIDC_CLIENT_ID||'yazzy-mobile';
const empty:RecorderSnapshot={recording:false,connected:false,queued:0,error:null,signals:{},qualification:'PENDING_DEVICE_TEST'};

type IconName=ComponentProps<typeof Ionicons>['name'];
// Bottom tabs group the original views: Home=Garage, Health=Health+Service, Drive=Record+Connect, More=Advisor.
const TABS:{key:string;icon:string;views:string[]}[]=[
 {key:'Home',icon:'home',views:['Garage']},
 {key:'Trips',icon:'map',views:['Trips']},
 {key:'Health',icon:'pulse',views:['Health','Service']},
 {key:'Drive',icon:'speedometer',views:['Record','Connect']},
 {key:'More',icon:'ellipsis-horizontal-circle',views:['Advisor']},
];
const fmt=(value:number|null|undefined,digits=1)=>value==null||Number.isNaN(value)?'—':value.toFixed(digits);
const day=(t:number)=>new Date(t*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const when=(t:number)=>new Date(t*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const latest=(list:any[]|null|undefined,key:string)=>(list||[]).reduce((a:any,x:any)=>!a||x[key]>a[key]?x:a,null);

function Icon({name,size=18,color=c.ink2}:{name:string;size?:number;color?:string}){return <Ionicons name={name as IconName} size={size} color={color}/>;}
function Segment({items,value,onChange}:{items:[string,string][];value:string;onChange:(v:string)=>void}){
 return <View style={s.segment}>{items.map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:value===key}} onPress={()=>onChange(key)} style={[s.segmentItem,value===key&&s.segmentActive]}><Text style={[s.segmentText,value===key&&s.segmentTextActive]}>{label}</Text></Pressable>)}</View>;
}
function Tile({label,icon,value,unit,detail,tone,onPress}:{label:string;icon:string;value:string;unit?:string;detail:string;tone?:'warn'|'ok';onPress:()=>void}){
 const fg=tone==='warn'?c.amber:tone==='ok'?c.green:c.teal,bg=tone==='warn'?c.amber50:tone==='ok'?c.green50:c.teal50;
 return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${unit?' '+unit:''}. ${detail}`} onPress={onPress} style={s.tile}>
  <View style={s.tileTop}><View style={[ui.iconBox,{backgroundColor:bg}]}><Icon name={icon} size={18} color={fg}/></View><Icon name="chevron-forward" size={16} color={c.faint}/></View>
  <Text style={ui.label}>{label}</Text>
  <Text style={[s.tileValue,tone==='warn'&&{color:c.amber}]} numberOfLines={1}>{value}{unit?<Text style={s.tileUnit}> {unit}</Text>:null}</Text>
  <Text style={s.tileDetail} numberOfLines={2}>{detail}</Text>
 </Pressable>;
}
function Check({ok,label}:{ok:boolean;label:string}){return <View style={s.checkRow}><Icon name={ok?'checkmark-circle':'close-circle'} size={20} color={ok?c.green:c.faint}/><Text style={[s.checkText,!ok&&{color:c.muted}]}>{label}</Text></View>;}
function Section({title,subtitle,right}:{title:string;subtitle?:string;right?:ReactNode}){return <View style={s.section}><View style={{flex:1}}><Text style={s.sectionTitle}>{title}</Text>{subtitle?<Text style={ui.body}>{subtitle}</Text>:null}</View>{right}</View>;}

export default function Home(){
 const [api,setApi]=useState(defaultApi),[token,setToken]=useState(''),[csrf,setCsrf]=useState(''),[vehicles,setVehicles]=useState<any[]>([]),[selected,setSelected]=useState(''),[view,setView]=useState('Garage'),[snapshot,setSnapshot]=useState(empty),[peripherals,setPeripherals]=useState<Peripheral[]>([]),[peripheral,setPeripheral]=useState(''),[characteristics,setCharacteristics]=useState<Characteristic[]>([]),[write,setWrite]=useState<Characteristic|null>(null),[notify,setNotify]=useState<Characteristic|null>(null),[data,setData]=useState<any[]>([]),[message,setMessage]=useState(''),[answer,setAnswer]=useState<any>(null),[busy,setBusy]=useState(false),[name,setName]=useState(''),[openTrip,setOpenTrip]=useState('');
 const [discovery,setDiscovery]=useState<AuthSession.DiscoveryDocument|null>(null),[authError,setAuthError]=useState(''),[accessPassword,setAccessPassword]=useState('');
 const [summary,setSummary]=useState<{vehicleId:string;fuel:any;trips:any[]|null;findings:any[]|null;service:any[]|null}|null>(null);
 const insets=useSafeAreaInsets();
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
 useEffect(()=>{if(!available)return;const timer=setInterval(()=>Recorder.snapshot().then(setSnapshot).catch(()=>{}),1500);return()=>clearInterval(timer)},[]);
 // Home tiles: one quiet, sequential refresh of the selected car's fuel, trips, findings and service records.
 useEffect(()=>{
  if(!token||!selected||view!=='Garage')return;
  let active=true;
  (async()=>{
   const get=(path:string)=>call(`/vehicles/${selected}/${path}`).catch(()=>null);
   const fuel=await get('fuel-report'),trips=await get('trips'),findings=await get('findings'),service=await get('maintenance-records');
   if(active)setSummary({vehicleId:selected,fuel,trips,findings,service});
  })();
  return()=>{active=false;};
 },[token,selected,view]);
 async function load(tab:string){if(tab!==view&&['Trips','Health','Service'].includes(tab))setData([]);setView(tab);if(!selected)return;if(['Trips','Health','Service'].includes(tab))await perform(async()=>setData(await call(`/vehicles/${selected}/${tab==='Trips'?'trips':tab==='Health'?'findings':'maintenance-records'}`)));}
 async function permissions(){if(Platform.OS==='android'){await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,...(Number(Platform.Version)>=33?[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]:[])]);}}
 async function start(){const key=JSON.stringify([selected,peripheral,write?.service,write?.uuid,notify?.service,notify?.uuid]);if(snapshot.configured&&(!(write&&notify&&peripheral)||await SecureStore.getItemAsync('yazzy-configured')===key)){await permissions();await Recorder.start();return;}if(!token)throw new Error('Not signed in. On the Home tab, open the local personal sandbox (or sign in) first.');if(!selected)throw new Error('No vehicle selected. On the Home tab, add a vehicle and tap it so it shows a ✓.');if(!peripheral)throw new Error('No adapter selected. On Drive › Adapter, discover and tap your adapter.');if(!write||!notify)throw new Error('Pick one write and one notify characteristic from the same service on Drive › Adapter.');if(write.service!==notify.service)throw new Error('Write and notify must come from the same service. Re-pick them on Drive › Adapter.');const saved=await SecureStore.getItemAsync('collector-'+selected);const enrol=saved?JSON.parse(saved):await call('/devices/enrolments',{vehicleId:selected});await SecureStore.setItemAsync('collector-'+selected,JSON.stringify(enrol));await Recorder.configure({apiUrl:api,deviceId:enrol.deviceId,assignmentId:enrol.assignmentId,deviceToken:enrol.deviceToken,peripheralId:peripheral,serviceUuid:write.service,writeUuid:write.uuid,notifyUuid:notify.uuid});await SecureStore.setItemAsync('yazzy-configured',key);await permissions();await Recorder.start();}
 const btn=(title:string,fn:()=>void,secondary=false,disabled=false,icon?:string)=><Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={({pressed})=>[ui.button,secondary&&ui.secondary,disabled&&{opacity:0.5},pressed&&{opacity:0.85}]} onPress={fn}>{icon?<Icon name={icon} size={17} color={secondary?c.ink2:'#fff'}/>:null}<Text style={[ui.buttonText,secondary&&ui.secondaryText]}>{title}</Text></Pressable>;

 const vehicle=vehicles.find((x:any)=>x.id===selected);
 const tab=TABS.find(t=>t.views.includes(view))||TABS[0];
 const sum=summary&&summary.vehicleId===selected?summary:null;
 const lastTrip=latest(sum?.trips,'startAt'),lastService=latest(sum?.service,'observedAt'),findingCount=sum?.findings?.length??0;
 const live=snapshot.recording&&snapshot.connected;
 const recorderLabel=snapshot.recording?(snapshot.connected?'Recording':'Armed · waiting for car'):'Not recording';
 const recommended=pickChannels(characteristics);
 const ready={signedIn:!!token,vehicle:!!selected,adapter:!!peripheral,channels:!!(write&&notify)};

 const signIn=<View style={ui.card}>
  <Text style={ui.cardTitle}>Connect to your workspace</Text>
  <Text style={[ui.body,{marginBottom:14}]}>Use your configured OIDC account. The web demo works independently without car data.</Text>
  <Text style={[ui.label,s.fieldLabel]}>Server</Text>
  <TextInput accessibilityLabel="API address" style={ui.input} value={api} onChangeText={setApi} autoCapitalize="none"/>
  <Text style={[ui.label,s.fieldLabel]}>Access password</Text>
  <TextInput accessibilityLabel="Access password" placeholder="Needed for hosted servers" placeholderTextColor={c.faint} style={ui.input} value={accessPassword} onChangeText={setAccessPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry/>
  {btn('Open local personal sandbox',()=>perform(async()=>{await sandboxLogin();}),false,false,'log-in-outline')}
  {issuer?btn('Sign in securely',()=>perform(async()=>{await promptAsync();}),true,!discovery||!request||busy,'shield-checkmark-outline'):<Text style={[ui.body,{marginTop:8}]}>Set EXPO_PUBLIC_OIDC_ISSUER and EXPO_PUBLIC_OIDC_CLIENT_ID before building. The local personal sandbox is available only on development servers.</Text>}
  {authError?<Text accessibilityRole="alert" style={s.error}>{authError}</Text>:null}
 </View>;

 return <SafeAreaView style={s.safe} edges={['top','left','right']}>
  <StatusBar style="dark"/>
  <View style={s.topbar}>
   <View style={ui.row}><View style={s.mark}><Icon name="pulse" size={15} color="#fff"/></View><Text style={s.brand}>yazzy</Text></View>
   <View style={[ui.row,{gap:10}]}>{busy?<ActivityIndicator color={c.teal}/>:null}<View style={s.pill}><Text style={s.pillText}>PERSONAL GARAGE</Text></View></View>
  </View>
  <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

  {view==='Garage'&&<>
   {!token&&<>
    <View style={s.hero}>
     <Text style={s.heroEyebrow}>Vehicle intelligence</Text>
     <Text style={s.heroTitle}>Your car, in context.</Text>
     <Text style={s.heroText}>Know what changed. Understand what to check next.</Text>
    </View>
    {signIn}
   </>}
   {token&&(vehicle?<View style={s.hero}>
    <View style={[ui.row,{justifyContent:'space-between',alignItems:'flex-start',gap:10}]}>
     <View style={{flex:1}}>
      <Text style={s.heroEyebrow} numberOfLines={1}>{[vehicle.make,vehicle.model,vehicle.year].filter(Boolean).join(' ')||'Your vehicle'}</Text>
      <Text style={s.heroTitle} numberOfLines={2}>{vehicle.name}</Text>
     </View>
     <View style={s.heroIcon}><Icon name="car-sport-outline" size={22} color={c.teal300}/></View>
    </View>
    <View style={[ui.row,{gap:8,marginTop:14,flexWrap:'wrap'}]}>
     <View style={s.heroChip}><View style={[s.dot,{backgroundColor:live?'#4ade80':snapshot.recording?c.teal300:c.heroMuted}]}/><Text style={s.heroChipText}>{recorderLabel}</Text></View>
     <View style={[s.heroChip,{backgroundColor:'transparent'}]}><Text style={[s.heroChipText,{color:c.heroMuted}]}>{vehicle.origin==='REAL'?'Real data':vehicle.origin}</Text></View>
    </View>
    <View style={s.heroMetrics}>
     {live?<>
      <View><Text style={s.heroLabel}>Speed</Text><Text style={s.heroValue}>{snapshot.signals.VEHICLE_SPEED??'—'}<Text style={s.heroUnit}> km/h</Text></Text></View>
      <View><Text style={s.heroLabel}>Engine</Text><Text style={s.heroValue}>{snapshot.signals.ENGINE_RPM??'—'}<Text style={s.heroUnit}> rpm</Text></Text></View>
     </>:<>
      <View><Text style={s.heroLabel}>Distance</Text><Text style={s.heroValue}>{fmt(sum?.fuel?.distanceKm)}<Text style={s.heroUnit}> km</Text></Text></View>
      <View><Text style={s.heroLabel}>Trips</Text><Text style={s.heroValue}>{sum?.fuel?.tripCount??'—'}</Text></View>
     </>}
    </View>
    <View style={s.heroFoot}>
     <Pressable accessibilityRole="button" style={s.heroBtn} onPress={()=>load('Record')}><Icon name="speedometer-outline" size={16} color={c.ink}/><Text style={s.heroBtnText}>{snapshot.recording?'Open recorder':'Start a drive'}</Text></Pressable>
     <Pressable accessibilityRole="button" style={[s.heroBtn,s.heroBtnGhost]} onPress={()=>load('Trips')}><Text style={[s.heroBtnText,{color:'#fff'}]}>Trips</Text><Icon name="chevron-forward" size={15} color="#fff"/></Pressable>
    </View>
   </View>:<View style={s.hero}>
    <Text style={s.heroEyebrow}>Your garage is ready</Text>
    <Text style={s.heroTitle}>Add your first vehicle</Text>
    <Text style={s.heroText}>Trips, health findings and service records will appear here.</Text>
   </View>)}
   {token&&vehicle&&<View style={s.tiles}>
    <Tile label="Fuel" icon="water-outline" value={fmt(sum?.fuel?.fuelLitres)} unit="L" detail={sum?.fuel?.litresPer100Km!=null?`${fmt(sum.fuel.litresPer100Km)} L/100 km average`:sum?.fuel?.purchasedLitres?`${fmt(sum.fuel.purchasedLitres)} L purchased`:'Consumed on recorded trips'} onPress={()=>load('Trips')}/>
    <Tile label="Health" icon="pulse-outline" tone={sum?findingCount?'warn':'ok':undefined} value={!sum?'—':findingCount?`${findingCount} to review`:'No findings'} detail={findingCount?'Evidence-backed change':'No persistent supported change'} onPress={()=>load('Health')}/>
    <Tile label="Last trip" icon="navigate-outline" value={lastTrip?fmt(lastTrip.metrics?.distanceKm):'—'} unit={lastTrip?'km':undefined} detail={lastTrip?when(lastTrip.startAt):'No recorded journeys yet'} onPress={()=>{if(lastTrip)setOpenTrip(lastTrip.id);load('Trips');}}/>
    <Tile label="Service" icon="construct-outline" value={lastService?day(lastService.observedAt):'None yet'} detail={lastService?lastService.description:'No maintenance records'} onPress={()=>load('Service')}/>
   </View>}
   <Section title="Your garage" subtitle={vehicles.length?`${vehicles.length} vehicle${vehicles.length===1?'':'s'} · tap to select`:undefined}/>
   <View style={[ui.card,{paddingVertical:6}]}>
    {vehicles.length?vehicles.map((v,i)=><Pressable key={v.id} accessibilityRole="button" accessibilityState={{selected:selected===v.id}} style={[s.listRow,i>0&&s.listRowBorder]} onPress={()=>{setSelected(v.id);SecureStore.setItemAsync('yazzy-vehicle',v.id).catch(()=>{});}}>
     <View style={[ui.iconBox,selected===v.id&&{backgroundColor:c.hero}]}><Icon name="car-sport-outline" size={19} color={selected===v.id?c.teal300:c.teal}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>{v.name}</Text><Text style={s.rowSub}>{[v.make,v.model].filter(Boolean).join(' ')||'Vehicle'} · {v.origin}</Text></View>
     {selected===v.id?<Icon name="checkmark-circle" size={22} color={c.teal}/>:<View style={s.radio}/>}
    </Pressable>):<Text style={[ui.body,{paddingVertical:12}]}>No connected vehicle data. Your adapter’s sensors, transport and background behaviour still need qualification.</Text>}
    {token&&<View style={[s.listRowBorder,{paddingTop:14,paddingBottom:8}]}>
     <TextInput style={ui.input} placeholder="New vehicle name" placeholderTextColor={c.faint} value={name} onChangeText={setName}/>
     {btn('Add vehicle',()=>perform(async()=>{await call('/vehicles',{name});setVehicles(await call('/vehicles'));setName('');}),true,false,'add')}
    </View>}
   </View>
   <View style={[ui.card,s.infoCard]}><Icon name="flask-outline" size={18} color={c.teal}/><View style={{flex:1}}><Text style={s.rowTitle}>Start without car data</Text><Text style={ui.body}>Open the web dashboard’s separate simulated fleet. No synthetic reading is assigned to your real car.</Text></View></View>
  </>}

  {tab.key==='Drive'&&<>
   <Section title="Drive" subtitle={vehicle?vehicle.name:'No vehicle selected'}/>
   <Segment items={[['Record','Record'],['Connect','Adapter']]} value={view} onChange={v=>load(v)}/>
  </>}

  {view==='Connect'&&<>
   <View style={ui.card}>
    <Text style={ui.cardTitle}>Qualify your Vgate</Text>
    <Text style={[ui.body,{marginBottom:10}]}>Close other OBD apps. Scan while parked. Select the actual service and characteristics discovered from your unit; no UUIDs are assumed.</Text>
    {btn('Discover nearby adapters',()=>perform(async()=>{await permissions();setPeripherals(await Recorder.discover());}),false,false,'bluetooth')}
   </View>
   {peripherals.length>0&&<View style={[ui.card,{paddingVertical:6}]}>{peripherals.map((p,i)=><Pressable key={p.id} accessibilityRole="button" accessibilityState={{disabled:busy,selected:peripheral===p.id}} disabled={busy} style={[s.listRow,i>0&&s.listRowBorder,busy&&{opacity:0.5}]} onPress={()=>perform(async()=>{setPeripheral(p.id);setWrite(null);setNotify(null);setCharacteristics([]);const list=await Recorder.inspect(p.id);setCharacteristics(list);const pick=pickChannels(list);if(pick){setWrite(pick.write);setNotify(pick.notify);}})}>
    <View style={[ui.iconBox,peripheral===p.id&&{backgroundColor:c.hero}]}><Icon name={p.likelyObd?'radio-outline':'bluetooth-outline'} size={18} color={peripheral===p.id?c.teal300:c.teal}/></View>
    <View style={{flex:1}}><Text style={s.rowTitle}>{p.name}</Text><Text style={s.rowSub}>{p.rssi?`${p.rssi} dBm`:'saved'}{p.likelyObd?' · likely OBD adapter':''}</Text></View>
    {peripheral===p.id?<Icon name="checkmark-circle" size={22} color={c.teal}/>:<View style={s.radio}/>}
   </Pressable>)}</View>}
   {busy&&peripheral&&!characteristics.length&&<Text style={[ui.body,{marginBottom:12}]}>Connecting to the adapter and reading its services…</Text>}
   {[...new Set(characteristics.map(c=>c.service))].map(svc=><View key={svc} style={ui.card}>
    <View style={[ui.row,{justifyContent:'space-between'}]}><Text style={ui.label}>Service</Text>{recommended?.write.service===svc&&<View style={[ui.chip,{backgroundColor:c.teal50}]}><Text style={[ui.chipText,{color:c.teal}]}>Recommended for OBD</Text></View>}</View><Text style={s.mono}>{svc}</Text>
    {characteristics.filter(x=>x.service===svc).map(ch=><View key={ch.service+ch.uuid} style={s.charRow}>
     <Text style={s.mono}>{ch.uuid}</Text>
     <View style={[ui.row,{gap:8,flexWrap:'wrap'}]}>
      {ch.write&&<Pressable accessibilityRole="button" onPress={()=>{setWrite(ch);if(notify&&notify.service!==ch.service)setNotify(null);}} style={[s.choice,write?.service===ch.service&&write?.uuid===ch.uuid&&s.choiceOn]}><Text style={[s.choiceText,write?.service===ch.service&&write?.uuid===ch.uuid&&s.choiceTextOn]}>{write?.service===ch.service&&write?.uuid===ch.uuid?'✓ Write characteristic':'Use for write'}</Text></Pressable>}
      {ch.notify&&<Pressable accessibilityRole="button" onPress={()=>{setNotify(ch);if(write&&write.service!==ch.service)setWrite(null);}} style={[s.choice,notify?.service===ch.service&&notify?.uuid===ch.uuid&&s.choiceOn]}><Text style={[s.choiceText,notify?.service===ch.service&&notify?.uuid===ch.uuid&&s.choiceTextOn]}>{notify?.service===ch.service&&notify?.uuid===ch.uuid?'✓ Notify characteristic':'Use for notifications'}</Text></Pressable>}
     </View>
    </View>)}
   </View>)}
   {characteristics.length>0&&<View style={[ui.card,s.infoCard,write&&notify?{borderColor:'#bfe0d9',backgroundColor:c.teal50}:null]}><Icon name={write&&notify?'checkmark-circle':'information-circle-outline'} size={20} color={write&&notify?c.teal:c.muted}/><Text style={[ui.body,{flex:1}]}>Selected: write {write?write.uuid:'none'} · notify {notify?notify.uuid:'none'}{write&&notify?' ✓ ready':' (pick both from the same service)'}</Text></View>}
   <Text style={s.note}>Transport: BLE qualification path. Bluetooth Classic support requires a separate verified transport implementation if your Android unit needs it.</Text>
  </>}

  {view==='Record'&&<>
   <View style={s.gauge}>
    <View style={[ui.row,{justifyContent:'space-between'}]}>
     <View style={s.heroChip}><View style={[s.dot,{backgroundColor:live?'#4ade80':snapshot.recording?c.teal300:c.heroMuted}]}/><Text style={s.heroChipText}>{snapshot.recording?(snapshot.connected?'Recording session':'Armed'):'Ready when you are'}</Text></View>
     <Text style={s.gaugeQual}>{snapshot.qualification}</Text>
    </View>
    <View style={s.gaugeNumbers}>
     <View style={{flex:1}}><Text style={s.gaugeValue}>{snapshot.signals.VEHICLE_SPEED??'—'}</Text><Text style={s.heroLabel}>km/h</Text></View>
     <View style={s.gaugeDivider}/>
     <View style={{flex:1,paddingLeft:20}}><Text style={s.gaugeValue}>{snapshot.signals.ENGINE_RPM??'—'}</Text><Text style={s.heroLabel}>rpm</Text></View>
    </View>
    <View style={[ui.row,{gap:16,flexWrap:'wrap'}]}>
     <View style={[ui.row,{gap:6}]}><Icon name="bluetooth" size={14} color={snapshot.connected?c.teal300:c.heroMuted}/><Text style={s.gaugeMeta}>Bluetooth: {snapshot.connected?'connected':'disconnected'}</Text></View>
     <View style={[ui.row,{gap:6}]}><Icon name="cloud-upload-outline" size={14} color={c.heroMuted}/><Text style={s.gaugeMeta}>Upload queue: {snapshot.queued}</Text></View>
    </View>
   </View>
   {snapshot.error?<View style={[ui.card,s.infoCard,{backgroundColor:c.red50,borderColor:'#f5c8c2'}]}><Icon name="alert-circle-outline" size={20} color={c.red}/><Text style={[s.error,{flex:1,marginVertical:0}]}>{snapshot.error}</Text></View>:null}
   {snapshot.recording&&!snapshot.connected&&<View style={[ui.card,s.infoCard,{backgroundColor:c.teal50,borderColor:'#bfe0d9'}]}><Icon name="time-outline" size={20} color={c.teal}/><Text style={[ui.body,{flex:1,color:c.ink2}]}>Armed: waiting for your adapter. Turn the car on and it connects by itself, even if this screen is closed. Each time the car starts, a new trip begins.</Text></View>}
   {snapshot.recording?btn(snapshot.connected?'Stop recording':'Disarm auto-connect',()=>perform(()=>Recorder.stop()),false,false,'stop-circle-outline'):btn(snapshot.configured&&!(write&&notify&&peripheral)?'Start with saved adapter':'Start selected adapter',()=>perform(start),false,false,'play-circle-outline')}
   {btn('Retry upload',()=>perform(()=>Recorder.sync()),true,false,'refresh-outline')}
   <View style={[ui.card,{marginTop:12}]}>
    <Text style={[ui.label,{marginBottom:6}]}>Before you drive</Text>
    <Check ok={ready.signedIn} label="Signed in"/>
    <Check ok={ready.vehicle} label={vehicle?`Vehicle · ${vehicle.name}`:'Vehicle selected'}/>
    <Check ok={ready.adapter} label="Adapter chosen"/>
    <Check ok={ready.channels} label="Write / notify characteristics"/>
   </View>
   <Text style={s.note}>Do not use controls while driving. Background reliability is not verified. OS termination may interrupt capture; queued observations remain on device.</Text>
  </>}

  {tab.key==='Health'&&<>
   <Section title="Health" subtitle={vehicle?vehicle.name:'No vehicle selected'}/>
   <Segment items={[['Health','Findings'],['Service','Service']]} value={view} onChange={v=>load(v)}/>
  </>}
  {view==='Trips'&&<Section title="Trips" subtitle={vehicle?`${vehicle.name} · tap a trip for map and details`:'No vehicle selected'}/>}
  {['Trips','Health','Service'].includes(view)&&<>
   {!data.length&&<View style={[ui.card,s.emptyCard]}><View style={s.emptyIcon}><Icon name={view==='Trips'?'map-outline':view==='Health'?'pulse-outline':'construct-outline'} size={22} color={c.teal}/></View><Text style={s.rowTitle}>No records yet</Text><Text style={[ui.body,{textAlign:'center'}]}>Unsupported or unobserved values are never shown as zero.</Text></View>}
   {data.map(d=>{const trip=view==='Trips'&&d.metrics&&d.startAt!=null;const open=openTrip===d.id;
    if(view==='Health')return <View key={d.id} style={[ui.card,{borderColor:'#f0dcc0'}]}>
     <View style={[ui.row,{gap:8,marginBottom:10,flexWrap:'wrap'}]}><View style={[ui.chip,{backgroundColor:c.amber50}]}><Icon name="warning-outline" size={13} color={c.amber}/><Text style={[ui.chipText,{color:c.amber}]}>{String(d.status||'').replaceAll('_',' ')}</Text></View>{d.origin?<View style={ui.chip}><Text style={ui.chipText}>{d.origin}</Text></View>:null}</View>
     <Text style={ui.cardTitle}>{d.summary||d.description}</Text>
     {d.evidence&&<View style={s.nextStep}><Text style={[ui.label,{color:c.amber,marginBottom:4}]}>Recommended next step</Text><Text style={[ui.body,{color:c.ink2}]}>{d.evidence.recommendedNextStep}</Text></View>}
     {d.evidence&&<Text style={[ui.body,{fontSize:12.5}]}>Exact failed part and failure date unavailable.</Text>}
    </View>;
    if(view==='Service')return <View key={d.id} style={[ui.card,s.infoCard]}>
     <View style={[ui.iconBox,{backgroundColor:c.green50}]}><Icon name="checkmark" size={18} color={c.green}/></View>
     <View style={{flex:1}}><Text style={s.rowTitle}>{d.description||d.summary}</Text><Text style={s.rowSub}>{d.observedAt?when(d.observedAt):''}{d.actualCost!=null?` · ${d.currency||''} ${fmt(d.actualCost,2)}`:''}{d.status?` · ${d.status}`:''}</Text></View>
    </View>;
    return <View key={d.id} style={[ui.card,open&&{borderColor:'#bfe0d9'}]}>
     <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} disabled={!trip} onPress={()=>setOpenTrip(open?'':d.id)}>
      <View style={[ui.row,{gap:12}]}>
       <View style={ui.iconBox}><Icon name={d.status==='STATIONARY'?'pause-outline':'navigate-outline'} size={18} color={c.teal}/></View>
       <View style={{flex:1}}><Text style={s.rowTitle}>{d.startAt!=null?when(d.startAt):d.summary||d.description}</Text><Text style={s.rowSub}>{String(d.status||'').replaceAll('_',' ').toLowerCase()} {d.origin?`· ${d.origin}`:''}</Text></View>
       {trip?<Icon name={open?'chevron-up':'chevron-down'} size={18} color={c.faint}/>:null}
      </View>
      {d.metrics&&<View style={s.tripStats}>
       <View style={{flex:1}}><Text style={s.tripValue}>{d.metrics.distanceKm?.toFixed(2)??'—'}<Text style={s.tripUnit}> km</Text></Text><Text style={s.rowSub}>distance</Text></View>
       <View style={{flex:1}}><Text style={s.tripValue}>{d.metrics.fuelLitres?.toFixed(2)??'—'}<Text style={s.tripUnit}> L</Text></Text><Text style={s.rowSub}>fuel</Text></View>
       <View style={{flex:1}}><Text style={s.tripValue}>{Math.round(d.metrics.fuelCoverage*100)}<Text style={s.tripUnit}> %</Text></Text><Text style={s.rowSub}>fuel coverage</Text></View>
      </View>}
      {trip&&!open&&d.status==='STATIONARY'&&<Text style={[ui.body,{marginTop:10}]}>Stationary session (the car did not move faster than 5 km/h).</Text>}
      {trip&&!open&&<Text style={s.tapHint}>Tap for map, speed and details</Text>}
     </Pressable>
     {trip&&open&&<TripDetail trip={d} vehicleId={selected} vehicleName={vehicle?.name} call={call}/>}
    </View>;
   })}
  </>}

  {view==='Advisor'&&<>
   <Section title="More"/>
   <View style={ui.card}>
    <View style={[ui.row,{gap:12,marginBottom:10}]}><View style={ui.iconBox}><Icon name="sparkles-outline" size={18} color={c.teal}/></View><Text style={[ui.cardTitle,{marginBottom:0}]}>Evidence advisor</Text></View>
    <Text style={[ui.body,{marginBottom:14}]}>Deterministic evidence explanations. No invented readings or failure probabilities.</Text>
    <TextInput style={ui.input} value={message} onChangeText={setMessage} placeholder="Ask about your vehicle" placeholderTextColor={c.faint}/>
    {btn('Ask',()=>perform(async()=>setAnswer(await call('/assistant/messages',{vehicleId:selected,message}))),false,false,'send')}
    {answer&&<View style={s.answer}><Text style={[ui.body,{color:c.ink2}]}>{answer.text}</Text>{answer.type==='CONFIRMATION'&&btn('Review and confirm inspection task',()=>perform(async()=>{await call('/pending-actions/'+answer.pendingActionId+'/confirm',{});Alert.alert('Work order created')}),false,false,'checkmark')}</View>}
   </View>
   {token?<View style={ui.card}>
    <Text style={[ui.label,{marginBottom:10}]}>Connection</Text>
    <View style={[ui.row,{gap:12}]}><View style={ui.iconBox}><Icon name="server-outline" size={18} color={c.teal}/></View><View style={{flex:1}}><Text style={s.rowTitle} numberOfLines={1}>{api.replace(/^https?:\/\//,'')}</Text><Text style={s.rowSub}>{token==='LOCAL_DEMO'?'Personal sandbox':'Signed in securely'}</Text></View><Icon name="checkmark-circle" size={20} color={c.green}/></View>
   </View>:signIn}
   <View style={[ui.card,s.infoCard]}><Icon name="shield-checkmark-outline" size={18} color={c.teal}/><Text style={[ui.body,{flex:1}]}>Read-only diagnostics. Yazzy never clears codes or actuates anything in your car.</Text></View>
  </>}

  <Text style={s.foot}>Qualification pending · Read-only diagnostics · No clearing or actuation</Text>
  </ScrollView>
  <View style={[s.tabbar,{paddingBottom:Math.max(insets.bottom,6)}]}>
   {TABS.map(t=>{const active=tab.key===t.key;return <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:active}} accessibilityLabel={t.key} style={s.tabItem} onPress={()=>load(t.views[0])}>
    <View style={[s.tabIcon,active&&s.tabIconActive]}><Icon name={active?t.icon:`${t.icon}-outline`} size={21} color={active?c.teal:c.muted}/>{t.key==='Drive'&&snapshot.recording?<View style={[s.tabDot,{backgroundColor:snapshot.connected?c.green:c.teal300}]}/>:null}</View>
    <Text style={[s.tabText,active&&s.tabTextActive]}>{t.key}</Text>
   </Pressable>;})}
  </View>
 </SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:c.bg},
 topbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,paddingTop:8,paddingBottom:10},
 mark:{width:28,height:28,borderRadius:9,backgroundColor:c.teal,alignItems:'center',justifyContent:'center',marginRight:8},
 brand:{fontSize:21,fontWeight:'800',color:c.ink,letterSpacing:-0.6},
 pill:{borderRadius:999,borderWidth:1,borderColor:c.line,paddingVertical:4,paddingHorizontal:10,backgroundColor:c.surface},
 pillText:{fontSize:10.5,fontWeight:'700',letterSpacing:1,color:c.muted},
 content:{paddingHorizontal:16,paddingTop:6,paddingBottom:28},
 hero:{backgroundColor:c.hero,borderRadius:22,padding:20,marginBottom:14},
 heroEyebrow:{fontSize:12,fontWeight:'700',letterSpacing:1.2,textTransform:'uppercase',color:c.teal300,marginBottom:6},
 heroTitle:{fontSize:30,fontWeight:'800',color:'#fff',letterSpacing:-0.8,lineHeight:34},
 heroText:{fontSize:14,lineHeight:21,color:c.heroMuted,marginTop:8},
 heroIcon:{width:44,height:44,borderRadius:14,backgroundColor:c.hero2,borderWidth:1,borderColor:c.heroLine,alignItems:'center',justifyContent:'center'},
 heroChip:{flexDirection:'row',alignItems:'center',gap:7,borderRadius:999,borderWidth:1,borderColor:c.heroLine,backgroundColor:c.hero2,paddingVertical:5,paddingHorizontal:11},
 heroChipText:{fontSize:12,fontWeight:'700',color:'#e7efed'},
 dot:{width:7,height:7,borderRadius:4},
 heroMetrics:{flexDirection:'row',gap:36,marginTop:22,marginBottom:18},
 heroLabel:{fontSize:11,fontWeight:'700',letterSpacing:1,textTransform:'uppercase',color:c.heroMuted,marginBottom:4},
 heroValue:{fontSize:28,fontWeight:'700',color:'#fff',letterSpacing:-0.6,fontVariant:['tabular-nums']},
 heroUnit:{fontSize:14,fontWeight:'500',color:c.heroMuted,letterSpacing:0},
 heroFoot:{flexDirection:'row',gap:10,paddingTop:16,borderTopWidth:1,borderTopColor:c.heroLine},
 heroBtn:{flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#fff',borderRadius:999,paddingVertical:10,paddingHorizontal:15},
 heroBtnGhost:{backgroundColor:'transparent',borderWidth:1,borderColor:c.heroLine},
 heroBtnText:{fontSize:13.5,fontWeight:'700',color:c.ink},
 tiles:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12,marginBottom:6},
 tile:{width:'48.4%',backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:18,padding:14},
 tileTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12},
 tileValue:{fontSize:20,fontWeight:'700',color:c.ink,letterSpacing:-0.4,marginTop:4,marginBottom:2,fontVariant:['tabular-nums']},
 tileUnit:{fontSize:13,fontWeight:'500',color:c.muted},
 tileDetail:{fontSize:12.5,lineHeight:17,color:c.muted},
 section:{flexDirection:'row',alignItems:'flex-end',marginTop:14,marginBottom:10,paddingHorizontal:2},
 sectionTitle:{fontSize:24,fontWeight:'800',color:c.ink,letterSpacing:-0.6,marginBottom:2},
 segment:{flexDirection:'row',backgroundColor:c.line2,borderRadius:999,padding:4,marginBottom:14},
 segmentItem:{flex:1,paddingVertical:9,borderRadius:999,alignItems:'center'},
 segmentActive:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line},
 segmentText:{fontSize:13.5,fontWeight:'600',color:c.muted},
 segmentTextActive:{color:c.ink},
 listRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},
 listRowBorder:{borderTopWidth:1,borderTopColor:c.line2},
 rowTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 rowSub:{fontSize:12.5,color:c.muted,marginTop:2},
 radio:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:c.line},
 infoCard:{flexDirection:'row',gap:12,alignItems:'flex-start'},
 fieldLabel:{marginBottom:6},
 error:{color:c.red,fontSize:13,marginVertical:10},
 note:{fontSize:12,lineHeight:18,color:c.muted,marginTop:4,marginBottom:10,paddingHorizontal:4},
 mono:{fontFamily:mono,fontSize:11,color:c.ink2,marginTop:3},
 charRow:{borderTopWidth:1,borderTopColor:c.line2,marginTop:12,paddingTop:10,gap:8},
 choice:{borderRadius:999,borderWidth:1,borderColor:c.line,paddingVertical:8,paddingHorizontal:12,backgroundColor:c.surface2},
 choiceOn:{backgroundColor:c.teal,borderColor:c.teal},
 choiceText:{fontSize:12.5,fontWeight:'700',color:c.ink2},
 choiceTextOn:{color:'#fff'},
 gauge:{backgroundColor:c.hero,borderRadius:22,padding:20,marginBottom:12},
 gaugeQual:{fontSize:10.5,fontWeight:'700',letterSpacing:1,color:c.heroMuted},
 gaugeNumbers:{flexDirection:'row',alignItems:'center',marginVertical:24},
 gaugeValue:{fontSize:52,fontWeight:'800',color:'#fff',letterSpacing:-1.5,fontVariant:['tabular-nums']},
 gaugeDivider:{width:1,alignSelf:'stretch',backgroundColor:c.heroLine},
 gaugeMeta:{fontSize:12.5,color:c.heroMuted},
 checkRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:7},
 checkText:{fontSize:14,color:c.ink,fontWeight:'500'},
 emptyCard:{alignItems:'center',paddingVertical:28,gap:6},
 emptyIcon:{width:48,height:48,borderRadius:15,backgroundColor:c.teal50,alignItems:'center',justifyContent:'center',marginBottom:6},
 nextStep:{backgroundColor:c.amber50,borderRadius:12,padding:12,marginVertical:10},
 tripStats:{flexDirection:'row',marginTop:14,paddingTop:12,borderTopWidth:1,borderTopColor:c.line2},
 tripValue:{fontSize:17,fontWeight:'700',color:c.ink,fontVariant:['tabular-nums']},
 tripUnit:{fontSize:12,fontWeight:'500',color:c.muted},
 tapHint:{fontSize:12.5,color:c.teal,fontWeight:'600',marginTop:10},
 answer:{backgroundColor:c.teal50,borderRadius:14,padding:14,marginTop:10},
 foot:{fontSize:11,color:c.faint,textAlign:'center',marginTop:16},
 tabbar:{flexDirection:'row',backgroundColor:c.surface,borderTopWidth:1,borderTopColor:c.line,paddingTop:6},
 tabItem:{flex:1,alignItems:'center',gap:2},
 tabIcon:{width:52,height:30,borderRadius:15,alignItems:'center',justifyContent:'center'},
 tabIconActive:{backgroundColor:c.teal50},
 tabDot:{position:'absolute',top:3,right:12,width:8,height:8,borderRadius:4,borderWidth:1.5,borderColor:c.surface},
 tabText:{fontSize:11.5,fontWeight:'600',color:c.muted},
 tabTextActive:{color:c.teal},
});
