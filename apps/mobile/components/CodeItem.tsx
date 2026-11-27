import {useMemo,useState} from 'react';
import {LayoutAnimation,Pressable,StyleSheet,Text,View} from 'react-native';
import {c,F,mono,radius,type,ui} from './theme';
import {Icon} from './kit';
import {haptic} from './motion';
import {describeCode} from './car';
import {codeDetail} from './codeInfo';
import {t} from './i18n';

/**
 * One fault code: the code and its short name. Tap it to open what it means, what usually causes it and what to do.
 * "Pending" and "permanent" codes say so inside the explanation, not on the row.
 */
export function CodeItem({code,kind}:{code:string;kind?:'Pending'|'Permanent'}){
 const [open,setOpen]=useState(false),detail=useMemo(()=>codeDetail(code),[code]);
 const toggle=()=>{LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);haptic.step();setOpen(o=>!o);};
 const note=kind==='Pending'?t('Pending: the car saw this once and has not confirmed it yet.'):kind==='Permanent'?t('Permanent: the car clears this only after it re-tests and finds the fault gone.'):detail.note;
 return <View style={s.item}>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${code}. ${describeCode(code)}`} onPress={toggle} style={({pressed})=>[s.row,pressed&&{opacity:0.7}]}>
   <View style={s.tag}><Text style={s.tagText}>{code}</Text></View>
   <Text style={s.title}>{describeCode(code)}</Text>
   <Icon name={open?'chevron-up':'chevron-down'} size={18} color={c.faint}/>
  </Pressable>
  {open?<View style={s.detail}>
   <Text style={type.overline}>{t('What it means')}</Text>
   <Text style={s.body}>{detail.what}</Text>
   {detail.causes?<><Text style={[type.overline,s.gap]}>{t('Common causes')}</Text><Text style={s.body}>{detail.causes}</Text></>:null}
   {detail.advice?<><Text style={[type.overline,s.gap]}>{t('What to do')}</Text><Text style={s.body}>{detail.advice}</Text></>:null}
   {note?<Text style={[ui.caption,s.gap]}>{note}</Text>:null}
  </View>:null}
 </View>;
}

const s=StyleSheet.create({
 item:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 row:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:11},
 tag:{backgroundColor:c.amber50,borderRadius:radius.sm,paddingVertical:5,paddingHorizontal:9},
 tagText:{fontFamily:mono,fontSize:13,fontWeight:'700',color:c.amber},
 title:{flex:1,fontFamily:F[600],fontSize:14,color:c.ink},
 detail:{backgroundColor:c.surface2,borderRadius:radius.md,padding:14,marginBottom:12},
 body:{fontFamily:F[500],fontSize:14,lineHeight:20,color:c.ink2,marginTop:4},
 gap:{marginTop:12},
});
