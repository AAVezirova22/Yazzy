/**
 * The car's own make, model and model year, read from its VIN, and a studio picture of that exact model year
 * with no background. Our API asks carimage.dev (its key stays on the server) and keeps each picture, so the
 * phone only ever talks to our server. With no VIN, an unknown VIN or a car the catalog lacks, the app keeps
 * its own illustrated car.
 */
import {server} from './server';

export type VinModel={
 vin:string;make:string;model:string;year:number|null;
 /** READY: picture holds its address. PENDING: the server is still fetching it. NONE: no picture. */
 status:'READY'|'PENDING'|'NONE';picture?:string|null;
};

const ACRONYMS=new Set(['BMW','MG','GMC','BYD','DS','RAM','SEAT','VW']);
const title=(s:string)=>ACRONYMS.has(s.toUpperCase())?s.toUpperCase():s.toLowerCase().replace(/(^|[\s-])([a-z])/g,(_,a,b)=>a+b.toUpperCase());
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/** Asks the server about a VIN; while it fetches a new picture, asks again a few times. Throws when offline. */
export async function lookupVin(vin:string):Promise<VinModel>{
 let r:any={};
 for(let i=0;i<6;i++){r=await server.call(`/car-picture/${encodeURIComponent(vin)}`);if(r.status!=='PENDING')break;await wait(5000);}
 const year=Number(r.year);
 return {
  vin,make:r.make?title(String(r.make)).slice(0,60):'',model:r.model?String(r.model).slice(0,60):'',
  year:year>=1950&&year<=2100?year:null,status:r.status==='READY'||r.status==='PENDING'?r.status:'NONE',
  picture:r.status==='READY'&&r.url?server.api+r.url:null,
 };
}
