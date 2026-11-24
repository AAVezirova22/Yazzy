import {useEffect,useState} from 'react';
import {Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Sheet} from './Sheet';
import {CarImage} from './CarImage';
import {c,F,radius,ui} from './theme';
import {Button,Icon,useAction} from './kit';
import {haptic} from './motion';
import {server} from './server';
import {COLORS,DEFAULT_LOOK,setLook,useLook,vehicleOf,VIEWS,type Look} from './lookStore';
import type {VinModel} from './vinCar';
import {t} from './i18n';

const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/**
 * Tapping the car: pick its paint and view, and which way it faces. Paint and facing are free and instant. A view
 * the server has not fetched before uses one of the picture plan's free pictures, so the sheet says how many are
 * left and asks first; once fetched, every colour of that view is free too.
 */
export function CarLook({open,vinModel,onClose}:{open:boolean;vinModel?:VinModel|null;onClose:()=>void}){
 const vehicle=vehicleOf(vinModel?.picture),saved=useLook(vehicle);
 const [look,setDraft]=useState<Look>(saved),[views,setViews]=useState<Record<string,string>>({}),[left,setLeft]=useState<number|null>(null),[busy,run]=useAction();
 useEffect(()=>{
  if(!open||!vehicle)return;
  setDraft(saved);
  server.call(`/car-pictures/${vehicle}/views`).then(r=>{setViews(r.views||{});setLeft(typeof r.remaining==='number'?r.remaining:null);}).catch(()=>{});
 },[open,vehicle]);
 if(!vehicle)return null;
 const choose=(next:Look)=>{haptic.step();setDraft(next);};
 const pickView=(view:string)=>{
  if(views[view]==='READY'){choose({...look,view});return;}
  const fetchIt=()=>run(async()=>{
   let r=await server.call(`/car-pictures/${vehicle}/views/${view}`,{});
   for(let i=0;i<8&&r.status==='PENDING';i++){await wait(4000);r=await server.call(`/car-pictures/${vehicle}/views/${view}`,{});}
   setViews(v=>({...v,[view]:r.status}));
   if(r.status==='READY'){setLeft(n=>n!=null?Math.max(0,n-1):n);choose({...look,view});}
   else if(r.status==='PENDING')Alert.alert(t('Still preparing'),t('This view is being prepared. Open this again in a minute.'));
   else Alert.alert(t('Not available'),t('The picture service has no such view of this car.'));
  });
  if(left===0){Alert.alert(t('No free pictures left'),t('All free pictures of the picture plan are used. The views you already have stay available.'));return;}
  Alert.alert(t('New view'),left!=null?t('This view uses 1 of your {n} free pictures, once. After that every colour of it is free.',{n:left}):t('This view uses 1 free picture, once. After that every colour of it is free.'),
   [{text:t('Cancel'),style:'cancel'},{text:t('Use 1 picture'),onPress:fetchIt}]);
 };
 return <Sheet open={open} onClose={onClose} title={t('Your car')}>
  <ScrollView style={{maxHeight:560}} contentContainerStyle={{paddingBottom:8}}>
   <View style={s.preview}><CarImage vinModel={vinModel} width={300} look={look}/></View>
   <Text style={s.label}>{t('Colour')}</Text>
   <View style={s.swatches}>
    {COLORS.map(([hex,name])=>{const on=look.color===hex;return <Pressable key={hex} accessibilityRole="button" accessibilityLabel={t(name)} accessibilityState={{selected:on}} onPress={()=>choose({...look,color:hex})} style={s.swatchCell}>
     <View style={[s.swatch,{backgroundColor:'#'+hex},on&&s.swatchOn]}>{on?<Icon name="checkmark" size={16} color={parseInt(hex.slice(0,2),16)>180?c.ink:'#fff'}/>:null}</View>
     <Text style={[s.swatchName,on&&{color:c.ink}]} numberOfLines={2}>{t(name)}</Text>
    </Pressable>;})}
   </View>
   <Text style={s.label}>{t('View')}</Text>
   <View style={s.views}>
    {VIEWS.map(([view,name])=>{const on=look.view===view,ready=views[view]==='READY';return <Pressable key={view} accessibilityRole="button" accessibilityState={{selected:on}} disabled={busy} onPress={()=>pickView(view)} style={[s.view,on&&s.viewOn]}>
     <Text style={[s.viewText,on&&{color:'#fff'}]}>{t(name)}</Text>
     {!ready&&!on?<Icon name="cloud-download-outline" size={13} color={c.muted}/>:null}
    </Pressable>;})}
   </View>
   <Text style={ui.caption}>{left!=null?t('Colours and facing are free. A new view uses 1 free picture ({n} left).',{n:left}):t('Colours and facing are free. A new view uses 1 free picture.')}</Text>
   <Pressable accessibilityRole="button" onPress={()=>choose({...look,flip:!look.flip})} style={s.flip}>
    <Icon name="swap-horizontal" size={18} color={c.blue}/><Text style={s.flipText}>{look.flip?t('Facing right'):t('Facing left')}</Text>
   </Pressable>
   <Button title={t('Save')} icon="checkmark" disabled={busy} onPress={()=>{setLook(vehicle,look);onClose();}}/>
   {look.color!==DEFAULT_LOOK.color||look.flip||look.view!==DEFAULT_LOOK.view?<Button kind="light" title={t('Back to default')} onPress={()=>choose(DEFAULT_LOOK)}/>:null}
  </ScrollView>
 </Sheet>;
}

const s=StyleSheet.create({
 preview:{alignItems:'center',paddingVertical:6,marginBottom:6},
 label:{fontFamily:F[700],fontSize:12,letterSpacing:1.2,textTransform:'uppercase',color:c.muted,marginTop:10,marginBottom:8},
 swatches:{flexDirection:'row',flexWrap:'wrap',rowGap:10},
 swatchCell:{width:'25%',alignItems:'center',gap:4},
 swatch:{width:40,height:40,borderRadius:20,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,alignItems:'center',justifyContent:'center'},
 swatchOn:{borderWidth:2,borderColor:c.blue},
 swatchName:{fontFamily:F[500],fontSize:11.5,color:c.muted,textAlign:'center'},
 views:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:8},
 view:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderColor:c.line,borderRadius:radius.md,paddingVertical:8,paddingHorizontal:12,minHeight:40,backgroundColor:c.surface},
 viewOn:{backgroundColor:c.blue,borderColor:c.blue},
 viewText:{fontFamily:F[600],fontSize:13.5,color:c.ink},
 flip:{flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start',paddingVertical:12,minHeight:44},
 flipText:{fontFamily:F[600],fontSize:14,color:c.blue},
});
