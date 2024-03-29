const path = require('path')
const globby = require('globby')
const multimatch = require("multimatch");
const fse = require('fs-extra')
const nodeWatch = require('node-watch')
const postcss = require('postcss')
const postcssLoadConfig = require('postcss-load-config')
const postcssRemoveGlobal = require('@flemist/postcss-remove-global')
const {createConfig} = require("./loadConfig");
const {PoolRunner, Pool} = require("@flemist/time-limits");
const os = require('os')

const cpuCount = os.cpus().length
const cpuPoolRunner = new PoolRunner(new Pool(cpuCount))

// region helpers

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// function fileNameWithoutExtension(filePath) {
// 	return filePath.match(/([^\/\\]+?)(\.\w+)?$/)[1]
// }

function filePathWithoutExtension(filePath) {
	return filePath.match(/^(.+?)(\.\w+)?$/)[1]
}

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

function forEachParentDirs(dir, func) {
	let prevDir = normalizePath(dir)
	func(prevDir)
	let _dir = normalizePath(path.dirname(prevDir))
	while (_dir !== prevDir) {
		func(_dir)
		prevDir = _dir
		_dir = normalizePath(path.dirname(prevDir))
	}
}

function normalizePath(filepath) {
	return filepath.replace(/\\/g, '/')
}

async function getDirPaths(dir) {
	async function _getDirPaths(dir, dirs, files) {
		const paths = await fse.readdir(dir)
		await Promise.all(paths.map(async o => {
			const subPath = normalizePath(path.join(dir, o))
			const stat = await getPathStat(subPath)
			if (stat.isFile()) {
				files.push(subPath)
			} else if (stat.isDirectory()) {
				dirs.push(subPath)
				await _getDirPaths(subPath, dirs, files)
			}
		}))
		return files
	}

	const dirs = []
	const files = []
	await _getDirPaths(dir, dirs, files)

	return {
		dirs,
		files,
	}
}
async function getPathStat(filePath) {
	if (!fse.existsSync(filePath)) {
		return null
	}
	try {
		const stat = await fse.lstat(filePath);
		return stat
	} catch {
		return null
	}
}

