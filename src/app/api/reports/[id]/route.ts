import { NextResponse } from 'next/server';
import { apiAdmin, jsonError, readableError } from '@/lib/http';
import { originIsSame } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { FARM_ID } from '@/lib/config';
import { reportLineSchema } from '@/lib/validation';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const saveSchema = z.object({ lines: z.array(reportLineSchema).min(1).max(500) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!apiAdmin(request)) return jsonError('Tafadhali ingia kwanza.', 401);
  const { id } = await context.params;
  try {
    const sql = getDb();
    const reportRows = await sql`SELECT id,report_date,status,created_by,finalized_by,created_at,finalized_at FROM daily_reports WHERE id=${id}::uuid AND farm_id=${FARM_ID} LIMIT 1`;
    if (!reportRows.length) return jsonError('Ripoti haijapatikana.', 404);
    const report = reportRows[0] as { id: string; report_date: string; status: string };
    const lines = await sql`
      SELECT g.id AS animal_group_id,g.type,g.breed,g.sex,g.category,g.group_name,g.tip_tag,g.tag_colour,
        CASE WHEN ${report.status}='FINALIZED' THEN COALESCE(l.opening_quantity,0) ELSE (
          SELECT COALESCE(SUM(CASE WHEN m.movement_type IN ('OPENING','BIRTH','NEW_STOCK','TRANSFER_IN','ADJUSTMENT_IN') THEN m.quantity ELSE -m.quantity END),0)
          FROM stock_movements m WHERE m.animal_group_id=g.id AND (m.effective_date < ${report.report_date}::date OR (m.effective_date=${report.report_date}::date AND m.movement_type='OPENING'))
        ) END::bigint AS opening_quantity,
        COALESCE(l.born_quantity,0)::int AS born_quantity,
        COALESCE(l.new_stock_quantity,0)::int AS new_stock_quantity,
        CASE WHEN ${report.status}='FINALIZED' THEN COALESCE(l.transfer_in_quantity,0) ELSE (SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE animal_group_id=g.id AND effective_date=${report.report_date}::date AND movement_type='TRANSFER_IN') END::bigint AS transfer_in_quantity,
        CASE WHEN ${report.status}='FINALIZED' THEN COALESCE(l.transfer_out_quantity,0) ELSE (SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE animal_group_id=g.id AND effective_date=${report.report_date}::date AND movement_type='TRANSFER_OUT') END::bigint AS transfer_out_quantity,
        COALESCE(l.lost_quantity,0)::int AS lost_quantity,
        COALESCE(l.mortality_quantity,0)::int AS mortality_quantity,
        COALESCE(l.sold_quantity,0)::int AS sold_quantity,
        COALESCE(l.slaughter_quantity,0)::int AS slaughter_quantity,
        COALESCE(l.closing_quantity,0)::bigint AS closing_quantity,
        COALESCE(l.sick_quantity,0)::int AS sick_quantity
      FROM animal_groups g LEFT JOIN daily_report_lines l ON l.animal_group_id=g.id AND l.report_id=${id}::uuid
      WHERE g.farm_id=${FARM_ID} AND (l.id IS NOT NULL OR (g.active=true AND g.created_at::date <= ${report.report_date}::date))
      ORDER BY g.type,g.group_name,g.breed,g.sex,g.category`;
    return NextResponse.json({ report, lines });
  } catch (error) { return jsonError(readableError(error), 500); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = apiAdmin(request);
  if (!email) return jsonError('Tafadhali ingia kwanza.', 401);
  if (!originIsSame(request)) return jsonError('Request origin haijaruhusiwa.', 403);
  const { id } = await context.params;
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Kagua fields za ripoti.');
  const duplicateIds = new Set<string>();
  for (const line of parsed.data.lines) {
    if (duplicateIds.has(line.animal_group_id)) return jsonError('Kundi moja limejirudia kwenye ripoti.');
    duplicateIds.add(line.animal_group_id);
  }
  try {
    const sql = getDb();
    const payload = JSON.stringify(parsed.data.lines);
    const rows = await sql`
      WITH r AS (SELECT id,status FROM daily_reports WHERE id=${id}::uuid AND farm_id=${FARM_ID} FOR UPDATE),
      payload AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          animal_group_id uuid,born_quantity integer,new_stock_quantity integer,lost_quantity integer,
          mortality_quantity integer,sold_quantity integer,slaughter_quantity integer,sick_quantity integer)
      ), saved AS (
        INSERT INTO daily_report_lines(report_id,animal_group_id,born_quantity,new_stock_quantity,lost_quantity,mortality_quantity,sold_quantity,slaughter_quantity,sick_quantity)
        SELECT r.id,p.animal_group_id,p.born_quantity,p.new_stock_quantity,p.lost_quantity,p.mortality_quantity,p.sold_quantity,p.slaughter_quantity,p.sick_quantity
        FROM r JOIN payload p ON true JOIN animal_groups g ON g.id=p.animal_group_id AND g.farm_id=${FARM_ID}
        WHERE r.status='DRAFT'
        ON CONFLICT (report_id,animal_group_id) DO UPDATE SET
          born_quantity=EXCLUDED.born_quantity,new_stock_quantity=EXCLUDED.new_stock_quantity,
          lost_quantity=EXCLUDED.lost_quantity,mortality_quantity=EXCLUDED.mortality_quantity,
          sold_quantity=EXCLUDED.sold_quantity,slaughter_quantity=EXCLUDED.slaughter_quantity,sick_quantity=EXCLUDED.sick_quantity
        RETURNING id
      ) SELECT r.status,(SELECT COUNT(*)::int FROM saved) AS saved_count FROM r`;
    if (!rows.length) return jsonError('Ripoti haijapatikana.', 404);
    const result = rows[0] as { status: string; saved_count: number };
    if (result.status !== 'DRAFT') return jsonError('Ripoti iliyofinalishwa haiwezi kuhaririwa moja kwa moja.', 409);
    if (result.saved_count !== parsed.data.lines.length) return jsonError('Baadhi ya makundi hayapo au hayaruhusiwi kwenye shamba hili.');
    await sql`INSERT INTO audit_logs(farm_id,actor_email,action,entity_type,entity_id,after_data) VALUES(${FARM_ID},${email},'SAVE_DRAFT','daily_report',${id},${JSON.stringify({ lineCount: parsed.data.lines.length })}::jsonb)`;
    return NextResponse.json({ ok: true, savedCount: result.saved_count });
  } catch (error) { return jsonError(readableError(error), 500); }
}
