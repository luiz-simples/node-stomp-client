const path = require('path')
const nodeExternals = require('webpack-node-externals')
const outputPath = path.resolve('./dist')

module.exports = {
  devtool: 'cheap-module-source-map',

  target: 'node',
  externals: [nodeExternals()],

  entry: {
    'stomp-publish': './lib/client.js'
  },

  output: {
    libraryTarget: 'commonjs2',
    path: outputPath,
    filename: '[name].js'
  },

  module: {
    rules: [
      {test: /\.(js)$/, exclude: /node_modules/, loader: 'babel-loader'}
    ]
  }
}
