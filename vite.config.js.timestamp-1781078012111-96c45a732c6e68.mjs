// vite.config.js
import { defineConfig } from "file:///D:/Minxue_App_V3/node_modules/vite/dist/node/index.js";
import react from "file:///D:/Minxue_App_V3/node_modules/@vitejs/plugin-react/dist/index.js";
import vue from "file:///D:/Minxue_App_V3/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { VitePWA } from "file:///D:/Minxue_App_V3/node_modules/vite-plugin-pwa/dist/index.js";
import tailwindcss from "file:///D:/Minxue_App_V3/node_modules/@tailwindcss/vite/dist/index.mjs";
import { resolve } from "path";
import fs from "fs";
var __vite_injected_original_dirname = "D:\\Minxue_App_V3";
var vite_config_default = defineConfig(({ mode }) => ({
  plugins: [
    react(),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      manifest: {
        name: "\u654F\u5B66\u9519\u9898\u672C",
        short_name: "\u654F\u5B66",
        description: "\u665A\u6258\u73ED\u8001\u5E08\u9519\u9898\u7BA1\u7406\u7CFB\u7EDF",
        theme_color: "#1677ff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icon-512x512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\./,
            handler: "CacheFirst",
            options: {
              cacheName: "oss-cdn-cache",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src"),
      "@workbench": resolve(__vite_injected_original_dirname, "src/workbench")
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__vite_injected_original_dirname, "index.html"),
        workbench: resolve(__vite_injected_original_dirname, "workbench.html")
      },
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/vue/") || id.includes("node_modules/@vue/") || id.includes("node_modules/pinia/") || id.includes("node_modules/vue-router/")) {
            return "vue-core";
          }
          if (id.includes("node_modules/element-plus/")) {
            return "element-plus";
          }
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) {
            return "react-core";
          }
          if (id.includes("node_modules/motion/") || id.includes("node_modules/framer-motion/")) {
            return "motion";
          }
          if (id.includes("node_modules/lucide-react/")) {
            return "lucide-icons";
          }
          if (id.includes("node_modules/jspdf/") || id.includes("node_modules/html2canvas/") || id.includes("node_modules/rgbcolor/") || id.includes("node_modules/fflate/")) {
            return "pdf-generator";
          }
          if (id.includes("node_modules/qrcode.react/") || id.includes("node_modules/qrcode-generator/")) {
            return "qr-code";
          }
          if (id.includes("node_modules/antd-mobile/") || id.includes("node_modules/@rc-component/")) {
            return "antd-mobile";
          }
          if (id.includes("node_modules/dayjs/") || id.includes("node_modules/axios/") || id.includes("node_modules/zustand/")) {
            return "vendor-utils";
          }
          return null;
        },
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js"
      }
    },
    cssCodeSplit: true,
    target: "es2020",
    chunkSizeWarningLimit: 500
  },
  server: {
    port: 3e3,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    },
    // Dev server: serve workbench.html for /exam-workbench route
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/exam-workbench" || req.url.startsWith("/exam-workbench/")) {
          const html = fs.readFileSync(resolve(__vite_injected_original_dirname, "workbench.html"), "utf-8");
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        }
        next();
      });
    }
  },
  preview: {
    port: 4173,
    host: true
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxNaW54dWVfQXBwX1YzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxNaW54dWVfQXBwX1YzXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9NaW54dWVfQXBwX1YzL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJ1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSdcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJ1xuaW1wb3J0IGZzIGZyb20gJ2ZzJ1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiAoe1xuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICB2dWUoKSxcbiAgICB0YWlsd2luZGNzcygpLFxuICAgIFZpdGVQV0Eoe1xuICAgICAgcmVnaXN0ZXJUeXBlOiAncHJvbXB0JyxcbiAgICAgIHN0cmF0ZWdpZXM6ICdpbmplY3RNYW5pZmVzdCcsXG4gICAgICBzcmNEaXI6ICdzcmMnLFxuICAgICAgZmlsZW5hbWU6ICdzdy5qcycsXG4gICAgICBtYW5pZmVzdDoge1xuICAgICAgICBuYW1lOiAnXHU2NTRGXHU1QjY2XHU5NTE5XHU5ODk4XHU2NzJDJyxcbiAgICAgICAgc2hvcnRfbmFtZTogJ1x1NjU0Rlx1NUI2NicsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnXHU2NjVBXHU2MjU4XHU3M0VEXHU4MDAxXHU1RTA4XHU5NTE5XHU5ODk4XHU3QkExXHU3NDA2XHU3Q0ZCXHU3RURGJyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjMTY3N2ZmJyxcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyNmZmZmZmYnLFxuICAgICAgICBkaXNwbGF5OiAnc3RhbmRhbG9uZScsXG4gICAgICAgIHN0YXJ0X3VybDogJy8nLFxuICAgICAgICBpY29uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNyYzogJy9pY29uLTE5MngxOTIucG5nJyxcbiAgICAgICAgICAgIHNpemVzOiAnMTkyeDE5MicsXG4gICAgICAgICAgICB0eXBlOiAnaW1hZ2UvcG5nJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3JjOiAnL2ljb24tNTEyeDUxMi5wbmcnLFxuICAgICAgICAgICAgc2l6ZXM6ICc1MTJ4NTEyJyxcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZS9wbmcnXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAgd29ya2JveDoge1xuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHBuZyxzdmcsd29mZjJ9J10sXG4gICAgICAgIGNsZWFudXBPdXRkYXRlZENhY2hlczogdHJ1ZSxcbiAgICAgICAgc2tpcFdhaXRpbmc6IHRydWUsXG4gICAgICAgIGNsaWVudHNDbGFpbTogdHJ1ZSxcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2NkblxcLi8sXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ29zcy1jZG4tY2FjaGUnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgbWF4RW50cmllczogMjAwLFxuICAgICAgICAgICAgICAgIG1heEFnZVNlY29uZHM6IDMwICogMjQgKiA2MCAqIDYwXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9cXC4oPzpwbmd8anBnfGpwZWd8d2VicHxzdmcpJC8sXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2ltYWdlLWNhY2hlJyxcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwMCxcbiAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA3ICogMjQgKiA2MCAqIDYwXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9KVxuICBdLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMnKSxcbiAgICAgICdAd29ya2JlbmNoJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvd29ya2JlbmNoJylcbiAgICB9XG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgbWFpbjogcmVzb2x2ZShfX2Rpcm5hbWUsICdpbmRleC5odG1sJyksXG4gICAgICAgIHdvcmtiZW5jaDogcmVzb2x2ZShfX2Rpcm5hbWUsICd3b3JrYmVuY2guaHRtbCcpXG4gICAgICB9LFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIG1hbnVhbENodW5rczogKGlkKSA9PiB7XG4gICAgICAgICAgLy8gVnVlIGZyYW1ld29ya1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL3Z1ZS8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9AdnVlLycpIHx8XG4gICAgICAgICAgICAgIGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvcGluaWEvJykgfHxcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy92dWUtcm91dGVyLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3Z1ZS1jb3JlJ1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9lbGVtZW50LXBsdXMvJykpIHtcbiAgICAgICAgICAgIHJldHVybiAnZWxlbWVudC1wbHVzJ1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBSZWFjdCBmcmFtZXdvcmtcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZWFjdC8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZWFjdC1kb20vJykgfHwgXG4gICAgICAgICAgICAgIGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvc2NoZWR1bGVyLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3JlYWN0LWNvcmUnXG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFVJIGxpYnJhcmllc1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL21vdGlvbi8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9mcmFtZXItbW90aW9uLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ21vdGlvbidcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvbHVjaWRlLXJlYWN0LycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2x1Y2lkZS1pY29ucydcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUERGIGdlbmVyYXRpb25cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9qc3BkZi8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9odG1sMmNhbnZhcy8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZ2Jjb2xvci8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9mZmxhdGUvJykpIHtcbiAgICAgICAgICAgIHJldHVybiAncGRmLWdlbmVyYXRvcidcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUVIgY29kZVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL3FyY29kZS5yZWFjdC8nKSB8fCBcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9xcmNvZGUtZ2VuZXJhdG9yLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3FyLWNvZGUnXG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIC8vIE90aGVyIFVJXG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvYW50ZC1tb2JpbGUvJykgfHwgXG4gICAgICAgICAgICAgIGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvQHJjLWNvbXBvbmVudC8nKSkge1xuICAgICAgICAgICAgcmV0dXJuICdhbnRkLW1vYmlsZSdcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gT3RoZXIgdmVuZG9yXG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvZGF5anMvJykgfHwgXG4gICAgICAgICAgICAgIGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvYXhpb3MvJykgfHwgXG4gICAgICAgICAgICAgIGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvenVzdGFuZC8nKSkge1xuICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItdXRpbHMnXG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxuICAgICAgICBlbnRyeUZpbGVOYW1lczogJ2Fzc2V0cy9bbmFtZV0tW2hhc2hdLmpzJyxcbiAgICAgIH1cbiAgICB9LFxuICAgIGNzc0NvZGVTcGxpdDogdHJ1ZSxcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogNTAwLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiAzMDAwLFxuICAgIGhvc3Q6IHRydWUsXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjMwMDEnLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWVcbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIERldiBzZXJ2ZXI6IHNlcnZlIHdvcmtiZW5jaC5odG1sIGZvciAvZXhhbS13b3JrYmVuY2ggcm91dGVcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgICAgICBpZiAocmVxLnVybCA9PT0gJy9leGFtLXdvcmtiZW5jaCcgfHwgcmVxLnVybC5zdGFydHNXaXRoKCcvZXhhbS13b3JrYmVuY2gvJykpIHtcbiAgICAgICAgICBjb25zdCBodG1sID0gZnMucmVhZEZpbGVTeW5jKHJlc29sdmUoX19kaXJuYW1lLCAnd29ya2JlbmNoLmh0bWwnKSwgJ3V0Zi04JylcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAndGV4dC9odG1sJylcbiAgICAgICAgICByZXMuZW5kKGh0bWwpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgbmV4dCgpXG4gICAgICB9KVxuICAgIH1cbiAgfSxcbiAgcHJldmlldzoge1xuICAgIHBvcnQ6IDQxNzMsXG4gICAgaG9zdDogdHJ1ZVxuICB9XG59KSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBc08sU0FBUyxvQkFBb0I7QUFDblEsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sU0FBUztBQUNoQixTQUFTLGVBQWU7QUFDeEIsT0FBTyxpQkFBaUI7QUFDeEIsU0FBUyxlQUFlO0FBQ3hCLE9BQU8sUUFBUTtBQU5mLElBQU0sbUNBQW1DO0FBUXpDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDekMsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sSUFBSTtBQUFBLElBQ0osWUFBWTtBQUFBLElBQ1osUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsWUFBWTtBQUFBLE1BQ1osUUFBUTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVTtBQUFBLFFBQ1IsTUFBTTtBQUFBLFFBQ04sWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLFFBQ2IsYUFBYTtBQUFBLFFBQ2Isa0JBQWtCO0FBQUEsUUFDbEIsU0FBUztBQUFBLFFBQ1QsV0FBVztBQUFBLFFBQ1gsT0FBTztBQUFBLFVBQ0w7QUFBQSxZQUNFLEtBQUs7QUFBQSxZQUNMLE9BQU87QUFBQSxZQUNQLE1BQU07QUFBQSxVQUNSO0FBQUEsVUFDQTtBQUFBLFlBQ0UsS0FBSztBQUFBLFlBQ0wsT0FBTztBQUFBLFlBQ1AsTUFBTTtBQUFBLFVBQ1I7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsU0FBUztBQUFBLFFBQ1AsY0FBYyxDQUFDLHNDQUFzQztBQUFBLFFBQ3JELHVCQUF1QjtBQUFBLFFBQ3ZCLGFBQWE7QUFBQSxRQUNiLGNBQWM7QUFBQSxRQUNkLGdCQUFn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
