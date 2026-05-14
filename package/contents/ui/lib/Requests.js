.pragma library
// Version 9

var executable = null
var executableListeners = ({})
var GOOGLE_URL_PATTERN = /^https:\/\/(www\.googleapis\.com|accounts\.google\.com)\//
var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function wrapToken(token) {
	token = "" + token
	// Shell-escape single quotes for single-quoted args by:
	// closing quote + escaped quote + reopening quote: ' -> '"'"'
	token = token.replace(/'/g, "'\"'\"'")
	token = "'" + token + "'"
	return token
}

function utf8Bytes(input) {
	var bytes = []
	for (var i = 0; i < input.length; i++) {
		var codePoint = input.charCodeAt(i)
		if (0xD800 <= codePoint && codePoint <= 0xDBFF && i + 1 < input.length) {
			var low = input.charCodeAt(i + 1)
			if (0xDC00 <= low && low <= 0xDFFF) {
				codePoint = ((codePoint - 0xD800) << 10) + (low - 0xDC00) + 0x10000
				i += 1
			}
		}
		if (codePoint <= 0x7F) {
			bytes.push(codePoint)
		} else if (codePoint <= 0x7FF) {
			bytes.push(0xC0 | (codePoint >> 6))
			bytes.push(0x80 | (codePoint & 0x3F))
		} else if (codePoint <= 0xFFFF) {
			bytes.push(0xE0 | (codePoint >> 12))
			bytes.push(0x80 | ((codePoint >> 6) & 0x3F))
			bytes.push(0x80 | (codePoint & 0x3F))
		} else {
			bytes.push(0xF0 | (codePoint >> 18))
			bytes.push(0x80 | ((codePoint >> 12) & 0x3F))
			bytes.push(0x80 | ((codePoint >> 6) & 0x3F))
			bytes.push(0x80 | (codePoint & 0x3F))
		}
	}
	return bytes
}

function toBase64(input) {
	var output = ''
	var bytes = utf8Bytes(input)
	for (var i = 0; i < bytes.length; i += 3) {
		var a = bytes[i]
		var b = i + 1 < bytes.length ? bytes[i + 1] : NaN
		var c = i + 2 < bytes.length ? bytes[i + 2] : NaN

		var v1 = a >> 2
		var v2 = ((a & 3) << 4) | (isNaN(b) ? 0 : (b >> 4))
		var v3 = isNaN(b) ? 64 : (((b & 15) << 2) | (isNaN(c) ? 0 : (c >> 6)))
		var v4 = isNaN(c) ? 64 : (c & 63)

		output += BASE64_CHARS.charAt(v1)
		output += BASE64_CHARS.charAt(v2)
		output += v3 === 64 ? '=' : BASE64_CHARS.charAt(v3)
		output += v4 === 64 ? '=' : BASE64_CHARS.charAt(v4)
	}
	return output
}

function getExecutable() {
	if (executable) {
		return executable
	}
	var qmlSource = ''
	qmlSource += 'import QtQuick 2.0\n'
	qmlSource += 'import org.kde.plasma.core 2.0 as PlasmaCore\n'
	qmlSource += 'PlasmaCore.DataSource {\n'
	qmlSource += '\tengine: "executable"\n'
	qmlSource += '\tconnectedSources: []\n'
	qmlSource += '}'
	executable = Qt.createQmlObject(qmlSource, Qt.application, "RequestsExecutable")
	executable.newData.connect(function(sourceName, data) {
		var listener = executableListeners[sourceName]
		if (listener) {
			delete executableListeners[sourceName]
			listener(data)
		}
		executable.disconnectSource(sourceName)
	})
	return executable
}

function exec(cmd, callback) {
	if (Array.isArray(cmd)) {
		cmd = cmd.map(wrapToken)
		cmd = cmd.join(' ')
	}
	var executable = getExecutable()
	executableListeners[cmd] = callback
	executable.connectSource(cmd)
}

function isGoogleUrl(url) {
	return GOOGLE_URL_PATTERN.test(url)
}

function buildScriptErrorResponse(body) {
	return {
		status: 0,
		responseText: body || '',
		getAllResponseHeaders: function() { return '' },
	}
}

function requestViaScript(opt, callback) {
	var scriptPath = Qt.resolvedUrl('../../scripts/http_request.py')
	var payload = {
		method: opt.method || "GET",
		url: opt.url,
		headers: opt.headers || {},
		data: opt.data,
	}
	var payloadText = JSON.stringify(payload)
	var payloadBase64 = toBase64(payloadText)
	exec(['python3', scriptPath, '--payload-base64', payloadBase64], function(data) {
		var stdout = data["stdout"] || ''
		var stderr = data["stderr"] || ''
		// DataSource executable engine returns fields like "exit code" and "stdout".
		if (!("exit code" in data)) {
			callback("HTTP Error 0", stderr, buildScriptErrorResponse(stderr))
			return
		}
		var exitCode = data["exit code"]
		if (exitCode !== 0) {
			var errorText = stderr
			var normalizedErrorText = errorText || ''
			if (normalizedErrorText.indexOf('python3') >= 0 && normalizedErrorText.indexOf('not found') >= 0) {
				errorText = 'Python 3 is required for proxy support with Google Calendar API requests'
			}
			callback("HTTP Error 0", errorText, buildScriptErrorResponse(errorText))
			return
		}

		var response = { status: 0, body: '' }
		try {
			response = JSON.parse(stdout)
		} catch (e) {
			callback("HTTP Error 0", stdout, buildScriptErrorResponse(stdout))
			return
		}

		var req = {
			status: response.status || 0,
			responseText: response.body || '',
			getAllResponseHeaders: function() {
				return ''
			},
		}
		if (200 <= req.status && req.status < 400) {
			callback(null, req.responseText, req)
		} else {
			var msg = "HTTP Error " + req.status
			callback(msg, req.responseText, req)
		}
	})
}

