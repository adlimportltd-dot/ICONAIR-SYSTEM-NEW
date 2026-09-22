import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import QuoteDocumentTemplate from '../components/QuoteDocumentTemplate';
import { supabase } from './supabase';
import { computeVat } from './mappers';

const PAGE_WIDTH_PX = 794; // A4 ב-96dpi

/**
 * אותו דפוס בדיוק כמו renderToCanvas ב-serviceReport.js: מרנדר את
 * התבנית ל-DOM אמיתי מחוץ למסך (לא display:none — html2canvas לא יודע
 * ללכוד אלמנט לא-מרונדר), מחכה לפונטים, ולוכד ל-canvas. ספריות נטענות
 * דינמית כדי לא לנפח את ה-bundle הראשי בשביל תכונה שמנהל מפעיל מדי פעם.
 */
async function renderToCanvas(quoteData) {
  const [{ default: html2canvas }] = await Promise.all([
    import('html2canvas'),
    document.fonts?.ready ?? Promise.resolve(),
  ]);

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;top:0;left:-9999px;width:${PAGE_WIDTH_PX}px;`;
  document.body.appendChild(container);

  const root = createRoot(container);
  await new Promise((resolve) => {
    root.render(createElement(QuoteDocumentTemplate, quoteData));
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  try {
    return await html2canvas(container, { scale: 2, backgroundColor: '#FFFFFF', useCORS: true });
  } finally {
    root.unmount();
    container.remove();
  }
}

/** אותו ממיר canvas→PDF בדיוק כמו serviceReport.js (כולל פריסה לכמה עמודים אם תוכן ארוך מ-A4 אחד). */
async function canvasToPdfBlob(canvas) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  if (imgHeight <= pageHeight) {
    doc.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
  } else {
    let renderedHeight = 0;
    while (renderedHeight < imgHeight) {
      if (renderedHeight > 0) doc.addPage();
      doc.addImage(imgData, 'JPEG', 0, -renderedHeight, imgWidth, imgHeight);
      renderedHeight += pageHeight;
    }
  }

  return doc.output('blob');
}

/**
 * מפיק PDF להצעת מחיר, מעלה ל-Storage (bucket lead-quotes), ורושם
 * שורה ב-lead_quotes — 2026-09-22, בקשה מפורשת: "מודול הפקת הצעות
 * מחיר... שליחה מהירה... מתוך כרטיס הליד". items: [{model, quantity,
 * unitPrice}]. subtotal/vat/total נשמרים כ"תמונת מצב" (לא מחושבים
 * מחדש מ-items בכל שליפה) כדי שהצעה שכבר נשלחה לא תשתנה בדיעבד.
 */
export async function createLeadQuote({ leadId, leadName, leadCity, leadPhone, items, userId }) {
  const quoteId = crypto.randomUUID();
  const quoteDate = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const canvas = await renderToCanvas({ leadName, leadCity, leadPhone, items, quoteDate, quoteNumber: quoteId });
  const blob = await canvasToPdfBlob(canvas);

  const filePath = `${userId}/${quoteId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('lead-quotes')
    .upload(filePath, blob, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;

  const subtotal = items.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unitPrice), 0);
  const { vatAmount, total } = computeVat(subtotal, 'excluded');

  const { data: row, error: insertError } = await supabase
    .from('lead_quotes')
    .insert({
      id: quoteId,
      lead_id: leadId,
      created_by: userId,
      lead_name: leadName,
      items,
      subtotal,
      vat_amount: vatAmount,
      total,
      file_path: filePath,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const { data: urlData } = supabase.storage.from('lead-quotes').getPublicUrl(filePath);
  return { ...row, file_url: urlData.publicUrl };
}
