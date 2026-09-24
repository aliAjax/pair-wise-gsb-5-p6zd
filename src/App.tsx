import {useMemo, useState} from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Clock,
  Download,
  FileCode2,
  History,
  Info,
  Layers3,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildReport,
  dayEnd,
  effectiveReview,
  fingerprintOf,
  formatDate,
  formatDateTime,
  RISK_LABELS,
  STATE_LABELS,
  todayInputValue,
  type Dep,
  type ReviewState,
} from './review/rules';
import {useReviews} from './review/useReviews';

const colors: Record<string, string> = {
  MIT: '#35b995',
  'BSD-3-Clause': '#6d9ee8',
  'GPL-3.0': '#ec8c75',
  'Apache-2.0': '#b18ee4',
};

const riskColor: Record<string, string> = {ok: '#35b995', warn: '#da9a57', risk: '#dc7464'};

type FilterValue = '全部' | ReviewState | 'expired';

type DecisionModal =
  | {kind: 'approve'; depId: number}
  | {kind: 'reject'; depId: number}
  | null;

export default function App() {
  const {
    deps,
    reviews,
    summary,
    migratedFromV1,
    addDep,
    updateDep,
    approve,
    reject,
    revoke,
  } = useReviews();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterValue>('全部');
  // 首次打开（含旧缓存迁移）即选中第一条依赖；用户之后可手动关闭详情
  const [selected, setSelected] = useState<number | null>(() => deps[0]?.id ?? null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('MIT');
  const [modal, setModal] = useState<DecisionModal>(null);
  const [expiryInput, setExpiryInput] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editVersion, setEditVersion] = useState('');
  const [editLicense, setEditLicense] = useState('MIT');
  const [bannerVisible, setBannerVisible] = useState(migratedFromV1);

  const now = Date.now();
  const current = deps.find((d) => d.id === selected);

  const effOf = (d: Dep) => effectiveReview(reviews[d.id], d, now);

  const filtered = useMemo(
    () =>
      deps.filter((d) => {
        const eff = effOf(d);
        const matchFilter =
          filter === '全部' ||
          (filter === 'expired' ? eff.expired : eff.state === filter);
        const matchQuery = `${d.name}${d.version}${d.license}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchFilter && matchQuery;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, reviews, filter, query, now]
  );

  const readyPct = summary.total ? Math.round((summary.approved / summary.total) * 100) : 0;

  const openApprove = (id: number) => {
    setExpiryInput('');
    setModalError('');
    setModal({kind: 'approve', depId: id});
  };
  const openReject = (id: number) => {
    setRejectReason('');
    setModalError('');
    setModal({kind: 'reject', depId: id});
  };
  const submitModal = () => {
    if (!modal) return;
    if (modal.kind === 'approve') {
      const ts = expiryInput ? dayEnd(expiryInput, now) : undefined;
      if (expiryInput && ts === undefined) {
        setModalError('到期日格式无效');
        return;
      }
      if (ts && ts <= now) {
        setModalError('到期日不能早于当前时间');
        return;
      }
      approve(modal.depId, ts);
    } else {
      if (!rejectReason.trim()) {
        setModalError('驳回时必须填写原因，供发布同事查看');
        return;
      }
      reject(modal.depId, rejectReason);
    }
    setModal(null);
  };

  const startEdit = (d: Dep) => {
    setEditName(d.name);
    setEditVersion(d.version);
    setEditLicense(d.license);
    setEditing(true);
  };
  const saveEdit = () => {
    if (!current) return;
    if (!editName.trim() || !editVersion.trim()) return;
    // 名称/版本/许可证任一变化 → 指纹改变 → 审批自动退回待审（规则模块处理）
    updateDep(current.id, {
      name: editName.trim(),
      version: editVersion.trim(),
      license: editLicense,
    });
    setEditing(false);
  };

  const add = () => {
    const id = addDep(name, license);
    if (id) {
      setSelected(id);
      setName('');
      setShowAdd(false);
    }
  };

  const exportMd = () => {
    // 过期批准在报告中按「失效·待审」输出（规则模块统一生成）
    const text = buildReport(deps, reviews, now);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown'}));
    a.download = 'license-review-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const curEff = current ? effOf(current) : null;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <b>License Lens</b>
            <small>dependency clarity</small>
          </div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        <button className="nav active">
          <Layers3 size={16} />
          依赖总览
        </button>
        <button className="nav">
          <FileCode2 size={16} />
          许可证清单 <span>{deps.length}</span>
        </button>
        <button className="nav">
          <Clock size={16} />
          待复核 <span className="amber">{summary.pending}</span>
        </button>
        <button className="nav">
          <AlertTriangle size={16} />
          许可证风险 <span className="red">{deps.filter((d) => d.status === 'risk').length}</span>
        </button>
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16} />
            <div>
              <b>复核流程已启用</b>
              <small>{summary.approved} 条已批准 · {summary.pending} 条待审</small>
            </div>
          </div>
          <div className="user">
            <div className="avatar">ZL</div>
            <span>Zen Li</span>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">
              WORKSPACE / <b>PRE-RELEASE REVIEW</b>
            </div>
            <h1>发布前许可证复核</h1>
            <p>每条依赖逐项审批留痕，批准只对当前名称、版本与许可证组合有效。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportMd}>
              <Download size={15} />
              导出报告
            </button>
            <button className="primary" onClick={() => setShowAdd(true)}>
              <Plus size={16} />
              添加依赖
            </button>
          </div>
        </header>

        {bannerVisible && (
          <div className="migration-banner">
            <Info size={14} />
            <span>
              检测到旧版本本地缓存，已自动升级：原有依赖信息完整保留；由于旧版没有审批记录，各条目当前为「待审」。
            </span>
            <button onClick={() => setBannerVisible(false)} aria-label="关闭">
              <X size={13} />
            </button>
          </div>
        )}

        <section className="hero">
          <div>
            <span className="tag">PROJECT · AURORA-WEB</span>
            <h2>发布前，逐条过一遍审批。</h2>
            <p>
              共 <b>{summary.total} 个依赖</b>，<b className="warning">{summary.pending} 条待审</b>
              {summary.expired > 0 && <>（其中 <b className="warning">{summary.expired} 条批准已过期失效</b>）</>}
              ，<b>{summary.approved} 条已批准</b>，<b>{summary.rejected} 条已驳回</b>。
            </p>
          </div>
          <div className="scan-score">
            <div className="score-ring">
              <strong>
                {readyPct}
                <small>%</small>
              </strong>
            </div>
            <div>
              <span>批准覆盖率</span>
              <b>{readyPct === 100 ? '可发布' : '待复核'}</b>
              <small>批准过期不计入覆盖</small>
            </div>
          </div>
        </section>

        <section className="summary">
          <div>
            <span>待审</span>
            <b className="orange">{summary.pending}</b>
            <small>发布前必须处理</small>
          </div>
          <div>
            <span>已批准</span>
            <b className="teal">{summary.approved}</b>
            <small>当前组合有效</small>
          </div>
          <div>
            <span>已驳回</span>
            <b className="red">{summary.rejected}</b>
            <small>需替换或取得授权</small>
          </div>
          <div>
            <span>批准过期失效</span>
            <b className="gray">{summary.expired}</b>
            <small>按待审重新审批</small>
          </div>
        </section>

        <section className="workspace">
          <div className="table-pane">
            <div className="pane-head">
              <div>
                <h2>依赖清单</h2>
                <p>逐项审批，结论与名称/版本/许可证绑定</p>
              </div>
              <div className="tools">
                <div className="search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索依赖"
                  />
                </div>
                <select value={filter} onChange={(e) => setFilter(e.target.value as FilterValue)}>
                  <option value="全部">全部复核</option>
                  <option value="pending">待审</option>
                  <option value="approved">已批准</option>
                  <option value="rejected">已驳回</option>
                  <option value="expired">已过期失效</option>
                </select>
              </div>
            </div>
            <div className="table">
              <div className="tr th">
                <span>依赖名称</span>
                <span>版本</span>
                <span>许可证</span>
                <span>复核状态</span>
              </div>
              {filtered.map((d) => {
                const eff = effOf(d);
                const badge = badgeClass(eff.state, eff.expired, eff.stale);
                return (
                  <button
                    className={d.id === selected ? 'tr selected' : 'tr'}
                    key={d.id}
                    onClick={() => {
                      setSelected(d.id);
                      setEditing(false);
                    }}
                  >
                    <span className="dep-name">
                      <i
                        className="risk-dot"
                        style={{background: riskColor[d.status]}}
                        title={`许可证风险：${RISK_LABELS[d.status]}`}
                      />
                      {d.name}
                    </span>
                    <span className="muted">{d.version}</span>
                    <span>
                      <i
                        className="license"
                        style={{color: colors[d.license] || '#888', background: (colors[d.license] || '#888') + '18'}}
                      >
                        {d.license}
                      </i>
                    </span>
                    <span className={`review-badge ${badge}`}>
                      {badgeIcon(eff.state, eff.expired)}
                      {badgeText(eff.state, eff.expired, eff.stale)}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="empty">没有匹配的依赖</div>}
            </div>
          </div>

          {current && curEff && (
            <div className="detail">
              <div className="detail-head">
                <div
                  className="detail-icon"
                  style={{
                    background: (colors[current.license] || '#888') + '1c',
                    color: colors[current.license],
                  }}
                >
                  <FileCode2 size={20} />
                </div>
                <div>
                  <span>SELECTED DEPENDENCY</span>
                  <h2>{current.name}</h2>
                </div>
                <button className="close" onClick={() => setSelected(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="detail-grid">
                <div>
                  <label>版本</label>
                  <b>{current.version}</b>
                </div>
                <div>
                  <label>来源</label>
                  <b>{current.source}</b>
                </div>
                <div>
                  <label>许可证</label>
                  <b>{current.license}</b>
                </div>
              </div>

              {/* 许可证风险（原有能力保留） */}
              <div className={`finding ${current.status}`}>
                <div className="finding-icon">
                  {current.status === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}
                </div>
                <div>
                  <b>
                    许可证风险 · {RISK_LABELS[current.status]}：
                    {current.status === 'ok'
                      ? '可以放心使用'
                      : current.status === 'warn'
                        ? '需要保留声明'
                        : '存在分发限制'}
                  </b>
                  <p>
                    {current.note}。扫描结果基于 package 元数据，请在发布前查看完整许可证文本。
                  </p>
                </div>
              </div>

              {/* 发布前复核 */}
              <div className={`review-card rv-${badgeClass(curEff.state, curEff.expired, curEff.stale)}`}>
                <div className="review-head">
                  <div className="review-title">
                    <ShieldCheck size={15} />
                    <b>发布前复核</b>
                  </div>
                  <span className={`review-badge ${badgeClass(curEff.state, curEff.expired, curEff.stale)}`}>
                    {badgeIcon(curEff.state, curEff.expired)}
                    {badgeText(curEff.state, curEff.expired, curEff.stale)}
                  </span>
                </div>

                {curEff.state === 'approved' && curEff.expiresAt && (
                  <p className="review-meta">
                    <Clock size={13} />
                    批准有效期至 {formatDate(curEff.expiresAt)}
                    {curEff.expiresAt > now &&
                      `（剩余 ${Math.ceil((curEff.expiresAt - now) / 86400000)} 天）`}
                  </p>
                )}
                {curEff.state === 'approved' && !curEff.expiresAt && (
                  <p className="review-meta">
                    <Clock size={13} />
                    长期有效（未设到期日）
                  </p>
                )}

                {curEff.expired && (
                  <div className="review-alert">
                    <AlertTriangle size={14} />
                    该依赖的批准已于 {formatDate(curEff.expiresAt!)} 到期，清单、统计与导出均按
                    <b> 失效（待审）</b>处理，请重新审批。
                  </div>
                )}
                {!curEff.expired && curEff.stale && (
                  <div className="review-alert">
                    <AlertTriangle size={14} />
                    当前名称/版本/许可证与批准时不一致，原批准自动退回待审。
                  </div>
                )}

                {curEff.state === 'rejected' && curEff.reason && (
                  <div className="reject-reason">
                    <Ban size={13} />
                    <div>
                      <label>驳回原因</label>
                      <p>{curEff.reason}</p>
                    </div>
                  </div>
                )}

                <p className="binding">
                  <Info size={12} />
                  结论绑定组合：<code>{fingerprintOf(current)}</code>
                  ，版本或许可证一经修改即自动退回待审。
                </p>

                <div className="review-actions">
                  {curEff.state !== 'approved' && (
                    <button className="btn-approve" onClick={() => openApprove(current.id)}>
                      <Check size={14} /> 批准
                    </button>
                  )}
                  {curEff.state !== 'rejected' && (
                    <button className="btn-reject" onClick={() => openReject(current.id)}>
                      <Ban size={14} /> 驳回
                    </button>
                  )}
                  {curEff.storedState !== 'pending' && (
                    <button className="btn-revoke" onClick={() => revoke(current.id)}>
                      撤销结论
                    </button>
                  )}
                  <button className="btn-edit" onClick={() => startEdit(current)}>
                    <Pencil size={13} /> 修改名称/版本/许可证
                  </button>
                </div>

                {editing && (
                  <div className="edit-box">
                    <label>
                      名称
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </label>
                    <label>
                      版本
                      <input value={editVersion} onChange={(e) => setEditVersion(e.target.value)} />
                    </label>
                    <label>
                      许可证
                      <select value={editLicense} onChange={(e) => setEditLicense(e.target.value)}>
                        <option>MIT</option>
                        <option>BSD-3-Clause</option>
                        <option>Apache-2.0</option>
                        <option>GPL-3.0</option>
                      </select>
                    </label>
                    <div className="edit-actions">
                      <button className="btn-revoke" onClick={() => setEditing(false)}>
                        取消
                      </button>
                      <button className="btn-approve" onClick={saveEdit}>
                        保存并重新校准
                      </button>
                    </div>
                    <small>保存后若组合发生变化，当前审批将自动退回「待审」并留痕。</small>
                  </div>
                )}

                {curEff.history.length > 0 && (
                  <div className="history">
                    <div className="history-title">
                      <History size={13} /> 审批留痕
                    </div>
                    <ul>
                      {[...curEff.history].reverse().map((h, i) => (
                        <li key={i}>
                          <span className={`dot act-${h.action}`} />
                          <div>
                            <p>{h.detail}</p>
                            <small>{formatDateTime(h.at)}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="full-license">
                <div>
                  <Info size={15} />
                  <span>许可证摘要</span>
                </div>
                <p>
                  {current.license} 允许在满足其条款的前提下使用和分发代码。详细义务请参考项目仓库中的
                  LICENSE 文件。
                </p>
                <button>
                  查看原文 <ChevronDown size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {showAdd && (
        <div className="backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>添加依赖</h2>
              <button onClick={() => setShowAdd(false)}>×</button>
            </div>
            <label>
              依赖名称
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 date-fns"
              />
            </label>
            <label>
              许可证
              <select value={license} onChange={(e) => setLicense(e.target.value)}>
                <option>MIT</option>
                <option>BSD-3-Clause</option>
                <option>Apache-2.0</option>
                <option>GPL-3.0</option>
              </select>
            </label>
            <small className="modal-note">新加入的依赖默认为「待审」，需审批后方可发布。</small>
            <button className="primary full" onClick={add}>
              加入扫描
            </button>
          </div>
        </div>
      )}

      {modal && (
        <div className="backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal.kind === 'approve' ? '批准依赖' : '驳回依赖'}</h2>
              <button onClick={() => setModal(null)}>×</button>
            </div>
            {modal.kind === 'approve' ? (
              <>
                <p className="modal-desc">
                  批准仅对当前 <b>{fingerprintOf(current!)}</b> 组合有效；版本或许可证变更后将自动退回待审。
                </p>
                <label>
                  到期日（可选，留空表示长期有效）
                  <input
                    type="date"
                    min={todayInputValue(now)}
                    value={expiryInput}
                    onChange={(e) => setExpiryInput(e.target.value)}
                  />
                </label>
                <small className="modal-note">
                  到期后清单、统计与导出报告自动按「失效（待审）」处理。
                </small>
              </>
            ) : (
              <label>
                驳回原因（必填，发布同事可在详情中查看）
                <textarea
                  autoFocus
                  rows={4}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="例如：GPL 与闭源分发冲突，需替换或取得商业授权"
                />
              </label>
            )}
            {modalError && <div className="modal-error">{modalError}</div>}
            <button
              className={modal.kind === 'approve' ? 'primary full' : 'btn-danger-full'}
              onClick={submitModal}
            >
              {modal.kind === 'approve' ? '确认批准' : '确认驳回'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 复核徽标（页面展示层辅助） ----------

const badgeClass = (state: ReviewState, expired: boolean, stale: boolean): string => {
  if (expired || stale) return 'invalid';
  return state;
};

const badgeText = (state: ReviewState, expired: boolean, stale: boolean): string => {
  if (expired) return '已失效·待审';
  if (stale) return '组合变更·待审';
  return STATE_LABELS[state];
};

const badgeIcon = (state: ReviewState, expired: boolean) => {
  if (expired) return <Clock size={12} />;
  if (state === 'approved') return <Check size={12} />;
  if (state === 'rejected') return <Ban size={12} />;
  return <Clock size={12} />;
};
