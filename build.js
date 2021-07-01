const path = require('path')
const globby = require('globby')
const multimatch = require("multimatch");
const fse = require('fs-extra')
const nodeWatch = require('node-watch')
const postcss = require('postcss')
const postcssLoadConfig = require('postcss-load-config')

// region helpers

// function fileNameWithoutExtension(filePath) {
// 	return filePath.match(/([^\/\\]+?)(\.\w+)?$/)[1]
// }

// function filePathWithoutExtension(filePath) {
// 	return filePath.match(/^(.+?)(\.\w+)?$/)[1]
// }

// function delay(timeMilliseconds) {
// 	return new Promise(resolve => {
// 		setTimeout(resolve, timeMilliseconds)
// 	})
// }

// async function tryRun(
// 	tryCount,
// 	_delay,
// 	func
// ) {
// 	let i = 0
// 	while (true) {
// 		try {
// 			return await func()
// 		} catch (error) {
// 			i++
// 			if (!tryCount || i >= tryCount) {
// 				throw error
// 			}
// 			if (_delay) {
// 				await delay(_delay)
// 			}
// 		}
// 	}
// }

function normalizePath(filepath) {
	return filepath.replace(/\\/g, '/')
}

async function getPathStat(filePath) {
	if (!fse.existsSync(filePath)) {
		return null
	}
    const stat = await fse.lstat(filePath);
	return stat
}

async function dirIsEmpty(dir) {
	const dirIter = await fse.opendir(dir);
	const {value, done} = await dirIter[Symbol.asyncIterator]().next();
	if (!done) {
		await dirIter.close()
		return false
	}
	return true
}

async function removeEmptyDirs(dir) {
	const pathStat = await getPathStat(dir)
	if (pathStat.isDirectory() && await dirIsEmpty(dir)) {
		try {
			await fse.rmdir(dir, {
				recursive: false,
			})
		} catch (err) {
			if (fse.existsSync(dir)) {
				throw err
			}
		}
		await removeEmptyDirs(path.dirname(dir))
	}
}

async function removeFile(file) {
	if (fse.existsSync(file)) {
		await fse.unlink(file)
		await removeEmptyDirs(path.dirname(file))
		// await tryRun(5, 500, () => removeEmptyDirs(path.dirname(file)))
	}
}

// endregion

// region buildFile, watchFile

function prepareBuildFileOptions(inputFile, {
	inputDir,
	outputDir,
	postcssConfig,
}) {
	const outputFile = normalizePath(
		path.join(
			outputDir,
			path.relative(inputDir, inputFile),
		)
	)

	return {
		inputFile,
		outputFile,
		postcssConfig,
	}
}

async function buildCss({inputFile, outputFile, postcssConfig}) {
	// outputFile = filePathWithoutExtension(outputFile) + '.css'

	const source = await fse.readFile(inputFile, { encoding: 'utf-8' })
	const result = await postcss(postcssConfig && postcssConfig.plugins || [])
		.process(source, {
			...postcssConfig && postcssConfig.options,
			from: inputFile,
			to: outputFile,
		})

	await fse.mkdirp(path.dirname(outputFile))

	await Promise.all([
		fse.writeFile(outputFile, result.css, () => true),
		result.map && await fse.writeFile(outputFile + '.map', result.map.toString()),
	])

	return async (remove) => {
		if (remove) {
			await Promise.all([
				removeFile(outputFile),
				removeFile(outputFile + '.map'),
			])
		}
	}
}

async function copyFile({inputFile, outputFile}) {
	await fse.mkdirp(path.dirname(outputFile))

	await fse.copy(inputFile, outputFile, {
		overwrite: true,
		preserveTimestamps: true,
	})

	return async (remove) => {
		if (remove) {
			await removeFile(outputFile)
		}
	}
}

async function buildFile({inputFile, outputFile, postcssConfig}) {
	outputFile = normalizePath(path.resolve(outputFile))
	if (fse.existsSync(outputFile)) {
		await fse.unlink(outputFile)
	}
	const ext = (path.extname(inputFile) || '').toLowerCase()
	switch (ext) {
		case '.css':
			return buildCss({inputFile, outputFile, postcssConfig})
		default:
			return copyFile({inputFile, outputFile})
	}
}

function watchFile(options) {
	return buildFile(options)
}

// endregion

// region prepareBuildFilesOptions

