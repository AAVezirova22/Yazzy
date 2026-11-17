import type {ComponentProps,ReactNode} from 'react';
import {Pressable,StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {c,shadow,ui} from './theme';

type IconName=ComponentProps<typeof Ionicons>['name'];
export function Icon({name,size=18,color=c.ink2}:{name:string;size?:number;color?:string}){return <Ionicons name={name as IconName} size={size} color={color}/>;}

/** Pill button. "primary" is the blue call to action, "light" a white button, "dark" sits on night surfaces. */
export function Button({title,onPress,icon,kind='primary',disabled=false,style}:{title:string;onPress:()=>void;icon?:string;kind?:'primary'|'light'|'dark'|'danger';disabled?:boolean;style?:StyleProp<ViewStyle>}){
 const bg=kind==='primary'?c.blue:kind==='danger'?c.red:kind==='dark'?c.night:c.surface,fg=kind==='light'?c.ink:'#fff';
 return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
  style={({pressed})=>[s.button,{backgroundColor:bg},kind==='light'&&s.buttonLight,disabled&&{opacity:0.45},pressed&&{opacity:0.85},style]}>
  {icon?<View style={[s.buttonIcon,kind==='light'&&{backgroundColor:c.blue50}]}><Icon name={icon} size={15} color={kind==='light'?c.blue:'#fff'}/></View>:null}
  <Text style={[s.buttonText,{color:fg}]}>{title}</Text>
 </Pressable>;
}

/** Round icon button, white with a soft shadow, as used over maps and in screen headers. */
export function RoundButton({icon,onPress,label,dark=false,size=42}:{icon:string;onPress:()=>void;label:string;dark?:boolean;size?:number}){
 return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
  style={({pressed})=>[s.round,{width:size,height:size,borderRadius:size/2},dark?{backgroundColor:'rgba(255,255,255,0.1)'}:{backgroundColor:c.surface,...shadow},pressed&&{opacity:0.8}]}>
  <Icon name={icon} size={19} color={dark?'#fff':c.ink}/>
 </Pressable>;
}

export function ScreenHeader({title,subtitle,right}:{title:string;subtitle?:string;right?:ReactNode}){
 return <View style={s.header}>
  <View style={{flex:1}}><Text style={s.headerTitle}>{title}</Text>{subtitle?<Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text>:null}</View>
  {right}
 </View>;
}

export function Segment({items,value,onChange}:{items:[string,string][];value:string;onChange:(v:string)=>void}){
 return <View style={s.segment}>{items.map(([key,label])=>{const on=value===key;return <Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:on}} onPress={()=>onChange(key)} style={[s.segmentItem,on&&s.segmentOn]}>
  <Text style={[s.segmentText,on&&{color:c.ink}]}>{label}</Text>
 </Pressable>;})}</View>;
}

/** Small tappable stat card: title with a chevron, a big value and a caption. */
export function Stat({title,value,unit,caption,icon,tone,onPress,style,children}:{title:string;value:string;unit?:string;caption?:string;icon?:string;tone?:'warn'|'ok';onPress?:()=>void;style?:StyleProp<ViewStyle>;children?:ReactNode}){
 const accent=tone==='warn'?c.amber:tone==='ok'?c.green:c.blue;
 return <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${value}${unit?' '+unit:''}${caption?'. '+caption:''}`} disabled={!onPress} onPress={onPress} style={({pressed})=>[s.stat,pressed&&{opacity:0.9},style]}>
  <View style={[ui.row,{justifyContent:'space-between'}]}>
   <View style={[ui.row,{gap:7,flex:1}]}>{icon?<Icon name={icon} size={16} color={accent}/>:null}<Text style={s.statTitle} numberOfLines={1}>{title}</Text></View>
   {onPress?<Icon name="chevron-forward" size={16} color={c.ink}/>:null}
  </View>
  <Text style={[ui.value,{fontSize:22,marginTop:14},tone==='warn'&&{color:c.amber}]} numberOfLines={1}>{value}{unit?<Text style={ui.unit}> {unit}</Text>:null}</Text>
  {caption?<Text style={[ui.caption,{marginTop:2}]} numberOfLines={2}>{caption}</Text>:null}
  {children}
 </Pressable>;
}

export function Check({ok,label}:{ok:boolean;label:string}){
 return <View style={s.check}>
  <View style={[s.checkDot,ok?{backgroundColor:c.green}:{borderWidth:1.5,borderColor:c.faint}]}>{ok?<Icon name="checkmark" size={13} color="#fff"/>:null}</View>
  <Text style={[s.checkText,!ok&&{color:c.muted}]}>{label}</Text>
 </View>;
}

/** Inline notice: neutral, success, warning or error. */
export function Notice({tone='info',icon,children}:{tone?:'info'|'ok'|'warn'|'error';icon?:string;children:ReactNode}){
 const fg=tone==='ok'?c.green:tone==='warn'?c.amber:tone==='error'?c.red:c.blue,bg=tone==='ok'?c.green50:tone==='warn'?c.amber50:tone==='error'?c.red50:c.blue50;
 return <View style={[s.notice,{backgroundColor:bg}]}>
  <Icon name={icon||(tone==='error'?'alert-circle':tone==='warn'?'warning':tone==='ok'?'checkmark-circle':'information-circle')} size={18} color={fg}/>
  <Text style={[s.noticeText,tone==='error'&&{color:c.red}]}>{children}</Text>
 </View>;
}

export function Empty({icon,title,text}:{icon:string;title:string;text:string}){
 return <View style={[ui.card,{alignItems:'center',paddingVertical:32}]}>
  <View style={s.emptyIcon}><Icon name={icon} size={24} color={c.blue}/></View>
  <Text style={[ui.title,{marginTop:12}]}>{title}</Text>
  <Text style={[ui.body,{textAlign:'center',marginTop:4}]}>{text}</Text>
 </View>;
}

const s=StyleSheet.create({
 button:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,borderRadius:999,minHeight:52,paddingHorizontal:20,marginVertical:5},
 buttonLight:{...shadow},
 buttonIcon:{width:26,height:26,borderRadius:13,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
 buttonText:{fontSize:15,fontWeight:'700'},
 round:{alignItems:'center',justifyContent:'center'},
 header:{flexDirection:'row',alignItems:'center',gap:12,marginTop:8,marginBottom:16},
 headerTitle:{fontSize:28,fontWeight:'800',color:c.ink,letterSpacing:-0.8},
 headerSub:{fontSize:14,color:c.muted,marginTop:2},
 segment:{flexDirection:'row',backgroundColor:c.track,borderRadius:999,padding:4,marginBottom:16},
 segmentItem:{flex:1,paddingVertical:10,borderRadius:999,alignItems:'center'},
 segmentOn:{backgroundColor:c.surface,...shadow,shadowOpacity:0.06,elevation:2},
 segmentText:{fontSize:14,fontWeight:'700',color:c.muted},
 stat:{backgroundColor:c.surface,borderRadius:22,padding:16,...shadow},
 statTitle:{fontSize:15,fontWeight:'700',color:c.ink},
 check:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:8},
 checkDot:{width:22,height:22,borderRadius:11,alignItems:'center',justifyContent:'center'},
 checkText:{fontSize:14.5,color:c.ink,fontWeight:'500',flex:1},
 notice:{flexDirection:'row',gap:10,alignItems:'flex-start',borderRadius:16,padding:14,marginBottom:14},
 noticeText:{flex:1,fontSize:13.5,lineHeight:19,color:c.ink2},
 emptyIcon:{width:56,height:56,borderRadius:28,backgroundColor:c.blue50,alignItems:'center',justifyContent:'center'},
});
