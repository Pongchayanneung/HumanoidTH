'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SearchContentType, SearchResponse, SearchResult, SearchResultEvidence } from '../../lib/search/types';
import { contentTypes, safeSourceUrl, searchClient, validRanges } from './searchClient';

const copy = {
 en: {title:'Search the atlas',desc:'Find related public papers, repositories, videos, robots and records in Thai or English.',search:'Search',placeholder:'e.g. social robot elderly care',clear:'Clear search',all:'All',filters:'Content type',results:'Results',browse:'Public records, not matched to a query.',loading:'Searching…',empty:'No matching public records.',failure:'Search is unavailable right now.',retry:'Retry',keyword:'Meaning-based search is offline; showing keyword matches. Thai queries may miss English records, and the reverse.',hybrid:'Meaning + keyword search',demo:'Meaning-based search (experimental, not yet calibrated)',indexed:'records indexed',time:'Index built',show:'Show original',hide:'Hide original',source:'Go to source (opens in new tab)',related:'Related by meaning',note:'Related information, not a verified answer.',partial:'Truncated text',titleOnly:'Title/metadata only',labels:['Paper','Repository','Video','News/Web','Source','Robot','Contribution','Perspective','Inventory','Relationship','Organization/Entity'],limits:['Abstract excerpt','Repository description','Video description','Catalog summary']},
 th: {title:'ค้นหาในแอตลาส',desc:'ค้นหางานวิจัย คลังโค้ด วิดีโอ หุ่นยนต์ และข้อมูลสาธารณะที่เกี่ยวข้อง ได้ทั้งภาษาไทยและอังกฤษ',search:'ค้นหา',placeholder:'เช่น หุ่นยนต์ดูแลผู้สูงอายุ',clear:'ล้างคำค้น',all:'ทั้งหมด',filters:'ประเภทข้อมูล',results:'ผลการค้นหา',browse:'ข้อมูลสาธารณะ ยังไม่ได้จับคู่กับคำค้น',loading:'กำลังค้นหา…',empty:'ไม่พบข้อมูลสาธารณะที่ตรงกัน',failure:'ขณะนี้ไม่สามารถค้นหาได้',retry:'ลองอีกครั้ง',keyword:'ระบบค้นหาเชิงความหมายไม่พร้อม แสดงผลแบบคำค้นตรงตัว คำค้นภาษาไทยอาจไม่พบข้อมูลภาษาอังกฤษ และกลับกัน',hybrid:'ค้นหาตามความหมายและคำค้น',demo:'ค้นด้วยความหมาย (ทดลอง ยังไม่ได้ปรับเทียบ)',indexed:'รายการที่จัดทำดัชนี',time:'สร้างดัชนีเมื่อ',show:'แสดงต้นฉบับ',hide:'ซ่อนต้นฉบับ',source:'เปิดแหล่งที่มา (เปิดในแท็บใหม่)',related:'เกี่ยวข้องตามความหมาย',note:'ข้อมูลที่เกี่ยวข้อง ไม่ใช่คำตอบที่ยืนยันแล้ว',partial:'ข้อความที่ถูกตัด',titleOnly:'เฉพาะชื่อหรือข้อมูลกำกับ',labels:['งานวิจัย','คลังโค้ด','วิดีโอ','ข่าวและเว็บ','แหล่งข้อมูล','หุ่นยนต์','ผลงาน','มุมมอง','ครุภัณฑ์','ความสัมพันธ์','องค์กร/หน่วยงาน'],limits:['ข้อความคัดย่อ','คำอธิบายคลังโค้ด','คำอธิบายวิดีโอ','สรุปรายการ']}
};
type Filter = SearchContentType | '';
function readLocation() {
 if (typeof window === 'undefined') return {query: '', type: '' as Filter};
 const searchParams = new URLSearchParams(window.location.search);
 const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash);
 const q = searchParams.get('query') ?? searchParams.get('q') ?? hashParams.get('query') ?? '';
 const rawType = searchParams.get('type') ?? hashParams.get('type') ?? '';
 const type = contentTypes.includes(rawType as SearchContentType) ? rawType as Filter : '' as Filter;
 return {query: q.slice(0,300), type};
}
function Highlight({text,ranges}: {text:string; ranges:{start:number;end:number}[]}) {
 let cursor = 0;
 const parts = validRanges(text,ranges).map(range => {const before = text.slice(cursor,range.start); cursor=range.end; return <span key={range.start}>{before}<mark>{text.slice(range.start,range.end)}</mark></span>;});
 return <>{parts}{text.slice(cursor)}</>;
}
function evidenceLabel(item: SearchResultEvidence, result: SearchResult, lang: 'en'|'th') {
 const t=copy[lang];
 if(item.coverage==='title-only') return t.titleOnly;
 if(item.coverage==='partial') return t.partial;
 if(item.fieldName==='title' || item.fieldName==='canonical_name' || item.fieldName==='canonicalName') return lang==='th'?'ชื่อเรื่อง':'Title';
 if(item.fieldName==='abstract') return t.limits[0];
 if(['excerpt','evidence_excerpt','evidenceExcerpt'].includes(item.fieldName)) return lang==='th'?'ข้อความต้นฉบับ':'Original excerpt';
 if(item.fieldName==='description' && result.contentType==='repository') return t.limits[1];
 if(item.fieldName==='description' && result.contentType==='video') return t.limits[2];
 return item.label;
}
export function Card({ result, lang, results = [result] }: { result: SearchResult; lang: 'en' | 'th'; results?: SearchResult[] }) {
  const t = copy[lang];
  const thai = lang === 'th';
  const typeLabel = (member: SearchResult) => t.labels[contentTypes.indexOf(member.contentType)] ?? member.contentType;
  const language = (member: SearchResult) => member.language === 'th' || member.language === 'en' ? member.language : undefined;
  const languageLabel = (member: SearchResult) => {
    if (member.language === 'th') return thai ? 'ต้นฉบับ: ไทย' : 'Original: Thai';
    if (member.language === 'en') return thai ? 'ต้นฉบับ: อังกฤษ' : 'Original: English';
    return thai ? 'ภาษาไม่ระบุหรือผสม' : 'Language unknown or mixed';
  };
  const derived = thai ? 'ข้อความที่สร้างขึ้น' : 'Derived text';
  const original = thai ? 'ข้อความต้นฉบับ' : 'Source text';
  const [open, setOpen] = useState(false);

  return (
    <article className="search-card">
      <header>
        <span className="search-badge">{typeLabel(result)}</span>
        <h3 lang={language(result)}>{result.title}</h3>
      </header>
      {results.map((member, index) => {
        const match = member.match;
        const evidence = match?.evidence ??
          member.evidence.find(item => item.fieldName !== 'title' && item.originalText !== member.title) ??
          member.evidence[0];
        const semanticOnly = match?.methods.length === 1 && match.methods[0] === 'semantic';
        const ranges = match && !semanticOnly ? match.ranges ?? [] : [];
        const url = safeSourceUrl(member.url);
        const reference = member.reference;
        const robotId = reference.kind === 'robot' && reference.id.startsWith('robot:') ? reference.id.slice(6) : '';

        return (
          <div key={reference.kind + ':' + reference.id}>
            <div className="search-evidence">
              {index > 0 && <><span className="search-badge">{typeLabel(member)}</span><h4 lang={language(member)}>{member.title}</h4></>}
              <span className="search-tag">{languageLabel(member)}</span>
              {evidence ? <>
                <span className="search-tag">{evidenceLabel(evidence, member, lang)}</span>
                <span className="search-tag">{evidence.evidenceKind === 'derived' ? derived : original}</span>
                {semanticOnly && <span className="search-tag">{t.related}</span>}
                <p lang={language(member)}><Highlight text={evidence.originalText} ranges={ranges} /></p>
              </> : <span className="search-tag">{t.titleOnly} · {thai ? 'ไม่มีข้อความหลักฐาน' : 'Evidence excerpt unavailable'}</span>}
            </div>
            {(url || robotId) && <div className="search-actions">
              {robotId && <Link href={{ pathname: '/robots', query: { robot: robotId } }}>{thai ? 'ดูระเบียนหุ่นยนต์' : 'View robot record'}</Link>}
              {url && <a href={url} target="_blank" rel="noopener noreferrer">{t.source} ↗</a>}
            </div>}
            {open && member.evidence.map((item, itemIndex) => (
              <p className="search-original" lang={language(member)} key={itemIndex}>
                <strong>{item.evidenceKind === 'derived' ? derived : item.label}: </strong>{item.originalText}
              </p>
            ))}
          </div>
        );
      })}
      {results.some(member => member.evidence.length > 0) && <div className="search-actions">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t.hide : t.show}</button>
      </div>}
    </article>
  );
}
export default function SearchPage({lang}: {lang:'en'|'th'}) {
 const t=copy[lang]; const [query,setQuery]=useState(''); const [request,setRequest]=useState<{query:string;type:Filter}|null>(null); const [response,setResponse]=useState<SearchResponse|null>(null); const [loading,setLoading]=useState(true); const [failed,setFailed]=useState(false); const input=useRef<HTMLInputElement>(null); const sequence=useRef(0); const active=useRef<AbortController|null>(null);
 useEffect(()=>{const restore=()=>{const state=readLocation();setQuery(state.query);setRequest(state);}; restore();window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore); const shortcut=(event:KeyboardEvent)=>{if(event.code==='Slash'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!(event.target instanceof HTMLElement&&(event.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))){event.preventDefault();input.current?.focus();}};window.addEventListener('keydown',shortcut);return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore);window.removeEventListener('keydown',shortcut);};},[]);
 useEffect(()=>{if(!request)return;const controller=new AbortController();active.current=controller;const id=++sequence.current;setLoading(true);setFailed(false);setResponse(null);searchClient(request.query,request.type,controller.signal).then(data=>{if(id===sequence.current&&!controller.signal.aborted){if(data.mode==='unavailable')setFailed(true);else setResponse(data);}}).catch(()=>{if(id===sequence.current&&!controller.signal.aborted)setFailed(true);}).finally(()=>{if(id===sequence.current&&!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[request]);
 const navigate=(nextQuery:string,type:Filter)=>{active.current?.abort();sequence.current++;setLoading(true);setResponse(null);setFailed(false);const params=new URLSearchParams();if(nextQuery)params.set('query',nextQuery);if(type)params.set('type',type);const qs=params.toString();const url=qs?`/search?${qs}`:'/search';if(typeof window!=='undefined'){window.history.pushState(null,'',url);}setQuery(nextQuery);setRequest({query:nextQuery,type});};
 const type=request?.type??''; const groups=response?.groups.map(group=>({...group,results:group.results.filter(result=>!type||result.contentType===type)})).filter(group=>group.results.length)??[];
 return <div className="search-page"><h1>{t.title}</h1><p>{t.desc}</p><form className="search-form-f7" role="search" onSubmit={event=>{event.preventDefault();navigate(query.trim(),type);}}><label className="search-sr" htmlFor="atlas-search">{t.search}</label><input ref={input} id="atlas-search" type="search" value={query} maxLength={300} placeholder={t.placeholder} onChange={event=>{const value=event.target.value;setQuery(value);if(!value)navigate('',type);}}/><button type="submit">{t.search}</button>{query&&<button type="button" onClick={()=>{navigate('',type);input.current?.focus();}}>{t.clear}</button>}</form>
 <div className="search-status" aria-live="polite">{loading?t.loading:response?<>{response.mode==='keyword'?(response.view==='browse' ? (lang==='th'?'ระบบค้นหาเชิงความหมายไม่พร้อม':'Meaning-based search is offline') : t.keyword):(response.policyStatus==='demo_unvalidated'?t.demo:t.hybrid)}{response.mode==='hybrid'&&response.coverage.indexed<response.coverage.eligible&&<> · {response.coverage.indexed} / {response.coverage.eligible} {t.indexed}</>}{response.release&&<> · {t.time} <time dateTime={response.release.generatedAt}>{response.release.generatedAt}</time></>}{response.warnings.includes('stale_index')&&<> · {lang==='th'?'ดัชนีอาจไม่ล่าสุด':'Index may be stale'}</>}</>:failed?t.failure:null}</div>
 <div className="search-filters" role="group" aria-label={t.filters}>{(['',...contentTypes] as Filter[]).map((value,i)=><button key={value} type="button" aria-pressed={type===value} onClick={()=>navigate(query.trim(),value)}>{i?t.labels[i-1]:t.all}</button>)}</div>
 <section aria-labelledby="search-results" aria-busy={loading}><h2 id="search-results">{t.results}</h2><p>{t.note}</p>{loading?<div className="search-panel">{t.loading}</div>:failed?<div className="search-panel search-error" role="alert">{t.failure} <button type="button" onClick={()=>setRequest({query:request?.query??'',type})}>{t.retry}</button></div>:<>{response?.view==='browse'&&<p>{t.browse}</p>}{groups.length?groups.map(group=><Card key={group.groupKey} result={group.results[0]} results={group.results} lang={lang}/>):<div className="search-panel">{t.empty}</div>}</>}</section></div>;
}
