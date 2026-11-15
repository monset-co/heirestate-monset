// The month's rows for Annex B (contract section 4.4): every sale made in the month, and every
// commission received in it. "Sale no. in Season" and "Fee due" are left blank to fill in by hand.
export function annexB(rows, month) {
  const inMonth = (d) => !!d?.startsWith(month);
  return rows
    .filter((c) => !c.cancelled && (inMonth(c.sale_date) || inMonth(c.received_on)))
    .map((c) => ({ ...c, paid: inMonth(c.received_on) }))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.id - b.id);
}
