import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import {normalPlate} from './carChecks';

/**
 * The registration certificate (талон): a photo kept only on this phone, read on the phone (ML Kit, offline) for
 * the plate (field A) and the VIN (field E). Nothing of it is uploaded.
 */
const dir=FileSystem.documentDirectory?FileSystem.documentDirectory+'talon/':null;
export const talonPath=(vehicleId:string)=>dir?`${dir}${vehicleId}.jpg`:null;

export async function talonExists(vehicleId:string){
 const path=talonPath(vehicleId);if(!path)return false;
 return (await FileSystem.getInfoAsync(path).catch(()=>({exists:false}))).exists;
}

/** Takes or picks a photo, keeps a copy for the car, and returns what could be read from it. */
export async function captureTalon(vehicleId:string,camera:boolean):Promise<{uri:string;plate:string|null;vin:string|null}|null>{
 const permission=camera?await ImagePicker.requestCameraPermissionsAsync():await ImagePicker.requestMediaLibraryPermissionsAsync();
 if(!permission.granted)throw new Error(camera?'Allow the camera to photograph the registration certificate.':'Allow access to photos to pick the registration certificate.');
 const result=camera?await ImagePicker.launchCameraAsync({quality:0.8,mediaTypes:['images']}):await ImagePicker.launchImageLibraryAsync({quality:0.8,mediaTypes:['images']});
 if(result.canceled||!result.assets?.[0])return null;
 const source=result.assets[0].uri,target=talonPath(vehicleId);
 if(dir&&target){await FileSystem.makeDirectoryAsync(dir,{intermediates:true}).catch(()=>{});await FileSystem.deleteAsync(target,{idempotent:true});await FileSystem.copyAsync({from:source,to:target});}
 const read=await readTalon(source).catch(()=>({plate:null,vin:null}));
 return {uri:target||source,...read};
}

export async function removeTalon(vehicleId:string){const path=talonPath(vehicleId);if(path)await FileSystem.deleteAsync(path,{idempotent:true});}

/** The plate and VIN printed on a Bulgarian registration certificate, when the text recognition finds them. */
export async function readTalon(uri:string){
 const {text}=await TextRecognition.recognize(uri);
 const flat=text.toUpperCase();
 // Plates: one or two letters, four digits, one or two letters (Cyrillic look-alikes allowed), spaces optional.
 const plate=flat.match(/\b([ABEKMHOPCTYXАВЕКМНОРСТУХ]{1,2})\s?(\d{4})\s?([ABEKMHOPCTYXАВЕКМНОРСТУХ]{1,2})\b/);
 const vin=flat.replace(/[^A-Z0-9\n ]/g,' ').match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
 return {plate:plate?normalPlate(plate[1]+plate[2]+plate[3]):null,vin:vin?vin[0]:null};
}
