const express = require('express')
const path = require('path')
const fse = require('fs-extra')
const sirv = require('sirv')
const multimatch = require("multimatch");
const _liveReload = require('@flemist/easy-livereload')
const {requireFromString} = require('require-from-memory')
const _loadRollupConfig = require('rollup/dist/loadConfigFile')
const {rollup} = require('rollup')
const {createConfig} = require("./loadConfig");

async function loadRollupConfig(filePath) {
	const { options, warnings } = await _loadRollupConfig(path.resolve(filePath))
	// This prints all deferred warnings
	warnings.flush();
	return options
}

async function _startServer({
	port,
	liveReload,
	liveReloadPort,
	publicDir,
	rootDir,
	rollupConfigs,
	watchPatterns,
}) {
	const unhandledErrorsCode = await fse.readFile(
		require.resolve('@flemist/web-logger/unhandled-errors.min'),
		{encoding: 'utf-8'},
	)

	rollupConfigs = typeof rollupConfigs === 'string'
		? await loadRollupConfig(path.resolve(rollupConfigs))
		: rollupConfigs

	rootDir = path.resolve(rootDir)
	publicDir = publicDir && path.resolve(publicDir)
	if (publicDir && !fse.existsSync(publicDir)) {
		await fse.mkdirp(publicDir)
	}

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

				if (rootDir
					&& /\.(svelte)$/.test(rootDir + req.path)
					&& fse.existsSync(rootDir + req.path)
				) {
					const inputFile = path.resolve(rootDir + req.path)
					const _outputConfig = {
						dir: null,
						file: inputFile,
						name: inputFile.match(/(^|[\\\/])([^\\\/]+?)(\.\w+)?$/)[2]
					}
					const serverConfigIndex = rollupConfigs.findIndex(o => o.output[0].format === 'cjs')
					const clientConfigIndex = rollupConfigs.findIndex(o => o.output[0].format === 'esm')
					const outputs = await Promise.all(rollupConfigs.map(async (rollupConfig) => {
						const outputConfig = {
							...rollupConfig.output[0],
							..._outputConfig
						}
						const bundle = await rollup({
							...rollupConfig,
							input: inputFile,
							output: outputConfig,
						})
						const { output } = await bundle.generate(outputConfig)
						if (output.length !== 1) {
							throw new Error(`output.length === ${output.length}`)
						}
						return output[0]
					}))
					const Component = requireFromString(outputs[serverConfigIndex].code, inputFile + '.js').default
					const { head, html, css } = Component.render()
					const componentClassRegexp = /\bexport\s*{\s*(\w+)\s*as\s*default\s*};?\s*$/
					let componentCode = outputs[clientConfigIndex].code
					const componentClassName = componentCode.match(componentClassRegexp)[1]
					componentCode = componentCode.replace(componentClassRegexp, '')

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
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-T3FX29T" 
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
${html}
<script type='module' defer>
${componentCode};

new ${componentClassName}({
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
	options = createConfig(options.baseConfig, { server: options })
	_startServer(options.server)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

startServer.startServer = _startServer

module.exports = startServer
