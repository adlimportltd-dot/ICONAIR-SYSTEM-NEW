import { useState } from 'react';
import { Pills } from './SocialUI';

/**
 * תצוגה מקדימה חיה של הפוסט — איך הוא ייראה בפיד. סכמטית ונקייה (לא
 * העתק של ממשק Meta), רק כדי לראות חיתוך טקסט, סדר תמונות וקרוסלה.
 */
export default function PostPreview({ caption, media = [], link, pageName, pagePicture, igUsername, platforms }) {
  const initial = platforms.instagram && !platforms.facebook ? 'instagram' : 'facebook';
  const [view, setView] = useState(initial);
  const [slide, setSlide] = useState(0);
  const name = view === 'instagram' ? (igUsername || 'iconair') : (pageName || 'ICONAIR');
  const shown = view === 'instagram' ? media.slice(0, 10) : media.slice(0, 4);
  const current = Math.min(slide, Math.max(0, shown.length - 1));
  const long = (caption || '').length > 180;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-bold text-text-dim">תצוגה מקדימה</span>
        <Pills
          size="sm"
          value={view}
          onChange={(v) => { setView(v); setSlide(0); }}
          options={[{ value: 'facebook', label: 'פייסבוק' }, { value: 'instagram', label: 'אינסטגרם' }]}
        />
      </div>

      <div className="overflow-hidden rounded-row border border-[#E2E8F0] bg-white shadow-lift">
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          {pagePicture ? (
            <img src={pagePicture} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full border border-gold-300/[0.35] bg-gold-500/[0.14] text-[13px] font-bold text-gold-600">IA</div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-bold" dir={view === 'instagram' ? 'ltr' : undefined}>{name}</div>
            <div className="text-[12.5px] text-text-faint">{view === 'instagram' ? 'ממומן / אורגני' : 'עכשיו · ציבורי'}</div>
          </div>
        </div>

        {view === 'facebook' && caption && (
          <p className="whitespace-pre-wrap px-3.5 pb-3 text-[14.5px] leading-relaxed">
            {long ? `${caption.slice(0, 180)}… ` : caption}
            {long && <span className="font-semibold text-text-faint">עוד</span>}
          </p>
        )}

        {shown.length > 0 ? (
          view === 'facebook' && shown.length > 1 ? (
            <div className={`grid gap-0.5 ${shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
              {shown.map((src, i) => (
                <img key={src} src={src} alt="" className={`aspect-square w-full object-cover ${shown.length === 3 && i === 0 ? 'col-span-2 aspect-[2/1]' : ''}`} />
              ))}
            </div>
          ) : (
            <div className="relative bg-ink-800">
              <img src={shown[current]} alt="" className="aspect-[4/5] w-full object-cover" />
              {shown.length > 1 && (
                <>
                  <span className="tabular absolute end-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-semibold text-white">
                    {current + 1}/{shown.length}
                  </span>
                  <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
                    {shown.map((src, i) => (
                      <button key={src} type="button" aria-label={`תמונה ${i + 1}`} onClick={() => setSlide(i)}
                        className={`h-1.5 w-1.5 rounded-full ${i === current ? 'bg-white' : 'bg-white/50'}`} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        ) : view === 'instagram' ? (
          <div className="grid aspect-[4/5] place-items-center bg-ink-800 px-6 text-center text-[14px] text-text-faint">
            באינסטגרם חובה לפחות תמונה אחת
          </div>
        ) : link ? (
          <div className="mx-3.5 mb-3 rounded-row border border-[#E2E8F0] bg-ink-800 px-3.5 py-3 text-[13.5px] text-text-dim" dir="ltr">{link}</div>
        ) : null}

        <div className="flex items-center gap-5 border-t border-black/[0.06] px-3.5 py-2.5 text-[13.5px] font-semibold text-text-faint">
          {view === 'facebook' ? <><span>אהבתי</span><span>תגובה</span><span>שיתוף</span></> : <><span>לייק</span><span>תגובה</span><span>שליחה</span><span className="ms-auto">שמירה</span></>}
        </div>

        {view === 'instagram' && caption && (
          <p className="whitespace-pre-wrap px-3.5 pb-3.5 text-[14px] leading-relaxed">
            <span className="font-bold" dir="ltr">{name}</span>{' '}
            {long ? `${caption.slice(0, 125)}… ` : caption}
            {long && <span className="text-text-faint">עוד</span>}
          </p>
        )}
      </div>
    </div>
  );
}
