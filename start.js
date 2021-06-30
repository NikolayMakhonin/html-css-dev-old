const server = require('./server')
const build = require('./build')

function start(options) {
	build({
		watch: true,
		outputDir: options.publicDir,
		publicDir: options.outputDir,
		...options,
	})
	server(options)
}

module.exports = start
