"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vite_1 = require("vite");
var plugin_react_1 = require("@vitejs/plugin-react");
var path_1 = require("path");
var url_1 = require("url");
var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
exports.default = (0, vite_1.defineConfig)({
    plugins: [(0, plugin_react_1.default)()],
    resolve: {
        alias: {
            "@": path_1.default.resolve(__dirname, "client", "src"),
            "@shared": path_1.default.resolve(__dirname, "shared"),
            "@assets": path_1.default.resolve(__dirname, "attached_assets"),
        },
    },
    root: path_1.default.resolve(__dirname, "client"),
    server: {
        middlewareMode: true,
        allowedHosts: [
            "f581b519-b4c2-4de6-8b38-e9523abe09c4-00-2q9xw0xfmsdkv.spock.replit.dev",
            ".replit.dev",
            ".repl.co"
        ],
    },
    build: {
        outDir: path_1.default.resolve(__dirname, "dist/public"),
        emptyOutDir: true,
    },
});
