import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validRanges } from '../app/search/searchClient';
test('ranges are ordered and cannot split surrogate pairs',()=>{
 assert.deepEqual(validRanges('😀robot test',[{start:8,end:12},{start:2,end:7},{start:1,end:2}]),[{start:2,end:7},{start:8,end:12}]);
});

test('client sends subtype to the server before its group limit',async()=>{
 const { searchClient }=await import('../app/search/searchClient');
 const { createSearchPost }=await import('../lib/search/api');
 const { documents }=await import('./fixtures/search/documents');
 const source=documents[0];
 const records=[...Array.from({length:21},(_,i)=>({...source,typedId:`source:${i}`,url:`https://github.com/a/${i}`,groupId:`g${i}`})),{...source,typedId:'source:paper',url:'https://doi.org/10.1/a',groupId:'paper'}];
 const post=createSearchPost(async()=>({documents:records,release:{id:'fixture',generatedAt:'2026-01-01'},coverage:{indexed:0,eligible:22}}));
 const original=globalThis.fetch;
 globalThis.fetch=async (_input,init)=>post(new Request('http://localhost/api/search',init));
 try {const data=await searchClient('', 'paper', new AbortController().signal);assert.equal(data.groups.length,1);assert.equal(data.groups[0].results[0].reference.id,'source:paper');} finally {globalThis.fetch=original;}
});
