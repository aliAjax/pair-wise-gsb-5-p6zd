// 本地持久化模块：localStorage 读写与旧缓存迁移。
// 旧版本缓存没有 approval 字段，这里统一补齐为待审，原有字段一律保留。

import {Approval, createPendingApproval, normalizeApproval} from './approval';

export type RiskStatus = 'ok' | 'warn' | 'risk';

export interface Dep {
  id: number;
  name: string;
  version: string;
  license: string;
  source: string;
  status: RiskStatus;
  note: string;
  approval: Approval;
}

const STORAGE_KEY = 'license-lens';

export const initialDeps: Dep[] = [
  {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用', approval: createPendingApproval()},
  {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用', approval: createPendingApproval()},
  {id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用', approval: createPendingApproval()},
  {id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', status: 'warn', note: '再发布需保留版权声明', approval: createPendingApproval()},
  {id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: '手动', status: 'risk', note: '可能与闭源分发冲突', approval: createPendingApproval()},
];

/** 单条记录迁移：先铺开原始字段（不丢旧信息），再逐个补齐缺失字段 */
export function normalizeDep(raw: unknown, index: number): Dep {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Dep> & Record<string, unknown>;
  return {
    ...r,
    id: typeof r.id === 'number' ? r.id : Date.now() + index,
    name: typeof r.name === 'string' ? r.name : 'unknown',
    version: typeof r.version === 'string' ? r.version : '',
    license: typeof r.license === 'string' ? r.license : '',
    source: typeof r.source === 'string' ? r.source : '',
    status: r.status === 'ok' || r.status === 'warn' || r.status === 'risk' ? r.status : 'warn',
    note: typeof r.note === 'string' ? r.note : '',
    approval: normalizeApproval(r.approval),
  };
}

export function loadDeps(): Dep[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialDeps;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return initialDeps;
    return parsed.map(normalizeDep);
  } catch {
    return initialDeps;
  }
}

export function saveDeps(deps: Dep[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deps));
  } catch {
    // 存储被禁用或已满时静默失败，页面状态仍在内存中
  }
}
