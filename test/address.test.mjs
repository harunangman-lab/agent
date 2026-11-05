import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoadAddress } from '../public/address.mjs';
const codes = new Set(['1168010300','5013032026']);
const selected = {roadAddress:'서울특별시 강남구 개포로109길 9',jibunAddress:'서울특별시 강남구 개포동 12',bcode:'1168010300',noSelected:'N'};
test('selected road address maps to exact legal code and lot, not road building number', () => {
  assert.deepEqual(normalizeRoadAddress(selected,codes).query, {sigunguCd:'11680',bjdongCd:'10300',platGbCd:'0',bun:'0012',ji:'0000'});
});
test('rural ri, sub-lot and mountain lot remain distinct', () => {
  const data = {...selected,bcode:'5013032026',jibunAddress:'제주특별자치도 서귀포시 대정읍 보성리 산 12-3'};
  assert.deepEqual(normalizeRoadAddress(data,codes).query, {sigunguCd:'50130',bjdongCd:'32026',platGbCd:'1',bun:'0012',ji:'0003'});
});
test('ambiguous automatic first mapping must never be used', () => {
  assert.throws(() => normalizeRoadAddress({...selected,jibunAddress:'',autoJibunAddress:selected.jibunAddress},codes), /지번/);
  assert.throws(() => normalizeRoadAddress({...selected,noSelected:'Y'},codes), /지번/);
});
test('missing road address, unknown code and unparseable lot are rejected', () => {
  assert.throws(() => normalizeRoadAddress({...selected,roadAddress:''},codes), /도로명주소/);
  assert.throws(() => normalizeRoadAddress({...selected,bcode:'0000000000'},codes), /코드/);
  assert.throws(() => normalizeRoadAddress({...selected,jibunAddress:'서울특별시 강남구 개포동'},codes), /본번/);
});
test('verified Edu city-ro 148 provider mismatch resolves to Boseong-ri 2424, preserving evidence', () => {
  const codes = new Set(['5013025029']);
  const bad = {roadAddress:'제주특별자치도 서귀포시 대정읍 에듀시티로 148',jibunAddress:'제주특별자치도 서귀포시 대정읍 보성리 2484',bcode:'5013025029'};
  const result = normalizeRoadAddress(bad,codes);
  assert.equal(result.jibunAddress,'제주특별자치도 서귀포시 대정읍 보성리 2424');
  assert.equal(result.query.bun,'2424'); assert.equal(result.query.ji,'0000');
  assert.equal(result.correction.originalJibunAddress,bad.jibunAddress);
  assert.equal(result.correction.verifiedOn,'2026-11-05');
  const alreadyCorrect = normalizeRoadAddress({...bad,jibunAddress:'제주특별자치도 서귀포시 대정읍 보성리 2424'},codes);
  assert.equal(alreadyCorrect.query.bun,'2424'); assert.equal(alreadyCorrect.correction,null);
  assert.equal(normalizeRoadAddress({...bad,roadAddress:'제주특별자치도 서귀포시 대정읍 에듀시티로 148-1'},codes).query.bun,'2484');
  assert.equal(normalizeRoadAddress({...bad,jibunAddress:'제주특별자치도 서귀포시 대정읍 보성리 2484-1'},codes).query.bun,'2484');
});
