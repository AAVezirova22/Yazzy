import {StyleSheet,Text,View} from 'react-native';
import {c,mono,type} from './theme';
import {t} from './i18n';

const KINDS:[string,string][]=[['03','Stored'],['07','Pending'],['0A','Permanent']];

/** The car's own reply to each code request, word for word, so a code can be checked against another scanner. */
export function CodeReplies({replies}:{replies?:Record<string,string>}){
 const rows=KINDS.filter(([command])=>replies?.[command]);
 if(!rows.length)return null;
 return <View style={s.box}>
  <Text style={type.overline}>{t('As the car sent it')}</Text>
  {rows.map(([command,kind])=><Text key={command} style={s.line} selectable>{t(kind)} ({command}): {replies?.[command]}</Text>)}
 </View>;
}

const s=StyleSheet.create({
 box:{marginTop:12,gap:4},
 line:{fontFamily:mono,fontSize:12,lineHeight:17,color:c.ink2},
});
