import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// HTTPS is required for WebXR on Quest when loading from the LAN IP.
// `npm run dev` → https://<your-mac-LAN-IP>:8443  (accept the self-signed cert once in Quest Browser)
// Alternatively: `adb reverse tcp:8443 tcp:8443` then open https://localhost:8443 on the Quest.
const useEmulator = process.env.MOBIUS_EMULATOR !== '0';
const plainHttp = process.env.MOBIUS_HTTP === '1'; // for `adb reverse` (http://localhost is a secure context)
export default defineConfig({
  base: './',
  server: plainHttp ? { host: true, port: 5173 } : { host: true, port: 8443, strictPort: false, https: true },
  preview: { host: true, port: 8443, https: true },
  plugins: [
    ...(plainHttp ? [] : [basicSsl({ name: 'mobius-dev' })]),
    // IWER WebXR emulator on desktop localhost only (never injected on the Quest)
    ...(useEmulator ? [iwsdkDev({ emulator: { device: 'metaQuest3', activation: 'localhost' }, workspace: { enabled: false }, verbose: false })] : []),
  ],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000 },
});
