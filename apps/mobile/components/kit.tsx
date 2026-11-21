import {useCallback,useEffect,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {Alert,Pressable,StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import Animated,{useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import {c,F,floatShadow,radius,shadow,type,ui} from './theme';
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
/** Pill button. "primary" is the blue call to action, "light" a white button, "dark" and "glass" sit on night surfaces. */
export function Button({title,onPress,icon,kind='primary',disabled=false,style}:{title:string;onPress:()=>void;icon?:string;kind?:ButtonKind;disabled?:boolean;style?:StyleProp<ViewStyle>}){
 const bg={primary:c.blue,danger:c.red,dark:c.night,light:c.surface,glass:c.glassStrong}[kind],fg=kind==='light'?c.ink:'#fff';
 return <PressableScale accessibilityRole="button" accessibilityState={{disabled}} accessibilityLabel={title} disabled={disabled} onPress={onPress}
  style={[s.button,{backgroundColor:bg},kind==='light'&&s.buttonLight,kind==='glass'&&s.buttonGlass,disabled&&{opacity:0.45},style]}>
  {icon?<Icon name={icon} size={17} color={kind==='light'?c.blue:'#fff'}/>:null}
  <Text style={[s.buttonText,{color:fg}]} numberOfLines={1}>{title}</Text>
 </PressableScale>;
}

/** Round icon button: frosted white over maps and light pages, glass on night surfaces. */
export function RoundButton({icon,onPress,label,dark=false,size=44}:{icon:string;onPress:()=>void;label:string;dark?:boolean;size?:number}){
 return <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} scale={0.92}
  style={[s.round,{width:size,height:size,borderRadius:size/2},dark?s.roundGlass:s.roundFrost]}>
  <Icon name={icon} size={19} color={dark?'#fff':c.ink}/>
 </PressableScale>;
}

/** A large page title with the context (usually the car) as a small label above it. */
export function ScreenHeader({title,subtitle,right}:{title:string;subtitle?:string;right?:ReactNode}){
 return <View style={s.header}>
  <View style={{flex:1}}>
   {subtitle?<Text style={type.overline} numberOfLines={1}>{subtitle}</Text>:null}
   <Text style={[type.h1,{marginTop:subtitle?4:0}]} accessibilityRole="header">{title}</Text>
  </View>
  {right}
 </View>;
}

/** Section label with an optional text action on the right. */
export function Section({title,action,onAction}:{title:string;action?:string;onAction?:()=>void}){
 return <View style={s.section}>
  <Text style={type.overline}>{title}</Text>
  {action&&onAction?<Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}><Text style={s.link}>{action}</Text></Pressable>:null}
 </View>;
}

/**
 * Segmented control. The white pill moves to the chosen segment on the UI thread (ease-in-out, it travels across the
 * control rather than entering), with a selection tick on the press. Segments are peers, so the content never slides.
 */
export function Segment({items,value,onChange}:{items:[string,string][];value:string;onChange:(v:string)=>void}){
 const [width,setWidth]=useState(0),index=Math.max(0,items.findIndex(([k])=>k===value)),item=width/items.length,x=useSharedValue(0),placed=useRef(false);
 useEffect(()=>{
  if(!item)return;
  // The first placement jumps; only real changes travel.
  if(!placed.current){placed.current=true;x.set(index*item);return;}
  x.set(withTiming(index*item,{duration:220,easing:EASE_IN_OUT}));
 },[index,item]);
 const pill=useAnimatedStyle(()=>({transform:[{translateX:x.get()}]}));
 return <View style={s.segment} accessibilityRole="tablist" onLayout={e=>setWidth(e.nativeEvent.layout.width-8)}>
  {item?<Animated.View pointerEvents="none" style={[s.segmentPill,{width:item},pill]}/>:null}
  {items.map(([key,label])=>{const on=value===key;return <Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:on}} onPress={()=>{if(!on){haptic.step();onChange(key);}}} style={s.segmentItem}>
   <Text style={[s.segmentText,on&&{color:c.ink}]}>{label}</Text>
  </Pressable>;})}
 </View>;
}

