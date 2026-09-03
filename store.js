import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './state.js';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// 임시 파일에 쓴 뒤 rename한다. 저장 도중 프로세스가 죽어도
// 기존 기록이 깨지지 않는다.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function gameFile(dir, date) {
  return path.join(dir, `${date}.json`);
}

export function saveInning(dir, date, inning, pitches) {
  const loaded = readJson(gameFile(dir, date));
  const game = Array.isArray(loaded?.innings) ? loaded : { date, innings: [] };
  const entry = {
    inning,
    endedAt: new Date().toISOString(),
    pitches: pitches.map(({ seq, x, z, verdict }) => ({ seq, x, z, verdict })),
  };
  const i = game.innings.findIndex((e) => e.inning === inning);
  if (i >= 0) game.innings[i] = entry;
  else game.innings.push(entry);
  game.innings.sort((a, b) => a.inning - b.inning);
  writeJsonAtomic(gameFile(dir, date), game);
}

export function loadInning(dir, date, inning) {
  const game = readJson(gameFile(dir, date));
  if (!Array.isArray(game?.innings)) return null;
  const entry = game.innings.find((e) => e.inning === inning);
  return entry ? entry.pitches : null;
}

export function listInnings(dir, date) {
  const game = readJson(gameFile(dir, date));
  if (!Array.isArray(game?.innings)) return [];
  return game.innings.map((e) => e.inning).sort((a, b) => a - b);
}

export function loadConfig(file) {
  const cfg = readJson(file);
  const ok =
    typeof cfg?.zone?.aspect === 'number' &&
    typeof cfg?.placement?.x === 'number' &&
    typeof cfg?.placement?.y === 'number' &&
    typeof cfg?.placement?.scale === 'number';
  return ok ? cfg : DEFAULT_CONFIG;
}

export function saveConfig(file, config) {
  writeJsonAtomic(file, config);
}
