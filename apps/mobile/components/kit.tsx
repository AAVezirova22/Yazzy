import {useCallback,useEffect,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {Alert,Pressable,StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import Animated,{useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import {c,F,floatShadow,hairline,radius,type,ui} from './theme';
import {EASE_IN_OUT,haptic,PressableScale} from './motion';

type IconName=ComponentProps<typeof Ionicons>['name'];
export function Icon({name,size=18,color=c.ink2}:{name:string;size?:number;color?:string}){return <Ionicons name={name as IconName} size={size} color={color}/>;}

export type Tone='blue'|'green'|'amber'|'red'|'neutral';
const TONES:Record<Tone,[string,string]>={blue:[c.blue,c.blue50],green:[c.green,c.green50],amber:[c.amber,c.amber50],red:[c.red,c.red50],neutral:[c.ink2,c.surface2]};
export const toneOf=(t:Tone)=>TONES[t];

/** Runs a user action with a busy flag; a failure is shown as an alert instead of being lost. */
export function useAction(){
 const [busy,setBusy]=useState(false);
 const run=useCallback(async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();}catch(e){Alert.alert('Yazzy',(e as Error).message);}finally{setBusy(false);}},[]);
 return [busy,run] as const;
}

type ButtonKind='primary'|'light'|'dark'|'danger'|'glass';
/** Square-cornered button. "primary" is the blue call to action, "light" an outlined one, "dark" and "glass" sit on night. */
export function Button({title,onPress,icon,kind='primary',disabled=false,style}:{title:string;onPress:()=>void;icon?:string;kind?:ButtonKind;disabled?:boolean;style?:StyleProp<ViewStyle>}){
 const bg={primary:c.blue,danger:c.red,dark:c.night,light:c.surface,glass:c.glassStrong}[kind],fg=kind==='light'?c.ink:'#fff';
 return <PressableScale accessibilityRole="button" accessibilityState={{disabled}} accessibilityLabel={title} disabled={disabled} onPress={onPress} scale={0.98}
  style={[s.button,{backgroundColor:bg},kind==='light'&&s.buttonLight,kind==='glass'&&s.buttonGlass,disabled&&{opacity:0.4},style]}>
  {icon?<Icon name={icon} size={17} color={kind==='light'?c.blue:'#fff'}/>:null}
  <Text style={[s.buttonText,{color:fg}]} numberOfLines={1}>{title}</Text>
 </PressableScale>;
}

/** Square icon button: white with a hairline over maps and light pages, glass on night surfaces. */
export function RoundButton({icon,onPress,label,dark=false,size=44}:{icon:string;onPress:()=>void;label:string;dark?:boolean;size?:number}){
 return <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} scale={0.94}
  style={[s.square,{width:size,height:size},dark?s.squareGlass:s.squareLight]}>
  <Icon name={icon} size={19} color={dark?'#fff':c.ink}/>
 </PressableScale>;
}

/** A large page title with the context (usually the car) as a small tracked label above it. */
export function ScreenHeader({title,subtitle,right}:{title:string;subtitle?:string;right?:ReactNode}){
 return <View style={s.header}>
  <View style={{flex:1}}>
   {subtitle?<Text style={type.overline} numberOfLines={1}>{subtitle}</Text>:null}
   <Text style={[type.h1,{marginTop:subtitle?6:0}]} accessibilityRole="header">{title}</Text>
  </View>
  {right}
 </View>;
}

/** Section label followed by a hairline rule, with an optional text action. */
export function Section({title,action,onAction}:{title:string;action?:string;onAction?:()=>void}){
 return <View style={s.section}>
  <Text style={type.overline}>{title}</Text>
  <View style={s.rule}/>
  {action&&onAction?<Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}><Text style={s.link}>{action}</Text></Pressable>:null}
 </View>;
}

/**
 * Segmented control: labels on a hairline, with a 2 px bar under the chosen one. The bar travels on the UI thread
 * (ease-in-out, it moves across the control rather than entering), with a selection tick on the press.
 */
export function Segment({items,value,onChange}:{items:[string,string][];value:string;onChange:(v:string)=>void}){
 const [width,setWidth]=useState(0),index=Math.max(0,items.findIndex(([k])=>k===value)),item=width/items.length,x=useSharedValue(0),placed=useRef(false);
 useEffect(()=>{
  if(!item)return;
  // The first placement jumps; only real changes travel.
  if(!placed.current){placed.current=true;x.set(index*item);return;}
  x.set(withTiming(index*item,{duration:220,easing:EASE_IN_OUT}));
 },[index,item]);
 const bar=useAnimatedStyle(()=>({transform:[{translateX:x.get()}]}));
 return <View style={s.segment} accessibilityRole="tablist" onLayout={e=>setWidth(e.nativeEvent.layout.width)}>
  {items.map(([key,label])=>{const on=value===key;return <Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:on}} onPress={()=>{if(!on){haptic.step();onChange(key);}}} style={s.segmentItem}>
   <Text style={[s.segmentText,on&&{color:c.ink}]}>{label}</Text>
  </Pressable>;})}
  {item?<Animated.View pointerEvents="none" style={[s.segmentBar,{width:item},bar]}/>:null}
 </View>;
}