/** Rounded-square icon on a tinted ground. */
export function IconTile({icon,tone='blue',size=40}:{icon:string;tone?:Tone;size?:number}){
 const [fg,bg]=TONES[tone];
 return <View style={{width:size,height:size,borderRadius:size*0.3,backgroundColor:bg,alignItems:'center',justifyContent:'center'}}><Icon name={icon} size={size*0.45} color={fg}/></View>;
}

/** Small status pill. "glass" is for night surfaces. */
export function Chip({label,icon,tone='neutral',dot,glass}:{label:string;icon?:string;tone?:Tone;dot?:string;glass?:boolean}){
 const [fg,bg]=TONES[tone];
 return <View style={[s.chip,glass?{backgroundColor:c.glass,borderColor:c.glassLine,borderWidth:StyleSheet.hairlineWidth}:{backgroundColor:bg}]}>
  {dot?<View style={[s.chipDot,{backgroundColor:dot}]}/>:null}
  {icon?<Icon name={icon} size={13} color={glass?'#fff':fg}/>:null}
  <Text style={[s.chipText,{color:glass?'#e9eef5':fg}]} numberOfLines={1}>{label}</Text>
 </View>;
}

/**
 * A metric tile: icon and label, one big tabular number with its unit, a caption, and room for a small chart.
 * Tappable when it leads somewhere.
 */
export function Tile({label,value,unit,caption,icon,tone='blue',onPress,style,children}:{label:string;value:string;unit?:string;caption?:string;icon?:string;tone?:Tone;onPress?:()=>void;style?:StyleProp<ViewStyle>;children?:ReactNode}){
 const [fg]=TONES[tone],warn=tone==='amber'||tone==='red';
 const body=<>
  <View style={[ui.row,{gap:7}]}>
   {icon?<Icon name={icon} size={15} color={fg}/>:null}
   <Text style={[type.overline,{flex:1}]} numberOfLines={1}>{label}</Text>
   {onPress?<Icon name="chevron-forward" size={14} color={c.faint}/>:null}
  </View>
  <Text style={[type.metric,{marginTop:12},warn&&{color:fg}]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}{unit?<Text style={type.unit}> {unit}</Text>:null}</Text>
  {caption?<Text style={[type.caption,{marginTop:2}]} numberOfLines={2}>{caption}</Text>:null}
  {children}
 </>;
 const a11y=`${label}: ${value}${unit?' '+unit:''}${caption?'. '+caption:''}`;
 return onPress?<PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={[s.tile,style]}>{body}</PressableScale>
  :<View accessible accessibilityLabel={a11y} style={[s.tile,style]}>{body}</View>;
}
/** Older name for Tile. */
export const Stat=({title,tone,...rest}:{title:string;value:string;unit?:string;caption?:string;icon?:string;tone?:'warn'|'ok';onPress?:()=>void;style?:StyleProp<ViewStyle>;children?:ReactNode})=>
 <Tile label={title} tone={tone==='warn'?'amber':tone==='ok'?'green':'blue'} {...rest}/>;

/**
 * One row: icon tile, title, caption, chevron. On its own it is a card; inside a grouped card (card={false}) rows
 * are separated by hairlines, like a settings list.
 */
export function ListRow({icon,tone='blue',title,caption,onPress,right,card=true,first}:{icon:string;tone?:Tone;title:string;caption?:string;onPress?:()=>void;right?:ReactNode;card?:boolean;first?:boolean}){
 const inner=<>
  <IconTile icon={icon} tone={tone}/>
  <View style={{flex:1}}><Text style={type.label} numberOfLines={1}>{title}</Text>{caption?<Text style={[type.caption,{marginTop:1}]} numberOfLines={2}>{caption}</Text>:null}</View>
  {right??(onPress?<Icon name="chevron-forward" size={16} color={c.faint}/>:null)}
 </>;
 const style=[s.row,card?[ui.card,{paddingVertical:14}]:[s.rowPlain,!first&&s.rowDivider]];
 return onPress?<PressableScale accessibilityRole="button" accessibilityLabel={caption?`${title}. ${caption}`:title} onPress={onPress} style={style}>{inner}</PressableScale>:<View style={style}>{inner}</View>;
}

