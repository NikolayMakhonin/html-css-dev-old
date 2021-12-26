module.exports = {
    server: {
        port: 3333,
        publicDir: 'public',
        rollupConfigs: './rollup.config.js',
        watchPatterns: ['{public,source}/**'],
    },
    build: {
        inputDir: 'source',
        outputDir: 'public/source',
        watchDirs: ['source-outside'],
        filesPatterns: ['**'],
        map: true,
    }
}
