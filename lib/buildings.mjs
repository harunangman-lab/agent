export class AppError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export const value = v => v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
const numeric = v => value(v) !== null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function sumKnown(row, fields) {
  const parts = fields.map(k => numeric(row[k]));
  return parts.every(v => v !== null) ? parts.reduce((a, b) => a + b, 0) : null;
}
export function normalizeBuilding(row, index = 0) {
  const fields = ['mgmBldrgstPk','mgmUpBldrgstPk','bldNm','dongNm','platPlc','newPlatPlc','mainPurpsCd','mainPurpsCdNm','etcPurps','useAprDay','crtnDay','regstrGbCdNm','regstrKindCdNm','mainAtchGbCdNm','strctCdNm'];
  const result = Object.fromEntries(fields.map(k => [k, value(row[k])]));
  for (const k of ['grndFlrCnt','ugrndFlrCnt','totArea','platArea','archArea','hhldCnt','fmlyCnt','rideUseElvtCnt','emgenUseElvtCnt','indrMechUtcnt','oudrMechUtcnt','indrAutoUtcnt','oudrAutoUtcnt']) result[k] = numeric(row[k]);
  result.id = result.mgmBldrgstPk ?? `record-${index}`;
  result.parkingTotal = sumKnown(row, ['indrMechUtcnt','oudrMechUtcnt','indrAutoUtcnt','oudrAutoUtcnt']);
  result.elevatorTotal = sumKnown(row, ['rideUseElvtCnt','emgenUseElvtCnt']);
  return result;
}

function upstreamError(code, message = '') {
  const text = `${code} ${message}`;
  if (['20','21','30','31','32'].includes(String(code)) || /SERVICE_KEY|AUTH|ACCESS_DENIED|NOT_REGISTERED|UNREGISTERED|DEADLINE/i.test(text)) {
    return new AppError('AUTH_ERROR', '공공데이터포털 인증에 실패했습니다. 인증키와 건축HUB 서비스 활용신청 승인 상태를 확인해 주세요.', 502);
  }
  if (['22','23'].includes(String(code)) || /LIMIT|QUOTA/i.test(text)) return new AppError('QUOTA_ERROR', '건축HUB API 호출 한도를 초과했습니다. 잠시 후 다시 조회해 주세요.', 429);
  return new AppError('UPSTREAM_ERROR', `건축HUB에서 조회를 처리하지 못했습니다. 응답 코드: ${/^\w{1,40}$/.test(String(code)) ? code : '확인 불가'}`, 502);
}

export function parseResponse(raw) {
  if (!raw.trim().startsWith('{')) {
    const code = raw.match(/<(?:returnReasonCode|resultCode)>([^<]+)</)?.[1];
    const message = raw.match(/<(?:returnAuthMsg|errMsg|resultMsg)>([^<]+)</)?.[1];
    throw code || message ? upstreamError(code ?? 'UNKNOWN', message) : new AppError('RESPONSE_ERROR', '건축HUB가 예상하지 못한 형식으로 응답했습니다. 잠시 후 다시 시도해 주세요.');
  }
  // Public APIs may send a 22-digit primary key as a JSON number. Preserve it before parsing.
  const safe = raw.replace(/("(?:mgmBldrgstPk|mgmUpBldrgstPk|bldgId)"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"');
  let data;
  try { data = JSON.parse(safe); } catch { throw new AppError('RESPONSE_ERROR', '건축HUB 응답을 읽지 못했습니다.'); }
  const response = data.response;
  if (!response?.header) throw new AppError('RESPONSE_ERROR', '건축HUB 응답에 처리 결과가 없습니다.');
  const code = String(response.header.resultCode);
  if (!['00','0','000'].includes(code)) {
    if (['03','3'].includes(code)) return { items: [], total: 0 };
    throw upstreamError(code, response.header.resultMsg);
  }
  const body = response.body ?? {};
  const item = body.items?.item ?? (Array.isArray(body.items) ? body.items : []);
  const items = Array.isArray(item) ? item : item && typeof item === 'object' ? [item] : [];
  const total = Number(body.totalCount ?? items.length);
  if (!Number.isSafeInteger(total) || total < 0) throw new AppError('RESPONSE_ERROR', '건축HUB 목록 수가 올바르지 않습니다.');
  return { items, total };
}

export async function fetchRecords(operation, query, key, fetchFn = fetch) {
  const items = [];
  const decodedKey = (() => { try { return decodeURIComponent(key); } catch { return key; } })();
  const deadline = Date.now() + 90000;
  for (let page = 1; ; page++) {
    if (page > 200 || Date.now() > deadline) throw new AppError('TOO_MANY_RESULTS', '조회 대상이 너무 많거나 조회 시간이 길어졌습니다. 지번을 확인하고 다시 시도해 주세요.', 422);
    const url = new URL(`https://apis.data.go.kr/1613000/BldRgstHubService/${operation}`);
    url.search = new URLSearchParams({ ...query, serviceKey: decodedKey, _type: 'json', numOfRows: '100', pageNo: String(page) }).toString();
    let response, raw;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(18000), redirect: 'error' });
      raw = await response.text();
    } catch (err) {
      throw new AppError(err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', err.name === 'TimeoutError' ? '건축HUB 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : '건축HUB 서버에 연결하지 못했습니다. 인터넷 연결과 API 서비스 상태를 확인해 주세요.');
    }
    if (response.status === 401 || response.status === 403) throw upstreamError('30');
    if (response.status === 429) throw upstreamError('22');
    if (!response.ok) throw new AppError('UPSTREAM_ERROR', `건축HUB 통신 오류가 발생했습니다. HTTP ${response.status}`);
    const result = parseResponse(raw);
    items.push(...result.items);
    if (items.length >= result.total) break;
    if (!result.items.length) throw new AppError('RESPONSE_ERROR', '건축HUB 목록 일부를 받지 못했습니다. 다시 조회해 주세요.');
  }
  return items;
}

