import {memo,useEffect,useState} from 'react';
import {Alert,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import DateTimePicker,{DateTimePickerAndroid} from '@react-native-community/datetimepicker';
import {c,F,radius,shadow,type,ui} from './theme';
import {Button,Chip,Icon,IconTile,Section,Tile,useAction} from './kit';
import {PressableScale} from './motion';
import {LightSurface} from './LightSurface';
import {CarImage} from './CarImage';
import type {VinModel} from './vinCar';
import {ago,day} from './format';
import {dueText,intervalOf,kmText,money,typedNumber,type Due} from './service';
import {localizeService} from './serviceTerms';
import {locale,t} from './i18n';

export type Km={km:number;estimated:boolean}|null;
const longDate=(at:number)=>new Date(at*1000).toLocaleDateString(locale(),{weekday:'short',day:'numeric',month:'short',year:'numeric'});

/** One service in the history: its date, what was done, kilometres and price, and how far its reminder is. */
export const ServiceRow=memo(function ServiceRow({record:d,due,onOpen}:{record:any;due:Due|null;onOpen:(r:any)=>void}){
 const facts=[d.odometerKm!=null?kmText(d.odometerKm):null,d.actualCost!=null?money(d.actualCost,d.currency):null].filter(Boolean).join(' · ');
 return <PressableScale accessibilityRole="button" onPress={()=>onOpen(d)} style={[ui.card,s.row]}>
  <IconTile icon="construct" tone="green" size={48}/>
  <View style={{flex:1}}>
   <Text style={type.overline} numberOfLines={1}>{d.observedAt?`${day(d.observedAt)} · ${ago(d.observedAt)}`:t('Undated')}</Text>
   <Text style={s.rowTitle} numberOfLines={2}>{localizeService(d.description)}</Text>
   {facts?<Text style={s.meta} numberOfLines={1}>{facts}</Text>:null}
   {due?<View style={{marginTop:8}}><Chip tone={due.tone} icon={due.tone==='red'?'alert-circle':'time-outline'} label={dueText(due)}/></View>:null}
  </View>
  <Icon name="chevron-forward" size={16} color={c.faint}/>
 </PressableScale>;
});

/** A full page for one service, like a trip: the date and what was done up front, then kilometres, price and reminder. */
export function ServiceDetail({record:r,vehicleName,vinModel,km,due,onClose,onEdit,onDelete}:{record:any;vehicleName?:string;vinModel?:VinModel|null;km:Km;due:Due|null;onClose:()=>void;onEdit:(r:any)=>void;onDelete:(r:any)=>Promise<void>}){
 const insets=useSafeAreaInsets(),[busy,run]=useAction();
 const since=km&&r.odometerKm!=null&&km.km>=r.odometerKm?km.km-r.odometerKm:null;
 const confirmDelete=()=>Alert.alert(t('Delete this service?'),t('It is removed from the history on every phone.'),[
  {text:t('Cancel'),style:'cancel'},
  {text:t('Delete'),style:'destructive',onPress:()=>{void run(async()=>{await onDelete(r);onClose();});}},
 ]);
 return <View style={s.page}>
  <StatusBar style="dark"/>
  <ScrollView contentContainerStyle={{padding:16,paddingTop:insets.top+10,paddingBottom:130+insets.bottom}}>
   <View style={[ui.row,{marginBottom:14}]}>
    <PressableScale accessibilityRole="button" accessibilityLabel={t('Back to service')} onPress={onClose} style={s.back}>
     <Icon name="arrow-back" size={18} color={c.ink}/><Text style={s.backText}>{t('Service')}</Text>
    </PressableScale>
   </View>

   <View style={s.hero}>
    <LightSurface/>
    <Text style={s.heroOver} numberOfLines={1}>{longDate(r.observedAt)}</Text>
    <Text style={s.heroTitle} numberOfLines={4}>{localizeService(r.description)}</Text>
    <View style={s.heroStats}>
     <HeroStat label={t('Kilometres')} value={r.odometerKm!=null?kmText(r.odometerKm):'—'}/>
     <View style={s.heroDivider}/>
     <HeroStat label={t('Price')} value={r.actualCost!=null?money(r.actualCost,r.currency):'—'}/>
     <View style={s.heroDivider}/>
     <HeroStat label={t('Due again')} value={r.nextDueKm!=null?kmText(r.nextDueKm):'—'}/>
    </View>
    <View style={[ui.row,{gap:8,marginTop:16,flexWrap:'wrap'}]}>
     {due?<Chip tone={due.tone} icon={due.tone==='red'?'alert-circle':'time-outline'} label={dueText(due)}/>:r.nextDueKm!=null?<Chip tone="green" icon="checkmark" label={t('Done again since')}/>:<Chip icon="checkmark" tone="green" label={t('Recorded')}/>}
    </View>
    <View style={s.heroCar} pointerEvents="none"><CarImage vinModel={vinModel} width={150}/></View>
   </View>

   <Section title={t('Overview')}/>
   <View style={s.grid}>
    <Tile style={s.half} icon="speedometer-outline" label={t('Since this service')} value={since!=null?Math.round(since).toLocaleString(locale()):'—'} unit={since!=null?t('km'):undefined} caption={since!=null?(km?.estimated?t('Estimated from your recorded drives'):t('From the odometer')):t('Add the kilometres to see this')}/>
    <Tile style={s.half} icon="notifications-outline" tone={due?.tone==='red'?'red':due?.tone==='amber'?'amber':'green'} label={t('Reminder')} value={r.nextDueKm!=null?kmText(r.nextDueKm):t('Off')} caption={due?dueText(due):intervalOf(r)!=null?t('Every {km}',{km:kmText(intervalOf(r) as number)}):undefined}/>
   </View>

   {r.notes?<View style={ui.card}><Text style={[ui.title,{marginBottom:8}]}>{t('Notes')}</Text><Text style={ui.body}>{r.notes}</Text></View>:null}
   {vehicleName?<Text style={[ui.caption,{textAlign:'center',marginTop:4}]}>{vehicleName}</Text>:null}
  </ScrollView>

  <View style={[s.footer,{paddingBottom:Math.max(insets.bottom,12)+4}]}>
   <Button title={t('Delete')} icon="trash-outline" kind="light" disabled={busy} onPress={confirmDelete} style={{flex:1,marginVertical:0}}/>
   <Button title={t('Edit details')} icon="create-outline" disabled={busy} onPress={()=>onEdit(r)} style={{flex:1,marginVertical:0}}/>
  </View>
 </View>;
}

function HeroStat({label,value}:{label:string;value:string}){
 return <View style={{flex:1}}><Text style={s.heroStatValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={s.heroStatLabel} numberOfLines={1}>{label}</Text></View>;
}

// Quick starting points, not categories: the text stays free. The number is the usual distance before it is due again.
const IDEAS:[string,number][]=[['Oil change',10000],['Oil filter',10000],['Air filter',20000],['Brake pads',0],['Tyres',0],['Battery',0],['Coolant',0],['Repair',0]];
const INTERVALS=[5000,10000,15000,20000];
const sameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();

/** What the form hands back; the server stores it as the service record. */
export type ServiceFields={description:string;observedAt:number;odometerKm:number|null;actualCost:number|null;currency:string;notes:string|null;nextDueKm:number|null};

/** The add and edit form. Free text for what was done, then date, kilometres, price, a reminder and notes. */
export function ServiceForm({open,record,draft,guessKm,onClose,onSave}:{open:boolean;record?:any;draft?:string;guessKm:number|null;onClose:()=>void;onSave:(fields:ServiceFields)=>Promise<void>}){
 const insets=useSafeAreaInsets(),[busy,run]=useAction(),[keyboard,setKeyboard]=useState(0);
 const [what,setWhat]=useState(''),[date,setDate]=useState(new Date()),[pickDate,setPickDate]=useState(false),[km,setKm]=useState(''),[price,setPrice]=useState(''),[notes,setNotes]=useState('');
 const [every,setEvery]=useState<number|'other'>(0),[custom,setCustom]=useState(''),[touched,setTouched]=useState(false);
 // Android does not resize an edge-to-edge modal for the keyboard: lift the form by its height (iOS pads it instead).
 useEffect(()=>{
  if(Platform.OS!=='android'||!open)return;
  const show=Keyboard.addListener('keyboardDidShow',e=>setKeyboard(e.endCoordinates.height)),hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboard(0));
  return()=>{show.remove();hide.remove();setKeyboard(0);};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  setTouched(false);setPickDate(false);
  if(record){
   const gap=intervalOf(record);
   setWhat(record.description||'');setDate(new Date(record.observedAt*1000));setKm(record.odometerKm!=null?String(Math.round(record.odometerKm)):'');
   setPrice(record.actualCost!=null?String(record.actualCost):'');setNotes(record.notes||'');
   setEvery(gap==null?0:INTERVALS.includes(gap)?gap:'other');setCustom(gap!=null&&!INTERVALS.includes(gap)?String(Math.round(gap)):'');
  }else{
   setWhat(draft||'');setDate(new Date());setKm(guessKm!=null?String(Math.round(guessKm)):'');setPrice('');setNotes('');setEvery(0);setCustom('');
  }
 },[open,record?.id,draft]);
 const odometer=typedNumber(km),cost=typedNumber(price),gap=every==='other'?typedNumber(custom):every||null;
 const kmBad=km.trim()!==''&&odometer==null,priceBad=price.trim()!==''&&cost==null,gapBad=every==='other'&&custom.trim()!==''&&gap==null;
 const needKm=!!gap&&odometer==null;
 const valid=!!what.trim()&&!kmBad&&!priceBad&&!gapBad&&!needKm;
 const idea=(text:string,usual:number)=>{
  setWhat(w=>!w.trim()?text:w.toLowerCase().includes(text.toLowerCase())?w:`${w.trim()}, ${text.toLowerCase()}`);
  if(!touched&&usual)setEvery(usual);
 };
 const choose=(v:number|'other')=>{setTouched(true);setEvery(v);};
 const chooseDate=()=>{
  if(Platform.OS==='android')DateTimePickerAndroid.open({value:date,mode:'date',maximumDate:new Date(),onChange:(e,d)=>{if(e.type==='set'&&d)setDate(d);}});
  else setPickDate(p=>!p);
 };
 const save=()=>run(async()=>{
  // Today keeps the current time, so records of one day stay in the order they were entered; an earlier day is noon.
  const now=new Date(),at=sameDay(date,now)?now:new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  await onSave({description:what.trim(),observedAt:Math.floor(at.getTime()/1000),odometerKm:odometer,actualCost:cost,currency:record?.currency||'EUR',notes:notes.trim()||null,nextDueKm:gap&&odometer!=null?Math.round(odometer+gap):null});
  onClose();
 });
 return <Modal visible={open} animationType="slide" onRequestClose={onClose}>
  <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={[s.page,{paddingBottom:keyboard}]}>
   <StatusBar style="dark"/>
   <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{padding:16,paddingTop:insets.top+10,paddingBottom:keyboard?24:120+insets.bottom}}>
    <View style={[ui.row,{marginBottom:14,justifyContent:'space-between'}]}>
     <PressableScale accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={s.back}><Icon name="close" size={18} color={c.ink}/><Text style={s.backText}>{t('Cancel')}</Text></PressableScale>
    </View>
    <Text style={[type.h1,{marginBottom:18}]} accessibilityRole="header">{record?t('Edit service'):t('Add service')}</Text>

    <Text style={s.label}>{t('What was done')}</Text>
    <TextInput accessibilityLabel={t('What was done')} style={[ui.input,{marginBottom:8}]} value={what} onChangeText={setWhat} maxLength={300} multiline placeholder={t('For example: engine oil change 5W-30')} placeholderTextColor={c.faint}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingBottom:16}}>
     {IDEAS.map(([text,usual])=><Pressable key={text} accessibilityRole="button" onPress={()=>idea(t(text),usual)} style={s.idea}><Text style={s.ideaText}>{t(text)}</Text></Pressable>)}
    </ScrollView>

    <Text style={s.label}>{t('Date')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Date')} onPress={chooseDate} style={[ui.input,s.dateButton]}>
     <Text style={s.dateText}>{date.toLocaleDateString(locale(),{day:'numeric',month:'long',year:'numeric'})}</Text>
     <Icon name="calendar-outline" size={18} color={c.muted}/>
    </Pressable>
    {pickDate&&Platform.OS==='ios'?<DateTimePicker value={date} mode="date" display="inline" maximumDate={new Date()} onChange={(_,d)=>{if(d)setDate(d);}}/>:null}

    <View style={[ui.row,{gap:12,alignItems:'flex-start'}]}>
     <View style={{flex:1}}>
      <Text style={s.label}>{t('Kilometres')}</Text>
      <TextInput accessibilityLabel={t('Kilometres')} style={[ui.input,kmBad&&s.bad]} value={km} onChangeText={setKm} keyboardType="numeric" maxLength={9} placeholder={guessKm!=null?String(Math.round(guessKm)):t('Odometer')} placeholderTextColor={c.faint}/>
     </View>
     <View style={{flex:1}}>
      <Text style={s.label}>{t('Price')} ({record?.currency||'EUR'})</Text>
      <TextInput accessibilityLabel={t('Price')} style={[ui.input,priceBad&&s.bad]} value={price} onChangeText={setPrice} keyboardType="decimal-pad" maxLength={10} placeholder="0.00" placeholderTextColor={c.faint}/>
     </View>
    </View>
    {guessKm!=null&&km.trim()===''?<Pressable accessibilityRole="button" onPress={()=>setKm(String(Math.round(guessKm)))} style={{marginTop:-2,marginBottom:12}}><Text style={s.link}>{t('Use the car\'s {km}',{km:kmText(guessKm)})}</Text></Pressable>:null}

    <Text style={s.label}>{t('Remind me after')}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingBottom:10}}>
     {([0,...INTERVALS,'other'] as (number|'other')[]).map(v=>{const on=every===v;return <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>choose(v)} style={[s.choice,on&&s.choiceOn]}>
      <Text style={[s.choiceText,on&&{color:'#fff'}]}>{v===0?t('Off'):v==='other'?t('Other'):kmText(v)}</Text>
     </Pressable>;})}
    </ScrollView>
    {every==='other'?<TextInput accessibilityLabel={t('Kilometres until it is due again')} style={[ui.input,gapBad&&s.bad]} value={custom} onChangeText={setCustom} keyboardType="numeric" maxLength={7} placeholder={t('Kilometres until it is due again')} placeholderTextColor={c.faint}/>:null}
    {gap&&odometer!=null?<Text style={[ui.caption,{marginBottom:12}]}>{t('Due again at {km}',{km:kmText(odometer+gap)})}</Text>:null}
    {needKm?<Text style={[ui.caption,{marginBottom:12,color:c.amber}]}>{t('Enter the kilometres to get a reminder.')}</Text>:null}

    <Text style={s.label}>{t('Notes')} <Text style={s.optional}>· {t('optional')}</Text></Text>
    <TextInput accessibilityLabel={t('Notes')} style={[ui.input,{minHeight:84,textAlignVertical:'top'}]} value={notes} onChangeText={setNotes} multiline maxLength={4000} placeholder={t('Workshop, parts, brand of oil…')} placeholderTextColor={c.faint}/>
   </ScrollView>
   <View style={[s.footer,{paddingBottom:keyboard?12:Math.max(insets.bottom,12)+4}]}>
    <Button title={busy?t('Saving…'):t('Save')} icon="checkmark" disabled={busy||!valid} onPress={save} style={{flex:1,marginVertical:0}}/>
   </View>
  </KeyboardAvoidingView>
 </Modal>;
}

