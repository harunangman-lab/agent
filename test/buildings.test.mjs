import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBuilding, parseResponse, fetchRecords, lookupBuildings, AppError } from '../lib/buildings.mjs';
const payload = (items, total = items.length) => JSON.stringify({ response:{ header:{ resultCode:'00' }, body:{ items:{ item:items }, totalCount:total } } });
const query = { sigunguCd:'11680', bjdongCd:'10300', platGbCd:'0', bun:'0012', ji:'0000' };

test('zero is preserved; absent and partial parking values remain unknown', () => {
  const b = normalizeBuilding({ hhldCnt:0, grndFlrCnt:'0', totArea:'', indrAutoUtcnt:0, oudrAutoUtcnt:0, indrMechUtcnt:0 });
  assert.equal(b.hhldCnt, 0); assert.equal(b.grndFlrCnt, 0); assert.equal(b.totArea, null); assert.equal(b.parkingTotal, null);
  assert.equal(normalizeBuilding({ indrAutoUtcnt:0, oudrAutoUtcnt:0, indrMechUtcnt:0, oudrMechUtcnt:0 }).parkingTotal, 0);
  assert.equal(normalizeBuilding({ indrAutoUtcnt:1, oudrAutoUtcnt:2, indrMechUtcnt:3, oudrMechUtcnt:4 }).parkingTotal, 10);
});
test('22-digit JSON numeric primary keys retain every digit', () => {
  const r = parseResponse('{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":{"mgmBldrgstPk":1000000000000001047965,"totArea":1.2}},"totalCount":1}}}');
  assert.equal(r.items[0].mgmBldrgstPk, '1000000000000001047965'); assert.equal(r.items[0].totArea, 1.2);
});
test('single object, empty result, XML authentication, quota and malformed responses', () => {
  assert.equal(parseResponse(payload({ bldNm:'동' },1)).items.length, 1);
  assert.deepEqual(parseResponse(payload([])).items, []);
  assert.throws(() => parseResponse('<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>'), e => e.code === 'AUTH_ERROR');
  assert.throws(() => parseResponse('{"response":{"header":{"resultCode":"22"}}}'), e => e.code === 'QUOTA_ERROR');
  assert.throws(() => parseResponse('<html>error</html>'), e => e.code === 'RESPONSE_ERROR');
});
test('fetches every page and decodes encoded key exactly once', async () => {
  const calls = [];
  const rows = await fetchRecords('getBrTitleInfo', query, 'test%2Bkey%3D', async url => {
    calls.push(url); const page = Number(url.searchParams.get('pageNo'));
    return new Response(payload(Array.from({ length:page === 1 ? 100 : 1 }, (_,i) => ({ bldNm:`${page}-${i}` })), 101));
  });
  assert.equal(rows.length,101); assert.equal(calls.length,2); assert.equal(calls[0].searchParams.get('serviceKey'),'test+key=');
});
test('joins basic information only by same register key and keeps building identities distinct', async () => {
  const result = await lookupBuildings(query,'test', async url => new Response(payload(url.pathname.endsWith('getBrBasisOulnInfo') ? [{mgmBldrgstPk:'A',newPlatPlc:'주소A'},{mgmBldrgstPk:'B',newPlatPlc:'주소B'}] : [{mgmBldrgstPk:'A',bldNm:'A동',hhldCnt:0},{mgmBldrgstPk:'C',bldNm:'C동'}])));
  assert.equal(result.buildings[0].newPlatPlc,'주소A'); assert.equal(result.buildings[1].newPlatPlc,null); assert.equal(result.buildings[0].hhldCnt,0);
});
test('basic-only fallback excludes individual unit registers and labels partial information', async () => {
  const result = await lookupBuildings(query,'test', async url => new Response(payload(url.pathname.endsWith('getBrBasisOulnInfo') ? [{mgmBldrgstPk:'A',regstrKindCd:3},{mgmBldrgstPk:'B',regstrKindCd:4}] : [])));
  assert.equal(result.buildings.length,1); assert.equal(result.buildings[0].totArea,null); assert.equal(result.warnings.length,1);
});
test('missing key and network exceptions are sanitized', async () => {
  await assert.rejects(lookupBuildings(query,''), e => e.code === 'KEY_MISSING');
  await assert.rejects(fetchRecords('getBrTitleInfo', query, 'SECRET_KEY', async () => { throw new Error('SECRET_KEY'); }), e => e instanceof AppError && e.code === 'NETWORK_ERROR' && !e.message.includes('SECRET_KEY'));
});