export async function lookupBuildings(query, key, fetchFn = fetch) {
  if (!key) throw new AppError('KEY_MISSING', '서버 인증키가 설정되지 않았습니다. .env의 BUILDING_API_KEY를 확인해 주세요.', 503);
  const [basis, titles] = await Promise.all([
    fetchRecords('getBrBasisOulnInfo', query, key, fetchFn),
    fetchRecords('getBrTitleInfo', query, key, fetchFn),
  ]);
  const basics = new Map(basis.filter(r => value(r.mgmBldrgstPk)).map(r => [String(r.mgmBldrgstPk), r]));
  const warnings = [];
  let rows = titles.map(row => {
    const basic = basics.get(String(row.mgmBldrgstPk));
    // Enrich only an exact same-register key; never inherit another building's values.
    return { ...basic, ...Object.fromEntries(Object.entries(row).filter(([,v]) => value(v) !== null)) };
  });
  if (!rows.length && basis.length) {
    rows = basis.filter(r => ['2','3'].includes(String(r.regstrKindCd)));
    warnings.push('표제부 정보가 없어 기본개요만 표시합니다. 면적·주차 등 상세 항목은 확인이 필요합니다.');
    if (!rows.length) warnings.push('이 지번에는 기본개요가 있지만 표시할 건물 표제부를 찾지 못했습니다.');
  }
  return { buildings: rows.map(normalizeBuilding), warnings, basisCount: basis.length, titleCount: titles.length, fetchedAt: new Date().toISOString() };
}

const roadAreaCache = new Map();
const collator = new Intl.Collator('ko', { numeric:true });
export function sortBuildings(buildings) {
  const home = x => (x.hhldCnt ?? 0) > 0 || (x.fmlyCnt ?? 0) > 0;
  return [...buildings].sort((a,b) => Number(home(b))-Number(home(a)) || collator.compare(a.dongNm ?? a.bldNm ?? '',b.dongNm ?? b.bldNm ?? '') || collator.compare(a.id,b.id));
}
export function matchRoad(row, query) {
  return value(row.naRoadCd) === query.roadCd && value(row.naMainBun) !== null && value(row.naSubBun) !== null && Number(row.naMainBun) === Number(query.roadMain) && Number(row.naSubBun) === Number(query.roadSub);
}
async function getAreaTitles(query, key, fetchFn = fetch) {
  if (!key) throw new AppError('KEY_MISSING','서버 인증키가 설정되지 않았습니다. BUILDING_API_KEY를 확인해 주세요.',503);
  const scope = `${query.sigunguCd}:${query.bjdongCd}`;
  let area = fetchFn === fetch ? roadAreaCache.get(scope) : null;
  if (!area || Date.now()-area.at > 300000) {
    const rows = await fetchRecords('getBrTitleInfo',{sigunguCd:query.sigunguCd,bjdongCd:query.bjdongCd},key,fetchFn);
    area = {rows,at:Date.now()};
    if (fetchFn === fetch) {
      if (roadAreaCache.size >= 10) roadAreaCache.delete(roadAreaCache.keys().next().value);
      roadAreaCache.set(scope,area);
    }
  }
  return area;
}
export async function lookupRoadBuildings(query, key, fetchFn = fetch) {
  const area = await getAreaTitles(query,key,fetchFn);
  const matched = area.rows.filter(r=>matchRoad(r,query));
  const unique = new Map();
  matched.forEach((r,i)=>unique.set(value(r.mgmBldrgstPk) ?? `row-${i}`,normalizeBuilding(r,i)));
  const buildings = sortBuildings([...unique.values()]);
  const lots = [...new Set(buildings.map(b=>b.platPlc).filter(Boolean))].sort(collator.compare);
  const warnings = ['선택한 법정동·리 안에서 도로명주소가 같은 건물을 함께 조회했습니다. 다른 법정동·리에 걸친 건물은 별도 조회가 필요합니다.'];
  if (lots.length > 1) warnings.unshift(`동일한 도로명주소의 지번 ${lots.length}개를 함께 조회했습니다: ${lots.join(' / ')}`);
  const missing = area.rows.filter(r=>value(r.naRoadCd)===null || value(r.naMainBun)===null || value(r.naSubBun)===null).length;
  if (missing && !matched.length) warnings.push('이 지역에는 도로명주소가 기재되지 않은 대장이 있습니다. 지번으로도 조회해 주세요.');
  return {buildings,lots,warnings,titleCount:buildings.length,basisCount:null,queryType:'road',fetchedAt:new Date(area.at).toISOString()};
}

