/**
 * The car's own make, model and model year, decoded from its VIN, and a studio picture of that exact model
 * generation with no background. The VIN goes to the free NHTSA vPIC decoder; the picture comes from the
 * imagin.studio CDN, which needs a customer key (EXPO_PUBLIC_CAR_IMAGE_KEY in apps/mobile/.env.local). Without
 * a key, or when the model is unknown there, the app keeps its own illustrated car.
 */
export type VinModel={
 vin:string;make:string;model:string;year:number|null;doors?:number|null;
 /** Whether the picture service has this model: true/false once checked with a key; absent until then. */
 found?:boolean;
};

const KEY=(process.env.EXPO_PUBLIC_CAR_IMAGE_KEY||'').trim();
export const hasImageKey=!!KEY;

const ACRONYMS=new Set(['BMW','MG','GMC','BYD','DS','RAM','SEAT','VW']);
const title=(s:string)=>ACRONYMS.has(s.toUpperCase())?s.toUpperCase():s.toLowerCase().replace(/(^|[\s-])([a-z])/g,(_,a,b)=>a+b.toUpperCase());
const slug=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,'-');

/** Make, model and model year from a 17-character VIN, or null when the decoder knows neither make nor model. */
export async function decodeVin(vin:string):Promise<VinModel|null>{
 const r=await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
 if(!r.ok)throw new Error(`VIN decoder HTTP ${r.status}`);
 const x=(await r.json())?.Results?.[0]||{};
 const make=String(x.Make||'').trim(),model=String(x.Model||'').trim(),year=parseInt(x.ModelYear,10),doors=parseInt(x.Doors,10);
 if(!make||!model)return null;
 return {vin,make:title(make).slice(0,60),model:model.slice(0,60),year:year>=1950&&year<=2100?year:null,doors:doors>0?doors:null};
}

/** The picture of this model generation, front three-quarter view in blue, on a transparent 2:1 canvas. */
export function carImageUrl(m:VinModel){
 if(!KEY||m.year==null)return null;
 const q:Record<string,string>={customer:KEY,make:slug(m.make),modelFamily:slug(m.model),modelYear:String(m.year),angle:'23',zoomType:'fullscreen',aspectRatio:'2',width:'1000',paintDescription:'blue'};
 if(m.doors)q.bodySize=String(m.doors);
 return 'https://cdn.imagin.studio/getImage?'+Object.entries(q).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
}

/** Asks the picture service whether it has this exact model; it otherwise answers with a covered placeholder car. */
export async function imageFound(m:VinModel){
 const url=carImageUrl(m);if(!url)return false;
 const r=await fetch(url,{method:'HEAD'});
 return r.ok&&(r.headers.get('x-imaginstudio-request-found')||'').toLowerCase()==='true';
}
