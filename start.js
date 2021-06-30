const { startServer } = require('./server')
const { build } = require('./build')
const fse = require('fs-extra')

async function _start(options) {
	await build({
		watch: true,
		outputDir: options.publicDir,
		publicDir: options.outputDir,
		...options,
	})
	await startServer(options)
}

function start(options) {
	_start(options)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

start.start = _start

module.exports = start