export function isCollectiveHousing(row) {
  if (!(String(row.mainPurpsCd ?? '').startsWith('02') || String(row.mainPurpsCdNm ?? '').includes('공동주택'))) return false;
  if (String(row.mainAtchGbCd) === '1' || String(row.mainAtchGbCdNm ?? '').includes('부속')) return false;
  if (!(Number(row.hhldCnt)>0 || Number(row.fmlyCnt)>0) && /경비실|주차장|관리동|부대복리|저장소/.test(`${row.dongNm??''} ${row.etcPurps??''}`)) return false;
  return true;
}
function housingTypes(row) {
  const text = `${row.mainPurpsCdNm??''} ${row.etcPurps??''}`;
  const types = [];
  if (/아파트/.test(text)) types.push('아파트');
  if (/연립/.test(text)) types.push('연립주택');
  if (/다세대/.test(text)) types.push('다세대주택');
  if (/타운하우스/.test(text)) types.push('타운하우스');
  return types.length ? types : ['공동주택'];
}
export async function lookupAreaHousing(query,key,fetchFn=fetch) {
  const area = await getAreaTitles(query,key,fetchFn);
  const rows = area.rows.filter(isCollectiveHousing);
  const unique = new Map();
  rows.forEach((r,i)=>unique.set(value(r.mgmBldrgstPk)??`housing-${i}`,r));
  const groups = new Map();
  let index = 0;
  for (const [id,r] of unique) {
    // Same name alone is never enough to merge different addresses.
    const hasRoad = /^\d{12,17}$/.test(String(r.naRoadCd??'')) && Number(r.naMainBun)>0 && value(r.naSubBun)!==null && Number.isFinite(Number(r.naSubBun)) && Number(r.naSubBun)>=0;
    const key = hasRoad ? JSON.stringify([r.naRoadCd,Number(r.naMainBun),Number(r.naSubBun)]) : JSON.stringify([value(r.platPlc)??id,value(r.bldNm)]);
    if (!groups.has(key)) groups.set(key,{id:`housing-group-${index++}`,name:value(r.bldNm)??'건물명 확인 필요',address:value(r.newPlatPlc)??value(r.platPlc)??'주소 확인 필요',buildingIds:[],types:[],lots:[],names:[]});
    const group = groups.get(key);
    group.buildingIds.push(id);
    for (const t of housingTypes(r)) if (!group.types.includes(t)) group.types.push(t);
    if (value(r.platPlc) && !group.lots.includes(value(r.platPlc))) group.lots.push(value(r.platPlc));
    if (value(r.bldNm) && !group.names.includes(value(r.bldNm))) group.names.push(value(r.bldNm));
    if (group.name === '건물명 확인 필요' && value(r.bldNm)) group.name = value(r.bldNm);
  }
  const buildings = sortBuildings([...unique].map(([id,r],i)=>({...normalizeBuilding(r,i),id})));
  const complexes = [...groups.values()].sort((a,b)=>collator.compare(a.name,b.name)||collator.compare(a.address,b.address));
  return {queryType:'area',complexes,buildings,fetchedAt:new Date(area.at).toISOString(),warnings:['건축물대장에 공동주택으로 등록된 건물을 표시합니다. 단독주택형 타운하우스와 부속시설은 이 목록에 포함하지 않습니다.']};
}
