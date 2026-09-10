import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  SummaryPage, ScentTablePage, DeviceTablePage, PAGE_W, PAGE_H, ROWS_PER_PAGE, SCENT_EMBED_THRESHOLD,
} from '../components/LoadPlanReportTemplate';

/**
 * ייצוא "מה להעמיס היום" ל-PDF, להורדה מקומית — לא מועלה ל-Storage,
 * ר' ההערה המקורית ב-createServiceReport (serviceReport.js) על מסמך
 * תפעולי חד-פעמי מול רשומה שצריך לשמור בהיסטוריה.
 *
 * 2026-09-11 (redesign אחרי משוב "נמרח על עשרות דפים"): כל עמוד PDF
 * מגיע מתמונת-canvas נפרדת בגודל A4 מדויק (PAGE_W×PAGE_H, ר'
 * LoadPlanReportTemplate.jsx) — לא מתמונה ענקית אחת שנחתכת לפי גובה
 * גולמי. הנתונים נפרסים לעמודים *לפני* הרינדור (chunk לפי
 * ROWS_PER_PAGE), אז אף עמוד לא יכול "להיחתך" באמצע שורה — הוא פשוט
 * מכיל מראש רק את השורות ששייכות אליו.
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function renderPageToCanvas(html2canvas, element) {
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;top:0;left:-9999px;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;`;
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await new Promise((resolve) => {
      root.render(element);
      // שני requestAnimationFrame — מוודא שהעימוד (layout) של React כבר
      // התבצע בפועל בדפדפן, לא רק ש-render() הוחזר.
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return await html2canvas(container, {
      scale: 2, backgroundColor: '#FFFFFF', useCORS: true, width: PAGE_W, height: PAGE_H,
    });
  } finally {
    root.unmount();
    container.remove();
  }
}

export async function exportLoadPlanPdf(reportData) {
  const [{ default: html2canvas }] = await Promise.all([
    import('html2canvas'),
    document.fonts?.ready ?? Promise.resolve(),
  ]);
  const { jsPDF } = await import('jspdf');

  const deviceRows = reportData.deviceRows ?? [];
  const items = reportData.items ?? [];
  const deviceChunks = chunk(deviceRows, ROWS_PER_PAGE);
  // רשימת ניחוחים ארוכה (למשל "כל הקווים") מקבלת עמוד/ים ייעודיים במקום
  // להידחס לצד קוביית הסיכום — ר' SCENT_EMBED_THRESHOLD ב-Template.
  const embedScentTable = items.length <= SCENT_EMBED_THRESHOLD;
  const scentChunks = embedScentTable ? [] : chunk(items, ROWS_PER_PAGE);
  const totalPages = 1 + scentChunks.length + deviceChunks.length;
  const customerCount = new Set(deviceRows.map((r) => r.customer_id ?? r.customer_name)).size;
  const generatedAt = new Date().toISOString();

  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageWidthPt = doc.internal.pageSize.getWidth();
  const pageHeightPt = doc.internal.pageSize.getHeight();

  const summaryCanvas = await renderPageToCanvas(
    html2canvas,
    createElement(SummaryPage, { ...reportData, customerCount, totalPages, generatedAt, embedScentTable })
  );
  doc.addImage(summaryCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidthPt, pageHeightPt);

  let pageNumber = 2;
  for (let i = 0; i < scentChunks.length; i += 1) {
    doc.addPage();
    // eslint-disable-next-line no-await-in-loop -- כל עמוד צריך DOM/canvas משלו, לא ניתן להקביל בלי כמה containers בו-זמנית
    const canvas = await renderPageToCanvas(
      html2canvas,
      createElement(ScentTablePage, { routeLabel: reportData.routeLabel, items: scentChunks[i], pageNumber, totalPages })
    );
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidthPt, pageHeightPt);
    pageNumber += 1;
  }

  for (let i = 0; i < deviceChunks.length; i += 1) {
    doc.addPage();
    // eslint-disable-next-line no-await-in-loop -- כל עמוד צריך DOM/canvas משלו, לא ניתן להקביל בלי כמה containers בו-זמנית
    const canvas = await renderPageToCanvas(
      html2canvas,
      createElement(DeviceTablePage, {
        routeLabel: reportData.routeLabel,
        rows: deviceChunks[i],
        pageNumber,
        totalPages,
        showRouteColumn: reportData.showRouteColumn,
      })
    );
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidthPt, pageHeightPt);
    pageNumber += 1;
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeRouteLabel = String(reportData.routeLabel ?? 'קו').replace(/[^\p{L}\p{N}]+/gu, '-');
  doc.save(`העמסה-${safeRouteLabel}-${dateStamp}.pdf`);
}
