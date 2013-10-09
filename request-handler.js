"use strict"

var async = require("async");
var util = require("util");

var Repository = require('./repository');
var d = require('./domain');
var EventEmitter = require("events").EventEmitter;

var DavHandler = require('jsdav/lib/DAV/handler');
var FsTree = require('jsdav/lib/DAV/backends/fs/tree');
var defaultPlugins = require("jsdav/lib/DAV/server").DEFAULT_PLUGINS;


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
        this.resetDatabase = !!options.resetDatabase;
        this.repository = new Repository(options);
    },

    registerWith: function(app, server, thenDo) {
        if (!server) this.emit('error', new Error('livelydavfs request handler needs server!'));
        this.server = server;
        var handler = this, repo = handler.repository;
        async.series([
            this.patchServer.bind(this, server),
            repo.start.bind(repo, this.resetDatabase),
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
            livelydav: this.repository.getDAVPlugin(),
            browser: defaultPlugins.browser};
        // https server has slightly different interface
        if (!server.baseUri) server.baseUri = '/';
        if (!server.getBaseUri) server.getBaseUri = function() { return this.baseUri };
        thenDo(null);
    },

    handleRequest: function(req, res, next) {
        new DavHandler(this.server, req, res);
    }
}));

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = LivelyFsHandler;