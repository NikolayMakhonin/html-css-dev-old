const path = require('path')

process.env.WEB_DEV = 'true'

const _configDefault = {
    build: {

    },
    server: {
        port: 3522,
        liveReload: true,
        liveReloadPort: 34426,
        rootDir: '.',
        watchPatterns: '**',
    },
}

function createConfig(baseConfig, rewriteConfig, configDefault = _configDefault) {
    baseConfig = typeof baseConfig === 'string'
        ? require(path.resolve(baseConfig))
        : baseConfig || {}

    return {
        build: {
            ...configDefault?.build || {},
            ...baseConfig?.build || {},
            ...rewriteConfig?.build || {},
        },
        server: {
            ...configDefault?.server || {},
            ...baseConfig?.server || {},
            ...rewriteConfig?.server || {},
        },
    }
}

module.exports = {
    createConfig
}
