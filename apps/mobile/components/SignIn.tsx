import {useEffect,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,TextInput,useWindowDimensions,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {c,ui,F} from './theme';
import {Button,Segment,useAction} from './kit';
import {CarImage} from './CarImage';
import {LightSurface} from './LightSurface';
import {server} from './server';
import {t} from './i18n';

WebBrowser.maybeCompleteAuthSession();
const issuer=(process.env.EXPO_PUBLIC_OIDC_ISSUER||'').trim();
const clientId=process.env.EXPO_PUBLIC_OIDC_CLIENT_ID||'yazzy-mobile';
const redirectUri=AuthSession.makeRedirectUri({scheme:'yazzy'});

/** Sign in to an account, or create one. A phone signed in to the old shared garage keeps it on Create account. */
export function SignIn({api,onConnected}:{api:string;onConnected:()=>void}){
 const insets=useSafeAreaInsets(),{width}=useWindowDimensions(),carWidth=Math.min(width-24,380);
 const legacy=server.mode==='demo',[view,setView]=useState(legacy?'register':'login');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [address,setAddress]=useState(api),[editing,setEditing]=useState(false),[busy,run]=useAction();
 const register=view==='register',ok=!!email.trim()&&password.length>=(register?8:1)&&!busy;
 const submit=()=>run(async()=>{
  if(register)await server.register(email.trim(),password,name.trim(),address);else await server.login(email.trim(),password,address);
  onConnected();
 });
 return <ScrollView style={{flex:1,backgroundColor:c.bg}} contentContainerStyle={{paddingBottom:insets.bottom+30}} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
  <View style={[s.top,{paddingTop:insets.top+18}]}>
   <LightSurface/>
   <Text style={s.wordmark}>yazzy</Text>
   <Text style={s.title}>{t('Your car,\nin context.')}</Text>
   <Text style={s.text}>{t('Trips, fuel and health from your own OBD adapter.')}</Text>
  </View>
  <View style={{alignItems:'center',marginTop:-(carWidth*0.4)+40}} pointerEvents="none"><CarImage width={carWidth}/></View>
  <View style={{paddingHorizontal:16}}>
   <View style={ui.card}>
    <Segment items={[['login',t('Sign in')],['register',t('Create account')]]} value={view} onChange={setView}/>
    {legacy&&register?<Text style={[ui.caption,{marginTop:12}]}>{t('Your garage on this phone moves into the new account.')}</Text>:null}
    <View style={{height:14}}/>
    {register?<TextInput accessibilityLabel={t('Your name')} placeholder={t('Your name')} placeholderTextColor={c.faint} style={ui.input} value={name} onChangeText={setName} autoComplete="name" textContentType="name"/>:null}
    <TextInput accessibilityLabel={t('E-mail')} placeholder={t('E-mail')} placeholderTextColor={c.faint} style={ui.input} value={email} onChangeText={setEmail}
     autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username"/>
    <TextInput accessibilityLabel={t('Password')} placeholder={register?t('Password (at least 8 characters)'):t('Password')} placeholderTextColor={c.faint} style={ui.input} value={password} onChangeText={setPassword}
     secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={register?'new-password':'current-password'} textContentType={register?'newPassword':'password'} returnKeyType="go" onSubmitEditing={()=>{if(ok)submit();}}/>
    <Button title={busy?t('Connecting…'):register?t('Create account'):t('Sign in')} icon="arrow-forward" disabled={!ok} onPress={submit}/>
    {busy?<Text style={[ui.caption,{textAlign:'center',marginTop:8}]}>{t('A sleeping server can take up to a minute to wake.')}</Text>:null}
    {issuer?<SecureSignIn onConnected={onConnected}/>:null}
   </View>
   {editing?<View style={[ui.card,{marginTop:12}]}>
    <Text style={[ui.caption,{marginBottom:6}]}>{t('Server address')}</Text>
    <TextInput accessibilityLabel={t('Server address')} style={ui.input} value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
   </View>:<Pressable accessibilityRole="button" onPress={()=>setEditing(true)} hitSlop={8} style={{alignSelf:'center',marginTop:14}}>
    <Text style={ui.caption}>{t('Server')}: {address.replace(/^https?:\/\//,'')} · <Text style={{color:c.blue}}>{t('Change')}</Text></Text>
   </Pressable>}
  </View>
 </ScrollView>;
}

function SecureSignIn({onConnected}:{onConnected:()=>void}){
 const [discovery,setDiscovery]=useState<AuthSession.DiscoveryDocument|null>(null),[error,setError]=useState(''),[busy,run]=useAction();
 useEffect(()=>{
  let active=true;
  AuthSession.fetchDiscoveryAsync(issuer).then(d=>{if(!d.authorizationEndpoint||!d.tokenEndpoint)throw new Error();if(active)setDiscovery(d);})
   .catch(()=>{if(active)setError(t('Secure sign-in is unavailable. Check your sign-in configuration and connection, then reload the app.'));});
  return()=>{active=false;};
 },[]);
 const [request,,promptAsync]=AuthSession.useAuthRequest({clientId,redirectUri,scopes:['openid','profile','offline_access'],usePKCE:true},discovery);
 async function signIn(){
  const result=await promptAsync();
  if(result.type!=='success'||!discovery)return;
  const token=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request?.codeVerifier||''}},discovery);
  await server.signInWithToken(server.api,token.accessToken,token.refreshToken);onConnected();
 }
 return <>
  <Button kind="light" title={t('Sign in securely')} icon="shield-checkmark-outline" disabled={!discovery||!request||busy} onPress={()=>run(signIn)}/>
  {error?<Text accessibilityRole="alert" style={[ui.body,{color:c.red,marginTop:8}]}>{error}</Text>:null}
 </>;
}

const s=StyleSheet.create({
 top:{backgroundColor:c.surface,paddingHorizontal:20,paddingBottom:96,overflow:'hidden'},
 wordmark:{fontFamily:F[700],fontSize:20,color:c.blue,letterSpacing:-0.5,marginBottom:28},
 title:{fontFamily:F[700],fontSize:30,color:c.ink,letterSpacing:-0.8,lineHeight:35,marginTop:2},
 text:{fontFamily:F[500],fontSize:14,color:c.ink2,marginTop:6},
});
