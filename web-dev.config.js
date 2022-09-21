module.exports = {
    server: {
        port: 3333,
        rootUrl: 'source',
        publicDir: 'public/source',
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