function prepareGlobPatterns(inputDir, filesPatterns) {
	return filesPatterns.map(pattern => {
		return normalizePath(pattern.startsWith('!')
			? '!' + path.join(inputDir, pattern.substring(1))
			: path.join(inputDir, pattern))
	})
}

async function prepareBuildFilesOptions({
	inputDir,
	outputDir,
	filesPatterns,
	map,
	clear,
}) {
	inputDir = path.resolve(inputDir)
	outputDir = path.resolve(outputDir)
	const patterns = prepareGlobPatterns(inputDir, filesPatterns)
	let postcssConfig

	await Promise.all([
		clear && fse.rmdir(outputDir, { recursive: true })
			.catch(err => {
				console.error(err)
			}),
		(async () => {
			postcssConfig = await postcssLoadConfig({
				map: map === true ? { inline: false }
					: map === 'inline' ? { inline: true }
					: null
			})
		})(),
	])

	return {
		inputDir,
		outputDir,
		patterns,
		postcssConfig,
	}
}

// endregion

// region buildFiles

async function buildFiles(options) {
	const {
		inputDir,
		outputDir,
		patterns,
		postcssConfig,
	} = await prepareBuildFilesOptions(options)

	const inputFiles = await globby(patterns)

	const buildOptions = inputFiles.map(pageFile => prepareBuildFileOptions(pageFile, {
		inputDir,
		outputDir,
		postcssConfig,
	}))

	await Promise.all([
		...buildOptions.map(buildFile),
	])
}

// endregion

// region watchFiles

async function watchFiles(options) {
	const {
		inputDir,
		outputDir,
		patterns,
		postcssConfig,
	} = await prepareBuildFilesOptions(options)

	const watchers = {}

	const inputFiles = await globby(patterns)

	function fileWatch(file) {
		watchers[file] = watchFile(prepareBuildFileOptions(file, {
			inputDir,
			outputDir,
			postcssConfig,
		}))
	}

	async function fileUnwatch(file, remove) {
		const unsubscribePromise = watchers[file]
		watchers[file] = null
		const unsubscribe = await unsubscribePromise
		if (unsubscribe) {
			await unsubscribe(remove)
		}
	}

	console.log('watch v1')
	async function onFileAdded(evt, file) {
		try {
			fileWatch(file)
			console.log('[Added]', file)
		} catch (err) {
			console.error(err)
		}
	}

	async function onPathChanged(evt, _path) {
		_path = normalizePath(_path)

		if (evt === 'remove') {
			const pathAsDir = _path + '/'
			await Promise.all(
				Object.keys(watchers).map(async file => {
					if (file === _path || file.startsWith(pathAsDir)) {
						await fileUnwatch(file, true)
						console.log('[Deleted]', file);
					}
				})
			)
			return
		}

		const pathStat = await getPathStat(_path)
		if (pathStat) {
			if (pathStat.isFile()) {
				await onFileAdded(evt, _path)
			} else {
				const paths = await fse.readdir(_path)
				await Promise.all(paths.map(o => onPathChanged(evt, path.join(_path, o))))
			}
		}
	}

	const events = []
	function enqueueEvent(evt, path) {
		events.push({evt, path})
		processEvents()
	}

	let processEventsRunning
	async function processEvents() {
		if (processEventsRunning) {
			return
		}
		processEventsRunning = true
		while (events.length > 0) {
			const {evt, path} = events.shift()
			try {
				await onPathChanged(evt, path)
			} catch (err) {
				console.error(err)
			}
		}
		processEventsRunning = false
	}

	nodeWatch(inputDir, {
		recursive: true,
		delay: 0,
		filter(inputFile) {
			if (multimatch([inputFile], patterns).length > 0) {
				console.log('watch: ' + inputFile)
				return true
			} else {
				console.log('watch skip: ' + inputFile)
				return false
			}
		},
	}, enqueueEvent)

	inputFiles.forEach(file => fileWatch(normalizePath(file)))

	console.log('watch started...')

	return async () => {
		await Promise.all(Object.keys(watchers).map(fileUnwatch))
	}
}

// endregion

function _build(options) {
	if (options.watch) {
		return watchFiles(options)
	} else {
		return buildFiles(options)
	}
}

// options: {
//   watch,
//   inputDir,
//   outputDir,
//   filesPatterns,
//   map,
//   clear,
// }
async function build(options) {
	_build(options)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

build.build = _build

module.exports = build
