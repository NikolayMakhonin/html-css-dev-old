import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import sveltePreprocess from 'svelte-preprocess';
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs'

const dev = !!process.env.ROLLUP_WATCH;
const legacy = dev

const onwarnRollup = (warning, onwarn) => {
  // prevent warn: (!) `this` has been rewritten to `undefined`
  if ( warning.code === 'THIS_IS_UNDEFINED' ) {
    return false
  }
  if ( warning.code === 'EVAL' ) {
    return false
  }
  if ( warning.code === 'SOURCEMAP_ERROR' ) {
    return false
  }
  if ( warning.plugin === 'typescript' && /Rollup 'sourcemap' option must be set to generate source maps/.test(warning.message)) {
    return false
  }

  console.warn(
    [
      `${warning.code}: ${warning.message}`,
      warning.loc && `${warning.loc.file}:${warning.loc.line}:${warning.loc.column}`,
      warning.plugin && `plugin: ${warning.plugin}`,
      warning.pluginCode && `pluginCode: ${warning.pluginCode}`,
      warning.hook && `hook: ${warning.hook}`,
      warning.frame,
    ]
      .map(o => o?.toString()?.trim())
      .filter(o => o)
      .join('\r\n') + '\r\n'
  )

  return false
}
const onwarnSvelte = (warning, onwarn) => {
  if (warning.code === 'css-unused-selector') {
    return false
  }
  if (warning.code === 'unused-export-let') {
    return false
  }
  if (warning.code.startsWith('a11y-')) {
    return false
  }

  // console.warn(`${warning.code}:${
  //   warning.message
  // }\r\n${
  //   path.resolve(warning.filename)
  // }:${warning.pos}\r\n${
  //   warning.frame
  // }\r\n`)

  return onwarn(warning)
}

const preprocess = sveltePreprocess({
  defaults: {
    style: 'postcss',
    script: 'typescript',
  },
  postcss: true,
});

const clientConfig = {
  output: {
    format: 'esm',
    sourcemap: true,
    exports: 'named',
  },
  plugins: [
    resolve({
      browser: true,
    }),
    commonjs(),
    svelte({
      preprocess,
      compilerOptions: {
        hydratable: true,
        css: true,
      },
      emitCss: false,
      // onwarn: onwarnSvelte,
    }),
    typescript({
      sourceMap: dev,
    }),
  ],
  watch: {
    clearScreen: false,
  },
  // onwarn: onwarnRollup,
}

const serverConfig = {
  output: {
    format: 'cjs',
    sourcemap: true,
    exports: 'named',
  },
  plugins: [
    resolve({
      browser: true,
    }),
    commonjs(),
    svelte({
      preprocess,
      compilerOptions: {
        hydratable: true,
        generate: 'ssr',
        css: true,
      },
      emitCss: false,
      // onwarn: onwarnSvelte,
    }),
    typescript({
      sourceMap: dev,
    }),
  ],
  watch: {
    clearScreen: false,
  },
  // onwarn: onwarnRollup,
}

export default [clientConfig, serverConfig];
