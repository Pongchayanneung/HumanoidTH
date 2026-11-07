import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '../app/search/SearchPage';
import type { SearchResult, SearchResultEvidence } from '../lib/search/types';
const evidence: SearchResultEvidence={fieldName:'title',originalText:'😀 robot',label:'Title',coverage:'title-only',startOffset:0,endOffset:8,evidenceKind:'source'};
const base={reference:{kind:'source' as const,id:'fixture'},contentType:'paper' as const,title:'Example',url:'javascript:alert(1)',evidence:[evidence]};
const html=(result:SearchResult)=>renderToStaticMarkup(React.createElement(Card,{result,lang:'en'}));
test('keyword evidence uses only API UTF-16 ranges and labels stored text',()=>{
 const output=html({...base,match:{methods:['keyword'],evidence,ranges:[{start:3,end:8}]}});
 assert.match(output,/<mark>robot<\/mark>/);assert.match(output,/Title\/metadata only/);assert.match(output,/Paper/);assert.doesNotMatch(output,/href=/);
 const noRanges=html({...base,match:{methods:['keyword'],evidence}});assert.doesNotMatch(noRanges,/<mark>/);
});
test('semantic and browse cards do not claim literal matches',()=>{
 const semantic=html({...base,match:{methods:['semantic'],evidence}});assert.match(semantic,/Related by meaning/);assert.doesNotMatch(semantic,/<mark>/);
 const browse=html(base);assert.doesNotMatch(browse,/Related by meaning|<mark>/);
});

test('group renders member evidence, source languages, field limits and derived labels',()=>{
 const title={...evidence,coverage:'full' as const,originalText:'Paper title'};
 const derived={...evidence,fieldName:'relation',label:'Structured Relation',originalText:'หุ่นยนต์ ช่วย คน',coverage:'full' as const,evidenceKind:'derived' as const};
 const paper={...base,title:'Paper title',language:'en' as const,evidence:[title],match:{methods:['keyword'] as ['keyword'],evidence:title,ranges:[{start:0,end:5}]}};
 const relation={...base,reference:{kind:'relationship' as const,id:'relation'},contentType:'relationship' as const,language:'th' as const,evidence:[derived],match:{methods:['semantic'] as ['semantic'],evidence:derived,ranges:[{start:0,end:2}]}};
 const output=renderToStaticMarkup(React.createElement(Card,{result:paper,results:[paper,relation as unknown as SearchResult],lang:'en'}));
 assert.equal((output.match(/<article/g)||[]).length,1);assert.match(output,/Original: English/);assert.match(output,/Original: Thai/);assert.match(output,/lang="th"/);assert.match(output,/lang="en"/);assert.match(output,/Derived text/);assert.match(output,/Structured Relation/);assert.doesNotMatch(output,/Abstract excerpt|Catalog summary/);assert.equal((output.match(/<mark>/g)||[]).length,1);
});
test('browse prefers excerpt and empty evidence does not expose an empty expander',()=>{
 const excerpt={...evidence,fieldName:'excerpt',originalText:'Stored excerpt',coverage:'full' as const};
 const output=html({...base,evidence:[evidence,excerpt]});assert.match(output,/Stored excerpt/);
 const empty=html({...base,evidence:[]});assert.match(empty,/Title\/metadata only/);assert.doesNotMatch(empty,/Show original/);
});
