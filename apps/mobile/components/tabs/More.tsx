import {memo,useState,type ReactNode} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {c,F,radius,ui} from '../theme';
import {Button,Group,Icon,ListRow,Notice,ScreenHeader,Section,useAction} from '../kit';
import {PressableScale} from '../motion';
import {CarDocuments} from '../CarDocuments';
import type {Documents} from '../carChecks';
import {server} from '../server';
import {LANGS,setLang,t,tp,useLang} from '../i18n';

type Props={vehicle:any;vehicleCount:number;selected:string;api:string;padBottom:number;onVehicles:()=>void;onCar:()=>void;onConnected:()=>void;onDisconnected:()=>void;onSignOut:()=>void;
 business:number;onBusiness:()=>void;onSaveDocuments:(documents:Documents)=>Promise<void>;onTask:()=>void;onShowTask:()=>void};
const build=Number(Constants.expoConfig?.extra?.versionCode)||null;

/** The evidence-based assistant, the selected car's documents (Data), vehicles, language and the account. */
export const MoreTab=memo(function MoreTab({vehicle,vehicleCount,selected,api,padBottom,onVehicles,onCar,onSignOut,business,onBusiness,onSaveDocuments,onTask,onShowTask}:Props){
 const insets=useSafeAreaInsets(),[busy,run]=useAction(),lang=useLang();
 const [message,setMessage]=useState(''),[answer,setAnswer]=useState<any>(null);
 const host=api.replace(/^https?:\/\//,''),account=server.account;
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:padBottom}} keyboardShouldPersistTaps="handled">
  <ScreenHeader title={t('More')} subtitle={vehicle?vehicle.name:undefined}/>
  <Section title={t('Assistant')}/>
  <View style={ui.card}>
   <Text style={ui.title}>{t('Ask about your car')}</Text>
   <Text style={[ui.body,{marginTop:4,marginBottom:12}]}>{t('Answers come from your car\'s recorded evidence, never invented readings.')}</Text>
   <View style={[ui.row,{gap:10}]}>
    <TextInput style={[ui.input,{flex:1,marginBottom:0}]} value={message} onChangeText={setMessage} placeholder={t('Why did fuel use go up?')} placeholderTextColor={c.faint}/>
    <PressableScale accessibilityRole="button" accessibilityLabel={t('Ask')} disabled={busy||!message.trim()} scale={0.92} onPress={()=>run(async()=>setAnswer(await server.call('/assistant/messages',{vehicleId:selected,message,language:lang})))} style={[s.send,(busy||!message.trim())&&{opacity:0.45}]}><Icon name="arrow-up" size={20} color="#fff"/></PressableScale>
   </View>
   {answer&&<View style={s.answer}><Text style={[ui.body,{color:c.ink2}]}>{answer.text}</Text>{answer.type==='CONFIRMATION'&&<Button title={t('Confirm task')} icon="checkmark" onPress={()=>run(async()=>{
    await server.call('/pending-actions/'+answer.pendingActionId+'/confirm',{});
    setAnswer(null);setMessage('');onTask();
    Alert.alert(t('Work order created'),t('It is listed in Health › Service under Planned.'),[{text:t('Later'),style:'cancel'},{text:t('Show it'),onPress:onShowTask}]);
   })}/>}</View>}
  </View>
  <Section title={t('Data')}/>
  {vehicle?<CarDocuments vehicle={vehicle} onSave={onSaveDocuments}/>:<Text style={[ui.body,{paddingHorizontal:4}]}>{t('Add a vehicle to keep its documents here.')}</Text>}
  <Section title={t('Garage')}/>
  <Group>
   <ListRow card={false} first icon="car-sport" title={t('Vehicles')} caption={tp(vehicleCount,'{n} in your garage','{n} in your garage')+(vehicle?' · '+t('{name} selected',{name:vehicle.name}):'')} onPress={onVehicles}/>
   <ListRow card={false} icon="document-text" title={t('Car report')} caption={t('Type, battery, fault codes, readiness · export PDF')} onPress={onCar}/>
   {business?<ListRow card={false} icon="briefcase" tone="blue" title={t('Business dashboard')} caption={tp(business,'{n} business car','{n} business cars')+' · '+t('live locations, kilometres')} onPress={onBusiness}/>:null}
  </Group>
  <Section title={t('Language')}/>
  <Group>
   {LANGS.map((l,i)=><ListRow key={l.id} card={false} first={i===0} icon="language" tone={l.id===lang?'blue':'neutral'} title={l.name} onPress={()=>setLang(l.id)}
    right={l.id===lang?<Icon name="checkmark" size={18} color={c.blue}/>:<View style={{width:18}}/>}/>)}
  </Group>
  <Section title={t('Account')}/>
  <Group>
   <ListRow card={false} first icon="person-circle" tone="blue" title={account?.name||account?.email||t('Signed in')} caption={[account?.name?account.email:null,host].filter(Boolean).join(' · ')}/>
   <ListRow card={false} icon="log-out-outline" title={t('Sign out')} caption={t('Recordings not yet uploaded stay on the phone.')}
    onPress={()=>Alert.alert(t('Sign out?'),t('You will need your e-mail and password to sign in again.'),[{text:t('Cancel'),style:'cancel'},{text:t('Sign out'),style:'destructive',onPress:onSignOut}])}/>
  </Group>
  <Text style={s.note}>{t('Read-only diagnostics. Yazzy never clears codes or controls anything in your car.')}{build?'\n'+t('Yazzy build {n}',{n:build}):''}</Text>

 </ScrollView>;
});

const s=StyleSheet.create({
 fieldLabel:{fontFamily:F[700],fontSize:13,color:c.ink2,marginBottom:6},
 send:{width:48,height:48,borderRadius:radius.md,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},
 answer:{backgroundColor:c.blue50,borderRadius:radius.md,padding:14,marginTop:12},
 note:{fontFamily:F[500],fontSize:12.5,lineHeight:18,color:c.muted,marginTop:6,marginBottom:10,paddingHorizontal:4,textAlign:'center'},
});
