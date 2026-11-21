import {memo,useState,type ReactNode} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {c,F,radius,ui} from '../theme';
import {Button,Group,Icon,ListRow,Notice,ScreenHeader,Section,useAction} from '../kit';
import {PressableScale} from '../motion';
import {Sheet} from '../Sheet';
import {server} from '../server';

/** Server address and access password, then Connect. Used on the first-run page and in More › Server. */
export function ServerForm({initialApi,onConnected,cta='Connect',hint,children}:{initialApi:string;onConnected:()=>void;cta?:string;hint?:string;children?:ReactNode}){
 const [api,setApi]=useState(initialApi),[password,setPassword]=useState(''),[busy,run]=useAction();
 return <>
  <Text style={s.fieldLabel}>Server</Text>
  <TextInput accessibilityLabel="Server address" style={ui.input} value={api} onChangeText={setApi} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
  <Text style={s.fieldLabel}>Access password</Text>
  <TextInput accessibilityLabel="Access password" placeholder={hint||'Needed for hosted servers'} placeholderTextColor={c.faint} style={ui.input} value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry/>
  <Button title={busy?'Connecting…':cta} icon="arrow-forward" disabled={busy||!api.trim()} onPress={()=>run(async()=>{await server.connect(api,password);onConnected();})}/>
  {busy?<Text style={[ui.caption,{textAlign:'center',marginTop:4}]}>A sleeping server can take up to a minute to wake.</Text>:null}
  {children}
 </>;
}

type Props={vehicle:any;vehicleCount:number;selected:string;api:string;padBottom:number;onVehicles:()=>void;onCar:()=>void;onConnected:()=>void;onDisconnected:()=>void};
const build=Number(Constants.expoConfig?.extra?.versionCode)||null;

/** Vehicles, the evidence-based assistant, and the server this phone is connected to. */
export const MoreTab=memo(function MoreTab({vehicle,vehicleCount,selected,api,padBottom,onVehicles,onCar,onConnected,onDisconnected}:Props){
 const insets=useSafeAreaInsets(),[busy,run]=useAction();
 const [message,setMessage]=useState(''),[answer,setAnswer]=useState<any>(null),[serverOpen,setServerOpen]=useState(false);
 const host=api.replace(/^https?:\/\//,'');
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}} keyboardShouldPersistTaps="handled">
  <ScreenHeader title="More" subtitle={vehicle?vehicle.name:undefined}/>
  <Section title="Garage"/>
  <Group>
   <ListRow card={false} first icon="car-sport" title="Vehicles" caption={`${vehicleCount} in your garage${vehicle?` · ${vehicle.name} selected`:''}`} onPress={onVehicles}/>
   <ListRow card={false} icon="document-text" title="Car report" caption="Type, battery, fault codes, readiness · export PDF" onPress={onCar}/>
  </Group>
  <Section title="Assistant"/>
  <View style={ui.card}>
   <Text style={ui.title}>Ask about your car</Text>
   <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>Answers come from your car's recorded evidence, never invented readings.</Text>
   <View style={[ui.row,{gap:10}]}>
    <TextInput style={[ui.input,{flex:1,marginBottom:0}]} value={message} onChangeText={setMessage} placeholder="Why did fuel use go up?" placeholderTextColor={c.faint}/>
    <PressableScale accessibilityRole="button" accessibilityLabel="Ask" disabled={busy||!message.trim()} scale={0.92} onPress={()=>run(async()=>setAnswer(await server.call('/assistant/messages',{vehicleId:selected,message})))} style={[s.send,(busy||!message.trim())&&{opacity:0.45}]}><Icon name="arrow-up" size={20} color="#fff"/></PressableScale>
   </View>
   {answer&&<View style={s.answer}><Text style={[ui.body,{color:c.ink2}]}>{answer.text}</Text>{answer.type==='CONFIRMATION'&&<Button title="Confirm inspection task" icon="checkmark" onPress={()=>run(async()=>{await server.call('/pending-actions/'+answer.pendingActionId+'/confirm',{});Alert.alert('Work order created');})}/>}</View>}
  </View>
  <Section title="Connection"/>
  <Group>
   <ListRow card={false} first icon="cloud-done" tone="green" title="Server" caption={`${host} · ${server.mode==='oidc'?'signed in securely':'connected'}`} onPress={()=>setServerOpen(true)}/>
  </Group>
  <Text style={s.note}>Read-only diagnostics. Yazzy never clears codes or controls anything in your car.{build?`\nYazzy build ${build}`:''}</Text>

  <Sheet open={serverOpen} onClose={()=>setServerOpen(false)} title="Server">
   <Notice tone="ok" icon="cloud-done">Connected to {host}. The app stays connected; you only come here to switch servers.</Notice>
   <ServerForm key={String(serverOpen)} initialApi={api} cta="Connect to this server" hint="Leave empty to reuse the saved one" onConnected={()=>{setServerOpen(false);onConnected();}}>
    <Button kind="light" title="Disconnect this phone" icon="log-out-outline" onPress={()=>Alert.alert('Disconnect?','The app will ask for a server next time it opens. Recordings not yet uploaded stay on the phone.',[{text:'Cancel',style:'cancel'},{text:'Disconnect',style:'destructive',onPress:()=>{setServerOpen(false);void server.disconnect().then(onDisconnected);}}])}/>
   </ServerForm>
  </Sheet>
 </ScrollView>;
});

const s=StyleSheet.create({
 fieldLabel:{fontFamily:F[700],fontSize:13,color:c.ink2,marginBottom:6},
 send:{width:48,height:48,borderRadius:24,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 answer:{backgroundColor:c.blue50,borderRadius:radius.md,padding:14,marginTop:12},
 note:{fontFamily:F[500],fontSize:12.5,lineHeight:18,color:c.muted,marginTop:6,marginBottom:10,paddingHorizontal:4,textAlign:'center'},
});
