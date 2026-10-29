import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { CATEGORY_LABELS } from "./ledger";
import { parseManufacturerId } from "./manufacturers";
import { istanbulDate, purchaseRef, type PurchaseKind } from "./purchases";

/*
 * Muhasebe hesapları. Tutarlar kuruş.
 * - Site satışı: ödenmiş ve iptal/iade edilmemiş sipariş (hazırlanıyor, kargoda, teslim edildi), ödeme tarihine göre.
 * - Satılan malın maliyeti: satış anında sabitlenen alış fiyatı (site siparişi oluşurken, Trendyol satırı eşleşirken);
 *   o an alış fiyatı yoksa ürünün güncel alış fiyatı. Trendyol satış tutarı API'den gelmez; hakediş gelir olarak elle girilir.
 * - İade edilen sipariş ödendiği aydan düşer (iadenin olduğu aya eksi yazılmaz): geçmiş ay özeti iadeyle değişebilir.
 * - Üretici bakiyesi (pozitif: biz borçluyuz) = devir + alımlar − iadeler − ödemeler + üreticiden tahsilatlar.
 */

const SOLD = sql`('preparing', 'shipped', 'delivered')`;
// Trendyol'da iptal edilmemiş satır adedi trendyol_order_stock.quantity'de; tarih paketin sipariş tarihi
const TRENDYOL_SALES = sql`
  select s.variant_id, s.quantity, s.unit_cost as fixed_cost, s.manufacturer_id as fixed_manufacturer,
    (select min(p.order_date) from trendyol_packages p where p.order_number = s.order_number) as at
  from trendyol_order_stock s
  where s.variant_id is not null and s.quantity > 0
`;

/** Site satış satırları: adet, birim fiyat, maliyet ve üretici (satış anındaki, yoksa güncel). */
const SITE_SALES = sql`
  select oi.quantity, oi.unit_price, o.paid_at as at,
    coalesce(oic.unit_cost, ps.purchase_price) as unit_cost,
    coalesce(oic.manufacturer_id, ps.manufacturer_id) as manufacturer_id
  from order_items oi
  join orders o on o.id = oi.order_id
  left join order_item_costs oic on oic.order_item_id = oi.id
  left join variants v on v.id = oi.variant_id
  left join product_colors c on c.id = v.color_id
  left join product_supply ps on ps.product_id = c.product_id
  where o.status in ${SOLD} and o.paid_at is not null
`;

const TRENDYOL_SALES_COST = sql`
  select t.quantity, t.at, coalesce(t.fixed_cost, ps.purchase_price) as unit_cost,
    coalesce(t.fixed_manufacturer, ps.manufacturer_id) as manufacturer_id
  from (${TRENDYOL_SALES}) t
  join variants v on v.id = t.variant_id
  join product_colors c on c.id = v.color_id
  left join product_supply ps on ps.product_id = c.product_id
`;

const n = (v: unknown) => Number(v ?? 0);

