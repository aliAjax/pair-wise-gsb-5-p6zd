// 发布前复核 · 状态管理
// 页面只通过本 hook 操作审批；规则判断走 rules.ts，落盘走 storage.ts。

import {useCallback, useEffect, useMemo, useState} from 'react';
import type {Dep, ReviewMap} from './rules';
import {
  approveReview,
  rejectReview,
  revokeReview,
  summarize,
  syncReviews,
} from './rules';
import {load, save} from './storage';

export const seedDeps: Dep[] = [
  {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', status: 'warn', note: '再发布需保留版权声明'},
  {id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: '手动', status: 'risk', note: '可能与闭源分发冲突'},
];

type ReviewState = {
  deps: Dep[];
  reviews: ReviewMap;
  migratedFromV1: boolean;
};

export function useReviews() {
  // 初始装载：识别旧缓存(v1)并迁移，再用规则层校准（指纹缺失/过期 → 待审）
  const [state, setState] = useState<ReviewState>(() => {
    const loaded = load(seedDeps);
    return {
      deps: loaded.deps,
      reviews: syncReviews(loaded.reviews, loaded.deps),
      migratedFromV1: loaded.version === 1,
    };
  });
  const {deps, reviews} = state;

  // 依赖或审批变化后重新校准并持久化：
  // 名称/版本/许可证一旦改动（指纹不匹配），审批自动退回待审并留痕。
  useEffect(() => {
    setState((s) => ({...s, reviews: syncReviews(s.reviews, s.deps)}));
  }, [deps]);

  useEffect(() => {
    save(deps, reviews);
  }, [deps, reviews]);

  // 到期是时间驱动的：每分钟触发一次重渲染，跨过到期点后
  // 清单/统计/导出无需手动刷新即按失效处理（过期为纯派生，不改写原批准记录）
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const addDep = useCallback((name: string, license: string) => {
    const trimmed = name.trim();
    if (!trimmed) return 0;
    const id = Date.now();
    const dep: Dep = {
      id,
      name: trimmed,
      version: '1.0.0',
      license,
      source: '手动',
      status: license.startsWith('GPL') ? 'risk' : license === 'MIT' ? 'ok' : 'warn',
      note: license === 'MIT' ? '宽松许可，可商用' : '请核对分发义务',
    };
    setState((s) => ({...s, deps: [...s.deps, dep]}));
    return id;
  }, []);

  /** 修改名称/版本/许可证；指纹一变，该依赖的审批由 syncReviews 自动退回待审 */
  const updateDep = useCallback((id: number, patch: Partial<Pick<Dep, 'name' | 'version' | 'license'>>) => {
    setState((s) => ({
      ...s,
      deps: s.deps.map((d) => (d.id === id ? {...d, ...patch} : d)),
    }));
  }, []);

  const approve = useCallback((depId: number, expiresAt?: number) => {
    setState((s) => {
      const dep = s.deps.find((d) => d.id === depId);
      if (!dep) return s;
      return {...s, reviews: {...s.reviews, [depId]: approveReview(s.reviews[depId], dep, {depId, expiresAt})}};
    });
  }, []);

  const reject = useCallback((depId: number, reason: string) => {
    setState((s) => {
      const dep = s.deps.find((d) => d.id === depId);
      if (!dep) return s;
      return {...s, reviews: {...s.reviews, [depId]: rejectReview(s.reviews[depId], dep, {depId, reason})}};
    });
  }, []);

  const revoke = useCallback((depId: number) => {
    setState((s) => {
      const dep = s.deps.find((d) => d.id === depId);
      if (!dep) return s;
      return {...s, reviews: {...s.reviews, [depId]: revokeReview(s.reviews[depId], dep)}};
    });
  }, []);

  const summary = useMemo(() => summarize(deps, reviews), [deps, reviews]);

  return {
    deps,
    reviews,
    summary,
    migratedFromV1: state.migratedFromV1,
    addDep,
    updateDep,
    approve,
    reject,
    revoke,
  };
}