/** Square icon on a tinted ground. */
export function IconTile({icon,tone='blue',size=40}:{icon:string;tone?:Tone;size?:number}){
 const [fg,bg]=TONES[tone];
 return <View style={{width:size,height:size,borderRadius:radius.md,backgroundColor:bg,alignItems:'center',justifyContent:'center'}}><Icon name={icon} size={size*0.45} color={fg}/></View>;
}

/** Small square status tag, uppercase and tracked. "glass" is for night surfaces. */
export function Chip({label,icon,tone='neutral',dot,glass}:{label:string;icon?:string;tone?:Tone;dot?:string;glass?:boolean}){
 const [fg,bg]=TONES[tone];
 return <View style={[s.chip,glass?{backgroundColor:c.glass,borderColor:c.glassLine,borderWidth:StyleSheet.hairlineWidth}:{backgroundColor:bg}]}>
  {dot?<View style={[s.chipDot,{backgroundColor:dot}]}/>:null}
  {icon?<Icon name={icon} size={12} color={glass?'#fff':fg}/>:null}
  <Text style={[s.chipText,{color:glass?'#e8ebf0':fg}]} numberOfLines={1}>{label}</Text>
 </View>;
}

/**
 * A metric tile: a tracked label, one large tabular number with its unit, a caption, and room for a small chart.
 * Flat, on a hairline. Tappable when it leads somewhere.
 */
export function Tile({label,value,unit,caption,icon,tone='blue',onPress,style,children}:{label:string;value:string;unit?:string;caption?:string;icon?:string;tone?:Tone;onPress?:()=>void;style?:StyleProp<ViewStyle>;children?:ReactNode}){
 const [fg]=TONES[tone],warn=tone==='amber'||tone==='red';
 const body=<>
  <View style={[ui.row,{gap:7}]}>
   {icon?<Icon name={icon} size={14} color={fg}/>:null}
   <Text style={[type.overline,{flex:1}]} numberOfLines={1}>{label}</Text>
   {onPress?<Icon name="arrow-forward" size={14} color={c.faint}/>:null}
  </View>
  <Text style={[type.metric,{marginTop:14},warn&&{color:fg}]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}{unit?<Text style={type.unit}> {unit}</Text>:null}</Text>
  {caption?<Text style={[type.caption,{marginTop:3}]} numberOfLines={2}>{caption}</Text>:null}
  {children}
 </>;
 const a11y=`${label}: ${value}${unit?' '+unit:''}${caption?'. '+caption:''}`;
 return onPress?<PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} scale={0.98} style={[s.tile,style]}>{body}</PressableScale>
  :<View accessible accessibilityLabel={a11y} style={[s.tile,style]}>{body}</View>;
}
/** Older name for Tile. */
export const Stat=({title,tone,...rest}:{title:string;value:string;unit?:string;caption?:string;icon?:string;tone?:'warn'|'ok';onPress?:()=>void;style?:StyleProp<ViewStyle>;children?:ReactNode})=>
 <Tile label={title} tone={tone==='warn'?'amber':tone==='ok'?'green':'blue'} {...rest}/>;

/**
 * One row: icon, title, caption, arrow. On its own it is a card; inside a Group (card={false}) rows are separated
 * by hairlines, like a settings list.
 */
export function ListRow({icon,tone='blue',title,caption,onPress,right,card=true,first}:{icon:string;tone?:Tone;title:string;caption?:string;onPress?:()=>void;right?:ReactNode;card?:boolean;first?:boolean}){
 const inner=<>
  <IconTile icon={icon} tone={tone} size={38}/>
  <View style={{flex:1}}><Text style={type.label} numberOfLines={1}>{title}</Text>{caption?<Text style={[type.caption,{marginTop:2}]} numberOfLines={2}>{caption}</Text>:null}</View>
  {right??(onPress?<Icon name="chevron-forward" size={16} color={c.faint}/>:null)}
 </>;
 const style=[s.row,card?[ui.card,{paddingVertical:14}]:[s.rowPlain,!first&&s.rowDivider]];
 return onPress?<PressableScale accessibilityRole="button" accessibilityLabel={caption?`${title}. ${caption}`:title} onPress={onPress} scale={0.985} style={style}>{inner}</PressableScale>:<View style={style}>{inner}</View>;
}

/** A flat card that holds ListRows separated by hairlines. */
export function Group({children}:{children:ReactNode}){return <View style={[ui.card,{paddingVertical:2,paddingHorizontal:0}]}>{children}</View>;}

/** A square glass key with a tracked label under it, for the hero's quick actions. */
export function QuickAction({icon,label,onPress,accent,light=false}:{icon:string;label:string;onPress:()=>void;accent?:boolean;light?:boolean}){
 return <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} tick scale={0.94} style={[s.quick,light&&s.quickLight,light&&accent&&{borderColor:c.blue}]}>
  <View style={[s.quickIcon,light&&s.quickIconLight,accent&&{backgroundColor:c.blue,borderColor:c.blue}]}><Icon name={icon} size={20} color={light&&!accent?c.blue:"#fff"}/></View>
  <Text style={[s.quickLabel,light&&{color:c.ink2}]} numberOfLines={1}>{label}</Text>
 </PressableScale>;
}

