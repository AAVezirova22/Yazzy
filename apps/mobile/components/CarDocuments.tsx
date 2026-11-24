import {useCallback,useEffect,useState} from 'react';
import {Alert,Image,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import DateTimePicker,{DateTimePickerAndroid} from '@react-native-community/datetimepicker';
import {c,F,radius,ui} from './theme';
import {Button,Icon,useAction} from './kit';
import {PressableScale} from './motion';
import {Sheet} from './Sheet';
import {checkApiFines,checkKatFines,checkVignette,daysLeft,loadIdentity,loadKat,normalPlate,saveIdentity,saveKat,validEgn,validLicence,validPlate,type Documents,type Identity,type KatFines} from './carChecks';
import {captureTalon,removeTalon,talonExists,talonPath} from './talon';
import {since} from './car';
import {locale,t,tp} from './i18n';

const STALE_S=12*3600; // vignette and fines are checked again at most twice a day by themselves
const isoDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shown=(iso?:string|null)=>iso?new Date(iso.length===10?iso+'T12:00:00':iso).toLocaleDateString(locale(),{day:'2-digit',month:'2-digit',year:'numeric'}):null;
const euros=(n:number)=>n.toLocaleString(locale(),{maximumFractionDigits:2})+' €';

/** A Bulgarian plate as printed: the blue EU strip with BG, then the number. */
function Plate({plate}:{plate:string}){
 const p=normalPlate(plate),m=p.match(/^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/);
 return <View style={s.plate}><View style={s.plateEu}><Text style={s.plateBg}>BG</Text></View><Text style={s.plateText}>{m?`${m[1]} ${m[2]} ${m[3]}`:p}</Text></View>;
}

type Tone='ok'|'soon'|'late'|'none';
const TONE:Record<Tone,[string,string]>={ok:['checkmark-circle',c.green],soon:['time',c.amber],late:['alert-circle',c.red],none:['help-circle',c.faint]};
function Row({icon,label,value,tone}:{icon:string;label:string;value:string;tone:Tone}){
 const [mark,color]=TONE[tone];
 return <View style={s.row}>
  <Icon name={mark} size={18} color={color}/>
  <Icon name={icon} size={16} color={c.muted}/>
  <Text style={s.rowLabel}>{label}</Text>
  <Text style={[s.rowValue,tone==='late'&&{color:c.red},tone==='soon'&&{color:c.amber}]} numberOfLines={1}>{value}</Text>
 </View>;
}
const expiry=(iso?:string|null):[string,Tone]=>{
 const d=daysLeft(iso);if(d==null)return [t('Not set'),'none'];
 return [d<0?t('Expired {date}',{date:shown(iso)!}):shown(iso)!+(d<=30?' · '+tp(d,'{n} day left','{n} days left'):''),d<0?'late':d<=30?'soon':'ok'];
};

/**
 * The car's papers on Home, like the Bulgarian car apps: plate, technical inspection (ГТП), civil liability
 * insurance, vignette, toll (АПИ) fines and KAT fines. The vignette and fines are checked by themselves; the
 * inspection and insurance dates come from the owner.
 */
export function CarDocuments({vehicle,onSave}:{vehicle:any;onSave:(documents:Documents)=>Promise<void>}){
 const docs:Documents=vehicle?.documents||{};
 const [editing,setEditing]=useState(false),[kat,setKat]=useState<KatFines|null>(null),[identity,setIdentity]=useState<Identity|null>(null),[busy,run]=useAction();
 useEffect(()=>{void loadKat().then(setKat);void loadIdentity().then(setIdentity);},[]);
 const refresh=useCallback((quiet:boolean)=>run(async()=>{
  const plate=docs.plate,id=await loadIdentity();setIdentity(id);
  const next:Documents={...docs,checkedAt:Date.now()/1000},problems:string[]=[];
  if(plate&&validPlate(plate)){
   try{next.vignette=await checkVignette(plate);}catch{problems.push(t('vignette'));}
   if(id)try{next.apiFines=await checkApiFines(plate,id.egn);}catch{problems.push(t('toll fines'));}
  }
  if(id)try{const k=await checkKatFines(id);setKat(k);await saveKat(k);}catch{problems.push(t('KAT fines'));}
  await onSave(next);
  if(problems.length&&!quiet)Alert.alert(t('Some checks did not answer'),t('Try again later: {list}.',{list:problems.join(', ')}));
 }),[vehicle?.id,JSON.stringify(docs)]);
 // Checked by itself when the card shows and the last check is older than half a day.
 useEffect(()=>{if(docs.plate&&(!docs.checkedAt||Date.now()/1000-docs.checkedAt>STALE_S))void refresh(true);},[vehicle?.id,docs.plate]);
 if(!vehicle)return null;
 const [gtp,gtpTone]=expiry(docs.gtpUntil),[ins,insTone]=expiry(docs.insuranceUntil);
 const vig=docs.vignette,[vigText,vigTone]=!docs.plate?[t('Add the plate'),'none' as Tone]:!vig?[t('Not checked'),'none' as Tone]:!vig.active?[t('No valid vignette'),'late' as Tone]:expiry(vig.until);
 const api=docs.apiFines,apiRow:[string,Tone]=!identity?[t('Add your ЕГН'),'none']:!api?[t('Not checked'),'none']:api.count?[tp(api.count,'{n} fine','{n} fines')+(api.amount?' · '+euros(api.amount):''),'late']:[t('None'),'ok'];
 const katRow:[string,Tone]=!identity?[t('Add ЕГН and licence'),'none']:!kat?[t('Not checked'),'none']:kat.count?[tp(kat.count,'{n} fine','{n} fines')+(kat.amount?' · '+euros(kat.amount):''),'late']:[kat.partial?t('None found (partly unavailable)'):t('None'),kat.partial?'soon':'ok'];
 return <View style={[ui.card,{gap:2}]}>
  <View style={[ui.row,{justifyContent:'space-between',marginBottom:8}]}>
   <View style={{flex:1,gap:6}}>
    <Text style={s.title} numberOfLines={1}>{vehicle.name}</Text>
    {docs.plate?<Plate plate={docs.plate}/>:null}
   </View>
   <Pressable accessibilityRole="button" accessibilityLabel={t('Edit documents')} hitSlop={8} onPress={()=>setEditing(true)} style={s.edit}>
    <Icon name="create-outline" size={18} color={c.blue}/><Text style={s.editText}>{t('Edit')}</Text>
   </Pressable>
  </View>
  <Row icon="construct-outline" label={t('ГТП')} value={gtp} tone={gtpTone}/>
  <Row icon="shield-checkmark-outline" label={t('Insurance')} value={ins} tone={insTone}/>
  <Row icon="ticket-outline" label={t('Vignette')} value={vigText} tone={vigTone}/>
  <Row icon="trail-sign-outline" label={t('Toll fines (АПИ)')} value={apiRow[0]} tone={apiRow[1]}/>
  <Row icon="shield-outline" label={t('KAT fines')} value={katRow[0]} tone={katRow[1]}/>
  {kat?.count?kat.items.slice(0,3).map((f,i)=><Text key={i} style={s.fine} numberOfLines={2}>· {[f.date?shown(f.date):null,f.description,euros(f.amount)].filter(Boolean).join(' · ')}</Text>):null}
  <PressableScale accessibilityRole="button" disabled={busy} onPress={()=>{void refresh(false);}} style={s.refresh}>
   <Icon name="refresh" size={16} color={c.blue}/>
   <Text style={s.refreshText}>{busy?t('Checking…'):t('Refresh the data')}</Text>
   {docs.checkedAt&&!busy?<Text style={s.when}>{since(docs.checkedAt)}</Text>:null}
  </PressableScale>
  <DocumentsEditor open={editing} vehicle={vehicle} docs={docs} identity={identity} onClose={()=>setEditing(false)}
   onSave={async(next,id)=>{await saveIdentity(id);setIdentity(id);await onSave(next);setEditing(false);void refresh(true);}}/>
 </View>;
}

function DateField({label,value,onChange}:{label:string;value?:string;onChange:(iso:string|undefined)=>void}){
 const [open,setOpen]=useState(false),date=value?new Date(value+'T12:00:00'):new Date();
 const pick=()=>{
  if(Platform.OS==='android')DateTimePickerAndroid.open({value:date,mode:'date',onChange:(e,d)=>{if(e.type==='set'&&d)onChange(isoDate(d));}});
  else setOpen(o=>!o);
 };
 return <View style={{marginBottom:12}}>
  <Text style={s.fieldLabel}>{label}</Text>
  <View style={[ui.row,{gap:8}]}>
   <Pressable accessibilityRole="button" onPress={pick} style={[ui.input,s.dateButton]}>
    <Text style={[s.dateText,!value&&{color:c.faint}]}>{value?shown(value):t('Choose the date')}</Text>
    <Icon name="calendar-outline" size={18} color={c.muted}/>
   </Pressable>
   {value?<Pressable accessibilityRole="button" accessibilityLabel={t('Clear')} hitSlop={8} onPress={()=>onChange(undefined)} style={s.clear}><Icon name="close" size={18} color={c.muted}/></Pressable>:null}
  </View>
  {open&&Platform.OS==='ios'?<DateTimePicker value={date} mode="date" display="inline" onChange={(_,d)=>{if(d)onChange(isoDate(d));}}/>:null}
 </View>;
}

function DocumentsEditor({open,vehicle,docs,identity,onClose,onSave}:{open:boolean;vehicle:any;docs:Documents;identity:Identity|null;onClose:()=>void;onSave:(d:Documents,id:Identity|null)=>Promise<void>}){
 const [plate,setPlate]=useState(docs.plate||''),[gtp,setGtp]=useState(docs.gtpUntil),[ins,setIns]=useState(docs.insuranceUntil),[vin,setVin]=useState(docs.vin);
 const [egn,setEgn]=useState(identity?.egn||''),[licence,setLicence]=useState(identity?.licence||''),[photo,setPhoto]=useState<string|null>(null),[busy,run]=useAction();
 useEffect(()=>{
  if(!open)return;
  setPlate(docs.plate||'');setGtp(docs.gtpUntil);setIns(docs.insuranceUntil);setVin(docs.vin);setEgn(identity?.egn||'');setLicence(identity?.licence||'');
  void talonExists(vehicle.id).then(ok=>setPhoto(ok?talonPath(vehicle.id)+'?'+Date.now():null));
 },[open]);
 const scan=(camera:boolean)=>run(async()=>{
  const got=await captureTalon(vehicle.id,camera);if(!got)return;
  setPhoto(got.uri+'?'+Date.now());
  if(got.plate)setPlate(got.plate);if(got.vin)setVin(got.vin);
  Alert.alert(t('Registration certificate'),got.plate||got.vin?t('Read from the photo: {found}. Check it before saving.',{found:[got.plate,got.vin].filter(Boolean).join(', ')}):t('The photo is saved, but the plate could not be read. Type it in.'));
 });
 const plateOk=!plate.trim()||validPlate(plate),idGiven=!!(egn.trim()||licence.trim()),idOk=!idGiven||(validEgn(egn)&&(!licence.trim()||validLicence(licence)));
 const save=()=>run(async()=>{
  await onSave({...docs,plate:plate.trim()?normalPlate(plate):undefined,gtpUntil:gtp,insuranceUntil:ins,vin},
   egn.trim()?{egn:egn.trim(),licence:licence.trim()}:null);
 });
 return <Sheet open={open} onClose={onClose} title={t('Documents')}>
  <Text style={s.fieldLabel}>{t('Registration certificate (талон)')}</Text>
  <View style={[ui.row,{gap:12,marginBottom:12}]}>
   {photo?<Image source={{uri:photo}} style={s.talon} resizeMode="cover"/>:<View style={[s.talon,s.talonEmpty]}><Icon name="document-text-outline" size={22} color={c.faint}/></View>}
   <View style={{flex:1,gap:6}}>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>scan(true)} style={s.photoButton}><Icon name="camera-outline" size={16} color={c.blue}/><Text style={s.photoText}>{t('Take a photo')}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>scan(false)} style={s.photoButton}><Icon name="images-outline" size={16} color={c.blue}/><Text style={s.photoText}>{t('Choose a photo')}</Text></Pressable>
    {photo?<Pressable accessibilityRole="button" onPress={()=>{void removeTalon(vehicle.id).then(()=>setPhoto(null));}} style={s.photoButton}><Icon name="trash-outline" size={16} color={c.red}/><Text style={[s.photoText,{color:c.red}]}>{t('Remove')}</Text></Pressable>:null}
   </View>
  </View>
  <Text style={s.hint}>{t('The photo stays on this phone; the plate and VIN are read from it on the phone.')}</Text>
  <Text style={s.fieldLabel}>{t('Registration plate')}</Text>
  <TextInput style={[ui.input,!plateOk&&{borderColor:c.red}]} value={plate} onChangeText={setPlate} placeholder="A 1234 BC" placeholderTextColor={c.faint} autoCapitalize="characters" autoCorrect={false}/>
  {vin?<Text style={[s.hint,{marginTop:-6}]}>VIN {vin}</Text>:null}
  <DateField label={t('Technical inspection (ГТП) valid until')} value={gtp} onChange={setGtp}/>
  <DateField label={t('Civil liability insurance valid until')} value={ins} onChange={setIns}/>
  <Text style={s.fieldLabel}>{t('For fines (KAT and АПИ)')}</Text>
  <TextInput style={[ui.input,egn.trim()&&!validEgn(egn)&&{borderColor:c.red}]} value={egn} onChangeText={setEgn} placeholder={t('ЕГН')} placeholderTextColor={c.faint} keyboardType="number-pad" maxLength={10} secureTextEntry autoCorrect={false}/>
  <TextInput style={[ui.input,licence.trim()&&!validLicence(licence)&&{borderColor:c.red}]} value={licence} onChangeText={setLicence} placeholder={t('Driving licence number')} placeholderTextColor={c.faint} keyboardType="number-pad" maxLength={9} autoCorrect={false}/>
  <Text style={s.hint}>{t('Saved only on this phone, encrypted. The phone asks МВР and BG Toll itself; Yazzy\'s server never receives them.')}</Text>
  <Button title={t('Save')} icon="checkmark" disabled={busy||!plateOk||!idOk} onPress={save}/>
 </Sheet>;
}

