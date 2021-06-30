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

function normalizePath(filepath) {
	return filepath.replace(/\\/g, '/')
}

async function fileExists(filePath) {
	if (!fse.existsSync(filePath)) {
		return false
	}
    const stat = await fse.lstat(filePath);
	return stat.isFile()
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

	await Promise.all([
		fse.writeFile(outputFile, result.css, () => true),
		result.map && await fse.writeFile(outputFile + '.map', result.map.toString()),
		null, // TODO delete me
	])
}

async function copyFile({inputFile, outputFile}) {
	return fse.copy(inputFile, outputFile, {
		overwrite: true,
		preserveTimestamps: true,
	})
}

function buildFile({inputFile, outputFile, postcssConfig}) {
	outputFile = normalizePath(path.resolve(outputFile))
	const ext = (path.extname(inputFile) || '').toLowerCase()
	switch (ext) {
		case '.css':
			return buildCss({inputFile, outputFile, postcssConfig})
		default:
			return copyFile({inputFile, outputFile})
	}
}

function watchFile(options) {
	buildFile(options)
		.catch(err => console.error(err))

	return null
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
}) {
	inputDir = path.resolve(inputDir)
	outputDir = path.resolve(outputDir)
	const patterns = prepareGlobPatterns(inputDir, filesPatterns)
	let postcssConfig

	await Promise.all([
		fse.rmdir(outputDir, { recursive: true })
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

	function pageWatch(file) {
		watchers[file] = watchFile(prepareBuildFileOptions(file, {
			inputDir,
			outputDir,
			postcssConfig,
		}))
	}

	function pageUnwatch(file) {
		const unsubscribe = watchers[file]
		if (unsubscribe) {
			unsubscribe()
		}
		watchers[file] = null
	}

	inputFiles.forEach(file => pageWatch(normalizePath(file)))

	nodeWatch(inputDir, {
		recursive: true,
		filter(inputFile) {
			return multimatch([inputFile], patterns).length > 0
		},
	}, async function(evt, file) {
		file = normalizePath(file)

		try {
			if (evt === 'remove') {
				if (watchers[file]) {
					pageUnwatch(file)
					console.log('[Deleted]', file);
				}
			} else if (!watchers[file] && await fileExists(file)) {
				pageWatch(file)
				console.log('[Added]', file);
			}
		} catch (err) {
			console.error(err)
		}
	})

	console.log('watch started...')

	return () => {
		Object.keys(watchers).forEach(pageUnwatch)
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
// }
async function build(options) {
	_build(options)
		.catch(err => {
			console.error(err)
			process.exit(1)
		})
}

module.exports = build
