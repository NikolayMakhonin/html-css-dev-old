module.exports = {
    server: {
        port: 3333,
        rootUrl: 'source',
        publicDir: 'public/source',
        watchPatterns: ['{public,source}/**'],
        rollupConfigs: './rollup.config.js',
    },
    build: {
        inputDir: 'source',
        outputDir: 'public/source',
        watchDirs: ['source-outside'],
        filesPatterns: ['**'],
        map: true,
    }
}
