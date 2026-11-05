import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('../data/regions.json', import.meta.url), 'utf8'));
test('all selectable legal codes are reachable through official province and district records, including Sejong', () => {
  const provinces = data.rows.filter(r => !r.name.includes(' '));
  const prefix = new Set(provinces.map(r => r.code.slice(0,2)));
  const districts = new Set(data.rows.filter(r => r.code.endsWith('00000')).map(r => r.code.slice(0,5)));
  const leaves = data.rows.filter(r => !r.code.endsWith('00000'));
  assert.ok(provinces.some(r => r.name === '세종특별자치시'));
  assert.ok(leaves.length > 20000);
  for (const r of leaves) {
    assert.ok(prefix.has(r.code.slice(0,2)), `province missing: ${r.name}`);
    assert.ok(districts.has(r.code.slice(0,5)), `district missing: ${r.name}`);
    assert.match(r.code, /^\d{10}$/);
  }
});
