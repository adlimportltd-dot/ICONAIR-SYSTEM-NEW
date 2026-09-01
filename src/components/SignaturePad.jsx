import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

/**
 * לוח חתימה בעכבר/מגע, קנבס גולמי — בלי תלות חיצונית. ref חושף
 * getDataUrl()/clear()/isEmpty() כדי שהמסך שמכיל אותו (SignContractScreen)
 * ישלוט מתי לקרוא את התוצאה, בלי לגרור state של תמונה על כל stroke.
 *
 * devicePixelRatio: בלי זה חתימה במסך רטינה יוצאת מטושטשת — מציירים
 * ברזולוציה הפיזית של המסך ומכווצים בחזרה ב-CSS.
 */
const SignaturePad = forwardRef(function SignaturePad({ height = 160 }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const empty = useRef(true);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  function pointFromEvent(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(event) {
    event.preventDefault();
    drawing.current = true;
    last.current = pointFromEvent(event);
  }

  function move(event) {
    if (!drawing.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const point = pointFromEvent(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    empty.current = false;
  }

  function end() {
    drawing.current = false;
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty.current,
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      empty.current = true;
    },
    getDataUrl: () => canvasRef.current.toDataURL('image/png'),
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{ height, touchAction: 'none' }}
      className="w-full cursor-crosshair rounded-lg border border-[#ccc] bg-white"
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
});

export default SignaturePad;
