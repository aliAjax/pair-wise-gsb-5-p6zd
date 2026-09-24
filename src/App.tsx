import {useEffect, useMemo, useState} from 'react';
import {AlertTriangle, Ban, Check, ChevronDown, Download, FileCode2, History, Info, Layers3, Pencil, Plus, Search, ShieldCheck, Sparkles, Undo2, X} from 'lucide-react';
import {
  ApprovalView,
  actionLabels,
  approve,
  comboOf,
  createPendingApproval,
  reject,
  resetForComboChange,
  resolveApproval,
  revoke,
  summarizeApprovals,
  viewLabel,
} from './approval';
import {Dep, loadDeps, saveDeps} from './persistence';

const colors: Record<string, string> = {MIT: '#35b995', 'BSD-3-Clause': '#6d9ee8', 'GPL-3.0': '#ec8c75', 'Apache-2.0': '#b18ee4'};
const licenseOptions = ['MIT', 'BSD-3-Clause', 'Apache-2.0', 'GPL-3.0'];

const riskOf = (license: string): Dep['status'] => (license.startsWith('GPL') ? 'risk' : license === 'MIT' ? 'ok' : 'warn');
const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN', {hour12: false});
const badgeClass = (v: ApprovalView) => (v.expired ? 'expired' : v.status);

