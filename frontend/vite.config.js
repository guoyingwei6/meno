import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const preserveRocketLoaderOptOut = {
    name: 'preserve-rocket-loader-opt-out',
    transformIndexHtml: {
        order: 'post',
        handler(html) {
            return html.replace(
                /<script type="module" crossorigin src="([^"]+)"><\/script>/,
                '<script data-cfasync="false" type="module" crossorigin src="$1"></script>',
            );
        },
    },
};

export default defineConfig({
    plugins: [
        react(),
        preserveRocketLoaderOptOut,
        VitePWA({
            registerType: 'autoUpdate',
            includeManifestIcons: false,
            manifest: {
                name: 'Meno',
                short_name: 'Meno',
                description: 'Meno：自托管的极简 Memo 笔记应用。',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                background_color: '#f7f7f7',
                theme_color: '#f7f7f7',
                lang: 'zh-CN',
                categories: ['productivity', 'utilities'],
                icons: [
                    {
                        src: '/pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: '/pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: '/maskable-icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
                        handler: 'NetworkOnly',
                    },
                ],
            },
        }),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts',
    },
    server: {
        proxy: {
            '/api': 'http://127.0.0.1:8787',
        },
    },
});
