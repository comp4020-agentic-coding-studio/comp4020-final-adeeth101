export async function request(path:string,body?:unknown){
  const res=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error??'Request failed.'),{status:res.status,current:data.current});return data;
}
export function sendCommand(id:string,type:string,payload:unknown,expectedRevision?:number){return request(`/api/projects/${id}/commands`,{commandId:crypto.randomUUID(),type,payload,expectedRevision});}
