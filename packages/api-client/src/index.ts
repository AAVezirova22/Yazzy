import type {components} from './schema';
export type {paths,components,operations} from './schema';
export type TelemetryBatch=components['schemas']['TelemetryBatch'];
export type VehicleInput=components['schemas']['VehicleInput'];
export type WorkOrderInput=components['schemas']['WorkOrderInput'];
export class YazzyClient {
 constructor(private baseUrl:string,private headers:()=>Record<string,string> = ()=>({})){}
 async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(this.baseUrl+'/api/v1'+path,{method,credentials:'include',headers:{'Content-Type':'application/json',...this.headers()},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.detail?.code||`HTTP ${response.status}`),{status:response.status});
  return result as T;
 }
 createVehicle(data:VehicleInput){return this.request('/vehicles','POST',data)}
 ingest(data:TelemetryBatch,deviceToken:string){return fetch(this.baseUrl+'/api/v1/telemetry/batches',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Device '+deviceToken},body:JSON.stringify(data)});}
 createWorkOrder(organisationId:string,data:WorkOrderInput){return this.request(`/organisations/${encodeURIComponent(organisationId)}/work-orders`,'POST',data)}
}
