module.exports = {
  plugins: [
    require('postcss-import'),
    require('postcss-advanced-variables'),
    require('postcss-preset-env')({ stage: 1 }),
    require('postcss-nested'),
    require('postcss-calc'),
    require('autoprefixer'),
    // require('cssnano')({
    //   preset: [
    //     'default', {
    //       discardComments: {
    //         removeAll: true,
    //       },
    //       calc: false,
    //       // normalizeUnicode: false,
    //     },
    //   ],
    // }),
  ],
}
