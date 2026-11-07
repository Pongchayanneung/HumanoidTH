import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeSourceUrl, validRanges, searchClient } from '../app/search/searchClient';

test('source links reject unsafe protocols and credentials', () => {
 assert.equal(safeSourceUrl('javascript:alert(1)'), null);
 assert.equal(safeSourceUrl('https://user:pass@example.org/'), null);
 assert.equal(safeSourceUrl('https://example.org/path'), 'https://example.org/path');
});
test('ranges use UTF-16 and reject invalid or overlapping offsets', () => {
 assert.deepEqual(validRanges('😀robot', [{start:2,end:7},{start:1,end:4},{start:8,end:9}]), [{start:2,end:7}]);
});
test('client sends F1 source kind and abort signal', async () => {
 const original=globalThis.fetch; const controller=new AbortController();
 try {globalThis.fetch=async (_url,init)=>{assert.equal(init?.signal,controller.signal);assert.deepEqual(JSON.parse(String(init?.body)),{query:'robot',types:['source'],subtype:'paper'});return Response.json({mode:'keyword'});}; await searchClient('robot','paper',controller.signal);} finally {globalThis.fetch=original;}
});

test('client maps displayed types to F1 kinds and omits filters for all', async () => {
 const original=globalThis.fetch; const controller=new AbortController();
 try {
  for (const [type, types] of [['repository',['source']],['robot',['robot']],['',undefined]] as const) {
   globalThis.fetch=async (_url,init)=>{assert.deepEqual(JSON.parse(String(init?.body)),types ? {query:'',types,...(type==='repository'?{subtype:type}:{})} : {query:''});return Response.json({mode:'keyword'});};
   await searchClient('',type,controller.signal);
  }
 } finally {globalThis.fetch=original;}
});
