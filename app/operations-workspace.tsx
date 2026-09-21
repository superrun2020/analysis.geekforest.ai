"use client";
import { useEffect, useState } from "react";
import { getCompanyAuthToken } from "./company-auth";
import { DailyAnomalies } from "./daily-anomalies";
export type OperationsEntry = "overview";
export const legacyOperationsEntries = new Set(["overview", "projects", "issues", "monitoring"]);
export const operationsEntries: Array<{key: OperationsEntry; label: string}> = [{key:"overview",label:"每日异常"}];
export function OperationsWorkspace({active}: {active:boolean;entry?:OperationsEntry;initialPage?:string|null}) {
  const [ready,setReady]=useState(false), [error,setError]=useState<{message:string;status?:number}|null>(null), [retry,setRetry]=useState(0), [revocationEpoch,setRevocationEpoch]=useState(0);
  const clearRevokedSession=(reason?: {status?:number})=>{
    setReady(false);
    setRevocationEpoch(epoch=>epoch+1);
    setError(reason?.status===401?{message:"当前登录已过期，请重新登录",status:401}:{message:"当前账号无权访问每日异常",status:403});
    void fetch("/operations/session",{method:"DELETE",credentials:"include"}).catch(()=>undefined);
  };
  useEffect(()=>{
    if(!active)return;
    let alive=true; const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    fetch("/operations/session",{method:"POST",credentials:"include",signal:controller.signal,headers:{Authorization:`Bearer ${getCompanyAuthToken()}`}})
      .then(response=>{if(!response.ok)throw Object.assign(new Error(`认证失败 HTTP ${response.status}`),{status:response.status});if(alive)setReady(true)})
      .catch(e=>{if(!alive)return;if([401,403].includes(e.status)){clearRevokedSession(e);return}setError({message:e.name==="AbortError"?"数据读取超时，请重试读取":e.message})})
      .finally(()=>clearTimeout(timer));
    return()=>{alive=false;clearTimeout(timer);controller.abort()};
  },[active,retry]);
  if(!active)return null;
  const retryRead=()=>{setReady(false);setError(null);setRetry(n=>n+1)};
  return <section className="operations-workspace" data-testid="native-daily-anomalies"><DailyAnomalies key={revocationEpoch} ready={ready} authError={error} onRetry={retryRead} onAuthRevoked={clearRevokedSession}/></section>;
}
