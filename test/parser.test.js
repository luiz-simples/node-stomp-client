const {EventEmitter} = require('events')
const nodeunit = require('nodeunit')
const {testCase} = nodeunit

// Mock net object so we never try to send any real data
var connectionObserver = new EventEmitter()
connectionObserver.writeBuffer = []
connectionObserver.write = function (data) {
  this.writeBuffer.push(data)
}

module.exports = testCase({
  setUp: function (callback) {
    callback()
  },

  tearDown: function (callback) {
    connectionObserver.writeBuffer = []
    callback()
  }
})
