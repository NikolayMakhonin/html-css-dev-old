const express = require('express')
const path = require('path')
const fse = require('fs-extra')
const sirv = require('sirv')
const liveReload = require('@flemist/easy-livereload')

const port = process.env.PORT || 3333
const publicDir = path.resolve(process.env.PUBLIC_DIR || 'public')
console.debug('port=', port)
console.debug('publicDir=', publicDir)

const server = express()
server.disable('x-powered-by')

const liveReloadInstance = liveReload({
  watchDirs: [publicDir],
  checkFunc: (file) => {
    console.log('[LiveReload] ' + file);
    return true;
  }
})
server.use(liveReloadInstance)

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
		async function(req, res, next) {
      // liveReloadInstance(req, res, next);

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
