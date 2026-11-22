import {useCallback,useEffect,useState} from 'react';
import {RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {c,F,radius,ui} from './theme';
import {Chip,Icon,Notice,Section,Tile} from './kit';
import {PressableScale} from './motion';
import {FullMap,MapPreview,Pin,regionFor} from './maps';
import {server} from './server';
import {fmt} from './format';
import {since} from './car';
import {locale,t,tp} from './i18n';

type Car={id:string;name:string;make:string;model:string;year:number|null;live:boolean;speedKmh:number|null;
 position:{latitude:number;longitude:number;accuracy?:number|null;at?:number|null}|null;
 lastTrip:{startAt:number;endAt:number|null;distanceKm:number|null}|null;km7:number;km30:number;trips30:number;odometerKm:number|null};
type Board={cars:Car[];summary:{cars:number;liveNow:number;km30:number;trips30:number;lastDriven:string|null};at:number};

const REFRESH_MS=15000; // the phones in the cars upload every few seconds while driving

/** Every Business car at a glance: where each is, which is on the road right now, and how far they went. */
export function BusinessDashboard({onClose}:{onClose:()=>void}){
 const insets=useSafeAreaInsets(),[board,setBoard]=useState<Board|null>(null),[error,setError]=useState(''),[pulling,setPulling]=useState(false),[mapOpen,setMapOpen]=useState(false);
 const load=useCallback(async()=>{
  try{setBoard(await server.call('/business/dashboard'));setError('');}catch(e){setError((e as Error).message);}
 },[]);
 // Live positions move: refresh while the dashboard is open.
 useEffect(()=>{void load();const timer=setInterval(()=>{void load();},REFRESH_MS);return()=>clearInterval(timer);},[load]);
 const cars=board?.cars||[],placed=cars.filter(x=>x.position),last=cars.find(x=>x.id===board?.summary.lastDriven);
 const region=placed.length?regionFor(placed.map(x=>x.position!),0.02):null;
 const markers=placed.map(x=><Pin key={x.id} coordinate={x.position!} icon={x.live?'navigate':'car-sport'} color={x.live?c.green:c.blue}
  title={x.name} description={x.live?t('Driving now')+(x.speedKmh!=null?' · '+t('{n} km/h',{n:x.speedKmh}):''):x.position?.at?t('Seen {when}',{when:since(x.position.at)}):undefined}/>);
 return <View style={s.page}>
  <StatusBar style="dark"/>
  <ScrollView contentContainerStyle={{padding:16,paddingTop:insets.top+8,paddingBottom:insets.bottom+40}}
   refreshControl={<RefreshControl refreshing={pulling} onRefresh={()=>{setPulling(true);void load().finally(()=>setPulling(false));}}/>}>
   <PressableScale accessibilityRole="button" accessibilityLabel={t('Back')} onPress={onClose} style={s.back}>
    <Icon name="arrow-back" size={18} color={c.ink}/><Text style={s.backText}>{t('Business dashboard')}</Text>
   </PressableScale>
   {error?<Notice tone="warn" icon="cloud-offline-outline">{error}</Notice>:null}
   {!board&&!error?<Text style={[ui.caption,{marginVertical:20,textAlign:'center'}]}>{t('Loading…')}</Text>:null}
   {board&&!cars.length?<Notice icon="briefcase">{t('No cars in the Business group yet. In Your vehicles, tap the pencil on a car and choose Business.')}</Notice>:null}
   {board&&cars.length?<>
    <View style={s.tiles}>
     <Tile style={s.half} icon="car-sport" label={t('Business cars')} value={String(board.summary.cars)} caption={board.summary.liveNow?tp(board.summary.liveNow,'{n} driving now','{n} driving now'):t('None on the road')}/>
     <Tile style={s.half} icon="speedometer" label={t('Last 30 days')} value={fmt(board.summary.km30,0)} unit={t('km')} caption={tp(board.summary.trips30,'{n} trip','{n} trips')}/>
    </View>
    {last?<View style={[ui.card,{marginBottom:12}]}>
     <Text style={ui.caption}>{t('Last driven')}</Text>
     <Text style={[ui.title,{marginTop:4}]}>{last.name}</Text>
     <Text style={ui.body}>{last.lastTrip?when(last.lastTrip.endAt||last.lastTrip.startAt)+(last.lastTrip.distanceKm!=null?' · '+t('{n} km',{n:fmt(last.lastTrip.distanceKm,1)}):''):''}</Text>
    </View>:null}
    {region?<View style={[ui.card,{padding:0,overflow:'hidden',marginBottom:12}]}>
     <MapPreview region={region} height={230} onPress={()=>setMapOpen(true)} label={t('Open the map')}>{markers}</MapPreview>
    </View>:null}
    <Section title={t('Cars')}/>
    {cars.map(x=><View key={x.id} style={[ui.card,{marginBottom:10}]}>
     <View style={[ui.row,{justifyContent:'space-between',gap:10}]}>
      <View style={{flex:1}}>
       <Text style={ui.title} numberOfLines={1}>{x.name}</Text>
       <Text style={ui.caption} numberOfLines={1}>{[x.make,x.model,x.year].filter(Boolean).join(' ')||t('Business car')}</Text>
      </View>
      {x.live?<Chip dot={c.green} tone="green" label={t('Driving')+(x.speedKmh!=null?' · '+t('{n} km/h',{n:x.speedKmh}):'')}/>:<Chip label={t('Parked')}/>}
     </View>
     <View style={s.facts}>
      <Fact label={t('Last drive')} value={x.lastTrip?when(x.lastTrip.endAt||x.lastTrip.startAt):t('never')}/>
      <Fact label={t('7 days')} value={t('{n} km',{n:fmt(x.km7,0)})}/>
      <Fact label={t('30 days')} value={t('{n} km',{n:fmt(x.km30,0)})}/>
     </View>
     <View style={[ui.row,{gap:6,marginTop:8}]}>
      <Icon name={x.live?'navigate':'location-outline'} size={14} color={x.live?c.green:c.muted}/>
      <Text style={[ui.caption,{flex:1}]} numberOfLines={1}>{x.position?(x.live?t('Live position'):t('Last position'))+' · '+x.position.latitude.toFixed(5)+', '+x.position.longitude.toFixed(5)+(x.position.at?' · '+since(x.position.at):''):t('No position yet')}</Text>
     </View>
    </View>)}
   </>:null}
  </ScrollView>
  {region?<FullMap visible={mapOpen} onClose={()=>setMapOpen(false)} region={region} title={t('Business cars')}>{markers}</FullMap>:null}
 </View>;
}

const when=(at:number)=>new Date(at*1000).toLocaleString(locale(),{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

function Fact({label,value}:{label:string;value:string}){
 return <View style={{flex:1}}><Text style={ui.caption}>{label}</Text><Text style={s.factValue} numberOfLines={1}>{value}</Text></View>;
}

const s=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},
 back:{flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start',backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,borderRadius:radius.pill,paddingVertical:9,paddingHorizontal:14,marginBottom:16},
 backText:{fontFamily:F[700],fontSize:14,color:c.ink},
 tiles:{flexDirection:'row',gap:12,marginBottom:12},
 half:{flex:1},
 facts:{flexDirection:'row',gap:10,marginTop:12,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 factValue:{fontFamily:F[700],fontSize:14.5,color:c.ink,marginTop:2,fontVariant:['tabular-nums']},
});
