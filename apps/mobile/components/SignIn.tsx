import {useEffect,useState} from 'react';
import {ScrollView,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {c,ui} from './theme';
import {Button,useAction} from './kit';
import {CarArt} from './art';
import {server} from './server';
import {ServerForm} from './tabs/More';

WebBrowser.maybeCompleteAuthSession();
const issuer=(process.env.EXPO_PUBLIC_OIDC_ISSUER||'').trim();
const clientId=process.env.EXPO_PUBLIC_OIDC_CLIENT_ID||'yazzy-mobile';
const redirectUri=AuthSession.makeRedirectUri({scheme:'yazzy'});

/** First run only: connect once, and the app remembers the server from then on. */
export function SignIn({api,onConnected}:{api:string;onConnected:()=>void}){
 const insets=useSafeAreaInsets(),{width}=useWindowDimensions(),carWidth=Math.min(width-24,380);
 return <ScrollView style={{flex:1,backgroundColor:c.bg}} contentContainerStyle={{paddingBottom:insets.bottom+30}} keyboardShouldPersistTaps="handled">
  <View style={[s.top,{paddingTop:insets.top+18}]}>
   <Text style={s.wordmark}>yazzy</Text>
   <Text style={s.title}>Your car,{'\n'}in context.</Text>
   <Text style={s.text}>Trips, fuel and health from your own OBD adapter.</Text>
  </View>
  <View style={{alignItems:'center',marginTop:-(carWidth*0.4)+40}}><CarArt width={carWidth}/></View>
  <View style={{paddingHorizontal:16}}>
   <View style={ui.card}>
    <Text style={ui.title}>Connect to your server</Text>
    <Text style={[ui.body,{marginTop:4,marginBottom:16}]}>You only do this once. To switch servers later, open More › Server.</Text>
    <ServerForm initialApi={api} cta="Open my garage" onConnected={onConnected}/>
    {issuer?<SecureSignIn onConnected={onConnected}/>:null}
   </View>
  </View>
 </ScrollView>;
}

function SecureSignIn({onConnected}:{onConnected:()=>void}){
 const [discovery,setDiscovery]=useState<AuthSession.DiscoveryDocument|null>(null),[error,setError]=useState(''),[busy,run]=useAction();
 useEffect(()=>{
  let active=true;
  AuthSession.fetchDiscoveryAsync(issuer).then(d=>{if(!d.authorizationEndpoint||!d.tokenEndpoint)throw new Error();if(active)setDiscovery(d);})
   .catch(()=>{if(active)setError('Secure sign-in is unavailable. Check your sign-in configuration and connection, then reload the app.');});
  return()=>{active=false;};
 },[]);
 const [request,,promptAsync]=AuthSession.useAuthRequest({clientId,redirectUri,scopes:['openid','profile','offline_access'],usePKCE:true},discovery);
 async function signIn(){
  const result=await promptAsync();
  if(result.type!=='success'||!discovery)return;
  const t=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request?.codeVerifier||''}},discovery);
  await server.signInWithToken(server.api,t.accessToken,t.refreshToken);onConnected();
 }
 return <>
  <Button kind="light" title="Sign in securely" icon="shield-checkmark-outline" disabled={!discovery||!request||busy} onPress={()=>run(signIn)}/>
  {error?<Text accessibilityRole="alert" style={[ui.body,{color:c.red,marginTop:8}]}>{error}</Text>:null}
 </>;
}

const s=StyleSheet.create({
 top:{backgroundColor:c.night,paddingHorizontal:20,paddingBottom:96},
 wordmark:{fontSize:20,fontWeight:'800',color:'#fff',letterSpacing:-0.5,marginBottom:28},
 title:{fontSize:30,fontWeight:'800',color:'#fff',letterSpacing:-0.8,lineHeight:35,marginTop:2},
 text:{fontSize:14,color:c.nightMuted,marginTop:6},
});
