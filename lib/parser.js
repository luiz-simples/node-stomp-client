import StompFrame from './frame'
import {EventEmitter} from 'events'

const ParserStates = {
  COMMAND: 0,
  HEADERS: 1,
  BODY: 2,
  ERROR: 3
}

class StompFrameEmitter extends EventEmitter {
  constructor (frameValidators = {}) {
    super(...arguments)

    this.state = ParserStates.COMMAND
    this.frame = new StompFrame()
    this.frames = []
    this.buffer = ''
    this.frameValidators = frameValidators
    this.commands = Object.keys(frameValidators)
  }

  incrementState () {
    if (this.state === ParserStates.BODY || this.state === ParserStates.ERROR) {
      this.state = ParserStates.COMMAND
    } else {
      this.state++
    }
  }

  handleData (data) {
    this.buffer += data
    do {
      if (this.state === ParserStates.COMMAND) {
        this.parseCommand()
      }
      if (this.state === ParserStates.HEADERS) {
        this.parseHeaders()
      }
      if (this.state === ParserStates.BODY) {
        this.parseBody()
      }
      if (this.state === ParserStates.ERROR) {
        this.parseError()
      }
    } while (this.state === ParserStates.COMMAND && this.hasLine())
  }

  hasLine () {
    return (this.buffer.indexOf('\n') > -1)
  }

  popLine () {
    var index = this.buffer.indexOf('\n')
    var line = this.buffer.slice(0, index)
    this.buffer = this.buffer.substr(index + 1)
    return line
  }

  parseCommand () {
    while (this.hasLine()) {
      var line = this.popLine()
      if (line !== '') {
        if (this.commands.indexOf(line) === -1) {
          this.error({
            message: 'No such command ',
            details: 'Unrecognized Command \'' + line + '\''
          })
          break
        }
        this.frame.setCommand(line)
        this.incrementState()
        break
      }
    }
  }

  parseHeaders () {
    while (this.hasLine()) {
      var line = this.popLine()
      if (line === '') {
        this.incrementState()
        break
      } else {
        var kv = line.split(':')
        if (kv.length < 2) {
          this.error({
            message: 'Error parsing header',
            details: 'No ":" in line "' + line + '"'
          })
          break
        }
        this.frame.setHeader(kv[0], kv.slice(1).join(':'))
      }
    }
  }

  parseBody () {
    var bufferBuffer = Buffer.from(this.buffer)

    if (this.frame.contentLength > -1) {
      var remainingLength = this.frame.contentLength - this.frame.body.length

      if (remainingLength < bufferBuffer.length) {
        this.frame.appendToBody(bufferBuffer.slice(0, remainingLength).toString())
        this.buffer = bufferBuffer.slice(remainingLength, bufferBuffer.length).toString()

        if (this.frame.contentLength === Buffer.byteLength(this.frame.body)) {
          this.frame.contentLength = -1
        } else {
          return
        }
      }
    }

    var index = this.buffer.indexOf('\0')

    if (index === -1) {
      this.frame.appendToBody(this.buffer)
      this.buffer = ''
    } else {
      // The end of the frame has been identified, finish creating it
      this.frame.appendToBody(this.buffer.slice(0, index))

      var frameValidation = this.getFrameValidation(this.frame.command)

      if (frameValidation.isValid) {
        // Emit the frame and reset
        this.emit('frame', this.frame) // Event emit to catch any frame emission
        this.emit(this.frame.command, this.frame) // Specific frame emission
      } else {
        this.emit('parseError', {
          message: frameValidation.message,
          details: frameValidation.details
        })
      }

      this.frame = new StompFrame()
      this.incrementState()
      this.buffer = this.buffer.substr(index + 1)
    }
  }

  getFrameValidation (command) {
    if (!this.frameValidators.hasOwnProperty(command)) {
      this.emit('parseError', { message: 'No validator defined for ' + command })
    } else {
      return this.frame.validate(this.frameValidators[command])
    }
  }
}

export default StompFrameEmitter
