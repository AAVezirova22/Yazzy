let csrf = '';
export function setCsrf(value:string){csrf=value;}
export class ApiError extends Error {constructor(public code:string, public status:number){super(code.replaceAll('_',' '));}}
export async function api<T=any>(path:string, options:RequestInit={}):Promise<T>{
  const response=await fetch('/api/v1'+path,{credentials:'include',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers}});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(body.detail?.code||`Request failed (${response.status})`,response.status);}
  if(response.status===204)return undefined as T;
  return response.json();
}
export const post=(path:string,body:unknown={})=>api(path,{method:'POST',body:JSON.stringify(body)});
export const patch=(path:string,body:unknown)=>api(path,{method:'PATCH',body:JSON.stringify(body)});
export function fmt(value:number|null|undefined,digits=1){return value==null?'—':new Intl.NumberFormat('en',{maximumFractionDigits:digits}).format(value);}
export function date(value:number|null|undefined){return value?new Date(value*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No observations';}
