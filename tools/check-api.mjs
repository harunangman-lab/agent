import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupBuildings, AppError } from '../lib/buildings.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
try {
  const result = await lookupBuildings({ sigunguCd:'11680', bjdongCd:'10300', platGbCd:'0', bun:'0012', ji:'0000' }, process.env.BUILDING_API_KEY);
  console.log(JSON.stringify({ status:'ok', address:'가이드 예시: 서울 강남구 개포동 12', basisCount:result.basisCount, titleCount:result.titleCount, buildingCount:result.buildings.length, firstBuilding:result.buildings[0]?.bldNm ?? null, fetchedAt:result.fetchedAt }, null, 2));
} catch (err) {
  console.log(JSON.stringify({ status:'failed', code:err instanceof AppError ? err.code : 'CHECK_FAILED', message:err instanceof AppError ? err.message : '검증 실행 오류' }, null, 2));
  process.exitCode = 1;
}
