import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError, lookupBuildings } from './lib/buildings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const regions = JSON.parse(await readFile(path.join(root, 'data/regions.json'), 'utf8'));
const allowed = new Set(regions.rows.filter(r => r.code.slice(5) !== '00000').map(r => r.code));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/address.mjs', ['address.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
let active = 0;
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://t1.kakaocdn.net; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://postcode.map.kakao.com; upgrade-insecure-requests; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET 요청만 지원합니다.' } });
    if (url.pathname === '/api/regions') return send(res, 200, regions);
    if (url.pathname === '/api/health') return send(res, 200, { configured: Boolean(process.env.BUILDING_API_KEY), codeCount: allowed.size });
    if (url.pathname === '/api/buildings') {
      const q = Object.fromEntries(['sigunguCd','bjdongCd','platGbCd','bun','ji'].map(k => [k, url.searchParams.get(k) ?? '']));
      if (!/^\d{5}$/.test(q.sigunguCd) || !/^\d{5}$/.test(q.bjdongCd) || !allowed.has(q.sigunguCd + q.bjdongCd)) throw new AppError('INVALID_ADDRESS', '공식 코드 목록에서 시군구와 법정동·리를 선택해 주세요.', 400);
      if (!['0','1','2'].includes(q.platGbCd) || !/^\d{1,4}$/.test(q.bun) || Number(q.bun) === 0 || !/^\d{1,4}$/.test(q.ji)) throw new AppError('INVALID_ADDRESS', '본번은 1~9999, 부번은 0~9999 사이 숫자로 입력해 주세요.', 400);
      q.bun = q.bun.padStart(4, '0'); q.ji = q.ji.padStart(4, '0');
      if (active >= 6) throw new AppError('BUSY', '다른 조회를 처리 중입니다. 잠시 후 다시 시도해 주세요.', 429);
      active++;
      try { return send(res, 200, await lookupBuildings(q, process.env.BUILDING_API_KEY)); }
      finally { active--; }
    }
    if (staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      const body = await readFile(path.join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(body);
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: '페이지를 찾을 수 없습니다.' } });
  } catch (err) {
    // Do not log upstream URLs, raw responses, or exception objects containing credentials.
    const safe = err instanceof AppError ? err : new AppError('SERVER_ERROR', '서버에서 오류가 발생했습니다. 다시 시도해 주세요.', 500);
    send(res, safe.status, { error: { code: safe.code, message: safe.message } });
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => console.log(`중개톡 비서: http://localhost:${port}`));
server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `포트 ${port} 사용 중: .env에서 PORT를 변경해 주세요.` : '서버를 시작하지 못했습니다.'); process.exit(1); });