async function dirIsEmpty(dir) {
	const dirIter = await fse.opendir(dir);
	const {done} = await dirIter[Symbol.asyncIterator]().next();
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

async function removePath(_path) {
	if (fse.existsSync(_path)) {
		await fse.rm(_path, { recursive: true, force: true })
		await removeEmptyDirs(path.dirname(_path))
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
	outputFile = filePathWithoutExtension(outputFile) + '.css'

	try {
		const source = await fse.readFile(inputFile, { encoding: 'utf-8' })
		const map = postcssConfig && postcssConfig.options && postcssConfig.options.map

		const result = await cpuPoolRunner.run(1, () => postcss([
			...postcssConfig && postcssConfig.plugins,
			postcssRemoveGlobal(),
		])
			.process(source, {
				...postcssConfig && postcssConfig.options,
				map: map || {inline: false},
				from: inputFile,
				to: outputFile,
			}))

		result.css = result.css.replace(new RegExp(`\\burl\\((${
			escapeRegExp(path.resolve('.'))
				.replace(/[/\\]/, '[/\\\\]')
		}[/\\\\][^)]+)\\)`, 'g'),
			(_, assetPath) => {
				const relativeAssetPath = path.relative(
					path.resolve(path.dirname(outputFile)),
					path.resolve(assetPath),
				).replace(/\\/g, '/')
				return `url(${relativeAssetPath})`
			},
		)

		const resultMap = result.map && result.map.toJSON()
		const dependencies = resultMap.sources
			&& resultMap.sources
				.filter(o => o.indexOf('<') < 0) // exclude "<no source>" lines
				.map(o => normalizePath(path.resolve(path.dirname(outputFile), o)))
				.filter(o => o !== inputFile)

		const outputFiles = []
		async function writeFile(file, content) {
			await fse.writeFile(file, content, (err) => {
				if (err) {
					console.error(err)
				}
			})
			outputFiles.push(file)
		}

		await fse.mkdirp(path.dirname(outputFile))

		await Promise.all([
			writeFile(outputFile, result.css),
			map && result.map && await writeFile(outputFile + '.map', result.map.toString()),
		])

		return {
			dependencies,
			outputFiles,
		}
	} catch (err) {
		console.error(err)
		return null
	}
}

async function copyFile({inputFile, outputFile}) {
	await fse.mkdirp(path.dirname(outputFile))

	await fse.copy(inputFile, outputFile, {
		overwrite: true,
		preserveTimestamps: true,
	})

	return {
		outputFiles: [outputFile]
	}
}

async function buildFile({inputFile, outputFile, postcssConfig}) {
	outputFile = normalizePath(path.resolve(outputFile))
	if (fse.existsSync(outputFile)) {
		await fse.rm(outputFile, { recursive: true, force: true })
	}
	const ext = (path.extname(inputFile) || '').toLowerCase()
	switch (ext) {
		case '.pcss':
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
	watchDirs,
	filesPatterns,
	map,
	clear,
}) {
	inputDir = path.resolve(inputDir)
	outputDir = path.resolve(outputDir)
	const watchDirsSet = new Set(watchDirs && watchDirs.map(o => path.resolve(o)) || [])
	watchDirsSet.add(inputDir)
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
		watchDirs: Array.from(watchDirsSet.values()),
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
	const timeStart = Date.now()

	const {
		inputDir,
		outputDir,
		watchDirs,
		patterns,
		postcssConfig,
	} = await prepareBuildFilesOptions(options)

	const allDependencies = new Map()
	const dependants = new Map()
	const watchers = {}
	const dirs = new Set()

	const inputFiles = await globby(patterns)

	inputFiles.forEach(file => {
		forEachParentDirs(path.dirname(file), dir => {
			dirs.add(dir)
		})
	})

	function fileWatch(file) {
		const watcher = (async () => {
			const watcher = await watchFile(prepareBuildFileOptions(file, {
				inputDir,
				outputDir,
				postcssConfig,
			}))

			if (!watcher) {
				return
			}

			if (!watcher.dependencies) {
				watcher.dependencies = []
			}

			const newDependencies = watcher.dependencies && watcher.dependencies
				.reduce((a, file) => {
					a.add(file)
					forEachParentDirs(path.dirname(file), dir => {
						a.add(dir)
					})
					return a
				}, new Set())


			// delete dependencies
			const oldDependencies = dependants.get(file)
			if (oldDependencies) {
				oldDependencies.forEach(o => {
					const _dependants = allDependencies.get(o)
					if (_dependants) {
						_dependants.delete(file)
						if (_dependants.size === 0) {
							allDependencies.delete(o)
						}
					}
				})
			}
			dependants.set(file, newDependencies)

			// add dependencies
			newDependencies.forEach(o => {
				if (!fse.existsSync(o)) {
					console.warn('Path not exist: ' + o)
				}
				let _dependants = allDependencies.get(o)
				if (!_dependants) {
					_dependants = new Set()
					allDependencies.set(o, _dependants)
				}
				_dependants.add(file)
			})

			return watcher
		})()
		watchers[file] = watcher
		return watcher
	}

	async function fileUnwatch(file, remove) {
		const watcherPromise = watchers[file]
		watchers[file] = null
		const watcher = await watcherPromise
		if (remove && watcher && watcher.outputFiles) {
			await Promise.all(watcher.outputFiles.map(removePath))
		}
	}

	async function onFileAdded(file) {
		try {
			if (watchers[file]) {
				return
			}
			if (await fileWatch(file)) {
				console.log('[Added]', file)
			} else {
				console.log('[Error]', file)
			}
		} catch (err) {
			console.error(err)
		}
	}

	async function updateDependants(_path) {
		await Promise.all(
			Object.keys(watchers).map(file => watchers[file])
		)

		const _dependants = allDependencies.get(_path)

		await Promise.all([
			..._dependants && Array.from(_dependants.values()) || [],
			_path,
		].map(async (file) => {
			if (multimatch([file], patterns).length === 0) {
				return
			}
			await fileUnwatch(file, true)
			console.log('[Deleted]', file)
			const stat = await getPathStat(file)
			if (stat && stat.isFile()) {
				await onFileAdded(file)
			}
		}))
	}

	async function onPathChanged(evt, _path) {
		console.log('onPathChanged', evt, _path)

		_path = normalizePath(_path)
		const pathAsDir = _path + '/'

		if (evt === 'remove') {
			const deletedDirs = []
			dirs.forEach(dir => {
				if (dir === _path || dir.startsWith(pathAsDir)) {
					deletedDirs.push(dir)
				}
			})
			deletedDirs.forEach(dir => {
				dirs.delete(dir)
			})

			await Promise.all(
				Object.keys(watchers).map(async file => {
					if (file === _path || file.startsWith(pathAsDir)) {
						await fileUnwatch(file, true)
						console.log('[Deleted]', file)
					}
				})
			)
			await updateDependants(_path)
			return
		}

		const pathStat = await getPathStat(_path)
		if (pathStat) {
			if (pathStat.isFile()) {
				await updateDependants(_path)
				if (multimatch([_path], patterns).length > 0) {
					await onFileAdded(_path)
				}
			} else if (!dirs.has(_path)) {
				// if (!dirs.has(_path)) {
					await updateDependants(_path)
				// }
				const paths = await getDirPaths(_path)
				// paths.dirs.forEach(o => {
				// 	dirs.add(o)
				// })
				const files = paths.files
					.filter(o => multimatch([o], patterns).length > 0)
				files.forEach(file => {
					forEachParentDirs(path.dirname(file), dir => {
						dirs.add(dir)
					})
				})
				await Promise.all(files.map(onFileAdded))
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

	watchDirs.forEach(watchDir => {
		nodeWatch(watchDir, {
			recursive: true,
			delay: 50,
		}, enqueueEvent)
	})

	let buildCount = 0
	let timePrev = 0
	function progress() {
		buildCount++
		const now = Date.now()
		if (now - timePrev > 1000 || buildCount === inputFiles.length) {
			timePrev = now
			console.log(`${Math.floor(buildCount / inputFiles.length * 100)}%`)
		}
	}

	await Promise.all(inputFiles.map(async file => {
		await fileWatch(normalizePath(file))
		progress()
	}))

	console.log(`watch started... ${Math.round((Date.now() - timeStart) / 1000)}s`)

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
	options = createConfig(options.baseConfig, { build: options })
	_build(options.build)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

build.build = _build

module.exports = build
