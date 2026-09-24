// 审批规则模块：状态机、组合锁定、到期失效、留痕与统计。
// 只操作纯数据，不依赖 React 与页面状态；页面通过 resolveApproval 读取生效状态。

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** 审批锁定的依赖组合：名称 + 版本 + 许可证，任一变化即失效 */
export interface DepCombo {
  name: string;
  version: string;
  license: string;
}

export type ApprovalAction = 'approve' | 'reject' | 'revoke' | 'auto-reset';

/** 一条审批留痕：谁动了什么、什么时候、针对哪个组合、为什么 */
export interface ApprovalEvent {
  action: ApprovalAction;
  reason: string;
  at: number;
  combo: DepCombo;
  expiresAt: string | null;
}

export interface Approval {
  status: ApprovalStatus;
  reason: string;
  decidedAt: number | null;
  /** 本次决定锁定的组合；null 表示尚未审批 */
  combo: DepCombo | null;
  /** 批准到期日（YYYY-MM-DD），null 表示长期有效 */
  expiresAt: string | null;
  history: ApprovalEvent[];
}

/** 清单、统计、导出共用的审批视图：已换算成生效状态 */
export interface ApprovalView {
  /** 生效状态：组合变更或批准过期一律回落为 pending */
  status: ApprovalStatus;
  /** 曾批准但已过到期日 */
  expired: boolean;
  /** 审批后名称/版本/许可证被改动 */
  stale: boolean;
  reason: string;
  decidedAt: number | null;
  expiresAt: string | null;
}

export function createPendingApproval(): Approval {
  return {status: 'pending', reason: '', decidedAt: null, combo: null, expiresAt: null, history: []};
}

export function comboOf(dep: DepCombo): DepCombo {
  return {name: dep.name, version: dep.version, license: dep.license};
}

export function sameCombo(a: DepCombo, b: DepCombo): boolean {
  return a.name === b.name && a.version === b.version && a.license === b.license;
}

function isExpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  // 到期日当天 23:59:59 之后才算失效；无法解析的日期按不过期处理，避免误伤旧数据
  const end = new Date(`${expiresAt}T23:59:59`).getTime();
  return Number.isFinite(end) && now > end;
}

/** 由存储状态 + 当前依赖组合换算出生效的审批状态 */
export function resolveApproval(approval: Approval, combo: DepCombo, now: number = Date.now()): ApprovalView {
  const base = {reason: approval.reason, decidedAt: approval.decidedAt, expiresAt: approval.expiresAt};
  if (approval.status === 'pending' || !approval.combo) {
    return {...base, status: 'pending', expired: false, stale: false};
  }
  if (!sameCombo(approval.combo, combo)) {
    return {...base, status: 'pending', expired: false, stale: true};
  }
  if (approval.status === 'approved' && isExpired(approval.expiresAt, now)) {
    return {...base, status: 'pending', expired: true, stale: false};
  }
  return {...base, status: approval.status, expired: false, stale: false};
}

function pushEvent(approval: Approval, event: ApprovalEvent): Approval {
  return {...approval, history: [...approval.history, event]};
}

/** 批准：锁定当前组合，可附到期日，原因必填（留痕） */
export function approve(approval: Approval, combo: DepCombo, reason: string, expiresAt: string | null, now: number = Date.now()): Approval {
  const locked = comboOf(combo);
  const next: Approval = {...approval, status: 'approved', reason, decidedAt: now, combo: locked, expiresAt: expiresAt || null};
  return pushEvent(next, {action: 'approve', reason, at: now, combo: locked, expiresAt: expiresAt || null});
}

/** 驳回：锁定当前组合，原因必填（留痕） */
export function reject(approval: Approval, combo: DepCombo, reason: string, now: number = Date.now()): Approval {
  const locked = comboOf(combo);
  const next: Approval = {...approval, status: 'rejected', reason, decidedAt: now, combo: locked, expiresAt: null};
  return pushEvent(next, {action: 'reject', reason, at: now, combo: locked, expiresAt: null});
}

