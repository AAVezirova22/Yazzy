import {memo,useState,type ReactNode} from 'react';
import {StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import Svg,{Circle,Defs,Ellipse,G,Line,LinearGradient,Path,Polyline,RadialGradient,Rect,Stop} from 'react-native-svg';
import {c,F} from './theme';
import {t} from './i18n';

/**
 * The night surface behind hero moments: a deep graphite-to-navy gradient with a soft blue glow where the car sits.
 * Drawn once as vectors, so it costs nothing to scroll (no image, no blur).
 */
export const NightGlow=memo(function NightGlow({glowX='72%',glowY='70%'}:{glowX?:string;glowY?:string}){
 // Sized from the parent's measured box: percentage sizes on an Svg do not always fill it on Android.
 const [box,setBox]=useState({width:0,height:0});
 return <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={e=>{const {width,height}=e.nativeEvent.layout;if(width!==box.width||height!==box.height)setBox({width,height});}}>
  {box.width>0?<Svg width={box.width} height={box.height}>
   <Defs>
    <LinearGradient id="nightFill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#0b111c"/><Stop offset="1" stopColor="#15203a"/></LinearGradient>
    <RadialGradient id="nightGlow" cx={glowX} cy={glowY} rx="60%" ry="48%"><Stop offset="0" stopColor="#2f6bff" stopOpacity="0.34"/><Stop offset="1" stopColor="#2f6bff" stopOpacity="0"/></RadialGradient>
   </Defs>
   <Rect width={box.width} height={box.height} fill="url(#nightFill)"/>
   <Rect width={box.width} height={box.height} fill="url(#nightGlow)"/>
  </Svg>:null}
 </View>;
});

/** A generic side-view car drawn in vectors: no photo, no brand, a few kilobytes. Faces right. */
export const CarArt=memo(function CarArt({width=300}:{width?:number}){
 const wheel=(x:number)=><G key={x}>
  <Circle cx={x} cy={90} r={21} fill="#0d1117"/>
  <Circle cx={x} cy={90} r={14} fill="url(#rim)"/>
  {[0,72,144,216,288].map(a=>{const r=a*Math.PI/180;return <Line key={a} x1={x} y1={90} x2={x+12*Math.cos(r)} y2={90+12*Math.sin(r)} stroke="#5b6573" strokeWidth={2.6} strokeLinecap="round"/>;})}
  <Circle cx={x} cy={90} r={4} fill={c.blue}/>
 </G>;
 return <Svg width={width} height={width*0.4} viewBox="0 0 320 128">
  <Defs>
   <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#ffffff"/><Stop offset="0.55" stopColor="#e9edf2"/><Stop offset="1" stopColor="#b9c2ce"/></LinearGradient>
   <LinearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#3b4a5e"/><Stop offset="1" stopColor="#141b24"/></LinearGradient>
   <LinearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#e3e7ec"/><Stop offset="1" stopColor="#8b95a3"/></LinearGradient>
  </Defs>
  <Ellipse cx={162} cy={112} rx={128} ry={5} fill="#0b0f14" opacity={0.16}/>
  <Ellipse cx={162} cy={111} rx={100} ry={3.5} fill="#0b0f14" opacity={0.18}/>
  <Path d="M22 90 L18 78 C16 70 18 62 30 58 L72 54 C88 44 104 33 122 29 C150 24 180 24 196 27 C212 31 228 42 240 50 C262 53 284 56 296 61 C304 65 306 74 304 82 L300 90 L271 90 A26 26 0 0 0 219 90 L106 90 A26 26 0 0 0 54 90 Z" fill="url(#body)"/>
  <Path d="M92 52 C104 42 116 35 128 33 C152 29 178 29 192 31 C204 35 216 43 226 51 Z" fill="url(#glass)"/>
  <Rect x={166} y={29} width={4} height={23} fill="#dfe4ea"/>
  <Path d="M40 70 C120 66 220 64 296 67" stroke="#c4ccd6" strokeWidth={1.2} fill="none"/>
  <Line x1={170} y1={55} x2={168} y2={86} stroke="#c4ccd6" strokeWidth={1}/>
  <Rect x={146} y={60} width={13} height={3} rx={1.5} fill="#9aa4b1"/>
  <Path d="M106 90 L219 90 L216 84 L109 84 Z" fill="#2a323d"/>
  <Path d="M283 62 L300 66" stroke={c.blue300} strokeWidth={3.5} strokeLinecap="round"/>
  <Path d="M19 64 L29 61" stroke="#e5484d" strokeWidth={3.5} strokeLinecap="round"/>
  {wheel(80)}{wheel(245)}
 </Svg>;
});

type LatLng={latitude:number;longitude:number};

/** Draws a route to scale (north up) on a faint street-grid card. Used for trip thumbnails and as the map fallback. */
export const RouteArt=memo(function RouteArt({route,style,stroke=4,grid=true,markers=[]}:{route:LatLng[];style?:StyleProp<ViewStyle>;stroke?:number;grid?:boolean;markers?:{latitude:number;longitude:number;color:string}[]}){
 const [box,setBox]=useState({width:0,height:0});
 const pts=thin(route,160);
 let body=null;
 if(box.width>0&&pts.length){
  const pad=Math.max(10,Math.min(box.width,box.height)*0.16),scale=Math.cos(pts[0].latitude*Math.PI/180);
  const raw=(p:LatLng)=>({x:p.longitude*scale,y:-p.latitude}),xy0=pts.map(raw);
  const minX=Math.min(...xy0.map(p=>p.x)),minY=Math.min(...xy0.map(p=>p.y));
  const w=Math.max(1e-9,Math.max(...xy0.map(p=>p.x))-minX),h=Math.max(1e-9,Math.max(...xy0.map(p=>p.y))-minY);
  // A route that never moved (one point or all the same) is centred instead of stretched.
  const k=w<1e-7&&h<1e-7?0:Math.min((box.width-2*pad)/w,(box.height-2*pad)/h),offX=(box.width-w*k)/2,offY=(box.height-h*k)/2;
  const at=(p:LatLng)=>{const r=raw(p);return {x:offX+(r.x-minX)*k,y:offY+(r.y-minY)*k};};
  const xy=pts.map(at),first=xy[0],last=xy[xy.length-1],step=22;
  body=<Svg width={box.width} height={box.height}>
   {grid?<G opacity={0.9}>
    {Array.from({length:Math.ceil(box.width/step)},(_,i)=><Line key={'v'+i} x1={i*step+((i*7)%9)} y1={0} x2={i*step+((i*5)%11)} y2={box.height} stroke="#ffffff" strokeWidth={i%3===0?5:2}/>)}
    {Array.from({length:Math.ceil(box.height/step)},(_,i)=><Line key={'h'+i} x1={0} y1={i*step+((i*3)%8)} x2={box.width} y2={i*step+((i*4)%10)} stroke="#ffffff" strokeWidth={i%4===1?5:2}/>)}
   </G>:null}
   {xy.length>1?<Polyline points={xy.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={c.blue} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"/>:null}
   {markers.map((m,i)=>{const p=at(m);return <Circle key={i} cx={p.x} cy={p.y} r={stroke+2.5} fill={m.color} stroke="#fff" strokeWidth={2}/>;})}
   <Circle cx={first.x} cy={first.y} r={stroke+2} fill="#fff" stroke={c.blue} strokeWidth={stroke-0.5}/>
   {xy.length>1?<Circle cx={last.x} cy={last.y} r={stroke+2.5} fill={c.blue} stroke="#fff" strokeWidth={2.5}/>:null}
  </Svg>;
 }
 return <View style={[{backgroundColor:'#e6ebf1',overflow:'hidden'},style]} onLayout={e=>{const {width,height}=e.nativeEvent.layout;if(width!==box.width||height!==box.height)setBox({width,height});}}>{body}</View>;
});

/** Keeps at most n points, evenly spaced, always including the last one. */
function thin<T>(list:T[],n:number):T[]{
 if(list.length<=n)return list;
 const out:T[]=[],step=(list.length-1)/(n-1);
 for(let i=0;i<n;i++)out.push(list[Math.round(i*step)]);
 return out;
}

/** Seven small bars for the last seven days. Values in km; days without driving stay as faint stubs. */
export const WeekBars=memo(function WeekBars({values,height=58}:{values:number[];height?:number}){
 const top=Math.max(1,...values),today=new Date().getDay();
 return <View style={{marginTop:'auto',paddingTop:16}}>
  <View style={{flexDirection:'row',alignItems:'flex-end',gap:5,height}}>
   {values.map((v,i)=><View key={i} style={{flex:1,height:Math.max(3,v/top*height),borderRadius:1,backgroundColor:v>0?(i===values.length-1?c.blue:c.blue300):c.track}}/>)}
  </View>
  <View style={{flexDirection:'row',gap:5,marginTop:6}}>
   {values.map((_,i)=><Text key={i} style={{flex:1,textAlign:'center',fontSize:10.5,fontFamily:i===values.length-1?F[700]:F[500],color:i===values.length-1?c.ink:c.faint}}>{t('SMTWTFS')[(today-6+i+7)%7]}</Text>)}
  </View>
 </View>;
});

/** A progress ring: the share of something done, with the number in the middle. Static: it is data, not decoration. */
export const Ring=memo(function Ring({value,size=86,stroke=9,color=c.green,children}:{value:number;size?:number;stroke?:number;color?:string;children?:ReactNode}){
 const r=(size-stroke)/2,length=2*Math.PI*r,part=Math.max(0,Math.min(1,value));
 return <View style={{width:size,height:size,alignItems:'center',justifyContent:'center'}}>
  <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
   <Circle cx={size/2} cy={size/2} r={r} stroke={c.track} strokeWidth={stroke} fill="none"/>
   {part>0?<Circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
    strokeDasharray={`${length*part} ${length}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>:null}
  </Svg>
  {children}
 </View>;
});
