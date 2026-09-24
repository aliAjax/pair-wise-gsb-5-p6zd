// 发布前复核 · 审批规则模块
// 纯逻辑：不依赖 React / DOM，可独立测试。
// 每条依赖的审批结论与「名称 + 版本 + 许可证」三元组绑定；
// 组合变化或到期后，结论自动失效并退回「待审」。

export type RiskStatus = 'ok' | 'warn' | 'risk';

export type Dep = {
  id: number;
  name: string;
  version: string;
  license: string;
  source: string;
  status: RiskStatus;
  note: string;
};

/** 审批状态：待审 / 已批准 / 已驳回 */
export type ReviewState = 'pending' | 'approved' | 'rejected';

export type AuditEntry = {
  at: number;
  action: 'approve' | 'reject' | 'revoke' | 'auto-reset';
  detail: string;
};

export type ReviewRecord = {
  depId: number;
  /** 批准仅对当前指纹有效：name|version|license */
  fingerprint: string;
  state: ReviewState;
  /** 驳回原因（state=rejected 时必有） */
  reason?: string;
  /** 批准到期日时间戳；undefined 表示长期有效 */
  expiresAt?: number;
  decidedAt?: number;
  history: AuditEntry[];
};

export type ReviewMap = Record<number, ReviewRecord>;

export type ApproveInput = {
  depId: number;
  expiresAt?: number;
  now?: number;
};

export type RejectInput = {
  depId: number;
  reason: string;
  now?: number;
};

// ---------- 指纹：批准只对 当前名称+版本+许可证 组合有效 ----------

export const fingerprintOf = (d: Pick<Dep, 'name' | 'version' | 'license'>): string =>
  `${d.name}@${d.version}|${d.license}`;

// ---------- 到期规则 ----------

/** 日期输入（YYYY-MM-DD）→ 当日 23:59:59.999 的时间戳 */
export const dayEnd = (yyyyMmDd: string, now = Date.now()): number | undefined => {
  if (!yyyyMmDd) return undefined;
  const t = new Date(`${yyyyMmDd}T23:59:59.999`).getTime();
  return Number.isNaN(t) ? undefined : t;
};

export const isExpired = (r: ReviewRecord, now = Date.now()): boolean =>
  r.state === 'approved' && typeof r.expiresAt === 'number' && r.expiresAt <= now;

const changedFingerprint = (r: ReviewRecord, d: Dep): boolean => r.fingerprint !== fingerprintOf(d);

// ---------- 审批操作（返回全新记录，不可变更新） ----------

const withHistory = (r: ReviewRecord, entry: AuditEntry): ReviewRecord => ({
  ...r,
  history: [...r.history, entry],
});

export const approveReview = (
  prev: ReviewRecord | undefined,
  dep: Dep,
  input: ApproveInput
): ReviewRecord => {
  const now = input.now ?? Date.now();
  const base: ReviewRecord = prev ?? {depId: dep.id, fingerprint: '', state: 'pending', history: []};
  return withHistory(
    {
      ...base,
      fingerprint: fingerprintOf(dep),
      state: 'approved',
      reason: undefined,
      expiresAt: input.expiresAt,
      decidedAt: now,
    },
    {
      at: now,
      action: 'approve',
      detail: input.expiresAt ? `已批准（有效期至 ${formatDate(input.expiresAt)}）` : '已批准（长期有效）',
    }
  );
};

export const rejectReview = (
  prev: ReviewRecord | undefined,
  dep: Dep,
  input: RejectInput
): ReviewRecord => {
  const reason = input.reason.trim();
  if (!reason) throw new Error('驳回必须填写原因');
  const now = input.now ?? Date.now();
  const base: ReviewRecord = prev ?? {depId: dep.id, fingerprint: '', state: 'pending', history: []};
  return withHistory(
    {
      ...base,
      fingerprint: fingerprintOf(dep),
      state: 'rejected',
      reason,
      expiresAt: undefined,
      decidedAt: now,
    },
    {at: now, action: 'reject', detail: `已驳回：${reason}`}
  );
};

/** 撤销：回到待审，保留完整历史与原因可查 */
export const revokeReview = (prev: ReviewRecord | undefined, dep: Dep, now = Date.now()): ReviewRecord => {
  const base: ReviewRecord = prev ?? {depId: dep.id, fingerprint: fingerprintOf(dep), state: 'pending', history: []};
  const was = STATE_LABELS[base.state];
  return withHistory(
    {...base, state: 'pending', reason: prev?.reason, expiresAt: undefined, decidedAt: undefined},
    {at: now, action: 'revoke', detail: `撤销${was}结论，回到待审`}
  );
};

// ---------- 自动退回：版本或许可证一改就回到待审（留痕） ----------

/**
 * 校准单条记录；若发生自动退回，返回的第二个值为 true。
 * 组合变更（名称/版本/许可证）→ 真正改写为待审并留痕；
 * 到期不改写记录：批准与到期时间保留，状态由 effectiveReview 统一派生为失效，
 * 这样清单、统计、导出随时都能区分「从未审批」与「批准过期」。
 */
export const syncOne = (
  record: ReviewRecord,
  dep: Dep,
  now = Date.now()
): [ReviewRecord, boolean] => {
  if (changedFingerprint(record, dep)) {
    const reset = withHistory(
      {
        ...record,
        // 退回后指纹对齐当前组合；旧 → 新的变化已写入留痕明细
        fingerprint: fingerprintOf(dep),
        state: 'pending',
        expiresAt: undefined,
        decidedAt: undefined,
      },
      {
        at: now,
        action: 'auto-reset',
        detail: `名称/版本/许可证已变更（${record.fingerprint} → ${fingerprintOf(dep)}），自动退回待审`,
      }
    );
    return [reset, true];
  }

  return [record, false];
};