const s=StyleSheet.create({
 title:{fontFamily:F[700],fontSize:16,color:c.ink},
 plate:{flexDirection:'row',alignItems:'stretch',alignSelf:'flex-start',borderWidth:1.5,borderColor:c.ink,borderRadius:4,overflow:'hidden',backgroundColor:'#fff'},
 plateEu:{backgroundColor:'#1f4fb4',paddingHorizontal:4,justifyContent:'flex-end',paddingBottom:2},
 plateBg:{fontFamily:F[700],fontSize:8,color:'#fff'},
 plateText:{fontFamily:F[700],fontSize:17,color:c.ink,letterSpacing:1.2,paddingHorizontal:8,paddingVertical:2,fontVariant:['tabular-nums']},
 edit:{flexDirection:'row',alignItems:'center',gap:4,minHeight:36,paddingHorizontal:4},
 editText:{fontFamily:F[600],fontSize:13,color:c.blue},
 row:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 rowLabel:{fontFamily:F[600],fontSize:13.5,color:c.ink},
 rowValue:{flex:1,textAlign:'right',fontFamily:F[500],fontSize:13.5,color:c.ink2,fontVariant:['tabular-nums']},
 fine:{fontFamily:F[500],fontSize:12,color:c.red,paddingLeft:26,paddingBottom:2},
 refresh:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,minHeight:44,marginTop:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 refreshText:{fontFamily:F[700],fontSize:13.5,color:c.blue},
 when:{fontFamily:F[500],fontSize:12,color:c.muted},
 fieldLabel:{fontFamily:F[700],fontSize:12,letterSpacing:0.6,color:c.ink2,marginBottom:6},
 hint:{fontFamily:F[500],fontSize:12,lineHeight:17,color:c.muted,marginBottom:12},
 talon:{width:96,height:68,borderRadius:radius.md,backgroundColor:c.bg},
 talonEmpty:{alignItems:'center',justifyContent:'center',borderWidth:1,borderStyle:'dashed',borderColor:c.line},
 photoButton:{flexDirection:'row',alignItems:'center',gap:6,minHeight:30},
 photoText:{fontFamily:F[600],fontSize:13.5,color:c.blue},
 dateButton:{flex:1,marginBottom:0,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 dateText:{fontFamily:F[500],fontSize:15,color:c.ink},
 clear:{width:40,height:40,alignItems:'center',justifyContent:'center'},
});
