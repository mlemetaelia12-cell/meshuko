'use client';

import Link from 'next/link';
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { calculateClosingStock, isValidQuantity, quantityNumber } from '@/lib/stock-logic.mjs';
import { ArrowLeft, ArrowLeftRight, CheckCircle2, ClipboardCheck, Download, LockKeyhole, Printer, Save, ShieldAlert } from 'lucide-react';

type Report = { id: string; report_date: string; status: 'DRAFT' | 'FINALIZED' | 'VOIDED'; created_by: string; finalized_by?: string | null; created_at: string; finalized_at?: string | null };
type ReportLine = {
  animal_group_id: string; type: string; breed: string; sex: string; category: string; group_name: string; tip_tag: string; tag_colour: string;
  opening_quantity: number | string; born_quantity: number | string; new_stock_quantity: number | string; transfer_in_quantity: number | string; transfer_out_quantity: number | string;
  lost_quantity: number | string; mortality_quantity: number | string; sold_quantity: number | string; slaughter_quantity: number | string; closing_quantity: number | string; sick_quantity: number | string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.');
  return data as T;
}
const qty = (value: string | number) => quantityNumber(value);
const fmt = (value: string | number) => Number(value || 0).toLocaleString('en-US');
const dateLabel = (date: string) => date ? new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

