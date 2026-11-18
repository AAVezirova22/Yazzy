import {useEffect,useState} from 'react';
import {Alert,Platform,Pressable,Text,View} from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {c,ui} from './theme';
import {server} from './server';

type Release={versionCode:number|null;version?:string;size?:number;url?:string};
// scripts/build_apk.py stamps the build number into the app; dev builds have none and never prompt.
const installed=Number(Constants.expoConfig?.extra?.versionCode)||0;

/** Shows an "Update available" card when the server holds a newer APK, then downloads it and opens Android's installer. */
export function Updater(){
 const [release,setRelease]=useState<Release|null>(null),[progress,setProgress]=useState<number|null>(null);
 useEffect(()=>{if(Platform.OS!=='android'||!installed||!server.mode)return;server.call('/app/release').then(setRelease).catch(()=>{});},[]);
 if(!release?.versionCode||!release.url||release.versionCode<=installed)return null;
 async function update(){
  try{
   setProgress(0);
   // The link from /app/release is signed and expires; fetch a fresh one in case the card sat open.
   const fresh:Release=await server.call('/app/release');
   const target=FileSystem.cacheDirectory+'Yazzy-update.apk';
   await FileSystem.deleteAsync(target,{idempotent:true});
   const download=FileSystem.createDownloadResumable(server.api+fresh.url,target,{},p=>setProgress(p.totalBytesExpectedToWrite>0?p.totalBytesWritten/p.totalBytesExpectedToWrite:0));
   const result=await download.downloadAsync();
   if(!result||result.status!==200)throw new Error('Download failed ('+(result?.status??'no response')+')');
   const uri=await FileSystem.getContentUriAsync(result.uri);
   // FLAG_GRANT_READ_URI_PERMISSION so the system installer can read the file.
   await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:uri,flags:1,type:'application/vnd.android.package-archive'});
  }catch(e){Alert.alert('Yazzy update',(e as Error).message+'\n\nIf Android blocked it, allow "Install unknown apps" for Yazzy and tap Update again.');}
  finally{setProgress(null);}
 }
 const mb=release.size?` · ${Math.round(release.size/1048576)} MB`:'';
 return <View style={[ui.card,{flexDirection:'row',alignItems:'center',gap:12}]}>
  <View style={{width:42,height:42,borderRadius:21,backgroundColor:c.blue50,alignItems:'center',justifyContent:'center'}}><Ionicons name="sparkles" size={19} color={c.blue}/></View>
  <View style={{flex:1}}><Text style={ui.title}>New version</Text><Text style={ui.caption}>{progress===null?`Build ${release.versionCode}${mb}`:`Downloading… ${Math.round(progress*100)}%`}</Text></View>
  <Pressable accessibilityRole="button" accessibilityLabel="Update the app" disabled={progress!==null} onPress={update} style={({pressed})=>[{backgroundColor:c.blue,borderRadius:999,paddingVertical:10,paddingHorizontal:16},(pressed||progress!==null)&&{opacity:0.7}]}>
   <Text style={{color:'#fff',fontWeight:'700',fontSize:14}}>{progress===null?'Update':`${Math.round(progress*100)}%`}</Text>
  </Pressable>
 </View>;
}