/** 校准全部记录：指纹不匹配的审批结论退回待审，并补齐缺失记录；过期不在此改写（见 effectiveReview） */
export const syncReviews = (records: ReviewMap, deps: Dep[], now = Date.now()): ReviewMap => {
  const next: ReviewMap = {};
  for (const dep of deps) {
    const existing = records[dep.id];
    next[dep.id] = existing ? syncOne(existing, dep, now)[0] : {
      depId: dep.id,
      fingerprint: fingerprintOf(dep),
      state: 'pending',
      history: [],
    };
  }
  return next;
};

// ---------- 面向页面的派生状态 ----------

export type EffectiveReview = {
  state: ReviewState;
  /** 原始记录状态（区分「失效」与「本来就待审」） */
  storedState: ReviewState;
  reason?: string;
  expiresAt?: number;
  expired: boolean;
  /** 批准绑定的组合与当前组合不一致 */
  stale: boolean;
  history: AuditEntry[];
};

export const PENDING_RECORD = (dep: Dep): EffectiveReview => ({
  state: 'pending',
  storedState: 'pending',
  expired: false,
  stale: false,
  history: [],
});

export function effectiveReview(
  record: ReviewRecord | undefined,
  dep: Dep,
  now = Date.now()
): EffectiveReview {
  if (!record) return PENDING_RECORD(dep);
  const stale = record.fingerprint !== fingerprintOf(dep);
  const expired = isExpired(record, now);
  const invalid = stale || expired;
  return {
    state: invalid ? 'pending' : record.state,
    storedState: record.state,
    reason: record.reason,
    expiresAt: record.expiresAt,
    expired,
    stale,
    history: record.history,
  };
}

export type ReviewSummary = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  /** 曾经批准但已过期（本次打开时按失效处理） */
  expired: number;
  /** 批准已覆盖的依赖数（有效） */
  decided: number;
};

export function summarize(deps: Dep[], records: ReviewMap, now = Date.now()): ReviewSummary {
  const summary: ReviewSummary = {total: deps.length, pending: 0, approved: 0, rejected: 0, expired: 0, decided: 0};
  for (const dep of deps) {
    const eff = effectiveReview(records[dep.id], dep, now);
    if (eff.state === 'approved') {
      summary.approved++;
      summary.decided++;
    } else if (eff.state === 'rejected') {
      summary.rejected++;
      summary.decided++;
    } else {
      summary.pending++;
      if (eff.expired) summary.expired++;
    }
  }
  return summary;
}

// ---------- 文案与导出 ----------

export const STATE_LABELS: Record<ReviewState, string> = {
  pending: '待审',
  approved: '已批准',
  rejected: '已驳回',
};

/** 清单、统计、导出统一使用的状态文案；过期一律按「失效（待审）」处理 */
export function statusText(record: ReviewRecord | undefined, dep: Dep, now = Date.now()): string {
  const eff = effectiveReview(record, dep, now);
  if (eff.expired) return `批准已失效 · 待审（到期日 ${formatDate(eff.expiresAt!)}）`;
  if (eff.stale) return '组合已变更 · 待审';
  if (eff.state === 'approved' && eff.expiresAt)
    return `已批准（至 ${formatDate(eff.expiresAt)}）`;
  if (eff.state === 'rejected') return `已驳回：${eff.reason ?? ''}`;
  return STATE_LABELS[eff.state];
}

export function buildReport(deps: Dep[], records: ReviewMap, now = Date.now()): string {
  const s = summarize(deps, records, now);
  const line = [
    '# License Lens · 发布前复核报告',
    '',
    `生成时间：${formatDateTime(now)}`,
    '',
    `- 全部依赖：${s.total}`,
    `- 待审：${s.pending}（其中批准过期失效：${s.expired}）`,
    `- 已批准：${s.approved}`,
    `- 已驳回：${s.rejected}`,
    '',
    '| 依赖 | 版本 | 许可证 | 许可证风险 | 复核状态 | 到期日 | 原因 |',
    '|---|---|---|---|---|---|---|',
    ...deps.map((d) => {
      const eff = effectiveReview(records[d.id], d, now);
      const review =
        eff.expired ? `批准失效·待审（${formatDate(eff.expiresAt!)}）`
        : eff.stale ? '组合变更·待审'
        : STATE_LABELS[eff.state];
      const expiry = eff.state === 'approved' && eff.expiresAt ? formatDate(eff.expiresAt) : '';
      const reason = eff.state === 'rejected' ? eff.reason ?? '' : '';
      return `| ${cell(d.name)} | ${cell(d.version)} | ${cell(d.license)} | ${cell(RISK_LABELS[d.status])} | ${cell(review)} | ${cell(expiry)} | ${cell(reason)} |`;
    }),
    '',
    '> 过期或因名称/版本/许可证变更而失效的批准一律按「待审」处理，需重新审批后方可发布。',
    '',
  ];
  return line.join('\n');
}

const cell = (v: string | number): string => String(v).replace(/\|/g, '\\|');

export const RISK_LABELS: Record<RiskStatus, string> = {ok: '安全', warn: '复核', risk: '高风险'};

// ---------- 时间格式化 ----------

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const formatDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${formatDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** <input type="date"> 的最小值/默认值：今天 */
export const todayInputValue = (now = Date.now()): string => formatDate(now);