const s=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},
 row:{flexDirection:'row',alignItems:'center',gap:14,padding:12},
 rowTitle:{fontFamily:F[700],fontSize:16,color:c.ink,letterSpacing:-0.2,marginTop:3},
 meta:{fontFamily:F[600],fontSize:13,color:c.muted,marginTop:3,fontVariant:['tabular-nums']},
 back:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:c.frost,borderRadius:radius.pill,paddingVertical:10,paddingHorizontal:14,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...shadow},
 backText:{fontFamily:F[700],fontSize:14,color:c.ink},
 hero:{borderRadius:radius.xl,padding:20,marginBottom:14,overflow:'hidden',minHeight:220,backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line},
 heroOver:{fontFamily:F[700],fontSize:10.5,letterSpacing:1.6,textTransform:'uppercase',color:c.muted},
 heroTitle:{fontFamily:F[600],fontSize:27,lineHeight:33,letterSpacing:-0.8,color:c.ink,marginTop:8,marginRight:96},
 heroStats:{flexDirection:'row',alignItems:'center',backgroundColor:c.surface,borderRadius:radius.md,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,paddingVertical:12,paddingHorizontal:14,marginTop:18,gap:12},
 heroDivider:{width:StyleSheet.hairlineWidth,alignSelf:'stretch',backgroundColor:c.line},
 heroStatValue:{fontFamily:F[600],fontSize:16,color:c.ink,fontVariant:['tabular-nums']},
 heroStatLabel:{fontFamily:F[600],fontSize:11.5,color:c.muted,marginTop:2},
 heroCar:{position:'absolute',right:-34,top:6},
 grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12,marginBottom:14},
 half:{width:'48.4%'},
 footer:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:c.frost,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,paddingHorizontal:20,paddingTop:14,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine},
 label:{fontFamily:F[700],fontSize:13,color:c.ink2,marginBottom:6},
 optional:{fontFamily:F[500],color:c.muted},
 bad:{borderColor:c.red},
 link:{fontFamily:F[700],fontSize:13,color:c.blue},
 dateButton:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 dateText:{fontFamily:F[600],fontSize:15,color:c.ink},
 idea:{borderWidth:1,borderColor:c.line,backgroundColor:c.surface,borderRadius:radius.pill,paddingVertical:7,paddingHorizontal:14,minHeight:36,justifyContent:'center'},
 ideaText:{fontFamily:F[600],fontSize:13,color:c.ink2},
 choice:{borderWidth:1,borderColor:c.line,backgroundColor:c.surface,borderRadius:radius.pill,paddingVertical:7,paddingHorizontal:14,minHeight:36,justifyContent:'center'},
 choiceOn:{backgroundColor:c.blue,borderColor:c.blue},
 choiceText:{fontFamily:F[600],fontSize:13,color:c.ink2,fontVariant:['tabular-nums']},
});
