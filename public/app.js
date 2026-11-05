import { normalizeRoadAddress } from './address.mjs';
const $ = id => document.getElementById(id);
const province = $('province'), district = $('district'), dong = $('dong');
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const state = { rows: [], byCode: new Map(), results: [], busy: false, ready: false, mode:'jibun', road:null };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const known = v => v !== null && v !== undefined && String(v).trim() !== '';
const display = (v, unit = '') => known(v) ? `${typeof v === 'number' ? number.format(v) : esc(v)}${unit}` : '확인 필요';
function date(v) {
  if (!/^\d{8}$/.test(v ?? '')) return null;
  const iso = `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10) === iso ? iso.replaceAll('-', '.') : null;
}
function setOptions(select, rows, placeholder, getLabel = r => r.name) {
  select.replaceChildren(new Option(placeholder, ''), ...rows.map(r => new Option(getLabel(r), r.code)));
  select.disabled = !rows.length;
}
function districtsFor(code) {
  const prefixes = new Set(state.rows.filter(r => r.code.startsWith(code.slice(0,2)) && r.code.slice(5) !== '00000').map(r => r.code.slice(0,5)));
  return state.rows.filter(r => r.code.endsWith('00000') && prefixes.has(r.code.slice(0,5)));
}
function updateDistricts() {
  const p = state.byCode.get(province.value);
  setOptions(district, p ? districtsFor(p.code) : [], '시·군·구 선택', r => r.name.startsWith(p.name + ' ') ? r.name.slice(p.name.length+1) : r.name);
  setOptions(dong, [], '시·군·구 먼저 선택');
  preview();
}
function updateDongs() {
  const d = state.byCode.get(district.value);
  setOptions(dong, d ? state.rows.filter(r => r.code.startsWith(d.code.slice(0,5)) && r.code.slice(5) !== '00000') : [], '법정동 · 리 선택', r => r.name.startsWith(d.name + ' ') ? r.name.slice(d.name.length+1) : r.name);
  preview();
}
function addressText() {
  if (state.mode === 'road') return state.road ? `${state.road.roadAddress} (지번: ${state.road.jibunAddress})` : '';
  const row = state.byCode.get(dong.value);
  const bun = $('bun').value.trim(), ji = $('ji').value.trim();
  return row ? `${row.name}${$('land-type').value === '1' ? ' 산' : ' '}${bun ? String(Number(bun)) : ''}${ji && Number(ji) ? '-'+Number(ji) : ''}${bun ? $('land-type').value === '2' ? ' 블록' : '번지' : ''}` : '';
}
function preview() { $('address-preview').textContent = addressText() || (state.mode === 'road' ? '주소 검색에서 도로명주소를 선택해 주세요.' : '조회할 지역과 지번을 선택해 주세요.'); }
function message(title, body, type = '') {
  const box = $('message');
  box.className = `message ${type}`;
  box.innerHTML = `<strong>${type === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : ''}${esc(title)}</strong><span>${esc(body)}</span>`;
  box.hidden = false;
  box.setAttribute('role', type === 'error' ? 'alert' : 'status');
}
function setBusy(busy) {
  state.busy = busy;
  $('search-form').setAttribute('aria-busy', String(busy));
  for (const el of $('search-form').elements) el.disabled = busy;
  if (!busy) {
    province.disabled = !state.ready;
    district.disabled = !province.value;
    dong.disabled = !district.value;
    $('search-button').disabled = !state.ready;
    $('example-button').disabled = !state.ready;
  }
  $('jibun-fields').disabled = busy || state.mode !== 'jibun';
  $('road-fields').disabled = busy || state.mode !== 'road';
  $('search-button').classList.toggle('loading', busy);
  $('search-button').querySelector('span').textContent = busy ? '조회 중…' : '건물 조회';
}
function setMode(mode) {
  state.mode = mode;
  for (const input of document.querySelectorAll('[name="address-mode"]')) input.checked = input.value === mode;
  $('jibun-fields').hidden = mode !== 'jibun';
  $('road-fields').hidden = mode !== 'road';
  $('example-button').hidden = mode !== 'jibun';
  $('results').hidden = true; $('message').hidden = true; $('empty-state').hidden = false;
  setBusy(false); preview();
}
for (const radio of document.querySelectorAll('[name="address-mode"]')) radio.addEventListener('change', e => setMode(e.target.value));

let postcodeLoad;
function loadPostcode() {
  if (window.kakao?.Postcode) return Promise.resolve(window.kakao.Postcode);
  if (postcodeLoad) return postcodeLoad;
  postcodeLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => failed(), 15000);
    function failed() { clearTimeout(timeout); script.remove(); postcodeLoad = null; reject(new Error('주소검색 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하거나 법정동·지번으로 조회해 주세요.')); }
    script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.onload = () => { clearTimeout(timeout); window.kakao?.Postcode ? resolve(window.kakao.Postcode) : failed(); };
    script.onerror = failed;
    document.head.append(script);
  });
  return postcodeLoad;
}
const addressDialog = $('address-dialog');
$('close-address-dialog').addEventListener('click', () => addressDialog.close());
addressDialog.addEventListener('close', () => $('road-search-button').focus());
$('road-keyword').addEventListener('input', () => { state.road = null; $('road-selected').hidden = true; $('road-status').textContent = ''; preview(); });
$('road-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('road-search-button').click(); } });
$('road-search-button').addEventListener('click', async () => {
  $('postcode-container').replaceChildren();
  $('postcode-status').textContent = '주소검색을 불러오는 중입니다…';
  addressDialog.showModal();
  try {
    const Postcode = await loadPostcode();
    if (!addressDialog.open) return;
    new Postcode({
      width:'100%', height:'100%', autoMapping:false, shorthand:false, hideMapBtn:true, hideEngBtn:true,
      onresize() { $('postcode-status').textContent = ''; },
      onsearch() { $('postcode-status').textContent = ''; },
      oncomplete(data) {
        try {
          const selected = normalizeRoadAddress(data, state.byCode);
          state.road = selected;
          $('road-keyword').value = selected.roadAddress;
          $('selected-road-address').textContent = selected.roadAddress;
          $('selected-jibun-address').textContent = `연결 지번 · ${selected.jibunAddress}${selected.buildingName ? ' · '+selected.buildingName : ''}`;
          $('road-selected').hidden = false;
          $('road-status').textContent = selected.correction ? selected.correction.message : '주소 선택 완료. 건물 조회를 눌러 주세요.';
          preview(); addressDialog.close(); $('search-button').focus();
        } catch (err) {
          state.road = null; $('road-selected').hidden = true;
          $('road-status').textContent = err.message;
          preview(); addressDialog.close();
        }
      },
    }).embed($('postcode-container'), { q:$('road-keyword').value.trim(), autoClose:false });
  } catch (err) { $('postcode-status').textContent = err.message; }
});
function metric(label, v, note = '', missing = !known(v)) {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value${missing ? ' missing' : ''}">${known(v) ? v : '확인 필요'}</div>${note ? `<div class="metric-note">${note}</div>` : ''}</div>`;
}
function renderBuilding(index) {
  const b = state.results[index];
  if (!b) return;
  const name = [b.bldNm, b.dongNm && !b.bldNm?.includes(b.dongNm) ? b.dongNm : null].filter(Boolean).join(' · ') || '건물명 확인 필요';
  const floors = `${known(b.grndFlrCnt) ? `지상 ${display(b.grndFlrCnt)}층` : '지상 확인 필요'} / ${known(b.ugrndFlrCnt) ? `지하 ${display(b.ugrndFlrCnt)}층` : '지하 확인 필요'}`;
  const detail = (k,v) => `<div><dt>${esc(k)}</dt><dd>${display(v)}</dd></div>`;
  $('building-detail').innerHTML = `
    <div class="building-heading"><div class="building-title-row"><h3>${esc(name)}</h3><span class="kind-badge">${esc(b.regstrGbCdNm ?? '대장구분 확인 필요')} · ${esc(b.regstrKindCdNm ?? '대장종류 확인 필요')}</span></div><p>${esc(b.newPlatPlc ?? b.platPlc ?? '주소 확인 필요')}</p>${b.newPlatPlc && b.platPlc ? `<p>지번 · ${esc(b.platPlc)}</p>` : ''}</div>
    <div class="metrics">
      ${metric('주용도', known(b.mainPurpsCdNm) ? esc(b.mainPurpsCdNm) : null, b.etcPurps ? esc(b.etcPurps) : '')}
      ${metric('사용승인일', date(b.useAprDay), '대장에 기재된 사용승인일')}
      ${metric('층수', floors, '선택한 건물 · 동 기준', !known(b.grndFlrCnt) && !known(b.ugrndFlrCnt))}
      ${metric('연면적', known(b.totArea) ? display(b.totArea, ' ㎡') : null, '건물 전체 면적 · 호실 전유면적 아님')}
      ${metric('세대수', known(b.hhldCnt) ? display(b.hhldCnt, ' 세대') : null, known(b.fmlyCnt) ? `가구수 ${display(b.fmlyCnt, ' 가구')}` : '가구수 확인 필요')}
      ${metric('주차대수', known(b.parkingTotal) ? display(b.parkingTotal, ' 대') : null, '옥내·옥외 / 자주식·기계식 합계')}
      ${metric('승용 승강기', known(b.rideUseElvtCnt) ? display(b.rideUseElvtCnt, ' 대') : null, known(b.emgenUseElvtCnt) ? `비상용 ${display(b.emgenUseElvtCnt, ' 대')}` : '비상용 확인 필요')}
      ${metric('대지면적', known(b.platArea) ? display(b.platArea, ' ㎡') : null, `건축면적 ${display(b.archArea, ' ㎡')}`)}
    </div>
    <dl class="details">
      ${detail('건축물 구조', b.strctCdNm)}${detail('주·부속 구분', b.mainAtchGbCdNm)}
      ${detail('옥내 주차 (자주식 / 기계식)', `${display(b.indrAutoUtcnt,' 대')} / ${display(b.indrMechUtcnt,' 대')}`)}
      ${detail('옥외 주차 (자주식 / 기계식)', `${display(b.oudrAutoUtcnt,' 대')} / ${display(b.oudrMechUtcnt,' 대')}`)}
      ${detail('관리건축물대장 PK', b.mgmBldrgstPk)}${detail('데이터 생성일', date(b.crtnDay))}
    </dl>`;
}
province.addEventListener('change', updateDistricts);
district.addEventListener('change', updateDongs);
for (const id of ['dong','land-type','bun','ji']) $(id).addEventListener('input', preview);
$('building-select').addEventListener('change', e => renderBuilding(Number(e.target.value)));
$('example-button').addEventListener('click', () => {
  // These exact codes and address appear in the supplied official API guide.
  if (!state.byCode.has('1168010300')) return;
  province.value = '1100000000'; updateDistricts();
  district.value = '1168000000'; updateDongs();
  dong.value = '1168010300'; $('land-type').value = '0'; $('bun').value = '12'; $('ji').value = '0'; preview();
  $('bun').focus();
});
$('search-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy || !state.ready) return;
  let query;
  if (state.mode === 'road') {
    if (!state.road) return message('도로명주소를 선택해 주세요', '주소 검색을 눌러 검색 결과에서 도로명주소를 선택한 뒤 조회해 주세요.', 'error');
    query = new URLSearchParams(state.road.query);
  } else {
  if (!/^[0-9]{1,4}$/.test($('bun').value) || Number($('bun').value) === 0) return message('본번을 확인해 주세요', '본번은 1~9999 사이 숫자로 입력해 주세요.', 'error');
  const code = dong.value;
  if (!state.byCode.has(code)) return message('지역을 선택해 주세요', '공식 목록에서 시군구와 법정동·리를 선택해 주세요.', 'error');
  query = new URLSearchParams({ sigunguCd: code.slice(0,5), bjdongCd: code.slice(5), platGbCd:$('land-type').value, bun:$('bun').value, ji:$('ji').value || '0' });
  }
  const address = addressText();
  $('results').hidden = true; $('empty-state').hidden = true;
  message('건축물대장을 확인하고 있어요', '기본개요와 표제부를 조회합니다. 대규모 단지는 목록을 모두 불러오는 데 시간이 걸릴 수 있어요.', 'loading');
  setBusy(true);
  try {
    const res = await fetch(`/api/buildings?${query}`, { signal: AbortSignal.timeout(110000) });
    const data = await res.json();
    if (!res.ok) {
      const titles = { AUTH_ERROR:'인증 상태를 확인해 주세요', KEY_MISSING:'서버 인증키 설정이 필요합니다', NETWORK_ERROR:'건축HUB에 연결하지 못했어요', TIMEOUT:'조회 응답이 지연되고 있어요', QUOTA_ERROR:'API 호출 한도에 도달했어요', INVALID_ADDRESS:'주소를 확인해 주세요' };
      message(titles[data.error?.code] ?? '조회하지 못했어요', data.error?.message ?? '잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
    state.results = data.buildings;
    if (!data.buildings.length) {
      message('조회된 건물이 없습니다', `${address}의 표제부를 찾지 못했습니다. 법정동·리, 본번·부번, 산 여부를 확인해 주세요.${data.warnings.length ? ' '+data.warnings.join(' ') : ''}`, 'empty');
      return;
    }
    $('message').hidden = true;
    $('result-count').textContent = `${data.buildings.length}건`;
    $('result-address').textContent = address;
    $('building-select').replaceChildren(...data.buildings.map((b,i) => new Option(`${b.bldNm ?? '건물명 확인 필요'}${b.dongNm && !b.bldNm?.includes(b.dongNm) ? ' · '+b.dongNm : ''}${b.mainAtchGbCdNm ? ' ('+b.mainAtchGbCdNm+')' : ''} · ${i+1}`, String(i))));
    $('fetch-time').textContent = `조회 ${new Date(data.fetchedAt).toLocaleString('ko-KR', { timeZone:'Asia/Seoul', hour12:false })}`;
    const warnings = [...data.warnings];
    if (state.mode === 'road' && state.road?.correction) warnings.unshift(state.road.correction.message);
    $('warning-box').hidden = !warnings.length;
    $('warning-box').replaceChildren(...warnings.map(w => { const p = document.createElement('p'); p.textContent = w; return p; }));
    renderBuilding(0); $('results').hidden = false;
  } catch (err) {
    message(err.name === 'TimeoutError' ? '조회 시간이 길어지고 있어요' : '서버에 연결하지 못했어요', '앱 서버가 실행 중인지 확인한 뒤 다시 조회해 주세요.', 'error');
  } finally { setBusy(false); }
});

async function init() {
  try {
    const res = await fetch('/api/regions');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.rows = data.rows; state.byCode = new Map(data.rows.map(r => [r.code,r]));
    // Sejong's official top-level entry is 3611000000, not a fabricated 3600000000.
    setOptions(province, state.rows.filter(r => !r.name.includes(' ')), '시·도 선택');
    state.ready = true;
    $('search-button').disabled = false; $('example-button').disabled = false;
    $('code-status').textContent = `행정표준코드 공식 목록 · 현존 ${number.format(data.rows.length)}개 · 자료 기준 ${data.archiveModifiedOn} · 수집 ${data.retrievedOn}`;
    // Start with Jeju selected only when its exact official code is present.
    if (state.byCode.has('5000000000')) { province.value = '5000000000'; updateDistricts(); }
    const health = await fetch('/api/health').then(r => r.json());
    if (!health.configured) message('서버 인증키 설정이 필요합니다', '.env의 BUILDING_API_KEY를 설정한 뒤 서버를 다시 실행해 주세요.', 'error');
  } catch {
    $('code-status').textContent = '지역코드 목록을 불러오지 못했습니다. 서버 상태를 확인하고 새로고침해 주세요.';
    if (!state.ready) message('지역 목록을 불러오지 못했어요', '코드를 임의로 입력하지 않고 공식 코드 목록이 준비된 뒤 조회할 수 있습니다.', 'error');
  }
}
init();
