import {useEffect,useState} from 'react';
import {Alert,Platform,Pressable,Text,View} from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {c,ui} from './theme';

type Release={versionCode:number|null;version?:string;size?:number;url?:string};
// scripts/build_apk.py stamps the build number into the app; dev builds have none and never prompt.
const installed=Number(Constants.expoConfig?.extra?.versionCode)||0;

/** Shows an "Update available" card when the server holds a newer APK, then downloads it and opens Android's installer. */
export function Updater({api,call,token}:{api:string;call:(path:string)=>Promise<any>;token:string}){
 const [release,setRelease]=useState<Release|null>(null),[progress,setProgress]=useState<number|null>(null);
 useEffect(()=>{if(Platform.OS!=='android'||!installed||!token)return;call('/app/release').then(setRelease).catch(()=>{});},[token]);
 if(!release?.versionCode||!release.url||release.versionCode<=installed)return null;
 async function update(){
  try{
   setProgress(0);
   // The link from /app/release is signed and expires; fetch a fresh one in case the card sat open.
   const fresh:Release=await call('/app/release');
   const target=FileSystem.cacheDirectory+'Yazzy-update.apk';
   await FileSystem.deleteAsync(target,{idempotent:true});
   const download=FileSystem.createDownloadResumable(api+fresh.url,target,{},p=>setProgress(p.totalBytesExpectedToWrite>0?p.totalBytesWritten/p.totalBytesExpectedToWrite:0));
   const result=await download.downloadAsync();
   if(!result||result.status!==200)throw new Error('Download failed ('+(result?.status??'no response')+')');
   const uri=await FileSystem.getContentUriAsync(result.uri);
   // FLAG_GRANT_READ_URI_PERMISSION so the system installer can read the file.
   await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:uri,flags:1,type:'application/vnd.android.package-archive'});
  }catch(e){Alert.alert('Yazzy update',(e as Error).message+'\n\nIf Android blocked it, allow "Install unknown apps" for Yazzy and tap Update again.');}
  finally{setProgress(null);}
 }
 const mb=release.size?` · ${Math.round(release.size/1048576)} MB`:'';
 return <View style={[ui.card,{borderColor:'#bfe0d9',backgroundColor:c.teal50}]}>
  <View style={[ui.row,{gap:12,marginBottom:10}]}>
   <View style={[ui.iconBox,{backgroundColor:c.surface}]}><Ionicons name="cloud-download-outline" size={19} color={c.teal}/></View>
   <View style={{flex:1}}><Text style={ui.cardTitle}>Update available</Text><Text style={ui.body}>Build {release.versionCode} (you have {installed}){mb}</Text></View>
  </View>
  <Pressable accessibilityRole="button" disabled={progress!==null} style={({pressed})=>[ui.button,(pressed||progress!==null)&&{opacity:0.85}]} onPress={update}>
   <Ionicons name="download-outline" size={17} color="#fff"/>
   <Text style={ui.buttonText}>{progress===null?'Update':`Downloading… ${Math.round(progress*100)}%`}</Text>
  </Pressable>
 </View>;
}
