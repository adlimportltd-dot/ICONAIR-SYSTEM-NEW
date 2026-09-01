import { COMPANY, CONTRACT_SECTIONS, money, totalMonthly } from '../lib/contractTemplate';

/**
 * תצוגת ההסכם בתוך האפליקציה — נייר לבן ומכובד, לא הזכוכית הכהה של
 * שאר המערכת (זה מסמך משפטי לצפייה/חתימה, לא מסך ניהול). בשימוש גם
 * בתצוגה המקדימה למנהל (GenerateContractModal) וגם בעמוד החתימה
 * הציבורי (SignContractScreen) — כדי שהלקוח יראה בדיוק את מה שהמנהל ראה.
 */
export default function ContractDocument({ customer, idNumber, items = [], contractDate }) {
  const rows = items.filter((row) => Number(row.quantity) > 0);

  return (
    <div dir="rtl" className="rounded-xl bg-white p-6 text-[13.5px] leading-relaxed text-[#1a1a1a] sm:p-9" style={{ colorScheme: 'light' }}>
      <div className="mb-4 flex items-baseline justify-between border-b-2 border-[#1a1a1a] pb-3.5">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-wide">ICON AIR</h1>
          <div className="text-[11px] text-[#666]">פתרונות ריח מתקדמים</div>
        </div>
        <div className="text-end text-[11px] leading-snug text-[#555]">
          <div>{COMPANY.name} · ח.פ. {COMPANY.regNumber}</div>
          <div>{COMPANY.address}</div>
          <div>{COMPANY.email} · {COMPANY.phone}</div>
        </div>
      </div>

      <div className="mb-5 text-center text-[18px] font-bold">הסכם התקשרות לשירותי בישום עסקי</div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1 rounded-lg border border-[#ddd] p-3.5">
          <b className="mb-1.5 block text-[13px]">הלקוח</b>
          <div>{customer?.name}</div>
          {idNumber && <div>ת.ז./ח.פ.: {idNumber}</div>}
          {customer?.address && <div>{customer.address}{customer?.city ? ` · ${customer.city}` : ''}</div>}
          {customer?.phone && <div>טלפון: {customer.phone}</div>}
          {customer?.email && <div>דוא״ל: {customer.email}</div>}
        </div>
        <div className="flex-1 rounded-lg border border-[#ddd] p-3.5">
          <b className="mb-1.5 block text-[13px]">החברה</b>
          <div>{COMPANY.name}</div>
          <div>ח.פ. {COMPANY.regNumber}</div>
          <div>{COMPANY.address}</div>
          <div>{COMPANY.email} · {COMPANY.phone}</div>
        </div>
      </div>

      <p className="mb-5 text-[12px] text-[#555]">נחתם ביום {contractDate}, בין הצדדים דלעיל.</p>

      {CONTRACT_SECTIONS.map((section) => (
        <section key={section.num} className="mb-4">
          <h2 className="mb-1.5 text-[14px] font-bold">{section.num}. {section.title}</h2>
          {section.clauses.map((clause, i) => <p key={i} className="mb-1.5">{clause}</p>)}
        </section>
      ))}

      <div className="mt-7 border-t border-[#ddd] pt-5 text-[15px] font-bold">נספח א׳ — פירוט מערכות ותשלום חודשי</div>

      <div className="overflow-x-auto">
        <table className="mt-2.5 w-full min-w-[420px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              {['דגם', 'כמות', 'מחיר חודשי ליחידה', 'סה״כ לחודש'].map((h) => (
                <th key={h} className="border border-[#ccc] bg-[#f0f0f0] px-2.5 py-1.5 text-start">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="border border-[#ccc] px-2.5 py-2 text-[#999]">לא הוזנו מערכות</td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="border border-[#ccc] px-2.5 py-1.5">{row.model}</td>
                <td className="border border-[#ccc] px-2.5 py-1.5">{row.quantity}</td>
                <td className="border border-[#ccc] px-2.5 py-1.5">{money(row.monthlyPrice)}</td>
                <td className="border border-[#ccc] px-2.5 py-1.5">{money(row.quantity * row.monthlyPrice)}</td>
              </tr>
            ))}
            <tr className="bg-[#fafafa] font-bold">
              <td colSpan={3} className="border border-[#ccc] px-2.5 py-1.5">סה״כ תשלום חודשי (לפני מע״מ)</td>
              <td className="border border-[#ccc] px-2.5 py-1.5">{money(totalMonthly(items))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