export function Check({ok,label}:{ok:boolean;label:string}){
 return <View style={s.check}>
  <View style={[s.checkBox,ok?{backgroundColor:c.green,borderColor:c.green}:null]}>{ok?<Icon name="checkmark" size={13} color="#fff"/>:null}</View>
  <Text style={[s.checkText,!ok&&{color:c.muted}]}>{label}</Text>
 </View>;
}

/** Inline notice with a coloured edge: neutral, success, warning or error. */
export function Notice({tone='info',icon,children}:{tone?:'info'|'ok'|'warn'|'error';icon?:string;children:ReactNode}){
 const fg=tone==='ok'?c.green:tone==='warn'?c.amber:tone==='error'?c.red:c.blue,bg=tone==='ok'?c.green50:tone==='warn'?c.amber50:tone==='error'?c.red50:c.blue50;
 return <View style={[s.notice,{backgroundColor:bg,borderLeftColor:fg}]}>
  <Icon name={icon||(tone==='error'?'alert-circle':tone==='warn'?'warning':tone==='ok'?'checkmark-circle':'information-circle')} size={18} color={fg}/>
  <Text style={[s.noticeText,tone==='error'&&{color:c.red}]}>{children}</Text>
 </View>;
}

export function Empty({icon,title,text}:{icon:string;title:string;text:string}){
 return <View style={[ui.card,{alignItems:'center',paddingVertical:34}]}>
  <IconTile icon={icon} size={52}/>
  <Text style={[type.title,{marginTop:16}]}>{title}</Text>
  <Text style={[type.body,{textAlign:'center',marginTop:4}]}>{text}</Text>
 </View>;
}

const s=StyleSheet.create({
 button:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,borderRadius:radius.pill,minHeight:50,paddingHorizontal:20,marginVertical:5},
 buttonLight:{...hairline},
 buttonGlass:{borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine},
 buttonText:{fontFamily:F[700],fontSize:14.5,letterSpacing:0.2},
 square:{alignItems:'center',justifyContent:'center',borderRadius:radius.md},
 squareLight:{backgroundColor:c.frost,...hairline,...floatShadow,shadowOpacity:0.08,elevation:3},
 squareGlass:{backgroundColor:c.glass,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine},
 header:{flexDirection:'row',alignItems:'flex-end',gap:12,marginTop:10,marginBottom:22},
 section:{flexDirection:'row',alignItems:'center',gap:12,marginTop:14,marginBottom:12},
 rule:{flex:1,height:StyleSheet.hairlineWidth,backgroundColor:c.line},
 link:{fontFamily:F[700],fontSize:12.5,color:c.blue,letterSpacing:0.2},
 segment:{flexDirection:'row',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.line,marginBottom:18},
 segmentItem:{flex:1,paddingVertical:12,alignItems:'center'},
 segmentText:{fontFamily:F[700],fontSize:13,letterSpacing:0.6,textTransform:'uppercase',color:c.faint},
 segmentBar:{position:'absolute',left:0,bottom:-1,height:2,backgroundColor:c.ink},
 chip:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',gap:6,borderRadius:radius.sm,paddingVertical:5,paddingHorizontal:9},
 chipDot:{width:6,height:6,borderRadius:3},
 chipText:{fontFamily:F[700],fontSize:10.5,letterSpacing:0.9,textTransform:'uppercase'},
 tile:{backgroundColor:c.surface,borderRadius:radius.lg,padding:16,...hairline},
 row:{flexDirection:'row',alignItems:'center',gap:14},
 rowPlain:{paddingVertical:14,paddingHorizontal:16},
 rowDivider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 quickLight:{flex:1,width:undefined,minHeight:68,gap:5,justifyContent:'center',paddingVertical:10,backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line,borderRadius:radius.lg},
 quickIconLight:{width:28,height:25,backgroundColor:'transparent',borderWidth:0},
 quick:{alignItems:'center',gap:8,width:74},
 quickIcon:{width:54,height:54,borderRadius:radius.md,backgroundColor:c.glass,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine,alignItems:'center',justifyContent:'center'},
 quickLabel:{fontFamily:F[700],fontSize:10,letterSpacing:1.1,textTransform:'uppercase',color:'#c9cfd8'},
 check:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:8},
 checkBox:{width:20,height:20,borderRadius:radius.sm,borderWidth:1.5,borderColor:c.faint,alignItems:'center',justifyContent:'center'},
 checkText:{fontFamily:F[600],fontSize:14.5,color:c.ink,flex:1},
 notice:{flexDirection:'row',gap:10,alignItems:'flex-start',borderRadius:radius.md,borderLeftWidth:3,padding:14,marginBottom:12},
 noticeText:{flex:1,fontFamily:F[500],fontSize:13.5,lineHeight:19,color:c.ink2},
});