export default function App() {
  const [deps, setDeps] = useState<Dep[]>(loadDeps);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const [selected, setSelected] = useState(() => deps[0]?.id ?? 0);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('MIT');
  // 审批表单
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  // 依赖组合编辑
  const [editVersion, setEditVersion] = useState('');
  const [editLicense, setEditLicense] = useState('MIT');

  const current = deps.find(d => d.id === selected);

  useEffect(() => saveDeps(deps), [deps]);

  // 切换选中依赖时，重置审批表单并同步组合编辑框
  useEffect(() => {
    setReason('');
    setExpiresAt('');
    setEditVersion(current?.version ?? '');
    setEditLicense(current?.license ?? 'MIT');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // 每条依赖的生效审批状态（组合变更/过期在此统一换算）
  const views = useMemo(() => {
    const now = Date.now();
    return new Map(deps.map(d => [d.id, resolveApproval(d.approval, d, now)]));
  }, [deps]);

  const approvalSummary = useMemo(() => summarizeApprovals(deps), [deps]);

  const filtered = useMemo(
    () =>
      deps.filter(d => {
        if (!`${d.name}${d.license}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (filter === '全部') return true;
        if (filter.startsWith('ap:')) {
          const v = views.get(d.id);
          return v !== undefined && filter === `ap:${badgeClass(v)}`;
        }
        return d.status === filter;
      }),
    [deps, filter, query, views],
  );

  const updateDep = (id: number, fn: (d: Dep) => Dep) => setDeps(ds => ds.map(d => (d.id === id ? fn(d) : d)));

  const add = () => {
    if (!name.trim()) return;
    const id = Date.now();
    setDeps(ds => [
      ...ds,
      {
        id,
        name: name.trim(),
        version: '1.0.0',
        license,
        source: '手动',
        status: riskOf(license),
        note: license === 'MIT' ? '宽松许可，可商用' : '请核对分发义务',
        approval: createPendingApproval(),
      },
    ]);
    setSelected(id);
    setName('');
    setShowAdd(false);
  };

  // 批准 / 驳回 / 撤销：只改审批字段，留痕由 approval 模块负责
  const doApprove = () => {
    if (!current || !reason.trim()) return;
    updateDep(current.id, d => ({...d, approval: approve(d.approval, comboOf(d), reason.trim(), expiresAt || null)}));
    setReason('');
    setExpiresAt('');
  };
  const doReject = () => {
    if (!current || !reason.trim()) return;
    updateDep(current.id, d => ({...d, approval: reject(d.approval, comboOf(d), reason.trim())}));
    setReason('');
    setExpiresAt('');
  };
  const doRevoke = () => {
    if (!current) return;
    updateDep(current.id, d => ({...d, approval: revoke(d.approval, comboOf(d), reason.trim() || '手动撤销，重新待审')}));
    setReason('');
    setExpiresAt('');
  };

  // 修改版本/许可证：组合一变，审批自动退回待审
  const saveCombo = () => {
    if (!current) return;
    const version = editVersion.trim() || current.version;
    updateDep(current.id, d => {
      const next: Dep = {...d, version, license: editLicense, status: riskOf(editLicense)};
      return {...next, approval: resetForComboChange(d.approval, comboOf(next))};
    });
  };

  const exportMd = () => {
    const now = Date.now();
    const s = summarizeApprovals(deps, now);
    const rows = deps.map(d => {
      const v = resolveApproval(d.approval, d, now);
      const approvalText = v.expired ? '已过期（失效）' : viewLabel(v);
      return `| ${d.name} | ${d.version} | ${d.license} | ${d.status} | ${approvalText} | ${v.reason || '—'} | ${v.expiresAt || '—'} |`;
    });
    const text = `# License Lens 发布前复核报告

生成时间：${fmtTime(now)}

审批概览：已批准 ${s.approved} / 待审 ${s.pending} / 已驳回 ${s.rejected} / 已过期失效 ${s.expired}（共 ${s.total} 个依赖）

| 依赖 | 版本 | 许可证 | 风险状态 | 审批状态 | 审批原因 | 到期日 |
|---|---|---|---|---|---|---|
${rows.join('\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown'}));
    a.download = 'license-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const currentView = current ? views.get(current.id) : undefined;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18} /></div>
          <div><b>License Lens</b><small>dependency clarity</small></div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        <button className="nav active"><Layers3 size={16} />依赖总览</button>
        <button className="nav"><FileCode2 size={16} />许可证清单 <span>{deps.length}</span></button>
        <button className="nav"><AlertTriangle size={16} />待处理风险 <span className="red">{deps.filter(d => d.status === 'risk').length}</span></button>
        <div className="aside-bottom">
          <div className="mini-card"><Sparkles size={16} /><div><b>扫描已更新</b><small>刚刚完成 {deps.length} 个依赖的分析</small></div></div>
          <div className="user"><div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14} /></div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>PROJECT SCAN</b></div>
            <h1>许可证兼容性分析</h1>
            <p>检查依赖许可，放心发布你的项目。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportMd}><Download size={15} />导出报告</button>
            <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16} />添加依赖</button>
          </div>
        </header>
        <section className="hero">
          <div>
            <span className="tag">PROJECT · AURORA-WEB</span>
            <h2>发布前，再确认一次。</h2>
            <p>
              我们扫描了 <b>{deps.length} 个依赖</b>，发现 <b className="warning">{deps.filter(d => d.status !== 'ok').length} 个项目</b>需要你的关注；
              <b> {approvalSummary.approved} 个依赖</b>已通过发布审批。
            </p>
          </div>
          <div className="scan-score">
            <div className="score-ring"><strong>{deps.length ? Math.round((deps.filter(d => d.status === 'ok').length / deps.length) * 100) : 0}<small>%</small></strong></div>
            <div><span>兼容评分</span><b>良好</b><small>上次扫描 2 分钟前</small></div>
          </div>
        </section>
        <section className="summary">
          <div><span>全部依赖</span><b>{deps.length}</b><small>+2 本次新增</small></div>
          <div><span>安全许可</span><b className="teal">{deps.filter(d => d.status === 'ok').length}</b><small>可直接分发</small></div>
          <div><span>需要复核</span><b className="orange">{deps.filter(d => d.status === 'warn').length}</b><small>保留声明即可</small></div>
          <div><span>高风险</span><b className="red">{deps.filter(d => d.status === 'risk').length}</b><small>建议替换或隔离</small></div>
        </section>
        <section className="summary approval-summary">
          <div><span>待审</span><b className="orange">{approvalSummary.pending}</b><small>发布前需完成复核</small></div>
          <div><span>已批准</span><b className="teal">{approvalSummary.approved}</b><small>组合锁定，审批有效</small></div>
          <div><span>已驳回</span><b className="red">{approvalSummary.rejected}</b><small>需整改后重新提交</small></div>
          <div><span>已过期</span><b>{approvalSummary.expired}</b><small>按失效处理，需重新批准</small></div>
        </section>
        <section className="workspace">
          <div className="table-pane">
            <div className="pane-head">
              <div><h2>依赖清单</h2><p>逐项查看许可证义务与审批状态</p></div>
              <div className="tools">
                <div className="search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索依赖" /></div>
                <select value={filter} onChange={e => setFilter(e.target.value)}>
                  <option value="全部">全部状态</option>
                  <option value="ok">安全</option>
                  <option value="warn">复核</option>
                  <option value="risk">高风险</option>
                  <option value="ap:pending">待审</option>
                  <option value="ap:approved">已批准</option>
                  <option value="ap:rejected">已驳回</option>
                  <option value="ap:expired">已过期</option>
                </select>
              </div>
            </div>
            <div className="table">
              <div className="tr th"><span>依赖名称</span><span>版本</span><span>许可证</span><span>状态</span><span>审批</span></div>
              {filtered.map(d => {
                const v = views.get(d.id);
                return (
                  <button className={d.id === selected ? 'tr selected' : 'tr'} key={d.id} onClick={() => setSelected(d.id)}>
                    <span className="dep-name"><span className="pkg-dot" /> {d.name}</span>
                    <span className="muted">{d.version}</span>
                    <span><i className="license" style={{color: colors[d.license] || '#888', background: (colors[d.license] || '#888') + '18'}}>{d.license}</i></span>
                    <span className={'status ' + d.status}>{d.status === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {d.status === 'ok' ? '安全' : d.status === 'warn' ? '复核' : '高风险'}</span>
                    <span>{v && <i className={'approval-badge ' + badgeClass(v)}>{viewLabel(v)}</i>}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {current && currentView && (
            <div className="detail">
              <div className="detail-head">
                <div className="detail-icon" style={{background: (colors[current.license] || '#888') + '1c', color: colors[current.license]}}><FileCode2 size={20} /></div>
                <div><span>SELECTED DEPENDENCY</span><h2>{current.name}</h2></div>
                <button className="close" onClick={() => setSelected(0)}><X size={16} /></button>
              </div>
              <div className="detail-grid">
                <div><label>版本</label><b>{current.version}</b></div>
                <div><label>来源</label><b>{current.source}</b></div>
                <div><label>许可证</label><b>{current.license}</b></div>
              </div>
              <div className={'finding ' + current.status}>
                <div className="finding-icon">{current.status === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}</div>
                <div>
                  <b>{current.status === 'ok' ? '可以放心使用' : current.status === 'warn' ? '需要保留声明' : '存在分发限制'}</b>
                  <p>{current.note}。扫描结果基于 package 元数据，请在发布前查看完整许可证文本。</p>
                </div>
              </div>

              <div className="approval-panel">
                <div className="approval-current">
                  <i className={'approval-badge ' + badgeClass(currentView)}>{viewLabel(currentView)}</i>
                  <div className="approval-meta">
                    {currentView.decidedAt ? <small>决定时间 {fmtTime(currentView.decidedAt)}</small> : <small>尚未审批</small>}
                    {currentView.expiresAt && <small>到期日 {currentView.expiresAt}</small>}
                  </div>
                </div>
                {currentView.stale && <p className="hint">名称 / 版本 / 许可证已变更，原审批自动失效，已退回待审。</p>}
                {currentView.expired && <p className="hint">批准已于 {currentView.expiresAt} 到期，清单、统计与导出均按失效处理，请重新批准。</p>}
                {currentView.reason && <p className="reason-line">最近原因：{currentView.reason}</p>}
                <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="审批原因（必填，留痕后可随时查看）" rows={2} />
                <div className="approval-form-row">
                  <label>到期日（可选）<input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></label>
                </div>
                <div className="approval-actions">
                  <button className="primary" onClick={doApprove} disabled={!reason.trim()}><Check size={14} />批准</button>
                  <button className="outline danger" onClick={doReject} disabled={!reason.trim()}><Ban size={14} />驳回</button>
                  <button className="outline" onClick={doRevoke} disabled={current.approval.status === 'pending'}><Undo2 size={14} />撤销</button>
                </div>
              </div>

              <div className="edit-combo">
                <div><Pencil size={14} /><span>依赖信息变更</span></div>
                <p>修改版本或许可证后，原审批自动退回待审，需重新复核。</p>
                <div className="edit-row">
                  <input value={editVersion} onChange={e => setEditVersion(e.target.value)} placeholder="版本号" />
                  <select value={editLicense} onChange={e => setEditLicense(e.target.value)}>
                    {licenseOptions.map(l => <option key={l}>{l}</option>)}
                  </select>
                  <button className="outline" onClick={saveCombo} disabled={editVersion === current.version && editLicense === current.license}>保存</button>
                </div>
              </div>

              <div className="history">
                <div className="history-head"><History size={13} /><span>审批记录（留痕）</span></div>
                {current.approval.history.length === 0 && <p className="history-empty">暂无审批记录</p>}
                {[...current.approval.history].reverse().map((e, i) => (
                  <div className="history-item" key={`${e.at}-${i}`}>
                    <span className={'dot ' + e.action} />
                    <div>
                      <b>{actionLabels[e.action]}</b>
                      <small>{fmtTime(e.at)} · {e.combo.name}@{e.combo.version} {e.combo.license}{e.expiresAt ? ` · 到期 ${e.expiresAt}` : ''}</small>
                      {e.reason && <p>{e.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="full-license">
                <div><Info size={15} /><span>许可证摘要</span></div>
                <p>{current.license} 允许在满足其条款的前提下使用和分发代码。详细义务请参考项目仓库中的 LICENSE 文件。</p>
                <button>查看原文 <ChevronDown size={14} /></button>
              </div>
            </div>
          )}
        </section>
      </main>
      {showAdd && (
        <div className="backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>添加依赖</h2><button onClick={() => setShowAdd(false)}>×</button></div>
            <label>依赖名称<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="例如 date-fns" /></label>
            <label>许可证<select value={license} onChange={e => setLicense(e.target.value)}>{licenseOptions.map(l => <option key={l}>{l}</option>)}</select></label>
            <button className="primary full" onClick={add}>加入扫描</button>
          </div>
        </div>
      )}
    </div>
  );
}
