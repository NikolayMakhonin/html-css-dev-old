const express = require('express')
const path = require('path')
const fse = require('fs-extra')
const sirv = require('sirv')
const _liveReload = require('@flemist/easy-livereload')

async function _startServer({
	port = 3522,
	liveReload = true,
	liveReloadPort = 34426,
	publicDir,
	rootDir = '.',
}) {
	rootDir = path.resolve(rootDir)
	publicDir = publicDir && path.resolve(publicDir)
	if (publicDir && !fse.existsSync(publicDir)) {
		await fse.mkdirp(publicDir)
	}

	console.debug('port=', port)
	console.debug('publicDir=', publicDir)
	console.debug('publicDir=', rootDir)

	const server = express()
	server.disable('x-powered-by')

	if (liveReload) {
		const liveReloadInstance = _liveReload({
			watchDirs: [publicDir, rootDir].filter(o => o),
			checkFunc: (file) => {
				console.log('[LiveReload] ' + file);
				return true;
			},
			port: liveReloadPort,
		})
		server.use(liveReloadInstance)
	}

	async function fileExists(filePath) {
		if (!fse.existsSync(filePath)) {
			return false
		}
		const stat = await fse.lstat(filePath);
		return stat.isFile()
	}

	const indexFiles = ['index.html', 'index.htm']

	server
		.use(
			'/',
			async function (req, res, next) {
				// liveReloadInstance(req, res, next);

				if (rootDir
					&& /\.(svelte)$/.test(rootDir + req.path)
					&& fse.existsSync(rootDir + req.path)
				) {
					const svelte = require('svelte/compiler')
					const component = svelte.compile(rootDir + req.path)
					next()
					return
				}

				if (!publicDir) {
					next()
					return
				}

				let filePath = path.resolve(publicDir + req.path)

				// region Search index files

				let newFilePath = filePath
				let i = 0
				while (true) {
					if (await fileExists(newFilePath)) {
						filePath = newFilePath
						break
					}
					if (i >= indexFiles.length) {
						break
					}
					newFilePath = path.join(filePath, indexFiles[i])
					i++
				}

				// endregion

				if (!/\.(html|htm)$/.test(filePath)) {
					next()
					return
				}

				res.set('Cache-Control', 'no-store')
				res.sendFile(filePath)
			},

			sirv(publicDir, {
				dev: true,
			})
		)

	server
		.listen(port, () => {
			console.log(`Server started: http://localhost:${port}/`)
		})
}

function startServer(options) {
	_startServer(options)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

startServer.startServer = _startServer

module.exports = startServer
