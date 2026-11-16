// Extends app.json. Android's react-native-maps uses Google Maps, which needs an API key at build time:
//   GOOGLE_MAPS_API_KEY=... npx expo run:android --device
// Without it the trip screen draws a plain route sketch instead of a map, because creating a map view
// without a key crashes the app. iOS uses Apple Maps and needs no key.
module.exports=({config})=>{
 const key=process.env.GOOGLE_MAPS_API_KEY||'';
 // scripts/build_apk.py sets this from the git commit count so each new APK installs as an update.
 const versionCode=Number(process.env.YAZZY_VERSION_CODE)||undefined;
 return {...config,
  android:{...config.android,...(versionCode?{versionCode}:{}),...(key?{config:{googleMaps:{apiKey:key}}}:{})},
  extra:{...config.extra,googleMapsKey:Boolean(key),...(versionCode?{versionCode}:{})}};
};
