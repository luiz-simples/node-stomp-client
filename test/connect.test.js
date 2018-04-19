const nodeunit = require('nodeunit')
const {testCase} = nodeunit
const StompClient = require('../lib/client')

module.exports = testCase({
  'check connect to closed port errors': (test) => {
    var stompClient = new StompClient('127.0.0.1', 4)

    stompClient.connect(function () {})

    stompClient.once('error', function (er) {
      test.done()
    })
  },

  'check that invalid protocol version errors': (test) => {
    try {
      return new StompClient('127.0.0.1', null, null, null, '0.1')
    } catch (er) {
      test.done()
    }
  }
})
