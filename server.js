const express = require('express')
const path = require('path')
const fse = require('fs-extra')
const sirv = require('sirv')
const multimatch = require("multimatch");
const _liveReload = require('@flemist/easy-livereload')
const {createConfig} = require("./loadConfig");

function requireNoCache(module) {
	delete require.cache[require.resolve(module)];
	return require(module);
}

async function _startServer({
	port,
	liveReload,
	liveReloadPort,
	publicDir,
	rootDir,
	svelteRootUrl,
	svelteClientUrl,
	svelteServerDir,
	watchPatterns,
}) {
	const unhandledErrorsCode = await fse.readFile(
		require.resolve('@flemist/web-logger/unhandled-errors.min'),
		{encoding: 'utf-8'},
	)

	svelteRootUrl = svelteRootUrl?.replace(/\/+$/, '')
	rootDir = path.resolve(rootDir)
	publicDir = publicDir && path.resolve(publicDir)
	if (publicDir && !fse.existsSync(publicDir)) {
		await fse.mkdirp(publicDir)
	}
	svelteServerDir = svelteServerDir && path.resolve(svelteServerDir)

	console.debug('port=', port)
	console.debug('publicDir=', publicDir)
	console.debug('rootDir=', rootDir)

	const server = express()
	server.disable('x-powered-by')

	if (liveReload) {
		const liveReloadInstance = _liveReload({
			watchDirs: [publicDir, rootDir].filter(o => o),
			checkFunc: (file) => {
				if (multimatch([file], watchPatterns).length === 0) {
					return
				}
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

				if (!publicDir) {
					next()
					return
				}

				// region Search svelte file

				if (svelteServerDir && /\.(svelte)$/.test(req.path)) {
					const _path = svelteRootUrl && (req.path.startsWith(svelteRootUrl + '/') || req.path === svelteRootUrl)
						? req.path.substring(svelteRootUrl.length)
						: req.path

					const urlPath = _path.replace(/\.svelte$/, '')
					const filePath = path.resolve(svelteServerDir + urlPath + '.js')
					if (fse.existsSync(filePath)) {
						const Component = requireNoCache(filePath).default
						const { head, html, css } = Component.render()
						const clientJsHref = svelteClientUrl + urlPath + '.js'
						const clientCssHref = svelteClientUrl + urlPath + '.css'

						const responseHtml = `
<!DOCTYPE html>
<html lang="ru">
<head>

<!-- region unhandled errors -->

<script>${unhandledErrorsCode}</script>
<script>
try {
  var url = ''
  if (typeof location != 'undefined' && location.href) {
	url = document.location.href
  } else if (document.location && document.location.href) {
	url = document.location.href
  } else if (window.location && window.location.href) {
	url = window.location.href
  } else if (document.URL) {
	url = document.URL
  } else if (document.documentURI) {
	url = document.documentURI
  }
  window.isDebug = /[?&]debug(=true)?(&|$)/.test(url + '')
  UnhandledErrors.subscribeUnhandledErrors({
	alert: window.isDebug,
	catchConsoleLevels: window.isDebug && ['error', 'warn'],
	customLog: function(log) {
	  if (/Test error/.test(log)) {
		return true
	  }
	},
  })
  if (window.isDebug) {
	console.error('Test error')
  }
} catch (err) {
  alert(err)
}
</script>

<!-- endregion -->

${head}
<link rel="preload" href="${clientCssHref}" as="style">
<link rel='stylesheet' href='${clientCssHref}'>
</head>
<body>
${html}
<script type='module' defer>
	import Component from '${clientJsHref}';

	new Component({
	  target: document.body,
	  hydrate: true,
	});

	console.log('hydrated')
</script>
</body>
</html>
`
						res.set('Cache-Control', 'no-store')
						res.send(responseHtml)
						return
					}
				}

				// endregion

				// region Search index files

				let filePath = path.resolve(publicDir + req.path)
				let filePaths = []

				let newFilePath = filePath
				let i = 0
				while (true) {
					filePaths.push(filePath)
					if (await fileExists(newFilePath)) {
						filePath = newFilePath
						res.set('Cache-Control', 'no-store')
						res.sendFile(filePath)
						return
					}
					if (i >= indexFiles.length) {
						res.status(404).send('Not Found:\r\n' + filePaths.join('\r\n'))
						return
					}
					newFilePath = path.join(filePath, indexFiles[i])
					i++
				}

				// endregion
			},
		)

	server
		.listen(port, () => {
			console.log(`Server started: http://localhost:${port}/`)
		})
}

function startServer(options) {
	options = createConfig(options.baseConfig, { server: options })
	_startServer(options.server)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

startServer.startServer = _startServer

module.exports = startServer
