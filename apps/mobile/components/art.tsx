import {memo,useState,type ReactNode} from 'react';
import {StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import Svg,{Circle,G,Line,Polyline} from 'react-native-svg';
import {c,F} from './theme';
import {t} from './i18n';

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
