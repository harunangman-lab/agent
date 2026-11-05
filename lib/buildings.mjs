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
  const fields = ['mgmBldrgstPk','mgmUpBldrgstPk','bldNm','dongNm','platPlc','newPlatPlc','mainPurpsCdNm','etcPurps','useAprDay','crtnDay','regstrGbCdNm','regstrKindCdNm','mainAtchGbCdNm','strctCdNm'];
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
