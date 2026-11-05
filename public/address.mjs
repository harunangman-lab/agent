// Preserve the selected lot as reference; resolve road searches using exact road ID.
export function normalizeRoadAddress(data, validCodes) {
  const roadAddress = String(data.roadAddress ?? '').trim();
  const jibunAddress = String(data.jibunAddress ?? '').trim();
  const code = String(data.bcode ?? '').trim();
  if (!roadAddress) throw new Error('도로명주소가 있는 검색 결과를 선택해 주세요.');
  if (data.noSelected === 'Y' || !jibunAddress) throw new Error('연결된 지번을 확정할 수 없습니다. 주소검색에서 해당 지번까지 선택하거나 법정동·지번 방식으로 조회해 주세요.');
  if (!/^\d{10}$/.test(code) || !validCodes.has(code)) throw new Error('선택한 주소의 법정동 코드가 현재 공식 목록에 없습니다. 지역코드 자료 갱신이 필요합니다.');
  const lot = jibunAddress.match(/\s(산\s*)?([0-9]{1,4})(?:-([0-9]{1,4}))?$/);
  if (!lot || Number(lot[2]) < 1) throw new Error('지번의 본번·부번을 확인할 수 없습니다. 법정동·지번 방식으로 직접 선택해 주세요.');
  const roadCode = String(data.roadnameCode ?? '').trim();
  const roadNumber = roadAddress.match(/\s([0-9]{1,5})(?:-([0-9]{1,5}))?$/);
  const roadQuery = /^\d{7,12}$/.test(roadCode) && roadNumber && Number(roadNumber[1]) > 0 ? {
    mode:'road',sigunguCd:code.slice(0,5),bjdongCd:code.slice(5),roadCd:code.slice(0,5)+roadCode,roadMain:roadNumber[1],roadSub:roadNumber[2]??'0',
  } : null;
  return {
    roadAddress, jibunAddress, buildingName: String(data.buildingName ?? '').trim(), roadQuery,
    query: { sigunguCd:code.slice(0,5), bjdongCd:code.slice(5), platGbCd:lot[1] ? '1' : '0', bun:lot[2].padStart(4,'0'), ji:(lot[3] ?? '0').padStart(4,'0') },
  };
}
