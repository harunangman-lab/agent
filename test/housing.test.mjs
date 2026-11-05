import test from 'node:test';
import assert from 'node:assert/strict';
import { isCollectiveHousing,lookupAreaHousing } from '../lib/buildings.mjs';
const query={sigunguCd:'11290',bjdongCd:'13400'};
test('collective housing excludes detached townhouses and ancillary facilities, preserves unknown household counts',()=>{
  assert.equal(isCollectiveHousing({mainPurpsCd:'02000',mainAtchGbCd:'0',hhldCnt:null}),true);
  assert.equal(isCollectiveHousing({mainPurpsCdNm:'공동주택',mainAtchGbCd:1}),false);
  assert.equal(isCollectiveHousing({mainPurpsCdNm:'공동주택',dongNm:'경비실13',hhldCnt:0}),false);
  assert.equal(isCollectiveHousing({mainPurpsCd:'01000',mainPurpsCdNm:'단독주택',bldNm:'타운하우스',hhldCnt:3}),false);
});
test('area browse combines same-address building aliases and lots, separates same-name buildings at different addresses',async()=>{
  const base={mainPurpsCd:'02000',mainPurpsCdNm:'공동주택',mainAtchGbCd:'0',naRoadCd:'112903107001',naMainBun:118,naSubBun:0,hhldCnt:10,etcPurps:'아파트',newPlatPlc:'길음로 118'};
  const rows=[
    {...base,mgmBldrgstPk:'A',bldNm:'길음4단지',dongNm:'401동',platPlc:'길음동 1281번지'},
    {...base,mgmBldrgstPk:'B',bldNm:'길음뉴타운',dongNm:'426동',platPlc:'길음동 1281-1번지'},
    {...base,mgmBldrgstPk:'A',bldNm:'길음4단지',dongNm:'401동',platPlc:'길음동 1281번지'},
    {...base,mgmBldrgstPk:'C',bldNm:'길음4단지',naMainBun:120,newPlatPlc:'길음로 120',etcPurps:'연립주택'},
    {...base,mgmBldrgstPk:'D',bldNm:'보람빌라',naMainBun:122,newPlatPlc:'길음로 122',etcPurps:'다세대주택'},
    {...base,mgmBldrgstPk:'X',mainAtchGbCd:'1',dongNm:'경비실'},
    {...base,mgmBldrgstPk:'Y',mainPurpsCd:'01000',mainPurpsCdNm:'단독주택'},
  ];
  let called;
  const result=await lookupAreaHousing(query,'test',async url=>{called=url;return new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}}));});
  assert.equal(result.buildings.length,4);assert.equal(result.complexes.length,3);
  const complex=result.complexes.find(g=>g.buildingIds.includes('A'));
  assert.deepEqual(complex.buildingIds,['A','B']);assert.equal(complex.lots.length,2);assert.equal(complex.names.length,2);
  assert.deepEqual(complex.types,['아파트']);
  assert.ok(result.complexes.some(g=>g.types.includes('연립주택')));assert.ok(result.complexes.some(g=>g.types.includes('다세대주택')));
  assert.equal(called.searchParams.has('bun'),false);assert.equal(called.searchParams.has('ji'),false);
});
test('invalid zero road numbers do not merge unrelated unnamed-address buildings',async()=>{
  const rows=['A','B'].map((id,i)=>({mgmBldrgstPk:id,mainPurpsCd:'02000',bldNm:'동일이름',platPlc:`길음동 ${i+1}번지`,naRoadCd:'112903107001',naMainBun:0,naSubBun:0}));
  const result=await lookupAreaHousing(query,'test',async()=>new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:2}}})));
  assert.equal(result.complexes.length,2);
});
