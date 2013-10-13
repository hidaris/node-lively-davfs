"use strict"

var async = require("async");
var util = require("util");

var Repository = require('./repository');
var d = require('./domain');
var EventEmitter = require("events").EventEmitter;

var DavHandler = require('jsDAV/lib/DAV/handler');
var FsTree = require('jsDAV/lib/DAV/backends/fs/tree');
var defaultPlugins = require("jsDAV/lib/DAV/server").DEFAULT_PLUGINS;


function LivelyFsHandler(options) {
    EventEmitter.call(this);
    this.initialize(options);
}

util._extend(LivelyFsHandler.prototype, EventEmitter.prototype);

util._extend(LivelyFsHandler.prototype, d.bindMethods({

    initialize: function(options) {
        options = options || {};
        options.fs = options.fs || process.cwd();
        options.excludedDirectories = options.excludedDirectories || ['.svn', '.git', 'node_modules'];
        options.excludedFiles = options.excludedFiles || ['.DS_Store'];
        options.includedFiles = options.includedFiles || undefined/*allow all*/;
        this.enableVersioning = options.enableVersioning === undefined || options.enableVersioning;
        this.resetDatabase = !!options.resetDatabase;
        this.repository = new Repository(options);
        this.timemachineSettings = (function tmSetup(tmOptions) {
            if (!tmOptions) return null;
            var path = tmOptions.path;
            if (!path) return null;
            if (path[0] !== '/') path = '/' + path;
            if (path[path.length-1] !== '/') path += '/';
            return {path: path};
        })(options.timemachine || {path: '/timemachine/'});
    },

    registerWith: function(app, server, thenDo) {
        if (!server) this.emit('error', new Error('livelydavfs request handler needs server!'));
        this.server = server;
        server.davHandler = this;
        var deactivated = !this.enableVersioning;
        var resetDB = this.resetDatabase;
        var handler = this, repo = handler.repository;
        async.series([
            this.patchServer.bind(this, server),
            function(next) {
                deactivated && console.log('no versioning...!');
                if (deactivated) next();
                else repo.start(resetDB, next);
            },
            function(next) {
                server.on('close', repo.close.bind(repo));
                server.on('close', function() { handler.server = null; });
                next();
            }
        ], function(err) {
            if (err) console.error(err);
            console.log('LivelyFsHandler registerWith done');
            thenDo && thenDo(err);
        });
        return this;
    },

    patchServer: function(server, thenDo) {
        // this is what jsDAV expects...
        server.tree = FsTree.new(this.repository.getRootDirectory());
        server.tmpDir = './tmp'; // httpPut writes tmp files
        server.options = {};
        // for showing dir contents
        server.plugins = {
            browser: defaultPlugins.browser};
        if (this.enableVersioning) {
            server.plugins.livelydav = this.repository.getDAVPlugin();
        }
        // https server has slightly different interface
        if (!server.baseUri) server.baseUri = '/';
        if (!server.getBaseUri) server.getBaseUri = function() { return this.baseUri };
        thenDo(null);
    },

    handleRequest: function(req, res, next) {
        if (this.isTimemachineRequest(req)) {
            this.handleTimemachineRequest(req, res, next);
        } else {
            new DavHandler(this.server, req, res);
        }
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // timemachine support
    isTimemachineRequest: function(req) {
        if (!this.timemachineSettings) return false;
        var tmPath = this.timemachineSettings.path;
        return req.url.indexOf(tmPath) === 0;
    },
    makeDateAndTime: function(versionString) {
        versionString = decodeURIComponent(versionString);
        return new Date(versionString);
    },
    handleTimemachineRequest: function(req, res, next) {
        // req.url is something like '/timemachine/2010-08-07%2015%3A33%3A22/foo/bar.js'
        // tmPath = '/timemachine/'
        if (req.method.toLowerCase() !== 'get') {
            res.status(400).end('timemachine request to ' + req.url + ' not supported.');
            return;
        }
        var tmPath = this.timemachineSettings.path,
            repo = this.repository,
            versionedPath = req.url.slice(tmPath.length),
            version = versionedPath.slice(0, versionedPath.indexOf('/'));
        if (!version) {
            res.status(400).end('cannot read version from path: ' + req.url);
            return;
        }
        var path = versionedPath.slice(version.length);
        if (path[0] === '/') path = path.slice(1);
        var ts = this.makeDateAndTime(version);
        console.log('timemachine into %s, %sing path %s', ts, req.method, path);
        this.repository.getRecords({
            paths: [path],
            older: ts,
            attributes: ['version', 'date', 'author', 'content'],
            limit: 1
        }, function(err, records) {
            if (err) { res.status(500).end(String(err)); return; }
            if (!records.length) { res.status(404).end(util.format('Nothing stored for %s at %s', path, ts)); return; }
            res.end(records[records.length-1].content);
        });
    }

}));

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = LivelyFsHandler;