import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react(), preserveRocketLoaderOptOut],
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
