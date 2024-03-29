const { startServer } = require('./server')
const { build } = require('./build')
const fse = require('fs-extra')
const {createConfig} = require("./loadConfig");

async function _start(options) {
	await Promise.all([
		build(options.build),
		startServer(options.server),
	])
}

function start(options) {
	options = createConfig(options.baseConfig, options, { build: { watch: true } })
	_start(options)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

start.start = _start

module.exports = start
