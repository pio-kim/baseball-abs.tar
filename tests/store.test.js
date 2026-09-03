import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveInning, loadInning, listInnings, loadConfig, saveConfig } from '../store.js';
import { DEFAULT_CONFIG } from '../state.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'abs-store-'));
}

const DATE = '2026-09-02';
const PITCHES = [
  { id: 'p1', seq: 1, x: 0.31, z: -0.82, verdict: 'strike' },
  { id: 'p2', seq: 2, x: 1.24, z: 0.1, verdict: 'ball' },
];

test('저장한 이닝을 그대로 읽는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(loadInning(dir, DATE, 1), [
    { seq: 1, x: 0.31, z: -0.82, verdict: 'strike' },
    { seq: 2, x: 1.24, z: 0.1, verdict: 'ball' },
  ]);
});

test('id는 저장하지 않는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  const raw = fs.readFileSync(path.join(dir, `${DATE}.json`), 'utf8');
  assert.equal(raw.includes('"id"'), false);
});

test('같은 이닝을 두 번 저장하면 항목이 교체된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 3, PITCHES);
  saveInning(dir, DATE, 3, [{ seq: 1, x: 0, z: 0, verdict: 'strike' }]);
  assert.deepEqual(listInnings(dir, DATE), [3]);
  assert.equal(loadInning(dir, DATE, 3).length, 1);
});

test('다른 이닝은 이어서 쌓이고 오름차순으로 정렬된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 3, PITCHES);
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(listInnings(dir, DATE), [1, 3]);
});

test('없는 이닝은 null이다', () => {
  const dir = tmp();
  assert.equal(loadInning(dir, DATE, 1), null);
  saveInning(dir, DATE, 1, PITCHES);
  assert.equal(loadInning(dir, DATE, 9), null);
});

test('기록이 없는 날짜는 빈 목록이다', () => {
  assert.deepEqual(listInnings(tmp(), DATE), []);
});

test('endedAt이 ISO 문자열로 기록된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  const game = JSON.parse(fs.readFileSync(path.join(dir, `${DATE}.json`), 'utf8'));
  assert.match(game.innings[0].endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(game.date, DATE);
});

test('손상된 기록 파일은 예외 대신 빈 결과를 준다', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, `${DATE}.json`), '{ 이건 JSON이 아니다');
  assert.deepEqual(listInnings(dir, DATE), []);
  assert.equal(loadInning(dir, DATE, 1), null);
});

test('설정 파일이 없으면 기본값을 준다', () => {
  assert.deepEqual(loadConfig(path.join(tmp(), 'config.json')), DEFAULT_CONFIG);
});

test('설정을 저장하고 읽는다', () => {
  const file = path.join(tmp(), 'config.json');
  const cfg = { zone: { aspect: 1.4 }, placement: { x: 0.6, y: 0.4, scale: 0.3 } };
  saveConfig(file, cfg);
  assert.deepEqual(loadConfig(file), cfg);
});

test('손상된 설정 파일은 기본값으로 대체된다', () => {
  const file = path.join(tmp(), 'config.json');
  fs.writeFileSync(file, '{{{');
  assert.deepEqual(loadConfig(file), DEFAULT_CONFIG);
});

test('필드가 빠진 설정 파일도 기본값으로 대체된다', () => {
  const file = path.join(tmp(), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ zone: { aspect: 1.2 } }));
  assert.deepEqual(loadConfig(file), DEFAULT_CONFIG);
});

test('저장 후 임시 파일이 남지 않는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(fs.readdirSync(dir), [`${DATE}.json`]);
});
