export type ApiError=Error&{status?:number;current?:any};
export async function request(path:string,body?:unknown){
  const res=await fetch(path,body===undefined?{headers:{accept:'application/json'}}:{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
  let data:any={};try{data=await res.json();}catch{data={error:res.status>=500?'The server had a problem. Try again.':'Unexpected response.'};}
  if(!res.ok)throw Object.assign(new Error(data.error??'Request failed.'),{status:res.status,current:data.current}) as ApiError;
  return data;
}
export function sendCommand(id:string,type:string,payload:unknown,expectedRevision?:number){return request(`/api/projects/${id}/commands`,{commandId:crypto.randomUUID(),type,payload,expectedRevision});}