/** "YYYY-MM" ayının ilk ve son günü; geçersizse içinde bulunulan ay. */
export function monthRange(month?: string): { month: string; from: string; to: string } {
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : istanbulDate().slice(0, 7);
  const [y, mm] = m.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { month: m, from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

const inRange = (col: ReturnType<typeof sql>, from: string, to: string) =>
  sql`(${col} at time zone 'Europe/Istanbul')::date between ${from}::date and ${to}::date`;

export type AccountingSummary = Awaited<ReturnType<typeof accountingSummary>>;

/** Dönem özeti (tarihler dahil, İstanbul günü). */
export async function accountingSummary(from: string, to: string) {
  const [site, trendyol, ledger, missing] = await Promise.all([
    db.execute<{ orders: number; revenue: number; shipping: number; pairs: number; cost: number }>(sql`
      select
        (select count(*)::int from orders o where o.status in ${SOLD} and o.paid_at is not null and ${inRange(sql`o.paid_at`, from, to)}) as orders,
        (select coalesce(sum(o.subtotal), 0)::bigint from orders o where o.status in ${SOLD} and o.paid_at is not null and ${inRange(sql`o.paid_at`, from, to)}) as revenue,
        (select coalesce(sum(o.shipping_fee), 0)::bigint from orders o where o.status in ${SOLD} and o.paid_at is not null and ${inRange(sql`o.paid_at`, from, to)}) as shipping,
        coalesce(sum(s.quantity), 0)::int as pairs,
        coalesce(sum(s.quantity * coalesce(s.unit_cost, 0)), 0)::bigint as cost
      from (${SITE_SALES}) s
      where ${inRange(sql`s.at`, from, to)}
    `),
    db.execute<{ pairs: number; cost: number }>(sql`
      select coalesce(sum(t.quantity), 0)::int as pairs, coalesce(sum(t.quantity * coalesce(t.unit_cost, 0)), 0)::bigint as cost
      from (${TRENDYOL_SALES_COST}) t
      where t.at is not null and ${inRange(sql`t.at`, from, to)}
    `),
    db.execute<{ kind: "income" | "expense"; category: string; total: number; entries: number }>(sql`
      select kind, category, sum(amount)::bigint as total, count(*)::int as entries
      from ledger_entries
      where date between ${from}::date and ${to}::date
      group by kind, category
      order by kind, total desc
    `),
    db.execute<{ pairs: number }>(sql`
      select (
        (select coalesce(sum(quantity), 0) from (${SITE_SALES}) s where s.unit_cost is null and ${inRange(sql`s.at`, from, to)}) +
        (select coalesce(sum(quantity), 0) from (${TRENDYOL_SALES_COST}) t where t.unit_cost is null and t.at is not null and ${inRange(sql`t.at`, from, to)})
      )::int as pairs
    `),
  ]);
  const s = site.rows[0]!;
  const t = trendyol.rows[0]!;
  const categories = ledger.rows.map((r) => ({
    kind: r.kind,
    category: r.category,
    label: CATEGORY_LABELS[r.category] ?? r.category,
    total: n(r.total),
    entries: n(r.entries),
  }));
  const isManufacturer = (c: string) => c === "manufacturer_payment" || c === "manufacturer_refund";
  const otherIncome = categories.filter((c) => c.kind === "income" && !isManufacturer(c.category)).reduce((a, c) => a + c.total, 0);
  const expenses = categories.filter((c) => c.kind === "expense" && !isManufacturer(c.category)).reduce((a, c) => a + c.total, 0);
  const manufacturerPayments = categories.find((c) => c.category === "manufacturer_payment")?.total ?? 0;
  const manufacturerRefunds = categories.find((c) => c.category === "manufacturer_refund")?.total ?? 0;
  const siteRevenue = n(s.revenue);
  const shippingRevenue = n(s.shipping);
  const cost = n(s.cost) + n(t.cost);
  const grossProfit = siteRevenue + shippingRevenue + otherIncome - cost;
  return {
    from,
    to,
    siteOrders: n(s.orders),
    sitePairs: n(s.pairs),
    siteRevenue,
    shippingRevenue,
    siteCost: n(s.cost),
    trendyolPairs: n(t.pairs),
    trendyolCost: n(t.cost),
    cost,
    otherIncome,
    grossProfit,
    expenses,
    net: grossProfit - expenses,
    manufacturerPayments,
    manufacturerRefunds,
    categories: categories.filter((c) => !isManufacturer(c.category)),
    pairsWithoutCost: n(missing.rows[0]?.pairs),
  };
}

export type ManufacturerBalance = {
  id: string;
  name: string;
  active: boolean;
  openingBalance: number;
  purchased: number;
  returned: number;
  paid: number;
  refunded: number;
  balance: number;
  soldCost: number;
  /** Satılan ürünlerin maliyetine göre kalan: devir + satılan maliyet − ödenen + tahsil edilen */
  dueBySales: number;
  products: number;
};

/** Üreticilerin cari durumu (bugün itibarıyla). */
export async function manufacturerBalances(onlyId?: string): Promise<ManufacturerBalance[]> {
  const filter = onlyId ? sql`where m.id = ${parseManufacturerId(onlyId)}` : sql``;
  const result = await db.execute<Record<string, unknown>>(sql`
    with sold as (
      select manufacturer_id, sum(quantity * coalesce(unit_cost, 0)) as cost from (
        select quantity, unit_cost, manufacturer_id from (${SITE_SALES}) s
        union all
        select quantity, unit_cost, manufacturer_id from (${TRENDYOL_SALES_COST}) t
      ) x where manufacturer_id is not null group by manufacturer_id
    )
    select m.id, m.name, m.active, m.opening_balance,
      coalesce((select sum(total) from purchases p where p.manufacturer_id = m.id and p.kind = 'purchase'), 0)::bigint as purchased,
      coalesce((select sum(total) from purchases p where p.manufacturer_id = m.id and p.kind = 'return'), 0)::bigint as returned,
      coalesce((select sum(amount) from ledger_entries l where l.manufacturer_id = m.id and l.category = 'manufacturer_payment'), 0)::bigint as paid,
      coalesce((select sum(amount) from ledger_entries l where l.manufacturer_id = m.id and l.category = 'manufacturer_refund'), 0)::bigint as refunded,
      coalesce((select cost from sold where sold.manufacturer_id = m.id), 0)::bigint as sold_cost,
      (select count(*) from product_supply ps where ps.manufacturer_id = m.id)::int as products
    from manufacturers m
    ${filter}
    order by m.active desc, lower(m.name)
  `);
  return result.rows.map((r) => {
    const opening = n(r.opening_balance);
    const purchased = n(r.purchased);
    const returned = n(r.returned);
    const paid = n(r.paid);
    const refunded = n(r.refunded);
    const soldCost = n(r.sold_cost);
    return {
      id: String(r.id),
      name: String(r.name),
      active: Boolean(r.active),
      openingBalance: opening,
      purchased,
      returned,
      paid,
      refunded,
      balance: opening + purchased - returned - paid + refunded,
      soldCost,
      dueBySales: opening + soldCost - paid + refunded,
      products: n(r.products),
    };
  });
}

export type StatementRow = {
  date: string;
  kind: "opening" | PurchaseKind | "payment" | "refund";
  label: string;
  href?: string;
  /** Borcumuzu artıran (+) ya da azaltan (−) tutar */
  amount: number;
  balance: number;
  note?: string;
};

/** Üretici cari ekstresi: tarih sırasıyla, yürüyen bakiyeli. */
export async function manufacturerStatement(id: string): Promise<StatementRow[]> {
  const manufacturerId = parseManufacturerId(id);
  const result = await db.execute<{ date: string; kind: string; ref: number | null; id: string; amount: number; note: string; created: Date; method: string | null }>(sql`
    select to_char(date, 'YYYY-MM-DD') as date, kind::text as kind, number as ref, id::text as id, total as amount, note, created_at as created, null as method
    from purchases where manufacturer_id = ${manufacturerId}
    union all
    select to_char(date, 'YYYY-MM-DD'), case when category = 'manufacturer_payment' then 'payment' else 'refund' end, null, id::text, amount, description, created_at, method
    from ledger_entries where manufacturer_id = ${manufacturerId}
    order by 1, 7
  `);
  const [m] = (
    await db.execute<{ opening: number; created: Date }>(sql`
      select opening_balance as opening, created_at as created from manufacturers where id = ${manufacturerId}
    `)
  ).rows;
  if (!m) return [];
  let balance = n(m.opening);
  const rows: StatementRow[] = [
    { date: istanbulDate(new Date(m.created)), kind: "opening", label: "Devir bakiyesi", amount: balance, balance },
  ];
  for (const r of result.rows) {
    const kind = r.kind as StatementRow["kind"];
    const sign = kind === "purchase" || kind === "refund" ? 1 : -1;
    const amount = sign * n(r.amount);
    balance += amount;
    const label =
      kind === "purchase" || kind === "return"
        ? `${kind === "purchase" ? "Alış fişi" : "İade fişi"} ${purchaseRef(Number(r.ref), kind)}`
        : kind === "payment"
          ? "Ödeme"
          : "Üreticiden tahsilat";
    rows.push({
      date: r.date,
      kind,
      label,
      href: kind === "purchase" || kind === "return" ? `/yonetim/muhasebe/fisler/${r.id}` : undefined,
      amount,
      balance,
      note: r.note || undefined,
    });
  }
  return rows;
}

export type ManufacturerProductRow = {
  id: string;
  name: string;
  status: string;
  purchasePrice: number | null;
  received: number;
  returned: number;
  soldSite: number;
  soldTrendyol: number;
  stock: number;
};

/** Üreticinin ürünleri: alınan, iade edilen, satılan ve stoktaki adetler. */
export async function manufacturerProducts(id: string): Promise<ManufacturerProductRow[]> {
  const manufacturerId = parseManufacturerId(id);
  const result = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.name, p.status, ps.purchase_price,
      coalesce((select sum(pi.quantity) from purchase_items pi join purchases pu on pu.id = pi.purchase_id
        where pi.product_id = p.id and pu.kind = 'purchase'), 0)::int as received,
      coalesce((select sum(pi.quantity) from purchase_items pi join purchases pu on pu.id = pi.purchase_id
        where pi.product_id = p.id and pu.kind = 'return'), 0)::int as returned,
      coalesce((select sum(oi.quantity) from order_items oi join orders o on o.id = oi.order_id
        join variants v on v.id = oi.variant_id join product_colors c on c.id = v.color_id
        where c.product_id = p.id and o.status in ${SOLD} and o.paid_at is not null), 0)::int as sold_site,
      coalesce((select sum(s.quantity) from trendyol_order_stock s
        join variants v on v.id = s.variant_id join product_colors c on c.id = v.color_id
        where c.product_id = p.id), 0)::int as sold_trendyol,
      coalesce((select sum(v.stock) from variants v join product_colors c on c.id = v.color_id where c.product_id = p.id), 0)::int as stock
    from product_supply ps
    join products p on p.id = ps.product_id
    where ps.manufacturer_id = ${manufacturerId}
    order by lower(p.name)
  `);
  return result.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status),
    purchasePrice: r.purchase_price === null ? null : n(r.purchase_price),
    received: n(r.received),
    returned: n(r.returned),
    soldSite: n(r.sold_site),
    soldTrendyol: n(r.sold_trendyol),
    stock: n(r.stock),
  }));
}

/** Stoğun alış değeri ve alış fiyatı/üreticisi eksik ürün sayıları. */
export async function inventoryValue() {
  const result = await db.execute<{ value: number; pairs: number; no_cost: number; no_manufacturer: number }>(sql`
    select
      coalesce(sum(v.stock * coalesce(ps.purchase_price, 0)), 0)::bigint as value,
      coalesce(sum(v.stock), 0)::int as pairs,
      (select count(*) from products p left join product_supply s on s.product_id = p.id
        where p.status <> 'archived' and s.purchase_price is null)::int as no_cost,
      (select count(*) from products p left join product_supply s on s.product_id = p.id
        where p.status <> 'archived' and s.manufacturer_id is null)::int as no_manufacturer
    from variants v
    join product_colors c on c.id = v.color_id
    left join product_supply ps on ps.product_id = c.product_id
  `);
  const r = result.rows[0]!;
  return { value: n(r.value), pairs: n(r.pairs), productsWithoutCost: n(r.no_cost), productsWithoutManufacturer: n(r.no_manufacturer) };
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// ---------- Dışa aktarma (muhasebeci için CSV) ----------

/** Dönemdeki gelir-gider kayıtları, tarih sırasıyla (sayfalama yok). */
export async function ledgerForExport(from: string, to: string) {
  const result = await db.execute<{
    date: string;
    kind: "income" | "expense";
    category: string;
    amount: number;
    method: string;
    description: string;
    manufacturer: string | null;
  }>(sql`
    select to_char(l.date, 'YYYY-MM-DD') as date, l.kind, l.category, l.amount, l.method, l.description, m.name as manufacturer
    from ledger_entries l
    left join manufacturers m on m.id = l.manufacturer_id
    where l.date between ${from}::date and ${to}::date
    order by l.date, l.created_at
  `);
  return result.rows.map((r) => ({ ...r, amount: n(r.amount) }));
}

/** Dönemdeki alış ve iade fişlerinin satırları. */
export async function purchaseLinesForExport(from: string, to: string) {
  const result = await db.execute<{
    date: string;
    number: number;
    kind: PurchaseKind;
    manufacturer: string;
    product_name: string;
    color_name: string;
    size: string;
    production_barcode: string;
    quantity: number;
    unit_cost: number;
  }>(sql`
    select to_char(p.date, 'YYYY-MM-DD') as date, p.number, p.kind, m.name as manufacturer,
      i.product_name, i.color_name, i.size, i.production_barcode, i.quantity, i.unit_cost
    from purchases p
    join manufacturers m on m.id = p.manufacturer_id
    join purchase_items i on i.purchase_id = p.id
    where p.date between ${from}::date and ${to}::date
    order by p.date, p.number, i.product_name, i.color_name, i.size
  `);
  return result.rows.map((r) => ({ ...r, number: n(r.number), quantity: n(r.quantity), unit_cost: n(r.unit_cost) }));
}