function requestViaXmlHttpRequest(opt, callback) {
	var req = new XMLHttpRequest()
	req.onerror = function() {
		// Network Error / No Connection
		console.log('XMLHttpRequest.onerror', req.status)
		var msg = "HTTP Error " + req.status
		callback(msg, null, req)
	}
	req.onreadystatechange = function() {
		if (req.readyState === XMLHttpRequest.DONE) { // https://xhr.spec.whatwg.org/#dom-xmlhttprequest-done
			if (200 <= req.status && req.status < 400) {
				callback(null, req.responseText, req)
			} else {
				if (req.status === 0) {
					console.log('HTTP 0 Headers: \n' + req.getAllResponseHeaders())
				}
				var msg = "HTTP Error " + req.status
				callback(msg, req.responseText, req)
			}
		}
	}
	req.open(opt.method || "GET", opt.url, true)
	if (opt.headers) {
		for (var key in opt.headers) {
			req.setRequestHeader(key, opt.headers[key])
		}
	}
	req.send(opt.data)
}

function request(opt, callback) {
	if (typeof opt === 'string') {
		opt = { url: opt }
	}
	if (isGoogleUrl(opt.url)) {
		requestViaScript(opt, callback)
	} else {
		requestViaXmlHttpRequest(opt, callback)
	}
}

function encodeParams(params) {
	var s = ''
	var i = 0
	for (var key in params) {
		if (i > 0) {
			s += '&'
		}
		var value = params[key]
		if (typeof value === "object") {
			// TODO: Flatten obj={list: [1, 2]} as
			// obj[list][0]=1
			// obj[list][1]=2
		}
		s += encodeURIComponent(key) + '=' + encodeURIComponent(value)
		i += 1
	}
	return s
}

function encodeFormData(opt) {
	opt.headers = opt.headers || {}
	opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'
	if (opt.data) {
		opt.data = encodeParams(opt.data)
	}
	return opt
}

function post(opt, callback) {
	if (typeof opt === 'string') {
		opt = { url: opt }
	}
	opt.method = 'POST'
	encodeFormData(opt)
	request(opt, callback)
}


function getJSON(opt, callback) {
	if (typeof opt === 'string') {
		opt = { url: opt }
	}
	opt.headers = opt.headers || {}
	opt.headers['Accept'] = 'application/json'
	request(opt, function(err, data, req) {
		if (!err && data) {
			data = JSON.parse(data)
		}
		callback(err, data, req)
	})
}


function postJSON(opt, callback) {
	if (typeof opt === 'string') {
		opt = { url: opt }
	}
	opt.method = opt.method || 'POST'
	opt.headers = opt.headers || {}
	opt.headers['Content-Type'] = 'application/json'
	if (opt.data) {
		opt.data = JSON.stringify(opt.data)
	}
	getJSON(opt, callback)
}

function getFile(url, callback) {
	var req = new XMLHttpRequest()
	req.onerror = function() {
		// Network Error / No Connection
		console.log('XMLHttpRequest.onerror', req.status)
		var msg = "HTTP Error " + req.status
		callback(msg, null, req)
	}
	req.onreadystatechange = function() {
		if (req.readyState === 4) {
			// Since the file is local, it will have HTTP 0 Unsent.
			callback(null, req.responseText, req)
		}
	}
	req.open("GET", url, true)
	req.send()
}

function parseMetadata(data) {
	var lines = data.split('\n')
	var d = {}
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i]
		var delimeterIndex = line.indexOf('=')
		if (delimeterIndex >= 0) {
			var key = line.substr(0, delimeterIndex)
			var value = line.substr(delimeterIndex + 1)
			d[key] = value
		}
	}
	return d
}

function getAppletMetadata(callback) {
	var url = Qt.resolvedUrl('.')

	var s = '/share/plasma/plasmoids/'
	var index = url.indexOf(s)
	if (index >= 0) {
		var a = index + s.length
		var b = url.indexOf('/', a)
		// var packageName = url.substr(a, b-a)
		var metadataUrl = url.substr(0, b) + '/metadata.desktop'
		Requests.getFile(metadataUrl, function(err, data) {
			if (err) {
				return callback(err)
			}

			var metadata = parseMetadata(data)
			callback(null, metadata)
		})
	} else {
		return callback('Could not parse version.')
	}
}

function getAppletVersion(callback) {
	getAppletMetadata(function(err, metadata) {
		if (err) return callback(err)

		callback(err, metadata['X-KDE-PluginInfo-Version'])
	})
}
