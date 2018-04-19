import {EventEmitter} from 'events'

import tls from 'tls'
import net from 'net'
import StompFrame from './frame'
import StompFrameEmitter from './parser'

// Inbound frame validators
var StompFrameCommands = {
  '1.0': {
    'CONNECTED': {
      'headers': { 'session': { required: true } }
    },
    'MESSAGE': {
      'headers': {
        'destination': { required: true },
        'message-id': { required: true }
      }
    },
    'ERROR': {},
    'RECEIPT': {}
  },
  '1.1': {
    'CONNECTED': {
      'headers': { 'session': { required: true } }
    },
    'MESSAGE': {
      'headers': {
        'destination': { required: true },
        'message-id': { required: true }
      }
    },
    'ERROR': {},
    'RECEIPT': {}
  }
}

const getArgs = (args) => {
  let [address, port, user, pass, protocolVersion, vhost, reconnectOpts, tlsOpts] = args
  if (tlsOpts === true) tlsOpts = {}
  return {address, port, user, pass, protocolVersion, vhost, reconnectOpts, tlsOpts}
}

const getOpts = (opts) => {
  let {address, port, user, pass, protocolVersion, vhost, reconnectOpts, tls} = opts
  if (!address) address = opts.host
  const tlsOpts = tls === true ? opts : opts.tls
  return {address, port, user, pass, protocolVersion, vhost, reconnectOpts, tlsOpts}
}

const getParams = (opts, args) => {
  const hasArgs = args.length !== 1 || typeof opts === 'string'
  return hasArgs
    ? getArgs(args)
    : getOpts(opts)
}

class StompClient extends EventEmitter {
  constructor (opts) {
    super(...arguments)
    const {address, port, user, pass, protocolVersion, vhost, reconnectOpts, tlsOpts} = getParams(opts, arguments)

    this.version = (protocolVersion || '1.0')

    if (!StompFrameCommands[this.version]) {
      throw new Error('STOMP version ' + this.version + ' is not supported')
    }

    this.user = (user || '')
    this.pass = (pass || '')
    this.address = (address || '127.0.0.1')
    this.port = (port || 61613)
    this.subscriptions = {}
    this._stompFrameEmitter = new StompFrameEmitter(StompFrameCommands[this.version])
    this.vhost = vhost || null
    this.reconnectOpts = reconnectOpts || {}
    this.tls = tlsOpts
    this._retryNumber = 0
    this._retryDelay = this.reconnectOpts.delay

    return this
  }

  connect (connectedCallback, errorCallback) {
    var self = this

    // reset this field.
    delete this._disconnectCallback

    if (errorCallback) {
      self.on('error', errorCallback)
    }

    var connectEvent

    if (this.tls) {
      self.stream = tls.connect(self.port, self.address, this.tls)
      connectEvent = 'secureConnect'
    } else {
      self.stream = net.createConnection(self.port, self.address)
      connectEvent = 'connect'
    }

    self.stream.on(connectEvent, self.onConnect.bind(this))

    self.stream.on('error', function (err) {
      process.nextTick(function () {
        // clear all of the stomp frame emitter listeners - we don't need them, we've disconnected.
        self._stompFrameEmitter.removeAllListeners()
      })
      if (self._retryNumber < self.reconnectOpts.retries) {
        if (self._retryNumber === 0) {
          // we're disconnected, but we're going to try and reconnect.
          self.emit('reconnecting')
        }
        self._reconnectTimer = setTimeout(function () {
          self.connect()
        }, self._retryNumber++ * self.reconnectOpts.delay)
      } else {
        if (self._retryNumber === self.reconnectOpts.retries) {
          err.message += ' [reconnect attempts reached]'
          err.reconnectionFailed = true
        }
        self.emit('error', err)
      }
    })

    if (connectedCallback) {
      self.on('connect', connectedCallback)
    }

    return this
  }

  disconnect (callback) {
    var self = this

    // just a bit of housekeeping. Remove the no-longer-useful reconnect timer.
    if (self._reconnectTimer) {
      clearTimeout(self._reconnectTimer)
    }

    if (this.stream) {
      // provide a default no-op function as the callback is optional
      this._disconnectCallback = callback || function () {}

      new StompFrame({
        command: 'DISCONNECT'
      }).send(this.stream)

      process.nextTick(function () {
        self.stream.end()
      })
    }

    return this
  }

  onConnect () {
    var self = this

    // First set up the frame parser
    var frameEmitter = self._stompFrameEmitter

    self.stream.on('data', function (data) {
      frameEmitter.handleData(data)
    })

    self.stream.on('end', function () {
      if (self._disconnectCallback) {
        self._disconnectCallback()
      } else {
        self.stream.emit('error', new Error('Server has gone away'))
      }
    })

    frameEmitter.on('MESSAGE', function (frame) {
      var subscribed = self.subscriptions[frame.headers.destination]
      // .unsubscribe() deletes the subscribed callbacks from the subscriptions,
      // but until that UNSUBSCRIBE message is processed, we might still get
      // MESSAGE. Check to make sure we don't call .map() on null.
      if (subscribed) {
        subscribed.listeners.map(function (callback) {
          callback(frame.body, frame.headers)
        })
      }
      self.emit('message', frame.body, frame.headers)
    })

    frameEmitter.on('CONNECTED', function (frame) {
      if (self._retryNumber > 0) {
        // handle a reconnection differently to the initial connection.
        self.emit('reconnect', frame.headers.session, self._retryNumber)
        self._retryNumber = 0
      } else {
        self.emit('connect', frame.headers.session)
      }
    })

    frameEmitter.on('ERROR', function (frame) {
      var er = new Error(frame.headers.message)
      // frame.headers used to be passed as er, so put the headers on er object
      Object.assign(er, frame.headers)

      self.emit('error', er, frame.body)
    })

    frameEmitter.on('parseError', function (err) {
      // XXX(sam) err should be an Error object to more easily track the
      // point of error detection, but it isn't, so create one now.
      var er = new Error(err.message)
      if (err.details) {
        er.details = err.details
      }
      self.emit('error', er)
      self.stream.destroy()
    })

    // Send the CONNECT frame
    var headers = {
      'login': self.user,
      'passcode': self.pass
    }

    if (this.vhost && this.version === '1.1') { headers.host = this.vhost }

    new StompFrame({
      command: 'CONNECT',
      headers: headers
    }).send(self.stream)

    // if we've just reconnected, we'll need to re-subscribe
    for (var queue in self.subscriptions) {
      new StompFrame({
        command: 'SUBSCRIBE',
        headers: self.subscriptions[queue].headers
      }).send(self.stream)
    }
  }

  publish (queue, message, headers, callback) {
    headers = {...headers}
    headers.destination = queue
    const stompFrame = new StompFrame({command: 'SEND', headers: headers, body: message})
    return stompFrame.send(this.stream)
  }
}

Object.defineProperty(StompClient.prototype, 'writable', {
  get: function () {
    return this.stream && this.stream.writable
  }
})

export default StompClient