/** A white card that holds ListRows separated by hairlines. */
export function Group({children}:{children:ReactNode}){return <View style={[ui.card,{paddingVertical:4}]}>{children}</View>;}

/** A round glass button with a label under it, for the hero's quick actions. */
export function QuickAction({icon,label,onPress,accent}:{icon:string;label:string;onPress:()=>void;accent?:boolean}){
 return <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} tick scale={0.92} style={s.quick}>
  <View style={[s.quickIcon,accent&&{backgroundColor:c.blue,borderColor:c.blue}]}><Icon name={icon} size={21} color="#fff"/></View>
  <Text style={s.quickLabel} numberOfLines={1}>{label}</Text>
 </PressableScale>;
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
  <IconTile icon={icon} size={56}/>
  <Text style={[type.title,{marginTop:14}]}>{title}</Text>
  <Text style={[type.body,{textAlign:'center',marginTop:4}]}>{text}</Text>
 </View>;
}

const s=StyleSheet.create({
 button:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,borderRadius:radius.pill,minHeight:52,paddingHorizontal:22,marginVertical:5},
 buttonLight:{borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...shadow},
 buttonGlass:{borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine},
 buttonText:{fontFamily:F[700],fontSize:15,letterSpacing:-0.1},
 round:{alignItems:'center',justifyContent:'center'},
 roundFrost:{backgroundColor:c.frost,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...floatShadow,shadowOpacity:0.12,elevation:5},
 roundGlass:{backgroundColor:c.glass,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine},
 header:{flexDirection:'row',alignItems:'flex-end',gap:12,marginTop:8,marginBottom:18},
 section:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:10,marginBottom:10,paddingHorizontal:4},
 link:{fontFamily:F[700],fontSize:13.5,color:c.blue},
 segment:{flexDirection:'row',backgroundColor:c.track,borderRadius:radius.pill,padding:4,marginBottom:16},
 segmentPill:{position:'absolute',left:4,top:4,bottom:4,borderRadius:radius.pill,backgroundColor:c.surface,...shadow,shadowOpacity:0.08,elevation:2},
 segmentItem:{flex:1,paddingVertical:10,borderRadius:radius.pill,alignItems:'center'},
 segmentText:{fontFamily:F[700],fontSize:14,color:c.muted},
 chip:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',gap:6,borderRadius:radius.pill,paddingVertical:6,paddingHorizontal:11},
 chipDot:{width:7,height:7,borderRadius:3.5},
 chipText:{fontFamily:F[700],fontSize:12.5},
 tile:{backgroundColor:c.surface,borderRadius:radius.lg,padding:16,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...shadow},
 row:{flexDirection:'row',alignItems:'center',gap:12},
 rowPlain:{paddingVertical:13,paddingHorizontal:14},
 rowDivider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line},
 quick:{alignItems:'center',gap:7,width:72},
 quickIcon:{width:56,height:56,borderRadius:28,backgroundColor:c.glass,borderWidth:StyleSheet.hairlineWidth,borderColor:c.glassLine,alignItems:'center',justifyContent:'center'},
 quickLabel:{fontFamily:F[700],fontSize:12,color:'#dfe6ef'},
 check:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:8},
 checkDot:{width:22,height:22,borderRadius:11,alignItems:'center',justifyContent:'center'},
 checkText:{fontFamily:F[600],fontSize:14.5,color:c.ink,flex:1},
 notice:{flexDirection:'row',gap:10,alignItems:'flex-start',borderRadius:radius.md,padding:14,marginBottom:12},
 noticeText:{flex:1,fontFamily:F[500],fontSize:13.5,lineHeight:19,color:c.ink2},
});
