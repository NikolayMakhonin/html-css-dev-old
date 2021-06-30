const path = require('path')
const globby = require('globby')
const multimatch = require("multimatch");
const fse = require('fs-extra')
const nodeWatch = require('node-watch')
const postcss = require('postcss')

// region helpers

// function fileNameWithoutExtension(filePath) {
// 	return filePath.match(/([^\/\\]+?)(\.\w+)?$/)[1]
// }

function filePathWithoutExtension(filePath) {
	return filePath.match(/^(.+?)(\.\w+)?$/)[1]
}

function normalizePath(filepath) {
	return filepath.replace(/\\/g, '/')
}

// endregion

// region buildFile, watchFile

function prepareBuildFileOptions(inputFile, {
	inputDir,
	outputDir,
}) {
	const outputFile = normalizePath(
		path.join(
			outputDir,
			path.relative(inputDir, filePathWithoutExtension(inputFile) + '.css'),
		)
	)
	return {
		inputFile,
		outputFile,
	}
}

async function buildCss({inputFile, outputFile, map}) {
	const source = await fse.readFile(inputFile, { encoding: 'utf-8' })
	const result = await postcss()
		.process(source, {
			from: inputFile,
			to: outputFile,
			map,
		})

	await Promise.all([
		fse.writeFile(outputFile, result.css, () => true),
		map && result.map && await fs.writeFile(outputFile + '.map', result.map.toString()),
		null, // TODO delete me
	])
}

async function copyFile({inputFile, outputFile}) {
	return fse.copy(inputFile, outputFile, {
		overwrite: true,
		preserveTimestamps: true,
	})
}

function buildFile({inputFile, outputFile}) {
	outputFile = normalizePath(path.resolve(outputFile))
	const ext = (path.extname(inputFile) || '').toLowerCase()
	switch (ext) {
		case '.css':
			return buildCss({inputFile, outputFile})
		default:
			return copyFile({inputFile, outputFile})
	}
}

function watchFile(options) {
	buildFile(options)
      .catch(err => console.error(err))

	return () => {}
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
}) {
	inputDir = path.resolve(inputDir)
	outputDir = path.resolve(outputDir)
	const patterns = prepareGlobPatterns(inputDir, filesPatterns)

	await Promise.all([
		fse.rmdir(outputDir, { recursive: true })
			.catch(err => {
				console.error(err)
			}),
	])

	return {
		inputDir,
		outputDir,
		patterns,
	}
}

// endregion

// region buildFiles

async function buildFiles(options) {
	const {
		inputDir,
		outputDir,
		patterns,
	} = await prepareBuildFilesOptions(options)

	const inputFiles = await globby(patterns)

	const buildOptions = inputFiles.map(pageFile => prepareBuildFileOptions(pageFile, {
		inputDir,
		outputDir,
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
	} = await prepareBuildFilesOptions(options)

	const watchers = {}

	const inputFiles = await globby(patterns)

	function pageWatch(file) {
		watchers[file] = watchFile(prepareBuildFileOptions(file, {
			inputDir,
			outputDir,
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

	return () => {
		Object.keys(watchers).forEach(pageUnwatch)
	}
}

// endregion

// options: {
//   inputDir,
//   outputDir,
//   filesPatterns,
//   watch,
// }
export async function build(options) {
	if (options.watch) {
		return watchFiles(options)
			.catch(err => {
				console.error(err)
				process.exit(1)
			})
	} else {
		return buildFiles(options)
			.catch(err => {
				console.error(err)
				process.exit(1)
			})
	}
}
