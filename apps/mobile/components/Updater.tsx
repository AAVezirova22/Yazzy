import {useEffect,useState} from 'react';
import {Alert,AppState,Platform,Pressable,Text,View} from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {c,ui,F} from './theme';
import {t} from './i18n';

/** yazzy-android.json, which scripts/build_apk.py --publish puts next to the APK in the GitHub release. */
type Build={versionCode:number;version?:string;apk:string;size?:number;md5?:string};
const extra=Constants.expoConfig?.extra;
// build_apk.py stamps the build number and the release address into the app; dev builds have neither and never prompt.
const installed=Number(extra?.versionCode)||0;
const releases:string=typeof extra?.updatesUrl==='string'?extra.updatesUrl:'';
// The recorder keeps the app alive for days, so look again when it comes back to the screen, at most hourly.
const RECHECK_MS=3600_000;

/** The newest published build, read straight from GitHub: updates no longer pass through the Yazzy server. */
async function newest():Promise<Build|null>{
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
 try{
  const r=await fetch(`${releases}/yazzy-android.json`,{signal:abort.signal,headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)return null;
  const b=await r.json();
  return typeof b?.versionCode==='number'&&typeof b?.apk==='string'&&/^[\w.-]+\.apk$/.test(b.apk)?b:null;
 }finally{clearTimeout(timer);}
}

/** Shows an "Update available" card when GitHub holds a newer APK, then downloads it and opens Android's installer. */
export function Updater(){
 const [build,setBuild]=useState<Build|null>(null),[progress,setProgress]=useState<number|null>(null),[checking,setChecking]=useState(false);
 useEffect(()=>{
  if(Platform.OS!=='android'||!installed||!releases)return;
  let last=0;
  const look=()=>{if(Date.now()-last<RECHECK_MS)return;last=Date.now();newest().then(b=>{if(b)setBuild(b);}).catch(()=>{last=0;});};
  look();
  const sub=AppState.addEventListener('change',s=>{if(s==='active')look();});
  return()=>sub.remove();
 },[]);
 if(!build||build.versionCode<=installed)return null;
 async function update(){
  try{
   setProgress(0);
   // A newer build may have been published while the card sat open.
   const latest=(await newest().catch(()=>null))||build!;
   const target=FileSystem.cacheDirectory+'Yazzy-update.apk';
   await FileSystem.deleteAsync(target,{idempotent:true});
   const download=FileSystem.createDownloadResumable(`${releases}/${latest.apk}`,target,{},p=>setProgress(p.totalBytesExpectedToWrite>0?p.totalBytesWritten/p.totalBytesExpectedToWrite:0));
   const result=await download.downloadAsync();
   if(!result||result.status!==200)throw new Error(t('Download failed ({status})',{status:result?.status??t('no response')}));
   if(latest.md5){
    setChecking(true);
    const info=await FileSystem.getInfoAsync(result.uri,{md5:true});
    if(!info.exists||info.md5!==latest.md5){await FileSystem.deleteAsync(target,{idempotent:true});throw new Error(t('The download was incomplete. Tap Update to try again.'));}
   }
   const uri=await FileSystem.getContentUriAsync(result.uri);
   // FLAG_GRANT_READ_URI_PERMISSION so the system installer can read the file.
   await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:uri,flags:1,type:'application/vnd.android.package-archive'});
  }catch(e){Alert.alert(t('Yazzy update'),(e as Error).message+'\n\n'+t('If Android blocked it, allow "Install unknown apps" for Yazzy and tap Update again.'));}
  finally{setProgress(null);setChecking(false);}
 }
 const mb=build.size?` · ${Math.round(build.size/1048576)} MB`:'';
 const status=progress===null?t('Build {n}',{n:build.versionCode})+mb:checking?t('Checking the download…'):t('Downloading… {p}%',{p:Math.round(progress*100)});
 return <View style={[ui.card,{flexDirection:'row',alignItems:'center',gap:12}]}>
  <View style={{width:42,height:42,borderRadius:3,backgroundColor:c.blue50,alignItems:'center',justifyContent:'center'}}><Ionicons name="sparkles" size={19} color={c.blue}/></View>
  <View style={{flex:1}}><Text style={ui.title}>{t('New version')}</Text><Text style={ui.caption}>{status}</Text></View>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Update the app')} disabled={progress!==null} onPress={update} style={({pressed})=>[{backgroundColor:c.blue,borderRadius:3,paddingVertical:10,paddingHorizontal:16},(pressed||progress!==null)&&{opacity:0.7}]}>
   <Text style={{color:'#fff',fontFamily:F[700],fontSize:14}}>{progress===null?t('Update'):checking?'…':`${Math.round(progress*100)}%`}</Text>
  </Pressable>
 </View>;
}