/** 撤销：回到待审，保留原因与历史 */
export function revoke(approval: Approval, combo: DepCombo, reason: string, now: number = Date.now()): Approval {
  const locked = comboOf(combo);
  const next: Approval = {...approval, status: 'pending', reason, decidedAt: now, combo: locked, expiresAt: null};
  return pushEvent(next, {action: 'revoke', reason, at: now, combo: locked, expiresAt: null});
}

/** 组合变更时调用：已有决定且组合对不上，则自动退回待审并留痕 */
export function resetForComboChange(approval: Approval, combo: DepCombo, now: number = Date.now()): Approval {
  if (approval.status === 'pending' || !approval.combo || sameCombo(approval.combo, combo)) return approval;
  const from = approval.combo;
  const reason = `依赖组合变更（${from.name}@${from.version} ${from.license} → ${combo.name}@${combo.version} ${combo.license}），原审批自动失效`;
  const next: Approval = {...approval, status: 'pending', reason, decidedAt: now, combo: comboOf(combo), expiresAt: null};
  return pushEvent(next, {action: 'auto-reset', reason, at: now, combo: comboOf(combo), expiresAt: null});
}

export const approvalLabels: Record<ApprovalStatus, string> = {pending: '待审', approved: '已批准', rejected: '已驳回'};

export const actionLabels: Record<ApprovalAction, string> = {approve: '批准', reject: '驳回', revoke: '撤销', 'auto-reset': '自动退回待审'};

export function viewLabel(view: ApprovalView): string {
  return view.expired ? '已过期' : approvalLabels[view.status];
}

export interface ApprovalSummary {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  /** 已过期：不计入已批准，统计与导出按失效处理 */
  expired: number;
}

export function summarizeApprovals(deps: Array<DepCombo & {approval: Approval}>, now: number = Date.now()): ApprovalSummary {
  const summary: ApprovalSummary = {total: deps.length, approved: 0, pending: 0, rejected: 0, expired: 0};
  for (const dep of deps) {
    const view = resolveApproval(dep.approval, dep, now);
    if (view.expired) summary.expired += 1;
    else summary[view.status] += 1;
  }
  return summary;
}

/** 容错归一化：旧缓存或异常数据一律能读出合法 Approval，且不丢已有信息 */
export function normalizeApproval(raw: unknown): Approval {
  const fallback = createPendingApproval();
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<Approval>;
  const status: ApprovalStatus = r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending';
  const combo = r.combo && typeof r.combo === 'object'
    ? {
        name: typeof r.combo.name === 'string' ? r.combo.name : '',
        version: typeof r.combo.version === 'string' ? r.combo.version : '',
        license: typeof r.combo.license === 'string' ? r.combo.license : '',
      }
    : null;
  const history: ApprovalEvent[] = Array.isArray(r.history)
    ? r.history.flatMap(e => {
        if (!e || typeof e !== 'object') return [];
        const action: ApprovalAction =
          e.action === 'approve' || e.action === 'reject' || e.action === 'revoke' || e.action === 'auto-reset' ? e.action : 'approve';
        return [{
          action,
          reason: typeof e.reason === 'string' ? e.reason : '',
          at: typeof e.at === 'number' ? e.at : 0,
          combo: e.combo && typeof e.combo === 'object'
            ? {name: String(e.combo.name ?? ''), version: String(e.combo.version ?? ''), license: String(e.combo.license ?? '')}
            : {name: '', version: '', license: ''},
          expiresAt: typeof e.expiresAt === 'string' && e.expiresAt ? e.expiresAt : null,
        }];
      })
    : [];
  return {
    status,
    reason: typeof r.reason === 'string' ? r.reason : '',
    decidedAt: typeof r.decidedAt === 'number' ? r.decidedAt : null,
    combo,
    expiresAt: typeof r.expiresAt === 'string' && r.expiresAt ? r.expiresAt : null,
    history,
  };
}
