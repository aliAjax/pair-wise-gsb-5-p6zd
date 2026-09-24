// 发布前复核 · 本地持久化模块
// 只负责 localStorage 的读写、版本迁移与结构清洗；不含任何审批规则判断。
// 沿用旧版缓存键，老用户打开后 v1 记录会被迁移为 v2，依赖原有信息完整保留。

import type {Dep, ReviewMap, ReviewRecord, ReviewState} from './rules';
import {fingerprintOf} from './rules';

const STORAGE_KEY = 'license-lens';
export const STORAGE_VERSION = 2;

type StoredV1 = Dep[];

export type StoredV2 = {
  version: 2;
  deps: Dep[];
  reviews: ReviewMap;
};

export type LoadResult = {
  version: 1 | 2 | null;
  deps: Dep[];
  reviews: ReviewMap;
};

// ---------- 结构清洗（脏数据/旧版本字段缺失时兜底） ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const VALID_STATES: ReviewState[] = ['pending', 'approved', 'rejected'];

const sanitizeDep = (raw: unknown, fallbackIndex: number): Dep | null => {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === 'number' ? raw.id : Date.now() + fallbackIndex;
  const name = String(raw.name ?? '');
  if (!name) return null;
  const risk = raw.status === 'ok' || raw.status === 'warn' || raw.status === 'risk' ? raw.status : 'warn';
  return {
    id,
    name,
    version: String(raw.version ?? '0.0.0'),
    license: String(raw.license ?? '未知'),
    source: String(raw.source ?? '未知'),
    status: risk,
    note: String(raw.note ?? ''),
  };
};

const sanitizeRecord = (raw: unknown, dep: Dep): ReviewRecord => {
  const fallback: ReviewRecord = {
    depId: dep.id,
    fingerprint: fingerprintOf(dep),
    state: 'pending',
    history: [],
  };
  if (!isObject(raw)) return fallback;
  const state = VALID_STATES.includes(raw.state as ReviewState) ? (raw.state as ReviewState) : 'pending';
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(isObject)
        .map((h) => ({
          at: typeof h.at === 'number' ? h.at : 0,
          action: ['approve', 'reject', 'revoke', 'auto-reset'].includes(h.action as string)
            ? (h.action as ReviewRecord['history'][number]['action'])
            : 'revoke',
          detail: String(h.detail ?? ''),
        }))
    : [];
  return {
    depId: dep.id,
    // 迁移来的脏指纹保持原样，交由规则层 syncReviews 判定退回
    fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : fingerprintOf(dep),
    state,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : undefined,
    decidedAt: typeof raw.decidedAt === 'number' ? raw.decidedAt : undefined,
    history,
  };
};

// ---------- 读取（含 v1 旧缓存迁移） ----------

export function load(seed: Dep[]): LoadResult {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return {version: null, deps: seed, reviews: {}};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 缓存损坏：不覆盖、不丢用户数据，退回内置示例
    return {version: null, deps: seed, reviews: {}};
  }

  // v1：裸依赖数组 —— 原有依赖信息完整迁移，审批历史不存在则全部待审
  if (Array.isArray(parsed)) {
    const deps = (parsed as StoredV1)
      .map((d, i) => sanitizeDep(d, i))
      .filter((d): d is Dep => d !== null);
    return {version: 1, deps: deps.length ? deps : seed, reviews: {}};
  }

  // v2：版本化结构
  if (isObject(parsed) && parsed.version === 2 && Array.isArray(parsed.deps)) {
    const deps = (parsed.deps as unknown[])
      .map((d, i) => sanitizeDep(d, i))
      .filter((d): d is Dep => d !== null);
    const rawReviews = isObject(parsed.reviews) ? parsed.reviews : {};
    const reviews: ReviewMap = {};
    for (const dep of deps) {
      const r = rawReviews[String(dep.id)];
      if (r) reviews[dep.id] = sanitizeRecord(r, dep);
    }
    return {version: 2, deps: deps.length ? deps : seed, reviews};
  }

  return {version: null, deps: seed, reviews: {}};
}

// ---------- 写入 ----------

export function save(deps: Dep[], reviews: ReviewMap): boolean {
  const payload: StoredV2 = {version: STORAGE_VERSION, deps, reviews};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
