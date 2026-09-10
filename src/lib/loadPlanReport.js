import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import LoadPlanReportTemplate from '../components/LoadPlanReportTemplate';

const PAGE_WIDTH_PX = 794; // A4 ב-96dpi

/**
 * ייצוא "מה להעמיס היום" ל-PDF, להורדה מקומית (לא מועלה ל-Storage —
 * זה מסמך תפעולי חד-פעמי לבוקר, לא רשומה שצריך לשמור בהיסטוריה, בניגוד
 * ל-service_reports). אותה שיטת רינדור-אמיתי+html2canvas כמו
 * createServiceReport ב-serviceReport.js (עברית/RTL תקינים בלי הטמעת
 * פונט ידנית ב-jsPDF), אבל מומשה כאן בנפרד ולא כשיתוף-קוד עם אותו קובץ
 * — serviceReport.js כבר בשימוש חי בשטח בכל סיום ביקור ולא כדאי לגעת
 * בו כדי להוסיף פיצ'ר נפרד שרץ רק כשמנהל/טכנאי לוחץ "ייצוא ל-PDF".
 *
 * הספריות (html2canvas/jsPDF, ~500KB) נטענות דינמית באותו טעם כמו שם —
 * לא לנפח את ה-bundle הראשי בשביל פעולה שלא כל טעינת מסך צריכה.
 */
export async function exportLoadPlanPdf(reportData) {
  const [{ default: html2canvas }] = await Promise.all([
    import('html2canvas'),
    document.fonts?.ready ?? Promise.resolve(),
  ]);

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;top:0;left:-9999px;width:${PAGE_WIDTH_PX}px;`;
  document.body.appendChild(container);

  const root = createRoot(container);
  let canvas;
  try {
    await new Promise((resolve) => {
      root.render(createElement(LoadPlanReportTemplate, { generatedAt: new Date().toISOString(), ...reportData }));
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    canvas = await html2canvas(container, { scale: 2, backgroundColor: '#FFFFFF', useCORS: true });
  } finally {
    root.unmount();
    container.remove();
  }

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
    // רשימת "מכשירים חדשים" יכולה להיות ארוכה (למשל "כל הקווים" ביחד) —
    // פורס לכמה עמודי A4 בדיוק כמו ב-serviceReport.js.
    let renderedHeight = 0;
    while (renderedHeight < imgHeight) {
      if (renderedHeight > 0) doc.addPage();
      doc.addImage(imgData, 'JPEG', 0, -renderedHeight, imgWidth, imgHeight);
      renderedHeight += pageHeight;
    }
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeRouteLabel = String(reportData.routeLabel ?? 'קו').replace(/[^\p{L}\p{N}]+/gu, '-');
  doc.save(`העמסה-${safeRouteLabel}-${dateStamp}.pdf`);
}
