module.exports = {
    server: {
        port: 3333,
        publicDir: 'public',
        rollupConfigs: './rollup.config.js',
        watchPatterns: ['{public,source}/**'],
    }
}
