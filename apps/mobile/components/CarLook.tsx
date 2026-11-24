import {useEffect,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Sheet} from './Sheet';
import {CarImage} from './CarImage';
import {c,F} from './theme';
import {Button,Icon} from './kit';
import {haptic} from './motion';
import {COLORS,DEFAULT_LOOK,setLook,useLook,vehicleOf,type Look} from './lookStore';
import type {VinModel} from './vinCar';
import {t} from './i18n';

/**
 * Tapping the car: pick its metallic paint and which way it faces. Both are made by our server from the stored
 * picture, so they never use a picture of the plan.
 */
export function CarLook({open,vinModel,onClose}:{open:boolean;vinModel?:VinModel|null;onClose:()=>void}){
 const vehicle=vehicleOf(vinModel?.picture),saved=useLook(vehicle),[look,setDraft]=useState<Look>(saved);
 useEffect(()=>{if(open)setDraft(saved);},[open,vehicle]);
 if(!vehicle)return null;
 const choose=(next:Look)=>{haptic.step();setDraft(next);};
 return <Sheet open={open} onClose={onClose} title={t('Your car')}>
  <ScrollView style={{maxHeight:560}} contentContainerStyle={{paddingBottom:8}}>
   <View style={s.preview}><CarImage vinModel={vinModel} width={300} look={look}/></View>
   <Text style={s.label}>{t('Colour')}</Text>
   <View style={s.swatches}>
    {COLORS.map(([hex,name])=>{const on=look.color===hex;return <Pressable key={hex} accessibilityRole="button" accessibilityLabel={t(name)} accessibilityState={{selected:on}} onPress={()=>choose({...look,color:hex})} style={s.swatchCell}>
     <View style={[s.swatch,{backgroundColor:'#'+hex},on&&s.swatchOn]}>
      <View style={s.shine}/>
      {on?<Icon name="checkmark" size={16} color={parseInt(hex.slice(0,2),16)>180?c.ink:'#fff'}/>:null}
     </View>
     <Text style={[s.swatchName,on&&{color:c.ink}]} numberOfLines={2}>{t(name)}</Text>
    </Pressable>;})}
   </View>
   <Pressable accessibilityRole="button" onPress={()=>choose({...look,flip:!look.flip})} style={s.flip}>
    <Icon name="swap-horizontal" size={18} color={c.blue}/><Text style={s.flipText}>{look.flip?t('Facing right'):t('Facing left')}</Text>
   </Pressable>
   <Button title={t('Save')} icon="checkmark" onPress={()=>{setLook(vehicle,look);onClose();}}/>
   {look.color!==DEFAULT_LOOK.color||look.flip?<Button kind="light" title={t('Back to default')} onPress={()=>choose(DEFAULT_LOOK)}/>:null}
  </ScrollView>
 </Sheet>;
}

const s=StyleSheet.create({
 preview:{alignItems:'center',paddingVertical:6,marginBottom:6},
 label:{fontFamily:F[700],fontSize:12,letterSpacing:1.2,textTransform:'uppercase',color:c.muted,marginTop:10,marginBottom:8},
 swatches:{flexDirection:'row',flexWrap:'wrap',rowGap:10},
 swatchCell:{width:'25%',alignItems:'center',gap:4},
 swatch:{width:40,height:40,borderRadius:20,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,alignItems:'center',justifyContent:'center',overflow:'hidden'},
 // A soft highlight across the swatch, so the dots read as metallic paint, not flat colour.
 shine:{position:'absolute',top:3,left:7,width:20,height:11,borderRadius:8,backgroundColor:'rgba(255,255,255,0.35)',transform:[{rotate:'-20deg'}]},
 swatchOn:{borderWidth:2,borderColor:c.blue},
 swatchName:{fontFamily:F[500],fontSize:11.5,color:c.muted,textAlign:'center'},
 flip:{flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start',paddingVertical:12,minHeight:44},
 flipText:{fontFamily:F[600],fontSize:14,color:c.blue},
});
