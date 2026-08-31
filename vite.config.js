import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // ברירת המחדל היא 5173, אבל אם PORT מוגדר בסביבה משתמשים בו —
    // כך אפשר להריץ כמה מופעים במקביל בלי התנגשות פורטים
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