export default function ReportEditor({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [lines, setLines] = useState<ReportLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ report: Report; lines: ReportLine[] }>(`/api/reports/${reportId}`);
      setReport(data.report); setLines(data.lines);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Imeshindikana kupakia ripoti.';
      setNotice({ type: 'error', message });
      if (message.toLowerCase().includes('ingia kwanza')) router.replace('/login');
    } finally { setLoading(false); }
  }, [reportId, router]);
  useEffect(() => { void load(); }, [load]);

  const update = (groupId: string, field: keyof ReportLine, value: string) => {
    setLines((previous) => previous.map((line) => line.animal_group_id === groupId ? { ...line, [field]: value } : line));
  };
  const computed = useMemo(() => lines.map((line) => ({ ...line,
    previewClosing: calculateClosingStock(line)
  })), [lines]);
  const totalClosing = computed.reduce((sum, line) => sum + Number(report?.status === 'FINALIZED' ? line.closing_quantity : line.previewClosing), 0);
  const totalOpening = computed.reduce((sum, line) => sum + qty(line.opening_quantity), 0);
  const totalBorn = computed.reduce((sum, line) => sum + qty(line.born_quantity), 0);
  const totalMovedOut = computed.reduce((sum, line) => sum + qty(line.transfer_out_quantity), 0);
  const totalSick = computed.reduce((sum, line) => sum + qty(line.sick_quantity), 0);

  function hasInvalidQuantities() {
    const fields = ['born_quantity','new_stock_quantity','lost_quantity','mortality_quantity','sold_quantity','slaughter_quantity','sick_quantity'] as const;
    return lines.some((line) => fields.some((field) => !isValidQuantity(line[field])));
  }

  async function saveDraft() {
    if (!report || report.status !== 'DRAFT') return;
    if (hasInvalidQuantities()) { setNotice({ type: 'error', message: 'Kila quantity lazima iwe namba kamili ya sifuri au zaidi. Hakuna decimal au namba hasi.' }); return; }
    setBusy(true); setNotice(null);
    try {
      const payload = lines.map((line) => ({
        animal_group_id: line.animal_group_id, born_quantity: qty(line.born_quantity), new_stock_quantity: qty(line.new_stock_quantity),
        lost_quantity: qty(line.lost_quantity), mortality_quantity: qty(line.mortality_quantity), sold_quantity: qty(line.sold_quantity),
        slaughter_quantity: qty(line.slaughter_quantity), sick_quantity: qty(line.sick_quantity)
      }));
      await api(`/api/reports/${report.id}`, { method: 'PUT', body: JSON.stringify({ lines: payload }) });
      setNotice({ type: 'success', message: 'Draft saved. Live stock has not changed yet.' }); await load();
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Imeshindikana kuhifadhi draft.' }); }
    finally { setBusy(false); }
  }

  async function finalize() {
    if (!report || report.status !== 'DRAFT') return;
    if (hasInvalidQuantities()) { setNotice({ type: 'error', message: 'Kila quantity lazima iwe namba kamili ya sifuri au zaidi. Hakuna decimal au namba hasi.' }); return; }
    const negative = computed.find((line) => line.previewClosing < 0);
    if (negative) { setNotice({ type: 'error', message: `Stock haitoshi kwa kundi ${negative.group_name} · ${negative.breed}. Rekebisha movements kwanza.` }); return; }
    const sickOver = computed.find((line) => qty(line.sick_quantity) > line.previewClosing);
    if (sickOver) { setNotice({ type: 'error', message: `Sick quantity inazidi closing stock kwa kundi ${sickOver.group_name} · ${sickOver.breed}.` }); return; }
    if (!window.confirm('Finalize this report? Stock movements will be posted to the live ledger and the report will become read-only.')) return;
    setBusy(true); setNotice(null);
    try {
      const payload = lines.map((line) => ({ animal_group_id: line.animal_group_id, born_quantity: qty(line.born_quantity), new_stock_quantity: qty(line.new_stock_quantity), lost_quantity: qty(line.lost_quantity), mortality_quantity: qty(line.mortality_quantity), sold_quantity: qty(line.sold_quantity), slaughter_quantity: qty(line.slaughter_quantity), sick_quantity: qty(line.sick_quantity) }));
      await api(`/api/reports/${report.id}`, { method: 'PUT', body: JSON.stringify({ lines: payload }) });
      await api(`/api/reports/${report.id}/finalize`, { method: 'POST', body: JSON.stringify({}) });
      setNotice({ type: 'success', message: 'Report finalized successfully. Live stock has been refreshed.' }); await load();
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Imeshindikana kufinalisha ripoti.' }); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    if (!report) return;
    const headers = ['Type','Breed','Sex','Category','Group','Current Quantity','New Born','New Stock','Transfer In','Transfer Out','Lost','Mortality','Sold','Slaughter','Net Quantity','Sick'];
    const rows = computed.map((l) => [l.type,l.breed,l.sex,l.category,l.group_name,l.opening_quantity,l.born_quantity,l.new_stock_quantity,l.transfer_in_quantity,l.transfer_out_quantity,l.lost_quantity,l.mortality_quantity,l.sold_quantity,l.slaughter_quantity,report.status === 'FINALIZED' ? l.closing_quantity : l.previewClosing,l.sick_quantity]);
    const csv = [headers,...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = `meshukos-stock-report-${report.report_date}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (loading && !report) return <main className="report-page-shell"><div className="loading-state"><span className="loader-ring"/><strong>Loading daily report…</strong></div></main>;
  if (!report) return <main className="report-page-shell"><div className="panel"><h2>Report unavailable</h2><p>{notice?.message || 'Report could not be loaded.'}</p><Link href="/dashboard" className="btn btn-primary">Back to dashboard</Link></div></main>;

  return <main className="report-page-shell">
    <header className="report-page-top"><Link href="/dashboard" className="btn btn-soft btn-sm"><ArrowLeft size={16}/> Dashboard</Link><div className="report-top-brand"><Image src="/favicon.svg" alt=""  width={160} height={60}/><span>MESHUKO&apos;S S AND G FARM<small>FARM STOCK RECORDS</small></span></div><div className="report-top-actions"><button onClick={exportCsv} className="btn btn-soft btn-sm"><Download size={15}/> Export CSV</button><button onClick={() => window.print()} className="btn btn-soft btn-sm"><Printer size={15}/> Print / PDF</button></div></header>
    <div className="report-document">
      <div className="report-heading-row"><div><div className="page-kicker"><ClipboardCheck size={15}/> STOCK &amp; MOVEMENT REGISTER</div><h1>Daily stock report<span className="heading-period">.</span></h1><p>Stock recorded before and after the movements for the selected date.</p></div><span className={`status-pill status-${report.status.toLowerCase()}`}><span/>{report.status === 'FINALIZED' ? 'Finalized' : report.status === 'DRAFT' ? 'Draft' : 'Voided'}</span></div>
      {notice && <div className={`toast toast-${notice.type}`} role="status"><span>{notice.type === 'success' ? <CheckCircle2 size={18}/> : <ShieldAlert size={18}/>}</span><p>{notice.message}</p></div>}
      <section className="report-paper">
        <div className="report-paper-head"><div className="report-paper-logo"><Image src="/app-icon.svg" alt="Farm emblem"  width={160} height={60}/><span><strong>MESHUKO&apos;S S AND G FARM</strong><small>SHEEP &amp; GOAT FARM STOCK REPORT</small></span></div><div className="report-date-box"><span>REPORT DATE</span><strong>{dateLabel(report.report_date)}</strong></div></div>
        <div className="report-kpi-strip"><div><span>Opening stock</span><strong>{fmt(totalOpening)}</strong></div><div><span>Newborns</span><strong>{fmt(totalBorn)}</strong></div><div><span>Transfers out</span><strong>{fmt(totalMovedOut)}</strong></div><div><span>Closing stock</span><strong>{fmt(totalClosing)}</strong></div><div><span>Sick animals</span><strong>{fmt(totalSick)}</strong></div></div>
        {report.status === 'DRAFT' && <div className="report-transfer-note"><ArrowLeftRight size={17}/><p><strong>Transfer in/out fields are calculated automatically.</strong><span>Record internal or external transfers in the dashboard for this same date before finalizing this report.</span></p><Link href="/dashboard" className="btn btn-soft btn-sm">Open dashboard <ArrowLeft size={14}/></Link></div>}
        <div className="report-table-wrap"><table className="report-data-table"><thead><tr><th>TYPE / GROUP</th><th>BREED</th><th>SEX</th><th>CATEGORY</th><th>CURRENT QTY</th><th>NEW BORN (+)</th><th>NEW STOCK (+)</th><th>TRANSFER IN (+)</th><th>TRANSFER OUT (−)</th><th>LOST (−)</th><th>MORTALITY (−)</th><th>SOLD (−)</th><th>SLAUGHTER (−)</th><th>NET QTY</th><th>SICK</th></tr></thead><tbody>{computed.map((line) => <tr key={line.animal_group_id}><td><strong>{line.type}</strong><small>{line.group_name}{line.tip_tag ? ` · ${line.tip_tag}` : ''}</small></td><td>{line.breed}</td><td>{line.sex}</td><td>{line.category}</td><td className="number-cell">{fmt(line.opening_quantity)}</td>
          {(['born_quantity','new_stock_quantity'] as const).map((field) => <td key={field} className="edit-cell">{report.status === 'DRAFT' ? <input aria-label={field.replaceAll('_',' ')} type="number" min="0" step="1" value={String(line[field])} onChange={(e) => update(line.animal_group_id, field, e.target.value)}/> : fmt(line[field])}</td>)}
          <td className="number-cell transfer-cell">{fmt(line.transfer_in_quantity)}</td><td className="number-cell transfer-cell">{fmt(line.transfer_out_quantity)}</td>
          {(['lost_quantity','mortality_quantity','sold_quantity','slaughter_quantity'] as const).map((field) => <td key={field} className="edit-cell">{report.status === 'DRAFT' ? <input aria-label={field.replaceAll('_',' ')} type="number" min="0" step="1" value={String(line[field])} onChange={(e) => update(line.animal_group_id, field, e.target.value)}/> : fmt(line[field])}</td>)}
          <td className={`number-cell ${line.previewClosing < 0 ? 'text-negative' : 'closing-cell'}`}>{fmt(report.status === 'FINALIZED' ? line.closing_quantity : line.previewClosing)}</td><td className="edit-cell sick-cell">{report.status === 'DRAFT' ? <input aria-label="sick quantity" type="number" min="0" step="1" value={String(line.sick_quantity)} onChange={(e) => update(line.animal_group_id, 'sick_quantity', e.target.value)}/> : fmt(line.sick_quantity)}</td></tr>)}</tbody><tfoot><tr><td colSpan={4}>TOTAL</td><td>{fmt(totalOpening)}</td><td>{fmt(totalBorn)}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.new_stock_quantity),0))}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.transfer_in_quantity),0))}</td><td>{fmt(totalMovedOut)}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.lost_quantity),0))}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.mortality_quantity),0))}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.sold_quantity),0))}</td><td>{fmt(computed.reduce((s,l)=>s+qty(l.slaughter_quantity),0))}</td><td>{fmt(totalClosing)}</td><td>{fmt(totalSick)}</td></tr></tfoot></table></div>
        <div className="report-paper-foot"><span>Report ID: {report.id.slice(0,8).toUpperCase()}</span><span>{report.status === 'FINALIZED' ? `Finalized by ${report.finalized_by || 'Farm Admin'}${report.finalized_at ? ` · ${new Date(report.finalized_at).toLocaleString('en-GB')}` : ''}` : 'Draft preview — not yet posted to live stock'}</span></div>
      </section>
      {report.status === 'DRAFT' && <section className="report-edit-footer"><div className="report-edit-note"><LockKeyhole size={17}/><span><strong>Draft mode</strong><small>Saving keeps the stock unchanged. Finalize only after verifying the quantities.</small></span></div><div className="report-edit-actions"><button className="btn btn-soft" onClick={() => void saveDraft()} disabled={busy}><Save size={16}/>{busy ? 'Saving…' : 'Save draft'}</button><button className="btn btn-primary" onClick={() => void finalize()} disabled={busy}><CheckCircle2 size={16}/>{busy ? 'Finalizing…' : 'Finalize report'}</button></div></section>}
      {report.status === 'FINALIZED' && <section className="finalized-note"><CheckCircle2 size={18}/><span><strong>Finalized snapshot</strong><small>This report is read-only. The values above are retained as the historical record for this date.</small></span></section>}
      <div className="report-bottom-credit">Built for farm clarity by <strong>BRELL</strong> · <a href="mailto:buildwebtz@gmail.com">buildwebtz@gmail.com</a> · <a href="https://wa.me/255784452159" target="_blank" rel="noreferrer">+255 784 452 159</a></div>
    </div>
  </main>;
}
