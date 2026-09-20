"use client";
import { useEffect, useState } from "react";
import { getCompanyAuthToken } from "./company-auth";
import { DailyAnomalies } from "./daily-anomalies";
export type OperationsEntry = "overview";
export const legacyOperationsEntries = new Set(["overview", "projects", "issues", "monitoring"]);
export const operationsEntries: Array<{key: OperationsEntry; label: string}> = [{key:"overview",label:"每日异常"}];
export function OperationsWorkspace({active}: {active:boolean;entry?:OperationsEntry;initialPage?:string|null}) {
  const [ready,setReady]=useState(false), [error,setError]=useState(""), [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!active)return;
    let alive=true; const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    setReady(false);setError("");
    fetch("/operations/session",{method:"POST",credentials:"include",signal:controller.signal,headers:{Authorization:`Bearer ${getCompanyAuthToken()}`}})
      .then(response=>{if(!response.ok)throw new Error(`认证失败 HTTP ${response.status}`);if(alive)setReady(true)})
      .catch(e=>{if(alive)setError(e.name==="AbortError"?"认证超时，请重试":e.message)})
      .finally(()=>clearTimeout(timer));
    return()=>{alive=false;clearTimeout(timer);controller.abort()};
  },[active,retry]);
  if(!active)return null;
  return <section className="operations-workspace" data-testid="native-daily-anomalies"><DailyAnomalies ready={ready} authError={error} onRetry={()=>setRetry(n=>n+1)}/></section>;
}
