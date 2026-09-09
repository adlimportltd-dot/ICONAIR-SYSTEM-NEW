import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ServiceReportTemplate from '../components/ServiceReportTemplate';
import { supabase } from './supabase';

const PAGE_WIDTH_PX = 794; // A4 ב-96dpi

/**
 * מרנדר את התבנית ל-DOM אמיתי מחוץ למסך (לא display:none — html2canvas
 * לא יודע ללכוד אלמנט לא-מרונדר), מחכה שהפונטים ייטענו, ולוכד ל-canvas.
 * הספריות נטענות דינמית (import() עצל) כדי לא לנפח את ה-bundle הראשי —
 * טכנאי בשטח על רשת סלולרית לא צריך לטעון html2canvas/jsPDF (~500KB)
 * בכל טעינת אפליקציה, רק ברגע שבאמת מסיימים ביקור.
 */
async function renderToCanvas(reportData) {
  const [{ default: html2canvas }] = await Promise.all([
    import('html2canvas'),
    document.fonts?.ready ?? Promise.resolve(),
  ]);

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;top:0;left:-9999px;width:${PAGE_WIDTH_PX}px;`;
  document.body.appendChild(container);

  const root = createRoot(container);
  await new Promise((resolve) => {
    root.render(createElement(ServiceReportTemplate, reportData));
    // שני requestAnimationFrame — מוודא שהעימוד (layout) של React כבר
    // התבצע בפועל בדפדפן, לא רק ש-render() הוחזר (זה סינכרוני אבל
    // הצביעה בפועל למסך יכולה לקרות בפריים הבא).
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  try {
    const canvas = await html2canvas(container, {
      scale: 2, // רזולוציה גבוהה יותר לקריאות טובה בהדפסה
      backgroundColor: '#FFFFFF',
      useCORS: true,
    });
    return canvas;
  } finally {
    root.unmount();
    container.remove();
  }
}

/** ממיר canvas ל-Blob של PDF עמוד-A4 יחיד, עם התמונה ממורכזת/מותאמת לרוחב. */
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
    // תוכן ארוך מעמוד A4 אחד (למשל הערות טכנאי ארוכות) — פורס לכמה עמודים
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
 * מייצר PDF ומעלה אותו ל-Storage + רושם שורה ב-service_reports.
 *
 * נקודת עיצוב מכוונת: אם משהו כאן נכשל (רשת נפלה בדיוק אחרי סיום
 * הביקור, html2canvas נכשל וכו') — הפעולה העסקית האמיתית (oil_tracking
 * שכבר נשמר, מלאי שכבר נוכה) חייבת להישאר תקפה. לכן זו פונקציה
 * "best effort" נפרדת שהקוראים לה עוטפים ב-try/catch משלהם ולא זורקים
 * הלאה — ר' RoutesScreen.jsx/OilScreen.jsx.
 */
export async function createServiceReport({
  oilTrackingId, deviceId, customerId, technicianId, technicianName,
  customerName, address, phone, customerEmail,
  deviceModel, deviceSerial, scentName,
  eventType, litersAdded, levelBeforePct, levelAfterPct, notes, recordedAt,
}) {
  const canvas = await renderToCanvas({
    customerName, address, phone,
    deviceModel, deviceSerial, scentName,
    eventType, litersAdded, levelBeforePct, levelAfterPct, notes,
    technicianName, recordedAt, reportId: oilTrackingId,
  });
  const blob = await canvasToPdfBlob(canvas);

  const filePath = `${technicianId}/${oilTrackingId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('service-reports')
    .upload(filePath, blob, { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from('service-reports').getPublicUrl(filePath);

  const { data: row, error: insertError } = await supabase
    .from('service_reports')
    .insert({
      oil_tracking_id: oilTrackingId,
      device_id: deviceId,
      customer_id: customerId,
      technician_id: technicianId,
      customer_name: customerName,
      customer_address: address,
      customer_email: customerEmail ?? null,
      device_model: deviceModel,
      device_serial: deviceSerial,
      scent_name: scentName,
      event_type: eventType,
      liters_added: litersAdded,
      level_before_pct: levelBeforePct,
      level_after_pct: levelAfterPct,
      notes,
      technician_name: technicianName,
      file_path: filePath,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  return { ...row, file_url: urlData.publicUrl };
}

/**
 * עטיפה נוחה לנקודות הקריאה ב-UI (RoutesScreen/OilScreen): ממפה את
 * הצורה הגולמית (שורת oil_tracking שחזרה מ-completeVisit/createOilEntry
 * + אובייקטי device/customer שכבר קיימים אצל הקורא) לפרמטרים של
 * createServiceReport, ומריצה "ירה ושכח" — לא await-ים אותה בקומפוננטה
 * כי הטכנאי לא צריך לחכות 1-2 שניות ליצירת ה-PDF כדי שהמודל ייסגר.
 * כשל כאן רק נרשם ל-console; לעולם לא הופך לשגיאה למשתמש ולא מבטל
 * את הביקור שכבר נשמר בהצלחה.
 */
export function generateReportSafely({ saved, device, customer, technicianId, technicianName }) {
  if (!saved || saved.__queued || !technicianId) return;

  createServiceReport({
    oilTrackingId: saved.id,
    deviceId: device?.id ?? saved.device_id,
    customerId: customer?.customer_id ?? customer?.id ?? null,
    technicianId,
    technicianName,
    customerName: customer?.name ?? 'לקוח',
    address: customer?.address ?? null,
    phone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
    deviceModel: device?.model ?? null,
    deviceSerial: device?.serial ?? null,
    scentName: saved.scent_name ?? device?.scent_name ?? null,
    eventType: saved.event_type,
    litersAdded: saved.liters_added,
    levelBeforePct: saved.level_before_pct,
    levelAfterPct: saved.level_after_pct,
    notes: saved.notes ?? null,
    recordedAt: saved.recorded_at ?? new Date().toISOString(),
  }).catch((error) => {
    console.error('יצירת דוח שירות PDF נכשלה (הביקור עצמו כבר נשמר בהצלחה):', error);
  });
}
