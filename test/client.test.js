const nodeunit = require('nodeunit')
const {testCase} = nodeunit
const StompClient = require('../lib/client')
const {EventEmitter} = require('events')

let stompClient
let connectionObserver

// check message headers are properties of Error object
function checkError (test, er, expectedHeaders, msg) {
  var headers = {}
  for (var key in expectedHeaders) headers[key] = er[key]
  test.deepEqual(headers, expectedHeaders, msg)
}

// net mockage
var net = require('net')
var StompFrame = require('../lib/frame')

// Override StompFrame send function to allow inspection of frame data inside a test
var oldSend
var oldCreateConnection
var sendHook = function () {}

module.exports = testCase({
  setUp: function (callback) {
    // Mock net object so we never try to send any real data
    connectionObserver = new EventEmitter()
    connectionObserver.destroy = function () {}
    this.stompClient = new StompClient('127.0.0.1', 2098, 'user', 'pass', '1.0')

    oldCreateConnection = net.createConnection
    net.createConnection = function () {
      return connectionObserver
    }

    oldSend = StompFrame.prototype.send
    StompFrame.prototype.send = function (stream) {
      var self = this
      process.nextTick(function () {
        sendHook(self)
      })
    }

    callback()
  },

  tearDown: function (callback) {
    delete this.stompClient
    sendHook = function () {}
    net.createConnection = oldCreateConnection
    StompFrame.prototype.send = oldSend
    callback()
  },

  'check default properties are correctly set on a basic StompClient': function (test) {
    stompClient = new StompClient()

    test.equal(stompClient.user, '')
    test.equal(stompClient.pass, '')
    test.equal(stompClient.address, '127.0.0.1')
    test.equal(stompClient.port, 61613)
    test.equal(stompClient.version, '1.0')

    test.done()
  },

  'check StompClient construction from paremeters': function (test) {
    stompClient = new StompClient(
      'test.host.net', 1234, 'uname', 'pw', '1.1', 'q1.host.net',
      { retries: 10, delay: 1000 })

    test.equal(stompClient.user, 'uname')
    test.equal(stompClient.pass, 'pw')
    test.equal(stompClient.address, 'test.host.net')
    test.equal(stompClient.port, 1234)
    test.equal(stompClient.version, '1.1')
    test.equal(stompClient.vhost, 'q1.host.net')
    test.equal(stompClient.reconnectOpts.retries, 10)
    test.equal(stompClient.reconnectOpts.delay, 1000)

    test.done()
  },

  'check StompClient construction from options': function (test) {
    stompClient = new StompClient({
      address: 'test.host.net',
      port: 1234,
      user: 'uname',
      pass: 'pw',
      protocolVersion: '1.1',
      vhost: 'q1.host.net',
      reconnectOpts: { retries: 10, delay: 1000 }})

    test.equal(stompClient.user, 'uname')
    test.equal(stompClient.pass, 'pw')
    test.equal(stompClient.address, 'test.host.net')
    test.equal(stompClient.port, 1234)
    test.equal(stompClient.version, '1.1')
    test.equal(stompClient.vhost, 'q1.host.net')
    test.equal(stompClient.reconnectOpts.retries, 10)
    test.equal(stompClient.reconnectOpts.delay, 1000)

    test.done()
  },

  'check StompClient TLS construction': function (test) {
    stompClient = new StompClient(
      'test.host.net', 1234, 'uname', 'pw', null, null, null, true)
    test.deepEqual(stompClient.tls, {}, 'TLS not set by parameter')

    stompClient = new StompClient(
      'test.host.net', 1234, 'uname', 'pw', null, null, null, false)
    test.ok(!stompClient.tls, 'TLS incorrectly set by parameter')

    stompClient = new StompClient({
      host: 'secure.host.net',
      tls: true,
      cert: 'dummy'
    })
    test.equal(stompClient.address, 'secure.host.net')
    test.deepEqual(stompClient.tls.cert, 'dummy', 'TLS not set by option')

    stompClient = new StompClient({
      host: 'secure.host.net',
      tls: false,
      cert: 'dummy'
    })
    test.equal(stompClient.address, 'secure.host.net')
    test.ok(!stompClient.tls, 'TLS incorrectly set by option')

    stompClient = new StompClient({
      host: 'secure.host.net',
      tls: {
        cert: 'dummy'
      }})
    test.equal(stompClient.address, 'secure.host.net')
    test.deepEqual(stompClient.tls.cert, 'dummy',
      'TLS not set by nested option')

    test.done()
  },

  'check outbound CONNECT frame correctly follows protocol specification': function (test) {
    test.expect(4)

    sendHook = function (stompFrame) {
      test.equal(stompFrame.command, 'CONNECT')
      test.deepEqual(stompFrame.headers, {
        login: 'user',
        passcode: 'pass'
      })
      test.equal(stompFrame.body, '')
      test.equal(stompFrame.contentLength, -1)

      test.done()
    }

    // start the test
    this.stompClient.connect()
    connectionObserver.emit('connect')
  },

  'check inbound CONNECTED frame parses correctly': function (test) {
    var self = this
    var testId = '1234'

    test.expect(2)

    sendHook = function () {
      self.stompClient.stream.emit('data', 'CONNECTED\nsession:' + testId + '\n\n\0')
    }

    this.stompClient._stompFrameEmitter.on('CONNECTED', function (stompFrame) {
      test.equal(stompFrame.command, 'CONNECTED')
      test.equal(testId, stompFrame.headers.session)
      test.done()
    })

    // start the test
    this.stompClient.connect(function () {})
    connectionObserver.emit('connect')
  },

  'check the ERROR callback fires when we receive an error frame on connection': function (test) {
    var self = this
    const expectedHeaders = {
      message: 'some test error',
      'content-length': 18
    }
    const expectedBody = 'Error message body'

    test.expect(2)

    // mock that we received a CONNECTED from the stomp server in our send hook
    sendHook = function (stompFrame) {
      self.stompClient.stream.emit('data', 'ERROR\nmessage:' + expectedHeaders.message + '\ncontent-length:' + expectedHeaders['content-length'] + '\n\n' + expectedBody + '\0')
    }

    this.stompClient.connect(function () {
      test.ok(false, 'Success callback of connect() should not be called')
    }, function (headers, body) {
      checkError(test, headers, expectedHeaders, 'passed ERROR frame headers should be as expected')
      test.equal(body, expectedBody, 'passed ERROR frame body should be as expected')
      test.done()
    })

    connectionObserver.emit('connect')
  },

  'check outbound SEND frame correctly follows protocol specification': function (test) {
    var self = this
    var testId = '1234'
    var destination = '/queue/someQueue'
    var messageToBeSent = 'oh herrow!'

    test.expect(3)

    // mock that we received a CONNECTED from the stomp server in our send hook
    sendHook = function (stompFrame) {
      self.stompClient.stream.emit('data', 'CONNECTED\nsession:' + testId + '\n\n\0')
    }

    this.stompClient.connect(function () {
      sendHook = function (stompFrame) {
        test.equal(stompFrame.command, 'SEND')
        test.deepEqual(stompFrame.headers, { destination: destination })
        test.equal(stompFrame.body, messageToBeSent)
        test.done()
      }

      self.stompClient.publish(destination, messageToBeSent)
    })

    connectionObserver.emit('connect')
  },

  'check outbound SEND header correctly follows protocol specification': function (test) {
    var self = this
    var testId = '1234'
    var destination = '/queue/someQueue'
    var messageToBeSent = 'oh herrow!'
    var headers = {
      destination: 'TO BE OVERWRITTEN',
      'content-type': 'text/plain'
    }

    test.expect(3)

    // mock that we received a CONNECTED from the stomp server in our send hook
    sendHook = function (stompFrame) {
      self.stompClient.stream.emit('data', 'CONNECTED\nsession:' + testId + '\n\n\0')
    }

    this.stompClient.connect(function () {
      sendHook = function (stompFrame) {
        test.equal(stompFrame.command, 'SEND')
        headers.destination = destination
        test.deepEqual(stompFrame.headers, headers)
        test.equal(stompFrame.body, messageToBeSent)
        test.done()
      }

      self.stompClient.publish(destination, messageToBeSent, headers)
    })

    connectionObserver.emit('connect')
  },

  'check parseError event fires when malformed frame is received': function (test) {
    var self = this

    test.expect(2)

    // mock that we received a CONNECTED from the stomp server in our send hook
    sendHook = function (stompFrame) {
      self.stompClient.stream.emit('data', 'CONNECTED\n\n\n\0')
    }

    this.stompClient.on('error', function (err) {
      test.equal(err.message, 'Header "session" is required for CONNECTED')
      test.equal(err.details, 'Frame: {"command":"CONNECTED","headers":{},"body":"\\n"}')
      test.done()
    })

    this.stompClient.connect(function () {})
    connectionObserver.emit('connect')
  },

  'check disconnect method correctly sends DISCONNECT frame, disconnects TCP stream, and fires callback': function (test) {
    var self = this

    test.expect(5)

    // mock that we received a CONNECTED from the stomp server in our send hook
    sendHook = function (stompFrame) {
      self.stompClient.stream.emit('data', 'CONNECTED\nsession:blah\n\n\0')
    }

    self.stompClient.connect(function () {
      // Assert next outbound STOMP frame is a DISCONNECT
      sendHook = function (stompFrame) {
        test.equal(stompFrame.command, 'DISCONNECT')
        test.deepEqual(stompFrame.headers, {})
        test.equal(stompFrame.body, '')
      }

      // Set disconnection callback to ensure it is called appropriately
      self.stompClient.disconnect(function () {
        test.ok(true, 'disconnect callback executed')
        test.done()
      })
    })

    // Mock the TCP end call
    connectionObserver.end = function () {
      test.ok(true, 'TCP end call made')
      connectionObserver.end = function () {}
      process.nextTick(function () { connectionObserver.emit('end') })
    }

    connectionObserver.emit('connect')
  }

})
