// Only use the selected service response, never an automatically guessed first match.
// Reviewed register-lookup exceptions: exact legal code + road + related source lot.
// Verified against live getBrTitleInfo on 2026-11-05: 2424 returned 50 buildings
// at 에듀시티로 148 (삼정 G.edu); 2484 returned none. Do not apply to nearby addresses.
const verifiedCorrections = [{
  code:'5013025029', roadTail:'에듀시티로 148', fromBun:'2484', fromJi:'0',
  toBun:'2424', toJi:'0', verifiedOn:'2026-11-05',
}];

export function normalizeRoadAddress(data, validCodes) {
  const roadAddress = String(data.roadAddress ?? '').trim();
  let jibunAddress = String(data.jibunAddress ?? '').trim();
  const code = String(data.bcode ?? '').trim();
  if (!roadAddress) throw new Error('도로명주소가 있는 검색 결과를 선택해 주세요.');
  if (data.noSelected === 'Y' || !jibunAddress) throw new Error('연결된 지번을 확정할 수 없습니다. 주소검색에서 해당 지번까지 선택하거나 법정동·지번 방식으로 조회해 주세요.');
  if (!/^\d{10}$/.test(code) || !validCodes.has(code)) throw new Error('선택한 주소의 법정동 코드가 현재 공식 목록에 없습니다. 지역코드 자료 갱신이 필요합니다.');
  let lot = jibunAddress.match(/\s(산\s*)?([0-9]{1,4})(?:-([0-9]{1,4}))?$/);
  if (!lot || Number(lot[2]) < 1) throw new Error('지번의 본번·부번을 확인할 수 없습니다. 법정동·지번 방식으로 직접 선택해 주세요.');
  const rule = verifiedCorrections.find(r => r.code === code &&
    roadAddress.replace(/\s+/g,' ').endsWith(' '+r.roadTail) && !lot[1] &&
    Number(lot[2]) === Number(r.fromBun) && Number(lot[3] ?? 0) === Number(r.fromJi));
  let correction = null;
  if (rule) {
    const original = jibunAddress;
    jibunAddress = jibunAddress.replace(/\s[0-9]{1,4}(?:-[0-9]{1,4})?$/, ` ${rule.toBun}${Number(rule.toJi) ? '-'+rule.toJi : ''}`);
    lot = jibunAddress.match(/\s(산\s*)?([0-9]{1,4})(?:-([0-9]{1,4}))?$/);
    correction = { originalJibunAddress:original, verifiedOn:rule.verifiedOn,
      message:`주소검색의 연관 지번 ${rule.fromBun} 대신, 건축HUB 대장에서 확인한 대표 지번 ${rule.toBun}으로 조회합니다. 확인일: ${rule.verifiedOn}` };
  }
  return {
    roadAddress, jibunAddress, buildingName: String(data.buildingName ?? '').trim(), correction,
    query: { sigunguCd:code.slice(0,5), bjdongCd:code.slice(5), platGbCd:lot[1] ? '1' : '0', bun:lot[2].padStart(4,'0'), ji:(lot[3] ?? '0').padStart(4,'0') },
  };
}
