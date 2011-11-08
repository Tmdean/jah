/*globals require module exports process console*/
/*jslint undef: true, strict: true, white: true, newcap: true, indent: 4 */
"use strict";

var sys       = require('sys'),
    logger    = require('../logger'),
    http      = require('http'),
    qs        = require('querystring'),
    url       = require('url'),
    path      = require('path'),
    fs        = require('fs'),
    opts      = require('../opts'),
    mimetypes = require('../mimetypes'),
    Template  = require('../template').Template,
    Compiler  = require('./make').Compiler;


var options = [
    {   short: 'u',
        long: 'url',
        description: 'URL to serve the JavaScript as. Default is output defined in the config file',
        value: true },

    {   short: 'c',
        long: 'config',
        description: 'Project configuration file. Default is jah.json',
        value: true },

    {   short: 'h',
        long: 'host',
        description: 'Hostname or IP address to listen on. Default is localhost',
        value: true },

    {   short: 'p',
        long: 'port',
        description: 'Port to listen on. Default is 4000',
        value: true }
];

exports.description = 'Run the Jah development web server';
exports.run = function () {
    opts.parse(options, true);
    var host     = opts.get('host')   || 'localhost',
        port     = opts.get('port')   || 4000,
        config   = opts.get('config') || 'jah.json',
        server   = new Server(config)

    server.start(host, port)
};

function Server (config) {
    this.compiler = new Compiler(config)
}

Server.prototype.start = function (host, port) {
    host = host || 'localhost'
    port = port || 4000

    http.createServer(function (req, res) {
        var uri = url.parse(req.url, true)
        logger.group('Request', uri.pathname)

        // Forward index requests to index.html
        if (['/', '/index.html', '/public'].indexOf(uri.pathname) > -1) {
            uri.pathname = '/public/index.html';
        }

        var pathTokens = uri.pathname.replace(/^\/|\/$/, '').split('/')
          , pathRoot = pathTokens.shift()
          , filepath = pathTokens.join('/')


        switch (pathRoot) {
        case 'public':
            this.servePublicFile(res, filepath)
            break;
        case '__jah__':
            if (/^__modules__\//.test(filepath)) {
                // Server resource as a module
                this.serveJahModule(res, filepath.replace(/^__modules__\//, ''))
            } else {
                // Server raw resource
                this.serveJahFile(res, filepath)
            }
            break;
        default:
            this.serveNotFound(res)
            break;
        }

        logger.ungroup()

    }.bind(this)).listen(parseInt(port, 10), host);

    logger.notice('Serving from', 'http://' + host + ':' + port + '/');
}

Server.prototype.servePublicFile = function (response, filename) {
    filename = path.join(process.cwd(), 'public', path.normalize(filename))
    logger.notice('Serving file', filename)
    var mimetype = mimetypes.guessType(filename)

    if (path.existsSync(filename)) {
        this.serve(response, fs.readFileSync(filename), mimetype)
    } else if (path.existsSync(filename + '.template')) {
        var template = new Template(fs.readFileSync(filename + '.template').toString())
        this.serve(response, template.substitute({ scripts: this.scriptHTML() }), mimetype)
    } else {
        this.serveNotFound(response)
    }
}

Server.prototype.serve = function (response, data, mimetype, status) {
    response.writeHead(status || 200, {'Content-Type': mimetype || 'text/plain'})
    response.end(data)
}

Server.prototype.serveNotFound = function (response, data) {
    logger.warn('Serving error', '404 File not found')
    response.writeHead(404, 'File not found')
    response.end(data || 'File not found')
}

Server.prototype.serveJahModule = function (response, filename) {
    var match = this.compiler.filePathForScript(filename)
    if (!match) {
        this.serveNotFound(response)
        return false
    }
    logger.notice('Serving script', match.filename)
    var data = this.compiler.buildFile(match.filename, match.mount, true)
    this.serve(response, data, 'text/javascript')
}

Server.prototype.serveJahFile = function (response, filename) {
    var match = this.compiler.filePathForScript(filename)
    if (!match) {
        this.serveNotFound(response)
        return false
    }
    logger.notice('Serving Jah resource', match.filename)
    var mimetype = mimetypes.guessType(filename)
    this.serve(response, fs.readFileSync(match.filename), mimetype)
}

Server.prototype.scriptHTML = function () {
    var tag = new Template('\n        <script src="$filename$" type="text/javascript"></script>')
      , html = '<script type="text/javascript">window.__jah__ = {resources:{},assetURL:"/__jah__"}</script>'
      , allFiles = this.compiler.getAllMountFilenames()

    var filename
    for (var i=0, l = allFiles.length; i<l; i++) {
        filename = allFiles[i]
        html += tag.substitute({ filename: '/__jah__/__modules__' + filename })
    }

    html += '\n        <script type="text/javascript">\n'
    html += this.compiler.jahFooter()
    html += '\n        </script>'

    return html
}