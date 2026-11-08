'use strict'

require('./sanitize-secrets.cjs').install()
module.exports = require('./sanitize-error.cjs')
